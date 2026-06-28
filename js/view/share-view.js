// ===================================
// view/share-view.js — 結果カード生成と共有（Phase 10）
//
// 責務: GAME OVER の結果を Canvas で結果カードに描画し、PNG ダウンロードと
//   共有テキストのクリップボードコピーを提供する。外部画像・CDN は使わない（Canvas のみ）。
//   プレイヤー名以外の個人情報は含めない。
//
// 依存方向: なし（DOM 参照は configure で注入。値は setShareData で controller から受け取る）。
// ===================================

let refs = {
    shareCanvas: null,
    shareDownloadBtn: null,
    shareCopyBtn: null,
    shareStatus: null,
    shareArea: null
};
let lastData = null;

const MODE_LABELS = { endless: 'ENDLESS', timeattack: 'TIME ATTACK', hardcore: 'HARDCORE', training: 'TRAINING' };

export function configureShareView(elements) {
    refs = { ...refs, ...elements };
}

// controller（endGame）から結果を受け取り、カードを描画する。
export function setShareData(data) {
    lastData = data || null;
    drawCard();
}

// 共有エリアの表示/非表示。
export function setShareAreaVisible(visible) {
    if (refs.shareArea) refs.shareArea.style.display = visible ? '' : 'none';
}

function gameUrl() {
    try {
        return location.origin + location.pathname;
    } catch (_e) {
        return '';
    }
}

// 結果カードを Canvas に描画する（ネオン調・外部素材なし）。
export function drawCard() {
    const canvas = refs.shareCanvas;
    if (!canvas || !lastData) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    // 背景
    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#0a0e27');
    grad.addColorStop(1, '#1a1a3e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 枠
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 16;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.shadowBlur = 0;

    // タイトル
    ctx.fillStyle = '#00ffcc';
    ctx.font = 'bold 34px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('CYBER RUNNER', W / 2, 60);

    // スコア
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px Arial';
    ctx.fillText(String(lastData.score), W / 2, 130);
    ctx.fillStyle = '#b8c6d8';
    ctx.font = '16px Arial';
    ctx.fillText('SCORE', W / 2, 152);

    // 明細（左右2列）
    const rows = [
        ['RANK', String(lastData.rank)],
        ['MAX COMBO', String(lastData.maxCombo)],
        ['MODE', MODE_LABELS[lastData.mode] || String(lastData.mode || '')],
        ['TITLE', String(lastData.title || '')],
        ['PLAYER LEVEL', `LV ${lastData.level}`]
    ];
    ctx.textAlign = 'left';
    let y = 190;
    for (const [k, v] of rows) {
        ctx.fillStyle = '#7fd9ff';
        ctx.font = 'bold 15px Arial';
        ctx.fillText(k, 40, y);
        ctx.fillStyle = '#e8f6ff';
        ctx.font = '15px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(v, W - 40, y);
        ctx.textAlign = 'left';
        y += 24;
    }

    // フッタ URL
    ctx.fillStyle = '#5a6b85';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(gameUrl(), W / 2, H - 22);
}

// 共有テキスト（プレイヤー名以外の個人情報なし）。
export function buildShareText() {
    if (!lastData) return '';
    const mode = MODE_LABELS[lastData.mode] || lastData.mode || '';
    return [
        'CYBER RUNNER',
        `SCORE ${lastData.score} (${lastData.rank})`,
        `MODE ${mode}`,
        `MAX COMBO ${lastData.maxCombo}`,
        `TITLE ${lastData.title || ''}`,
        `PLAYER LV ${lastData.level}`,
        gameUrl()
    ].join('\n');
}

// PNG をダウンロードする。
export function downloadCard() {
    const canvas = refs.shareCanvas;
    if (!canvas) return;
    try {
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.download = 'cyber-runner-result.png';
        a.href = url;
        a.click();
        if (refs.shareStatus) refs.shareStatus.textContent = 'PNG を保存しました。';
    } catch (err) {
        console.warn('download failed:', err);
        if (refs.shareStatus) refs.shareStatus.textContent = 'PNG 生成に失敗しました。';
    }
}

// 共有文をクリップボードへコピー（失敗時は手動コピー用に状態表示）。
export async function copyShareText() {
    const text = buildShareText();
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            if (refs.shareStatus) refs.shareStatus.textContent = '共有文をコピーしました。';
            return true;
        }
        throw new Error('clipboard unavailable');
    } catch (err) {
        console.warn('clipboard failed:', err);
        if (refs.shareStatus) refs.shareStatus.textContent = 'コピーできませんでした。手動で選択してください。';
        return false;
    }
}
