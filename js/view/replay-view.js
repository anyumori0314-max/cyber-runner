// ===================================
// view/replay-view.js — 自己ベストリプレイ再生 / ゴースト表示トグル（Phase 10）
//
// 責務: ベストゴーストの簡易リプレイ（再生/一時停止/最初から/1x・2x）を専用 Canvas に描く。
//   ★ ゲーム本体の state には一切触れない（model/replay の独立データのみ）。
//   ★ リプレイ中はスコア送信しない（通信モジュールを import しない）。
//   再生は専用 RAF（replayRaf）で行い、閉じる/停止で必ず cancel する（ゲーム RAF とは排他）。
//
// 依存方向: config（寸法）/ model/replay（読込・再生プレイヤー）。
// ===================================

import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config.js';
import { loadGhost, createReplayPlayer, setGhostEnabled, isGhostEnabled } from '../model/replay.js';

let refs = {
    replayCanvas: null,
    replayStatus: null,
    replayPlayBtn: null,
    replayPauseBtn: null,
    replayRestartBtn: null,
    replaySpeedBtn: null,
    ghostToggle: null
};
let bound = false;
let player = null; // createReplayPlayer() のインスタンス
let replayRaf = null;
let lastTs = null;

export function configureReplayView(elements) {
    refs = { ...refs, ...elements };
    bindEvents();
    if (refs.ghostToggle) refs.ghostToggle.checked = isGhostEnabled();
}

function bindEvents() {
    if (bound) return;
    bound = true;
    if (refs.replayPlayBtn) refs.replayPlayBtn.addEventListener('click', () => { if (player) { player.play(); startRaf(); } });
    if (refs.replayPauseBtn) refs.replayPauseBtn.addEventListener('click', () => { if (player) { player.pause(); stopRaf(); } });
    if (refs.replayRestartBtn) refs.replayRestartBtn.addEventListener('click', () => { if (player) { player.restart(); startRaf(); } });
    if (refs.replaySpeedBtn) refs.replaySpeedBtn.addEventListener('click', () => {
        if (!player) return;
        const next = player.getSpeed() === 1 ? 2 : 1;
        player.setSpeed(next);
        refs.replaySpeedBtn.textContent = `${next}x`;
    });
    if (refs.ghostToggle) refs.ghostToggle.addEventListener('change', () => setGhostEnabled(refs.ghostToggle.checked));
}

// 指定モードのベストゴーストを読み込んでリプレイを準備する。
export async function openReplay(mode) {
    stopRaf();
    player = null;
    const record = await loadGhost(mode);
    if (!record || !record.samples || record.samples.length === 0) {
        setStatus('このモードのリプレイはまだありません。自己ベストを更新すると保存されます。');
        clearCanvas();
        return;
    }
    player = createReplayPlayer(record);
    if (player.isStale()) {
        setStatus('⚠ 旧バージョンの記録です。再生は参考表示です（位置のみ）。');
    } else {
        setStatus('再生できます。▶ で開始。');
    }
    if (refs.replaySpeedBtn) refs.replaySpeedBtn.textContent = '1x';
    drawFrame();
}

// オーバーレイを閉じる（RAF を必ず止める）。
export function closeReplay() {
    stopRaf();
    if (player) player.pause();
}

function setStatus(msg) {
    if (refs.replayStatus) refs.replayStatus.textContent = msg || '';
}

function startRaf() {
    if (replayRaf != null) return; // 二重起動防止
    lastTs = null;
    replayRaf = requestAnimationFrame(tick);
}
function stopRaf() {
    if (replayRaf != null) {
        cancelAnimationFrame(replayRaf);
        replayRaf = null;
    }
}

function tick(ts) {
    if (!player) { replayRaf = null; return; }
    let dt = 0;
    if (lastTs != null) dt = Math.min((ts - lastTs) / 1000, 0.1);
    lastTs = ts;
    const ended = player.step(dt);
    drawFrame();
    if (ended || !player.isPlaying()) {
        replayRaf = null; // 終端/停止で RAF を解放
        if (ended) setStatus('再生終了。⏮ で最初から。');
        return;
    }
    replayRaf = requestAnimationFrame(tick);
}

function clearCanvas() {
    const canvas = refs.replayCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// リプレイ1フレームを描画（プレイヤー位置の再生＝MVP。障害物は再現しない）。
function drawFrame() {
    const canvas = refs.replayCanvas;
    if (!canvas || !player) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const sx = W / CANVAS_WIDTH;
    const sy = H / CANVAS_HEIGHT;

    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, W, H);
    // グリッド
    ctx.strokeStyle = 'rgba(0,255,136,0.08)';
    for (let x = 0; x < W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // プレイヤー（再生位置）
    const px = player.positionAt() * sx;
    const py = (CANVAS_HEIGHT - 60) * sy;
    ctx.fillStyle = '#00ff88';
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 10;
    ctx.fillRect(px, py, 40 * sx, 40 * sy);
    ctx.shadowBlur = 0;

    // HUD（記録時のスコア/レベル）
    const s = player.sampleAt();
    ctx.fillStyle = '#e8f6ff';
    ctx.font = '12px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE ${s.score || 0}  LV ${s.level || 1}`, 8, 16);
    // 進捗バー
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(0, H - 4, W, 4);
    ctx.fillStyle = '#00eaff';
    ctx.fillRect(0, H - 4, W * player.getProgress(), 4);
}
