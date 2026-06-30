// ===================================
// services/pwa-service.js — Service Worker 登録と更新検出（Phase 12）
//
// 責務: Service Worker の登録、新バージョン検出の通知、ユーザー操作による更新適用。
//   DOM/Canvas は触らない（更新バナー等の表示は main/view が担当）。SW 非対応・登録失敗・
//   いかなる例外でも throw せず、通常版（SW なし）でゲームが動くようにする。
//
// 依存方向: なし（navigator.serviceWorker のみ）。GitHub Pages のサブパスでも動く相対設計。
// ===================================

let refreshing = false; // controllerchange による二重リロード防止

// オンライン/オフライン状態（送信可否の安全判定に使う）。
export function isOnline() {
    try {
        return navigator.onLine !== false;
    } catch (_e) {
        return true;
    }
}

// Service Worker を登録する。失敗してもゲームは継続（戻り値 null）。
//   opts.onUpdateAvailable(applyUpdate): 新バージョン検出時に呼ばれる。applyUpdate() を
//   ユーザー操作（更新ボタン）で呼ぶと、待機中 SW を有効化してリロードする。
export async function registerServiceWorker(opts = {}) {
    const { onUpdateAvailable = () => {}, swUrl = './sw.js', scope = './' } = opts;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;

    try {
        const reg = await navigator.serviceWorker.register(swUrl, { scope });

        // 既に待機中の更新があれば即通知（前回ロード時に install 済みのケース）。
        if (reg.waiting && navigator.serviceWorker.controller) {
            onUpdateAvailable(() => activateUpdate(reg));
        }

        // 新しい SW を検出 → installed かつ既存 controller あり = 更新あり。
        reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
                if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                    onUpdateAvailable(() => activateUpdate(reg));
                }
            });
        });

        // 新 SW が制御を開始したら一度だけリロード（プレイ中は activateUpdate を呼ばない）。
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            try { window.location.reload(); } catch (_e) { /* noop */ }
        });

        return reg;
    } catch (err) {
        // 登録失敗でもゲームは通常版で継続。
        console.warn('Service worker registration failed:', err);
        return null;
    }
}

// 待機中 SW を有効化する（ユーザー操作時のみ呼ぶ）。controllerchange でリロードされる。
function activateUpdate(reg) {
    try {
        const waiting = reg && reg.waiting;
        if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch (err) {
        console.warn('Service worker update failed:', err);
    }
}
