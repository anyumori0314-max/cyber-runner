// ===================================
// model/powerups.js — パワーアップ効果と状態管理（Stage 3）
//
// 責務: SHIELD / SLOW / BONUS の効果適用（効果時間・点数）と、効果時間切れの解除。
//       副作用は引数で渡された gameState / player / popups への状態変更のみ。
//
// 依存方向: config（効果時間・係数）と model/scoring（ボーナス加算）。DOM/Canvas/通信に触れない。
// 既存挙動・効果時間・点数は変更しない。
// ===================================

import {
    POWERUP_SHIELD_DURATION_MS,
    POWERUP_SLOW_DURATION_MS,
    POWERUP_SLOW_FACTOR
} from '../config.js';
import { addBonusScore } from './scoring.js';

// パワーアップ効果を適用する。
//   ctx = { gameState, player, popups }
export function applyPowerUp(type, { gameState, player, popups }) {
    if (type === 'shield') {
        player.shield = true;
        player.shieldUntil = Date.now() + POWERUP_SHIELD_DURATION_MS; // 8秒
        popups.push({ x: player.x, y: player.y - 20, text: 'Shield Acquired', ttl: 1.8 });
    } else if (type === 'slow') {
        gameState.slowFactor = POWERUP_SLOW_FACTOR;
        gameState.slowUntil = Date.now() + POWERUP_SLOW_DURATION_MS; // 6秒
        popups.push({ x: player.x, y: player.y - 20, text: 'Slow Down', ttl: 1.8 });
    } else if (type === 'bonus') {
        // 加算スコアは bonusScore に積む（毎フレームの再代入で消えないようにする）
        addBonusScore(gameState);
        popups.push({ x: player.x, y: player.y - 20, text: '+50', ttl: 1.8 });
    }
}

// 効果時間切れのパワーアップ状態を解除する（スロー / シールド）。
export function updatePowerupExpiry({ gameState, player }) {
    if (gameState.slowUntil && Date.now() > gameState.slowUntil) {
        gameState.slowFactor = 1;
        gameState.slowUntil = null;
    }
    if (player.shield && player.shieldUntil && Date.now() > player.shieldUntil) {
        player.shield = false;
        player.shieldUntil = null;
    }
}
