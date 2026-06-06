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
const INITIAL_POWERUP_SPAWN = 0.002;
const MAX_POWERUP_SPAWN = 0.01;

// ====== Delta / speed 調整用定数 ======
// 単位速度 (gameState.speed の 1.0) をピクセル/秒に変換する係数
// 調整しやすくするための定数。既存実装と同等の挙動にするためデフォルトは 60。
const SPEED_UNIT_TO_PX_PER_SEC = 60;
// プレイヤーの移動速度（px/秒）。既存値 360 を定数化。
const PLAYER_SPEED_PX_PER_SEC = 360;
// 1フレームあたりの最大 delta 秒（大きなジャンプを抑制して安定化）
const MAX_DELTA_TIME = 0.1;
// 初期障害物速度（論理単位を使う場合の参考値）
const INITIAL_OBSTACLE_SPEED = INITIAL_SPEED;

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
    // baseSpeed は難易度計算に用いる基礎速度
    baseSpeed: INITIAL_SPEED,
    // 実際の速度（baseSpeed に slowFactor を乗算したもの）
    speed: INITIAL_SPEED,
    spawnRate: INITIAL_SPAWN_RATE,
    powerupSpawnRate: INITIAL_POWERUP_SPAWN,
    slowFactor: 1,
    specialChance: 0 // 特殊障害物出現率（時間経過で増加）
};

// RAF IDを保持してループを安定化
let rafId = null;
// 最後に発生したエラー情報
let lastError = null;
// 前フレームの timestamp（ms）
let lastTimestamp = null;

