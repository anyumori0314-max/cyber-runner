-- ===================================
-- 20260628120000_gameplay_analytics.sql  (Phase 13)
--   匿名ゲームプレイ分析テーブル。個人を特定しない 1 プレイ 1 件の要約のみを保持する。
--
--   セキュリティ契約:
--     * public SELECT 禁止 / anon・authenticated の INSERT・UPDATE・DELETE 禁止。
--     * 書き込みは Edge Function（service_role・RLS バイパス）経由のみ。
--     * 個人情報列を持たない（player_name / email / user_id / 生 IP / 位置情報 / UA 全文なし）。
--     * ip_hash は「ソルト付きハッシュ」のみ（生 IP は保存しない。レート制限専用）。
--     * event_id は一意（重複は 409 として弾く）。created_at はサーバー側で付与。
--
--   ※ 本番への適用はレビュー後（このリポジトリではコードと手順のみ。自動適用しない）。
-- ===================================

create table if not exists public.gameplay_analytics (
    id               bigint generated always as identity primary key,
    event_id         text        not null unique,
    game_version     text        not null check (char_length(game_version) between 1 and 32),
    balance_version  text        not null check (char_length(balance_version) between 1 and 32),
    mode             text        not null check (mode in ('endless','timeattack','hardcore')),
    score            integer     not null check (score >= 0 and score <= 1000000000),
    duration_ms      integer     not null check (duration_ms >= 0 and duration_ms <= 3600000),
    reached_level    integer     not null check (reached_level >= 0 and reached_level <= 100000),
    max_combo        integer     not null check (max_combo >= 0 and max_combo <= 1000000),
    core_count       integer     not null check (core_count >= 0 and core_count <= 1000000),
    near_miss_count  integer     not null check (near_miss_count >= 0 and near_miss_count <= 1000000),
    dash_count       integer     not null check (dash_count >= 0 and dash_count <= 1000000),
    death_cause      text        not null check (death_cause in ('obstacle','laser','homing','gapwall','boss','finish','quit','unknown')),
    wave_reached     integer     not null check (wave_reached >= 0 and wave_reached <= 100000),
    boss_reached     integer     not null check (boss_reached >= 0 and boss_reached <= 100000),
    boss_defeated    integer     not null check (boss_defeated >= 0 and boss_defeated <= 100000),
    powerups_collected integer   not null check (powerups_collected >= 0 and powerups_collected <= 1000000),
    pwa_mode         text        not null check (pwa_mode in ('standalone','browser','unknown')),
    device_class     text        not null check (device_class in ('mobile','tablet','desktop','unknown')),
    -- レート制限専用のソルト付きハッシュ（生 IP は保存しない）。null 可。
    ip_hash          text        null check (ip_hash is null or char_length(ip_hash) <= 128),
    created_at       timestamptz not null default now(),
    -- 論理整合: 撃破数は到達数を超えない。
    constraint gameplay_analytics_boss_chk check (boss_defeated <= boss_reached)
);

comment on table public.gameplay_analytics is
    'Phase 13 anonymous gameplay analytics. One summary row per play. No PII. Writes via Edge Function (service_role) only.';

create index if not exists gameplay_analytics_mode_created_idx on public.gameplay_analytics (mode, created_at desc);
create index if not exists gameplay_analytics_balance_idx     on public.gameplay_analytics (balance_version);
create index if not exists gameplay_analytics_iphash_idx       on public.gameplay_analytics (ip_hash, created_at desc);

-- RLS を有効化。policy を作らない＝anon/authenticated は SELECT/INSERT/UPDATE/DELETE 不可。
-- service_role は RLS をバイパスするため Edge Function からのみ書き込める。
alter table public.gameplay_analytics enable row level security;

-- 念のため明示的に権限を剥奪（grant は一切行わない）。
revoke all on public.gameplay_analytics from anon;
revoke all on public.gameplay_analytics from authenticated;
revoke all on public.gameplay_analytics from public;
