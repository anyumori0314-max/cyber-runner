// ===================================
// ゲーム定数
// ===================================
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 40;
const OBSTACLE_WIDTH = 50;
const OBSTACLE_HEIGHT = 50;
const INITIAL_SPEED = 3;
const MAX_SPEED = 12;
const INITIAL_SPAWN_RATE = 0.02; // 障害物出現確率
const MAX_SPAWN_RATE = 0.08;

// ===================================
// ゲーム状態管理
// ===================================
const gameState = {
    isRunning: false,
    isPaused: false,
    score: 0,
    // localStorageから取得する際に数値に変換する
    highScore: parseFloat(localStorage.getItem('cyberRunnerHighScore')) || 0,
    level: 1,
    gameTime: 0,
    startTime: 0,
    speed: INITIAL_SPEED,
    spawnRate: INITIAL_SPAWN_RATE
};

// RAF IDを保持してループを安定化
let rafId = null;
// 最後に発生したエラー情報
let lastError = null;

// ===================================
// プレイヤーオブジェクト
// ===================================
const player = {
    x: CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2,
    y: CANVAS_HEIGHT - PLAYER_HEIGHT - 20,
    width: PLAYER_WIDTH,
    height: PLAYER_HEIGHT,
    speed: 6,
    moveLeft: false,
    moveRight: false,

    // プレイヤーを更新
    update() {
        if (this.moveLeft && this.x > 0) {
            this.x -= this.speed;
        }
        if (this.moveRight && this.x + this.width < CANVAS_WIDTH) {
            this.x += this.speed;
        }
    },

    // プレイヤーを描画
    draw(ctx) {
        // プレイヤーの本体
        ctx.fillStyle = '#00ff88';
        ctx.shadowColor = '#00ff88';
        ctx.shadowBlur = 15;
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // プレイヤーの枠
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 10;
        ctx.strokeRect(this.x, this.y, this.width, this.height);

        // プレイヤーの目
        ctx.fillStyle = '#000';
        ctx.fillRect(this.x + 8, this.y + 12, 8, 8);
        ctx.fillRect(this.x + 24, this.y + 12, 8, 8);
    }
};

// ===================================
// 障害物のクラス
// ===================================
class Obstacle {
    constructor() {
        this.x = Math.random() * (CANVAS_WIDTH - OBSTACLE_WIDTH);
        this.y = -OBSTACLE_HEIGHT;
        this.width = OBSTACLE_WIDTH;
        this.height = OBSTACLE_HEIGHT;
        this.speed = gameState.speed;
    }

    // 障害物を更新
    update() {
        // 難易度変化に応じて既存の障害物も速度を追従させる
        this.speed = gameState.speed;
        this.y += this.speed;
    }

    // 障害物を描画
    draw(ctx) {
        // 障害物の本体
        ctx.fillStyle = '#ff0088';
        ctx.shadowColor = '#ff0088';
        ctx.shadowBlur = 15;
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // 障害物の枠
        ctx.strokeStyle = '#ff00ff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#ff00ff';
        ctx.shadowBlur = 10;
        ctx.strokeRect(this.x, this.y, this.width, this.height);

        // 危険マーク
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.x + 10, this.y + 10);
        ctx.lineTo(this.x + 40, this.y + 40);
        ctx.moveTo(this.x + 40, this.y + 10);
        ctx.lineTo(this.x + 10, this.y + 40);
        ctx.stroke();
    }

    // 画面外に出たか判定
    isOutOfBounds() {
        return this.y > CANVAS_HEIGHT;
    }

    // プレイヤーと衝突したか判定
    collidesWith(player) {
        return (
            this.x < player.x + player.width &&
            this.x + this.width > player.x &&
            this.y < player.y + player.height &&
            this.y + this.height > player.y
        );
    }
}

// ===================================
// ゲームオブジェクト配列
// ===================================
let obstacles = [];

// ===================================
// DOM要素の取得
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

// ===================================
// イベントリスナー
// ===================================

// キーボード入力
document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        player.moveLeft = true;
    }
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        player.moveRight = true;
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        player.moveLeft = false;
    }
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        player.moveRight = false;
    }
});

// STARTボタン
startBtn.addEventListener('click', startGame);

// RETRYボタン
retryBtn.addEventListener('click', startGame);

// ウィンドウのフォーカスを失ったときはキー状態をリセットして入力ループ停止を防ぐ
window.addEventListener('blur', () => {
    player.moveLeft = false;
    player.moveRight = false;
});

// グローバルな例外捕捉（console.error を出さないように警告レベルで処理）
window.addEventListener('error', (evt) => {
    handleGameError(evt.error || evt.message || 'Unknown error');
    // prevent default logging to console.error
    evt.preventDefault();
});

window.addEventListener('unhandledrejection', (evt) => {
    handleGameError(evt.reason || 'Unhandled rejection');
    evt.preventDefault();
});

// ===================================
// ゲーム開始
// ===================================
function startGame() {
    // 既存のループがあれば停止してから再開（多重起動防止）
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }

    // すべての状態を初期化
    resetAllState();

    // 画面遷移
    titleScreen.classList.remove('active');
    gameOverScreen.classList.remove('active');
    gameScreen.classList.add('active');

    // キャンバスのサイズを明示的に設定（レスポンシブ時のズレを防ぐ）
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    // ゲームループ開始（安定したループ）
    rafId = requestAnimationFrame(loop);
}

