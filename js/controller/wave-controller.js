// ===================================
// controller/wave-controller.js — ウェーブ／ボス／イベント進行（Phase 11）
//
// 責務: ウェーブ状態機械（intro→active→outro→intermission→…→boss）の進行、ボス攻撃の
//   spawn、ランダムイベントの開始・適用・終了、Training の手動制御。すべて deltaTime 駆動で
//   進み（setInterval 不使用）、pause 中はループ停止により自動凍結する。
//   ボス本体への当たり判定（コア/ダッシュ弱点/隙間通過）の「実行」は game-loop が衝突処理の
//   流れの中で applyBossDamage を呼ぶ。ここは状態と spawn・効果適用を所有する。
//
// 依存方向: state（共有状態・配列）/ config（キャンバス幅・レーザー帯幅の幾何のみ）/
//   model(waves,bosses,random-events,balance,entities,difficulty) / audio。
//   Phase 11 の Wave/Boss/Event バランス値は balance アクセサ経由で取得（config 直接参照は幾何のみ）。
//   View・game-loop は import しない（循環なし）。描画は view/*-view が state を読む。
// ===================================

import {
    CANVAS_WIDTH,
    LASER_WIDTH
} from '../config.js';
import {
    gameState,
    waveState,
    energyCores,
    obstacles,
    particles,
    player,
    resetWaveState
} from '../state.js';
import {
    waveTypeAt,
    waveNumberAt,
    cycleDifficultyBonus,
    waveDurationSec
} from '../model/waves.js';
import {
    createBoss,
    damageBoss,
    bossTypeForCycle,
    firewallSafeCenter
} from '../model/bosses.js';
import {
    applyEvent,
    restoreEvent,
    getEventDef,
    pickRandomEvent
} from '../model/random-events.js';
import { shouldSpawn } from '../model/difficulty.js';
import {
    getEventIntervalSec,
    getEventDurationSec,
    getEventFirstDelay,
    getEventWarningDuration,
    getLaserStormRate,
    getLaserStormMax,
    getWaveSequence,
    getWaveSpawnBoost,
    getWaveIntroDuration,
    getWaveOutroDuration,
    getWaveIntermissionDuration,
    getBossSequence,
    getBossWarningDuration,
    getBossDefeatDuration,
    getFirewallMaxLasers,
    getFirewallSafeWidth,
    getWormSpeed,
    getWormMaxMinions,
    getWormHitCooldown,
    getGateMinGap,
    resetPreset
} from '../model/balance.js';
import {
    WarningLaser,
    HomingObstacle,
    GapWall,
    EnergyCore,
    BossWeakPoint,
    Particle
} from '../model/entities.js';
import { getOptions } from '../model/options.js';
import { AudioManager } from '../audio/audio-manager.js';

// 乱数ヘルパ（min..max）。min>max のときは min を返す（安全）。
function rand(min, max) {
    if (max <= min) return min;
    return min + Math.random() * (max - min);
}

// フェーズ遷移（phaseTime を 0 に戻す）。
function setPhase(phase) {
    waveState.phase = phase;
    waveState.phaseTime = 0;
}

// パーティクル生成（オプション ON のときだけ）。
function burst(cx, cy, type, color, count) {
    if (!getOptions().particlesEnabled) return;
    for (let i = 0; i < count; i++) particles.push(new Particle(cx, cy, type, color || null));
}

// ===================================
// 初期化（START / RETRY / モード変更後に game-loop が呼ぶ）
// ===================================
export function initWaveSystem() {
    resetWaveState();
    waveState.enabled = true;
    if (gameState.mode === 'training') {
        // Training: 手動制御。任意の Wave / Boss / Event を選択して確認する。
        waveState.manual = true;
        waveState.cycle = 1;
        setPhase('intermission'); // 選択待ちのアイドル
    } else {
        // 通常モードは常に既定 preset を参照（Training で選んだ preset を持ち越さない）。
        resetPreset();
        waveState.manual = false;
        waveState.cycle = 1;
        waveState.eventCooldown = getEventFirstDelay();
        beginWaveAtIndex(0);
    }
    gameState.waveSpeedBonus = cycleDifficultyBonus(waveState.cycle);
}

// 指定インデックスのウェーブを開始する（ボスウェーブなら警告フェーズへ）。
function beginWaveAtIndex(index) {
    const n = getWaveSequence().length;
    const idx = ((index % n) + n) % n;
    waveState.index = idx;
    waveState.waveType = waveTypeAt(idx);
    waveState.waveNumber = waveNumberAt(idx);
    waveState.bossActive = false;
    waveState.boss = null;
    gameState.waveReached = Math.max(gameState.waveReached || 1, waveState.waveNumber);
    if (waveState.waveType === 'boss') {
        setPhase('boss-warning');
        AudioManager.play('levelUp');
    } else {
        setPhase('intro');
    }
}

