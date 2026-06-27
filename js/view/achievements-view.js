// ===================================
// view/achievements-view.js — 実績一覧とトースト通知（Phase 5）
//
// 責務: 実績一覧の描画（達成/未達成の視覚区別）と、実績解除トーストの表示。
//   解除判定・保存は model/achievements.js、呼び出しは controller/main。
//
// 依存方向: model/achievements（表示用データ取得）。DOM 参照は configure で注入。安全に textContent。
// ===================================

import { getAchievementsView } from '../model/achievements.js';

let refs = {
    achievementsList: null,
    toastContainer: null
};

export function configureAchievementsView(elements) {
    refs = { ...refs, ...elements };
}

// 実績一覧を描画（unlocked/locked をクラスで視覚区別）。
export function renderAchievements() {
    if (!refs.achievementsList) return;
    refs.achievementsList.innerHTML = '';
    for (const a of getAchievementsView()) {
        const li = document.createElement('li');
        li.className = a.unlocked ? 'unlocked' : 'locked';
        const name = document.createElement('span');
        name.className = 'ach-name';
        name.textContent = (a.unlocked ? '★ ' : '☆ ') + a.name;
        const desc = document.createElement('span');
        desc.className = 'ach-desc';
        desc.textContent = a.desc;
        li.appendChild(name);
        li.appendChild(desc);
        refs.achievementsList.appendChild(li);
    }
}

// 解除トーストを表示（数秒で自動消滅）。
export function showToast(title, sub = '') {
    if (!refs.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    const t = document.createElement('span');
    t.className = 'toast-title';
    t.textContent = title;
    toast.appendChild(t);
    if (sub) {
        const s = document.createElement('span');
        s.className = 'toast-sub';
        s.textContent = sub;
        toast.appendChild(s);
    }
    refs.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}
