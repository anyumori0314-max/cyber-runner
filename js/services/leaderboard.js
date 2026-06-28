// ===================================
// services/leaderboard.js — ランキングの取得と送信オーケストレーション（Phase 1 → Phase 6）
//
// 責務: ランキングの GET（公開 SELECT）と、スコア送信の取りまとめ。
//   Phase 6 以降、leaderboard_scores への直接 INSERT は行わない。送信は
//   run-service.submitScore()（= submit-score Edge Function）経由のみ。
//   Edge Function 未配備時は「安全なメッセージ」を表示し、ゲーム本体は継続できる。
//
// DOM 描画・ボタン表示は View に残し、View コールバックを configureLeaderboard() で注入する。
// publishable key は公開前提。service_role key は使用しない（フロントに存在しない）。
// ===================================
import {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    LEADERBOARD_TABLE,
    LEADERBOARD_LIMIT,
    TITLE_LEADERBOARD_LIMIT,
    LEADERBOARD_CACHE_KEY,
    LEADERBOARD_CACHE_MAX_AGE_MS
} from '../config.js';
import { submitScore, getCurrentRun } from './run-service.js';
import { loadJSON, saveJSON } from '../util/storage.js';

// ランキング送信／読み込みの状態（単一の真実の源）
export const leaderboardState = {
    isSubmitting: false,
    hasSubmitted: false,
    lastScore: 0,
    lastMaxCombo: 0,
    lastRank: 'D',
    // Phase 6: 送信に必要な拡張データ
    mode: 'endless',
    durationMs: 0,
    runId: null,
    metrics: null
};

// 表示フィルタ（期間・モード）。UI から切り替える。
const filter = { period: 'overall', mode: 'all' };

let view = {
    render: () => {},
    renderUnavailable: () => {},
    setStatus: () => {},
    updateButton: () => {},
    getRawName: () => '',
    renderTitle: () => {},
    renderTitleUnavailable: () => {},
    setTitleStatus: () => {}
};

let loadInFlight = false;
let titleLoadInFlight = false;

export function configureLeaderboard(callbacks) {
    view = { ...view, ...callbacks };
}

export function getLeaderboardFilter() {
    return { ...filter };
}
export function setLeaderboardFilter(next = {}) {
    if (typeof next.period === 'string') filter.period = next.period;
    if (typeof next.mode === 'string') filter.mode = next.mode;
}

// 送信対象データをセットする（Phase 6: mode/duration/metrics/runId も保持）。
export function prepareSubmission({ score, maxCombo, rank, mode = 'endless', durationMs = 0, metrics = null, runId = null }) {
    leaderboardState.isSubmitting = false;
    leaderboardState.hasSubmitted = false;
    leaderboardState.lastScore = score;
    leaderboardState.lastMaxCombo = maxCombo;
    leaderboardState.lastRank = rank;
    leaderboardState.mode = mode;
    leaderboardState.durationMs = durationMs;
    leaderboardState.metrics = metrics;
    leaderboardState.runId = runId;
}

export function resetLeaderboardSubmission() {
    leaderboardState.isSubmitting = false;
    leaderboardState.hasSubmitted = false;
}

// ===================================
// クエリ構築（純粋関数：Node でテスト可能）
//   並び順は従来どおり score desc, max_combo desc, created_at asc。
//   period: overall（無条件）/ daily（当日UTC以降）/ weekly（今週月曜UTC以降）。
//   mode: 'all' なら絞らない。それ以外は mode=eq.<mode>。
// ===================================
function utcDayString(now) {
    return now.toISOString().slice(0, 10);
}
function utcWeekStartString(now) {
    const day = (now.getUTCDay() + 6) % 7; // 月曜=0
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
    return monday.toISOString().slice(0, 10);
}

