// ===================================
// main.js — アプリケーションのエントリーポイント（Phase 2-5 配線）
//
// 責務: DOM 取得 / 各層（Model・View・Controller）と Services・Audio・Error の配線 /
//       イベント配線 / アプリ起動。ゲームルール・描画・通信ロジックはここに書かない
//       （それぞれ model / view / services が所有する）。
//
// 依存方向: main → controller → model / view / services / audio / util（一方向・循環なし）。
// ===================================

import { gameState } from './state.js';
import { configureLeaderboard, loadLeaderboard, loadTitleLeaderboard, handleSendScore } from './services/leaderboard.js';
import { AudioManager } from './audio/audio-manager.js';
import { configureErrors, registerGlobalErrorHandlers } from './util/errors.js';

import { loadOptions, getOptions, setOption } from './model/options.js';
import { loadAchievements } from './model/achievements.js';
import { formatMission } from './model/missions.js';

import { configureHud, updateHud, updateSoundButton } from './view/hud.js';
import {
    configureScreens,
    setFinalHighScore,
    showOptionsScreen,
    hideOptionsScreen,
    showAchievementsScreen,
    hideAchievementsScreen
} from './view/screens.js';
import { configureTitleAnimation, startTitleAnimation } from './view/title-animation.js';
import { configureOptionsView, renderOptions } from './view/options-view.js';
import { configureAchievementsView, renderAchievements } from './view/achievements-view.js';
import {
    configureLeaderboardView,
    renderLeaderboard,
    renderUnavailable,
    setLeaderboardStatus,
    updateSendScoreButton,
    getRawName,
    enforceNameMaxLength,
    renderTitleLeaderboard,
    renderTitleUnavailable,
    setTitleLeaderboardStatus
} from './view/leaderboard-view.js';

import {
    configureGameLoop,
    startGame,
    stopLoop,
    togglePause,
    resumeGame,
    backToTitle,
    doDash,
    prepareMission
} from './controller/game-loop.js';
import { registerInput, configureInput } from './controller/input.js';

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
// Phase 1: タイトル画面 TOP5
const titleLeaderboardList = document.getElementById('titleLeaderboardList');
const titleLeaderboardStatus = document.getElementById('titleLeaderboardStatus');
const titleReloadBtn = document.getElementById('titleReloadBtn');

// Phase 2-5: HUD 追加表示（2段目チップ）
const dashStatusDisplay = document.getElementById('dashStatus');
const nextRankDisplay = document.getElementById('nextRank');
const powerupTimersDisplay = document.getElementById('powerupTimers');
const missionStatusDisplay = document.getElementById('missionStatus');

// Phase 2/5: オーバーレイ画面
const pauseScreen = document.getElementById('pauseScreen');
const optionsScreen = document.getElementById('optionsScreen');
const achievementsScreen = document.getElementById('achievementsScreen');

// Phase 5: GAME OVER 追加表示 / タイトルのミッションプレビュー / 操作説明
const playTitleDisplay = document.getElementById('playTitle');
const missionResultDisplay = document.getElementById('missionResult');
const titleMissionDisplay = document.getElementById('titleMission');
const titleControls = document.getElementById('titleControls');

// Phase 2: オプションのフォーム部品
const optSoundEnabled = document.getElementById('optSoundEnabled');
const optSoundVolume = document.getElementById('optSoundVolume');
const optScreenShake = document.getElementById('optScreenShake');
const optParticles = document.getElementById('optParticles');
const optShowControls = document.getElementById('optShowControls');
const optionsBackBtn = document.getElementById('optionsBackBtn');

// Phase 2: ポーズオーバーレイのボタン
const resumeBtn = document.getElementById('resumeBtn');
const pauseOptionsBtn = document.getElementById('pauseOptionsBtn');
const pauseRestartBtn = document.getElementById('pauseRestartBtn');
const backToTitleBtn = document.getElementById('backToTitleBtn');

