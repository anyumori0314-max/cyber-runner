// ===================================
// controller/game-loop.js — ゲームループとライフサイクル（Phase 2-5 統合）
//
// 責務: requestAnimationFrame ループ / deltaTime（MAX_DELTA_TIME クランプ）/
//       開始カウントダウン / 一時停止 / ダッシュ / update・spawn・衝突 / ニアミス /
//       マグネット / ミッション進捗・報酬 / GAME OVER 判定・実績解除・称号 /
//       startGame・endGame・resetAllState・RAF 停止。Model を更新し View を呼ぶ層。
//
// 依存方向: state / model / view / services / audio / util を import（上位 = controller）。
//   View/Model/Services は controller を import しない（一方向の依存・循環なし）。
// 厳守: RAF は常に1本 / deltaTime clamp / 二重起動防止 / エラー時 RAF 停止 / RETRY 再開。
// ===================================

import {
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    MAX_DELTA_TIME,
    COUNTDOWN_SECONDS,
    NEAR_MISS_DISTANCE,
    POPUP_TTL,
    DASH_DISTANCE,
    DASH_COOLDOWN,
    DASH_INVULN_DURATION,
    LASER_START_LEVEL,
    LASER_SPAWN_RATE,
    HOMING_START_LEVEL,
    HOMING_SPAWN_RATE,
    GAPWALL_START_LEVEL,
    GAPWALL_SPAWN_RATE,
    MAGNET_PULL_SPEED
} from '../config.js';
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
import {
    Obstacle,
    PowerUp,
    EnergyCore,
    Particle,
    WarningLaser,
    HomingObstacle,
    GapWall
} from '../model/entities.js';
import {
    accumulateSurvivalScore,
    composeScore,
    addCoreScore,
    addNearMissScore,
    addMissionReward,
    registerComboHit,
    updateComboTimeout,
    calculateRank,
    floorScore
} from '../model/scoring.js';
import { updateLevel, updateDifficulty, shouldSpawn } from '../model/difficulty.js';
import { applyPowerUp, updatePowerupExpiry } from '../model/powerups.js';
import { selectMission, getMissionProgress, isMissionComplete, formatMission } from '../model/missions.js';
import { recordRunAndUnlock } from '../model/achievements.js';
import { determineTitle } from '../model/titles.js';
import { getOptions } from '../model/options.js';
import { applyModeToState, getModePowerupWeights } from '../model/game-modes.js';
import { getActive as getActiveCosmetics } from '../model/cosmetics.js';
import { getLevel } from '../model/progression.js';
import { startRecording, sampleGhost, prepareGhostForMode, clearActiveGhost } from '../model/replay.js';
import { drawScene } from '../view/renderer.js';
import { setShareData } from '../view/share-view.js';
import { updateHud } from '../view/hud.js';
import {
    showGameScreen,
    showGameOverScreen,
    showTitleScreen,
    renderGameOver,
    showPauseScreen,
    hidePauseScreen,
    hideAllOverlays
} from '../view/screens.js';
import { showToast, renderAchievements } from '../view/achievements-view.js';
import { setTrainingPanelVisible } from '../view/mode-select-view.js';
import { clearPlayerName, updateSendScoreButton, setLeaderboardStatus, setScoreSubmitVisible } from '../view/leaderboard-view.js';
import { clearKeys } from './input.js';
import { AudioManager } from '../audio/audio-manager.js';
import { handleGameError, clearError } from '../util/errors.js';
import { prepareSubmission, loadLeaderboard, resetLeaderboardSubmission } from '../services/leaderboard.js';
import { startRun, getCurrentRunSync } from '../services/run-service.js';

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