export function buildLeaderboardQuery({ period = 'overall', mode = 'all', limit = LEADERBOARD_LIMIT, now = new Date() } = {}) {
    // select は既存スキーマ互換の4列のみ（mode 列は migration 後にのみ存在するため含めない）。
    // overall + all のときは Phase 1-5 と完全に同一のクエリになり、GET 表示に回帰がない。
    const params = ['select=player_name,score,max_combo,rank'];
    if (period === 'daily') params.push(`created_at=gte.${utcDayString(now)}`);
    else if (period === 'weekly') params.push(`created_at=gte.${utcWeekStartString(now)}`);
    if (mode && mode !== 'all') params.push(`mode=eq.${mode}`);
    params.push('order=score.desc,max_combo.desc,created_at.asc');
    params.push(`limit=${limit}`);
    return params.join('&');
}

// 自分の順位を概算するためのカウントクエリ（自分より上のスコア件数 + 1）。
export function buildRankCountQuery({ score, period = 'overall', mode = 'all', now = new Date() } = {}) {
    const params = ['select=id', `score=gt.${Math.floor(Number(score) || 0)}`];
    if (period === 'daily') params.push(`created_at=gte.${utcDayString(now)}`);
    else if (period === 'weekly') params.push(`created_at=gte.${utcWeekStartString(now)}`);
    if (mode && mode !== 'all') params.push(`mode=eq.${mode}`);
    return params.join('&');
}

function getSupabaseHeaders() {
    return {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
    };
}

