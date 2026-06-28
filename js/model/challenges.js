// ===================================
// model/challenges.js — デイリー/ウィークリーチャレンジ（Phase 9）
//
// 責務: 全ユーザー共通 seed から決定的にチャレンジを生成し、進捗・達成・報酬重複防止・
//   期間更新（日付/週変更）を管理する。報酬は XP / 外観解放 / 称号（ゲームスコアへは加点しない）。
//   pause 中・Training は進捗しない（呼び出し側 controller がプレイ完了時のみ applyRun する）。
//
// 時刻権威は services/challenge-service（サーバー or ローカル UTC フォールバック）。
// 依存方向: config（キー）/ util/storage（保存・読込）。DOM/通信に触れない。
// ===================================

import { CHALLENGES_STORAGE_KEY } from '../config.js';
import { loadJSON, saveJSON } from '../util/storage.js';

// チャレンジテンプレート（type が進捗の集計方法を決める）。
export const DAILY_TEMPLATES = [
    { id: 'd_survive60', type: 'survive_max', target: 60, label: '60秒生存する', rewardXp: 80 },
    { id: 'd_cores10', type: 'cores_sum', target: 10, label: 'コアを10個取得する', rewardXp: 80 },
    { id: 'd_nearmiss5', type: 'nearmiss_sum', target: 5, label: 'ニアミスを5回する', rewardXp: 80 },
    { id: 'd_nodash2000', type: 'score_nodash_max', target: 2000, label: 'ダッシュなしで2000点', rewardXp: 120 },
    { id: 'd_noshield_lv5', type: 'level_noshield_max', target: 5, label: 'シールドなしでLv5到達', rewardXp: 120 }
];
export const WEEKLY_TEMPLATES = [
    { id: 'w_score50k', type: 'score_sum', target: 50000, label: '累計5万点を稼ぐ', rewardXp: 200 },
    { id: 'w_cores100', type: 'cores_sum', target: 100, label: '累計コア100個', rewardXp: 200 },
    { id: 'w_srank3', type: 'srank_count', target: 3, label: 'Sランクを3回', rewardXp: 250 },
    { id: 'w_combo20', type: 'combo_max', target: 20, label: '20コンボを達成', rewardXp: 200 },
    { id: 'w_multimode', type: 'multimode_set', target: 3, label: '複数モードをプレイ(3)', rewardXp: 250 }
];
const DAILY_COUNT = 3;
const WEEKLY_COUNT = 2;

let state = { daily: null, weekly: null }; // 各: { key, source, items: [] }

// 決定的 PRNG（mulberry32）。seed が同じなら全ユーザーで同じ結果。
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// seed で決定的にテンプレートを n 個選ぶ（Fisher-Yates）。
export function pickTemplates(templates, seed, n) {
    const arr = templates.slice();
    const rnd = mulberry32(seed);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr.slice(0, Math.min(n, arr.length));
}

function instantiate(tmpl, scope) {
    return {
        id: tmpl.id,
        scope,
        type: tmpl.type,
        label: tmpl.label,
        target: tmpl.target,
        rewardXp: tmpl.rewardXp,
        progress: 0,
        completed: false,
        claimed: false,
        modesSeen: []
    };
}

function buildSet(scope, key, seed, source) {
    const templates = scope === 'daily' ? DAILY_TEMPLATES : WEEKLY_TEMPLATES;
    const count = scope === 'daily' ? DAILY_COUNT : WEEKLY_COUNT;
    const picked = pickTemplates(templates, seed >>> 0, count);
    return { key, source: source || 'local', items: picked.map((t) => instantiate(t, scope)) };
}

// 保存データの軽い検証（壊れていれば null にして再生成させる）。
function sanitizeSet(raw, scope) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items) || typeof raw.key !== 'string') return null;
    const items = [];
    for (const it of raw.items) {
        if (!it || typeof it.id !== 'string') continue;
        items.push({
            id: it.id,
            scope,
            type: String(it.type || ''),
            label: String(it.label || ''),
            target: Number(it.target) || 0,
            rewardXp: Number(it.rewardXp) || 0,
            progress: Number.isFinite(Number(it.progress)) ? Number(it.progress) : 0,
            completed: it.completed === true,
            claimed: it.claimed === true,
            modesSeen: Array.isArray(it.modesSeen) ? it.modesSeen.filter((m) => typeof m === 'string') : []
        });
    }
    return { key: raw.key, source: raw.source === 'server' ? 'server' : 'local', items };
}

