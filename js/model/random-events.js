// ===================================
// model/random-events.js — ランダムイベント定義と効果適用/復元（Phase 11）
//
// 責務: 5イベント（CORE RUSH / DOUBLE SCORE / HIGH SPEED / DARK ZONE / LASER STORM）の
//   定義と、gameState への効果適用・スナップショット復元（純粋関数）。
//   「終了後に速度・倍率・出現率・描画状態を完全復元」を保証するため、apply 時に
//   影響フィールドのスナップショットを取り、restore で正確に戻す。
//   同時に複数を発生させない制御・時間管理は controller/wave-controller が行う。
//
// 依存方向: balance（イベント効果時間・倍率＝選択中 preset）。DOM/Canvas に触れない（表示は view/event-view）。
//   Phase 11 のイベント倍率/効果時間は active balance preset が唯一の正本（config 直接参照なし）。
// ===================================

import {
    getEventDurationSec,
    getCoreRushMultiplier,
    getHighSpeedMultiplier
} from './balance.js';

// イベント定義。needsWarning=true は効果適用前に警告時間を設ける（HIGH SPEED）。
export const EVENT_DEFS = {
    core_rush: { id: 'core_rush', name: 'CORE RUSH', desc: 'コア出現率アップ', needsWarning: false, color: '#ffe066', icon: '◆' },
    double_score: { id: 'double_score', name: 'DOUBLE SCORE', desc: '新規スコア x2', needsWarning: false, color: '#ff66ff', icon: 'x2' },
    high_speed: { id: 'high_speed', name: 'HIGH SPEED', desc: '障害物が高速化', needsWarning: true, color: '#ff7744', icon: '»' },
    dark_zone: { id: 'dark_zone', name: 'DARK ZONE', desc: '視界制限', needsWarning: false, color: '#88aaff', icon: '◐' },
    laser_storm: { id: 'laser_storm', name: 'LASER STORM', desc: '警告レーザー増加', needsWarning: false, color: '#ff5050', icon: '≡' }
};

export function getEventDef(id) {
    return EVENT_DEFS[id] || null;
}

// DOUBLE SCORE の倍率自体は scoring.js（scoreMultiplier）が doubleUntil を見て適用する。
// ここでは doubleUntil を延長するだけ（既獲得スコアは scoring 設計上、減少しない）。

// イベント効果を gameState へ適用し、復元用スナップショットを返す（純粋＝引数のみ変更）。
export function applyEvent(gameState, id) {
    const snap = {
        eventCoreMult: gameState.eventCoreMult,
        eventSpeedMult: gameState.eventSpeedMult,
        darkZone: gameState.darkZone,
        laserStorm: gameState.laserStorm
        // doubleUntil は復元しない（自然失効。既獲得スコアは scoring 設計上減らない）
    };
    switch (id) {
        case 'core_rush':
            gameState.eventCoreMult = getCoreRushMultiplier();
            break;
        case 'double_score':
            // 既存の DOUBLE（パワーアップ由来）を縮めないよう max を取る。
            gameState.doubleUntil = Math.max(gameState.doubleUntil || 0, gameState.gameTime + getEventDurationSec());
            break;
        case 'high_speed':
            gameState.eventSpeedMult = getHighSpeedMultiplier();
            break;
        case 'dark_zone':
            gameState.darkZone = true;
            break;
        case 'laser_storm':
            gameState.laserStorm = true;
            break;
        default:
            break;
    }
    return snap;
}

// スナップショットから gameState を正確に復元する（速度・倍率・出現率・描画状態の完全復元）。
export function restoreEvent(gameState, snap) {
    if (!snap) {
        // 念のため全フィールドを中立値へ。
        gameState.eventCoreMult = 1;
        gameState.eventSpeedMult = 1;
        gameState.darkZone = false;
        gameState.laserStorm = false;
        return;
    }
    gameState.eventCoreMult = snap.eventCoreMult;
    gameState.eventSpeedMult = snap.eventSpeedMult;
    gameState.darkZone = snap.darkZone;
    gameState.laserStorm = snap.laserStorm;
}

// 候補からランダムに1イベントを選ぶ（直前と同じものは避ける）。
export function pickRandomEvent(excludeId = null) {
    const ids = Object.keys(EVENT_DEFS).filter((id) => id !== excludeId);
    const pool = ids.length > 0 ? ids : Object.keys(EVENT_DEFS);
    return pool[Math.floor(Math.random() * pool.length)];
}
