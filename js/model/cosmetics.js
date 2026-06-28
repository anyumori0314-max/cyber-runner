// ===================================
// model/cosmetics.js — 外観カスタマイズ（Phase 8）
//
// 責務: カラー/発光/軌跡/コア取得エフェクト/称号の「外観のみ」カタログと、
//   解放状態・選択状態の保持/検証/永続化。解放は初期/レベル/実績/チャレンジ条件で判定。
//   ★ 外観のみ。移動速度・当たり判定・無敵・スコア倍率・ランキングへは一切影響しない。
//
// 依存方向: config（キー）/ util/storage（安全な保存・読込）。DOM/通信に触れない。
// ===================================

import { COSMETICS_STORAGE_KEY } from '../config.js';
import { loadJSON, saveJSON } from '../util/storage.js';

// 外観カタログ（value は描画専用の見た目データ）。
export const CATALOG = {
    color: [
        { id: 'color_green', name: 'NEON GREEN', value: '#00ff88', unlock: { type: 'initial' } },
        { id: 'color_cyan', name: 'CYAN', value: '#00eaff', unlock: { type: 'initial' } },
        { id: 'color_magenta', name: 'MAGENTA', value: '#ff44cc', unlock: { type: 'level', level: 3 } },
        { id: 'color_gold', name: 'GOLD', value: '#ffd400', unlock: { type: 'level', level: 5 } },
        { id: 'color_orange', name: 'EMBER', value: '#ff7744', unlock: { type: 'achievement', id: 'combo_master' } },
        { id: 'color_white', name: 'WHITE', value: '#ffffff', unlock: { type: 'level', level: 8 } }
    ],
    glow: [
        { id: 'glow_standard', name: 'STANDARD', value: { blur: 15 }, unlock: { type: 'initial' } },
        { id: 'glow_hyper', name: 'HYPER', value: { blur: 30 }, unlock: { type: 'level', level: 4 } },
        { id: 'glow_ghost', name: 'GHOST', value: { blur: 6 }, unlock: { type: 'achievement', id: 'survivor' } }
    ],
    trail: [
        { id: 'trail_none', name: 'NONE', value: 'none', unlock: { type: 'initial' } },
        { id: 'trail_line', name: 'LINE', value: 'line', unlock: { type: 'level', level: 2 } },
        { id: 'trail_spark', name: 'SPARK', value: 'spark', unlock: { type: 'challenge', id: 'any' } }
    ],
    coreEffect: [
        { id: 'core_default', name: 'DEFAULT', value: 'default', unlock: { type: 'initial' } },
        { id: 'core_burst', name: 'BURST', value: 'burst', unlock: { type: 'level', level: 5 } },
        { id: 'core_ring', name: 'RING', value: 'ring', unlock: { type: 'challenge', id: 'any' } }
    ],
    title: [
        { id: 'title_rookie', name: 'サイバールーキー', value: 'サイバールーキー', unlock: { type: 'initial' } },
        { id: 'title_combo', name: 'コンボ職人', value: 'コンボ職人', unlock: { type: 'achievement', id: 'combo_master' } },
        { id: 'title_legend', name: 'CYBER LEGEND', value: 'CYBER LEGEND', unlock: { type: 'achievement', id: 'cyber_legend' } },
        { id: 'title_master', name: 'MASTER', value: 'MASTER', unlock: { type: 'level', level: 10 } }
    ]
};
const CATEGORIES = Object.keys(CATALOG);

// id → { category, item } の索引。
const INDEX = {};
for (const cat of CATEGORIES) for (const item of CATALOG[cat]) INDEX[item.id] = { category: cat, item };

// 各カテゴリの既定選択（最初の initial アイテム）。
function defaultSelected() {
    const sel = {};
    for (const cat of CATEGORIES) {
        const init = CATALOG[cat].find((i) => i.unlock.type === 'initial') || CATALOG[cat][0];
        sel[cat] = init.id;
    }
    return sel;
}

let unlocked = {}; // { id: true }
let selected = defaultSelected();

function initialUnlocks() {
    const u = {};
    for (const cat of CATEGORIES) for (const item of CATALOG[cat]) if (item.unlock.type === 'initial') u[item.id] = true;
    return u;
}

function sanitize(raw) {
    const u = initialUnlocks();
    const sel = defaultSelected();
    if (raw && typeof raw === 'object') {
        if (raw.unlocked && typeof raw.unlocked === 'object') {
            for (const id of Object.keys(raw.unlocked)) if (INDEX[id] && raw.unlocked[id] === true) u[id] = true;
        }
        if (raw.selected && typeof raw.selected === 'object') {
            for (const cat of CATEGORIES) {
                const id = raw.selected[cat];
                // 選択は「存在し、そのカテゴリで、解放済み」のときだけ採用。
                if (INDEX[id] && INDEX[id].category === cat && u[id]) sel[cat] = id;
            }
        }
    }
    return { u, sel };
}

export function loadCosmetics() {
    const raw = loadJSON(COSMETICS_STORAGE_KEY, null);
    const { u, sel } = sanitize(raw);
    unlocked = u;
    selected = sel;
}

function persist() {
    saveJSON(COSMETICS_STORAGE_KEY, { unlocked, selected });
}

export function isUnlocked(id) { return unlocked[id] === true; }

// 条件を満たす外観を解放する。戻り値: 新規解放アイテムの配列（通知用）。
//   ctx = { level, achievements: {id:true}, challenges: {id:true} }
export function syncUnlocks(ctx = {}) {
    const level = Math.max(1, Math.floor(ctx.level || 1));
    const ach = ctx.achievements || {};
    const ch = ctx.challenges || {};
    const anyChallenge = Object.keys(ch).some((k) => ch[k] === true);
    const newly = [];
    for (const cat of CATEGORIES) {
        for (const item of CATALOG[cat]) {
            if (unlocked[item.id]) continue;
            const c = item.unlock;
            let ok = false;
            if (c.type === 'initial') ok = true;
            else if (c.type === 'level') ok = level >= c.level;
            else if (c.type === 'achievement') ok = ach[c.id] === true;
            else if (c.type === 'challenge') ok = c.id === 'any' ? anyChallenge : ch[c.id] === true;
            if (ok) {
                unlocked[item.id] = true;
                newly.push({ ...item, category: cat });
            }
        }
    }
    if (newly.length) persist();
    return newly;
}

// 外観を選択（解放済みのみ）。成功で true。
export function selectCosmetic(category, id) {
    const entry = INDEX[id];
    if (!entry || entry.category !== category) return false;
    if (!unlocked[id]) return false; // 未解放は選択不可
    selected[category] = id;
    persist();
    return true;
}

// 表示用カタログ（解放/選択フラグつき）。
export function getCatalogView() {
    const out = {};
    for (const cat of CATEGORIES) {
        out[cat] = CATALOG[cat].map((i) => ({
            id: i.id,
            name: i.name,
            unlocked: unlocked[i.id] === true,
            selected: selected[cat] === i.id,
            unlock: i.unlock
        }));
    }
    return out;
}

// 現在の外観（描画専用の解決済み値）。renderer / share が読む。
export function getActive() {
    const resolve = (cat) => (INDEX[selected[cat]] ? INDEX[selected[cat]].item.value : CATALOG[cat][0].value);
    return {
        color: resolve('color'),
        glow: resolve('glow'),
        trail: resolve('trail'),
        coreEffect: resolve('coreEffect'),
        title: resolve('title')
    };
}