// ===================================
// プレイヤーオブジェクト
// ===================================
const player = {
    x: CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2,
    y: CANVAS_HEIGHT - PLAYER_HEIGHT - 20,
    width: PLAYER_WIDTH,
    height: PLAYER_HEIGHT,
    // speed: px per second (converted from previous frame-based value)
    speed: PLAYER_SPEED_PX_PER_SEC,
    moveLeft: false,
    moveRight: false,

    // プレイヤーを更新 (delta: seconds)
    update(delta) {
        if (!delta) return;
        const move = this.speed * delta; // px to move this frame
        if (this.moveLeft && this.x > 0) {
            this.x = Math.max(0, this.x - move);
        }
        if (this.moveRight && this.x + this.width < CANVAS_WIDTH) {
            this.x = Math.min(CANVAS_WIDTH - this.width, this.x + move);
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
        // 障害物の種類を決定（時間経過で特殊種が増える）
        const r = Math.random();
        const special = Math.random() < gameState.specialChance;
        this.type = 'normal';
        if (special) {
            // 高速・大型・ジグザグのいずれか
            const t = Math.random();
            if (t < 0.33) this.type = 'fast';
            else if (t < 0.66) this.type = 'large';
            else this.type = 'zigzag';
        }

        // サイズと初期位置
        if (this.type === 'fast') {
            this.width = 20;
            this.height = 40;
            this.color = '#ff7744';
        } else if (this.type === 'large') {
            this.width = 80;
            this.height = 60;
            this.color = '#8855ff';
        } else if (this.type === 'zigzag') {
            this.width = 46;
            this.height = 46;
            this.color = '#ffd400';
            this.zigAmplitude = 60;
            this.zigFreq = 0.02 + Math.random() * 0.03;
            this.initialX = Math.random() * (CANVAS_WIDTH - this.width);
            this.x = this.initialX;
        } else {
            this.width = OBSTACLE_WIDTH;
            this.height = OBSTACLE_HEIGHT;
            this.color = '#ff0088';
        }

        if (this.type !== 'zigzag') {
            this.x = Math.random() * (CANVAS_WIDTH - this.width);
        }
        this.y = -this.height;
        // gameState.speed は論理単位なので、ピクセル/秒に変換して使う
        this.baseSpeed = gameState.baseSpeed;
        this.speed = gameState.speed * SPEED_UNIT_TO_PX_PER_SEC; // convert to px/sec
        this.elapsed = 0; // for zigzag timing
    }

    // 障害物を更新
    update(delta) {
        if (!delta) return;
        // 難易度に追従
        this.baseSpeed = gameState.baseSpeed;
        // 特殊種は倍率を使う
        const basePx = gameState.speed * SPEED_UNIT_TO_PX_PER_SEC;
        if (this.type === 'fast') this.speed = basePx * 1.6;
        else if (this.type === 'large') this.speed = basePx * 0.75;
        else this.speed = basePx;

        // ジグザグは横移動も（time-based）
        if (this.type === 'zigzag') {
            this.elapsed += delta;
            this.x = this.initialX + Math.sin(this.elapsed / this.zigFreq) * this.zigAmplitude;
        }
        this.y += this.speed * delta;
    }

    // 障害物を描画
    draw(ctx) {
        // 障害物の本体
        ctx.fillStyle = this.color || '#ff0088';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 14;
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // 枠
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 8;
        ctx.strokeRect(this.x, this.y, this.width, this.height);

        // 種類ごとの装飾
        if (this.type === 'fast') {
            ctx.fillStyle = '#222';
            ctx.fillRect(this.x + 2, this.y + 6, this.width - 4, 6);
        } else if (this.type === 'large') {
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(this.x + 4, this.y + 4, this.width - 8, this.height - 8);
        } else if (this.type === 'zigzag') {
            ctx.strokeStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(this.x + 4, this.y + this.height / 2);
            ctx.lineTo(this.x + this.width - 4, this.y + this.height / 2);
            ctx.stroke();
        }
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
let powerUps = [];
let popups = []; // テキストのフローティング表示
let lastLevel = 0;

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
const powerupStatusDisplay = document.createElement('div');
powerupStatusDisplay.className = 'powerup-display';
powerupStatusDisplay.id = 'powerupStatus';
// ゲームヘッダーに差し込む
const gameHeader = document.querySelector('.game-header');
if (gameHeader) gameHeader.appendChild(powerupStatusDisplay);
const titleCanvas = document.getElementById('titleCanvas');
const muteBtn = document.getElementById('muteBtn');

// ===================================
// AudioManager: Web Audio で簡易的な効果音を生成
// ===================================
const AudioManager = {
    ctx: null,
    master: null,
    muted: false,
    init() {
        if (this.ctx) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.muted ? 0 : 0.18;
            this.master.connect(this.ctx.destination);
        } catch (e) {
            console.warn('Audio init failed', e);
        }
    },
    toggleMute() {
        this.muted = !this.muted;
        if (this.master) this.master.gain.value = this.muted ? 0 : 0.18;
    },
    play(name) {
        if (!this.ctx) return;
        try {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            const t = this.ctx.currentTime;
            const o = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            o.connect(g);
            g.connect(this.master);
            // 簡易な音色定義
            if (name === 'start') {
                o.type = 'sine';
                o.frequency.setValueAtTime(880, t);
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
                o.start(t);
                o.stop(t + 0.3);
            } else if (name === 'levelUp') {
                o.type = 'triangle';
                o.frequency.setValueAtTime(660, t);
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
                o.start(t);
                o.stop(t + 0.22);
            } else if (name === 'pickup') {
                o.type = 'sawtooth';
                o.frequency.setValueAtTime(1200, t);
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(0.08, t + 0.005);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
                o.start(t);
                o.stop(t + 0.16);
            } else if (name === 'gameover') {
                o.type = 'sine';
                o.frequency.setValueAtTime(200, t);
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
                o.start(t);
                o.stop(t + 0.7);
            }
        } catch (e) {
            console.warn('Audio play failed', e);
        }
    }
};

// ===================================
// PowerUp クラス
// ===================================
class PowerUp {
    constructor() {
        this.types = ['shield', 'slow', 'bonus'];
        this.type = this.types[Math.floor(Math.random() * this.types.length)];
        this.x = Math.random() * (CANVAS_WIDTH - 30);
        this.y = -30;
        this.width = 30;
        this.height = 30;
        this.speed = gameState.speed * 0.6;
        this.color = this.type === 'shield' ? '#00eaff' : this.type === 'slow' ? '#ffaa00' : '#ffe066';
    }
    update(delta) {
        this.y += (this.speed * (delta || 0));
    }
    draw(ctx) {
        ctx.fillStyle = this.color;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 12;
        // 簡易アイコン: 円
        ctx.beginPath();
        ctx.arc(this.x + this.width / 2, this.y + this.height / 2, this.width / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
        // テキスト
        ctx.fillStyle = '#000';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(this.type === 'shield' ? 'S' : this.type === 'slow' ? 'T' : '+', this.x + this.width / 2, this.y + this.height / 2 + 4);
    }
    isOutOfBounds() {
        return this.y > CANVAS_HEIGHT;
    }
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

// ミュート切替
muteBtn && muteBtn.addEventListener('click', () => {
    AudioManager.toggleMute();
    muteBtn.textContent = AudioManager.muted ? 'SOUND: OFF' : 'SOUND: ON';
});

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

    // ユーザー操作後にAudioContextを初期化
    AudioManager.init();

    // すべての状態を初期化
    resetAllState();

    // 効果音（スタート）
    AudioManager.play('start');

    // 画面遷移
    titleScreen.classList.remove('active');
    gameOverScreen.classList.remove('active');
    gameScreen.classList.add('active');

    // キャンバスのサイズを明示的に設定（HiDPI 対応）
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = CANVAS_WIDTH + 'px';
    canvas.style.height = CANVAS_HEIGHT + 'px';
    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    // 描画は論理ピクセル単位で行えるようにコンテキストをスケーリング
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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

    // 効果音（ゲームオーバー）
    AudioManager.play('gameover');

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

        // deltaTime を計算（seconds）
        let delta = 0;
        if (lastTimestamp != null) {
            delta = (timestamp - lastTimestamp) / 1000;
            // 上限を設定して急激なジャンプを抑制
            if (delta > MAX_DELTA_TIME) delta = MAX_DELTA_TIME;
        }
        lastTimestamp = timestamp;

        // ゲーム時間を累積（秒）
        gameState.gameTime += delta;

        // スコアを更新（生存時間 * 10）
        gameState.score = gameState.gameTime * 10;

        // レベルを更新
        gameState.level = Math.floor(gameState.gameTime / 10) + 1;

        // 難易度を上げる
        updateDifficulty();

        // パワーアップ／シールドの期限チェック
        if (gameState.slowUntil && Date.now() > gameState.slowUntil) {
            gameState.slowFactor = 1;
            gameState.slowUntil = null;
        }
        if (player.shield && player.shieldUntil && Date.now() > player.shieldUntil) {
            player.shield = false;
            player.shieldUntil = null;
        }

        // レベルアップ効果音
        if (gameState.level > lastLevel) {
            AudioManager.play('levelUp');
            lastLevel = gameState.level;
        }

        // プレイヤーを更新 (delta seconds)
        player.update(delta);

        // 新しい障害物を生成
        if (Math.random() < gameState.spawnRate * (delta || 0)) {
            obstacles.push(new Obstacle());
        }

        // 新しいパワーアップを低確率で生成
        if (Math.random() < gameState.powerupSpawnRate * (delta || 0)) {
            powerUps.push(new PowerUp());
        }

        // 障害物を更新と衝突判定（後方ループで安全にsplice）
        for (let i = obstacles.length - 1; i >= 0; i--) {
            const ob = obstacles[i];
            ob.update(delta);

            // 画面外に出た障害物を削除
            if (ob.isOutOfBounds()) {
                obstacles.splice(i, 1);
                continue;
            }

            // プレイヤーとの衝突判定
            if (ob.collidesWith(player)) {
                if (player.shield) {
                    // シールドに守られる
                    player.shield = false;
                    // 障害物を消す
                    obstacles.splice(i, 1);
                    popups.push({ x: player.x, y: player.y - 20, text: 'Shield!', ttl: 1.2 });
                    AudioManager.play('pickup');
                    continue;
                }
                endGame();
                AudioManager.play('gameover');
                return;
            }
        }

        // パワーアップ更新と衝突判定
        for (let i = powerUps.length - 1; i >= 0; i--) {
            const pu = powerUps[i];
            pu.update(delta);
            if (pu.isOutOfBounds()) {
                powerUps.splice(i, 1);
                continue;
            }
            if (pu.collidesWith(player)) {
                applyPowerUp(pu.type);
                powerUps.splice(i, 1);
                AudioManager.play('pickup');
            }
        }

        // ポップアップ更新（ttl は秒）
        for (let i = popups.length - 1; i >= 0; i--) {
            const p = popups[i];
            p.y -= 20 * (delta || 0);
            p.ttl -= (delta || 0);
            if (p.ttl <= 0) popups.splice(i, 1);
        }

        // 画面を描画とUI更新（1回だけ）
        draw();
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
    // baseSpeed を計算し、slowFactor を掛けて実効速度を決定
    const baseIncrease = (gameState.gameTime / 60) * (MAX_SPEED - INITIAL_SPEED);
    gameState.baseSpeed = INITIAL_SPEED + Math.min(baseIncrease, MAX_SPEED - INITIAL_SPEED);
    gameState.speed = gameState.baseSpeed * (gameState.slowFactor || 1);

    // 障害物出現率を増やす
    const spawnIncrease = (gameState.gameTime / 60) * (MAX_SPAWN_RATE - INITIAL_SPAWN_RATE);
    gameState.spawnRate = INITIAL_SPAWN_RATE + Math.min(spawnIncrease, MAX_SPAWN_RATE - INITIAL_SPAWN_RATE);

    // パワーアップ出現率は低めに増加
    const puIncrease = (gameState.gameTime / 120) * (MAX_POWERUP_SPAWN - INITIAL_POWERUP_SPAWN);
    gameState.powerupSpawnRate = INITIAL_POWERUP_SPAWN + Math.min(puIncrease, MAX_POWERUP_SPAWN - INITIAL_POWERUP_SPAWN);

    // 特殊障害物の出現確率を増やす
    gameState.specialChance = Math.min(0.05 + gameState.gameTime / 1200, 0.4);
}

// パワーアップ効果適用
function applyPowerUp(type) {
    if (type === 'shield') {
        player.shield = true;
        player.shieldUntil = Date.now() + 8000; // 8秒
        popups.push({ x: player.x, y: player.y - 20, text: 'Shield Acquired', ttl: 1.8 });
    } else if (type === 'slow') {
        gameState.slowFactor = 0.5;
        gameState.slowUntil = Date.now() + 6000; // 6秒
        popups.push({ x: player.x, y: player.y - 20, text: 'Slow Down', ttl: 1.8 });
    } else if (type === 'bonus') {
        gameState.score += 50;
        popups.push({ x: player.x, y: player.y - 20, text: '+50', ttl: 1.8 });
    }
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
    // パワーアップを描画
    for (let pu of powerUps) {
        pu.draw(ctx);
    }

    // 障害物を描画
    for (let obstacle of obstacles) {
        obstacle.draw(ctx);
    }

    // プレイヤーを描画（シールド時の見た目変化を含む）
    if (player.shield) {
        ctx.save();
        ctx.shadowColor = '#00eaff';
        ctx.shadowBlur = 24;
        ctx.strokeStyle = '#00eaff';
        ctx.lineWidth = 4;
        ctx.strokeRect(player.x - 4, player.y - 4, player.width + 8, player.height + 8);
        ctx.restore();
    }
    player.draw(ctx);

    // ポップアップ（取得メッセージなど）を描画
    for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px Arial';
        ctx.fillText(p.text, p.x + 20, p.y);
        // TTL と位置の更新はメインループで行う（deltaTime ベース）
    }

    // パワーアップ状態をUIに表示
    const active = [];
    if (player.shield) active.push('Shield');
    if (gameState.slowFactor < 1) active.push('Slow');
    if (active.length === 0) powerupStatusDisplay.textContent = '';
    else powerupStatusDisplay.textContent = 'Power: ' + active.join(', ');
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

// タイトル画面用アニメーション
let titleAnimId = null;
function animateTitleCanvas() {
    if (!titleCanvas) return;
    const tctx = titleCanvas.getContext('2d');
    const w = titleCanvas.width;
    const h = titleCanvas.height;
    let offset = 0;
    function frame() {
        tctx.clearRect(0, 0, w, h);
        // 背景グラデ
        const g = tctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, 'rgba(10,10,30,0.6)');
        g.addColorStop(1, 'rgba(20,0,30,0.4)');
        tctx.fillStyle = g;
        tctx.fillRect(0, 0, w, h);

        // 動くライン
        tctx.strokeStyle = 'rgba(0,200,255,0.08)';
        tctx.lineWidth = 2;
        for (let i = -2; i < 20; i++) {
            tctx.beginPath();
            const x = ((i * 80 + offset) % (w + 200)) - 100;
            tctx.moveTo(x, 0);
            tctx.lineTo(x + 120, h);
            tctx.stroke();
        }
        offset += 1.2;
        if (titleScreen.classList.contains('active')) titleAnimId = requestAnimationFrame(frame);
        else {
            tctx.clearRect(0, 0, w, h);
            if (titleAnimId) cancelAnimationFrame(titleAnimId);
            titleAnimId = null;
        }
    }
    if (!titleAnimId) frame();
}

// 初期表示時の準備
if (titleCanvas) animateTitleCanvas();
if (muteBtn) muteBtn.textContent = AudioManager.muted ? 'SOUND: OFF' : 'SOUND: ON';

// すべてのゲーム状態を初期化する（restart/retry 用）
function resetAllState() {
    gameState.isRunning = true;
    gameState.isPaused = false;
    gameState.score = 0;
    gameState.level = 1;
    gameState.gameTime = 0;
    gameState.startTime = Date.now();
    gameState.baseSpeed = INITIAL_SPEED;
    gameState.speed = INITIAL_SPEED;
    gameState.spawnRate = INITIAL_SPAWN_RATE;
    gameState.powerupSpawnRate = INITIAL_POWERUP_SPAWN;
    gameState.slowFactor = 1;
    gameState.slowUntil = null;
    gameState.specialChance = 0;

    // 障害物やプレイヤーの状態をリセット
    obstacles = [];
    powerUps = [];
    popups = [];
    player.x = CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2;
    player.y = CANVAS_HEIGHT - PLAYER_HEIGHT - 20;
    player.moveLeft = false;
    player.moveRight = false;

    // プレイヤーのパワーアップ状態をリセット
    player.shield = false;
    player.shieldUntil = null;

    lastLevel = 0;

    // 既存のエラーはクリア
    lastError = null;
    removeErrorOverlay();
    // lastTimestamp をリセットして delta 計算を初期化
    lastTimestamp = null;
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
