// ===================================
// controller/game-loop.js — ゲームループとライフサイクル（Stage 5）
//
// 責務: requestAnimationFrame ループ / deltaTime（MAX_DELTA_TIME クランプ）/
//       update・spawn・衝突・GAME OVER 判定 / startGame・endGame・resetAllState・
//       RAF 停止。Model を更新し、View を呼び出すオーケストレーション層。
//
// 依存方向: state / model / view / services / audio / util を import（上位 = controller）。
//   View/Model/Services は controller を import しない（一方向の依存・循環なし）。
// 厳守: RAF は常に1本 / deltaTime clamp / 二重起動防止 / エラー時 RAF 停止 / RETRY 再開。
// ===================================

import { CANVAS_WIDTH, CANVAS_HEIGHT, MAX_DELTA_TIME } from '../config.js';
import {
    gameState,
    player,
    obstacles,
    powerUps,
    energyCores,
    particles,
    popups,
    loopState,
    resetState,
    updateHighScore
} from '../state.js';
import { Obstacle, PowerUp, EnergyCore, Particle } from '../model/entities.js';
import {
    accumulateSurvivalScore,
    composeScore,
    addCoreScore,
    registerComboHit,
    updateComboTimeout,
    calculateRank,
    floorScore
} from '../model/scoring.js';
import { updateLevel, updateDifficulty, shouldSpawn } from '../model/difficulty.js';
import { applyPowerUp, updatePowerupExpiry } from '../model/powerups.js';
import { drawScene } from '../view/renderer.js';
import { updateHud } from '../view/hud.js';
import { showGameScreen, showGameOverScreen, renderGameOver } from '../view/screens.js';
import { clearPlayerName, updateSendScoreButton, setLeaderboardStatus } from '../view/leaderboard-view.js';
import { AudioManager } from '../audio/audio-manager.js';
import { handleGameError, clearError } from '../util/errors.js';
import { prepareSubmission, loadLeaderboard, resetLeaderboardSubmission } from '../services/leaderboard.js';

// main.js から注入される Canvas / 2D コンテキスト。
let canvas = null;
let ctx = null;

export function configureGameLoop(elements) {
    if (elements.canvas) canvas = elements.canvas;
    if (elements.ctx) ctx = elements.ctx;
}

// RAF を停止する（エラー復旧・多重起動防止で使用）。常に1本に保つ。
export function stopLoop() {
    gameState.isRunning = false;
    if (loopState.rafId) {
        cancelAnimationFrame(loopState.rafId);
        loopState.rafId = null;
    }
}

// すべての状態を初期化する（START / RETRY 用）。
// データ状態は state.resetState() に委譲し、横断的関心（エラー / リーダーボードUI）をここで初期化。
export function resetAllState() {
    resetState();
    // 既存のエラーはクリア（lastError リセット + オーバーレイ除去）
    clearError();
    resetLeaderboardSubmission();
    updateSendScoreButton();
    setLeaderboardStatus('');
}

// ゲーム開始（多重起動防止 → AudioContext 初期化 → 状態リセット → 画面遷移 → ループ開始）。
export function startGame() {
    // 既存のループがあれば停止してから再開（多重起動防止）
    if (loopState.rafId) {
        cancelAnimationFrame(loopState.rafId);
        loopState.rafId = null;
    }

    // ユーザー操作後に AudioContext を初期化
    AudioManager.init();

    // すべての状態を初期化
    resetAllState();

    // 効果音（スタート）
    AudioManager.play('start');

    // 画面遷移
    showGameScreen();

    // キャンバスのサイズを明示的に設定（HiDPI 対応）
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = CANVAS_WIDTH + 'px';
    canvas.style.height = CANVAS_HEIGHT + 'px';
    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    // 描画は論理ピクセル単位で行えるようにコンテキストをスケーリング
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ゲームループ開始（常に1本の RAF）
    loopState.rafId = requestAnimationFrame(loop);
}

// ゲーム終了（RAF 停止 → ハイスコア保存 → 結果表示 → 送信準備 → リーダーボード読込 → 画面遷移）。
export function endGame() {
    // ループを停止
    stopLoop();

    // キー入力状態をクリア
    player.moveLeft = false;
    player.moveRight = false;

    // ハイスコア更新（数値比較 + localStorage 保存）
    updateHighScore(gameState.score);

    // 効果音（ゲームオーバー）
    AudioManager.play('gameover');

    // ゲームオーバー画面に表示
    const finalScore = floorScore(gameState.score);
    const rank = calculateRank(finalScore);
    renderGameOver({
        score: finalScore,
        highScore: gameState.highScore,
        rank,
        maxCombo: gameState.maxCombo
    });

    // 送信対象データを確定（GAME OVER と同じ最終スコアを使用）
    prepareSubmission({
        score: finalScore,
        maxCombo: gameState.maxCombo,
        rank: rank.rank
    });
    clearPlayerName();
    updateSendScoreButton();
    setLeaderboardStatus('');
    loadLeaderboard();

    // 画面遷移
    showGameOverScreen();
}

