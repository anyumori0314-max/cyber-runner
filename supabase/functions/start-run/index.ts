// ===================================
// supabase/functions/start-run/index.ts
//   プレイ開始時に呼ばれ、サーバー権威の run を発行する。
//   返却: { run_id, server_started_at, mode, expires_at }
//
//   service_role key は Edge Function の環境変数からのみ取得する（フロントに置かない）。
//   レート制限（Medium 1）: anonymous_player_id と「IP ハッシュ」単位で、直近窓内の
//   run 生成数を runs テーブル（永続）から数え、上限超過時は 429 + Retry-After。
//   生 IP は保存せず、salt 付き SHA-256 ハッシュのみ保存する。
//   ※ 本番 deploy はレビュー後（docs/SUPABASE_SECURE_LEADERBOARD_SETUP.md）。
// ===================================

// @ts-ignore Deno 環境で解決される（Node 側では実行しない）
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  ALLOWED_MODES,
  START_RUN_RATE,
  isStartRateLimited,
  retryAfterSeconds,
} from "../_shared/score-validation.js";

// run の有効期限（サーバー側でも妥当性を担保）。
const RUN_EXPIRY_MS = 10 * 60 * 1000;

// @ts-ignore Deno グローバル
const env = (k: string): string | undefined =>
  typeof Deno !== "undefined" ? Deno.env.get(k) : undefined;

const intEnv = (k: string, fallback: number): number => {
  const v = Number(env(k));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
};

// クライアント IP を salt 付き SHA-256 でハッシュ化（生 IP は保存しない）。
async function hashIp(req: Request): Promise<string | null> {
  const salt = env("RATE_LIMIT_IP_SALT");
  if (!salt) return null; // salt 未設定なら IP 次元のレート制限は無効（anon 次元のみ）。
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0].trim();
  if (!ip) return null;
  // @ts-ignore Web Crypto（Deno / ブラウザ）
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + "|" + ip));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// @ts-ignore Deno グローバル
Deno.serve(async (req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405, req);

  let body: any = {};
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse({ error: "invalid json" }, 400, req);
  }

  // クライアント値は信用しすぎない（許可 mode のみ / anonId は長さ制限）。
  const mode = ALLOWED_MODES.includes(body?.mode) ? body.mode : "endless";
  const anonId = typeof body?.anonymous_player_id === "string" ? body.anonymous_player_id.slice(0, 64) : null;

  const supabaseUrl = env("SUPABASE_URL")!;
  // service_role はここだけ（フロントには存在しない）。
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const now = Date.now();
  const windowMs = intEnv("START_RUN_WINDOW_MS", START_RUN_RATE.WINDOW_MS);
  const maxPerAnon = intEnv("START_RUN_MAX_PER_ANON", START_RUN_RATE.MAX_PER_ANON);
  const maxPerIp = intEnv("START_RUN_MAX_PER_IP", START_RUN_RATE.MAX_PER_IP);
  const sinceIso = new Date(now - windowMs).toISOString();

  const ipHash = await hashIp(req);

  // ---------- レート制限（DB 由来・永続）----------
  // anonymous_player_id 単位。
  if (anonId) {
    const { data: recent } = await admin
      .from("runs")
      .select("started_at")
      .eq("anonymous_player_id", anonId)
      .gte("started_at", sinceIso);
    const stamps = (recent || []).map((r: any) => Date.parse(r.started_at));
    if (isStartRateLimited(stamps, now, windowMs, maxPerAnon)) {
      const retry = retryAfterSeconds(stamps, now, windowMs);
      return jsonResponse({ error: "rate limited", retry_after: retry }, 429, req, { "Retry-After": String(retry) });
    }
  }
  // IP ハッシュ単位（salt 設定時のみ）。
  if (ipHash) {
    const { data: recentIp } = await admin
      .from("runs")
      .select("started_at")
      .eq("ip_hash", ipHash)
      .gte("started_at", sinceIso);
    const stamps = (recentIp || []).map((r: any) => Date.parse(r.started_at));
    if (isStartRateLimited(stamps, now, windowMs, maxPerIp)) {
      const retry = retryAfterSeconds(stamps, now, windowMs);
      return jsonResponse({ error: "rate limited", retry_after: retry }, 429, req, { "Retry-After": String(retry) });
    }
  }

  const startedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + RUN_EXPIRY_MS).toISOString();

  const { data, error } = await admin
    .from("runs")
    .insert({
      mode,
      anonymous_player_id: anonId,
      ip_hash: ipHash,
      started_at: startedAt,
      expires_at: expiresAt,
      submitted: false,
    })
    .select("id")
    .single();

  if (error) {
    return jsonResponse({ error: "failed to start run" }, 500, req);
  }

  return jsonResponse({
    run_id: data.id,
    server_started_at: startedAt,
    mode,
    expires_at: expiresAt,
  }, 200, req);
});
