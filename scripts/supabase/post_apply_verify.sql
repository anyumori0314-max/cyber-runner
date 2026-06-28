-- ===================================================================
-- post_apply_verify.sql  (Phase 6 本番反映・適用後の DB 側検証)
--   ⚠️ READ-ONLY。`supabase db push` の直後に実行し、preflight_capture.sql の
--      出力と突き合わせる。1 つでも期待と違えば runbook の「停止条件」に従う。
--
--   ここは DB 状態の検証のみ。HTTP（Edge Function）E2E は runbook の手順 9 で行う。
-- ===================================================================

-- A) 件数が減っていないこと（preflight の leaderboard_total と比較。>= であること）。
select count(*) as leaderboard_total_after from public.leaderboard_scores;

-- B) legacy バックフィル: mode IS NULL の行が残っていない / legacy が付与されている。
select count(*) filter (where mode is null)     as null_mode_rows,   -- 0 であること
       count(*) filter (where mode = 'legacy')   as legacy_rows
from public.leaderboard_scores;

-- C) ポリシー: leaderboard_scores は「public read leaderboard」(SELECT) のみ。
--    runs はポリシー無し（= service_role 以外は全拒否）。
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename in ('leaderboard_scores', 'runs')
order by tablename, policyname;

-- D) 権限: anon / authenticated に INSERT/UPDATE/DELETE が「残っていない」こと。
--    返る行は SELECT のみであるべき（INSERT/UPDATE/DELETE が出たら失敗）。
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('leaderboard_scores', 'runs')
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

-- E) RPC の EXECUTE 権限が service_role のみであること（anon/authenticated/public は不可）。
--    grantee に anon/authenticated/public が出たら失敗。
select p.proname,
       coalesce(r.rolname, 'PUBLIC') as grantee,
       ae.privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral aclexplode(p.proacl) ae on true
left join pg_roles r on r.oid = ae.grantee
where n.nspname = 'public' and p.proname = 'submit_score_atomic'
order by grantee;

-- F) run_id 一意インデックスの存在（同一 run の二重登録を DB レベルで防ぐ最後の砦）。
select indexname
from pg_indexes
where schemaname = 'public' and tablename = 'leaderboard_scores'
  and indexname = 'leaderboard_run_id_uidx';

-- G) runs テーブルが存在し RLS 有効であること。
select relname, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace and relname = 'runs';

-- ===================================================================
-- E2) RPC EXECUTE 権限の「明示判定」（Codex High 2）。
--     各 role が実際に EXECUTE 可能かを has_function_privilege で true/false 判定し、
--     期待値（service_role だけ true）と一致しなければ FAIL を返す。
--     完全シグネチャ（引数型）で overload を一意特定する（別関数の誤判定を防ぐ）。
--     関数が存在しなければ to_regprocedure が NULL を返し、全行 'RPC MISSING' になる。
-- ===================================================================
with sig as (
    select to_regprocedure(
        'public.submit_score_atomic(uuid, text, text, text, integer, integer, integer, text, text, jsonb, timestamptz, integer)'
    ) as fn
),
-- PUBLIC（擬似ロール）は has_function_privilege で直接照会できないため ACL から判定する。
-- ※ 関数の proacl が NULL のとき、PostgreSQL の既定では PUBLIC に EXECUTE が付く（= 危険 → true）。
pub as (
    select case
             when s.fn is null then null
             when p.proacl is null then true
             else coalesce((
                 select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE')
                 from aclexplode(p.proacl) a), false)
           end as can_execute
    from sig s
    left join pg_proc p on p.oid = s.fn
),
role_checks(role, expected) as (
    values ('anon', false), ('authenticated', false), ('service_role', true)
),
roles_eval as (
    select rc.role,
           case when not exists (select 1 from pg_roles where rolname = rc.role) then null
                when (select fn from sig) is null then null
                else has_function_privilege(rc.role, (select fn from sig), 'EXECUTE')
           end as can_execute,
           rc.expected
    from role_checks rc
),
all_eval as (
    select 'public' as role, (select can_execute from pub) as can_execute, false as expected
    union all
    select role, can_execute, expected from roles_eval
)
select role,
       can_execute,
       expected,
       case
         when (select fn from sig) is null then 'RPC MISSING'
         when can_execute is null then 'ROLE MISSING'
         when can_execute = expected then 'OK'
         else 'FAIL'
       end as result
from all_eval
order by case role when 'public' then 0 when 'anon' then 1
                   when 'authenticated' then 2 when 'service_role' then 3 end;
-- 期待出力:
--   public          false  false  OK
--   anon            false  false  OK
--   authenticated   false  false  OK
--   service_role    true   true   OK
-- いずれかが FAIL なら runbook の停止条件に従う。

-- ===================================================================
-- H) 追加列の「全体」検証（Codex Medium 1）。
--    migration 20260627090000 を正本とし、実際に追加した列のみを対象にする
--    （migration に無い列＝client_started_at / server_started_at / submitted_at /
--      runs.run_id 等は推測で含めない。runs は id / started_at / submitted を使用）。
--    各列の schema/table/column/data_type/is_nullable/default を出力する。
-- ===================================================================
select table_schema, table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and (
        (table_name = 'leaderboard_scores' and column_name in
            ('run_id','anonymous_player_id','mode','duration_ms','game_version','metrics'))
     or (table_name = 'runs' and column_name in
            ('id','mode','anonymous_player_id','ip_hash','started_at','expires_at','submitted','created_at'))
      )
order by table_name, column_name;

-- H2) 期待列の不足判定（期待数 vs 実在数。欠けていれば FAIL）。
with expected(table_name, column_name) as (
    values
      ('leaderboard_scores','run_id'),
      ('leaderboard_scores','anonymous_player_id'),
      ('leaderboard_scores','mode'),
      ('leaderboard_scores','duration_ms'),
      ('leaderboard_scores','game_version'),
      ('leaderboard_scores','metrics'),
      ('runs','id'),
      ('runs','mode'),
      ('runs','anonymous_player_id'),
      ('runs','ip_hash'),
      ('runs','started_at'),
      ('runs','expires_at'),
      ('runs','submitted'),
      ('runs','created_at')
),
found as (
    select e.table_name, e.column_name,
           (c.column_name is not null) as present
    from expected e
    left join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = e.table_name
     and c.column_name = e.column_name
)
select table_name,
       count(*)                              as expected_cols,
       count(*) filter (where present)       as found_cols,
       count(*) filter (where not present)   as missing_cols,
       case when count(*) = count(*) filter (where present) then 'OK' else 'FAIL' end as result
from found
group by table_name
order by table_name;

-- H3) 不足列の明示リスト（行が出たら、その列が欠けている＝FAIL の内訳）。
with expected(table_name, column_name) as (
    values
      ('leaderboard_scores','run_id'),
      ('leaderboard_scores','anonymous_player_id'),
      ('leaderboard_scores','mode'),
      ('leaderboard_scores','duration_ms'),
      ('leaderboard_scores','game_version'),
      ('leaderboard_scores','metrics'),
      ('runs','id'),
      ('runs','mode'),
      ('runs','anonymous_player_id'),
      ('runs','ip_hash'),
      ('runs','started_at'),
      ('runs','expires_at'),
      ('runs','submitted'),
      ('runs','created_at')
)
select e.table_name, e.column_name as missing_column
from expected e
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = e.table_name
 and c.column_name = e.column_name
where c.column_name is null
order by e.table_name, e.column_name;
