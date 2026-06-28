// ===================================
// services/run-service.js — サーバー権威 run のライフサイクルとスコア送信（Phase 6）
//
// 責務: プレイ開始時に start-run Edge Function を呼び run を取得し、終了時に
//   submit-score Edge Function 経由でスコアを送る。Edge Function 未配備/失敗時は
//   ローカルフォールバック run で「ゲーム本体は継続」し、送信は「安全に不可」を返す。
//
// 重要: leaderboard_scores への直接 INSERT は一切行わない（送信は Edge Function のみ）。
//   service_role key はクライアントに存在しない（publishable key のみ）。
//
// 依存方向: config（エンドポイント・版数）/ util/storage（匿名 ID 永続化）。DOM に触れない。
// ===================================

import {
    EDGE_FUNCTIONS_BASE,
    GAME_VERSION,
    ANON_ID_STORAGE_KEY,
    RUN_LOCAL_EXPIRY_MS,
    SUPABASE_ANON_KEY
} from '../config.js';
import { loadString, saveString } from '../util/storage.js';

let endpointBase = EDGE_FUNCTIONS_BASE;
let gameVersion = GAME_VERSION;

let currentRunPromise = null; // Promise<run> | null
let currentRun = null; // 解決済み run（同期参照用）

export function configureRunService(opts = {}) {
    if (typeof opts.endpointBase === 'string') endpointBase = opts.endpointBase;
    if (typeof opts.gameVersion === 'string') gameVersion = opts.gameVersion;
}

export function isOnlineConfigured() {
    return typeof endpointBase === 'string' && endpointBase.length > 0;
}

// ランダム ID（crypto があれば UUID、無ければ十分にユニークな文字列）。
function randomId() {
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (_e) { /* fallthrough */ }
    return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// 端末ごとの匿名 ID（永続）。個人情報は含めない。
export function getAnonId() {
    let id = loadString(ANON_ID_STORAGE_KEY, '');
    if (!id) {
        id = randomId();
        saveString(ANON_ID_STORAGE_KEY, id);
    }
    return id;
}

// ローカルフォールバック run（Edge Function 未配備/失敗時。ゲームは継続できる）。
function localRun(mode) {
    const now = Date.now();
    return {
        run_id: randomId(),
        server_started_at: new Date(now).toISOString(),
        mode,
        expires_at: new Date(now + RUN_LOCAL_EXPIRY_MS).toISOString(),
        source: 'local',
        clientStartedAt: now
    };
}

// プレイ開始時に呼ぶ。run を確定（または取得を開始）する。await 不要（getCurrentRun で受け取る）。
export function startRun(mode) {
    const clientStartedAt = Date.now();
    currentRun = null;
    if (!isOnlineConfigured()) {
        currentRun = localRun(mode);
        currentRunPromise = Promise.resolve(currentRun);
        return currentRunPromise;
    }
    currentRunPromise = (async () => {
        try {
            const res = await fetch(`${endpointBase}/start-run`, {
                method: 'POST',
                headers: {
                    apikey: SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ mode, anonymous_player_id: getAnonId() })
            });
            if (!res.ok) throw new Error(`start-run ${res.status}`);
            const data = await res.json();
            currentRun = { ...data, source: 'server', clientStartedAt };
        } catch (err) {
            console.warn('start-run failed, using local run:', err);
            currentRun = { ...localRun(mode), clientStartedAt };
        }
        return currentRun;
    })();
    return currentRunPromise;
}

// 現在の run を取得（開始処理の完了を待つ）。未開始なら null。
export async function getCurrentRun() {
    if (!currentRunPromise) return null;
    return currentRunPromise;
}

export function getCurrentRunSync() {
    return currentRun;
}

export function clearRun() {
    currentRun = null;
    currentRunPromise = null;
}

// スコア送信（submit-score Edge Function のみ）。返り値で UI 表示を分岐する。
//   payload = { runId, playerName, mode, score, maxCombo, durationMs, rank, metrics }
//   戻り値: { ok, unavailable?, status?, error? }
export async function submitScore(payload) {
    if (!isOnlineConfigured()) {
        return { ok: false, unavailable: true };
    }
    const body = {
        run_id: payload.runId,
        anonymous_player_id: getAnonId(),
        player_name: payload.playerName,
        mode: payload.mode,
        score: payload.score,
        max_combo: payload.maxCombo,
        duration_ms: payload.durationMs,
        rank: payload.rank,
        game_version: gameVersion,
        metrics: payload.metrics
    };
    try {
        const res = await fetch(`${endpointBase}/submit-score`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            return { ok: false, status: res.status, error: `submit-score ${res.status}` };
        }
        return { ok: true };
    } catch (err) {
        console.warn('submit-score failed:', err);
        return { ok: false, error: String(err) };
    }
}
