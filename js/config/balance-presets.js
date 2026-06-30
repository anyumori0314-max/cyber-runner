// ===================================
// config/balance-presets.js — ゲームバランスの版管理（Phase 13）
//
// 責務: バランス値を「バージョン単位の preset」として束ねる。現在値（config.js の定数）を
//   そのまま参照して初期 preset を構成するため、既存数値を無断で変更しない（重複も作らない）。
//   選択中 preset は model/balance.js が一箇所で保持・参照する。
//   各プレイの分析には BALANCE_VERSION を記録する（balance_version 比較用）。
//
//   ※ ランキングスコアへ影響する変更（scoreMultiplier / xpMultiplier / 速度等）は
//     BALANCE_GUIDE.md に明示し、版を上げること。本番ユーザー向け preset 選択 UI は追加しない。
//
// 依存方向: config（現在値の参照のみ）。DOM/Canvas/通信に触れない。
// ===================================

import {
    INITIAL_SPEED,
    INITIAL_SPAWN_RATE,
    LASER_WARNING_TIME,
    HOMING_DRIFT_SPEED,
    GAPWALL_GAP_WIDTH,
    INITIAL_POWERUP_SPAWN,
    DASH_COOLDOWN,
    WAVE_SEQUENCE,
    WAVE_DURATION_SEC,
    WAVE_INTRO_SEC,
    WAVE_OUTRO_SEC,
    WAVE_INTERMISSION_SEC,
    WAVE_SPAWN_BOOST,
    CYCLE_DIFFICULTY_STEP,
    CYCLE_BOSS_HP_STEP,
    BOSS_SEQUENCE,
    BOSS_WARNING_SEC,
    BOSS_DEFEAT_SEC,
    BOSS_FIREWALL_HP,
    BOSS_WORM_HP,
    BOSS_GATE_HP,
    BOSS_FIREWALL_LASER_INTERVAL,
    BOSS_FIREWALL_CORE_INTERVAL,
    BOSS_FIREWALL_MAX_LASERS,
    BOSS_FIREWALL_SAFE_WIDTH,
    BOSS_WORM_SPAWN_INTERVAL,
    BOSS_WORM_ATTACK_WARNING,
    BOSS_WORM_HIT_COOLDOWN,
    BOSS_WORM_SPEED,
    BOSS_WORM_MAX_MINIONS,
    BOSS_GATE_WALL_INTERVAL,
    BOSS_GATE_MIN_GAP,
    EVENT_DURATION_SEC,
    EVENT_MIN_INTERVAL_SEC,
    EVENT_FIRST_DELAY_SEC,
    EVENT_WARNING_SEC,
    EVENT_CORE_RUSH_MULT,
    EVENT_HIGH_SPEED_MULT,
    EVENT_LASER_STORM_RATE,
    EVENT_LASER_STORM_MAX,
    HARDCORE_WAVE_SPEED_FACTOR,
    HARDCORE_BOSS_INTERVAL_FACTOR
} from '../config.js';

// バランス版数。ランキングへ影響する変更を含むときは必ず上げる。
export const BALANCE_VERSION = '1.0.0';

