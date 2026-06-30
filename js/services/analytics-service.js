// ===================================
// services/analytics-service.js — 匿名分析の送信（Phase 13）
//
// 責務: submit-analytics Edge Function へ「1 プレイ 1 件」を送る。送信条件は
//   「設定済み（endpoint あり）＋オンライン＋未送信 event_id」。失敗しても再送せず、throw もしない
//   （ゲームへ一切影響させない）。毎フレーム送信はしない（呼び出しは run 完了時のみ）。
//
// 重要: 同意判定とモード判定（Training/Replay 除外）は呼び出し側（main）が行う。
//   ここは「ネットワーク送信」に限定する。DOM/Canvas には触れない。
//
// 依存方向: config（エンドポイント・anon key）。
// ===================================

import { EDGE_FUNCTIONS_BASE, SUPABASE_ANON_KEY } from '../config.js';

let endpointBase = EDGE_FUNCTIONS_BASE;
const sentEventIds = new Set(); // セッション内の二重送信防止

export function configureAnalyticsService(opts = {}) {
    if (typeof opts.endpointBase === 'string') endpointBase = opts.endpointBase;
}

export function isAnalyticsConfigured() {
    return typeof endpointBase === 'string' && endpointBase.length > 0;
}

function online() {
    try {
        return navigator.onLine !== false;
    } catch (_e) {
        return true;
    }
}

// 分析を送信する。戻り値で結果/スキップ理由を返す（呼び出し側は無視してよい）。
//   失敗時も event_id は送信済み扱いにして「無断再送」を防ぐ。
export async function submitAnalytics(payload) {
    if (!isAnalyticsConfigured()) return { ok: false, skipped: 'unconfigured' };
    if (!online()) return { ok: false, skipped: 'offline' };
    if (!payload || typeof payload.event_id !== 'string') return { ok: false, skipped: 'no-event-id' };
    if (sentEventIds.has(payload.event_id)) return { ok: false, skipped: 'duplicate' };
    sentEventIds.add(payload.event_id); // 先にマーク＝失敗しても再送しない

    try {
        const res = await fetch(`${endpointBase}/submit-analytics`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        if (!res.ok) return { ok: false, status: res.status };
        return { ok: true };
    } catch (err) {
        console.warn('submit-analytics failed:', err);
        return { ok: false, error: String(err) };
    }
}
