// ===================================
// supabase/functions/_shared/cors-util.js
//   CORS の origin 許可判定（純粋関数）。Deno（cors.ts）と Node（verify.mjs）の双方から
//   import 可能。外部依存・ランタイム API 不使用。
//
//   方針（Low 指摘対応）:
//     * 許可 origin は環境変数 ALLOWED_ORIGINS（カンマ区切り）から取得する。
//     * リクエスト Origin が許可リストに含まれる場合のみ、その Origin をそのまま返す。
//     * ワイルドカード "*" は使わない（credentials との危険な組み合わせを避ける）。
//     * Origin 無し（サーバー間通信等）はブラウザ CORS の対象外 → null を返す
//       （= ACAO ヘッダーを付けない。ブラウザ以外のクライアントには CORS は適用されない）。
// ===================================

// "a, b ,," → ['a','b']（空白除去・空要素除去・重複除去）。
export function parseAllowedOrigins(envStr) {
    if (typeof envStr !== 'string' || envStr.length === 0) return [];
    const seen = new Set();
    for (const part of envStr.split(',')) {
        const o = part.trim();
        if (o) seen.add(o);
    }
    return [...seen];
}

// 許可された場合のみ「返すべき Access-Control-Allow-Origin の値」を返す。未許可は null。
export function resolveAllowedOrigin(requestOrigin, allowedList) {
    if (typeof requestOrigin !== 'string' || requestOrigin.length === 0) return null; // Origin 無し
    const list = Array.isArray(allowedList) ? allowedList : [];
    return list.includes(requestOrigin) ? requestOrigin : null;
}

// 応答に付与する CORS ヘッダー一式を組み立てる。
//   allowOrigin が null（未許可 / Origin 無し）の場合は ACAO を付けない。
//   Vary: Origin は常に付与（許可リストが Origin により変わるため）。
export function buildCorsHeaders(allowOrigin) {
    const headers = {
        Vary: 'Origin',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
    };
    if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
    return headers;
}