// 既定（現在値）preset。値はすべて config.js の現在値を参照（＝現行挙動と完全一致）。
//   scoreMultiplier / xpMultiplier は 1（既存挙動）。変更はランキング影響ありとして扱う。
const DEFAULT_PRESET = {
    id: 'default',
    version: BALANCE_VERSION,
    label: 'DEFAULT (current)',
    // 通常障害物
    obstacleSpeedInitial: INITIAL_SPEED,
    obstacleSpawnRate: INITIAL_SPAWN_RATE,
    // 警告レーザー / 追尾 / 隙間
    laserWarningTime: LASER_WARNING_TIME,
    homingDrift: HOMING_DRIFT_SPEED,
    gapWidth: GAPWALL_GAP_WIDTH,
    // パワーアップ / ダッシュ
    powerupSpawnRate: INITIAL_POWERUP_SPAWN,
    dashCooldown: DASH_COOLDOWN,
    // ウェーブ進行（順序・演出/休憩を含む全フェーズ時間・サイクル難易度・spawn 補正）
    waveSequence: WAVE_SEQUENCE, // 1サイクルのウェーブ列（進行順）
    waveDuration: WAVE_DURATION_SEC,
    waveIntroDuration: WAVE_INTRO_SEC,
    waveOutroDuration: WAVE_OUTRO_SEC,
    waveIntermissionDuration: WAVE_INTERMISSION_SEC,
    waveSpawnBoost: WAVE_SPAWN_BOOST, // ウェーブ種別ごとの追加出現率
    cycleDifficultyStep: CYCLE_DIFFICULTY_STEP, // サイクルごとの難易度上昇係数
    cycleBossHpStep: CYCLE_BOSS_HP_STEP, // サイクルごとのボス HP 増加係数
    // ボス（順序・HP・各ボス攻撃間隔・警告/撃破・速度・上限・回避幅・cooldown）
    bossSequence: BOSS_SEQUENCE, // サイクルごとのボス巡回順
    bossFirewallHp: BOSS_FIREWALL_HP,
    bossWormHp: BOSS_WORM_HP,
    bossGateHp: BOSS_GATE_HP,
    bossAttackInterval: BOSS_FIREWALL_LASER_INTERVAL, // Firewall Core のレーザー間隔
    firewallCoreAttackInterval: BOSS_FIREWALL_CORE_INTERVAL, // Firewall: ダメージ用コア供給間隔
    firewallMaxLasers: BOSS_FIREWALL_MAX_LASERS, // Firewall: 同時レーザー上限
    firewallSafeWidth: BOSS_FIREWALL_SAFE_WIDTH, // Firewall: 安全地帯の幅（回避可能性）
    bossWormAttackInterval: BOSS_WORM_SPAWN_INTERVAL, // Data Worm の追尾生成間隔
    wormAttackWarningDuration: BOSS_WORM_ATTACK_WARNING, // Data Worm の攻撃前警告時間
    wormHitCooldown: BOSS_WORM_HIT_COOLDOWN, // Data Worm の連続ダメージ防止 cooldown
    wormSpeed: BOSS_WORM_SPEED, // Data Worm の左右移動速度
    wormMaxMinions: BOSS_WORM_MAX_MINIONS, // Data Worm の同時追尾上限
    bossGateAttackInterval: BOSS_GATE_WALL_INTERVAL, // Security Gate の壁供給間隔
    gateMinGap: BOSS_GATE_MIN_GAP, // Security Gate の最小通過幅（回避可能性）
    bossWarningDuration: BOSS_WARNING_SEC,
    bossDefeatDuration: BOSS_DEFEAT_SEC,
    // イベント（効果時間・間隔・初回待機・警告・倍率・出現率・同時上限）
    eventDuration: EVENT_DURATION_SEC,
    eventInterval: EVENT_MIN_INTERVAL_SEC,
    eventFirstDelay: EVENT_FIRST_DELAY_SEC, // 初回イベントまでの猶予
    eventWarningDuration: EVENT_WARNING_SEC, // 事前警告が要るイベントの警告時間
    coreRushMultiplier: EVENT_CORE_RUSH_MULT, // CORE RUSH のコア出現倍率
    highSpeedMultiplier: EVENT_HIGH_SPEED_MULT, // HIGH SPEED の障害物速度倍率
    laserStormRate: EVENT_LASER_STORM_RATE, // LASER STORM の追加レーザー出現率
    laserStormMax: EVENT_LASER_STORM_MAX, // LASER STORM の同時レーザー上限
    // Hardcore のウェーブ／ボス補正（回避不能化はしない＝ <1 の時間短縮係数）
    hardcoreWaveFactor: HARDCORE_WAVE_SPEED_FACTOR,
    hardcoreBossIntervalFactor: HARDCORE_BOSS_INTERVAL_FACTOR,
    // スコア / XP 倍率（既存挙動 = 1。変更はランキング影響あり）
    scoreMultiplier: 1,
    xpMultiplier: 1
};

// preset 一覧（現状は既定のみ。将来の調整版はここに追加し版数を上げる）。
export const BALANCE_PRESETS = {
    default: DEFAULT_PRESET
};

export const DEFAULT_BALANCE_PRESET_ID = 'default';
