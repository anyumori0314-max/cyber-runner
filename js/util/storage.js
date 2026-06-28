// ===================================
// util/storage.js — localStorage の安全な JSON 読み書き（横断的関心）
//
// 責務: localStorage への JSON 保存・読込を try/catch で保護する。
//   localStorage が使えない / 例外を投げる / JSON 破損 のいずれでも throw せず、
//   フォールバック値を返す（ゲーム起動を止めない）。内部例外は console.warn のみ。
//
// 依存方向: なし（リーフ。DOM/Canvas/通信に触れない）。
// ===================================

// fallback を破壊しないための安全なディープコピー（プリミティブ/プレーンオブジェクト想定）。
function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (e) {
        return value;
    }
}

// JSON を読み込む。未設定・破損・例外時は fallback のコピーを返す。
export function loadJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw == null) return clone(fallback);
        return JSON.parse(raw);
    } catch (error) {
        console.warn(`Failed to load "${key}":`, error);
        return clone(fallback);
    }
}

// JSON を保存する。例外時は false を返す（ゲームは継続）。
export function saveJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.warn(`Failed to save "${key}":`, error);
        return false;
    }
}

// 文字列を読み込む。未設定・例外時は fallback を返す（匿名 ID など生文字列用）。
export function loadString(key, fallback = '') {
    try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : raw;
    } catch (error) {
        console.warn(`Failed to load string "${key}":`, error);
        return fallback;
    }
}

// 文字列を保存する。例外時は false を返す。
export function saveString(key, value) {
    try {
        localStorage.setItem(key, String(value));
        return true;
    } catch (error) {
        console.warn(`Failed to save string "${key}":`, error);
        return false;
    }
}
