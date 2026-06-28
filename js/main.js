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
import {
    configureLeaderboard,
    loadLeaderboard,
    loadTitleLeaderboard,
    handleSendScore,
    setLeaderboardFilter,
    fetchMyRank,
    leaderboardState
} from './services/leaderboard.js';
import { AudioManager } from './audio/audio-manager.js';
import { configureErrors, registerGlobalErrorHandlers } from './util/errors.js';

import { loadOptions, getOptions, setOption } from './model/options.js';
import { loadAchievements, getUnlockedMap } from './model/achievements.js';
import { formatMission } from './model/missions.js';
import { loadProgression, recordRun, getLevel, getBestForMode } from './model/progression.js';
import { loadCosmetics, syncUnlocks } from './model/cosmetics.js';
import { saveBestGhost } from './model/replay.js';
import { getSelectedMode } from './model/game-modes.js';
import {
    loadChallenges,
    refreshChallenges,
    applyRun as applyChallengeRun,
    getCompletedMap as getChallengeCompletedMap
} from './model/challenges.js';
import { fetchChallengeInfo } from './services/challenge-service.js';

import { configureHud, updateHud, updateSoundButton } from './view/hud.js';
import {
    configureScreens,
    setFinalHighScore,
    showOptionsScreen,
    hideOptionsScreen,
    showAchievementsScreen,
    hideAchievementsScreen,
    showProfileScreen,
    hideProfileScreen,
    showCosmeticsScreen,
    hideCosmeticsScreen,
    showChallengesScreen,
    hideChallengesScreen,
    showReplayScreen,
    hideReplayScreen
} from './view/screens.js';
import { configureTitleAnimation, startTitleAnimation } from './view/title-animation.js';
import { configureOptionsView, renderOptions } from './view/options-view.js';
import { configureAchievementsView, renderAchievements, showToast } from './view/achievements-view.js';
import { configureProfileView, renderProfile } from './view/profile-view.js';
import { configureCosmeticsView, renderCosmetics } from './view/cosmetics-view.js';
import { configureChallengesView, renderChallenges } from './view/challenges-view.js';
import { configureReplayView, openReplay, closeReplay } from './view/replay-view.js';
import { configureShareView, setShareAreaVisible, downloadCard, copyShareText } from './view/share-view.js';
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
    setTitleLeaderboardStatus,
    setMyRankText
} from './view/leaderboard-view.js';

import {
    configureGameLoop,
    startGame,
    stopLoop,
    togglePause,
    resumeGame,
    backToTitle,
    doDash,
    prepareMission,
    spawnTrainingPowerup,
    configureRunCompletion
} from './controller/game-loop.js';
import { registerInput, configureInput } from './controller/input.js';
import { configureModeSelectView } from './view/mode-select-view.js';

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
// Phase 6: ランキングフィルタ / 自分の順位 / 送信セクション
const leaderboardMyRankDisplay = document.getElementById('leaderboardMyRank');
const scoreSubmitSection = document.getElementById('scoreSubmit');
const gameOverTitleDisplay = document.getElementById('gameOverTitle');
const gameOverModeDisplay = document.getElementById('gameOverMode');
const lbPeriodButtons = Array.from(document.querySelectorAll('.lb-period'));
const lbModeFilter = document.getElementById('lbModeFilter');
// Phase 7: モード選択 / Training 設定 / Training パネル
const modeButtons = Array.from(document.querySelectorAll('.mode-btn'));
const modeDescDisplay = document.getElementById('modeDesc');
const trainingSettings = document.getElementById('trainingSettings');
const trInvincible = document.getElementById('trInvincible');
const trSpeed = document.getElementById('trSpeed');
const trObstacles = document.getElementById('trObstacles');
const trainingPanel = document.getElementById('trainingPanel');
const trPuButtons = Array.from(document.querySelectorAll('.tr-pu'));
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

// Phase 8/9: プロフィール / 外観 / チャレンジ
const profileBtn = document.getElementById('profileBtn');
const profileBackBtn = document.getElementById('profileBackBtn');
const cosmeticsBtn = document.getElementById('cosmeticsBtn');
const cosmeticsBackBtn = document.getElementById('cosmeticsBackBtn');
const challengesBtn = document.getElementById('challengesBtn');
const challengesBackBtn = document.getElementById('challengesBackBtn');
const profileScreen = document.getElementById('profileScreen');
const cosmeticsScreen = document.getElementById('cosmeticsScreen');
const challengesScreen = document.getElementById('challengesScreen');
const profileLevelDisplay = document.getElementById('profileLevel');
const profileXpBar = document.getElementById('profileXpBar');
const profileXpText = document.getElementById('profileXpText');
const profileStats = document.getElementById('profileStats');
const profileBest = document.getElementById('profileBest');
const cosmeticsContainer = document.getElementById('cosmeticsContainer');
const challengesContainer = document.getElementById('challengesContainer');
const challengesSource = document.getElementById('challengesSource');

