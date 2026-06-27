// ===================================
// view/options-view.js — オプション画面（Phase 2）
//
// 責務: オプション設定 UI の表示と入力イベントの仲介。値の保持・永続化は
//   model/options.js、効果適用（音量・操作説明表示など）は main 注入の applyEffect。
//
// 依存方向: model/options（取得・更新）。DOM 参照は configureOptionsView で注入。
// ===================================

import { getOptions, setOption } from '../model/options.js';

let refs = {
    soundEnabled: null,
    soundVolume: null,
    screenShake: null,
    particles: null,
    showControls: null
};
let applyEffect = () => {};
let bound = false;

export function configureOptionsView(elements, onApply) {
    refs = { ...refs, ...elements };
    if (typeof onApply === 'function') applyEffect = onApply;
    bindEvents();
    renderOptions();
}

// 現在のオプション値をコントロールへ反映する。
export function renderOptions() {
    const o = getOptions();
    if (refs.soundEnabled) refs.soundEnabled.checked = o.soundEnabled;
    if (refs.soundVolume) refs.soundVolume.value = String(o.soundVolume);
    if (refs.screenShake) refs.screenShake.checked = o.screenShakeEnabled;
    if (refs.particles) refs.particles.checked = o.particlesEnabled;
    if (refs.showControls) refs.showControls.checked = o.showControls;
}

function commit(key, value) {
    setOption(key, value); // model が検証・永続化
    applyEffect(getOptions()); // controller/main が効果を適用
    renderOptions();
}

// 入力イベントを一度だけ登録する（重複登録防止）。
function bindEvents() {
    if (bound) return;
    bound = true;
    if (refs.soundEnabled) refs.soundEnabled.addEventListener('change', () => commit('soundEnabled', refs.soundEnabled.checked));
    if (refs.soundVolume) refs.soundVolume.addEventListener('input', () => commit('soundVolume', Number(refs.soundVolume.value)));
    if (refs.screenShake) refs.screenShake.addEventListener('change', () => commit('screenShakeEnabled', refs.screenShake.checked));
    if (refs.particles) refs.particles.addEventListener('change', () => commit('particlesEnabled', refs.particles.checked));
    if (refs.showControls) refs.showControls.addEventListener('change', () => commit('showControls', refs.showControls.checked));
}
