// ===================================
// model/missions.js — ランミッション（Phase 5）
//
// 責務: 1プレイ1件のミッション定義・選択・進捗計算・達成判定。
//   副作用なし（gameState を読み取り、進捗/達成を返す純粋関数）。報酬付与は controller。
//
// 依存方向: なし（リーフ）。DOM/通信に触れない。
// ===================================

export const MISSIONS = [
    { id: 'survive30', label: '30秒生存する', type: 'survive', target: 30, unit: 's' },
    { id: 'cores5', label: 'エネルギーコアを5個取得する', type: 'cores', target: 5 },
    { id: 'combo10', label: '10コンボ達成する', type: 'combo', target: 10 },
    { id: 'nearmiss3', label: 'ニアミスを3回達成する', type: 'nearmiss', target: 3 },
    { id: 'level5', label: 'Lv5へ到達する', type: 'level', target: 5 },
    { id: 'noshield1000', label: 'シールドを使わず1000点獲得する', type: 'noshield', target: 1000 },
    { id: 'dash3', label: 'ダッシュを3回使用する', type: 'dash', target: 3 }
];

// 新しいプレイ用のミッションをランダム選択する（START/RETRY ごとに新規）。
export function selectMission() {
    return MISSIONS[Math.floor(Math.random() * MISSIONS.length)];
}

// 現在の進捗値（target で頭打ち）を返す。
export function getMissionProgress(mission, gameState) {
    if (!mission) return 0;
    let raw = 0;
    switch (mission.type) {
        case 'survive': raw = gameState.gameTime; break;
        case 'cores': raw = gameState.coreCount; break;
        case 'combo': raw = gameState.maxCombo; break;
        case 'nearmiss': raw = gameState.nearMissCount; break;
        case 'level': raw = gameState.level; break;
        case 'noshield': raw = Math.floor(gameState.score); break;
        case 'dash': raw = gameState.dashCount; break;
        default: raw = 0;
    }
    return Math.min(raw, mission.target);
}

// ミッション達成判定（noshield はシールド未使用が条件）。
export function isMissionComplete(mission, gameState) {
    if (!mission) return false;
    if (mission.type === 'noshield' && gameState.shieldUsed) return false;
    return getMissionProgress(mission, gameState) >= mission.target;
}

// HUD/タイトル表示用の文字列。
export function formatMission(mission, gameState = null) {
    if (!mission) return '';
    if (!gameState) return mission.label;
    const cur = mission.type === 'survive'
        ? Math.floor(getMissionProgress(mission, gameState))
        : getMissionProgress(mission, gameState);
    const unit = mission.unit || '';
    return `${mission.label} (${cur}/${mission.target}${unit})`;
}