async function fetchScores(query) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${LEADERBOARD_TABLE}?${query}`, {
        method: 'GET',
        headers: getSupabaseHeaders(),
        cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    return response.json();
}

// ===================================
// GET 失敗時のフォールバック用キャッシュ（Medium 3）
//   * 正常取得した結果のみ localStorage に保存（保存日時付き）。
//   * 失敗時はキャッシュを表示。キャッシュが無ければ空表示（架空データは作らない）。
//   * storage.js が throw しないため、ゲーム本体には一切影響しない。
// ===================================
function cacheKey(period, mode) {
    return `${period || 'overall'}:${mode || 'all'}`;
}
export function cacheLeaderboard(period, mode, scores) {
    if (!Array.isArray(scores)) return;
    const all = loadJSON(LEADERBOARD_CACHE_KEY, {});
    all[cacheKey(period, mode)] = { savedAt: Date.now(), scores };
    saveJSON(LEADERBOARD_CACHE_KEY, all);
}
export function readCachedLeaderboard(period, mode) {
    const all = loadJSON(LEADERBOARD_CACHE_KEY, {});
    const entry = all && all[cacheKey(period, mode)];
    if (entry && Array.isArray(entry.scores)) return entry;
    return null;
}
// 保存日時を「鮮度」付きの短い表記にする（古すぎる場合は『過去のデータ』扱い）。
export function describeCacheAge(savedAt, now = Date.now()) {
    const ts = Number(savedAt);
    if (!Number.isFinite(ts)) return 'saved data';
    const ageMs = now - ts;
    try {
        if (ageMs > LEADERBOARD_CACHE_MAX_AGE_MS) {
            return `old data (${new Date(ts).toLocaleDateString()})`;
        }
        return `saved ${new Date(ts).toLocaleTimeString()}`;
    } catch (_e) {
        return 'saved data';
    }
}
// 失敗時の共通フォールバック：キャッシュがあれば表示、無ければ空表示。throw しない。
function renderLeaderboardFallback(period, mode) {
    const cached = readCachedLeaderboard(period, mode);
    if (cached && cached.scores.length > 0) {
        view.render(cached.scores);
        view.setStatus(`Live update failed — showing ${describeCacheAge(cached.savedAt)}.`, true);
    } else {
        view.renderUnavailable(); // 空表示（"No scores yet" 等）
        view.setStatus('Could not load the leaderboard. You can still play.', true);
    }
}

// GAME OVER のランキング読み込み（現在のフィルタを使用）。失敗してもゲームは継続。
export async function loadLeaderboard() {
    if (loadInFlight) return;
    loadInFlight = true;
    try {
        const query = buildLeaderboardQuery({ period: filter.period, mode: filter.mode, limit: LEADERBOARD_LIMIT });
        const scores = await fetchScores(query);
        view.render(scores);
        cacheLeaderboard(filter.period, filter.mode, scores); // 正常取得のみキャッシュ
        if (!leaderboardState.hasSubmitted && !leaderboardState.isSubmitting) {
            view.setStatus('');
        }
    } catch (err) {
        console.warn('Leaderboard load failed:', err);
        renderLeaderboardFallback(filter.period, filter.mode); // キャッシュ表示 or 空表示（throw しない）
    } finally {
        loadInFlight = false;
    }
}

// タイトル画面の GLOBAL TOP 5（総合）。
export async function loadTitleLeaderboard() {
    if (titleLoadInFlight) return;
    titleLoadInFlight = true;
    view.setTitleStatus('Loading...');
    try {
        const query = buildLeaderboardQuery({ period: 'overall', mode: 'all', limit: TITLE_LEADERBOARD_LIMIT });
        const scores = await fetchScores(query);
        view.renderTitle(scores);
        cacheLeaderboard('title', 'all', scores); // タイトル用は別キーで保存
        view.setTitleStatus('');
    } catch (err) {
        console.warn('Title leaderboard load failed:', err);
        const cached = readCachedLeaderboard('title', 'all');
        if (cached && cached.scores.length > 0) {
            view.renderTitle(cached.scores);
            view.setTitleStatus(`Live update failed — showing ${describeCacheAge(cached.savedAt)}.`, true);
        } else {
            view.renderTitleUnavailable(); // 空表示（架空データは作らない）
            view.setTitleStatus('Leaderboard unavailable. You can still play.', true);
        }
    } finally {
        titleLoadInFlight = false;
    }
}

// 自分の順位を概算取得（best-effort。失敗時は null）。
export async function fetchMyRank(score) {
    try {
        const query = buildRankCountQuery({ score, period: filter.period, mode: filter.mode });
        const response = await fetch(`${SUPABASE_URL}/rest/v1/${LEADERBOARD_TABLE}?${query}`, {
            method: 'HEAD',
            headers: { ...getSupabaseHeaders(), Prefer: 'count=exact' }
        });
        if (!response.ok) return null;
        const range = response.headers.get('content-range') || '';
        const total = Number(range.split('/')[1]);
        if (!Number.isFinite(total)) return null;
        return total + 1;
    } catch (err) {
        console.warn('rank query failed:', err);
        return null;
    }
}

// スコア送信（Phase 6: Edge Function 経由のみ・直接 INSERT しない）。
export async function handleSendScore() {
    if (leaderboardState.isSubmitting || leaderboardState.hasSubmitted) return;
    // Training はランキング対象外（UI でもボタンを出さないが二重防御）。
    if (leaderboardState.mode === 'training') {
        view.setStatus('Training scores are not ranked.');
        return;
    }
    leaderboardState.isSubmitting = true;
    view.setStatus('Sending score...');
    view.updateButton();
    try {
        const run = await getCurrentRun();
        const result = await submitScore({
            runId: (run && run.run_id) || leaderboardState.runId,
            playerName: (view.getRawName() || '').trim() || 'ANONYMOUS',
            mode: leaderboardState.mode,
            score: Math.floor(Number(leaderboardState.lastScore) || 0),
            maxCombo: Math.floor(Number(leaderboardState.lastMaxCombo) || 0),
            durationMs: Math.floor(Number(leaderboardState.durationMs) || 0),
            rank: leaderboardState.lastRank,
            metrics: leaderboardState.metrics
        });
        if (result.unavailable) {
            // Edge Function 未配備：安全に案内し、直接 INSERT はしない。
            view.setStatus('Online ranking is not enabled in this build.');
        } else if (result.ok) {
            leaderboardState.hasSubmitted = true;
            view.setStatus('Score sent.');
            await loadLeaderboard();
        } else {
            view.setStatus('Score send failed. Please try again later.', true);
        }
    } catch (err) {
        console.warn('Leaderboard submit failed:', err);
        view.setStatus('Score send failed. Please try again later.', true);
    } finally {
        leaderboardState.isSubmitting = false;
        view.updateButton();
    }
}
