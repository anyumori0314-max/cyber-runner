// ===================================
// view/profile-view.js — プロフィール表示（Phase 8）
//
// 責務: レベル・XP バー・累計統計・モード別ベストの表示のみ。
//   値の保持/計算は model/progression。DOM は configure で注入、textContent で安全表示。
//
// 依存方向: model/progression（読取）。ゲームルールを持たない。
// ===================================

import { getProfile, getProgress, levelProgress } from '../model/progression.js';

let refs = {
    profileLevel: null,
    profileXpBar: null,
    profileXpText: null,
    profileStats: null,
    profileBest: null
};

export function configureProfileView(elements) {
    refs = { ...refs, ...elements };
}

function row(label, value) {
    const li = document.createElement('li');
    const k = document.createElement('span');
    k.className = 'stat-key';
    k.textContent = label;
    const v = document.createElement('span');
    v.className = 'stat-val';
    v.textContent = String(value);
    li.appendChild(k);
    li.appendChild(v);
    return li;
}

export function renderProfile() {
    const prof = getProfile();
    const prog = getProgress();
    const lp = levelProgress(prof.xp);

    if (refs.profileLevel) refs.profileLevel.textContent = `LV ${prof.level}`;
    if (refs.profileXpBar) {
        const pct = lp.need > 0 ? Math.max(0, Math.min(100, (lp.into / lp.need) * 100)) : 100;
        refs.profileXpBar.style.width = `${pct}%`;
    }
    if (refs.profileXpText) refs.profileXpText.textContent = `XP ${prof.xp}  (${lp.into}/${lp.need} → LV ${lp.level + 1})`;

    if (refs.profileStats) {
        refs.profileStats.innerHTML = '';
        refs.profileStats.appendChild(row('プレイ回数', prog.runs));
        refs.profileStats.appendChild(row('累計スコア', prog.totalScore));
        refs.profileStats.appendChild(row('累計生存時間', `${Math.floor(prog.totalSurvival)}s`));
        refs.profileStats.appendChild(row('累計コア', prog.totalCores));
        refs.profileStats.appendChild(row('累計ニアミス', prog.totalNearMiss));
        refs.profileStats.appendChild(row('最長生存', `${Math.floor(prog.longestSurvival)}s`));
    }
    if (refs.profileBest) {
        refs.profileBest.innerHTML = '';
        refs.profileBest.appendChild(row('ENDLESS ベスト', prog.bestByMode.endless || 0));
        refs.profileBest.appendChild(row('TIME ATTACK ベスト', prog.bestByMode.timeattack || 0));
        refs.profileBest.appendChild(row('HARDCORE ベスト', prog.bestByMode.hardcore || 0));
    }
}
