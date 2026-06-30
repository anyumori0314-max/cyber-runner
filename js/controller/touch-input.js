// ===================================
// controller/touch-input.js — 画面上ボタンのタッチ操作（Phase 12）
//
// 責務: 左移動 / 右移動 / ダッシュ / 一時停止のオンスクリーンボタンを Pointer Events で扱う。
//   pointerdown/up/cancel/lostpointercapture とマルチタッチに対応し、指が画面外へ出ても
//   入力が残らないよう pointer capture と各種解除イベントで確実にクリアする。
//   タブ切替（visibilitychange）で全入力を解除。キーボード（input.js）と共存する。
//   ダッシュ/一時停止のロジックは controller(game-loop) が持ち、ここはコールバック発火のみ。
//
// 依存方向: state（player の入力フラグ・lastMoveDirection）を更新。callbacks は main 注入。
// ===================================

import { player, gameState } from '../state.js';

let registered = false;
let refs = { left: null, right: null, dash: null, pause: null, container: null };
let callbacks = { onDash: () => {}, onPause: () => {} };

// 方向ボタンごとに「押している pointerId 集合」を持ち、集合が空でなければ入力 ON。
// （マルチタッチで複数指が同じ方向を押しても、片方を離しただけでは解除されない。）
const leftPointers = new Set();
const rightPointers = new Set();

// タッチ端末か（PC では初期 OFF、タッチ端末では初期 ON にするための判定）。
export function isTouchDevice() {
    try {
        return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    } catch (_e) {
        return false;
    }
}

export function configureTouchInput(elements, cb = {}) {
    refs = { ...refs, ...elements };
    callbacks = { ...callbacks, ...cb };
}

// すべてのタッチ入力状態を解除する（RETRY / 画面遷移 / visibilitychange / pause 用）。
export function clearTouch() {
    leftPointers.clear();
    rightPointers.clear();
    syncMove();
    setPressed(refs.left, false);
    setPressed(refs.right, false);
    setPressed(refs.dash, false);
    setPressed(refs.pause, false);
}

// 集合の状態を player の移動フラグへ反映。
function syncMove() {
    player.moveLeft = leftPointers.size > 0;
    player.moveRight = rightPointers.size > 0;
}

// 押下の視覚表示（アクセシビリティ: 形/状態が分かるよう .pressed と aria-pressed）。
function setPressed(el, pressed) {
    if (!el) return;
    el.classList.toggle('pressed', pressed);
    el.setAttribute('aria-pressed', pressed ? 'true' : 'false');
}

// 方向ボタン（ホールド）の配線。
function bindHold(el, set, dir) {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch (_e) { /* 一部環境で未対応 */ }
        set.add(e.pointerId);
        gameState.lastMoveDirection = dir;
        syncMove();
        setPressed(el, true);
    });
    const release = (e) => {
        if (e && e.pointerId != null) set.delete(e.pointerId);
        else set.clear();
        syncMove();
        setPressed(el, set.size > 0);
    };
    // 指を離す / キャンセル / capture 喪失 / ボタン外へ出る、いずれでも確実に解除。
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    el.addEventListener('pointerleave', (e) => {
        // capture 中は pointerleave は飛ばないが、capture 非対応環境の保険。
        if (!el.hasPointerCapture || !el.hasPointerCapture(e.pointerId)) release(e);
    });
}

// タップボタン（ダッシュ / 一時停止）の配線。
function bindTap(el, fn) {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        setPressed(el, true);
        fn();
    });
    const up = () => setPressed(el, false);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('pointerleave', up);
}

// タッチ入力イベントを登録する（重複登録を防止：2回目以降は何もしない）。
export function registerTouchInput() {
    if (registered) return;
    registered = true;

    bindHold(refs.left, leftPointers, -1);
    bindHold(refs.right, rightPointers, 1);
    bindTap(refs.dash, () => callbacks.onDash());
    bindTap(refs.pause, () => callbacks.onPause());

    // タブ切替・最小化で全入力を解除（押しっぱなしの暴走防止）。
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') clearTouch();
    });
}

// 操作ボタンの表示 ON/OFF（オプション連動）。
export function setTouchControlsVisible(visible) {
    if (refs.container) refs.container.style.display = visible ? '' : 'none';
    if (!visible) clearTouch();
}
