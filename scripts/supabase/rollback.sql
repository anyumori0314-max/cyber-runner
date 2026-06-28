-- ===================================================================
-- rollback.sql  (Phase 6 本番反映・安全ロールバック / SAFE STOP)
--   ⚠️ レビュー後・手動でのみ実行する。自動実行しない。
--
--   方針（Codex High 1：データ保全を最優先・破壊的撤去をしない）:
--     * public.runs を撤去しない・行を消さない・空にしない。
--       → run 発行履歴 / 二重送信防止 / レート制限の根拠 / 監査情報をすべて保全する。
--     * leaderboard_scores に追加した列（run_id 等）も撤去しない（既存データと再適用性を保全）。
--     * submit_score_atomic も撤去しない（再適用性・監査のため残す）。
--     * 代わりに「安全側へ倒す」=
--         - anon / authenticated への書き込み権限を与えない（剥がしたまま維持）。
--         - 直接 INSERT を再開しない（SELECT 公開のみ維持）。
--         - RPC の一般利用を禁止（public/anon/authenticated から EXECUTE を剥がしたまま維持）。
--     * 機能停止の主手段は Edge Functions の undeploy + クライアント EDGE_FUNCTIONS_BASE=''（SQL 外・末尾参照）。
--       service_role 経由の唯一の呼び出し元（Edge Function）が消えれば、RPC は実質未使用になる。
--
--   このスクリプトは構造を一切撤去せず、書き込み不可の安全状態を「再表明」するだけ（冪等）。
--   破壊的な完全撤去は、後日の明示的な保守作業として別レビューで判断する（末尾の散文参照・既定では行わない）。
-- ===================================================================

begin;

-- 1) leaderboard_scores: 書き込み権限を与えない（剥がしたまま維持）。SELECT 公開のみ残す。
--    revoke all → grant select で、anon/authenticated は「読み取りのみ」になる（直接 INSERT 不可）。
--    ※ 既存ランキングの行は一切変更しない（データ保全のため runs も追加列も残す）。
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on public.leaderboard_scores from anon;
        revoke all on public.runs from anon;
        grant select on public.leaderboard_scores to anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke all on public.leaderboard_scores from authenticated;
        revoke all on public.runs from authenticated;
        grant select on public.leaderboard_scores to authenticated;
    end if;
end
$$;

-- 2) submit_score_atomic: 一般利用を禁止（public/anon/authenticated から EXECUTE を剥がしたまま維持）。
--    関数は残す（撤去しない）。service_role のみ EXECUTE 可。Edge Function 未deploy なら呼ばれない。
revoke all on function public.submit_score_atomic(
    uuid, text, text, text, integer, integer, integer, text, text, jsonb, timestamptz, integer
) from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on function public.submit_score_atomic(
            uuid, text, text, text, integer, integer, integer, text, text, jsonb, timestamptz, integer) from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke all on function public.submit_score_atomic(
            uuid, text, text, text, integer, integer, integer, text, text, jsonb, timestamptz, integer) from authenticated;
    end if;
end
$$;

commit;

-- ---------- 機能停止の主手段（SQL 外・Runbook 手順 12 と一致） ----------
--   1) Edge Functions を undeploy:
--        supabase functions delete submit-score start-run challenges
--   2) クライアント: js/config.js の EDGE_FUNCTIONS_BASE を '' に戻す（直接 INSERT には戻さない）。
--   → これで RPC の唯一の呼び出し元が消え、追加構造はデータ保全しつつ実質未使用になる。

-- ---------- 旧ポリシー / 旧権限の手動復元（自動化しない） ----------
--   migration はポリシーを当該テーブルに限定して撤去し、SELECT 公開のみ再作成している。
--   厳密に元へ戻す場合は preflight_capture.sql の手順 3/5 の控えから手動で再作成する。
--   ※ 直接 INSERT には戻さない方針を推奨（不正対策が無効化されるため）。

-- ===================================================================
-- ⚠️ 完全撤去について（データ保全のため、このスクリプトには破壊的 DDL を含めない）
--   runs テーブル・追加列・RPC を物理的に取り除くと、二重送信防止・レート制限・監査の履歴が失われ、
--   再適用性も損なわれる。したがって本スクリプトでは行わない（Codex High 1）。
--   どうしても撤去が必要になった場合は、後日「明示的な保守作業」として別レビューで影響範囲を確認し、
--   バックアップ取得後に手動で判断すること。安易に撤去しない。
-- ===================================================================
