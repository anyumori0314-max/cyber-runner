// ===================================
// view/cosmetics-view.js — 外観カスタマイズ UI（Phase 8）
//
// 責務: 外観カタログ（カラー/発光/軌跡/コアエフェクト/称号）の一覧表示と選択操作の仲介。
//   未解放は選択不可（disabled + 解放条件を表示）。選択は model に委譲し効果適用は controller/main。
//
// 依存方向: model/cosmetics（カタログ・選択）。DOM 参照は configure で注入。安全に textContent。
// ===================================

import { getCatalogView, selectCosmetic } from '../model/cosmetics.js';

let refs = { cosmeticsContainer: null };
let onApply = () => {};

const CATEGORY_LABELS = {
    color: 'プレイヤーカラー',
    glow: 'ネオン発光',
    trail: '移動軌跡',
    coreEffect: 'コア取得エフェクト',
    title: '称号'
};

export function configureCosmeticsView(elements, applyCallback) {
    refs = { ...refs, ...elements };
    if (typeof applyCallback === 'function') onApply = applyCallback;
}

function unlockHint(unlock) {
    if (!unlock) return '';
    if (unlock.type === 'level') return `LV${unlock.level} で解放`;
    if (unlock.type === 'achievement') return '実績で解放';
    if (unlock.type === 'challenge') return 'チャレンジで解放';
    return '';
}

export function renderCosmetics() {
    if (!refs.cosmeticsContainer) return;
    const catalog = getCatalogView();
    refs.cosmeticsContainer.innerHTML = '';

    for (const cat of Object.keys(catalog)) {
        const section = document.createElement('div');
        section.className = 'cosmetic-section';
        const h = document.createElement('h3');
        h.textContent = CATEGORY_LABELS[cat] || cat;
        section.appendChild(h);

        const list = document.createElement('div');
        list.className = 'cosmetic-items';
        for (const item of catalog[cat]) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cosmetic-item btn btn-small'
                + (item.selected ? ' selected' : '')
                + (item.unlocked ? '' : ' locked');
            btn.textContent = item.unlocked ? item.name : `🔒 ${item.name}`;
            if (!item.unlocked) {
                btn.disabled = true;
                btn.title = unlockHint(item.unlock);
            }
            btn.addEventListener('click', () => {
                if (selectCosmetic(cat, item.id)) {
                    renderCosmetics();
                    onApply(); // 描画へ即時反映
                }
            });
            list.appendChild(btn);
        }
        section.appendChild(list);
        refs.cosmeticsContainer.appendChild(section);
    }
}
