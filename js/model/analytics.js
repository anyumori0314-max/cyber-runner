// ===================================
// model/analytics.js — 匿名分析の同意と payload 構築（Phase 13）
//
// 責務: 分析同意状態の保持（既定 OFF）、1 プレイ 1 件の要約 payload の構築、端末分類/
//   PWA モードの粗い判定。個人を特定する項目は一切含めない（player_name/IP/user_id 等なし）。
//   送信可否（同意・オンライン・モード）の最終判断と送信は main + services/analytics-service。
//
// 依存方向: config / model/balance / util/storage。DOM は触らない（navigator/window は guard 付き）。
// ===================================

import { GAME_VERSION, ANALYTICS_CONSENT_STORAGE_KEY, ANALYTICS_MODES } from '../config.js';
import { getBalanceVersion } from './balance.js';
import { loadString, saveString } from '../util/storage.js';

// 同意状態（初期 OFF。'granted' のときだけ true）。
export function hasConsent() {
    return loadString(ANALYTICS_CONSENT_STORAGE_KEY, '') === 'granted';
}

// 同意の設定（撤回も可能）。保存は安全な storage utility 経由。
export function setConsent(granted) {
    saveString(ANALYTICS_CONSENT_STORAGE_KEY, granted ? 'granted' : 'denied');
    return hasConsent();
}

// 分析対象モードか（Training は対象外）。
export function isAnalyticsMode(mode) {
    return ANALYTICS_MODES.includes(mode);
}

// 1 プレイの一意 ID（個人 ID ではない。crypto があれば UUID）。
function newEventId() {
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (_e) { /* fallthrough */ }
    return 'evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

// 端末分類（粗い区分のみ＝指紋化しない）。
export function detectDeviceClass() {
    try {
        const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
        if (!touch) return 'desktop';
        const w = (typeof window !== 'undefined' && window.screen) ? Math.min(window.screen.width, window.screen.height) : 0;
        if (w && w >= 768) return 'tablet';
        return 'mobile';
    } catch (_e) {
        return 'unknown';
    }
}

// PWA 表示モード（standalone / browser）。
export function detectPwaMode() {
    try {
        if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
        if (typeof navigator !== 'undefined' && navigator.standalone) return 'standalone';
        return 'browser';
    } catch (_e) {
        return 'unknown';
    }
}

// 非負整数へ正規化（上限クランプ）。
function clampInt(v, max) {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
}

// 分析 payload を構築する（許可フィールドのみ。created_at はサーバー側で付与）。
//   summary = { mode, score, durationMs, reachedLevel, maxCombo, coreCount, nearMissCount,
//               dashCount, deathCause, waveReached, bossReached, bossDefeated, powerupsCollected }
//   env: テスト用に eventId/gameVersion/balanceVersion/deviceClass/pwaMode を差し込める。
export function buildPayload(summary = {}, env = {}) {
    const s = summary || {};
    return {
        event_id: env.eventId || newEventId(),
        game_version: env.gameVersion || GAME_VERSION,
        balance_version: env.balanceVersion || getBalanceVersion(),
        mode: s.mode,
        score: clampInt(s.score, 1000000000),
        duration_ms: clampInt(s.durationMs, 3600000),
        reached_level: clampInt(s.reachedLevel, 100000),
        max_combo: clampInt(s.maxCombo, 1000000),
        core_count: clampInt(s.coreCount, 1000000),
        near_miss_count: clampInt(s.nearMissCount, 1000000),
        dash_count: clampInt(s.dashCount, 1000000),
        death_cause: typeof s.deathCause === 'string' ? s.deathCause : 'unknown',
        wave_reached: clampInt(s.waveReached, 100000),
        boss_reached: clampInt(s.bossReached, 100000),
        boss_defeated: clampInt(s.bossDefeated, 100000),
        powerups_collected: clampInt(s.powerupsCollected, 1000000),
        pwa_mode: env.pwaMode || detectPwaMode(),
        device_class: env.deviceClass || detectDeviceClass()
    };
}
