// ===================================
// model/difficulty.js — 難易度・レベル・スポーン判定（Stage 3）
//
// 責務: レベル計算 / 障害物速度・出現率・特殊種出現率の時間経過による上昇 /
//       spawn 判定（TARGET_FPS 補正）。副作用なし（gameState を引数で受け取る）。
//
// 依存方向: config のみ。既存の数値と難易度カーブは変更しない。
// ===================================

import {
    INITIAL_SPEED,
    MAX_SPEED,
    INITIAL_SPAWN_RATE,
    MAX_SPAWN_RATE,
    INITIAL_POWERUP_SPAWN,
    MAX_POWERUP_SPAWN,
    TARGET_FPS
} from '../config.js';

// レベルを更新（10秒ごとに +1）。
export function updateLevel(gameState) {
    gameState.level = Math.floor(gameState.gameTime / 10) + 1;
}

// 難易度を更新（基礎速度・出現率・特殊種確率を時間経過で上昇）。
export function updateDifficulty(gameState) {
    // baseSpeed を計算し、slowFactor を掛けて実効速度を決定
    const baseIncrease = (gameState.gameTime / 60) * (MAX_SPEED - INITIAL_SPEED);
    gameState.baseSpeed = INITIAL_SPEED + Math.min(baseIncrease, MAX_SPEED - INITIAL_SPEED);
    gameState.speed = gameState.baseSpeed * (gameState.slowFactor || 1);

    // 障害物出現率を増やす
    const spawnIncrease = (gameState.gameTime / 60) * (MAX_SPAWN_RATE - INITIAL_SPAWN_RATE);
    gameState.spawnRate = INITIAL_SPAWN_RATE + Math.min(spawnIncrease, MAX_SPAWN_RATE - INITIAL_SPAWN_RATE);

    // パワーアップ出現率は低めに増加
    const puIncrease = (gameState.gameTime / 120) * (MAX_POWERUP_SPAWN - INITIAL_POWERUP_SPAWN);
    gameState.powerupSpawnRate = INITIAL_POWERUP_SPAWN + Math.min(puIncrease, MAX_POWERUP_SPAWN - INITIAL_POWERUP_SPAWN);

    // 特殊障害物の出現確率を増やす
    gameState.specialChance = Math.min(0.05 + gameState.gameTime / 1200, 0.4);
}

// フレームごとの spawn 判定（確率 rate を delta と TARGET_FPS で補正）。
export function shouldSpawn(rate, delta) {
    return Math.random() < rate * (delta || 0) * TARGET_FPS;
}
