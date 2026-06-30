// ===================================
// supabase/functions/submit-analytics/index.ts  (Phase 13)
//   匿名ゲームプレイ分析の唯一の書き込み経路。クライアントからの直接 INSERT は RLS で禁止し、
//   ここ（service_role）でのみ検証通過後に登録する。
//
//   契約:
//     * 入力スキーマ検証（_shared/analytics-validation.js を Node テストと共有）。
//     * Training / 不正 mode は 400、検証失敗は 422、重複 event_id は 409、レート超過は 429、
//       DB 障害は 500。異常値・個人情報項目混入は拒否。
//     * service_role は環境変数のみ。秘密はログに出さない。
//     * 生 IP は保存しない（ソルト付きハッシュをレート制限にのみ使用）。
//
//   ※ 本番 deploy はレビュー後（docs/ANALYTICS_PRIVACY.md / setup 手順）。自動 deploy しない。
// ===================================

// @ts-ignore Deno 環境で解決される
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  validateAnalyticsPayload,
  isAnalyticsRateLimited,
} from "../_shared/analytics-validation.js";

// リクエスト IP（プロキシヘッダ優先）。保存はせず、ソルト付きハッシュにのみ使う。
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0].trim();
  return first || req.headers.get("x-real-ip") || "";
}

// SHA-256(ip + salt) の hex。生 IP は決して保存しない。
async function hashIp(ip: string, salt: string): Promise<string | null> {
  if (!ip || !salt) return null;
  try {
    const data = new TextEncoder().encode(`${ip}|${salt}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (_e) {
    return null;
  }
}

// @ts-ignore Deno グローバル
Deno.serve(async (req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405, req);

  // payload サイズの早期上限（2KB）。
  const lenHeader = req.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > 2048) {
    return jsonResponse({ error: "payload too large" }, 413, req);
  }

  let payload: any = {};
  try {
    payload = await req.json();
  } catch (_e) {
    return jsonResponse({ error: "invalid json" }, 400, req);
  }

  // Training は早期に 400（分析対象外）。
  if (payload && payload.mode === "training") {
    return jsonResponse({ error: "training is not analyzed" }, 400, req);
  }

  // Replay / ゴースト由来の提出は分析対象外。generic な検証(422)より前に、明示的なコード付き 400 で弾く。
  //   （Endless / TimeAttack / Hardcore の通常ペイロードはこれらの識別子を持たないため通常検証へ進む。）
  if (
    payload && (
      payload.mode === "replay" ||
      "replay" in payload ||
      "ghost" in payload ||
      "run_id" in payload
    )
  ) {
    return jsonResponse(
      { error: "replay is not analyzed", code: "analytics_not_allowed_for_replay" },
      400,
      req,
    );
  }

  // 入力検証（異常値・個人情報項目の混入・列挙値）。失敗は 422。
  const v = validateAnalyticsPayload(payload);
  if (!v.ok) return jsonResponse({ error: "validation failed", details: v.errors }, 422, req);
  const cleaned = v.cleaned!;

  // @ts-ignore
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  // @ts-ignore service_role はここだけ（フロントには存在しない）
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // @ts-ignore レート制限用ソルト（生 IP は保存しない）
  const ipSalt = Deno.env.get("RATE_LIMIT_IP_SALT") || "";
  const admin = createClient(supabaseUrl, serviceKey);

  const now = Date.now();
  const ipHash = await hashIp(clientIp(req), ipSalt);

  // レート制限：同一 ip_hash の直近 60 秒の件数で判定（生 IP は保存しない）。
  if (ipHash) {
    const sinceIso = new Date(now - 60000).toISOString();
    const { data: recent, error: rlErr } = await admin
      .from("gameplay_analytics")
      .select("created_at")
      .eq("ip_hash", ipHash)
      .gte("created_at", sinceIso);
    // フェイルクローズ: レート制限の判定に失敗したら INSERT せず 503 を返す（過剰受け入れを防ぐ）。
    //   詳細・秘密はログ/応答に出さない。クライアントは 5xx でゲームを継続し、再送キューには積まない。
    if (rlErr) {
      return jsonResponse({ error: "rate limit check unavailable" }, 503, req, { "Retry-After": "60" });
    }
    const stamps = (recent || []).map((r: any) => Date.parse(r.created_at));
    if (isAnalyticsRateLimited(stamps, now, 60000, 20)) {
      return jsonResponse({ error: "rate limited" }, 429, req, { "Retry-After": "60" });
    }
  }

  // 登録（event_id 一意制約で重複は 23505 → 409）。created_at は DB 既定値。
  const { error: insErr } = await admin
    .from("gameplay_analytics")
    .insert({ ...cleaned, ip_hash: ipHash });

  if (insErr) {
    // 重複 event_id は 409。それ以外は 500（詳細・秘密はログ/応答に出さない）。
    if ((insErr as any).code === "23505") {
      return jsonResponse({ error: "duplicate event_id" }, 409, req);
    }
    return jsonResponse({ error: "insert failed" }, 500, req);
  }

  return jsonResponse({ ok: true }, 200, req);
});
