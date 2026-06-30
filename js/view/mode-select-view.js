// ===================================
// view/mode-select-view.js — タイトルのモード選択 UI と Training パネル（Phase 7）
//
// 責務: モード選択ボタン・選択状態表示・モード説明・Training 設定フォーム・
//   ゲーム中の Training パワーアップ確認パネルの表示。ゲームルールは持たない
//   （選択状態・設定は model/game-modes、効果は controller）。
//
// 依存方向: model/game-modes（選択・設定）。DOM 参照は configure で注入。重複登録を防止。
// ===================================

import {
    getModes,
    getSelectedMode,
    setMode,
    getTrainingSettings,
    setTrainingSetting
} from '../model/game-modes.js';

let refs = {
    modeButtons: [], // NodeList/Array of buttons (data-mode)
    modeDesc: null,
    trainingSettings: null, // タイトルの Training 設定パネル
    trInvincible: null,
    trSpeed: null,
    trObstacles: null,
    trainingPanel: null, // ゲーム中の Training 操作パネル
    trPuButtons: [], // パワーアップ確認ボタン（data-pu）
    // Phase 11: Training の Wave / Boss / Event 確認ボタン
    trWaveButtons: [], // data-wave
    trBossButtons: [], // data-boss
    trEventButtons: [] // data-event
};
let callbacks = {
    onSpawnPreview: () => {},
    onModeChange: () => {},
    // Phase 11: Training の Wave / Boss / Event 開始コールバック
    onTrainingWave: () => {},
    onTrainingBoss: () => {},
    onTrainingEvent: () => {}
};
let bound = false;

export function configureModeSelectView(elements, cb = {}) {
    refs = { ...refs, ...elements };
    callbacks = { ...callbacks, ...cb };
    bindEvents();
    renderModeSelect();
}

// 選択状態・説明・Training 設定の表示を更新する。
export function renderModeSelect() {
    const selected = getSelectedMode();
    (refs.modeButtons || []).forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === selected.id);
        btn.setAttribute('aria-pressed', btn.dataset.mode === selected.id ? 'true' : 'false');
    });
    if (refs.modeDesc) refs.modeDesc.textContent = selected.desc || '';

    // Training のときだけ設定パネルを表示。
    const isTraining = selected.id === 'training';
    if (refs.trainingSettings) refs.trainingSettings.style.display = isTraining ? '' : 'none';

    const t = getTrainingSettings();
    if (refs.trInvincible) refs.trInvincible.checked = t.invincible;
    if (refs.trSpeed) refs.trSpeed.value = String(t.speed);
    if (refs.trObstacles) refs.trObstacles.value = t.obstacles;
}

// ゲーム中の Training パネル（パワーアップ確認）の表示切替。
export function setTrainingPanelVisible(visible) {
    if (refs.trainingPanel) refs.trainingPanel.style.display = visible ? '' : 'none';
}

function bindEvents() {
    if (bound) return;
    bound = true;

    (refs.modeButtons || []).forEach((btn) => {
        btn.addEventListener('click', () => {
            setMode(btn.dataset.mode);
            renderModeSelect();
            callbacks.onModeChange(getSelectedMode().id);
        });
    });
    if (refs.trInvincible) refs.trInvincible.addEventListener('change', () => setTrainingSetting('invincible', refs.trInvincible.checked));
    if (refs.trSpeed) refs.trSpeed.addEventListener('change', () => setTrainingSetting('speed', Number(refs.trSpeed.value)));
    if (refs.trObstacles) refs.trObstacles.addEventListener('change', () => setTrainingSetting('obstacles', refs.trObstacles.value));
    (refs.trPuButtons || []).forEach((btn) => {
        btn.addEventListener('click', () => callbacks.onSpawnPreview(btn.dataset.pu));
    });
    // Phase 11: Training の Wave / Boss / Event 確認ボタン。
    (refs.trWaveButtons || []).forEach((btn) => {
        btn.addEventListener('click', () => callbacks.onTrainingWave(btn.dataset.wave));
    });
    (refs.trBossButtons || []).forEach((btn) => {
        btn.addEventListener('click', () => callbacks.onTrainingBoss(btn.dataset.boss));
    });
    (refs.trEventButtons || []).forEach((btn) => {
        btn.addEventListener('click', () => callbacks.onTrainingEvent(btn.dataset.event));
    });
}

// 一覧取得（テスト/将来用）。
export function listModes() {
    return getModes();
}
