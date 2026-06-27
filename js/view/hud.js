// ===================================
// view/hud.js — ゲーム中の HUD 表示（Stage 4）
//
// 責務: スコア / レベル / ハイスコア / コンボ / パワーアップ状態 / SOUND 状態の DOM 表示。
//       DOM 操作は textContent を優先し、state を読み取り専用で参照する。
//
// 依存方向: state（読取）と model/scoring（コンボ倍率）を import。DOM 要素は
//   configureHud() で main.js から注入される（View 自身は document を取りに行かない）。
// ===================================

import { player, gameState } from '../state.js';
import { getComboMultiplier, getNextRankInfo, floorScore } from '../model/scoring.js';
import { formatMission } from '../model/missions.js';

// main.js から注入される DOM 参照。
let refs = {
    currentScore: null,
    currentLevel: null,
    highScoreTitle: null,
    comboText: null,
    powerupStatus: null,
    muteBtn: null,
    // Phase 3-5 追加 HUD
    dashStatus: null,
    nextRank: null,
    powerupTimers: null,
    missionStatus: null
};

export function configureHud(elements) {
    refs = { ...refs, ...elements };
}

// パワーアップ状態表示（Power: Shield, Slow）。
export function updatePowerupStatus() {
    if (!refs.powerupStatus) return;
    const active = [];
    if (player.shield) active.push('Shield');
    if (gameState.slowFactor < 1) active.push('Slow');
    refs.powerupStatus.textContent = active.length === 0 ? '' : 'Power: ' + active.join(', ');
}

// HUD 全体を更新（毎フレーム呼ばれる）。
export function updateHud() {
    if (refs.currentScore) refs.currentScore.textContent = Math.floor(gameState.score);
    if (refs.currentLevel) refs.currentLevel.textContent = gameState.level;
    if (refs.highScoreTitle) refs.highScoreTitle.textContent = gameState.highScore;

    // コンボ表示を更新
    if (refs.comboText) {
        if (gameState.combo > 0) {
            const multiplier = getComboMultiplier(gameState.combo);
            const multiplierText = multiplier > 1.0 ? `x${multiplier.toFixed(1)}` : '';
            refs.comboText.textContent = `COMBO: ${gameState.combo} ${multiplierText}`;
        } else {
            refs.comboText.textContent = '';
        }
    }

    // パワーアップ状態も併せて更新（旧 draw() から HUD へ移動）
    updatePowerupStatus();

    // Phase 4: ダッシュ クールタイム表示
    if (refs.dashStatus) {
        const remain = gameState.dashReadyAt - gameState.gameTime;
        refs.dashStatus.textContent = remain > 0 ? `DASH: ${Math.ceil(remain)}s` : 'DASH: READY';
    }

    // Phase 3: 次ランクまでの目安
    if (refs.nextRank) {
        const info = getNextRankInfo(floorScore(gameState.score));
        refs.nextRank.textContent = info ? `NEXT RANK ${info.rank}: ${info.remaining}` : 'MAX RANK';
    }

    // Phase 4: 時限パワーアップの残り時間（MAGNET / DOUBLE SCORE）
    if (refs.powerupTimers) {
        const parts = [];
        const m = gameState.magnetUntil - gameState.gameTime;
        if (m > 0) parts.push(`MAGNET ${Math.ceil(m)}s`);
        const d = gameState.doubleUntil - gameState.gameTime;
        if (d > 0) parts.push(`DOUBLE x2 ${Math.ceil(d)}s`);
        refs.powerupTimers.textContent = parts.join('  ');
    }

    // Phase 5: ミッション進捗
    if (refs.missionStatus) {
        refs.missionStatus.textContent = gameState.mission
            ? `MISSION: ${formatMission(gameState.mission, gameState)}${gameState.missionDone ? ' ✓' : ''}`
            : '';
    }
}

// SOUND 状態表示（ミュート切替ボタンの文言）。
export function updateSoundButton(muted) {
    if (refs.muteBtn) refs.muteBtn.textContent = muted ? 'SOUND: OFF' : 'SOUND: ON';
}
