// ===================================
// view/renderer.js — Canvas 描画（Stage 4）
//
// 責務: ゲーム画面の Canvas 描画のみ（背景・グリッド・各エンティティ・シールド・
//       プレイヤー・ポップアップ）。state を読み取り専用で参照し、書き換えない。
//
// 依存方向: config（キャンバス寸法）と state（描画対象の配列・player）を import。
//   ctx は外部（controller）から引数で受け取る。DOM は触らない（HUD は hud.js）。
// 描画結果は従来と同一。
// ===================================

import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config.js';
import { player, obstacles, powerUps, energyCores, particles, popups } from '../state.js';

// グリッドパターン描画（背景エフェクト）
export function drawGrid(ctx) {
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

// ゲームシーン全体を描画する（毎フレーム呼ばれる）。
export function drawScene(ctx) {
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
    drawGrid(ctx);

    // パワーアップを描画
    for (let pu of powerUps) {
        pu.draw(ctx);
    }

    // エネルギーコアを描画
    for (let core of energyCores) {
        core.draw(ctx);
    }

    // パーティクルを描画
    for (let particle of particles) {
        particle.draw(ctx);
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
    // TTL と位置の更新はメインループで行う（deltaTime ベース）
    for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px Arial';
        ctx.fillText(p.text, p.x + 20, p.y);
    }
}
