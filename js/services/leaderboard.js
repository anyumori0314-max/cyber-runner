// ===================================
// services/leaderboard.js — グローバルランキングの通信とランキング状態（Stage 1）
//
// 責務: Supabase との通信（取得 / 送信）と、ランキング送信状態の管理。
// DOM 描画・ボタン表示は View（script.js 側）に残し、View コールバックを
// configureLeaderboard() で注入して使う（= 通信と DOM の境界）。
//
// publishable key は公開前提。service_role key は使用しない。RLS 前提。
// ===================================
import {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    LEADERBOARD_TABLE,
    LEADERBOARD_LIMIT,
    PLAYER_NAME_MAX_LENGTH,
    DEFAULT_PLAYER_NAME,
    MAX_SCORE,
    MAX_COMBO,
    VALID_RANKS
} from '../config.js';

// ランキング送信／読み込みの状態（単一の真実の源）
export const leaderboardState = {
    isSubmitting: false,
    hasSubmitted: false,
    lastScore: 0,
    lastMaxCombo: 0,
    lastRank: 'D'
};

// View コールバック（通信と DOM の境界）。script.js から configureLeaderboard で注入する。
let view = {
    render: () => {},
    renderUnavailable: () => {},
    setStatus: () => {},
    updateButton: () => {},
    getRawName: () => ''
};

export function configureLeaderboard(callbacks) {
    view = { ...view, ...callbacks };
}

// 送信対象データをセットする（送信フラグをリセットしつつ確定値を保持）。
export function prepareSubmission({ score, maxCombo, rank }) {
    leaderboardState.isSubmitting = false;
    leaderboardState.hasSubmitted = false;
    leaderboardState.lastScore = score;
    leaderboardState.lastMaxCombo = maxCombo;
    leaderboardState.lastRank = rank;
}

// 送信フラグのみリセット（RETRY などで使用）。
export function resetLeaderboardSubmission() {
    leaderboardState.isSubmitting = false;
    leaderboardState.hasSubmitted = false;
}

// プレイヤー名の正規化・検証：trim → 空なら ANONYMOUS → 最大文字数で切り詰め。
export function normalizePlayerName(rawName) {
    const name = (rawName || '').trim();
    return (name || DEFAULT_PLAYER_NAME).slice(0, PLAYER_NAME_MAX_LENGTH);
}

// 送信用データの検証：数値・範囲・ランクを安全側に丸めた payload を生成する。
function buildSubmissionPayload() {
    const rawScore = Number(leaderboardState.lastScore);
    const rawCombo = Number(leaderboardState.lastMaxCombo);
    const rank = leaderboardState.lastRank;

    const safeScore = Number.isFinite(rawScore)
        ? Math.min(Math.max(Math.floor(rawScore), 0), MAX_SCORE)
        : 0;
    const safeCombo = Number.isFinite(rawCombo)
        ? Math.min(Math.max(Math.floor(rawCombo), 0), MAX_COMBO)
        : 0;
    const safeRank = VALID_RANKS.includes(rank) ? rank : 'D';

    return {
        player_name: normalizePlayerName(view.getRawName()),
        score: safeScore,
        max_combo: safeCombo,
        rank: safeRank
    };
}

// Supabase 用 HTTP ヘッダー（publishable key）。
function getSupabaseHeaders() {
    return {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
    };
}

// スコア INSERT。
async function insertLeaderboardScore() {
    const payload = buildSubmissionPayload();
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${LEADERBOARD_TABLE}`, {
        method: 'POST',
        headers: {
            ...getSupabaseHeaders(),
            Prefer: 'return=minimal'
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error(`Insert failed: ${response.status}`);
    }
}

// 上位ランキング取得。
async function fetchLeaderboardScores() {
    const query = `select=player_name,score,max_combo,rank&order=score.desc,max_combo.desc,created_at.asc&limit=${LEADERBOARD_LIMIT}`;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${LEADERBOARD_TABLE}?${query}`, {
        method: 'GET',
        headers: getSupabaseHeaders(),
        cache: 'no-store'
    });
    if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status}`);
    }
    return response.json();
}

// ランキング読み込み（取得 → View 描画）。失敗してもゲームは継続できる。
export async function loadLeaderboard() {
    try {
        const scores = await fetchLeaderboardScores();
        view.render(scores);
        if (!leaderboardState.hasSubmitted && !leaderboardState.isSubmitting) {
            view.setStatus('');
        }
    } catch (err) {
        console.warn('Leaderboard load failed:', err);
        view.renderUnavailable();
        view.setStatus('Leaderboard connection failed. You can still play.', true);
    }
}

// スコア送信（多重送信防止 → INSERT → 再読み込み）。
export async function handleSendScore() {
    if (leaderboardState.isSubmitting || leaderboardState.hasSubmitted) return;
    leaderboardState.isSubmitting = true;
    view.setStatus('Sending score...');
    view.updateButton();
    try {
        await insertLeaderboardScore();
        leaderboardState.hasSubmitted = true;
        view.setStatus('Score sent.');
        await loadLeaderboard();
    } catch (err) {
        console.warn('Leaderboard submit failed:', err);
        view.setStatus('Score send failed. Please try again later.', true);
    } finally {
        leaderboardState.isSubmitting = false;
        view.updateButton();
    }
}
