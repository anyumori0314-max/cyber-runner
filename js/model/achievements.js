// ===================================
// model/achievements.js — 実績と累計統計（Phase 5）
//
// 責務: 実績の定義・解除状態と累計統計の保持/検証/永続化。重複解除しない。
//   JSON 破損・localStorage 例外時は初期値で継続（util/storage が保護）。
//
// 依存方向: config（キー）/ util/storage（安全な保存・読込）。DOM/通信に触れない。
//   解除通知の表示は view、解除タイミングの呼び出しは controller。
// ===================================

import { ACHIEVEMENTS_STORAGE_KEY, STATS_STORAGE_KEY } from '../config.js';
import { loadJSON, saveJSON } from '../util/storage.js';

export const ACHIEVEMENTS = [
    { id: 'first_run', name: 'FIRST RUN', desc: '初めてプレイする' },
    { id: 'core_hunter', name: 'CORE HUNTER', desc: '累計100個のコアを取得する' },
    { id: 'combo_master', name: 'COMBO MASTER', desc: '20コンボを達成する' },
    { id: 'survivor', name: 'SURVIVOR', desc: '60秒生存する' },
    { id: 'cyber_legend', name: 'CYBER LEGEND', desc: 'Sランクを達成する' },
    { id: 'dash_master', name: 'DASH MASTER', desc: '1プレイでダッシュを10回使う' },
    { id: 'near_miss_pro', name: 'NEAR MISS PRO', desc: '累計50回ニアミスする' }
];

const DEFAULT_STATS = { runs: 0, totalCores: 0, totalNearMiss: 0 };

let unlocked = {}; // { id: true }
let stats = { ...DEFAULT_STATS };

function sanitizeUnlocked(raw) {
    const out = {};
    if (raw && typeof raw === 'object') {
        for (const a of ACHIEVEMENTS) {
            if (raw[a.id] === true) out[a.id] = true;
        }
    }
    return out;
}

function sanitizeStats(raw) {
    const s = { ...DEFAULT_STATS };
    if (raw && typeof raw === 'object') {
        for (const k of Object.keys(DEFAULT_STATS)) {
            const v = Number(raw[k]);
            if (Number.isFinite(v) && v >= 0) s[k] = Math.floor(v);
        }
    }
    return s;
}

// localStorage から実績・統計を読み込む（破損・例外時は初期値）。
export function loadAchievements() {
    unlocked = sanitizeUnlocked(loadJSON(ACHIEVEMENTS_STORAGE_KEY, {}));
    stats = sanitizeStats(loadJSON(STATS_STORAGE_KEY, DEFAULT_STATS));
}

export function getStats() { return { ...stats }; }
export function getUnlockedMap() { return { ...unlocked }; }
export function isUnlocked(id) { return unlocked[id] === true; }
export function getAchievementsView() {
    return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: unlocked[a.id] === true }));
}

function findById(id) {
    return ACHIEVEMENTS.find((a) => a.id === id) || null;
}

// 実績を1件解除（既に解除済みなら何もしない＝重複解除しない）。新規なら定義を返す。
function unlock(id) {
    if (unlocked[id]) return null;
    unlocked[id] = true;
    saveJSON(ACHIEVEMENTS_STORAGE_KEY, unlocked);
    return findById(id);
}

// 1プレイ終了時：統計を加算保存し、達成した実績を解除する。
// run = { cores, nearMiss, maxCombo, survivalTime, rank, dashCount }
// 新規解除した実績の定義配列を返す（通知用）。
export function recordRunAndUnlock(run = {}) {
    stats.runs += 1;
    stats.totalCores += Math.max(0, Math.floor(run.cores || 0));
    stats.totalNearMiss += Math.max(0, Math.floor(run.nearMiss || 0));
    saveJSON(STATS_STORAGE_KEY, stats);

    const newly = [];
    const tryUnlock = (id, cond) => {
        if (cond) {
            const def = unlock(id);
            if (def) newly.push(def);
        }
    };
    tryUnlock('first_run', stats.runs >= 1);
    tryUnlock('core_hunter', stats.totalCores >= 100);
    tryUnlock('combo_master', (run.maxCombo || 0) >= 20);
    tryUnlock('survivor', (run.survivalTime || 0) >= 60);
    tryUnlock('cyber_legend', run.rank === 'S');
    tryUnlock('dash_master', (run.dashCount || 0) >= 10);
    tryUnlock('near_miss_pro', stats.totalNearMiss >= 50);
    return newly;
}
