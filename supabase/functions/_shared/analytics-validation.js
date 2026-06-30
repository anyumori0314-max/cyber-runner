// ===================================
// supabase/functions/_shared/analytics-validation.js
//   匿名ゲームプレイ分析の「依存ゼロ・純粋関数」検証ロジック（Deno / Node 共有）。
//
//   方針: 個人を特定しない 1 プレイ 1 件の要約のみを受け付ける。許可フィールド以外は
//   すべて drop し、個人情報項目（player_name / email / user_id / IP / run_id 等）は
//   そもそも cleaned に含めない（保存しない）。異常値は拒否する。
//
//   ※ 外部依存・ランタイム API 不使用。Edge Function と Node テストの双方から import 可能。
// ===================================

// 分析対象モード（Training は対象外＝拒否）。
export const ANALYTICS_ALLOWED_MODES = ['endless', 'timeattack', 'hardcore'];
export const ANALYTICS_DEATH_CAUSES = ['obstacle', 'laser', 'homing', 'gapwall', 'boss', 'finish', 'quit', 'unknown'];
export const ANALYTICS_DEVICE_CLASSES = ['mobile', 'tablet', 'desktop', 'unknown'];
export const ANALYTICS_PWA_MODES = ['standalone', 'browser', 'unknown'];

// 受け付ける許可フィールド（cleaned はこの集合のみ。created_at はサーバー側で付与）。
export const ANALYTICS_ALLOWED_FIELDS = [
    'event_id', 'game_version', 'balance_version', 'mode', 'score', 'duration_ms',
    'reached_level', 'max_combo', 'core_count', 'near_miss_count', 'dash_count',
    'death_cause', 'wave_reached', 'boss_reached', 'boss_defeated', 'powerups_collected',
    'pwa_mode', 'device_class'
];

// 絶対に保存しない項目（混入していたら拒否＝防御）。
export const ANALYTICS_FORBIDDEN_FIELDS = [
    'player_name', 'email', 'user_id', 'anonymous_player_id', 'ip', 'ip_address',
    'location', 'lat', 'lng', 'user_agent', 'ua', 'fingerprint', 'run_id',
    'replay', 'ghost', 'created_at'
];

export const ANALYTICS_LIMITS = {
    SCORE_MAX: 1000000000,
    COMBO_MAX: 1000000,
    DURATION_MAX_MS: 60 * 60 * 1000,
    DURATION_MIN_MS: 0,
    LEVEL_MAX: 100000,
    COUNT_MAX: 1000000, // core/near_miss/dash/powerups
    WAVE_MAX: 100000,
    BOSS_MAX: 100000,
    EVENT_ID_MIN: 8,
    EVENT_ID_MAX: 64,
    VERSION_MAX: 32,
    PAYLOAD_MAX_BYTES: 2048
};

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const intInRange = (v, min, max) => isFiniteNumber(v) && Number.isInteger(v) && v >= min && v <= max;

// payload のバイトサイズ（おおよそ）。
export function analyticsPayloadBytes(payload) {
    try {
        return new TextEncoder().encode(JSON.stringify(payload)).length;
    } catch (_e) {
        return JSON.stringify(payload || '').length;
    }
}

