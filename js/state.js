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
    HIGH_SCORE_STORAGE_KEY,
    DEFAULT_GAME_MODE
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
    energyCoreSpawnRate: ENERGY_CORE_SPAWN_RATE,

    // ====== Phase 2-3: フェーズ / 一時停止 / カウントダウン ======
    isPaused: false, // 一時停止中か
    phase: 'playing', // 'countdown' | 'playing'（タイトル/GAMEOVERは画面側で管理）
    countdown: 0, // 開始カウントダウンの残り秒（>0 の間はゲーム進行を止める）

    // ====== Phase 4: ダッシュ ======
    dashReadyAt: 0, // この gameTime 以降ダッシュ可能（クールタイム管理）
    dashInvulnUntil: 0, // この gameTime までダッシュ無敵
    lastMoveDirection: 1, // 直近の向き（1:右 / -1:左）。無入力ダッシュ方向に使用
    dashCount: 0, // 今回プレイのダッシュ使用回数（ミッション/実績/称号）

    // ====== Phase 4: 新パワーアップの効果時刻（gameTime 基準・秒） ======
    magnetUntil: 0, // この gameTime まで MAGNET 有効
    doubleUntil: 0, // この gameTime まで DOUBLE SCORE 有効

    // ====== Phase 3-5: 実績/称号/ミッション用の今回プレイ統計 ======
    nearMissCount: 0, // 今回プレイのニアミス回数
    coreCount: 0, // 今回プレイのコア取得数
    shieldUsed: false, // 今回プレイでシールドを使ったか（noshield ミッション判定用）
    shakeTime: 0, // 画面揺れ残り秒（Phase 3 演出）
    shakeMag: 0, // 画面揺れの強さ(px)

    // ====== Phase 5: ランミッション ======
    mission: null, // 現在のミッション定義 { id, label, target, type }
    missionProgress: 0, // 現在の進捗
    missionDone: false, // 報酬付与済みか（1プレイ1回）

    // ====== Phase 6-7: ゲームモード / セキュアラン ======
    mode: DEFAULT_GAME_MODE, // 'endless' | 'timeattack' | 'hardcore' | 'training'
    timeLimitSec: 0, // >0 でタイムアタック（0=無制限）
    finished: false, // タイムアタックの時間切れ FINISH（GAME OVER と区別）
    modeScoreMultiplier: 1, // モードのスコア倍率（Endless=1）
    difficultyMultiplier: 1, // モードの難易度倍率（速度に乗算。Endless=1）
    invincible: false, // Training の無敵 ON
    allowedObstacles: 'all', // Training の障害物種別 'all' | 'basic' | 'none'
    runStartedAtMs: 0, // duration_ms 計測用のクライアント開始時刻

    // ====== Phase 11: ウェーブ／イベントが速度・出現率・描画へ与える補正（中立値 = 既存挙動） ======
    waveSpeedBonus: 0, // サイクル難易度による速度加算係数（0 = 影響なし）
    eventSpeedMult: 1, // HIGH SPEED 等の速度倍率（1 = 影響なし。終了時に正確に 1 へ戻す）
    eventCoreMult: 1, // CORE RUSH のコア出現倍率（1 = 影響なし）
    darkZone: false, // DARK ZONE の視界制限（描画のみ）
    laserStorm: false, // LASER STORM 中の追加レーザー出現（loop が参照）
    // ====== Phase 11: 今回プレイのウェーブ／ボス統計（分析・結果表示用） ======
    waveReached: 1, // 到達した最大ウェーブ番号（サイクル跨ぎでも 1..5）
    bossReached: 0, // 到達したボス数（撃破有無に関わらず開始した数）
    bossDefeated: 0, // 撃破したボス数
    powerupsCollected: 0, // 取得したパワーアップ数
    // ====== Phase 13: 分析用の終了原因（'obstacle'|'laser'|'homing'|'gapwall'|'boss'|'finish'|'unknown'） ======
    deathCause: 'unknown'
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
    lastLevel: 0, // レベルアップ効果音の検出用
    ended: false // このプレイで endGame を既に処理したか（多重終了防止。START/RETRY でリセット）
};