// 次サイクルへ（Endless ではボス撃破後に難易度を段階上昇させて Wave1 から再開）。
function nextCycle() {
    waveState.cycle += 1;
    gameState.waveSpeedBonus = cycleDifficultyBonus(waveState.cycle);
    beginWaveAtIndex(0);
}

// ボス戦を開始する。
function startBoss() {
    const type = bossTypeForCycle(waveState.cycle);
    waveState.boss = createBoss(type, { cycle: waveState.cycle, mode: gameState.mode });
    waveState.bossActive = true;
    gameState.bossReached = (gameState.bossReached || 0) + 1;
    setPhase('boss');
    AudioManager.play('start');
}

// ボス由来のハザード（レーザー/追尾/壁/弱点/コア）を一掃する（撃破演出・リセット用）。
function clearBossHazards() {
    for (let i = obstacles.length - 1; i >= 0; i--) {
        if (obstacles[i].bossSpawned) obstacles.splice(i, 1);
    }
    for (let i = energyCores.length - 1; i >= 0; i--) {
        if (energyCores[i].bossSpawned) energyCores.splice(i, 1);
    }
}

// ===================================
// メイン更新（game-loop が毎フレーム呼ぶ。delta 秒）
// ===================================
export function updateWaveSystem(delta) {
    if (!waveState.enabled) return { playerKilled: false };

    // サイクル難易度を毎フレーム反映（difficulty が speed へ (1+bonus) を乗算）。
    gameState.waveSpeedBonus = cycleDifficultyBonus(waveState.cycle);

    // イベントはウェーブ進行と独立に進む（同時に1つのみ）。
    updateEvents(delta);

    waveState.phaseTime += delta;

    switch (waveState.phase) {
        case 'intro':
            if (waveState.phaseTime >= getWaveIntroDuration()) setPhase('active');
            break;
        case 'active':
            spawnWaveBoost(delta);
            if (!waveState.manual && waveState.phaseTime >= waveDurationSec(gameState.mode)) setPhase('outro');
            break;
        case 'outro':
            if (waveState.phaseTime >= getWaveOutroDuration()) setPhase('intermission');
            break;
        case 'intermission':
            if (!waveState.manual && waveState.phaseTime >= getWaveIntermissionDuration()) beginWaveAtIndex(waveState.index + 1);
            break;
        case 'boss-warning':
            if (waveState.phaseTime >= getBossWarningDuration()) startBoss();
            break;
        case 'boss':
            updateBoss(delta);
            break;
        case 'boss-defeated':
            if (waveState.phaseTime >= getBossDefeatDuration()) {
                if (waveState.manual) setPhase('intermission');
                else nextCycle();
            }
            break;
        default:
            break;
    }
    // ボス本体の致死接触は無い（弱点/通常障害物経由＝game-loop が判定）。
    return { playerKilled: false };
}

// 'active' 中の主役障害物ブースト（ウェーブ種別に応じて追加 spawn）。
function spawnWaveBoost(delta) {
    if (gameState.allowedObstacles === 'none') return; // Training: 障害物なし
    const rate = getWaveSpawnBoost()[waveState.waveType] || 0;
    if (rate <= 0) return;
    if (!shouldSpawn(rate, delta)) return;
    let ob = null;
    if (waveState.waveType === 'homing') ob = new HomingObstacle(gameState);
    else if (waveState.waveType === 'laser') ob = new WarningLaser();
    else if (waveState.waveType === 'gapwall') ob = new GapWall(gameState);
    if (ob) { ob.waveSpawned = true; obstacles.push(ob); }
}

// ===================================
// ボス更新（種別ごとの攻撃）
// ===================================
function updateBoss(delta) {
    const boss = waveState.boss;
    if (!boss) return;
    if (boss.flash > 0) boss.flash = Math.max(0, boss.flash - delta);
    if (boss.type === 'firewall') updateFirewall(delta, boss);
    else if (boss.type === 'worm') updateWorm(delta, boss);
    else if (boss.type === 'gate') updateGate(delta, boss);
}