// 安定化されたメインループ。
function loop(timestamp) {
    try {
        if (!gameState.isRunning) return;

        // deltaTime を計算（seconds）
        let delta = 0;
        if (loopState.lastTimestamp != null) {
            delta = (timestamp - loopState.lastTimestamp) / 1000;
            // 上限を設定して急激なジャンプを抑制
            if (delta > MAX_DELTA_TIME) delta = MAX_DELTA_TIME;
        }
        loopState.lastTimestamp = timestamp;

        // ゲーム時間を累積（秒）
        gameState.gameTime += delta;

        // レベルと難易度を更新
        updateLevel(gameState);
        updateDifficulty(gameState);

        // コンボタイムアウトチェック（生存スコアの累積より前に判定）
        updateComboTimeout(gameState);

        // スコアを更新（このフレームで獲得した生存点をコンボ倍率付きで差分加算 → 合成）
        accumulateSurvivalScore(gameState, delta);
        composeScore(gameState);

        // パワーアップ／シールドの期限チェック
        updatePowerupExpiry({ gameState, player });

        // レベルアップ効果音
        if (gameState.level > loopState.lastLevel) {
            AudioManager.play('levelUp');
            loopState.lastLevel = gameState.level;
        }

        // プレイヤーを更新 (delta seconds)
        player.update(delta);

        // 新しい障害物 / パワーアップ / エネルギーコアを生成
        if (shouldSpawn(gameState.spawnRate, delta)) {
            obstacles.push(new Obstacle(gameState));
        }
        if (shouldSpawn(gameState.powerupSpawnRate, delta)) {
            powerUps.push(new PowerUp(gameState));
        }
        if (shouldSpawn(gameState.energyCoreSpawnRate, delta)) {
            energyCores.push(new EnergyCore(gameState));
        }

        // 障害物を更新と衝突判定（後方ループで安全に splice）
        for (let i = obstacles.length - 1; i >= 0; i--) {
            const ob = obstacles[i];
            ob.update(delta, gameState);

            // 画面外に出た障害物を削除
            if (ob.isOutOfBounds()) {
                obstacles.splice(i, 1);
                continue;
            }

            // プレイヤーとの衝突判定
            if (ob.collidesWith(player)) {
                if (player.shield) {
                    // シールドに守られる
                    player.shield = false;
                    // 障害物を消す
                    obstacles.splice(i, 1);
                    popups.push({ x: player.x, y: player.y - 20, text: 'Shield!', ttl: 1.2 });
                    AudioManager.play('pickup');
                    continue;
                }
                endGame();
                AudioManager.play('gameover');
                return;
            }
        }

        // パワーアップ更新と衝突判定
        for (let i = powerUps.length - 1; i >= 0; i--) {
            const pu = powerUps[i];
            pu.update(delta, gameState);
            if (pu.isOutOfBounds()) {
                powerUps.splice(i, 1);
                continue;
            }
            if (pu.collidesWith(player)) {
                applyPowerUp(pu.type, { gameState, player, popups });
                powerUps.splice(i, 1);
                AudioManager.play('pickup');
            }
        }

        // エネルギーコアを更新と衝突判定
        for (let i = energyCores.length - 1; i >= 0; i--) {
            const core = energyCores[i];
            core.update(delta, gameState);
            if (core.isOutOfBounds()) {
                energyCores.splice(i, 1);
                continue;
            }
            if (core.collidesWith(player)) {
                // コア取得：加算スコア（+100）→ コンボ増加 → パーティクル生成
                // bonusScore に積むことで毎フレームの再合成でも取得点が消えない。
                addCoreScore(gameState);
                registerComboHit(gameState);
                // パーティクル生成
                for (let j = 0; j < 5; j++) {
                    particles.push(new Particle(core.x + core.width / 2, core.y + core.height / 2, 'core'));
                }
                // コンボ表示パーティクル
                particles.push(new Particle(player.x + player.width / 2, player.y - 20, 'combo'));
                energyCores.splice(i, 1);
                AudioManager.play('pickup');
            }
        }

        // パーティクル更新
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.update(delta);
            if (p.isDead()) {
                particles.splice(i, 1);
            }
        }

        // ポップアップ更新（ttl は秒）
        for (let i = popups.length - 1; i >= 0; i--) {
            const p = popups[i];
            p.y -= 20 * (delta || 0);
            p.ttl -= (delta || 0);
            if (p.ttl <= 0) popups.splice(i, 1);
        }

        // 同フレーム中に取得したコア / ボーナス加算を表示へ即時反映（合成のみ）
        composeScore(gameState);

        // 画面を描画と HUD 更新（1回だけ）
        drawScene(ctx);
        updateHud();

        // 次フレームをリクエスト（常に1本の RAF）
        loopState.rafId = requestAnimationFrame(loop);
    } catch (err) {
        // 例外が発生しても原因を可視化（console.error は使わない）。
        // onError（= stopLoop）でループを停止し、二重 RAF を防ぐ。
        handleGameError(err);
    }
}
