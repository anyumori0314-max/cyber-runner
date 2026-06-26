// ===================================
// model/entities.js — ゲームエンティティ（Stage 3）
//
// 責務: Player / Obstacle / EnergyCore / PowerUp / Particle の状態更新と自己描画。
// ゲーム向けMVCの慣習に従い update()（状態更新）と draw(ctx)（描画）を同居させる。
//
// 依存方向: config のみを import する（リーフに近い純粋Model）。
//   循環依存を避けるため state.js は import せず、実行時に必要な gameState は
//   コンストラクタ / update() の引数で受け取る（呼び出し側 = controller が渡す）。
//   draw(ctx) の ctx も外部から渡される（エンティティは DOM/Canvas を取りに行かない）。
// 既存挙動（サイズ・速度・色・描画結果・当たり判定・update・spawn位置）は不変。
// ===================================

import {
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    PLAYER_WIDTH,
    PLAYER_HEIGHT,
    OBSTACLE_WIDTH,
    OBSTACLE_HEIGHT,
    SPEED_UNIT_TO_PX_PER_SEC,
    PLAYER_SPEED_PX_PER_SEC,
    ENERGY_CORE_WIDTH,
    ENERGY_CORE_HEIGHT
} from '../config.js';

// 軸並行矩形（AABB）同士の衝突判定（全エンティティ共通）。
function intersects(a, player) {
    return (
        a.x < player.x + player.width &&
        a.x + a.width > player.x &&
        a.y < player.y + player.height &&
        a.y + a.height > player.y
    );
}

// ===================================
// Player — 自機（入力状態 moveLeft/moveRight・シールド状態を保持）
// ===================================
export class Player {
    constructor() {
        this.width = PLAYER_WIDTH;
        this.height = PLAYER_HEIGHT;
        // speed: px per second（従来のフレーム基準値から変換済み）
        this.speed = PLAYER_SPEED_PX_PER_SEC;
        this.moveLeft = false;
        this.moveRight = false;
        this.shield = false;
        this.shieldUntil = null;
        this.reset();
    }

    // 位置と一時状態を初期化（START / RETRY 用）。
    reset() {
        this.x = CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2;
        this.y = CANVAS_HEIGHT - PLAYER_HEIGHT - 20;
        this.moveLeft = false;
        this.moveRight = false;
        this.shield = false;
        this.shieldUntil = null;
    }

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
    }

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
}

// ===================================
// Obstacle — 障害物（normal / fast / large / zigzag）
// ===================================
export class Obstacle {
    constructor(gameState) {
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
    update(delta, gameState) {
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
        return intersects(this, player);
    }
}

// ===================================
// PowerUp — パワーアップ（shield / slow / bonus）
// ===================================
export class PowerUp {
    constructor(gameState) {
        this.types = ['shield', 'slow', 'bonus'];
        this.type = this.types[Math.floor(Math.random() * this.types.length)];
        this.x = Math.random() * (CANVAS_WIDTH - 30);
        this.y = -30;
        this.width = 30;
        this.height = 30;
        this.speed = gameState.speed * SPEED_UNIT_TO_PX_PER_SEC * 0.6;
        this.color = this.type === 'shield' ? '#00eaff' : this.type === 'slow' ? '#ffaa00' : '#ffe066';
    }
    update(delta, gameState) {
        this.speed = gameState.speed * SPEED_UNIT_TO_PX_PER_SEC * 0.6;
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
        return intersects(this, player);
    }
}

// ===================================
// EnergyCore — エネルギーコア（取得で +100・コンボ増加）
// ===================================
export class EnergyCore {
    constructor(gameState) {
        this.x = Math.random() * (CANVAS_WIDTH - ENERGY_CORE_WIDTH);
        this.y = -ENERGY_CORE_HEIGHT;
        this.width = ENERGY_CORE_WIDTH;
        this.height = ENERGY_CORE_HEIGHT;
        this.speed = gameState.speed * SPEED_UNIT_TO_PX_PER_SEC * 0.5;
        this.color = '#ffff00'; // 黄色で目立つ
        this.rotation = 0; // 回転アニメーション
    }
    update(delta, gameState) {
        this.speed = gameState.speed * SPEED_UNIT_TO_PX_PER_SEC * 0.5;
        this.y += (this.speed * (delta || 0));
        this.rotation += (delta || 0) * 3; // 回転速度
    }
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
        ctx.rotate(this.rotation);
        // 星形の中心部分
        ctx.fillStyle = '#ffff00';
        ctx.shadowColor = '#ffff00';
        ctx.shadowBlur = 16;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
            const x = 8 * Math.cos(angle);
            const y = 8 * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        // 枠
        ctx.strokeStyle = '#ffff88';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }
    isOutOfBounds() {
        return this.y > CANVAS_HEIGHT;
    }
    collidesWith(player) {
        return intersects(this, player);
    }
}

// ===================================
// Particle — パーティクル効果（core / combo / その他）
// ===================================
export class Particle {
    constructor(x, y, type = 'core') {
        this.x = x;
        this.y = y;
        this.type = type; // 'core', 'combo', 'shield' など
        this.life = 1.0; // 0 ～ 1
        this.lifeMax = type === 'core' ? 0.6 : 0.4;
        if (type === 'core') {
            this.vx = (Math.random() - 0.5) * 200;
            this.vy = (Math.random() - 0.5) * 200;
            this.size = 6;
        } else if (type === 'combo') {
            this.vx = 0;
            this.vy = -100;
            this.size = 10;
        } else {
            this.vx = (Math.random() - 0.5) * 100;
            this.vy = (Math.random() - 0.5) * 100;
            this.size = 4;
        }
    }
    update(delta) {
        this.life -= (delta || 0) / this.lifeMax;
        this.x += this.vx * (delta || 0);
        this.y += this.vy * (delta || 0);
        this.vy += 300 * (delta || 0); // gravity
    }
    draw(ctx) {
        const alpha = Math.max(0, this.life);
        ctx.save();
        ctx.globalAlpha = alpha;
        if (this.type === 'core') {
            ctx.fillStyle = '#ffff00';
        } else if (this.type === 'combo') {
            ctx.fillStyle = '#ff00ff';
        } else {
            ctx.fillStyle = '#00ffff';
        }
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    isDead() {
        return this.life <= 0;
    }
}
