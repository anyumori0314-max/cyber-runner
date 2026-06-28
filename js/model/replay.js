// ===================================
// model/replay.js — ゴースト記録 / リプレイ（Phase 10）
//
// 責務: プレイ中のプレイヤー位置を固定間隔でサンプリングし、自己ベスト更新時に
//   IndexedDB へ保存。ベストゴーストの読込・補間・リプレイ再生（ゲーム state と分離）。
//   当たり判定なし・障害物へ干渉しない（描画専用データ）。
//   ★ リプレイはゲーム state を一切変更しない（独立データのみ操作）。スコア送信もしない。
//
// 依存方向: config（DB名・間隔・版数）/ util/indexed-db（保存・読込）。DOM/Canvas/通信に触れない。
// ===================================

import {
    REPLAY_DB_NAME,
    REPLAY_STORE_NAME,
    GHOST_SAMPLE_INTERVAL_SEC,
    GHOST_MAX_SAMPLES,
    GAME_VERSION
} from '../config.js';
import { idbPut, idbGet } from '../util/indexed-db.js';

// ===================================
// 純粋ヘルパ（Node でテスト可能）
// ===================================
export function shouldSample(lastSampleT, currentT, interval = GHOST_SAMPLE_INTERVAL_SEC) {
    return currentT - lastSampleT >= interval;
}

// サンプル列から時刻 t の x を線形補間する（範囲外は端で固定）。
export function interpolateX(samples, t) {
    if (!samples || samples.length === 0) return null;
    if (t <= samples[0].t) return samples[0].x;
    const last = samples[samples.length - 1];
    if (t >= last.t) return last.x;
    // 二分探索で t を含む区間を探す
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].t <= t) lo = mid; else hi = mid;
    }
    const a = samples[lo];
    const b = samples[hi];
    const span = b.t - a.t || 1;
    const r = (t - a.t) / span;
    return a.x + (b.x - a.x) * r;
}

export function buildGhostRecord(mode, samples, meta = {}) {
    return {
        version: GAME_VERSION,
        mode,
        samples: samples || [],
        score: Math.floor(meta.score || 0),
        maxCombo: Math.floor(meta.maxCombo || 0),
        createdAt: Date.now()
    };
}

// ===================================
// 記録（プレイ中）
// ===================================
let recording = null; // { mode, samples, lastT }

export function startRecording(mode) {
    recording = { mode, samples: [], lastT: -Infinity };
}

// 毎フレーム呼ぶ（内部で固定間隔に間引く）。Training は記録しない。
export function sampleGhost(gameState, player) {
    if (!recording || recording.mode === 'training') return;
    if (recording.samples.length >= GHOST_MAX_SAMPLES) return;
    const t = gameState.gameTime;
    if (!shouldSample(recording.lastT, t)) return;
    recording.samples.push({ t, x: player.x, score: Math.floor(gameState.score), level: gameState.level });
    recording.lastT = t;
}

export function getRecordedSamples() {
    return recording ? recording.samples.slice() : [];
}

// 自己ベスト時にゴーストを保存する（呼び出し側がベスト判定する）。戻り値 bool。
export async function saveBestGhost(mode, meta = {}) {
    const record = buildGhostRecord(mode, getRecordedSamples(), meta);
    if (record.samples.length === 0) return false;
    return idbPut(REPLAY_DB_NAME, REPLAY_STORE_NAME, mode, record);
}

// ===================================
// ゴースト表示（通常プレイ中・モード別）
// ===================================
let activeGhost = null; // 現在モードのベストゴースト（描画用）
let ghostEnabled = true;

export function setGhostEnabled(on) { ghostEnabled = on === true; }
export function isGhostEnabled() { return ghostEnabled; }

export async function loadGhost(mode) {
    return idbGet(REPLAY_DB_NAME, REPLAY_STORE_NAME, mode);
}

// 現在モードのゴーストを読み込んで表示用にセットする。
export async function prepareGhostForMode(mode) {
    activeGhost = await loadGhost(mode);
    return activeGhost;
}

export function clearActiveGhost() { activeGhost = null; }

// ゴーストの状態 'none' | 'stale'（旧バージョン） | 'ok'。
export function getGhostStatus() {
    if (!activeGhost || !activeGhost.samples || activeGhost.samples.length === 0) return 'none';
    if (activeGhost.version !== GAME_VERSION) return 'stale';
    return 'ok';
}

// 描画用ゴースト位置（無効/未設定/旧版/OFF は null）。当たり判定には使わない。
export function getGhostDisplayX(gameState) {
    if (!ghostEnabled) return null;
    if (getGhostStatus() !== 'ok') return null;
    return interpolateX(activeGhost.samples, gameState.gameTime);
}

// ===================================
// リプレイ再生（オーバーレイ用・ゲーム state とは完全分離）
// ===================================
export function createReplayPlayer(record) {
    const samples = (record && record.samples) || [];
    const duration = samples.length ? samples[samples.length - 1].t : 0;
    const stale = record && record.version !== GAME_VERSION;
    const state = { time: 0, playing: false, speed: 1, duration, samples, stale };
    return {
        isStale: () => stale,
        getDuration: () => duration,
        getSpeed: () => state.speed,
        isPlaying: () => state.playing,
        play() { state.playing = true; },
        pause() { state.playing = false; },
        restart() { state.time = 0; state.playing = true; },
        setSpeed(s) { state.speed = s === 2 ? 2 : 1; },
        // dt 秒進める（再生中のみ）。終端で停止。戻り値: 終端到達したか。
        step(dt) {
            if (!state.playing) return false;
            state.time += dt * state.speed;
            if (state.time >= duration) { state.time = duration; state.playing = false; return true; }
            return false;
        },
        getTime: () => state.time,
        getProgress: () => (duration > 0 ? state.time / duration : 0),
        positionAt() { return interpolateX(samples, state.time); },
        sampleAt() {
            // 近傍サンプル（HUD 用の score/level）。
            const t = state.time;
            let nearest = samples[0] || { score: 0, level: 1, x: 0 };
            for (const s of samples) { if (s.t <= t) nearest = s; else break; }
            return nearest;
        }
    };
}
