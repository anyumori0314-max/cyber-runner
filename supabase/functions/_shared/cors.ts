// ===================================
// supabase/functions/_shared/cors.ts
//   Edge Function 共通の CORS（origin 許可リスト方式）とプリフライト応答。
//   （サーバー側 Deno コード。フロントエンドの外部 CDN ではない。）
//
//   許可 origin は環境変数 ALLOWED_ORIGINS（カンマ区切り）から取得する。
//   例: ALLOWED_ORIGINS="https://anyumori0314-max.github.io,http://localhost:8127"
//   未設定時は「ブラウザからは誰も許可されない（= ACAO を返さない）」安全側に倒す。
//   ワイルドカード "*" は使用しない。判定ロジックは _shared/cors-util.js（Node と共有）。
// ===================================

import {
  parseAllowedOrigins,
  resolveAllowedOrigin,
  buildCorsHeaders,
} from "./cors-util.js";

// @ts-ignore Deno グローバル（Node では実行しない）
function allowedOrigins(): string[] {
  // @ts-ignore
  const env = typeof Deno !== "undefined" ? Deno.env.get("ALLOWED_ORIGINS") : "";
  return parseAllowedOrigins(env || "");
}

// リクエストの Origin を許可リストと突き合わせ、応答用 CORS ヘッダーを返す。
export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allow = resolveAllowedOrigin(origin, allowedOrigins());
  return buildCorsHeaders(allow) as Record<string, string>;
}

// OPTIONS プリフライト。許可/未許可いずれも 204 を返すが、許可時のみ ACAO を含む。
export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeadersFor(req) });
  }
  return null;
}

// JSON レスポンス（CORS ヘッダーをリクエスト origin に応じて付与）。
//   extra: 追加ヘッダー（例: 429 の Retry-After）。
export function jsonResponse(
  body: unknown,
  status = 200,
  req?: Request,
  extra?: Record<string, string>,
): Response {
  const cors = req ? corsHeadersFor(req) : { Vary: "Origin" };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", ...(extra || {}) },
  });
}
