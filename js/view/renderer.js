// ===================================
// view/renderer.js — Canvas 描画（Phase 3 で演出強化）
//
// 責務: ゲーム画面の Canvas 描画のみ（背景・グリッド・各エンティティ・シールド・
//   プレイヤー・ポップアップ）と演出オーバーレイ（カウントダウン・コンボ警告・画面揺れ）。
//   state を読み取り専用で参照し、書き換えない。
//
// 依存方向: config（寸法・コンボ定数）/ state（描画対象）/ model/options（演出ON/OFF）。
//   ctx は外部（controller）から引数で受け取る。DOM は触らない（HUD は hud.js）。
// ===================================

import { CANVAS_WIDTH, CANVAS_HEIGHT, COMBO_TIMEOUT, COMBO_WARNING_SECONDS } from '../config.js';
import { player, obstacles, powerUps, energyCores, particles, popups, gameState } from '../state.js';
import { getOptions } from '../model/options.js';

// グリッドパターン描画（背景エフェクト）
export function drawGrid(ctx) {
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < CANVAS_WIDTH; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
    }
    for (let y = 0; y < CANVAS_HEIGHT; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.stroke();
    }
}

// 背景（クリア＋グラデ＋グリッド）。画面揺れの影響を受けないよう全面を描く。
function drawBackground(ctx) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gradient.addColorStop(0, 'rgba(10, 14, 39, 0.3)');
    gradient.addColorStop(0.5, 'rgba(26, 26, 62, 0.2)');
    gradient.addColorStop(1, 'rgba(10, 14, 39, 0.3)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawGrid(ctx);
}

// 画面揺れのオフセット（オプションOFFや残り時間0なら揺れなし）。
function shakeOffset() {
    const opt = getOptions();
    if (!opt.screenShakeEnabled || gameState.shakeTime <= 0) return null;
    const mag = gameState.shakeMag || 0;
    return { x: (Math.random() - 0.5) * 2 * mag, y: (Math.random() - 0.5) * 2 * mag };
}

// ゲームシーン全体を描画する（毎フレーム呼ばれる）。
export function drawScene(ctx) {
    const particlesEnabled = getOptions().particlesEnabled;
    drawBackground(ctx);

    // エンティティ群は画面揺れの影響を受ける
    const shake = shakeOffset();
    ctx.save();
    if (shake) ctx.translate(shake.x, shake.y);

    for (let pu of powerUps) pu.draw(ctx);
    for (let core of energyCores) core.draw(ctx);
    if (particlesEnabled) {
        for (let particle of particles) particle.draw(ctx);
    }
    for (let obstacle of obstacles) obstacle.draw(ctx);

    // プレイヤー（シールド or ダッシュ無敵時の見た目変化を含む）
    if (player.shield) {
        ctx.save();
        ctx.shadowColor = '#00eaff';
        ctx.shadowBlur = 24;
        ctx.strokeStyle = '#00eaff';
        ctx.lineWidth = 4;
        ctx.strokeRect(player.x - 4, player.y - 4, player.width + 8, player.height + 8);
        ctx.restore();
    }
    if (gameState.gameTime < gameState.dashInvulnUntil) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 18;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.strokeRect(player.x - 2, player.y - 2, player.width + 4, player.height + 4);
        ctx.restore();
    }
    player.draw(ctx);

    // ポップアップ（取得メッセージ・スコア表示など）。TTL/位置更新はメインループ。
    for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px Arial';
        ctx.fillText(p.text, p.x + 20, p.y);
    }
    ctx.restore();

    // 演出オーバーレイ（揺れの影響を受けない）
    drawComboWarning(ctx);
    drawCountdown(ctx);
}

// コンボ終了 約1秒前の点滅警告。
function drawComboWarning(ctx) {
    if (gameState.isPaused || gameState.combo <= 0) return;
    const remaining = COMBO_TIMEOUT - (gameState.gameTime - gameState.comboLastTime);
    if (remaining <= 0 || remaining > COMBO_WARNING_SECONDS) return;
    if (Math.sin(gameState.gameTime * 18) <= 0) return; // 点滅
    ctx.save();
    ctx.fillStyle = '#ff44cc';
    ctx.shadowColor = '#ff44cc';
    ctx.shadowBlur = 12;
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('COMBO BREAK WARNING', CANVAS_WIDTH / 2, 60);
    ctx.restore();
}

// 開始カウントダウン（3,2,1,GO!）。
function drawCountdown(ctx) {
    if (gameState.phase !== 'countdown') return;
    const c = gameState.countdown;
    const text = c > 0 ? String(Math.ceil(c)) : 'GO!';
    ctx.save();
    ctx.fillStyle = '#00ffcc';
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 24;
    ctx.font = 'bold 90px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    ctx.restore();
}
