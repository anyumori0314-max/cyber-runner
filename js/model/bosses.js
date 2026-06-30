// ===================================
// model/bosses.js — ボス定義と純粋ロジック（Phase 11）
//
// 責務: 3ボス（Firewall Core / Data Worm / Security Gate）の定義、ボス状態オブジェクトの
//   生成、HP スケール（サイクル）、ダメージ適用・撃破判定、攻撃間隔（Hardcore 補正）。
//   ボスは「状態を持つプレーンオブジェクト」。DOM/Canvas に触れない（描画は view/boss-view）。
//
// 依存方向: config（描画/当たり判定の寸法・キャンバス幅のみ）/ balance（HP・各ボス攻撃間隔・
//   供給/警告間隔・安全幅・サイクル係数・Hardcore 補正＝選択中 preset）。
//   Phase 11 のボスのバランス値は active balance preset が唯一の正本（config 直接参照は寸法のみ）。
//   当たり判定・攻撃の spawn は controller/wave-controller が行う。
// ===================================

import {
    BOSS_WORM_WIDTH,
    BOSS_WORM_HEIGHT,
    CANVAS_WIDTH
} from '../config.js';
import {
    getBossSequence,
    getBossBaseHp,
    getCycleBossHpStep,
    getFirewallAttackIntervalBase,
    getFirewallCoreAttackInterval,
    getFirewallSafeWidth,
    getWormAttackIntervalBase,
    getWormAttackWarningDuration,
    getGateAttackIntervalBase,
    getHardcoreBossIntervalFactor
} from './balance.js';

// ボス定義（名称・説明）。基礎 HP・全ボスの攻撃間隔・供給/警告間隔は active balance preset から
//   取得する（createBoss 内で解決）。BOSS_DEFS は固定のメタ情報（型/名称/ヒント）のみを持つ。
export const BOSS_DEFS = {
    firewall: {
        type: 'firewall',
        name: 'FIREWALL CORE',
        hint: '安全地帯へ退避しコアを取得して撃破'
    },
    worm: {
        type: 'worm',
        name: 'DATA WORM',
        hint: 'ダッシュで本体に接触してダメージ'
    },
    gate: {
        type: 'gate',
        name: 'SECURITY GATE',
        hint: '正しい隙間を通過してダメージ'
    }
};

// ボス種別ごとの攻撃間隔 基準値（active balance preset 由来＝単一参照点）。
function baseAttackIntervalFor(type) {
    if (type === 'worm') return getWormAttackIntervalBase();
    if (type === 'gate') return getGateAttackIntervalBase();
    return getFirewallAttackIntervalBase();
}

// サイクルに応じてボス種別を巡回（cycle1=firewall, cycle2=worm, ...）。
export function bossTypeForCycle(cycle) {
    const seq = getBossSequence();
    const c = Number.isFinite(cycle) && cycle >= 1 ? cycle : 1;
    return seq[(c - 1) % seq.length];
}

// サイクルで HP をスケール（整数化・最低1）。
export function scaledBossHp(baseHp, cycle) {
    const c = Number.isFinite(cycle) && cycle >= 1 ? cycle : 1;
    return Math.max(1, Math.round(baseHp * (1 + (c - 1) * getCycleBossHpStep())));
}

// 攻撃間隔（Hardcore は短縮。回避不能化はしない＝警告時間は別途確保）。
export function bossAttackInterval(baseInterval, mode) {
    return mode === 'hardcore' ? baseInterval * getHardcoreBossIntervalFactor() : baseInterval;
}

// ボス状態オブジェクトを生成する（boss フェーズ開始時に controller が呼ぶ）。
export function createBoss(type, { cycle = 1, mode = 'endless' } = {}) {
    const def = BOSS_DEFS[type] || BOSS_DEFS.firewall;
    // 基礎 HP・各ボスの攻撃間隔は選択中 balance preset を参照（単一正本）。
    const baseHp = getBossBaseHp(def.type);
    const baseAttackInterval = baseAttackIntervalFor(def.type);
    const maxHp = scaledBossHp(baseHp, cycle);
    const boss = {
        type: def.type,
        name: def.name,
        hint: def.hint,
        maxHp,
        hp: maxHp,
        defeated: false,
        flash: 0, // 被ダメージ点滅（描画用・秒）
        attackTimer: 0, // 攻撃クールタイム
        supplyTimer: 0, // 供給（コア等）タイマー
        warnTimer: 0, // 攻撃前警告の残り
        warningActive: false,
        attackInterval: bossAttackInterval(baseAttackInterval, mode),
        // Firewall: 移動する安全地帯の中心位相
        safePhase: 0,
        // Worm: 本体の位置と移動方向
        x: CANVAS_WIDTH / 2 - BOSS_WORM_WIDTH / 2,
        y: 54,
        width: BOSS_WORM_WIDTH,
        height: BOSS_WORM_HEIGHT,
        dir: 1,
        hitCooldown: 0 // Worm: 連続ダメージ防止
    };
    // 供給/警告間隔も active balance preset を参照（BOSS_DEFS には持たせない）。
    if (type === 'firewall') boss.supplyInterval = getFirewallCoreAttackInterval();
    if (type === 'worm') boss.warning = getWormAttackWarningDuration();
    return boss;
}

// ボスへダメージを与える（撃破時 defeated=true・点滅をセット）。戻り値 = 撃破したか。
export function damageBoss(boss, amount = 1) {
    if (!boss || boss.defeated) return false;
    boss.hp = Math.max(0, boss.hp - Math.max(1, Math.floor(amount)));
    boss.flash = 0.25;
    if (boss.hp <= 0) {
        boss.defeated = true;
        return true;
    }
    return false;
}

// HP 割合（0..1）。HP バー描画用。
export function bossHpRatio(boss) {
    if (!boss || boss.maxHp <= 0) return 0;
    return Math.max(0, Math.min(1, boss.hp / boss.maxHp));
}

// Firewall Core の移動する安全地帯の中心 X（純粋な幾何。描画と spawn で共有）。
export function firewallSafeCenter(boss) {
    const half = getFirewallSafeWidth() / 2;
    const range = CANVAS_WIDTH / 2 - half - 24;
    const phase = boss && Number.isFinite(boss.safePhase) ? boss.safePhase : 0;
    return CANVAS_WIDTH / 2 + Math.sin(phase) * Math.max(0, range);
}
