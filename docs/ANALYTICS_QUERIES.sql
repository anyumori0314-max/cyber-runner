-- ===================================
-- docs/ANALYTICS_QUERIES.sql  (Phase 13)
--   gameplay_analytics 用の「管理者向け」集計 SQL 集。
--   公開ビューにはしない（このファイルは Supabase SQL Editor 等で管理者が手動実行する想定）。
--   個人情報は収集していないため、これらの集計はすべて匿名の母集団統計である。
-- ===================================

-- 1) モード別プレイ数
select mode, count(*) as plays
from public.gameplay_analytics
group by mode
order by plays desc;

-- 2) モード別 平均スコア / 中央値（近似）
select mode,
       round(avg(score))::int                                   as avg_score,
       percentile_cont(0.5) within group (order by score)::int  as median_score
from public.gameplay_analytics
group by mode
order by avg_score desc;

-- 3) スコア分布（1000 点バケット）
select width_bucket(score, 0, 20000, 20) as bucket,
       count(*)                          as plays,
       min(score)                        as bucket_min,
       max(score)                        as bucket_max
from public.gameplay_analytics
group by bucket
order by bucket;

-- 4) 平均プレイ時間（秒）
select mode,
       round(avg(duration_ms) / 1000.0, 1) as avg_seconds
from public.gameplay_analytics
group by mode
order by avg_seconds desc;

-- 5) death_cause 別件数（割合つき）
select death_cause,
       count(*)                                                  as plays,
       round(100.0 * count(*) / sum(count(*)) over (), 1)        as pct
from public.gameplay_analytics
group by death_cause
order by plays desc;

-- 6) Wave 到達率（各 wave 番号以上へ到達した割合）
select w as wave,
       round(100.0 * count(*) filter (where wave_reached >= w) / nullif(count(*), 0), 1) as reach_pct
from public.gameplay_analytics,
     generate_series(1, 5) as w
group by w
order by w;

-- 7) ボス到達率（1 体以上のボスへ到達したプレイの割合）
select round(100.0 * count(*) filter (where boss_reached >= 1) / nullif(count(*), 0), 1) as boss_reach_pct
from public.gameplay_analytics;

-- 8) ボス撃破率（到達したボスのうち撃破した割合）
select sum(boss_reached)  as total_boss_reached,
       sum(boss_defeated) as total_boss_defeated,
       round(100.0 * sum(boss_defeated) / nullif(sum(boss_reached), 0), 1) as defeat_pct
from public.gameplay_analytics;

-- 9) powerups 取得数（平均 / 合計）
select round(avg(powerups_collected), 2) as avg_powerups,
       sum(powerups_collected)           as total_powerups
from public.gameplay_analytics;

-- 10) balance_version 別比較（プレイ数・平均スコア・平均到達 wave）
select balance_version,
       count(*)                       as plays,
       round(avg(score))::int         as avg_score,
       round(avg(wave_reached), 2)    as avg_wave,
       round(avg(duration_ms)/1000.0, 1) as avg_seconds
from public.gameplay_analytics
group by balance_version
order by balance_version;

-- 11) device_class 別比較（プレイ数・平均スコア）
select device_class,
       count(*)               as plays,
       round(avg(score))::int as avg_score
from public.gameplay_analytics
group by device_class
order by plays desc;

-- 12) PWA モード別（standalone vs browser）プレイ数
select pwa_mode, count(*) as plays
from public.gameplay_analytics
group by pwa_mode
order by plays desc;
