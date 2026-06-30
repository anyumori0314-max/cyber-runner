// ===================================
// model/waves.js — ウェーブ定義と進行の純粋ロジック（Phase 11）
//
// 責務: ウェーブ列（normal→homing→laser→gapwall→boss）の定義、ウェーブ番号・種別の解決、
//   サイクル難易度係数・ウェーブ時間（Hardcore 補正込み）の算出。副作用なし。
//   DOM/Canvas/通信に触れない（描画は view/wave-view、進行制御は controller/wave-controller）。
//
// 依存方向: balance（ウェーブ列・難易度係数・ウェーブ長・Hardcore 補正＝選択中 preset）。
//   Phase 11 のウェーブ進行/難易度値は active balance preset が唯一の正本（config 直接参照なし）。
// ===================================

import {
    getWaveSequence,
    getWaveDurationBase,
    getHardcoreWaveFactor,
    getCycleDifficultyStep
} from './balance.js';

// 各ウェーブ種別の表示メタ（タイトル/サブ）。boss は別途 bosses.js が名称を持つ。
export const WAVE_META = {
    normal: { title: 'WAVE 1', sub: 'STANDARD OBSTACLES' },
    homing: { title: 'WAVE 2', sub: 'HOMING THREATS' },
    laser: { title: 'WAVE 3', sub: 'WARNING LASERS' },
    gapwall: { title: 'WAVE 4', sub: 'GAP WALLS' },
    boss: { title: 'WAVE 5', sub: 'BOSS BATTLE' }
};

// ウェーブ数（1サイクルの長さ）。
export function waveCount() {
    return getWaveSequence().length;
}

// index(0..n-1) からウェーブ種別を返す（範囲外は循環）。
export function waveTypeAt(index) {
    const seq = getWaveSequence();
    const n = seq.length;
    return seq[((index % n) + n) % n];
}

// 表示用ウェーブ番号（1始まり）。
export function waveNumberAt(index) {
    const n = getWaveSequence().length;
    return (((index % n) + n) % n) + 1;
}

// 指定 index がボスウェーブか。
export function isBossWaveAt(index) {
    return waveTypeAt(index) === 'boss';
}

// サイクル難易度係数（速度などへ (1 + bonus) で乗る）。cycle=1 で 0。
export function cycleDifficultyBonus(cycle) {
    const c = Number.isFinite(cycle) && cycle >= 1 ? cycle : 1;
    return (c - 1) * getCycleDifficultyStep();
}

// 通常ウェーブの長さ（秒）。Hardcore はウェーブ進行を速める（時間短縮）。
export function waveDurationSec(mode) {
    const base = getWaveDurationBase();
    return mode === 'hardcore' ? base * getHardcoreWaveFactor() : base;
}
