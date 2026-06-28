// ===================================
// model/game-modes.js — ゲームモードの定義と適用（Phase 7）
//
// 責務: 4モード（Endless / Time Attack / Hardcore / Training）の定義・選択状態・
//   Training 設定の保持と、選択モードを gameState へ反映する純粋なロジック。
//   DOM/Canvas/通信に触れない（表示は view/mode-select-view、適用呼出は controller）。
//
// 依存方向: config（既定値・モードID・パワーアップ重み）。
// ===================================

import {
    GAME_MODE_IDS,
    DEFAULT_GAME_MODE,
    TIME_ATTACK_DURATION_SEC,
    POWERUP_WEIGHTS
} from '../config.js';

// モード定義。ranked=false は記録/送信対象外（Training）。
export const GAME_MODES = [
    {
        id: 'endless',
        name: 'ENDLESS',
        desc: '通常モード。生き延びてスコアを稼ぐ。ランキング対象。',
        ranked: true
    },
    {
        id: 'timeattack',
        name: 'TIME ATTACK',
        desc: `制限時間 ${TIME_ATTACK_DURATION_SEC} 秒。時間切れは FINISH。スコアを競う。`,
        ranked: true,
        timeLimitSec: TIME_ATTACK_DURATION_SEC
    },
    {
        id: 'hardcore',
        name: 'HARDCORE',
        desc: 'シールド無し・高速・高難度。スコア x1.5。ランキング対象。',
        ranked: true,
        difficultyMultiplier: 1.35,
        scoreMultiplier: 1.5,
        noShield: true,
        restrictPowerups: true
    },
    {
        id: 'training',
        name: 'TRAINING',
        desc: '練習用。無敵/速度/障害物を調整。ランキング・記録・XP なし。',
        ranked: false,
        training: true
    }
];

// Training の設定（モジュール内に保持。タイトルの UI から変更する）。
const DEFAULT_TRAINING = { invincible: false, speed: 1.0, obstacles: 'all' };
let training = { ...DEFAULT_TRAINING };

let selectedModeId = DEFAULT_GAME_MODE;

export function getMode(id) {
    return GAME_MODES.find((m) => m.id === id) || GAME_MODES[0];
}
export function getModes() {
    return GAME_MODES.map((m) => ({ ...m }));
}
export function getSelectedMode() {
    return getMode(selectedModeId);
}
export function setMode(id) {
    if (GAME_MODE_IDS.includes(id)) selectedModeId = id;
    return getSelectedMode();
}
export function isRanked(id = selectedModeId) {
    return getMode(id).ranked === true;
}

// Training 設定の取得・更新（検証つき）。
export function getTrainingSettings() {
    return { ...training };
}
export function setTrainingSetting(key, value) {
    if (key === 'invincible') training.invincible = value === true;
    else if (key === 'speed') {
        const v = Number(value);
        if (Number.isFinite(v) && v >= 0.25 && v <= 3) training.speed = v;
    } else if (key === 'obstacles') {
        if (['all', 'basic', 'none'].includes(value)) training.obstacles = value;
    }
    return getTrainingSettings();
}

// モード別のパワーアップ重み（Hardcore はシールド除外＋強パワーアップ抑制）。
export function getModePowerupWeights(modeId = selectedModeId) {
    const mode = getMode(modeId);
    if (mode.restrictPowerups) {
        // shield を出さず、magnet/double を控えめにして難度を保つ。
        return { slow: 16, bonus: 18, magnet: 6, bomb: 8, double: 6, dashcharge: 10 };
    }
    return { ...POWERUP_WEIGHTS };
}

// 選択中モード（+ Training 設定）を gameState へ反映する。
// resetState 後に controller が呼ぶ（resetState の既定値を上書きする）。
export function applyModeToState(gameState) {
    const mode = getSelectedMode();
    gameState.mode = mode.id;
    gameState.timeLimitSec = mode.timeLimitSec || 0;
    gameState.modeScoreMultiplier = mode.scoreMultiplier || 1;
    gameState.difficultyMultiplier = mode.difficultyMultiplier || 1;
    gameState.invincible = false;
    gameState.allowedObstacles = 'all';

    if (mode.training) {
        gameState.invincible = training.invincible === true;
        gameState.difficultyMultiplier = training.speed || 1;
        gameState.allowedObstacles = training.obstacles || 'all';
    }
    return mode;
}
