// ===================================
// model/options.js — ユーザー設定（Phase 2）
//
// 責務: オプション設定（サウンド/音量/画面揺れ/パーティクル/操作説明）の保持・
//   検証・永続化。破損値や例外時は既定値へフォールバックする純粋な状態管理。
//
// 依存方向: config（既定値・キー）と util/storage（安全な保存・読込）。DOM に触れない。
//   表示は view/options-view.js、効果適用は controller/main が担当する（責務分離）。
// ===================================

import { OPTIONS_STORAGE_KEY, DEFAULT_OPTIONS } from '../config.js';
import { loadJSON, saveJSON } from '../util/storage.js';

// 現在のオプション（単一の真実の源。既定値のコピーで初期化）。
let options = { ...DEFAULT_OPTIONS };

// 破損・部分欠落・不正値に対して、フィールドごとに型/範囲を検証して既定値で補完する。
function sanitize(raw) {
    const o = { ...DEFAULT_OPTIONS };
    if (raw && typeof raw === 'object') {
        if (typeof raw.soundEnabled === 'boolean') o.soundEnabled = raw.soundEnabled;
        if (typeof raw.soundVolume === 'number' && Number.isFinite(raw.soundVolume) && raw.soundVolume >= 0 && raw.soundVolume <= 1) {
            o.soundVolume = raw.soundVolume;
        }
        if (typeof raw.screenShakeEnabled === 'boolean') o.screenShakeEnabled = raw.screenShakeEnabled;
        if (typeof raw.particlesEnabled === 'boolean') o.particlesEnabled = raw.particlesEnabled;
        if (typeof raw.showControls === 'boolean') o.showControls = raw.showControls;
        // Phase 12: touchControls は 'auto' | true | false の三状態（既定 'auto'）。
        if (raw.touchControls === true || raw.touchControls === false || raw.touchControls === 'auto') {
            o.touchControls = raw.touchControls;
        }
    }
    return o;
}

// localStorage から読み込み（JSON 破損・例外時は既定値）。
export function loadOptions() {
    options = sanitize(loadJSON(OPTIONS_STORAGE_KEY, DEFAULT_OPTIONS));
    return options;
}

// 現在のオプションを取得（参照ではなくコピーを返す）。
export function getOptions() {
    return { ...options };
}

// 1項目を更新して保存する（不明キーは無視）。
export function setOption(key, value) {
    if (!(key in DEFAULT_OPTIONS)) return getOptions();
    options = sanitize({ ...options, [key]: value });
    saveJSON(OPTIONS_STORAGE_KEY, options);
    return getOptions();
}