// 分析ペイロードを検証する。errors[] が空なら ok。cleaned は許可フィールドのみ。
export function validateAnalyticsPayload(payload) {
    const errors = [];
    const p = payload && typeof payload === 'object' ? payload : {};

    // 0) payload サイズ制限
    if (analyticsPayloadBytes(p) > ANALYTICS_LIMITS.PAYLOAD_MAX_BYTES) errors.push('payload too large');

    // 1) 個人情報項目の混入を拒否（防御）。
    for (const k of ANALYTICS_FORBIDDEN_FIELDS) {
        if (k in p) errors.push(`forbidden field: ${k}`);
    }

    // 2) 必須の文字列
    if (typeof p.event_id !== 'string' || p.event_id.length < ANALYTICS_LIMITS.EVENT_ID_MIN || p.event_id.length > ANALYTICS_LIMITS.EVENT_ID_MAX) {
        errors.push('invalid event_id');
    }
    if (typeof p.game_version !== 'string' || p.game_version.length === 0 || p.game_version.length > ANALYTICS_LIMITS.VERSION_MAX) errors.push('invalid game_version');
    if (typeof p.balance_version !== 'string' || p.balance_version.length === 0 || p.balance_version.length > ANALYTICS_LIMITS.VERSION_MAX) errors.push('invalid balance_version');

    // 3) 列挙値
    if (!ANALYTICS_ALLOWED_MODES.includes(p.mode)) errors.push('invalid mode'); // training は弾く
    if (!ANALYTICS_DEATH_CAUSES.includes(p.death_cause)) errors.push('invalid death_cause');
    if (!ANALYTICS_DEVICE_CLASSES.includes(p.device_class)) errors.push('invalid device_class');
    if (!ANALYTICS_PWA_MODES.includes(p.pwa_mode)) errors.push('invalid pwa_mode');

    // 4) 数値（範囲チェック）
    if (!intInRange(p.score, 0, ANALYTICS_LIMITS.SCORE_MAX)) errors.push('invalid score');
    if (!intInRange(p.duration_ms, ANALYTICS_LIMITS.DURATION_MIN_MS, ANALYTICS_LIMITS.DURATION_MAX_MS)) errors.push('invalid duration_ms');
    if (!intInRange(p.reached_level, 0, ANALYTICS_LIMITS.LEVEL_MAX)) errors.push('invalid reached_level');
    if (!intInRange(p.max_combo, 0, ANALYTICS_LIMITS.COMBO_MAX)) errors.push('invalid max_combo');
    if (!intInRange(p.core_count, 0, ANALYTICS_LIMITS.COUNT_MAX)) errors.push('invalid core_count');
    if (!intInRange(p.near_miss_count, 0, ANALYTICS_LIMITS.COUNT_MAX)) errors.push('invalid near_miss_count');
    if (!intInRange(p.dash_count, 0, ANALYTICS_LIMITS.COUNT_MAX)) errors.push('invalid dash_count');
    if (!intInRange(p.wave_reached, 0, ANALYTICS_LIMITS.WAVE_MAX)) errors.push('invalid wave_reached');
    if (!intInRange(p.boss_reached, 0, ANALYTICS_LIMITS.BOSS_MAX)) errors.push('invalid boss_reached');
    if (!intInRange(p.boss_defeated, 0, ANALYTICS_LIMITS.BOSS_MAX)) errors.push('invalid boss_defeated');
    if (!intInRange(p.powerups_collected, 0, ANALYTICS_LIMITS.COUNT_MAX)) errors.push('invalid powerups_collected');
    // boss_defeated は boss_reached を超えない（論理整合）。
    if (intInRange(p.boss_defeated, 0, ANALYTICS_LIMITS.BOSS_MAX) && intInRange(p.boss_reached, 0, ANALYTICS_LIMITS.BOSS_MAX) && p.boss_defeated > p.boss_reached) {
        errors.push('boss_defeated exceeds boss_reached');
    }

    const cleaned = errors.length === 0
        ? {
            event_id: p.event_id,
            game_version: p.game_version,
            balance_version: p.balance_version,
            mode: p.mode,
            score: p.score,
            duration_ms: p.duration_ms,
            reached_level: p.reached_level,
            max_combo: p.max_combo,
            core_count: p.core_count,
            near_miss_count: p.near_miss_count,
            dash_count: p.dash_count,
            death_cause: p.death_cause,
            wave_reached: p.wave_reached,
            boss_reached: p.boss_reached,
            boss_defeated: p.boss_defeated,
            powerups_collected: p.powerups_collected,
            pwa_mode: p.pwa_mode,
            device_class: p.device_class
            // created_at はサーバー側で付与（クライアント値は採用しない）。
        }
        : null;

    return { ok: errors.length === 0, errors, cleaned };
}

// 簡易レート制限（直近送信時刻の配列で windowMs 内 max 件以上なら拒否）。score 側と同契約。
export function isAnalyticsRateLimited(recentTimestamps, now, windowMs = 60000, max = 20) {
    if (!Array.isArray(recentTimestamps)) return false;
    const since = now - windowMs;
    return recentTimestamps.filter((t) => isFiniteNumber(t) && t >= since).length >= max;
}
