// ===================================
// model/balance.js — 選択中バランス preset の単一参照点（Phase 13）
//
// 責務: 現在選択中の balance preset と BALANCE_VERSION を「一箇所」で保持・参照する。
//   各プレイの分析へ記録する balance_version はここから取得する。
//   本番ユーザー向けの preset 選択 UI は追加しない（Training での確認のみ）。
//
// 依存方向: config/balance-presets。DOM/Canvas/通信に触れない。
// ===================================

import { BALANCE_PRESETS, BALANCE_VERSION, DEFAULT_BALANCE_PRESET_ID } from '../config/balance-presets.js';

let selectedId = DEFAULT_BALANCE_PRESET_ID;

// 選択中 preset（生参照・内部用）。不正/未知 ID は安全に既定 preset へフォールバックする。
//   毎フレーム呼ばれるアクセサがあるため、ここでは複製せず参照を返す（読み取り専用で使う）。
function active() {
    return BALANCE_PRESETS[selectedId] || BALANCE_PRESETS[DEFAULT_BALANCE_PRESET_ID];
}

// 分析・表示に記録するバランス版数。
export function getBalanceVersion() {
    return BALANCE_VERSION;
}

// 選択中 preset のコピー（参照を漏らさない＝外部公開用）。
export function getActivePreset() {
    return { ...active() };
}

export function getPresetId() {
    return selectedId;
}

// preset を切り替える（未知 ID は無視。UI は本番非公開＝主に Training/テスト用）。
export function setPreset(id) {
    if (BALANCE_PRESETS[id]) selectedId = id;
    return getActivePreset();
}

export function listPresetIds() {
    return Object.keys(BALANCE_PRESETS);
}

// preset を既定へ戻す（START/RETRY 用：Training で選んだ preset を通常モードへ持ち越さない）。
export function resetPreset() {
    selectedId = DEFAULT_BALANCE_PRESET_ID;
    return getActivePreset();
}

// ===================================
// 選択中 preset から個別バランス値を取り出す（Wave/Boss/Event の単一参照点）。
//   各 model/controller は config 定数を直接参照せず、ここを通すことで
//   balance_version と実際の設定を必ず一致させる。
// ===================================

// --- Wave（進行・難易度・時間・spawn 補正） ---

// 1サイクルのウェーブ列（進行順）。読み取り専用で使う（変更しない）。
export function getWaveSequence() {
    return active().waveSequence;
}

// 通常ウェーブ長（秒）の基準値（Hardcore 補正は waves.js が掛ける）。
export function getWaveDurationBase() {
    return active().waveDuration;
}

// ウェーブ開始演出時間（秒）。
export function getWaveIntroDuration() {
    return active().waveIntroDuration;
}

// ウェーブ終了演出時間（秒）。
export function getWaveOutroDuration() {
    return active().waveOutroDuration;
}

// ウェーブ間の休憩時間（秒）。
export function getWaveIntermissionDuration() {
    return active().waveIntermissionDuration;
}

// ウェーブ種別ごとの追加出現率テーブル。読み取り専用で使う。
export function getWaveSpawnBoost() {
    return active().waveSpawnBoost;
}

// サイクルごとの難易度上昇係数。
export function getCycleDifficultyStep() {
    return active().cycleDifficultyStep;
}

// サイクルごとのボス HP 増加係数。
export function getCycleBossHpStep() {
    return active().cycleBossHpStep;
}

// --- Boss（順序・HP・攻撃間隔・警告/撃破・速度・上限・回避幅・cooldown） ---

// サイクルごとのボス巡回順。読み取り専用で使う。
export function getBossSequence() {
    return active().bossSequence;
}

// ボス種別ごとの基礎 HP（サイクルスケールは bosses.js が掛ける）。
export function getBossBaseHp(type) {
    const p = active();
    if (type === 'worm') return p.bossWormHp;
    if (type === 'gate') return p.bossGateHp;
    return p.bossFirewallHp;
}

// Firewall Core のレーザー攻撃間隔の基準値（Hardcore 補正は bosses.js が掛ける）。
export function getFirewallAttackIntervalBase() {
    return active().bossAttackInterval;
}

// Firewall Core のダメージ用コア供給間隔。
export function getFirewallCoreAttackInterval() {
    return active().firewallCoreAttackInterval;
}

// Firewall Core の同時レーザー上限（安全地帯を必ず残す）。
export function getFirewallMaxLasers() {
    return active().firewallMaxLasers;
}

// Firewall Core の安全地帯の幅（回避可能性に影響）。
export function getFirewallSafeWidth() {
    return active().firewallSafeWidth;
}

// Data Worm の追尾障害物 生成間隔の基準値（Hardcore 補正は bosses.js が掛ける）。
export function getWormAttackIntervalBase() {
    return active().bossWormAttackInterval;
}

// Data Worm の攻撃前警告時間（秒）。
export function getWormAttackWarningDuration() {
    return active().wormAttackWarningDuration;
}

// Data Worm の連続ダメージ防止 cooldown（秒）。
export function getWormHitCooldown() {
    return active().wormHitCooldown;
}

// Data Worm の左右移動速度（px/秒）。
export function getWormSpeed() {
    return active().wormSpeed;
}

// Data Worm の同時追尾障害物 上限。
export function getWormMaxMinions() {
    return active().wormMaxMinions;
}

// Security Gate の隙間壁 供給間隔の基準値（Hardcore 補正は bosses.js が掛ける）。
export function getGateAttackIntervalBase() {
    return active().bossGateAttackInterval;
}

// Security Gate の最小通過幅（回避可能性を保証）。
export function getGateMinGap() {
    return active().gateMinGap;
}

// ボス出現前の警告時間（秒）。
export function getBossWarningDuration() {
    return active().bossWarningDuration;
}

// ボス撃破演出時間（秒）。
export function getBossDefeatDuration() {
    return active().bossDefeatDuration;
}

// --- Event（効果時間・間隔・初回待機・警告・倍率・出現率・上限） ---

// ランダムイベントの効果時間（秒）。
export function getEventDurationSec() {
    return active().eventDuration;
}

// ランダムイベントの最小間隔（秒）。
export function getEventIntervalSec() {
    return active().eventInterval;
}

// 初回イベントまでの猶予（秒）。
export function getEventFirstDelay() {
    return active().eventFirstDelay;
}

// 事前警告が要るイベントの警告時間（秒）。
export function getEventWarningDuration() {
    return active().eventWarningDuration;
}

// CORE RUSH のコア出現倍率。
export function getCoreRushMultiplier() {
    return active().coreRushMultiplier;
}

// HIGH SPEED の障害物速度倍率。
export function getHighSpeedMultiplier() {
    return active().highSpeedMultiplier;
}

// LASER STORM の追加レーザー出現率。
export function getLaserStormRate() {
    return active().laserStormRate;
}

// LASER STORM の同時レーザー上限（安全地帯を必ず残す）。
export function getLaserStormMax() {
    return active().laserStormMax;
}

// --- Hardcore 補正 ---

// Hardcore のウェーブ時間短縮係数（<1）。回避不能化はしない。
export function getHardcoreWaveFactor() {
    return active().hardcoreWaveFactor;
}

// Hardcore のボス攻撃間隔短縮係数（<1）。回避不能化はしない。
export function getHardcoreBossIntervalFactor() {
    return active().hardcoreBossIntervalFactor;
}

// 表示用の短い要約（Training のバランス確認に使用）。
export function describeBalance() {
    const p = getActivePreset();
    return `BALANCE v${BALANCE_VERSION} (${p.label || p.id})`;
}