// Phase 10: ゴースト / リプレイ / 共有
const replayScreen = document.getElementById('replayScreen');
const replayTitleBtn = document.getElementById('replayTitleBtn');
const replayBtn = document.getElementById('replayBtn');
const replayBackBtn = document.getElementById('replayBackBtn');
const replayCanvas = document.getElementById('replayCanvas');
const replayStatus = document.getElementById('replayStatus');
const replayPlayBtn = document.getElementById('replayPlayBtn');
const replayPauseBtn = document.getElementById('replayPauseBtn');
const replayRestartBtn = document.getElementById('replayRestartBtn');
const replaySpeedBtn = document.getElementById('replaySpeedBtn');
const ghostToggle = document.getElementById('ghostToggle');
const shareBtn = document.getElementById('shareBtn');
const shareArea = document.getElementById('shareArea');
const shareCanvas = document.getElementById('shareCanvas');
const shareDownloadBtn = document.getElementById('shareDownloadBtn');
const shareCopyBtn = document.getElementById('shareCopyBtn');
const shareStatus = document.getElementById('shareStatus');

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
    missionResult: missionResultDisplay,
    // Phase 7: FINISH/GAME OVER 見出しとモード表示
    gameOverTitle: gameOverTitleDisplay,
    gameOverMode: gameOverModeDisplay,
    // Phase 8/9: オーバーレイ
    profileScreen,
    cosmeticsScreen,
    challengesScreen,
    // Phase 10: リプレイオーバーレイ
    replayScreen
});
configureTitleAnimation({ titleCanvas, titleScreen });
configureLeaderboardView({
    leaderboardList: leaderboardListDisplay,
    leaderboardStatus: leaderboardStatusDisplay,
    sendScoreBtn,
    playerNameInput,
    titleLeaderboardList,
    titleLeaderboardStatus,
    leaderboardMyRank: leaderboardMyRankDisplay,
    scoreSubmitSection
});
configureAchievementsView({
    achievementsList,
    toastContainer
});
// Phase 7: モード選択 UI（選択状態は model/game-modes、効果適用は controller）
configureModeSelectView(
    {
        modeButtons,
        modeDesc: modeDescDisplay,
        trainingSettings,
        trInvincible,
        trSpeed,
        trObstacles,
        trainingPanel,
        trPuButtons
    },
    { onSpawnPreview: spawnTrainingPowerup }
);
// Phase 8: プロフィール / 外観ビュー
configureProfileView({
    profileLevel: profileLevelDisplay,
    profileXpBar,
    profileXpText,
    profileStats,
    profileBest
});
configureCosmeticsView({ cosmeticsContainer }, () => { /* 外観は renderer が毎フレーム getActive で反映 */ });
// Phase 9: チャレンジ ビュー
configureChallengesView({ challengesContainer, challengesSource });
// Phase 10: リプレイ / 共有ビュー
configureReplayView({
    replayCanvas,
    replayStatus,
    replayPlayBtn,
    replayPauseBtn,
    replayRestartBtn,
    replaySpeedBtn,
    ghostToggle
});
configureShareView({ shareCanvas, shareDownloadBtn, shareCopyBtn, shareStatus, shareArea });

// チャレンジ時刻情報（サーバー優先・ローカル UTC フォールバック）を取得して更新・描画。
async function refreshAndRenderChallenges() {
    try {
        const info = await fetchChallengeInfo();
        refreshChallenges(info);
    } catch (err) {
        console.warn('challenge refresh failed:', err);
    }
    renderChallenges();
}

