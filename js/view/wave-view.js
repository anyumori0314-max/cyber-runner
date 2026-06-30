// ===================================
// view/wave-view.js — ウェーブ演出の Canvas 描画（Phase 11）
//
// 責務: ウェーブ番号バッジ・開始/終了演出・休憩カウント・進捗バーの描画のみ。
//   waveState/gameState を読み取り専用で参照する。ゲームルールは持たない。
//
// 依存方向: config / state（読取）。ctx は renderer から受け取る。DOM は触らない。
// ===================================

import { CANVAS_WIDTH } from '../config.js';
import { waveState, gameState } from '../state.js';
import { WAVE_META, waveDurationSec } from '../model/waves.js';

// 画面上部の中央バナー（共通描画）。
function banner(ctx, title, sub, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#00ffcc';
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 18;
    ctx.font = 'bold 40px Arial';
    ctx.fillText(title, CANVAS_WIDTH / 2, 160);
    if (sub) {
        ctx.fillStyle = '#bafff0';
        ctx.shadowBlur = 8;
        ctx.font = '18px Arial';
        ctx.fillText(sub, CANVAS_WIDTH / 2, 192);
    }
    ctx.restore();
}

// ウェーブ番号バッジ（常時・左上の2段目より上に小さく）。
function drawBadge(ctx) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7afcd8';
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 6;
    ctx.font = 'bold 16px Arial';
    const cycleText = waveState.cycle > 1 ? `  CYCLE ${waveState.cycle}` : '';
    ctx.fillText(`WAVE ${waveState.waveNumber}/5${cycleText}`, 12, 26);
    ctx.restore();
}

// 'active' 中の進捗バー（上端）。Training（manual）では表示しない。
function drawProgress(ctx) {
    if (waveState.manual) return;
    const dur = waveDurationSec(gameState.mode);
    const ratio = Math.max(0, Math.min(1, waveState.phaseTime / dur));
    ctx.save();
    ctx.fillStyle = 'rgba(0,255,204,0.18)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, 4);
    ctx.fillStyle = '#00ffcc';
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 6;
    ctx.fillRect(0, 0, CANVAS_WIDTH * ratio, 4);
    ctx.restore();
}

export function drawWaveOverlay(ctx) {
    if (!waveState.enabled) return;
    drawBadge(ctx);
    const meta = WAVE_META[waveState.waveType] || { title: `WAVE ${waveState.waveNumber}`, sub: '' };
    switch (waveState.phase) {
        case 'intro':
            banner(ctx, `WAVE ${waveState.waveNumber}`, meta.sub);
            break;
        case 'active':
            drawProgress(ctx);
            break;
        case 'outro':
            banner(ctx, 'WAVE CLEAR', '', 0.9);
            break;
        case 'intermission':
            if (!waveState.manual) banner(ctx, 'GET READY', 'NEXT WAVE', 0.85);
            break;
        default:
            break;
    }
}