function updateFirewall(delta, boss) {
    boss.safePhase += delta * 0.7;
    boss.attackTimer -= delta;
    if (boss.attackTimer <= 0) {
        spawnFirewallLasers(boss);
        boss.attackTimer = boss.attackInterval;
    }
    boss.supplyTimer -= delta;
    if (boss.supplyTimer <= 0) {
        const core = new EnergyCore(gameState);
        core.bossSpawned = true;
        energyCores.push(core);
        boss.supplyTimer = boss.supplyInterval;
    }
}

// 警告レーザーを「安全地帯を避けて」上限まで spawn する（安全地帯は必ず残る）。
function spawnFirewallLasers(boss) {
    const existing = obstacles.filter((o) => o.type === 'laser' && o.bossSpawned).length;
    const room = Math.max(0, getFirewallMaxLasers() - existing);
    if (room <= 0) return;
    const center = firewallSafeCenter(boss);
    const safeHalf = getFirewallSafeWidth() / 2;
    const safeL = center - safeHalf;
    const safeR = center + safeHalf;
    const bands = [];
    if (safeL - LASER_WIDTH > 0) bands.push([0, safeL - LASER_WIDTH]);
    if (safeR < CANVAS_WIDTH - LASER_WIDTH) bands.push([safeR, CANVAS_WIDTH - LASER_WIDTH]);
    for (let i = 0; i < Math.min(room, bands.length); i++) {
        const [lo, hi] = bands[i];
        const laser = new WarningLaser();
        laser.x = Math.max(0, Math.min(CANVAS_WIDTH - laser.width, rand(lo, hi)));
        laser.bossSpawned = true;
        obstacles.push(laser);
    }
}

function updateWorm(delta, boss) {
    boss.x += boss.dir * getWormSpeed() * delta;
    if (boss.x <= 0) { boss.x = 0; boss.dir = 1; }
    if (boss.x + boss.width >= CANVAS_WIDTH) { boss.x = CANVAS_WIDTH - boss.width; boss.dir = -1; }
    if (boss.hitCooldown > 0) boss.hitCooldown = Math.max(0, boss.hitCooldown - delta);

    if (boss.warningActive) {
        boss.warnTimer -= delta;
        if (boss.warnTimer <= 0) {
            boss.warningActive = false;
            spawnWormAttack(boss);
            boss.attackTimer = boss.attackInterval;
        }
    } else {
        boss.attackTimer -= delta;
        if (boss.attackTimer <= 0) {
            boss.warningActive = true; // 攻撃前の警告
            boss.warnTimer = boss.warning;
        }
    }
}

// 弱点ノード（ダッシュ対象）＋ 追尾障害物（上限内）を落とす。
function spawnWormAttack(boss) {
    const wp = new BossWeakPoint(boss.x + boss.width / 2);
    wp.bossSpawned = true;
    obstacles.push(wp);
    const minions = obstacles.filter((o) => o.type === 'homing' && o.bossSpawned).length;
    if (minions < getWormMaxMinions()) {
        const h = new HomingObstacle(gameState);
        h.bossSpawned = true;
        obstacles.push(h);
    }
}

function updateGate(delta, boss) {
    boss.attackTimer -= delta;
    if (boss.attackTimer <= 0) {
        spawnGateWall();
        boss.attackTimer = boss.attackInterval;
    }
}

// 最小通過幅を保証した隙間壁を spawn（パターン＝隙間位置を切替）。物理的に通過可能を担保。
function spawnGateWall() {
    const wall = new GapWall(gameState);
    wall.gapWidth = Math.max(getGateMinGap(), wall.gapWidth);
    wall.gapX = rand(0, CANVAS_WIDTH - wall.gapWidth); // パターン切替
    wall.bossGate = true;
    wall.bossSpawned = true;
    wall.gateScored = false;
    obstacles.push(wall);
}

// ===================================
// ボスダメージ（game-loop が衝突処理の中で呼ぶ）
// ===================================
export function applyBossDamage(amount = 1) {
    const boss = waveState.boss;
    if (!boss || waveState.phase !== 'boss' || boss.defeated) return false;
    const dead = damageBoss(boss, amount);
    AudioManager.play('pickup');
    burst(player.x + player.width / 2, player.y, 'combo', '#00e5ff', 6);
    if (dead) defeatBoss();
    return dead;
}

function defeatBoss() {
    gameState.bossDefeated = (gameState.bossDefeated || 0) + 1;
    clearBossHazards();
    setPhase('boss-defeated');
    AudioManager.play('levelUp');
    burst(CANVAS_WIDTH / 2, 140, 'core', '#ffe066', 14);
}