// Phase 8/9: プレイ完了時の成長（XP）・チャレンジ反映・外観解放。
// controller の endGame が Training を除外して呼ぶ（Training は XP/記録なし）。
// チャレンジ連携（applyChallengesForRun / getCompletedChallengeMap）は Phase 9 で注入される。
let challengeHooks = {
    applyForRun: () => ({ xp: 0, newly: [] }),
    completedMap: () => ({}),
    render: () => {}
};
function setChallengeHooks(hooks) {
    challengeHooks = { ...challengeHooks, ...hooks };
}
// Phase 9: 実際のチャレンジ連携をフックへ注入（Phase 8 の no-op を置き換え）。
setChallengeHooks({
    applyForRun: applyChallengeRun,
    completedMap: getChallengeCompletedMap,
    render: refreshAndRenderChallenges
});
const RANKED_MODES = ['endless', 'timeattack', 'hardcore'];
configureRunCompletion((summary) => {
    const ch = challengeHooks.applyForRun(summary) || { xp: 0, newly: [] };
    // Phase 10: 自己ベスト更新時のみゴーストを保存（recordRun が best を更新する前に判定）。
    const prevBest = getBestForMode(summary.mode);
    const result = recordRun({ ...summary, challengeXp: ch.xp || 0 });
    if (RANKED_MODES.includes(summary.mode) && summary.score > prevBest) {
        saveBestGhost(summary.mode, { score: summary.score, maxCombo: summary.maxCombo }); // async・失敗は無視
    }
    const newlyCos = syncUnlocks({
        level: getLevel(),
        achievements: getUnlockedMap(),
        challenges: challengeHooks.completedMap() || {}
    });
    if (result.leveledUp) showToast('LEVEL UP', `LV ${result.toLevel}`);
    for (const c of (ch.newly || [])) showToast('CHALLENGE COMPLETE', c.label || c.name || '');
    for (const c of newlyCos) showToast('COSMETIC UNLOCKED', c.name);
    renderProfile();
    renderCosmetics();
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

// Phase 6: ランキングフィルタ（期間タブ・モード絞り込み）。変更で再取得し自分の順位も更新。
async function refreshRanking() {
    await loadLeaderboard();
    const rank = await fetchMyRank(leaderboardState.lastScore);
    setMyRankText(rank ? `YOUR RANK: #${rank}` : '');
}
lbPeriodButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
        setLeaderboardFilter({ period: btn.dataset.period });
        lbPeriodButtons.forEach((b) => b.classList.toggle('active', b === btn));
        refreshRanking();
    });
});
if (lbModeFilter) {
    lbModeFilter.addEventListener('change', () => {
        setLeaderboardFilter({ mode: lbModeFilter.value });
        refreshRanking();
    });
}

// Phase 2: タイトル/ポーズからオプションを開く・閉じる
if (titleOptionsBtn) titleOptionsBtn.addEventListener('click', () => { renderOptions(); showOptionsScreen(); });
if (pauseOptionsBtn) pauseOptionsBtn.addEventListener('click', () => { renderOptions(); showOptionsScreen(); });
if (optionsBackBtn) optionsBackBtn.addEventListener('click', hideOptionsScreen);

// Phase 5: 実績一覧を開く・閉じる
if (achievementsBtn) achievementsBtn.addEventListener('click', () => { renderAchievements(); showAchievementsScreen(); });
if (achievementsBackBtn) achievementsBackBtn.addEventListener('click', hideAchievementsScreen);

// Phase 8: プロフィール / 外観 を開く・閉じる
if (profileBtn) profileBtn.addEventListener('click', () => { renderProfile(); showProfileScreen(); });
if (profileBackBtn) profileBackBtn.addEventListener('click', hideProfileScreen);
if (cosmeticsBtn) cosmeticsBtn.addEventListener('click', () => { renderCosmetics(); showCosmeticsScreen(); });
if (cosmeticsBackBtn) cosmeticsBackBtn.addEventListener('click', hideCosmeticsScreen);

// Phase 9: チャレンジ（内容は Phase 9 で描画。ここでは開閉のみ配線）
if (challengesBtn) challengesBtn.addEventListener('click', () => { challengeHooks.render(); showChallengesScreen(); });
if (challengesBackBtn) challengesBackBtn.addEventListener('click', hideChallengesScreen);

// Phase 10: リプレイ（タイトル=選択中モード / GAME OVER=直近モード）を開く・閉じる。
if (replayTitleBtn) replayTitleBtn.addEventListener('click', () => { openReplay(getSelectedMode().id); showReplayScreen(); });
if (replayBtn) replayBtn.addEventListener('click', () => { openReplay(gameState.mode); showReplayScreen(); });
if (replayBackBtn) replayBackBtn.addEventListener('click', () => { closeReplay(); hideReplayScreen(); });

// Phase 10: 結果カード（PNG ダウンロード / 共有文コピー）。
if (shareBtn) shareBtn.addEventListener('click', () => setShareAreaVisible(true));
if (shareDownloadBtn) shareDownloadBtn.addEventListener('click', downloadCard);
if (shareCopyBtn) shareCopyBtn.addEventListener('click', copyShareText);

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
    // Phase 8/9: 成長・外観・チャレンジを読み込み、現在のレベル/実績/チャレンジで解放を同期。
    loadProgression();
    loadCosmetics();
    loadChallenges();
    syncUnlocks({ level: getLevel(), achievements: getUnlockedMap(), challenges: getChallengeCompletedMap() });
    const opts = getOptions();
    applyOptions(opts); // 音量・操作説明表示の初期適用
    renderOptions(); // フォームへ反映
    renderAchievements(); // 実績一覧を初期描画
    renderProfile(); // プロフィール初期描画
    renderCosmetics(); // 外観一覧初期描画
    refreshAndRenderChallenges(); // チャレンジを取得して初期描画（async・フォールバックで継続）

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