// ===================================
// ゲーム終了
// ===================================
function endGame() {
    // ループを停止
    gameState.isRunning = false;
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }

    // キー入力状態をクリア
    player.moveLeft = false;
    player.moveRight = false;

    // ハイスコア更新（数値比較）
    if (gameState.score > gameState.highScore) {
        gameState.highScore = Math.floor(gameState.score);
        try {
            localStorage.setItem('cyberRunnerHighScore', gameState.highScore);
        } catch (e) {
            // localStorageが使えない場合は警告に留める
            console.warn('localStorage not available:', e);
        }
    }

    // ゲームオーバー画面に表示
    finalScoreDisplay.textContent = Math.floor(gameState.score);
    finalHighScoreDisplay.textContent = gameState.highScore;

    // 画面遷移
    gameScreen.classList.remove('active');
    gameOverScreen.classList.add('active');
}

// ===================================
// ゲームループ
// ===================================
// 安定化されたメインループ
function loop(timestamp) {
    try {
        if (!gameState.isRunning) return;

        // ゲーム時間を更新
        gameState.gameTime = (Date.now() - gameState.startTime) / 1000;

        // スコアを更新（生存時間 * 10）
        gameState.score = gameState.gameTime * 10;

        // レベルを更新
        gameState.level = Math.floor(gameState.gameTime / 10) + 1;

        // 難易度を上げる
        updateDifficulty();

        // プレイヤーを更新
        player.update();

        // 新しい障害物を生成
        if (Math.random() < gameState.spawnRate) {
            obstacles.push(new Obstacle());
        }

        // 障害物を更新と衝突判定（後方ループで安全にsplice）
        for (let i = obstacles.length - 1; i >= 0; i--) {
            const ob = obstacles[i];
            ob.update();

            // 画面外に出た障害物を削除
            if (ob.isOutOfBounds()) {
                obstacles.splice(i, 1);
                continue;
            }

            // プレイヤーとの衝突判定
            if (ob.collidesWith(player)) {
                endGame();
                return;
            }
        }

        // 画面を描画
        draw();

        // UIを更新
        updateUI();

        // 次フレームをリクエスト
        rafId = requestAnimationFrame(loop);
    } catch (err) {
        // 例外が発生してもループを止めずに原因を可視化（console.errorは使わない）
        handleGameError(err);
    }
}

// ===================================
// 難易度の更新
// ===================================
function updateDifficulty() {
    // 時間に応じて速度を上げる（最大速度までプログレッシブに）
    const speedIncrease = (gameState.gameTime / 60) * (MAX_SPEED - INITIAL_SPEED);
    gameState.speed = INITIAL_SPEED + Math.min(speedIncrease, MAX_SPEED - INITIAL_SPEED);

    // 時間に応じて出現率を上げる
    const spawnIncrease = (gameState.gameTime / 60) * (MAX_SPAWN_RATE - INITIAL_SPAWN_RATE);
    gameState.spawnRate = INITIAL_SPAWN_RATE + Math.min(spawnIncrease, MAX_SPAWN_RATE - INITIAL_SPAWN_RATE);
}

// ===================================
// 描画
// ===================================
function draw() {
    // キャンバスをクリア
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // グラデーション背景を追加
    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gradient.addColorStop(0, 'rgba(10, 14, 39, 0.3)');
    gradient.addColorStop(0.5, 'rgba(26, 26, 62, 0.2)');
    gradient.addColorStop(1, 'rgba(10, 14, 39, 0.3)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // グリッドパターンを描画（サイバー風）
    drawGrid();

    // 障害物を描画
    for (let obstacle of obstacles) {
        obstacle.draw(ctx);
    }

    // プレイヤーを描画
    player.draw(ctx);
}

// ===================================
// グリッドパターン描画（背景エフェクト）
// ===================================
function drawGrid() {
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.05)';
    ctx.lineWidth = 1;

    const gridSize = 40;

    // 縦線
    for (let x = 0; x < CANVAS_WIDTH; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
    }

    // 横線
    for (let y = 0; y < CANVAS_HEIGHT; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.stroke();
    }
}

// ===================================
// UI更新
// ===================================
function updateUI() {
    currentScoreDisplay.textContent = Math.floor(gameState.score);
    currentLevelDisplay.textContent = gameState.level;
    highScoreTitleDisplay.textContent = gameState.highScore;
}

// ===================================
// 初期化
// ===================================
function init() {
    // ハイスコアを表示
    highScoreTitleDisplay.textContent = gameState.highScore;
    finalHighScoreDisplay.textContent = gameState.highScore;
}

// ページ読み込み時に初期化
init();

// すべてのゲーム状態を初期化する（restart/retry 用）
function resetAllState() {
    gameState.isRunning = true;
    gameState.isPaused = false;
    gameState.score = 0;
    gameState.level = 1;
    gameState.gameTime = 0;
    gameState.startTime = Date.now();
    gameState.speed = INITIAL_SPEED;
    gameState.spawnRate = INITIAL_SPAWN_RATE;

    // 障害物やプレイヤーの状態をリセット
    obstacles = [];
    player.x = CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2;
    player.y = CANVAS_HEIGHT - PLAYER_HEIGHT - 20;
    player.moveLeft = false;
    player.moveRight = false;

    // 既存のエラーはクリア
    lastError = null;
    removeErrorOverlay();
}

// エラーを画面表示するオーバーレイを生成
function showErrorOverlay(message) {
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

function removeErrorOverlay() {
    const existing = document.getElementById('errorOverlay');
    if (existing) existing.remove();
}

// エラー発生時の共通処理（console.error は使わず警告で残す）
function handleGameError(err) {
    try {
        const msg = err && err.stack ? (err.stack.toString()) : String(err);
        lastError = msg;
        // 開発者用に警告で残す
        console.warn('Game error:', msg);
        // ユーザーにも分かりやすくオーバーレイ表示
        showErrorOverlay(msg.substring(0, 500));
    } catch (e) {
        // 最後の手段でログは残すが console.error を使わない
        console.warn('Error handling failed', e);
    }
    // 必要ならゲームを止める
    gameState.isRunning = false;
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}
