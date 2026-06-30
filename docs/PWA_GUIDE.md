# PWA ガイド（Phase 12）

Cyber Runner は GitHub Pages から「ホーム画面へ追加」してオフライン起動できる PWA です。

## 構成ファイル
- `manifest.webmanifest` — name / short_name / description / start_url / scope / `display: standalone` /
  theme_color / background_color / icons / id。**すべて相対パス**（GitHub Pages のサブパスで動作）。
- `sw.js` — Service Worker（バージョン付きキャッシュ）。
- `offline.html` — オフライン時のフォールバックページ。
- `js/services/pwa-service.js` — SW 登録・更新検出・適用（DOM 非操作・失敗で throw しない）。
- `assets/icons/` — `icon.svg` / `icon-192.png` / `icon-512.png` / `icon-maskable-512.png`
  （ブラウザでラスタライズした実 PNG。**外部 CDN 不使用**）。

## キャッシュ戦略（sw.js）
- キャッシュ名: `cyber-runner-cache-<CACHE_VERSION>`（既定 `v1`）。`activate` で旧キャッシュを削除。
- HTML（ナビゲーション）: **network-first**（最新優先 → 失敗時キャッシュ → `index.html` → `offline.html`）。
- 静的資産（JS/CSS/画像/manifest）: **stale-while-revalidate**（即時表示＋背景更新）。
  初回オンライン起動で全モジュールがキャッシュされ、以降オフライン起動可能。
- **キャッシュしない**: クロスオリジン（Supabase）/ 非 GET（POST）/
  `start-run` / `submit-score` / `challenges` / `analytics`（`submit-analytics`）/ `/functions/`。

## 更新フロー
- 新しい SW を検出すると更新バナーを表示（`role="status"`）。
- **プレイ中は自動リロードしない**。ユーザーが「更新」を押すと待機 SW を `SKIP_WAITING` で有効化し、
  `controllerchange` で 1 回だけリロード。更新失敗時は旧版を継続利用。

## オフライン動作
- Endless / Training をオフラインで起動可能。
- ランキングは既存キャッシュ（`localStorage`）または空表示。スコアは「送信不可」を安全表示し、**自動再送しない**。
- デイリー/ウィークリーは既存の UTC フォールバック。分析（PWA/オフライン）は送信しない。
- SW のエラー時も、通常版（SW なし）でゲームは起動する。

## アクセシビリティ（Phase 12）
- `prefers-reduced-motion` / `prefers-contrast` を尊重。
- `:focus-visible` の明確なフォーカス表示。
- 操作ボタンは最低 44×44 CSS px、`aria-label` 付き、押下状態は枠＋スケール（色のみに依存しない）。
- タッチ操作はキーボードでも操作可能（共存）。画面拡大時もボタンは折返して残る。

## 動作確認（ローカル）
```powershell
py -m http.server 8130
# http://localhost:8130/ を開く（localhost は SW の secure context）
```
- DevTools → Application → Service Workers / Manifest を確認。
- Network を Offline にしてリロード → 起動できることを確認。
- Lighthouse（mobile）参考値: Accessibility 98 / Best Practices 100 / SEO 100。

## GitHub Pages デプロイ時の注意
- サブパス（例 `/cyber-runner/`）配信のため、参照はすべて相対（`./`）にしている。
- 初回アクセスはオンラインで（SW 登録・キャッシュ生成のため）。以降オフライン可。