export function loadChallenges() {
    const raw = loadJSON(CHALLENGES_STORAGE_KEY, null);
    state.daily = raw ? sanitizeSet(raw.daily, 'daily') : null;
    state.weekly = raw ? sanitizeSet(raw.weekly, 'weekly') : null;
}

function persist() {
    saveJSON(CHALLENGES_STORAGE_KEY, state);
}

// 時刻情報でチャレンジを更新する。期間（key）が変わったら新規生成（進捗リセット）。
//   info = { source, utc_date, iso_week, daily_seed, weekly_seed }
export function refreshChallenges(info) {
    if (!info) return getChallengesView();
    if (!state.daily || state.daily.key !== info.utc_date) {
        state.daily = buildSet('daily', info.utc_date, info.daily_seed, info.source);
    } else {
        state.daily.source = info.source; // key 同一なら進捗を保持し source のみ更新
    }
    if (!state.weekly || state.weekly.key !== info.iso_week) {
        state.weekly = buildSet('weekly', info.iso_week, info.weekly_seed, info.source);
    } else {
        state.weekly.source = info.source;
    }
    persist();
    return getChallengesView();
}

function updateProgress(ch, run) {
    switch (ch.type) {
        case 'survive_max': ch.progress = Math.max(ch.progress, Math.floor(run.survivalTime || 0)); break;
        case 'cores_sum': ch.progress += Math.max(0, Math.floor(run.coreCount || 0)); break;
        case 'nearmiss_sum': ch.progress += Math.max(0, Math.floor(run.nearMissCount || 0)); break;
        case 'score_nodash_max': if ((run.dashCount || 0) === 0) ch.progress = Math.max(ch.progress, Math.floor(run.score || 0)); break;
        case 'level_noshield_max': if (!run.shieldUsed) ch.progress = Math.max(ch.progress, Math.floor(run.reachedLevel || 0)); break;
        case 'score_sum': ch.progress += Math.max(0, Math.floor(run.score || 0)); break;
        case 'combo_max': ch.progress = Math.max(ch.progress, Math.floor(run.maxCombo || 0)); break;
        case 'srank_count': if (run.rank === 'S') ch.progress += 1; break;
        case 'multimode_set':
            if (run.mode && !ch.modesSeen.includes(run.mode)) ch.modesSeen.push(run.mode);
            ch.progress = ch.modesSeen.length;
            break;
        default: break;
    }
    if (ch.progress >= ch.target) ch.completed = true;
}

// 1プレイの結果を全アクティブチャレンジへ反映。報酬は1回だけ（claimed で重複防止）。
//   戻り値: { xp, newly: [{id,label,rewardXp}] }
export function applyRun(run = {}) {
    let xp = 0;
    const newly = [];
    for (const scope of ['daily', 'weekly']) {
        const set = state[scope];
        if (!set) continue;
        for (const ch of set.items) {
            updateProgress(ch, run);
            if (ch.completed && !ch.claimed) {
                ch.claimed = true; // 報酬の重複取得防止
                xp += ch.rewardXp;
                newly.push({ id: ch.id, label: ch.label, rewardXp: ch.rewardXp });
            }
        }
    }
    persist();
    return { xp, newly };
}

// 完了したチャレンジ id のマップ（外観のチャレンジ解放条件用）。
export function getCompletedMap() {
    const map = {};
    for (const scope of ['daily', 'weekly']) {
        const set = state[scope];
        if (!set) continue;
        for (const ch of set.items) if (ch.completed) map[ch.id] = true;
    }
    return map;
}

export function isFallback() {
    return (state.daily && state.daily.source === 'local') || (state.weekly && state.weekly.source === 'local') || false;
}

export function getChallengesView() {
    const view = (set) => (set
        ? { key: set.key, source: set.source, items: set.items.map((c) => ({ ...c, modesSeen: undefined })) }
        : null);
    return { daily: view(state.daily), weekly: view(state.weekly), fallback: isFallback() };
}
