// ===================================
// model/powerups.js — パワーアップ効果と状態管理（Phase 4 で拡張）
//
// 責務: SHIELD / SLOW / BONUS / MAGNET / BOMB / DOUBLE SCORE / DASH CHARGE の
//   効果適用と、効果時間切れ解除。効果時間は gameTime（秒）基準で管理するため、
//   一時停止（gameTime 凍結）中は効果時間が進まない。
//
// 依存方向: config（効果時間・係数）/ model/scoring（ボーナス加算）/ model/entities（BOMB演出）。
//   DOM/Canvas/通信に触れない。状態変更は引数で渡された ctx 経由のみ。
// ===================================

import {
    POWERUP_SHIELD_DURATION_SEC,
    POWERUP_SLOW_DURATION_SEC,
    POWERUP_SLOW_FACTOR,
    POWERUP_MAGNET_DURATION,
    POWERUP_DOUBLE_DURATION
} from '../config.js';
import { addBonusScore } from './scoring.js';
import { Particle } from './entities.js';

function popup(popups, player, text) {
    popups.push({ x: player.x, y: player.y - 20, text, ttl: 1.8 });
}

// パワーアップ効果を適用する。
//   ctx = { gameState, player, popups, obstacles, particles, particlesEnabled }
export function applyPowerUp(type, ctx) {
    const { gameState, player, popups, obstacles, particles, particlesEnabled = true } = ctx;
    const now = gameState.gameTime;

    if (type === 'shield') {
        player.shield = true;
        player.shieldUntil = now + POWERUP_SHIELD_DURATION_SEC; // 8秒
        popup(popups, player, 'Shield Acquired');
    } else if (type === 'slow') {
        gameState.slowFactor = POWERUP_SLOW_FACTOR;
        gameState.slowUntil = now + POWERUP_SLOW_DURATION_SEC; // 6秒
        popup(popups, player, 'Slow Down');
    } else if (type === 'bonus') {
        // 加算スコアは bonusScore に積む（DOUBLE SCORE は scoring 側で自動適用）
        addBonusScore(gameState);
        popup(popups, player, '+50');
    } else if (type === 'magnet') {
        gameState.magnetUntil = now + POWERUP_MAGNET_DURATION;
        popup(popups, player, 'MAGNET');
    } else if (type === 'double') {
        gameState.doubleUntil = now + POWERUP_DOUBLE_DURATION;
        popup(popups, player, 'DOUBLE SCORE');
    } else if (type === 'dashcharge') {
        // ダッシュのクールタイムを即時回復
        gameState.dashReadyAt = now;
        popup(popups, player, 'DASH READY');
    } else if (type === 'bomb') {
        // 画面内の障害物（警告中レーザー等の特殊障害物も含む）を全消去し、演出を出す
        if (obstacles) {
            if (particlesEnabled && particles) {
                for (const ob of obstacles) {
                    const cx = ob.x + (ob.width || 10) / 2;
                    const cy = ob.y + (ob.height || 10) / 2;
                    particles.push(new Particle(cx, cy, 'bomb'));
                    particles.push(new Particle(cx, cy, 'bomb'));
                }
            }
            obstacles.length = 0; // in-place で全消去（参照を維持）
        }
        popup(popups, player, 'BOMB!');
    }
}

// 効果時間切れの状態を解除する（gameTime 基準）。
export function updatePowerupExpiry({ gameState, player }) {
    const now = gameState.gameTime;
    if (gameState.slowUntil && now > gameState.slowUntil) {
        gameState.slowFactor = 1;
        gameState.slowUntil = null;
    }
    if (player.shield && player.shieldUntil && now > player.shieldUntil) {
        player.shield = false;
        player.shieldUntil = null;
    }
    // magnet / double は時刻比較のみで判定するため明示解除は不要（HUD表示は残り時間で判断）。
}
