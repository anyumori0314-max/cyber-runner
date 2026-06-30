// ===================================
// view/boss-view.js — ボス演出の Canvas 描画（Phase 11）
//
// 責務: ボス出現警告・HP バー・ボス名/ヒント・ボス本体（Data Worm）・安全地帯（Firewall）・
//   撃破演出の描画のみ。waveState を読み取り専用で参照。ゲームルール・判定は持たない。
//
// 依存方向: config（キャンバス寸法・HP バー余白の幾何のみ）/ state（読取）/
//   model(bosses, balance の警告/撃破時間・安全地帯幅＝選択中 preset)。
//   Phase 11 のバランス値（安全地帯幅・警告/撃破時間）は balance アクセサ経由（config 直接参照は幾何のみ）。
//   ctx は renderer から受け取る。DOM は触らない。
// ===================================

import {
    CANVAS_WIDTH,
    BOSS_BAR_MARGIN,
    CANVAS_HEIGHT
} from '../config.js';
import { waveState } from '../state.js';
import { bossHpRatio, firewallSafeCenter } from '../model/bosses.js';
import { getBossWarningDuration, getBossDefeatDuration, getFirewallSafeWidth } from '../model/balance.js';

// ボス出現前の警告バナー（点滅）。
function drawWarning(ctx) {
    const t = waveState.phaseTime;
    const blink = 0.5 + 0.5 * Math.sin(t * 12);
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.45 * blink;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff4060';
    ctx.shadowColor = '#ff4060';
    ctx.shadowBlur = 22;
    ctx.font = 'bold 44px Arial';
    ctx.fillText('⚠ WARNING ⚠', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);
    ctx.font = 'bold 22px Arial';
    ctx.fillStyle = '#ffd0d8';
    ctx.shadowBlur = 8;
    ctx.fillText('BOSS APPROACHING', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 18);
    // 残り時間バー（回避準備の猶予を可視化）。警告時間は active preset 由来。
    const ratio = Math.max(0, 1 - t / getBossWarningDuration());
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,64,96,0.25)';
    ctx.fillRect(CANVAS_WIDTH / 2 - 120, CANVAS_HEIGHT / 2 + 36, 240, 8);
    ctx.fillStyle = '#ff4060';
    ctx.fillRect(CANVAS_WIDTH / 2 - 120, CANVAS_HEIGHT / 2 + 36, 240 * ratio, 8);
    ctx.restore();
}

// HP バー（上端・名前つき）。
function drawHpBar(ctx, boss) {
    const x = BOSS_BAR_MARGIN;
    const y = 36;
    const w = CANVAS_WIDTH - BOSS_BAR_MARGIN * 2;
    const h = 16;
    const ratio = bossHpRatio(boss);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd0d8';
    ctx.font = 'bold 14px Arial';
    ctx.shadowColor = '#ff4060';
    ctx.shadowBlur = 6;
    ctx.fillText(`${boss.name}   HP ${boss.hp}/${boss.maxHp}`, CANVAS_WIDTH / 2, y - 6);
    // 枠と残量
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = boss.flash > 0 ? '#ffffff' : '#ff3b5c';
    ctx.shadowColor = '#ff3b5c';
    ctx.shadowBlur = 10;
    ctx.fillRect(x, y, w * ratio, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 0;
    ctx.strokeRect(x, y, w, h);
    // ヒント
    ctx.fillStyle = '#bafff0';
    ctx.font = '12px Arial';
    ctx.fillText(boss.hint || '', CANVAS_WIDTH / 2, y + h + 16);
    ctx.restore();
}

// Firewall Core: 移動する安全地帯を可視化（縦の安全帯）。
function drawFirewallSafeZone(ctx, boss) {
    const safeWidth = getFirewallSafeWidth();
    const center = firewallSafeCenter(boss);
    const left = center - safeWidth / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(0,255,170,0.10)';
    ctx.fillRect(left, 0, safeWidth, CANVAS_HEIGHT);
    ctx.strokeStyle = 'rgba(0,255,170,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(left, 0, safeWidth, CANVAS_HEIGHT);
    ctx.setLineDash([]);
    ctx.fillStyle = '#7affd8';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('SAFE', center, CANVAS_HEIGHT - 12);
    ctx.restore();
}

// Data Worm: 上部を移動する本体。
function drawWormBody(ctx, boss) {
    ctx.save();
    ctx.translate(boss.x, boss.y);
    ctx.fillStyle = boss.flash > 0 ? '#ffffff' : '#b84cff';
    ctx.shadowColor = '#b84cff';
    ctx.shadowBlur = 20;
    // 体節
    const seg = boss.width / 4;
    for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(seg * i + seg / 2, boss.height / 2, boss.height / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
    }
    // 目
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(boss.width - seg / 2, boss.height / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    // 攻撃警告（!）
    if (boss.warningActive) {
        ctx.fillStyle = '#ff4060';
        ctx.shadowColor = '#ff4060';
        ctx.font = 'bold 22px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('!', boss.width / 2, -6);
    }
    ctx.restore();
}

// 撃破演出。
function drawDefeated(ctx) {
    ctx.save();
    // 撃破演出の残り時間に合わせてフェード（撃破時間は active preset 由来）。
    ctx.globalAlpha = Math.max(0.4, 1 - waveState.phaseTime / getBossDefeatDuration());
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe066';
    ctx.shadowColor = '#ffe066';
    ctx.shadowBlur = 20;
    ctx.font = 'bold 40px Arial';
    ctx.fillText('BOSS DEFEATED', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    ctx.restore();
}

export function drawBossOverlay(ctx) {
    if (!waveState.enabled) return;
    if (waveState.phase === 'boss-warning') { drawWarning(ctx); return; }
    if (waveState.phase === 'boss-defeated') { drawDefeated(ctx); return; }
    if (waveState.phase !== 'boss' || !waveState.boss) return;
    const boss = waveState.boss;
    if (boss.type === 'firewall') drawFirewallSafeZone(ctx, boss);
    if (boss.type === 'worm') drawWormBody(ctx, boss);
    drawHpBar(ctx, boss);
}
