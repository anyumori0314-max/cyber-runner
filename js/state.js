// ===================================
// state.js — 共有ゲーム状態の単一情報源（Stage 3）
//
// 責務: gameState / player / 各エンティティ配列 / RAF・deltaTime・入力状態を
//       一元管理する（single source of truth）。状態の二重定義は禁止。
//
// 依存方向: config（定数）と model/entities（Player クラス）のみ import する
//   リーフ寄りのモジュール。entities は state を import しない（循環依存なし）。
//   配列は再代入せず .length = 0 で in-place クリアし、import 先と参照を共有する。
// 入力状態（moveLeft/moveRight）は player インスタンス上に保持する（従来挙動）。
// ===================================

import {
    INITIAL_SPEED,
    INITIAL_SPAWN_RATE,
    INITIAL_POWERUP_SPAWN,
    ENERGY_CORE_SPAWN_RATE,
    HIGH_SCORE_STORAGE_KEY
} from './config.js';
import { Player } from './model/entities.js';

// ハイスコアの初期読込（import 時に実行）。
// localStorage が使えない / getItem が例外を投げる環境でも state.js の読み込みを失敗させず、
// 例外時・不正値時は 0 を返してゲームを起動できるようにする（キーは変更しない）。
function loadInitialHighScore() {
    try {
        const value = Number(localStorage.getItem(HIGH_SCORE_STORAGE_KEY));
        return Number.isFinite(value) && value >= 0 ? value : 0;
    } catch (error) {
        // 内部例外はユーザー画面に出さず、開発者向けに警告のみ残す
        console.warn('Failed to load high score:', error);
        return 0;
    }
}

// ===================================
// ゲーム状態（最終表示スコア = survivalScore + bonusScore を毎フレーム合成）
// ===================================
export const gameState = {
    isRunning: false,
    isPaused: false,
    // 最終表示スコア = survivalScore + bonusScore（毎フレーム合成）
    score: 0,
    // 生存時間 × コンボ倍率から毎フレーム差分加算する基本スコア
    survivalScore: 0,
    // エネルギーコア / ボーナスで得た加算スコア（毎フレーム上書きしない・累積）
    bonusScore: 0,
    // localStorage から安全に読み込む（例外・不正値時は 0）
    highScore: loadInitialHighScore(),
    level: 1,
    gameTime: 0,
    startTime: 0,
    // baseSpeed は難易度計算に用いる基礎速度
    baseSpeed: INITIAL_SPEED,
    // 実際の速度（baseSpeed に slowFactor を乗算したもの）
    speed: INITIAL_SPEED,
    spawnRate: INITIAL_SPAWN_RATE,
    powerupSpawnRate: INITIAL_POWERUP_SPAWN,
    slowFactor: 1,
    slowUntil: null,
    specialChance: 0, // 特殊障害物出現率（時間経過で増加）
    // ====== コンボ ======
    combo: 0, // 現在のコンボ数
    maxCombo: 0, // 最大コンボ数（GAME OVER時のランク表示用）
    comboLastTime: 0, // 最後にコアを取得した時刻（秒）
    energyCoreSpawnRate: ENERGY_CORE_SPAWN_RATE
};

// ===================================
// プレイヤー（入力状態・シールド状態を保持する単一インスタンス）
// ===================================
export const player = new Player();

// ===================================
// ゲームオブジェクト配列（再代入せず in-place で操作し、参照を共有する）
// ===================================
export const obstacles = [];
export const powerUps = [];
export const energyCores = []; // エネルギーコア
export const particles = []; // パーティクル
export const popups = []; // テキストのフローティング表示

// ===================================
// ループ実行状態（RAF / deltaTime / レベルアップ検出）
// ===================================
export const loopState = {
    rafId: null, // requestAnimationFrame の ID（常に1本に保つ）
    lastTimestamp: null, // 前フレームの timestamp（ms）
    lastLevel: 0 // レベルアップ効果音の検出用
};

// すべてのゲームデータ状態を初期化する（START / RETRY 用）。
// 副作用（エラークリア・リーダーボードUI）は呼び出し側 controller が担当する。
export function resetState() {
    gameState.isRunning = true;
    gameState.isPaused = false;
    // スコア関連状態は RETRY 時のみ 0 に戻す（survival / bonus / 最終 すべて）
    gameState.score = 0;
    gameState.survivalScore = 0;
    gameState.bonusScore = 0;
    gameState.level = 1;
    gameState.gameTime = 0;
    gameState.startTime = Date.now();
    gameState.baseSpeed = INITIAL_SPEED;
    gameState.speed = INITIAL_SPEED;
    gameState.spawnRate = INITIAL_SPAWN_RATE;
    gameState.powerupSpawnRate = INITIAL_POWERUP_SPAWN;
    gameState.slowFactor = 1;
    gameState.slowUntil = null;
    gameState.specialChance = 0;
    // コンボのリセット（highScore は維持する）
    gameState.combo = 0;
    gameState.maxCombo = 0;
    gameState.comboLastTime = 0;
    gameState.energyCoreSpawnRate = ENERGY_CORE_SPAWN_RATE;

    // 障害物やプレイヤーの状態をリセット（配列は in-place クリア）
    obstacles.length = 0;
    powerUps.length = 0;
    energyCores.length = 0;
    particles.length = 0;
    popups.length = 0;
    player.reset();

    // ループ状態をリセット（lastTimestamp を null にして delta 計算を初期化）
    loopState.lastTimestamp = null;
    loopState.lastLevel = 0;
}

// ハイスコアを更新し localStorage へ保存する（数値比較・floor 保存）。
export function updateHighScore(finalScore) {
    if (finalScore > gameState.highScore) {
        gameState.highScore = Math.floor(finalScore);
        try {
            localStorage.setItem(HIGH_SCORE_STORAGE_KEY, gameState.highScore);
        } catch (e) {
            // localStorage が使えない場合は警告に留める
            console.warn('localStorage not available:', e);
        }
    }
    return gameState.highScore;
}
