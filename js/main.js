// ===================================
// main.js — アプリケーションのエントリーポイント（Stage 5）
//
// 責務: DOM 取得 / 各層（Model・View・Controller）と Services・Audio・Error の配線 /
//       イベント配線 / アプリ起動。ゲームルール・描画・通信ロジックはここに書かない
//       （それぞれ model / view / services が所有する）。
//
// 依存方向: main → controller → model / view / services / audio / util（一方向・循環なし）。
// ===================================

import { gameState } from './state.js';
import { configureLeaderboard, loadLeaderboard, handleSendScore } from './services/leaderboard.js';
import { AudioManager } from './audio/audio-manager.js';
import { configureErrors, registerGlobalErrorHandlers } from './util/errors.js';

import { configureHud, updateHud, updateSoundButton } from './view/hud.js';
import { configureScreens, setFinalHighScore } from './view/screens.js';
import { configureTitleAnimation, startTitleAnimation } from './view/title-animation.js';
import {
    configureLeaderboardView,
    renderLeaderboard,
    renderUnavailable,
    setLeaderboardStatus,
    updateSendScoreButton,
    getRawName,
    enforceNameMaxLength
} from './view/leaderboard-view.js';

import { configureGameLoop, startGame, stopLoop } from './controller/game-loop.js';
import { registerInput } from './controller/input.js';

// ===================================
// 1. DOM 取得
// ===================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const titleScreen = document.getElementById('titleScreen');
const gameScreen = document.getElementById('gameScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const startBtn = document.getElementById('startBtn');
const retryBtn = document.getElementById('retryBtn');
const currentScoreDisplay = document.getElementById('currentScore');
const finalScoreDisplay = document.getElementById('finalScore');
const highScoreTitleDisplay = document.getElementById('highScoreTitle');
const finalHighScoreDisplay = document.getElementById('finalHighScore');
const currentLevelDisplay = document.getElementById('currentLevel');
const comboTextDisplay = document.getElementById('comboText');
const rankDisplay = document.getElementById('rankDisplay');
const maxComboResultDisplay = document.getElementById('maxComboResult');
const rankMessageDisplay = document.getElementById('rankMessage');
const playerNameInput = document.getElementById('playerNameInput');
const sendScoreBtn = document.getElementById('sendScoreBtn');
const leaderboardStatusDisplay = document.getElementById('leaderboardStatus');
const leaderboardListDisplay = document.getElementById('leaderboardList');
const titleCanvas = document.getElementById('titleCanvas');
const muteBtn = document.getElementById('muteBtn');

// パワーアップ状態表示はゲームヘッダーに動的生成して差し込む（従来挙動）。
const powerupStatusDisplay = document.createElement('div');
powerupStatusDisplay.className = 'powerup-display';
powerupStatusDisplay.id = 'powerupStatus';
const gameHeader = document.querySelector('.game-header');
if (gameHeader) gameHeader.appendChild(powerupStatusDisplay);

// ===================================
// 2. View 初期化（DOM 参照を各 View モジュールへ注入）
// ===================================
configureHud({
    currentScore: currentScoreDisplay,
    currentLevel: currentLevelDisplay,
    highScoreTitle: highScoreTitleDisplay,
    comboText: comboTextDisplay,
    powerupStatus: powerupStatusDisplay,
    muteBtn
});
configureScreens({
    titleScreen,
    gameScreen,
    gameOverScreen,
    finalScore: finalScoreDisplay,
    finalHighScore: finalHighScoreDisplay,
    rankDisplay,
    rankMessage: rankMessageDisplay,
    maxComboResult: maxComboResultDisplay
});
configureTitleAnimation({ titleCanvas, titleScreen });
configureLeaderboardView({
    leaderboardList: leaderboardListDisplay,
    leaderboardStatus: leaderboardStatusDisplay,
    sendScoreBtn,
    playerNameInput
});

// ===================================
// 3. Controller 初期化（Canvas / ctx を注入）
// ===================================
configureGameLoop({ canvas, ctx });

// ===================================
// 4. Services 設定（通信と DOM の境界：View コールバックを注入）
// ===================================
configureLeaderboard({
    render: renderLeaderboard,
    renderUnavailable,
    setStatus: setLeaderboardStatus,
    updateButton: updateSendScoreButton,
    getRawName
});

// ===================================
// 5. エラー処理設定（ゲーム状態に依存する復旧 = ループ停止を注入）
// ===================================
configureErrors({
    onError: () => {
        // 例外時はループを停止して二重 RAF を防ぐ
        stopLoop();
    }
});
registerGlobalErrorHandlers();

// ===================================
// 6. 入力配線（keydown / keyup / blur・重複登録防止）
// ===================================
registerInput();

// ===================================
// 7. イベント配線（ボタン・入力欄・ミュート）
// ===================================
if (startBtn) startBtn.addEventListener('click', startGame);
if (retryBtn) retryBtn.addEventListener('click', startGame);
if (sendScoreBtn) sendScoreBtn.addEventListener('click', handleSendScore);
if (playerNameInput) playerNameInput.addEventListener('input', enforceNameMaxLength);
if (muteBtn) {
    muteBtn.addEventListener('click', () => {
        AudioManager.toggleMute();
        updateSoundButton(AudioManager.muted);
    });
}

// ===================================
// 8. アプリ起動（初期表示・リーダーボード読込・タイトルアニメ）
// ===================================
function init() {
    // ハイスコアを表示（HUD のタイトル表示 + 結果画面のハイスコア表示）
    updateHud();
    setFinalHighScore(gameState.highScore);

    updateSendScoreButton();
    loadLeaderboard();
}

init();
startTitleAnimation();
updateSoundButton(AudioManager.muted);
