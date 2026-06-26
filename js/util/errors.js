// ===================================
// util/errors.js — エラー処理とエラーオーバーレイ（Stage 2）
//
// 責務: 例外の安全な整形 / エラーオーバーレイ表示 / グローバル例外捕捉
//       （window 'error' / 'unhandledrejection'）。
//
// ゲームループの停止など「ゲーム状態に依存する復旧処理」は script.js が所有するため、
// configureErrors({ onError }) でコールバックを注入して委譲する（責務の分離）。
// console.error は使わず警告に留める方針も従来どおり維持。
// ===================================

// 最後に発生したエラー情報
let lastError = null;

// グローバル例外ハンドラの登録済み状態（重複登録防止のため）。
let handlersRegistered = false;

// ゲーム継続/停止に必要な復旧処理（ループ停止など）。script.js から注入する。
let onGameError = () => {};

// 復旧コールバックを注入する。
export function configureErrors({ onError } = {}) {
    if (typeof onError === 'function') onGameError = onError;
}

// デバッグ用に最後のエラーを参照する。
export function getLastError() {
    return lastError;
}

// エラーを画面表示するオーバーレイを生成
export function showErrorOverlay(message) {
    removeErrorOverlay();
    const overlay = document.createElement('div');
    overlay.id = 'errorOverlay';
    overlay.style.position = 'fixed';
    overlay.style.left = '10px';
    overlay.style.bottom = '10px';
    overlay.style.padding = '12px';
    overlay.style.background = 'rgba(255, 0, 0, 0.9)';
    overlay.style.color = '#fff';
    overlay.style.fontSize = '12px';
    overlay.style.zIndex = 9999;
    overlay.style.borderRadius = '6px';
    overlay.textContent = 'Error: ' + message;
    document.body.appendChild(overlay);
}

export function removeErrorOverlay() {
    const existing = document.getElementById('errorOverlay');
    if (existing) existing.remove();
}

// エラー状態をクリア（RETRY / リセット時に使用）。
export function clearError() {
    lastError = null;
    removeErrorOverlay();
}

// ユーザー向けの安全な固定メッセージを返す純粋関数。
// stack / URL / パス / 行番号 / 関数名 / 設定値などの内部情報は一切含めない。
export function getUserSafeErrorMessage() {
    return 'ゲーム中にエラーが発生しました。RETRYしてもう一度お試しください。';
}

// エラー発生時の共通処理（console.error は使わず警告で残す）
export function handleGameError(err) {
    try {
        // 内部調査用に詳細（stack など）を保持し、console にのみ残す
        const detail = err && err.stack ? (err.stack.toString()) : String(err);
        lastError = detail;
        // 開発者用に警告で残す（生のエラーを渡し stack も含めて確認可能にする）
        console.warn('Game error:', err);
        // ユーザー向け画面には内部情報を出さず、固定の安全な短文のみ表示する
        showErrorOverlay(getUserSafeErrorMessage());
    } catch (e) {
        // 最後の手段でログは残すが console.error を使わない
        console.warn('Error handling failed', e);
    }
    // 必要ならゲームを止める等の復旧処理は呼び出し側（script.js）へ委譲
    try {
        onGameError(err);
    } catch (e) {
        console.warn('Error recovery failed', e);
    }
}

// グローバルな例外捕捉を登録（console.error を出さないように警告レベルで処理）
// 複数回呼ばれてもハンドラは一組だけになるよう idempotent にする。
export function registerGlobalErrorHandlers() {
    if (handlersRegistered) {
        return;
    }
    handlersRegistered = true;

    window.addEventListener('error', (evt) => {
        handleGameError(evt.error || evt.message || 'Unknown error');
        // prevent default logging to console.error
        evt.preventDefault();
    });

    window.addEventListener('unhandledrejection', (evt) => {
        handleGameError(evt.reason || 'Unhandled rejection');
        evt.preventDefault();
    });
}
