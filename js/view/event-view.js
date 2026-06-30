// ===================================
// view/event-view.js — ランダムイベント演出の Canvas 描画（Phase 11）
//
// 責務: 進行中イベントの名称・残り時間バー・開始/終了/警告表示の描画のみ。
//   waveState を読み取り専用で参照。効果適用やルールは持たない（model/random-events 所有）。
//
// 依存方向: config / state（読取）/ model(random-events のメタ)。ctx は renderer から受け取る。
// ===================================

import { CANVAS_WIDTH } from '../config.js';
import { waveState } from '../state.js';
import { getEventDef } from '../model/random-events.js';

export function drawEventOverlay(ctx) {
    const ev = waveState.event;
    if (!ev) return;
    const def = getEventDef(ev.id) || { name: ev.name, color: '#ffffff', icon: '★' };

    // HIGH SPEED 等の事前警告（効果適用前）。
    if (ev.warning > 0) {
        const blink = 0.5 + 0.5 * Math.sin(waveState.phaseTime * 14 + 1);
        ctx.save();
        ctx.globalAlpha = 0.6 + 0.4 * blink;
        ctx.textAlign = 'center';
        ctx.fillStyle = def.color;
        ctx.shadowColor = def.color;
        ctx.shadowBlur = 16;
        ctx.font = 'bold 26px Arial';
        ctx.fillText(`${def.name} INCOMING`, CANVAS_WIDTH / 2, 240);
        ctx.restore();
    }

    // 進行中バッジ（右上）＋残り時間バー。
    const boxW = 188;
    const x = CANVAS_WIDTH - boxW - 12;
    const y = 52;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, y, boxW, 34);
    ctx.fillStyle = def.color;
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 8;
    ctx.font = 'bold 15px Arial';
    ctx.fillText(`${def.icon} ${def.name}`, x + 8, y + 16);
    // 残り時間バー
    const ratio = ev.warning > 0 ? 1 : Math.max(0, Math.min(1, ev.remaining / ev.total));
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x + 8, y + 22, boxW - 16, 6);
    ctx.fillStyle = def.color;
    ctx.fillRect(x + 8, y + 22, (boxW - 16) * ratio, 6);
    ctx.restore();
}
