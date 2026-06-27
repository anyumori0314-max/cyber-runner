// ===================================
// model/titles.js — プレイスタイル称号判定（Phase 5）
//
// 責務: 1プレイの結果から称号を1つ判定する純粋関数（Model）。
//   最も際立った指標を採用し、いずれも目立たなければ「サイバールーキー」。
//
// 依存方向: なし（リーフ）。DOM/通信に触れない。
// ===================================

// run = { maxCombo, coreCount, nearMissCount, dashCount, survivalTime }
export function determineTitle(run = {}) {
    const maxCombo = run.maxCombo || 0;
    const coreCount = run.coreCount || 0;
    const nearMissCount = run.nearMissCount || 0;
    const dashCount = run.dashCount || 0;
    const survivalTime = run.survivalTime || 0;

    // 各カテゴリの「際立ち度」= 実績値 / 基準値。最大のものを採用（>=1 で称号成立）。
    const candidates = [
        { title: 'コンボ職人', score: maxCombo / 15 },
        { title: 'コアハンター', score: coreCount / 12 },
        { title: 'ニアミスマスター', score: nearMissCount / 8 },
        { title: 'ダッシュランナー', score: dashCount / 8 },
        { title: '回避の達人', score: survivalTime / 45 }
    ];

    let best = candidates[0];
    for (const c of candidates) {
        if (c.score > best.score) best = c;
    }
    return best.score >= 1 ? best.title : 'サイバールーキー';
}
