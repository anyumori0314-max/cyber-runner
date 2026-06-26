// ===================================
// model/scoring.js — スコア / コンボ / ランク計算（Stage 3）
//
// 責務: 生存スコアの差分加算・ボーナス加算・最終スコア合成・コンボ倍率・
//       ランク判定・表示用丸め。副作用なし（DOM/Canvas/通信に触れない）。
//
// 依存方向: config のみ。gameState は引数で受け取る純粋関数群（単体検証可能）。
//
// 修正済み仕様（必ず維持）:
//   survivalScore += delta * 10 * multiplier;   // 差分加算（再計算しない）
//   score = survivalScore + bonusScore;         // 合成のみ（倍率は再適用しない）
//   → コンボ倍率が 3倍→1倍 に戻ってもスコアは減少しない。
//   コア取得 +100 / ボーナス +50 は bonusScore に積み、倍率を掛けない。
// ===================================

import {
    COMBO_MULTIPLIERS,
    RANK_THRESHOLDS,
    ENERGY_CORE_SCORE,
    BONUS_SCORE,
    COMBO_TIMEOUT
} from '../config.js';

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

// このフレームで獲得した生存点をコンボ倍率付きで「差分加算」する。
// 倍率はその倍率が有効だった時間中の獲得点だけに適用されるため、
// 倍率が下がっても過去分は再計算されず、表示スコアは減少しない。
export function accumulateSurvivalScore(gameState, delta) {
    const multiplier = getComboMultiplier(gameState.combo);
    gameState.survivalScore += delta * 10 * multiplier;
}

// 最終表示スコアを合成する（survivalScore + bonusScore）。倍率の再適用はしない。
export function composeScore(gameState) {
    gameState.score = gameState.survivalScore + gameState.bonusScore;
    return gameState.score;
}

// コア取得スコア（+100）を加算スコアへ積む（毎フレーム上書きしないので消えない）。
export function addCoreScore(gameState) {
    gameState.bonusScore += ENERGY_CORE_SCORE;
}

// ボーナスパワーアップ（+50）を加算スコアへ積む。
export function addBonusScore(gameState) {
    gameState.bonusScore += BONUS_SCORE;
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
// 生存スコアの累積より前に判定し、タイムアウト後のフレームは等倍で加算する。
export function updateComboTimeout(gameState) {
    if (gameState.combo > 0 && gameState.gameTime - gameState.comboLastTime > COMBO_TIMEOUT) {
        gameState.combo = 0;
    }
}

// 表示用の丸め（整数化）。
export function floorScore(value) {
    return Math.floor(value);
}
