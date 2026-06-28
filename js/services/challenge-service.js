// ===================================
// services/challenge-service.js — チャレンジの時刻権威の取得（Phase 6/9）
//
// 責務: challenges Edge Function から UTC 日付・ISO 週・seed を取得する。
//   未配備/失敗時はローカル UTC でフォールバックし、source を 'local' にして
//   「フォールバック使用中」を内部状態で判別可能にする。
//
// 重要: PC 時刻変更による完全な不正防止はサーバー seed 使用時（source==='server'）のみ。
//   ローカルフォールバックはあくまで遊べることを優先した近似。
//
// 依存方向: config（エンドポイント）。DOM に触れない。
// ===================================

import { EDGE_FUNCTIONS_BASE, SUPABASE_ANON_KEY } from '../config.js';

let endpointBase = EDGE_FUNCTIONS_BASE;

export function configureChallengeService(opts = {}) {
    if (typeof opts.endpointBase === 'string') endpointBase = opts.endpointBase;
}

// 文字列 → 決定的 32bit seed（FNV-1a 風。Edge Function と同一アルゴリズム）。
export function hashSeed(input) {
    let h = 2166136261;
    const s = String(input);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

// ISO 週番号（UTC 基準。Edge Function と同一ロジック）。
export function isoWeek(d) {
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = (date.getUTCDay() + 6) % 7; // 月曜=0
    date.setUTCDate(date.getUTCDate() - dayNum + 3); // 木曜へ
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(
        ((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
    );
    return { year: date.getUTCFullYear(), week };
}

// ローカル UTC からチャレンジ時刻情報を作る（フォールバック）。
export function localChallengeInfo(now = new Date()) {
    const utcDate = now.toISOString().slice(0, 10);
    const { year, week } = isoWeek(now);
    const isoWeekStr = `${year}-W${String(week).padStart(2, '0')}`;
    return {
        source: 'local',
        server_time: now.toISOString(),
        utc_date: utcDate,
        iso_week: isoWeekStr,
        daily_seed: hashSeed('daily:' + utcDate),
        weekly_seed: hashSeed('weekly:' + isoWeekStr)
    };
}

// チャレンジ時刻情報を取得する。サーバー優先・失敗時はローカル UTC。
export async function fetchChallengeInfo() {
    if (typeof endpointBase === 'string' && endpointBase.length > 0) {
        try {
            const res = await fetch(`${endpointBase}/challenges`, {
                method: 'GET',
                headers: {
                    apikey: SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${SUPABASE_ANON_KEY}`
                },
                cache: 'no-store'
            });
            if (res.ok) {
                const data = await res.json();
                if (data && data.utc_date && data.iso_week) {
                    return { ...data, source: 'server' };
                }
            }
        } catch (err) {
            console.warn('challenges fetch failed, using local fallback:', err);
        }
    }
    return localChallengeInfo();
}
