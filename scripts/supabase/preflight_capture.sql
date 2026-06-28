-- ===================================================================
-- preflight_capture.sql  (Phase 6 本番反映・適用前キャプチャ)
--   ⚠️ READ-ONLY。これは「適用前のスナップショット」を取得するだけで、
--      データ・スキーマ・ポリシーを一切変更しない。
--
--   目的:
--     * 適用前のランキング件数を記録（適用後に件数が減っていないことの基準）。
--     * 既存 RLS ポリシー / テーブル権限を「verbatim」で控える。
--       ※ migration 20260627090000 は leaderboard_scores / runs の
--         全ポリシーを一旦 DROP するため、ロールバック時の復元に必要。
--
--   実行方法（どちらか）:
--     1) Supabase ダッシュボード > SQL Editor に貼り付けて実行。
--     2) psql 接続文字列がある場合: psql "$DB_URL" -f scripts/supabase/preflight_capture.sql
--
--   出力は丸ごと安全な場所へ保存し、runbook の「適用前記録」に貼ること。
-- ===================================================================

-- 1) ランキング総件数（この数値を記録。適用後に減ってはならない）。
select count(*) as leaderboard_total from public.leaderboard_scores;

-- 2) mode 別件数（mode IS NULL の旧行は適用後に 'legacy' へバックフィルされる）。
select coalesce(mode, '(null)') as mode, count(*) as rows
from public.leaderboard_scores
group by mode
order by rows desc;

-- 3) 既存 RLS ポリシー（そのまま控える。migration が全削除するため復元の唯一の根拠）。
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('leaderboard_scores', 'runs')
order by tablename, policyname;

-- 4) RLS 有効フラグ（適用後は両テーブルとも有効になる想定）。
select relname, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('leaderboard_scores', 'runs');

-- 5) テーブル権限（anon/authenticated の INSERT/UPDATE/DELETE が適用後に REVOKE される）。
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('leaderboard_scores', 'runs')
order by table_name, grantee, privilege_type;

-- 6) leaderboard_scores の列一覧（追加される Phase 6 列の有無を確認。DROP は無い）。
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'leaderboard_scores'
order by ordinal_position;

-- 7) submit_score_atomic RPC の現存有無（適用前は通常存在しない）。
select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'submit_score_atomic';

-- ===================================================================
-- 8) 既存 constraint の baseline（Codex Medium 2）。READ-ONLY。
--    public.leaderboard_scores / public.runs に厳密限定。CREATE/ALTER/DROP/DML は含めない。
--    schema / table / constraint 名 / 種別 / 定義を控える（適用後の比較・復元の根拠）。
-- ===================================================================
select n.nspname               as schema_name,
       c.relname               as table_name,
       con.conname             as constraint_name,
       con.contype             as constraint_type,   -- p=PK, u=UNIQUE, f=FK, c=CHECK, x=EXCLUDE
       pg_get_constraintdef(con.oid) as constraint_def
from pg_constraint con
join pg_class c     on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('leaderboard_scores', 'runs')
order by c.relname, con.conname;

-- 9) 既存 index の baseline（Codex Medium 2）。READ-ONLY。
--    public.leaderboard_scores / public.runs に厳密限定。
--    index 名 / 定義 / unique か / primary key か を控える。
select n.nspname                       as schema_name,
       t.relname                       as table_name,
       ic.relname                      as index_name,
       pg_get_indexdef(idx.indexrelid) as index_def,
       idx.indisunique                 as is_unique,
       idx.indisprimary                as is_primary
from pg_index idx
join pg_class ic    on ic.oid = idx.indexrelid
join pg_class t     on t.oid  = idx.indrelid
join pg_namespace n on n.oid  = t.relnamespace
where n.nspname = 'public'
  and t.relname in ('leaderboard_scores', 'runs')
order by t.relname, ic.relname;