// ===================================
// ランダムイベント
// ===================================
function updateEvents(delta) {
    if (waveState.event) {
        const ev = waveState.event;
        if (ev.warning > 0) {
            ev.warning -= delta;
            if (ev.warning <= 0) {
                ev.warning = 0;
                if (!ev.applied) { waveState.eventRestore = applyEvent(gameState, ev.id); ev.applied = true; }
            }
        } else {
            if (!ev.applied) { waveState.eventRestore = applyEvent(gameState, ev.id); ev.applied = true; }
            ev.remaining -= delta;
            if (ev.id === 'laser_storm' && waveState.phase === 'active') maybeLaserStorm(delta);
            if (ev.remaining <= 0) endEvent();
        }
    } else if (!waveState.manual) {
        waveState.eventCooldown -= delta;
        if (waveState.eventCooldown <= 0 && waveState.phase === 'active') startRandomEvent();
    }
}

function startRandomEvent() {
    const id = pickRandomEvent(waveState.lastEventId || null);
    const def = getEventDef(id);
    if (!def) { waveState.eventCooldown = getEventIntervalSec(); return; }
    waveState.lastEventId = id;
    waveState.event = {
        id,
        name: def.name,
        total: getEventDurationSec(),
        remaining: getEventDurationSec(),
        warning: def.needsWarning ? getEventWarningDuration() : 0,
        applied: false
    };
    if (!def.needsWarning) { waveState.eventRestore = applyEvent(gameState, id); waveState.event.applied = true; }
    AudioManager.play('pickup');
}

// イベント終了：効果を完全復元し、クールタイムを設定（過去スコアは scoring 設計上減らない）。
function endEvent() {
    restoreEvent(gameState, waveState.eventRestore);
    waveState.eventRestore = null;
    waveState.event = null;
    waveState.eventCooldown = getEventIntervalSec();
    AudioManager.play('pickup');
}

// LASER STORM 中の追加レーザー（中央に安全帯を残し、同時数を上限で制限）。
function maybeLaserStorm(delta) {
    if (!shouldSpawn(getLaserStormRate(), delta)) return;
    const existing = obstacles.filter((o) => o.type === 'laser' && o.eventSpawned).length;
    if (existing >= getLaserStormMax()) return;
    const safeHalf = 90;
    const center = CANVAS_WIDTH / 2;
    const leftHi = center - safeHalf - LASER_WIDTH;
    const rightLo = center + safeHalf;
    const x = Math.random() < 0.5 ? rand(0, Math.max(0, leftHi)) : rand(rightLo, CANVAS_WIDTH - LASER_WIDTH);
    const laser = new WarningLaser();
    laser.x = Math.max(0, Math.min(CANVAS_WIDTH - laser.width, x));
    laser.eventSpawned = true;
    obstacles.push(laser);
}

// ===================================
// Training の手動制御（任意 Wave / Boss / Event を確認）
// ===================================
export function trainingStartWave(type) {
    if (!waveState.manual) return;
    clearBossHazards();
    const seq = getWaveSequence();
    const idx = seq.indexOf(type);
    waveState.index = idx >= 0 ? idx : 0;
    waveState.waveType = (seq.includes(type) && type !== 'boss') ? type : 'normal';
    waveState.waveNumber = waveNumberAt(waveState.index);
    waveState.boss = null;
    waveState.bossActive = false;
    setPhase('active');
}

export function trainingStartBoss(type) {
    if (!waveState.manual) return;
    clearBossHazards();
    const t = getBossSequence().includes(type) ? type : 'firewall';
    waveState.boss = createBoss(t, { cycle: 1, mode: 'training' });
    waveState.bossActive = true;
    gameState.bossReached = (gameState.bossReached || 0) + 1;
    setPhase('boss');
    AudioManager.play('start');
}

export function trainingStartEvent(id) {
    if (!waveState.manual) return;
    if (waveState.event) endEvent();
    const def = getEventDef(id);
    if (!def) return;
    waveState.event = {
        id,
        name: def.name,
        total: getEventDurationSec(),
        remaining: getEventDurationSec(),
        warning: def.needsWarning ? getEventWarningDuration() : 0,
        applied: false
    };
    if (!def.needsWarning) { waveState.eventRestore = applyEvent(gameState, id); waveState.event.applied = true; }
    AudioManager.play('pickup');
}

// Worm の連続ダメージ防止クールタイム（game-loop が弱点ダッシュ命中時に参照）。
export function wormHitReady() {
    const boss = waveState.boss;
    if (!boss || boss.type !== 'worm') return true;
    return boss.hitCooldown <= 0;
}
export function markWormHit() {
    const boss = waveState.boss;
    if (boss && boss.type === 'worm') boss.hitCooldown = getWormHitCooldown();
}
