// ===================================
// sw.js — Service Worker（Phase 12）
//
// 方針:
//   - バージョン付きキャッシュ名。activate で古いキャッシュを削除する。
//   - HTML（ナビゲーション）は network-first（最新を優先、オフラインはキャッシュ→offline.html）。
//   - 静的資産（JS/CSS/画像/manifest）は stale-while-revalidate（即時表示＋背景更新）。
//   - Supabase API・POST・start-run/submit-score/challenges/analytics はキャッシュしない。
//   - SW が壊れても通常版が動くよう、fetch では失敗を握りつぶしてフォールバックする。
//   - GitHub Pages のサブディレクトリで動くよう、すべて相対 URL（SW の location 基準）。
// ===================================

const CACHE_VERSION = 'v1';
// このアプリ専用のキャッシュ接頭辞。同一オリジンに同居する他アプリのキャッシュを誤って削除しないため、
// activate での掃除はこの接頭辞を持つキャッシュだけに限定する。
const CACHE_PREFIX = 'cyber-runner-cache-';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

// 起動に必要な最小シェル（残りのモジュールは SWR で初回ロード時にキャッシュされる）。
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './offline.html',
    './manifest.webmanifest',
    './js/main.js',
    './assets/icons/icon.svg',
    './assets/icons/icon-192.png',
    './assets/icons/icon-512.png'
];

// キャッシュしてはいけない API パス（同一オリジンに置かれた場合の保険）。
const NO_CACHE_PATTERN = /(start-run|submit-score|submit-analytics|challenges|analytics|\/functions\/)/i;

self.addEventListener('install', (event) => {
    // 自動では skipWaiting しない（プレイ中の自動更新を避け、ユーザー操作で適用する）。
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            // 自アプリ（CACHE_PREFIX）の旧バージョンのみ削除。他オリジンアプリのキャッシュは触らない。
            Promise.all(
                keys
                    .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
                    .map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ユーザーが更新を承認したら待機を解除して新 SW を有効化する。
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const req = event.request;

    // GET 以外（POST 等）はキャッシュしない（通常どおりネットワークへ）。
    if (req.method !== 'GET') return;

    let url;
    try { url = new URL(req.url); } catch (_e) { return; }

    // クロスオリジン（Supabase など）はキャッシュせずネットワークへ。
    if (url.origin !== self.location.origin) return;

    // API ライクな同一オリジンパスもキャッシュしない。
    if (NO_CACHE_PATTERN.test(url.pathname)) return;

    // HTML（ナビゲーション）は network-first。
    const accept = req.headers.get('accept') || '';
    if (req.mode === 'navigate' || accept.includes('text/html')) {
        event.respondWith(networkFirst(req));
        return;
    }

    // 静的資産は stale-while-revalidate。
    event.respondWith(staleWhileRevalidate(req));
});

// network-first: 取得できれば最新をキャッシュ。失敗時はキャッシュ→index→offline.html。
async function networkFirst(req) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
    } catch (_e) {
        const cached = await cache.match(req);
        if (cached) return cached;
        const index = await cache.match('./index.html');
        if (index) return index;
        const offline = await cache.match('./offline.html');
        if (offline) return offline;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
}

// stale-while-revalidate: キャッシュを即返しつつ背景で更新。両方失敗時は 503。
async function staleWhileRevalidate(req) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const network = fetch(req)
        .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
        })
        .catch(() => null);
    return cached || (await network) || new Response('Offline', { status: 503, statusText: 'Offline' });
}
