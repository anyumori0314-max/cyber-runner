// ===================================
// view/challenges-view.js — デイリー/ウィークリーチャレンジ表示（Phase 9）
//
// 責務: チャレンジ一覧（進捗バー・達成バッジ・期間キー・フォールバック表示）の描画のみ。
//   進捗/達成/報酬は model/challenges。DOM 参照は configure で注入、textContent で安全表示。
//
// 依存方向: model/challenges（読取）。ゲームルールを持たない。
// ===================================

import { getChallengesView } from '../model/challenges.js';

let refs = { challengesContainer: null, challengesSource: null };

export function configureChallengesView(elements) {
    refs = { ...refs, ...elements };
}

function buildItem(ch) {
    const li = document.createElement('li');
    li.className = 'challenge-item' + (ch.completed ? ' completed' : '');

    const head = document.createElement('div');
    head.className = 'challenge-head';
    const label = document.createElement('span');
    label.className = 'challenge-label';
    label.textContent = ch.label;
    const reward = document.createElement('span');
    reward.className = 'challenge-reward';
    reward.textContent = ch.completed ? '✓ +' + ch.rewardXp + ' XP' : '+' + ch.rewardXp + ' XP';
    head.appendChild(label);
    head.appendChild(reward);

    const bar = document.createElement('div');
    bar.className = 'challenge-bar';
    const fill = document.createElement('div');
    fill.className = 'challenge-bar-fill';
    const pct = ch.target > 0 ? Math.max(0, Math.min(100, (ch.progress / ch.target) * 100)) : 0;
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    const prog = document.createElement('span');
    prog.className = 'challenge-progress';
    prog.textContent = `${Math.min(ch.progress, ch.target)} / ${ch.target}`;

    li.appendChild(head);
    li.appendChild(bar);
    li.appendChild(prog);
    return li;
}

function buildSection(title, set) {
    const section = document.createElement('div');
    section.className = 'challenge-section';
    const h = document.createElement('h3');
    h.textContent = set && set.key ? `${title} (${set.key})` : title;
    section.appendChild(h);
    const ul = document.createElement('ul');
    ul.className = 'challenge-list';
    if (set && set.items) {
        for (const ch of set.items) ul.appendChild(buildItem(ch));
    } else {
        const li = document.createElement('li');
        li.textContent = 'No challenges';
        ul.appendChild(li);
    }
    section.appendChild(ul);
    return section;
}

export function renderChallenges() {
    if (!refs.challengesContainer) return;
    const view = getChallengesView();
    refs.challengesContainer.innerHTML = '';
    refs.challengesContainer.appendChild(buildSection('DAILY', view.daily));
    refs.challengesContainer.appendChild(buildSection('WEEKLY', view.weekly));
    if (refs.challengesSource) {
        refs.challengesSource.textContent = view.fallback
            ? '※ ローカル時刻で表示中（サーバー未配備）。PC時刻変更による不正はサーバー利用時のみ完全に防げます。'
            : 'サーバー時刻で同期済み。';
    }
}