// 今回プレイのミッションを新規割り当てする（タイトルプレビュー / RETRY 用）。
// resetState はミッション定義を消さないため、controller がここで明示的に割り当てる。
export function prepareMission() {
    gameState.mission = selectMission();
    gameState.missionProgress = 0;
    gameState.missionDone = false;
    return gameState.mission;
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

// ゲーム開始（多重起動防止 → AudioContext 初期化 → 状態リセット → 画面遷移 → カウントダウン → ループ開始）。
export function startGame() {
    // 残っているオーバーレイ（ポーズ等）を閉じる
    hideAllOverlays();

    // 既存のループがあれば停止してから再開（多重起動防止）
    if (loopState.rafId) {
        cancelAnimationFrame(loopState.rafId);
        loopState.rafId = null;
    }

    // ユーザー操作後に AudioContext を初期化
    AudioManager.init();

    // すべての状態を初期化
    resetAllState();

    // Phase 7: 選択中モード（+ Training 設定）を反映（resetAllState の既定値を上書き）。
    applyModeToState(gameState);

    // ミッションが未割り当てなら新規に選ぶ（タイトルプレビューがあればそれを引き継ぐ）
    if (!gameState.mission) prepareMission();

    // Phase 6: サーバー権威 run を開始（未配備時はローカルフォールバックで継続）。
    startRun(gameState.mode);

    // Phase 10: ゴースト記録を開始し、当該モードのベストゴーストを表示用に読み込む。
    startRecording(gameState.mode);
    prepareGhostForMode(gameState.mode); // async・失敗してもゲームは継続

    // 効果音（スタート）
    AudioManager.play('start');

    // 画面遷移
    showGameScreen();
    // Phase 7: Training のときだけパワーアップ確認パネルを表示。
    setTrainingPanelVisible(gameState.mode === 'training');

    // キャンバスのサイズを明示的に設定（HiDPI 対応）
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = CANVAS_WIDTH + 'px';
    canvas.style.height = CANVAS_HEIGHT + 'px';
    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    // 描画は論理ピクセル単位で行えるようにコンテキストをスケーリング
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 開始カウントダウン（この間は gameTime を進めず、操作・spawn も止める）
    gameState.phase = 'countdown';
    gameState.countdown = COUNTDOWN_SECONDS;
    gameState.isPaused = false;

    // ゲームループ開始（常に1本の RAF）
    loopState.rafId = requestAnimationFrame(loop);
}

// 一時停止（RAF 停止で gameTime と全演出を凍結する）。
export function pauseGame() {
    if (!gameState.isRunning || gameState.isPaused) return;
    gameState.isPaused = true;
    if (loopState.rafId) {
        cancelAnimationFrame(loopState.rafId);
        loopState.rafId = null;
    }
    clearKeys(); // 押しっぱなしキーの暴走を防ぐ
    showPauseScreen();
}

// 一時停止からの再開（delta をクリーンに再開してジャンプを防ぐ）。
export function resumeGame() {
    if (!gameState.isRunning || !gameState.isPaused) return;
    gameState.isPaused = false;
    hidePauseScreen();
    loopState.lastTimestamp = null; // 凍結期間ぶんの delta を破棄
    loopState.rafId = requestAnimationFrame(loop);
}

// ESC トグル（入力からのコールバック）。
export function togglePause() {
    if (!gameState.isRunning) return;
    if (gameState.isPaused) resumeGame();
    else pauseGame();
}

// タイトルへ戻る（ポーズ中の BACK TO TITLE）。
export function backToTitle() {
    stopLoop();
    gameState.isPaused = false;
    hideAllOverlays();
    setTrainingPanelVisible(false);
    clearKeys();
    showTitleScreen();
}

// ダッシュ（SPACE）。クールタイム外なら直近の向きへ瞬間移動し、短い無敵を付与。
export function doDash() {
    if (!gameState.isRunning || gameState.isPaused) return;
    if (gameState.phase !== 'playing') return; // カウントダウン中は不可
    const now = gameState.gameTime;
    if (now < gameState.dashReadyAt) return; // クールタイム中

    const dir = gameState.lastMoveDirection || 1;
    player.x = Math.max(0, Math.min(CANVAS_WIDTH - player.width, player.x + dir * DASH_DISTANCE));
    gameState.dashReadyAt = now + DASH_COOLDOWN;
    gameState.dashInvulnUntil = now + DASH_INVULN_DURATION;
    gameState.dashCount++;
    AudioManager.play('pickup');

    if (getOptions().particlesEnabled) {
        for (let i = 0; i < 4; i++) {
            particles.push(new Particle(player.x + player.width / 2, player.y + player.height / 2, 'dash'));
        }
    }
}

// パワーアップ種別を重み付き抽選で決める（Phase 7: モード別の重み）。
function pickWeightedPowerUpType() {
    const entries = Object.entries(getModePowerupWeights(gameState.mode));
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = Math.random() * total;
    for (const [type, w] of entries) {
        if ((r -= w) < 0) return type;
    }
    return entries[0][0];
}

// Phase 7: Training のパワーアップ確認（指定種別を1つ降らせる。Training・実行中のみ）。
export function spawnTrainingPowerup(type) {
    if (gameState.mode !== 'training' || !gameState.isRunning) return;
    powerUps.push(new PowerUp(gameState, type));
}

// 画面揺れを発生させる（残り時間が長くなる方向にのみ更新）。
function triggerShake(mag, time) {
    if (time > gameState.shakeTime) gameState.shakeTime = time;
    gameState.shakeMag = Math.max(gameState.shakeMag, mag);
}

// ニアミス判定（対象障害物が当たらずに横をすり抜けたら1回だけ加点）。
function checkNearMiss(ob) {
    if (!ob.nearMissEligible || ob.nearMissed) return;
    const vOverlap = ob.y + ob.height > player.y && ob.y < player.y + player.height;
    if (!vOverlap) return;
    let gap = Infinity;
    if (ob.x >= player.x + player.width) gap = ob.x - (player.x + player.width); // 右側を通過
    else if (ob.x + ob.width <= player.x) gap = player.x - (ob.x + ob.width); // 左側を通過
    else return; // 水平方向に重なっている = ニアミスではなく衝突域
    if (gap >= 0 && gap <= NEAR_MISS_DISTANCE) {
        ob.nearMissed = true;
        gameState.nearMissCount++;
        addNearMissScore(gameState);
        popups.push({ x: player.x, y: player.y - 30, text: 'NEAR MISS +25', ttl: POPUP_TTL });
    }
}

// ゲーム終了（RAF 停止 → ハイスコア保存 → 結果表示 → 実績/称号 → 送信準備 → リーダーボード読込 → 画面遷移）。
export function endGame(opts = {}) {
    const finished = opts.finished === true; // タイムアタックの FINISH（時間切れ）
    const isTraining = gameState.mode === 'training';

    // ループを停止
    stopLoop();
    gameState.isPaused = false;
    hideAllOverlays();
    setTrainingPanelVisible(false); // Training パネルを閉じる
    clearActiveGhost(); // 表示用ゴーストを解除

    // キー入力状態をクリア
    player.moveLeft = false;
    player.moveRight = false;

    // ハイスコア更新（Training は累計/記録へ影響させない）
    if (!isTraining) updateHighScore(gameState.score);

    // 効果音（ゲームオーバー）
    AudioManager.play('gameover');

    // 最終スコアとランクを確定
    const finalScore = floorScore(gameState.score);
    const rank = calculateRank(finalScore);

    // Phase 5: 称号判定（今回プレイの統計から1つ）
    const run = {
        maxCombo: gameState.maxCombo,
        coreCount: gameState.coreCount,
        nearMissCount: gameState.nearMissCount,
        dashCount: gameState.dashCount,
        survivalTime: gameState.gameTime
    };
    const title = determineTitle(run);

    // Phase 10: 結果カード用データを共有ビューへ渡す（全モード共通・個人情報は含めない）。
    setShareData({
        score: finalScore,
        rank: rank.rank,
        maxCombo: gameState.maxCombo,
        mode: gameState.mode,
        title,
        level: getLevel()
    });

    // Phase 5/7: 累計統計の更新と実績解除（Training では行わない＝累計に影響させない）。
    const newly = isTraining ? [] : recordRunAndUnlock({
        cores: gameState.coreCount,
        nearMiss: gameState.nearMissCount,
        maxCombo: gameState.maxCombo,
        survivalTime: gameState.gameTime,
        rank: rank.rank,
        dashCount: gameState.dashCount
    });
    renderAchievements(); // 一覧を最新化（次に開いたとき反映）

    // Phase 5: ミッション結果テキスト
    const missionResult = gameState.mission
        ? (gameState.missionDone
            ? `ミッション達成: ${gameState.mission.label} (+500)`
            : `ミッション未達成: ${formatMission(gameState.mission, gameState)}`)
        : '';

    // ゲームオーバー画面に表示（FINISH/GAME OVER の見出しは finished で切替）
    renderGameOver({
        score: finalScore,
        highScore: gameState.highScore,
        rank,
        maxCombo: gameState.maxCombo,
        title,
        missionResult,
        finished,
        mode: gameState.mode
    });

    // 新規解除した実績をトースト通知
    for (const def of newly) {
        showToast('ACHIEVEMENT UNLOCKED', def.name);
    }

    // Phase 8/9/10: 成長（XP）/チャレンジ進捗/ゴースト保存の反映（Training では行わない）。
    if (!isTraining) {
        onRunComplete({
            mode: gameState.mode,
            score: finalScore,
            rank: rank.rank,
            title,
            survivalTime: gameState.gameTime,
            coreCount: gameState.coreCount,
            nearMissCount: gameState.nearMissCount,
            maxCombo: gameState.maxCombo,
            dashCount: gameState.dashCount,
            shieldUsed: gameState.shieldUsed === true,
            reachedLevel: gameState.level,
            missionCompleted: gameState.missionDone === true,
            newlyAchievements: newly.length,
            finished
        });
    }

    // Phase 6: 送信対象データを確定（mode/duration/metrics/runId を含む）。
    if (!isTraining) {
        const durationMs = Math.max(0, Date.now() - (gameState.runStartedAtMs || Date.now()));
        const run = getCurrentRunSync();
        prepareSubmission({
            score: finalScore,
            maxCombo: gameState.maxCombo,
            rank: rank.rank,
            mode: gameState.mode,
            durationMs,
            runId: run && run.run_id ? run.run_id : null,
            metrics: {
                core_count: gameState.coreCount,
                near_miss_count: gameState.nearMissCount,
                dash_count: gameState.dashCount,
                mission_completed: gameState.missionDone === true,
                reached_level: gameState.level
            }
        });
        clearPlayerName();
        updateSendScoreButton();
        setLeaderboardStatus('');
        loadLeaderboard();
    } else {
        // Training: ランキング対象外（送信 UI は view が抑止）。
        prepareSubmission({ score: finalScore, maxCombo: gameState.maxCombo, rank: rank.rank, mode: 'training' });
        updateSendScoreButton();
    }
    // Training は送信セクション自体を隠す（送信ボタンを表示しない）。
    setScoreSubmitVisible(!isTraining);

    // 画面遷移
    showGameOverScreen();
}

// Phase 8/9 のフック（main.js から注入）。XP/チャレンジ/ゴースト保存を controller から呼ぶ。
let runCompleteHandler = () => {};
export function configureRunCompletion(fn) {
    if (typeof fn === 'function') runCompleteHandler = fn;
}
function onRunComplete(summary) {
    try {
        runCompleteHandler(summary);
    } catch (err) {
        // 成長/チャレンジ処理の失敗でゲーム終了処理を止めない。
        console.warn('run completion handler failed:', err);
    }
}

// 開始カウントダウンの進行（gameTime は進めない）。GO! 表示後に playing へ移行。
function tickCountdown(delta) {
    gameState.countdown -= delta;
    if (gameState.countdown <= -0.6) {
        gameState.phase = 'playing';
        gameState.countdown = 0;
    }
    drawScene(ctx);
    updateHud();
    loopState.rafId = requestAnimationFrame(loop);
}

// 安定化されたメインループ。
function loop(timestamp) {
    try {
        if (!gameState.isRunning || gameState.isPaused) return;

        // deltaTime を計算（seconds）
        let delta = 0;
        if (loopState.lastTimestamp != null) {
            delta = (timestamp - loopState.lastTimestamp) / 1000;
            // 上限を設定して急激なジャンプを抑制
            if (delta > MAX_DELTA_TIME) delta = MAX_DELTA_TIME;
        }
        loopState.lastTimestamp = timestamp;

        // 開始カウントダウン中はゲームを進めず、カウントのみ進める
        if (gameState.phase === 'countdown') {
            tickCountdown(delta);
            return;
        }

        // ゲーム時間を累積（秒）
        gameState.gameTime += delta;

        // Phase 7: タイムアタックの時間切れ → FINISH（GAME OVER ではなく完走扱い）
        if (gameState.timeLimitSec > 0 && gameState.gameTime >= gameState.timeLimitSec) {
            gameState.gameTime = gameState.timeLimitSec;
            endGame({ finished: true });
            return;
        }

        // 画面揺れの減衰
        if (gameState.shakeTime > 0) {
            gameState.shakeTime = Math.max(0, gameState.shakeTime - delta);
            if (gameState.shakeTime === 0) gameState.shakeMag = 0;
        }

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

        // Phase 10: ゴースト記録（固定間隔に間引き。Training は記録しない）。
        sampleGhost(gameState, player);

        // 新しい障害物 / パワーアップ / エネルギーコアを生成
        // Phase 7: Training の障害物種別（all=通常 / basic=基本のみ / none=出さない）。
        const obstaclesOn = gameState.allowedObstacles !== 'none';
        const specialsOn = gameState.allowedObstacles === 'all';
        if (obstaclesOn && shouldSpawn(gameState.spawnRate, delta)) {
            obstacles.push(new Obstacle(gameState));
        }
        // Phase 4: レベル別の新障害物（それぞれ専用の出現率。Training basic/none では出さない）
        if (specialsOn && gameState.level >= LASER_START_LEVEL && shouldSpawn(LASER_SPAWN_RATE, delta)) {
            obstacles.push(new WarningLaser());
        }
        if (specialsOn && gameState.level >= HOMING_START_LEVEL && shouldSpawn(HOMING_SPAWN_RATE, delta)) {
            obstacles.push(new HomingObstacle(gameState));
        }
        if (specialsOn && gameState.level >= GAPWALL_START_LEVEL && shouldSpawn(GAPWALL_SPAWN_RATE, delta)) {
            obstacles.push(new GapWall(gameState));
        }
        if (shouldSpawn(gameState.powerupSpawnRate, delta)) {
            powerUps.push(new PowerUp(gameState, pickWeightedPowerUpType()));
        }
        if (shouldSpawn(gameState.energyCoreSpawnRate, delta)) {
            energyCores.push(new EnergyCore(gameState));
        }

        // Phase 7: Training の無敵はダッシュ無敵と同様に衝突をすり抜ける。
        const dashInvuln = gameState.gameTime < gameState.dashInvulnUntil || gameState.invincible === true;

        // 障害物を更新と衝突判定（後方ループで安全に splice）
        for (let i = obstacles.length - 1; i >= 0; i--) {
            const ob = obstacles[i];
            // HomingObstacle は player を参照（他種は余分な引数を無視）
            ob.update(delta, gameState, player);

            // 画面外に出た障害物を削除
            if (ob.isOutOfBounds()) {
                obstacles.splice(i, 1);
                continue;
            }

            // ニアミス判定（衝突しなかった対象障害物）
            checkNearMiss(ob);

            // プレイヤーとの衝突判定
            if (ob.collidesWith(player)) {
                if (dashInvuln) {
                    // ダッシュ無敵中はすり抜ける（障害物は残す）
                    continue;
                }
                if (player.shield) {
                    // シールドに守られる（1回消費）
                    player.shield = false;
                    player.shieldUntil = null;
                    gameState.shieldUsed = true; // noshield ミッション判定用
                    obstacles.splice(i, 1);
                    popups.push({ x: player.x, y: player.y - 20, text: 'Shield!', ttl: 1.2 });
                    triggerShake(8, 0.25);
                    AudioManager.play('pickup');
                    continue;
                }
                triggerShake(14, 0.4);
                endGame();
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
                applyPowerUp(pu.type, {
                    gameState,
                    player,
                    popups,
                    obstacles,
                    particles,
                    particlesEnabled: getOptions().particlesEnabled
                });
                powerUps.splice(i, 1);
                AudioManager.play('pickup');
            }
        }

        // エネルギーコアを更新と衝突判定
        const magnetActive = gameState.magnetUntil > gameState.gameTime;
        for (let i = energyCores.length - 1; i >= 0; i--) {
            const core = energyCores[i];
            // Phase 4: マグネット有効中はプレイヤーへ引き寄せる
            if (magnetActive) {
                const px = player.x + player.width / 2;
                const py = player.y + player.height / 2;
                const cx = core.x + core.width / 2;
                const cy = core.y + core.height / 2;
                const dx = px - cx;
                const dy = py - cy;
                const dist = Math.hypot(dx, dy) || 1;
                const step = Math.min(MAGNET_PULL_SPEED * delta, dist);
                core.x += (dx / dist) * step;
                core.y += (dy / dist) * step;
            }
            core.update(delta, gameState);
            if (core.isOutOfBounds()) {
                energyCores.splice(i, 1);
                continue;
            }
            if (core.collidesWith(player)) {
                // コア取得：加算スコア（+100）→ コンボ増加 → 統計更新 → パーティクル生成
                addCoreScore(gameState);
                registerComboHit(gameState);
                gameState.coreCount++; // ミッション/実績/称号用
                if (getOptions().particlesEnabled) {
                    // Phase 8: コア取得エフェクト（外観のみ。色/数だけ変える）。
                    const fx = getActiveCosmetics();
                    const count = fx.coreEffect === 'burst' ? 8 : fx.coreEffect === 'ring' ? 10 : 5;
                    const colorOverride = fx.coreEffect === 'ring' ? fx.color : null;
                    const ccx = core.x + core.width / 2;
                    const ccy = core.y + core.height / 2;
                    for (let j = 0; j < count; j++) {
                        particles.push(new Particle(ccx, ccy, 'core', colorOverride));
                    }
                    particles.push(new Particle(player.x + player.width / 2, player.y - 20, 'combo'));
                }
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

        // Phase 5: ミッション進捗と達成報酬（1プレイ1回）
        if (gameState.mission) {
            gameState.missionProgress = getMissionProgress(gameState.mission, gameState);
            if (!gameState.missionDone && isMissionComplete(gameState.mission, gameState)) {
                gameState.missionDone = true;
                addMissionReward(gameState);
                composeScore(gameState);
                popups.push({ x: player.x, y: player.y - 40, text: 'MISSION COMPLETE +500', ttl: 1.6 });
                showToast('MISSION COMPLETE', gameState.mission.label);
                AudioManager.play('levelUp');
            }
        }

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
