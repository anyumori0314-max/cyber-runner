// ===================================
// view/screens.js — 画面遷移と GAME OVER 結果表示（Stage 4）
//
// 責務: タイトル / ゲーム / GAME OVER 画面の切り替えと、結果画面の値表示
//       （ランク・ランクメッセージ・最終スコア・ハイスコア・最大コンボ）。
//
// 依存方向: なし（DOM 要素を configureScreens() で注入され、渡された値を表示するだけ）。
//   ランク計算など Model ロジックは持たない（controller が計算して値を渡す）。
// DOM ID・画面構造は変更しない。表示は textContent を使用。
// ===================================

// main.js から注入される DOM 参照。
let refs = {
    titleScreen: null,
    gameScreen: null,
    gameOverScreen: null,
    finalScore: null,
    finalHighScore: null,
    rankDisplay: null,
    rankMessage: null,
    maxComboResult: null
};

export function configureScreens(elements) {
    refs = { ...refs, ...elements };
}

// タイトル画面を表示。
export function showTitleScreen() {
    if (refs.gameScreen) refs.gameScreen.classList.remove('active');
    if (refs.gameOverScreen) refs.gameOverScreen.classList.remove('active');
    if (refs.titleScreen) refs.titleScreen.classList.add('active');
}

// ゲーム画面を表示（START / RETRY 時）。
export function showGameScreen() {
    if (refs.titleScreen) refs.titleScreen.classList.remove('active');
    if (refs.gameOverScreen) refs.gameOverScreen.classList.remove('active');
    if (refs.gameScreen) refs.gameScreen.classList.add('active');
}

// GAME OVER 画面を表示。
export function showGameOverScreen() {
    if (refs.gameScreen) refs.gameScreen.classList.remove('active');
    if (refs.gameOverScreen) refs.gameOverScreen.classList.add('active');
}

// GAME OVER 結果の各値を表示する（値は controller が計算して渡す）。
//   data = { score, highScore, rank: {rank, message}, maxCombo }
export function renderGameOver({ score, highScore, rank, maxCombo }) {
    if (refs.finalScore) refs.finalScore.textContent = score;
    if (refs.finalHighScore) refs.finalHighScore.textContent = highScore;
    if (refs.rankDisplay) refs.rankDisplay.textContent = rank.rank;
    if (refs.rankMessage) refs.rankMessage.textContent = rank.message;
    if (refs.maxComboResult) refs.maxComboResult.textContent = maxCombo;
}

// 結果画面のハイスコア表示のみ更新（初期化時に使用）。
export function setFinalHighScore(value) {
    if (refs.finalHighScore) refs.finalHighScore.textContent = value;
}
