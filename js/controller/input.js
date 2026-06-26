// ===================================
// controller/input.js — キーボード入力（Stage 5）
//
// 責務: 左右移動キー（ArrowLeft/ArrowRight/A/D）の keydown/keyup と、
//       blur 時のキー解除。イベントの登録/解除と重複登録防止。
//
// 依存方向: state（player の入力フラグ）を更新する。View/他Controller は import しない。
// 入力状態は player.moveLeft / player.moveRight に保持（従来挙動）。
// ===================================

import { player } from '../state.js';

let registered = false;
let keydownHandler = null;
let keyupHandler = null;
let blurHandler = null;

// 入力イベントを登録する（重複登録を防止：2回目以降は何もしない）。
export function registerInput() {
    if (registered) return;
    registered = true;

    keydownHandler = (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
            player.moveLeft = true;
        }
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
            player.moveRight = true;
        }
    };

    keyupHandler = (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
            player.moveLeft = false;
        }
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
            player.moveRight = false;
        }
    };

    // ウィンドウのフォーカスを失ったときはキー状態をリセットして入力ループ停止を防ぐ
    blurHandler = () => {
        player.moveLeft = false;
        player.moveRight = false;
    };

    document.addEventListener('keydown', keydownHandler);
    document.addEventListener('keyup', keyupHandler);
    window.addEventListener('blur', blurHandler);
}

// 入力イベントを解除する（登録済みのときのみ）。
export function unregisterInput() {
    if (!registered) return;
    document.removeEventListener('keydown', keydownHandler);
    document.removeEventListener('keyup', keyupHandler);
    window.removeEventListener('blur', blurHandler);
    registered = false;
}
