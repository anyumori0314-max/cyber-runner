-- ===================================================================
-- 20260627090000_secure_leaderboard.sql
--   Phase 6: ランキングのセキュア化（サーバー権威 run + 直接 INSERT 廃止）。
--
--   方針:
--     * 既存レコードを破壊しない（ADD COLUMN IF NOT EXISTS / バックフィルのみ・DELETE しない）。
--     * 既存ランキングは legacy データとして保持する。
--     * クライアントから leaderboard_scores へ直接 INSERT できない RLS / 権限にする。
--     * INSERT は submit-score Edge Function（service_role）→ submit_score_atomic() のみ。
--     * SELECT は公開可能な範囲のみ（ランキング表示用）。
--     * 冪等（再実行可能）に書く。
--
--   ⚠️ 本番適用はレビュー後（docs/SUPABASE_SECURE_LEADERBOARD_SETUP.md）。
--      このファイルはリポジトリ内に存在するだけで、自動適用はしない。
-- ===================================================================

-- ---------- 1) runs テーブル（サーバー権威のプレイセッション） ----------
create table if not exists public.runs (
    id uuid primary key default gen_random_uuid(),
    mode text not null default 'endless',
    anonymous_player_id text,
    ip_hash text,                       -- 生 IP は保存しない（salt 付き SHA-256 のみ）
    started_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '10 minutes'),
    submitted boolean not null default false,
    created_at timestamptz not null default now()
);

-- 既存環境向け（古い runs に列が無い場合の追加）。
alter table public.runs add column if not exists ip_hash text;

create index if not exists runs_expires_at_idx on public.runs (expires_at);
-- レート制限の集計用（anonymous_player_id / ip_hash × started_at）。
create index if not exists runs_anon_started_idx on public.runs (anonymous_player_id, started_at);
create index if not exists runs_ip_started_idx on public.runs (ip_hash, started_at);

-- ---------- 2) leaderboard_scores の拡張（既存を壊さない） ----------
-- 既存テーブルが無い環境向けの最小定義（本番には既に存在する想定）。
create table if not exists public.leaderboard_scores (
    id uuid primary key default gen_random_uuid(),
    player_name text not null default 'ANONYMOUS',
    score integer not null default 0,
    max_combo integer not null default 0,
    rank text not null default 'D',
    created_at timestamptz not null default now()
);

alter table public.leaderboard_scores add column if not exists run_id uuid;
alter table public.leaderboard_scores add column if not exists anonymous_player_id text;
alter table public.leaderboard_scores add column if not exists mode text;
alter table public.leaderboard_scores add column if not exists duration_ms integer;
alter table public.leaderboard_scores add column if not exists game_version text;
alter table public.leaderboard_scores add column if not exists metrics jsonb;

-- 既存（Phase 1〜5）の行を legacy として保持（mode 未設定の行のみ）。
update public.leaderboard_scores set mode = 'legacy' where mode is null;

-- ランキング取得用インデックス（score desc, max_combo desc, created_at asc）。
create index if not exists leaderboard_rank_idx
    on public.leaderboard_scores (score desc, max_combo desc, created_at asc);
create index if not exists leaderboard_mode_idx on public.leaderboard_scores (mode);
create index if not exists leaderboard_created_idx on public.leaderboard_scores (created_at);

-- 同一 run の二重保存を防ぐ（run_id があるものは一意）。原子 RPC の最後の砦。
create unique index if not exists leaderboard_run_id_uidx
    on public.leaderboard_scores (run_id) where run_id is not null;

-- ---------- 3) RLS 有効化 ----------
alter table public.leaderboard_scores enable row level security;
alter table public.runs enable row level security;

-- ---------- 4) ポリシーの一括監査・撤去（High 2：名前に依存しない） ----------
-- 既存環境に別名の INSERT/UPDATE/DELETE ポリシーが残っていてもクライアント書き込みを
-- 確実に塞ぐため、対象テーブルの **全ポリシーを一旦削除** し、安全な SELECT のみ再作成する。
-- schema/table を 'public' / 当該テーブルに厳密に限定する。
do $$
declare
    pol record;
begin
    for pol in
        select policyname
        from pg_policies
        where schemaname = 'public' and tablename = 'leaderboard_scores'
    loop
        execute format('drop policy if exists %I on public.leaderboard_scores', pol.policyname);
    end loop;

    for pol in
        select policyname
        from pg_policies
        where schemaname = 'public' and tablename = 'runs'
    loop
        execute format('drop policy if exists %I on public.runs', pol.policyname);
    end loop;
end
$$;

-- SELECT は公開（ランキング表示）。公開して問題ない列のみアプリ側で select する。
-- （INSERT/UPDATE/DELETE ポリシーは作らない = anon / authenticated は書き込み不可。
--   service_role は RLS をバイパスする。）
create policy "public read leaderboard"
    on public.leaderboard_scores for select
    using (true);

-- runs はクライアントから一切アクセスさせない（service_role のみ。ポリシー無し = 全拒否）。

