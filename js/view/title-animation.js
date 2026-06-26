// ===================================
// view/title-animation.js — タイトル背景アニメーション（Stage 4）
//
// 責務: タイトル画面の Canvas 背景アニメーション（動くライン）。
//       タイトルが active の間だけ独立した RAF で描画し、非 active で停止する。
//
// 依存方向: なし（DOM 要素を configureTitleAnimation() で注入される）。
//   ゲーム本体のループ（game-loop.js）とは独立した自己完結アニメーション。
// ===================================

let titleCanvas = null;
let titleScreen = null;
let titleAnimId = null;

export function configureTitleAnimation(elements) {
    if (elements.titleCanvas) titleCanvas = elements.titleCanvas;
    if (elements.titleScreen) titleScreen = elements.titleScreen;
}

// タイトル背景アニメーションを開始する（既存挙動と同一）。
export function startTitleAnimation() {
    if (!titleCanvas) return;
    const tctx = titleCanvas.getContext('2d');
    const w = titleCanvas.width;
    const h = titleCanvas.height;
    let offset = 0;
    function frame() {
        tctx.clearRect(0, 0, w, h);
        // 背景グラデ
        const g = tctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, 'rgba(10,10,30,0.6)');
        g.addColorStop(1, 'rgba(20,0,30,0.4)');
        tctx.fillStyle = g;
        tctx.fillRect(0, 0, w, h);

        // 動くライン
        tctx.strokeStyle = 'rgba(0,200,255,0.08)';
        tctx.lineWidth = 2;
        for (let i = -2; i < 20; i++) {
            tctx.beginPath();
            const x = ((i * 80 + offset) % (w + 200)) - 100;
            tctx.moveTo(x, 0);
            tctx.lineTo(x + 120, h);
            tctx.stroke();
        }
        offset += 1.2;
        if (titleScreen && titleScreen.classList.contains('active')) {
            titleAnimId = requestAnimationFrame(frame);
        } else {
            tctx.clearRect(0, 0, w, h);
            if (titleAnimId) cancelAnimationFrame(titleAnimId);
            titleAnimId = null;
        }
    }
    if (!titleAnimId) frame();
}
