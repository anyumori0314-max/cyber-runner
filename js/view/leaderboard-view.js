// ===================================
// view/leaderboard-view.js — リーダーボード表示（Stage 4）
//
// 責務: GLOBAL TOP 10 の描画 / ランキング状態表示 / SEND SCORE ボタン状態 /
//       送信成功・失敗表示 / プレイヤー名取得・入力長制限。
//
// Supabase 通信そのものは services/leaderboard.js に残す。本モジュールは表示のみ。
// 依存方向: config（名前定数）と services/leaderboard（送信状態 leaderboardState を読取）。
//   View コールバックは main.js が configureLeaderboard() で services へ注入する。
// 安全性: プレイヤー名は textContent で表示し、innerHTML へユーザー入力を入れない。
// ===================================

import { DEFAULT_PLAYER_NAME, PLAYER_NAME_MAX_LENGTH } from '../config.js';
import { leaderboardState } from '../services/leaderboard.js';

// main.js から注入される DOM 参照。
let refs = {
    leaderboardList: null,
    leaderboardStatus: null,
    sendScoreBtn: null,
    playerNameInput: null
};

export function configureLeaderboardView(elements) {
    refs = { ...refs, ...elements };
}

// GLOBAL TOP 10 を描画する（名前は textContent で安全に表示）。
export function renderLeaderboard(scores) {
    if (!refs.leaderboardList) return;
    refs.leaderboardList.innerHTML = '';
    if (!scores || scores.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.className = 'leaderboard-empty';
        emptyItem.textContent = 'No scores yet';
        refs.leaderboardList.appendChild(emptyItem);
        return;
    }
    scores.forEach((entry) => {
        const item = document.createElement('li');
        const name = document.createElement('span');
        const score = document.createElement('span');
        name.className = 'leaderboard-name';
        score.className = 'leaderboard-score';
        name.textContent = `${entry.player_name || DEFAULT_PLAYER_NAME} [${entry.rank || '-'}]`;
        score.textContent = `${Number(entry.score || 0)} / C${Number(entry.max_combo || 0)}`;
        item.appendChild(name);
        item.appendChild(score);
        refs.leaderboardList.appendChild(item);
    });
}

// 取得失敗時の表示（静的文言のみ。ユーザー入力は含めない）。
export function renderUnavailable() {
    if (refs.leaderboardList) {
        refs.leaderboardList.innerHTML = '<li class="leaderboard-empty">Leaderboard unavailable</li>';
    }
}

// ランキング状態テキスト（成功・失敗・送信中）の表示。
export function setLeaderboardStatus(message, isError = false) {
    if (!refs.leaderboardStatus) return;
    refs.leaderboardStatus.textContent = message || '';
    refs.leaderboardStatus.classList.toggle('error', Boolean(isError));
}

// SEND SCORE ボタンの状態（送信中 disabled / 送信済み SENT / 通常）。
export function updateSendScoreButton() {
    if (!refs.sendScoreBtn) return;
    refs.sendScoreBtn.disabled = leaderboardState.isSubmitting || leaderboardState.hasSubmitted;
    if (leaderboardState.isSubmitting) {
        refs.sendScoreBtn.textContent = 'SENDING...';
    } else if (leaderboardState.hasSubmitted) {
        refs.sendScoreBtn.textContent = 'SENT';
    } else {
        refs.sendScoreBtn.textContent = 'SEND SCORE';
    }
}

// 入力欄の生プレイヤー名を取得（services が正規化する）。
export function getRawName() {
    return refs.playerNameInput ? refs.playerNameInput.value : '';
}

// プレイヤー名入力欄をクリア（GAME OVER 表示時に使用）。
export function clearPlayerName() {
    if (refs.playerNameInput) refs.playerNameInput.value = '';
}

// 入力長を最大文字数に制限する（input イベントハンドラ）。
export function enforceNameMaxLength() {
    if (!refs.playerNameInput) return;
    if (refs.playerNameInput.value.length > PLAYER_NAME_MAX_LENGTH) {
        refs.playerNameInput.value = refs.playerNameInput.value.slice(0, PLAYER_NAME_MAX_LENGTH);
    }
}
