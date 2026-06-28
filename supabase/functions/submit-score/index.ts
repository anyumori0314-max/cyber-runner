// ===================================
// supabase/functions/submit-score/index.ts
//   スコア送信の唯一の経路。クライアントからの leaderboard_scores への直接 INSERT は
//   RLS で禁止し、ここ（service_role）でのみ検証通過後に登録する。
//
//   High 1（原子性）: run の確認・スコア INSERT・run 消費は PostgreSQL の
//   submit_score_atomic() RPC で「FOR UPDATE ロック付き単一トランザクション」として実行する。
//   これにより、同一 run_id の同時送信は 1 件だけ成功し（2 件目以降は 409）、
//   INSERT 失敗時は run が消費されない（トランザクションごとロールバック）。
//
//   入力検証（JS）→ 原子的登録（RPC）の二段構え。検証は _shared/score-validation.js を再利用。
//   ※ 本番 deploy はレビュー後（docs/SUPABASE_SECURE_LEADERBOARD_SETUP.md）。
// ===================================

// @ts-ignore Deno 環境で解決される
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  validateScorePayload,
  validatePlayerName,
  isRateLimited,
} from "../_shared/score-validation.js";

// @ts-ignore Deno グローバル
Deno.serve(async (req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405, req);

  let payload: any = {};
  try {
    payload = await req.json();
  } catch (_e) {
    return jsonResponse({ error: "invalid json" }, 400, req);
  }

  // 0) player_name の厳格検証（制御/不可視/bidi 文字を拒否）→ 不正は 400。
  const nameCheck = validatePlayerName(payload?.player_name);
  if (!nameCheck.ok) {
    return jsonResponse({ error: "invalid player_name", detail: nameCheck.error }, 400, req);
  }

  // 1) ペイロード本体の検証（異常値拒否・mode 検証・矛盾検出）。
  const v = validateScorePayload(payload);
  if (!v.ok) return jsonResponse({ error: "validation failed", details: v.errors }, 422, req);
  const cleaned = v.cleaned!;

  // @ts-ignore
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  // @ts-ignore service_role はここだけ（フロントには存在しない）
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const now = Date.now();

  // 2) 送信レート制限：同一匿名 ID の直近送信時刻を見て連投を拒否（429）。
  if (cleaned.anonymous_player_id) {
    const sinceIso = new Date(now - 60000).toISOString();
    const { data: recent } = await admin
      .from("leaderboard_scores")
      .select("created_at")
      .eq("anonymous_player_id", cleaned.anonymous_player_id)
      .gte("created_at", sinceIso);
    const stamps = (recent || []).map((r: any) => Date.parse(r.created_at));
    if (isRateLimited(stamps, now, 60000, 5)) {
      return jsonResponse({ error: "rate limited" }, 429, req, { "Retry-After": "60" });
    }
  }

  // 3) Training はランキング対象外（早期拒否。RPC でも二重防御）。
  if (cleaned.mode === "training") {
    return jsonResponse({ error: "training is not ranked" }, 400, req);
  }

  // 4) 原子的登録：run ロック → 検証 → INSERT → run 消費 を単一トランザクションで。
  const { data: result, error: rpcErr } = await admin.rpc("submit_score_atomic", {
    p_run_id: cleaned.run_id,
    p_anonymous_player_id: cleaned.anonymous_player_id,
    p_player_name: cleaned.player_name,
    p_mode: cleaned.mode,
    p_score: cleaned.score,
    p_max_combo: cleaned.max_combo,
    p_duration_ms: cleaned.duration_ms,
    p_rank: cleaned.rank,
    p_game_version: cleaned.game_version,
    p_metrics: cleaned.metrics,
  });

  if (rpcErr) return jsonResponse({ error: "submit failed" }, 500, req);

  if (!result || result.ok !== true) {
    const code = (result && result.code) || "run check failed";
    // 入力ロジック起因（training）は 400、競合・重複・期限切れ等は 409。
    const status = code === "training_not_ranked" ? 400 : 409;
    return jsonResponse({ error: code }, status, req);
  }

  return jsonResponse({ ok: true }, 200, req);
});
