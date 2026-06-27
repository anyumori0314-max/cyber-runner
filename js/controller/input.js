// ===================================
// controller/input.js — キーボード入力（Phase 4 で拡張）
//
// 責務: 左右移動（Arrow/A/D）、SPACE ダッシュ、ESC 一時停止の keydown/keyup と、
//   blur 時のキー解除。イベントの登録/解除と重複登録防止。
//   ダッシュ・一時停止のロジックは controller(game-loop) が持ち、ここはコールバック発火のみ。
//
// 依存方向: state（player の入力フラグ・lastMoveDirection）を更新。callbacks は main 注入。
// ===================================

import { player, gameState } from '../state.js';

let registered = false;
let keydownHandler = null;
let keyupHandler = null;
let blurHandler = null;

// main.js から注入されるコールバック（controller のロジックへ橋渡し）。
let callbacks = {
    onPause: () => {},
    onDash: () => {}
};

export function configureInput(cb) {
    callbacks = { ...callbacks, ...cb };
}

// プレイヤーの移動キー状態をクリアする（一時停止・blur 用）。
export function clearKeys() {
    player.moveLeft = false;
    player.moveRight = false;
}

// 入力イベントを登録する（重複登録を防止：2回目以降は何もしない）。
export function registerInput() {
    if (registered) return;
    registered = true;

    keydownHandler = (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
            player.moveLeft = true;
            gameState.lastMoveDirection = -1;
        }
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
            player.moveRight = true;
            gameState.lastMoveDirection = 1;
        }
        if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault(); // SPACE によるページスクロールを防ぐ
            callbacks.onDash();
        }
        if (e.key === 'Escape' || e.key === 'Esc') {
            callbacks.onPause();
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
        clearKeys();
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
