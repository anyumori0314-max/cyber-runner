// ===================================
// model/scoring.js — スコア / コンボ / ランク計算（Phase 3-4 で拡張）
//
// 責務: 生存スコアの差分加算・ボーナス/コア/ニアミス/ミッション加算・最終スコア合成・
//   コンボ倍率・ランク判定・表示用丸め。副作用なし（gameState を引数で受け取る純粋関数）。
//
// 修正済み仕様（維持）:
//   survivalScore += delta * 10 * combo倍率 * doubleScore倍率;  // 差分加算（再計算しない）
//   score = survivalScore + bonusScore;                          // 合成のみ
//   → コンボ倍率が下がってもスコアは減少しない。
//   DOUBLE SCORE は「効果中に新しく獲得する点」のみ2倍（既獲得スコアは変更しない）。
//   適用対象: 生存スコア / コア+100 / ボーナス+50 / ニアミス+25 / ミッション報酬+500。
//   コンボ倍率は生存スコアのみ。コア/ボーナス等の加算スコアには掛けない。
// ===================================

import {
    COMBO_MULTIPLIERS,
    RANK_THRESHOLDS,
    ENERGY_CORE_SCORE,
    BONUS_SCORE,
    NEAR_MISS_SCORE,
    MISSION_REWARD,
    COMBO_TIMEOUT,
    DOUBLE_SCORE_MULTIPLIER
} from '../config.js';

// DOUBLE SCORE が有効なら倍率（既定2）、無効なら1。新規獲得時に都度参照する。
export function scoreMultiplier(gameState) {
    return gameState.doubleUntil && gameState.gameTime < gameState.doubleUntil ? DOUBLE_SCORE_MULTIPLIER : 1;
}

// Phase 7: モードのスコア倍率（Hardcore 等）。未設定（Endless / Phase 1-5）は 1。
// DOUBLE SCORE と同じく「新規獲得時のみ」乗算するため、既獲得スコアは変化しない。
export function modeMultiplier(gameState) {
    const m = gameState.modeScoreMultiplier;
    return typeof m === 'number' && m > 0 ? m : 1;
}

// コンボ数から倍率を取得
export function getComboMultiplier(combo) {
    if (combo >= 20) return COMBO_MULTIPLIERS[20];
    if (combo >= 10) return COMBO_MULTIPLIERS[10];
    if (combo >= 5) return COMBO_MULTIPLIERS[5];
    return COMBO_MULTIPLIERS[0];
}

// スコアからランクを計算
export function calculateRank(score) {
    for (let i = 0; i < RANK_THRESHOLDS.length; i++) {
        if (score >= RANK_THRESHOLDS[i].score) {
            return RANK_THRESHOLDS[i];
        }
    }
    return RANK_THRESHOLDS[RANK_THRESHOLDS.length - 1];
}

// 次ランクまでの目安を返す（Phase 3-5 表示用）。最高ランク到達時は null。
export function getNextRankInfo(score) {
    // RANK_THRESHOLDS は降順（S→D）。score より上の最小の閾値を探す。
    let next = null;
    for (let i = RANK_THRESHOLDS.length - 1; i >= 0; i--) {
        if (RANK_THRESHOLDS[i].score > score) {
            next = RANK_THRESHOLDS[i];
            break;
        }
    }
    if (!next) return null; // 最高ランク
    return { rank: next.rank, remaining: Math.max(0, Math.ceil(next.score - score)) };
}

// このフレームの生存点をコンボ倍率＋DOUBLE SCORE倍率で差分加算する（再計算しない）。
export function accumulateSurvivalScore(gameState, delta) {
    const multiplier = getComboMultiplier(gameState.combo);
    gameState.survivalScore += delta * 10 * multiplier * scoreMultiplier(gameState) * modeMultiplier(gameState);
}

// 最終表示スコアを合成する（survivalScore + bonusScore）。倍率の再適用はしない。
export function composeScore(gameState) {
    gameState.score = gameState.survivalScore + gameState.bonusScore;
    return gameState.score;
}

// コア取得スコア（+100、DOUBLE時×2、モード倍率）を加算スコアへ積む。
export function addCoreScore(gameState) {
    gameState.bonusScore += ENERGY_CORE_SCORE * scoreMultiplier(gameState) * modeMultiplier(gameState);
}

// ボーナスパワーアップ（+50、DOUBLE時×2、モード倍率）を加算スコアへ積む。
export function addBonusScore(gameState) {
    gameState.bonusScore += BONUS_SCORE * scoreMultiplier(gameState) * modeMultiplier(gameState);
}

// ニアミス加点（+25、DOUBLE時×2、モード倍率）。
export function addNearMissScore(gameState) {
    gameState.bonusScore += NEAR_MISS_SCORE * scoreMultiplier(gameState) * modeMultiplier(gameState);
}

// ミッション報酬（+500、DOUBLE時×2、モード倍率）。
export function addMissionReward(gameState) {
    gameState.bonusScore += MISSION_REWARD * scoreMultiplier(gameState) * modeMultiplier(gameState);
}

// コア取得時のコンボ処理（コンボ増加 / 最大コンボ更新 / 取得時刻記録）。
export function registerComboHit(gameState) {
    gameState.combo++;
    if (gameState.combo > gameState.maxCombo) {
        gameState.maxCombo = gameState.combo;
    }
    gameState.comboLastTime = gameState.gameTime;
}

// コンボタイムアウト判定（COMBO_TIMEOUT 秒以上コアを取得していなければ 0 に戻す）。
export function updateComboTimeout(gameState) {
    if (gameState.combo > 0 && gameState.gameTime - gameState.comboLastTime > COMBO_TIMEOUT) {
        gameState.combo = 0;
    }
}

// 表示用の丸め（整数化）。
export function floorScore(value) {
    return Math.floor(value);
}