-- ---------- 5) テーブル権限（GRANT/REVOKE）でも二重に防御 ----------
-- RLS に加えてテーブル権限自体からも書き込みを剥がす（多層防御）。ロール存在時のみ実行。
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke insert, update, delete on public.leaderboard_scores from anon;
        revoke all on public.runs from anon;
        grant select on public.leaderboard_scores to anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke insert, update, delete on public.leaderboard_scores from authenticated;
        revoke all on public.runs from authenticated;
        grant select on public.leaderboard_scores to authenticated;
    end if;
end
$$;

-- ---------- 6) 原子的スコア登録 RPC（High 1） ----------
-- run の確認・スコア INSERT・run 消費を「FOR UPDATE ロック付き単一トランザクション」で実行する。
--   * run_id が存在しない / submitted / 期限切れ / mode 不一致 / anon 不一致 / duration 矛盾 → 拒否。
--   * training は対象外。
--   * INSERT 成功後にのみ submitted=true（途中失敗は例外でロールバック）。
--   * 同一 run_id への同時送信は FOR UPDATE で直列化され、2 件目以降は already_submitted。
-- SECURITY DEFINER + search_path 固定。anon/authenticated からは EXECUTE できない（service_role のみ）。
create or replace function public.submit_score_atomic(
    p_run_id uuid,
    p_anonymous_player_id text,
    p_player_name text,
    p_mode text,
    p_score integer,
    p_max_combo integer,
    p_duration_ms integer,
    p_rank text,
    p_game_version text,
    p_metrics jsonb,
    p_now timestamptz default now(),
    p_skew_ms integer default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_run public.runs%rowtype;
begin
    -- ロック付きで run を取得（同時送信を直列化）。
    select * into v_run from public.runs where id = p_run_id for update;
    if not found then
        return jsonb_build_object('ok', false, 'code', 'run_not_found');
    end if;
    if v_run.submitted then
        return jsonb_build_object('ok', false, 'code', 'already_submitted');
    end if;
    if v_run.expires_at is not null and p_now > v_run.expires_at then
        return jsonb_build_object('ok', false, 'code', 'run_expired');
    end if;
    if v_run.mode is not null and p_mode is not null and v_run.mode <> p_mode then
        return jsonb_build_object('ok', false, 'code', 'mode_mismatch');
    end if;
    if v_run.anonymous_player_id is not null and p_anonymous_player_id is not null
       and v_run.anonymous_player_id <> p_anonymous_player_id then
        return jsonb_build_object('ok', false, 'code', 'anon_mismatch');
    end if;
    -- 報告 duration が「run 開始からの実経過 + skew」を超えるのは不正。
    if v_run.started_at is not null and p_duration_ms is not null
       and p_duration_ms > (extract(epoch from (p_now - v_run.started_at)) * 1000)::bigint + coalesce(p_skew_ms, 0) then
        return jsonb_build_object('ok', false, 'code', 'duration_exceeds_elapsed');
    end if;
    if p_mode = 'training' then
        return jsonb_build_object('ok', false, 'code', 'training_not_ranked');
    end if;

    -- INSERT（run_id 一意制約で二重登録も防止）→ run を消費（INSERT 成功後にのみ）。
    insert into public.leaderboard_scores(
        run_id, anonymous_player_id, player_name, mode, score, max_combo,
        duration_ms, rank, game_version, metrics
    ) values (
        p_run_id, p_anonymous_player_id, p_player_name, p_mode, p_score, p_max_combo,
        p_duration_ms, p_rank, p_game_version, p_metrics
    );

    update public.runs set submitted = true where id = p_run_id;

    return jsonb_build_object('ok', true, 'code', 'ok');
exception
    when unique_violation then
        -- 同一 run_id の競合 INSERT（別トランザクションが先に成功）。トランザクションはロールバック。
        return jsonb_build_object('ok', false, 'code', 'already_submitted');
end;
$$;

-- RPC の EXECUTE は service_role のみ（PostgREST 経由で anon が直接呼べないようにする）。
revoke all on function public.submit_score_atomic(
    uuid, text, text, text, integer, integer, integer, text, text, jsonb, timestamptz, integer
) from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on function public.submit_score_atomic(
            uuid, text, text, text, integer, integer, integer, text, text, jsonb, timestamptz, integer
        ) from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke all on function public.submit_score_atomic(
            uuid, text, text, text, integer, integer, integer, text, text, jsonb, timestamptz, integer
        ) from authenticated;
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        grant execute on function public.submit_score_atomic(
            uuid, text, text, text, integer, integer, integer, text, text, jsonb, timestamptz, integer
        ) to service_role;
    end if;
end
$$;

-- ===================================================================
-- ロールバックの目安（手動・レビュー後。既存ランキングデータは削除しない）:
--   drop function if exists public.submit_score_atomic(
--     uuid, text, text, text, integer, integer, integer, text, text, jsonb, timestamptz, integer);
--   drop table if exists public.runs;
--   alter table public.leaderboard_scores
--     drop column if exists run_id, drop column if exists anonymous_player_id,
--     drop column if exists mode, drop column if exists duration_ms,
--     drop column if exists game_version, drop column if exists metrics;
--   -- 旧 INSERT ポリシー / 権限の復元は環境の元定義に従う（このスクリプトは復元しない）。
--   -- 注意: SELECT 公開ポリシー "public read leaderboard" を残すかは運用方針に従う。
-- ===================================================================