// ===================================
// Phase 11: ウェーブ / ボス / イベント 状態（単一情報源）
//   ボスとイベントの state はここ一箇所で管理する（二重定義禁止）。
//   時間は controller(wave-controller) が deltaTime で進める（setInterval 不使用）。
//   pause 中は RAF 停止でループ自体が止まるため、ここの時間も自動で凍結する。
// ===================================
export const waveState = {
    enabled: false, // ウェーブ機能が有効か（Endless/TimeAttack/Hardcore=自動進行 / Training=手動）
    manual: false, // Training の手動制御（自動でウェーブを進めない）
    cycle: 1, // サイクル番号（Endless はボス撃破後に +1）
    index: 0, // WAVE_SEQUENCE のインデックス（0..4）
    waveNumber: 1, // 表示用ウェーブ番号（1..5）
    waveType: 'normal', // 現ウェーブの主役障害物種別
    phase: 'intro', // 'intro'|'active'|'outro'|'intermission'|'boss-warning'|'boss'|'boss-defeated'
    phaseTime: 0, // 現フェーズの経過秒
    bossActive: false, // ボス戦中か（loop の通常 spawn 抑止に使用）
    // ボス（boss フェーズ中のみ非 null）
    boss: null, // { type, hp, maxHp, x, y, width, height, dir, timers..., flash }
    // イベント（同時に1つのみ。非 null = 進行中）
    event: null, // { id, name, remaining, total, warning, started }
    eventCooldown: 0, // 次イベントまでのクールタイム（秒）
    eventRestore: null // イベント終了時に元へ戻す値のスナップショット
};

// ウェーブ/ボス/イベント状態を初期化する（START / RETRY / モード変更で完全リセット）。
export function resetWaveState() {
    waveState.enabled = false;
    waveState.manual = false;
    waveState.cycle = 1;
    waveState.index = 0;
    waveState.waveNumber = 1;
    waveState.waveType = 'normal';
    waveState.phase = 'intro';
    waveState.phaseTime = 0;
    waveState.bossActive = false;
    waveState.boss = null;
    waveState.event = null;
    waveState.eventCooldown = 0;
    waveState.eventRestore = null;
}

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

    // Phase 2-5 追加状態のリセット（mission は controller が新規割り当てする）
    gameState.isPaused = false;
    gameState.phase = 'playing';
    gameState.countdown = 0;
    gameState.dashReadyAt = 0;
    gameState.dashInvulnUntil = 0;
    gameState.lastMoveDirection = 1;
    gameState.dashCount = 0;
    gameState.magnetUntil = 0;
    gameState.doubleUntil = 0;
    gameState.nearMissCount = 0;
    gameState.coreCount = 0;
    gameState.shieldUsed = false;
    gameState.shakeTime = 0;
    gameState.shakeMag = 0;
    gameState.missionProgress = 0;
    gameState.missionDone = false;

    // Phase 6-7: モード関連の既定値（mode 自体は controller が選択値を保持する）。
    // タイムアタック等のモード固有値は resetState 後に controller がモードから適用する。
    gameState.timeLimitSec = 0;
    gameState.finished = false;
    gameState.modeScoreMultiplier = 1;
    gameState.difficultyMultiplier = 1;
    gameState.invincible = false;
    gameState.allowedObstacles = 'all';
    gameState.runStartedAtMs = Date.now();

    // Phase 11: ウェーブ／イベント補正と統計を中立値へ（イベント効果の取り残しを防ぐ）。
    gameState.waveSpeedBonus = 0;
    gameState.eventSpeedMult = 1;
    gameState.eventCoreMult = 1;
    gameState.darkZone = false;
    gameState.laserStorm = false;
    gameState.waveReached = 1;
    gameState.bossReached = 0;
    gameState.bossDefeated = 0;
    gameState.powerupsCollected = 0;
    gameState.deathCause = 'unknown';

    // Phase 11: ウェーブ／ボス／イベント状態を完全リセット。
    resetWaveState();

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