// タイトル/実績のボタン
const titleOptionsBtn = document.getElementById('titleOptionsBtn');
const achievementsBtn = document.getElementById('achievementsBtn');
const achievementsBackBtn = document.getElementById('achievementsBackBtn');
const achievementsList = document.getElementById('achievementsList');
const toastContainer = document.getElementById('toastContainer');

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
    muteBtn,
    // Phase 2-5 追加 HUD
    dashStatus: dashStatusDisplay,
    nextRank: nextRankDisplay,
    powerupTimers: powerupTimersDisplay,
    missionStatus: missionStatusDisplay
});
configureScreens({
    titleScreen,
    gameScreen,
    gameOverScreen,
    finalScore: finalScoreDisplay,
    finalHighScore: finalHighScoreDisplay,
    rankDisplay,
    rankMessage: rankMessageDisplay,
    maxComboResult: maxComboResultDisplay,
    // Phase 2/5 追加
    pauseScreen,
    optionsScreen,
    achievementsScreen,
    playTitle: playTitleDisplay,
    missionResult: missionResultDisplay
});
configureTitleAnimation({ titleCanvas, titleScreen });
configureLeaderboardView({
    leaderboardList: leaderboardListDisplay,
    leaderboardStatus: leaderboardStatusDisplay,
    sendScoreBtn,
    playerNameInput,
    titleLeaderboardList,
    titleLeaderboardStatus
});
configureAchievementsView({
    achievementsList,
    toastContainer
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
    getRawName,
    renderTitle: renderTitleLeaderboard,
    renderTitleUnavailable,
    setTitleStatus: setTitleLeaderboardStatus
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
// 6. オプションの効果適用（音量・操作説明表示）。値の保持・永続化は model 側。
// ===================================
function applyOptions(o) {
    AudioManager.setMuted(!o.soundEnabled);
    AudioManager.setVolume(o.soundVolume);
    updateSoundButton(AudioManager.muted);
    if (titleControls) titleControls.style.display = o.showControls ? '' : 'none';
}

// タイトルのミッションプレビューを現在の割り当てから更新する。
function updateTitleMission() {
    if (!titleMissionDisplay) return;
    titleMissionDisplay.textContent = gameState.mission
        ? `今回のミッション: ${formatMission(gameState.mission)}`
        : '';
}

// 配線：オプション UI（変更時に model 保存 → applyOptions で効果適用）
configureOptionsView(
    {
        soundEnabled: optSoundEnabled,
        soundVolume: optSoundVolume,
        screenShake: optScreenShake,
        particles: optParticles,
        showControls: optShowControls
    },
    applyOptions
);

// ===================================
// 7. 入力配線（keydown / keyup / blur・重複登録防止 + ダッシュ/ポーズのコールバック）
// ===================================
configureInput({ onPause: togglePause, onDash: doDash });
registerInput();

// ===================================
// 8. イベント配線（ボタン・入力欄・ミュート・オーバーレイ）
// ===================================
if (startBtn) startBtn.addEventListener('click', startGame);
// RETRY / RESTART は新しいミッションを割り当てて再開
const restart = () => {
    prepareMission();
    startGame();
};
if (retryBtn) retryBtn.addEventListener('click', restart);
if (sendScoreBtn) sendScoreBtn.addEventListener('click', handleSendScore);
if (playerNameInput) playerNameInput.addEventListener('input', enforceNameMaxLength);
if (muteBtn) {
    muteBtn.addEventListener('click', () => {
        AudioManager.toggleMute();
        updateSoundButton(AudioManager.muted);
        // オプションの SOUND と同期して永続化（UI も反映）
        setOption('soundEnabled', !AudioManager.muted);
        renderOptions();
    });
}
// Phase 1: タイトル TOP5 の再読み込み（二重 GET は services 側で抑止）
if (titleReloadBtn) titleReloadBtn.addEventListener('click', loadTitleLeaderboard);

// Phase 2: タイトル/ポーズからオプションを開く・閉じる
if (titleOptionsBtn) titleOptionsBtn.addEventListener('click', () => { renderOptions(); showOptionsScreen(); });
if (pauseOptionsBtn) pauseOptionsBtn.addEventListener('click', () => { renderOptions(); showOptionsScreen(); });
if (optionsBackBtn) optionsBackBtn.addEventListener('click', hideOptionsScreen);

// Phase 5: 実績一覧を開く・閉じる
if (achievementsBtn) achievementsBtn.addEventListener('click', () => { renderAchievements(); showAchievementsScreen(); });
if (achievementsBackBtn) achievementsBackBtn.addEventListener('click', hideAchievementsScreen);

// Phase 2: ポーズオーバーレイの操作
if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);
if (pauseRestartBtn) pauseRestartBtn.addEventListener('click', restart);
if (backToTitleBtn) {
    backToTitleBtn.addEventListener('click', () => {
        backToTitle();
        prepareMission();
        updateTitleMission();
        loadTitleLeaderboard();
    });
}

// ===================================
// 9. アプリ起動（オプション/実績ロード → 初期表示・リーダーボード読込・タイトルアニメ）
// ===================================
function init() {
    // オプションと実績/統計を読み込む（破損・例外時は既定値で継続）
    loadOptions();
    loadAchievements();
    const opts = getOptions();
    applyOptions(opts); // 音量・操作説明表示の初期適用
    renderOptions(); // フォームへ反映
    renderAchievements(); // 実績一覧を初期描画

    // 今回プレイのミッションを割り当て、タイトルにプレビュー表示
    prepareMission();
    updateTitleMission();

    // ハイスコアを表示（HUD のタイトル表示 + 結果画面のハイスコア表示）
    updateHud();
    setFinalHighScore(gameState.highScore);

    updateSendScoreButton();
    loadLeaderboard();
    // Phase 1: タイトル画面の GLOBAL TOP 5 を取得
    loadTitleLeaderboard();
}

init();
startTitleAnimation();
updateSoundButton(AudioManager.muted);
