// ===================================
// model/progression.js — プレイヤー成長（XP / レベル / 累計統計）（Phase 8）
//
// 責務: XP・プレイヤーレベル・累計統計・モード別ベストの保持/検証/永続化。
//   XP は「ゲームスコアとは別管理」。JSON 破損・localStorage 例外でも初期値で起動する。
//   Training では加算しない（呼び出し側 controller がガード）。
//
// 依存方向: config（キー・XP配分）/ util/storage（安全な保存・読込）。DOM/通信に触れない。
// ===================================

import {
    PROFILE_STORAGE_KEY,
    PROGRESS_STORAGE_KEY,
    XP_PER_RUN,
    XP_PER_SCORE,
    XP_PER_MISSION,
    XP_PER_ACHIEVEMENT
} from '../config.js';
import { loadJSON, saveJSON } from '../util/storage.js';

const DEFAULT_PROFILE = { xp: 0, level: 1 };
const DEFAULT_PROGRESS = {
    runs: 0,
    totalScore: 0,
    totalSurvival: 0,
    totalCores: 0,
    totalNearMiss: 0,
    longestSurvival: 0,
    bestByMode: { endless: 0, timeattack: 0, hardcore: 0 }
};
const RANKED_MODES = ['endless', 'timeattack', 'hardcore'];

let profile = { ...DEFAULT_PROFILE };
let progress = clone(DEFAULT_PROGRESS);

function clone(o) { return JSON.parse(JSON.stringify(o)); }
const safeNum = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);

// ===================================
// XP → レベル曲線（純粋関数：Node でテスト可能）
//   レベル L に到達するのに必要な累計 XP = 250 * (L-1) * L / 2。
//   L1=0, L2=250, L3=750, L4=1500, ...（上位ほど必要量が増える）。
// ===================================
export function totalXpForLevel(level) {
    const L = Math.max(1, Math.floor(level));
    return (250 * (L - 1) * L) / 2;
}
export function levelForXp(xp) {
    const x = Math.max(0, Number(xp) || 0);
    let level = 1;
    while (totalXpForLevel(level + 1) <= x) level++;
    return level;
}
// 現在レベル内の進捗 { level, into, need, nextLevelXp }。
export function levelProgress(xp) {
    const x = Math.max(0, Number(xp) || 0);
    const level = levelForXp(x);
    const base = totalXpForLevel(level);
    const next = totalXpForLevel(level + 1);
    return { level, into: x - base, need: next - base, nextLevelXp: next };
}

// 1プレイで得られる XP（純粋関数：テスト可能。ゲームスコアとは別）。
//   run = { score, missionCompleted, newlyAchievements, challengeXp }
export function computeRunXp(run = {}) {
    const score = Math.max(0, Number(run.score) || 0);
    let xp = XP_PER_RUN;
    xp += score * XP_PER_SCORE;
    if (run.missionCompleted) xp += XP_PER_MISSION;
    xp += Math.max(0, Math.floor(run.newlyAchievements || 0)) * XP_PER_ACHIEVEMENT;
    xp += Math.max(0, Math.floor(run.challengeXp || 0));
    return Math.floor(xp);
}

function sanitizeProfile(raw) {
    const p = { ...DEFAULT_PROFILE };
    if (raw && typeof raw === 'object') {
        p.xp = safeNum(raw.xp);
        p.level = levelForXp(p.xp); // level は xp から再計算（改ざん耐性）
    }
    return p;
}
function sanitizeProgress(raw) {
    const s = clone(DEFAULT_PROGRESS);
    if (raw && typeof raw === 'object') {
        for (const k of ['runs', 'totalScore', 'totalSurvival', 'totalCores', 'totalNearMiss', 'longestSurvival']) {
            s[k] = safeNum(raw[k]);
        }
        if (raw.bestByMode && typeof raw.bestByMode === 'object') {
            for (const m of RANKED_MODES) s.bestByMode[m] = safeNum(raw.bestByMode[m]);
        }
    }
    return s;
}

export function loadProgression() {
    profile = sanitizeProfile(loadJSON(PROFILE_STORAGE_KEY, DEFAULT_PROFILE));
    progress = sanitizeProgress(loadJSON(PROGRESS_STORAGE_KEY, DEFAULT_PROGRESS));
}

export function getProfile() { return { ...profile }; }
export function getProgress() { return clone(progress); }
export function getLevel() { return profile.level; }
export function getXp() { return profile.xp; }
export function getBestForMode(mode) { return progress.bestByMode[mode] || 0; }

// 1プレイの結果を反映し、XP/レベル/統計を更新・保存する。
//   run = { mode, score, survivalTime, coreCount, nearMissCount, missionCompleted, newlyAchievements, challengeXp }
//   戻り値: { xpGained, leveledUp, fromLevel, toLevel }
export function recordRun(run = {}) {
    const score = Math.max(0, Number(run.score) || 0);
    progress.runs += 1;
    progress.totalScore += score;
    progress.totalSurvival += Math.max(0, Number(run.survivalTime) || 0);
    progress.totalCores += Math.max(0, Math.floor(run.coreCount || 0));
    progress.totalNearMiss += Math.max(0, Math.floor(run.nearMissCount || 0));
    progress.longestSurvival = Math.max(progress.longestSurvival, Math.floor(Number(run.survivalTime) || 0));
    if (RANKED_MODES.includes(run.mode)) {
        progress.bestByMode[run.mode] = Math.max(progress.bestByMode[run.mode] || 0, Math.floor(score));
    }
    saveJSON(PROGRESS_STORAGE_KEY, progress);

    const fromLevel = profile.level;
    const xpGained = computeRunXp(run);
    profile.xp += xpGained;
    profile.level = levelForXp(profile.xp);
    saveJSON(PROFILE_STORAGE_KEY, profile);

    return { xpGained, leveledUp: profile.level > fromLevel, fromLevel, toLevel: profile.level };
}
