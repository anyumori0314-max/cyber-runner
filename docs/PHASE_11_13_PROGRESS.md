# Phase 11–13 実装進捗

> 1作業ブランチ `feature/phase11-13-game-expansion` で Phase 11 → 12 → 13 の順に実装する。
> 利用上限・エラーで中断しても作業ツリーを破棄せず、この文書を基準に再開する。

- 作業前 commit hash: `fe67e75` (Merge pull request #4 …)
- 作業前確認: `git status` clean / `npm test` 73 PASS / `npm run verify` OK / `git diff --check` clean
- 前提条件: Phase 1–10 main マージ済み / Phase 6 本番 Supabase 反映済み（`docs/PHASE_6_PRODUCTION_RUNBOOK.md` + PR #4）/ 単一 RAF / Supabase 直 INSERT なし / service_role 非混入 — すべて充足を確認

## 共通禁止事項の遵守
git add / commit / push / merge / main 直接変更 / git restore / git reset --hard / git clean / 本番 DB 破壊 / 本番ランキング削除 / service_role フロント埋め込み / 秘密保存 / 外部 CDN 無断追加 — いずれも行わない。

---

## Phase 11：ウェーブ・イベント・ボス

- 状況: **完了**
- 新規ファイル:
  - `js/model/waves.js`（ウェーブ列・番号/種別解決・サイクル難易度・Hardcore 時間補正：純粋）
  - `js/model/bosses.js`（3ボス定義・生成・HP スケール・ダメージ/撃破・安全地帯幾何：純粋）
  - `js/model/random-events.js`（5イベント定義・効果適用/スナップショット復元：純粋）
  - `js/controller/wave-controller.js`（状態機械・ボス攻撃 spawn・イベント開始/終了・Training 手動制御）
  - `js/view/wave-view.js`（ウェーブ番号/進捗/開始終了/休憩演出）
  - `js/view/boss-view.js`（警告・HP バー・ボス本体・安全地帯・撃破演出）
  - `js/view/event-view.js`（イベント名・残り時間・警告表示）
- 変更ファイル:
  - `js/config.js`（Phase 11 定数を集約）
  - `js/state.js`（`waveState` 単一情報源 + `gameState` のイベント/統計フィールド + `resetWaveState`/`resetState`）
  - `js/model/difficulty.js`（`waveSpeedBonus`・`eventSpeedMult` を speed へ反映：中立値で既存挙動不変）
  - `js/model/entities.js`（`BossWeakPoint` 追加）
  - `js/controller/game-loop.js`（`initWaveSystem`/`updateWaveSystem` 配線・spawn のフェーズ制御・ボスダメージ判定・統計）
  - `js/view/renderer.js`（ウェーブ/ボス/イベント overlay + DARK ZONE 描画）
  - `js/view/mode-select-view.js`（Training の Wave/Boss/Event ボタン配線）
  - `js/main.js`（Training ボタン取得 + wave-controller コールバック注入）
  - `index.html` / `style.css`（Training パネルに Wave/Boss/Event 行）
  - `scripts/verify.mjs`（Phase 11 テスト 12 件追加）
- 実装内容:
  - ウェーブ状態機械: intro→active→outro→intermission を繰り返し Wave5 でボス。Endless は撃破で次サイクル（難易度段階上昇・ボス HP 増）。pause は RAF 停止で全タイマー凍結（deltaTime 駆動・専用 RAF/`setInterval` 不使用）。
  - モード別: Endless=繰返し+サイクル上昇 / Time Attack=既存60秒優先（ボス中でも残り0でFINISH）/ Hardcore=ウェーブ短縮+ボス間隔短縮（警告・最小通過幅は維持＝回避不能化しない）/ Training=手動で任意 Wave/Boss/Event を確認（ランキング/XP/実績/チャレンジ/分析対象外）。
  - ボス: Firewall Core（移動する安全地帯・同時レーザー上限・コア取得でダメージ）/ Data Worm（上部移動・追尾上限・落下する弱点ノードへダッシュ接触でダメージ、通常接触は失敗）/ Security Gate（隙間壁・最小通過幅保証・正しい通過でダメージ）。
  - イベント: CORE RUSH / DOUBLE SCORE（新規加算のみ2倍・過去スコア非減少）/ HIGH SPEED（事前警告→終了で正確に復元）/ DARK ZONE（視界制限・危険とプレイヤー位置は可視）/ LASER STORM（安全地帯維持・同時数上限）。同時1つ・pause 凍結・RETRY/モード変更で解除・終了で完全復元。
- 自動テスト結果: `npm test` / `npm run verify` = **Total 85 / Passed 85 / Failed 0**（既存73 + Phase11 12件）。`git diff --check` clean。
- ブラウザ確認結果（`py -m http.server 8130` + Chrome DevTools MCP）:
  - ロード時 console エラー 0。全47モジュール 200。
  - Endless: countdown→Wave1 active へ遷移、スコア加算・障害物 spawn を確認。
  - Training: `trainingStartBoss('firewall')` で Firewall 出現、`applyBossDamage` で HP 6→4、HP バー/安全地帯描画、例外なし。
  - 本番 Supabase ランキング GET は従来どおり正常（読み取り・直 INSERT なし）。Training は送信セクション非表示。
  - （唯一の 404 はスモークテスト側の誤パス probe で、アプリ起因ではない。）
- 未実施テスト: 実プレイでの Wave1→ボス到達の手動目視（停止プレイヤーは即死するため state 機械はユニットテストで網羅）。各 viewport での目視は Phase 12 でまとめて実施予定。
- 既知の制限:
  - Security Gate は単一隙間壁（隙間を安全ルートとして強調）。「複数パターン」は隙間位置/幅の変化で表現（同時複数隙間ではない）。最小通過幅は保証。
  - Data Worm は本体が画面上部のため、落下する弱点ノードをダッシュで叩く方式（プレイヤーは下部固定）。
  - DARK ZONE は放射状暗幕＋危険レーザー再描画＋プレイヤー位置リングで安全表示を担保。
- 次に再開する場所: Phase 12（モバイル操作・PWA）着手から。

---

## Phase 12：モバイル操作・PWA

- 状況: **完了**
- 新規ファイル:
  - `js/controller/touch-input.js`（Pointer Events / マルチタッチ / capture / visibilitychange 解除 / 重複登録防止 / isTouchDevice）
  - `js/services/pwa-service.js`（SW 登録・更新検出・適用。DOM 非操作・失敗で throw しない）
  - `manifest.webmanifest`（id/name/short_name/description/start_url/scope/display:standalone/theme/bg/icons・相対パス）
  - `sw.js`（versioned cache / install・activate・fetch / 旧キャッシュ削除 / HTML network-first / 静的 SWR / API・POST・Supabase 非キャッシュ / SKIP_WAITING）
  - `offline.html`（オフライン時の案内）
  - `assets/icons/icon.svg` `icon-192.png` `icon-512.png` `icon-maskable-512.png`（ブラウザでラスタライズした実 PNG・外部 CDN 不使用）
- 変更ファイル:
  - `index.html`（manifest/theme-color/viewport-fit/apple-touch-icon・オンスクリーン操作ボタン・更新バナー・操作ボタン表示オプション）
  - `style.css`（touch-controls 44px↑/safe-area/pressed 表示/update-banner/:focus-visible/prefers-reduced-motion/prefers-contrast/landscape）
  - `js/config.js`（`DEFAULT_OPTIONS.touchControls = 'auto'`）
  - `js/model/options.js`（touchControls 三状態の検証）
  - `js/view/options-view.js`（操作ボタン表示トグル + 'auto' 解決）
  - `js/controller/game-loop.js`（START/pause/backToTitle で `clearTouch()`）
  - `js/main.js`（タッチ配線・PWA 登録・更新バナー・touchControls 解決）
  - `scripts/verify.mjs`（Phase 12 テスト 10 件追加）
- 実装内容:
  - タッチ操作: 左/右（ホールド）・ダッシュ・一時停止。Pointer Events、マルチタッチ（pointerId 集合）、`setPointerCapture` で指が画面外でも残らない、`pointercancel`/`lostpointercapture`/`visibilitychange` で確実に解除。キーボードと共存（同一 player フラグ）。44×44 CSS px 以上、押下表示（scale+outline＝色のみ非依存）、aria-label。
  - 表示: 操作ボタン ON/OFF 設定（'auto'＝タッチ端末で初期 ON / PC で初期 OFF）。safe-area-inset 対応、横/縦対応、キャンバスは `touch-action:none` で誤スクロール防止、横スクロールなし、メニューの縦スクロールは維持。
  - PWA: GitHub Pages サブパスで動く相対 manifest/SW。SW はバージョン付きキャッシュ・HTML network-first・静的 SWR・Supabase/POST/start-run/submit-score/challenges/analytics は非キャッシュ・SW 失敗でも通常版で起動。
  - 更新処理: 新 SW 検出で更新バナー、ユーザー操作（更新ボタン）で `SKIP_WAITING`→`controllerchange` で1回だけリロード（プレイ中は自動リロードしない）。失敗時は旧版継続。
  - オフライン: 初回オンライン後は全モジュールがキャッシュされ、Endless/Training をオフライン起動可能。ランキングは GET 失敗時にキャッシュ/空表示（自動再送しない）。
  - アクセシビリティ: prefers-reduced-motion / 高コントラスト / :focus-visible / aria-label / キーボード操作維持 / 画面拡大でボタンが折返して消えない。
- 自動テスト結果: `npm test` / `npm run verify` = **Total 95 / Passed 95 / Failed 0**（既存85 + Phase12 10件）。`git diff --check` clean。
- ブラウザ確認結果（Chrome DevTools MCP）:
  - SW 登録/有効化（scope `http://localhost:8130/`）、controller 取得、manifest 200。キャッシュ 53 件（シェル＋全モジュール）、index/offline キャッシュ済み。
  - オフライン化→リロードでアプリ起動、Endless 起動可。console は Supabase GET の `ERR_INTERNET_DISCONNECTED`（想定どおり握りつぶし・ゲーム継続）のみ。
  - タッチ: 端末判定で操作ボタン自動表示、ボタン 64×64、pointerdown で moveLeft=true・aria-pressed=true、pointerup で解除。
  - 390×844 モバイル: レイアウト追従・横スクロールなし・GAME OVER 画面が収まる。
  - Lighthouse（mobile/navigation）: Accessibility **98** / Best Practices **100** / SEO **100** / Agentic Browsing **100**（44 passed / 1 failed）。
- 未実施テスト: 412×915・740×360・844×390・1024×768 等の追加 viewport 目視は代表値（360 系/390/横画面 CSS）で代替。実機での A2HS（ホーム追加）インストールは未実施（manifest/SW/アイコンは満たす）。
- 既知の制限:
  - Lighthouse の唯一の失敗は `heading-order`（タイトル画面の `<h1>`→リーダーボード `<h3>` の見出し階層スキップ・Phase 1 からの既存事項）。Accessibility は 98。見出し階層の全画面再編は影響が大きいため本フェーズでは未変更。
  - ヘッドレス環境では `window.innerWidth` が 390 を反映しない計測クセがあったが、実描画とスクリーンショットは 390 幅で正しく追従。
- 次に再開する場所: Phase 13（匿名分析・バランス管理）着手から。

---

## Phase 13：匿名分析・バランス管理

- 状況: **完了**
- 新規ファイル:
  - `js/config/balance-presets.js`（`BALANCE_VERSION` + 既定 preset。現在値=config を参照して移行）
  - `js/model/balance.js`（選択中 preset と版数の単一参照点）
  - `js/model/analytics.js`（同意・payload 構築・端末/PWA 判定。gameState 非参照）
  - `js/services/analytics-service.js`（送信のみ・未配備/オフライン/重複/失敗で安全スキップ）
  - `supabase/functions/_shared/analytics-validation.js`（純粋検証・Deno/Node 共有）
  - `supabase/functions/submit-analytics/index.ts`（service_role・検証・重複409・レート429・training400）
  - `supabase/migrations/20260628120000_gameplay_analytics.sql`（RLS・CHECK・public SELECT 禁止・event_id 一意・生 IP 列なし）
  - `docs/ANALYTICS_QUERIES.sql` / `docs/ANALYTICS_PRIVACY.md` / `docs/BALANCE_GUIDE.md` / `docs/PWA_GUIDE.md`
- 変更ファイル:
  - `js/config.js`（`ANALYTICS_CONSENT_STORAGE_KEY` / `ANALYTICS_MODES`）
  - `js/state.js`（`gameState.deathCause` + reset）
  - `js/controller/game-loop.js`（deathCause 記録・onRunComplete サマリ拡張・durationMs 共有）
  - `js/main.js`（分析同意トグル・1プレイ1件送信・balance 表示）
  - `index.html`（同意トグル+説明・Training にバランス表示）
  - `style.css`（`.option-note` / `.balance-info`）
  - `scripts/verify.mjs`（Phase 13 テスト 12 件追加）
- 実装内容:
  - 同意: 初期 OFF（`cyberRunnerAnalyticsConsent`）。明示同意でのみ ON・いつでも撤回可。拒否でも全機能利用可。
  - 送信: 1プレイ終了時に最大1件。Training/Replay は送らない（onRunComplete は !Training・Replay は通らない）。オフライン/未配備は送らない。失敗してもゲームへ影響せず、無断再送しない（event_id 二重送信防止）。
  - 収集項目: event_id / game_version / balance_version / mode / score / duration_ms / reached_level / max_combo / core_count / near_miss_count / dash_count / death_cause / wave_reached / boss_reached / boss_defeated / powerups_collected / pwa_mode / device_class（created_at はサーバー側）。個人情報項目（player_name/IP/user_id/run_id 等）は含めない・検証で拒否。
  - Supabase: テーブルは RLS 有効・policy なし（service_role のみ書込）・public SELECT 禁止・各数値 CHECK・mode/death_cause/device_class/pwa_mode 許可値制約・event_id 一意・生 IP 列なし（レート制限用に salt 付き `ip_hash` のみ）。Edge Function は service_role を環境変数のみ・training400/検証422/重複409/レート429/DB障害500・秘密非ログ。**本番適用・deploy・INSERT は行わない**。
  - バランス: `BALANCE_VERSION=1.0.0`。既定 preset は現在値（config）を移行＝挙動不変。選択中 preset を `model/balance.js` から単一参照。各プレイの分析へ balance_version を記録。ランキング影響変更は版を上げ BALANCE_GUIDE.md に明記。本番向け preset 選択 UI は追加せず、Training で版を確認可能。
- 自動テスト結果: `npm test` / `npm run verify` = **Total 107 / Passed 107 / Failed 0**（既存95 + Phase13 12件）。`git diff --check` clean。
- ブラウザ確認結果（Chrome DevTools MCP）:
  - SW/キャッシュを破棄して最新コードを再ロード→ console エラー 0。
  - 同意トグル: 既定 OFF、ON→`hasConsent()=true`、撤回→`false`、説明文表示。
  - バランス表示: `BALANCE v1.0.0 (DEFAULT (current))`。
  - 未配備（EDGE_FUNCTIONS_BASE 空）のため分析リクエストは発生しない（service が安全スキップ）。
- 未実施テスト: submit-analytics の本番 deploy / migration 適用 / 実 INSTERT は仕様により未実施（コードと手順のみ）。実 Edge Function の HTTP 応答（409/422/429/500）は Node の純粋検証＋静的契約テストで代替。
- 既知の制限:
  - 分析送信は EDGE_FUNCTIONS_BASE 未設定のため現状クライアントからは送られない（同意・payload・検証・送信経路は実装/テスト済み。配備後に有効化）。
  - レート制限は salt 付き `ip_hash`（生 IP 非保存）。salt は環境変数（フロント非混入）。
- 次に再開する場所: 全 Phase 完了。ドキュメント整備と最終確認のみ。

---

## Codex 指摘対応（Phase 11–13 レビュー）

> Codex レビューで挙がった 7 件。API 切断で中断したため作業ツリーを破棄せず、同一ブランチ
> `feature/phase11-13-game-expansion` の既存変更から再開し、未完了箇所のみ継続した。
> 状況確認の結果、7 件はコード実装・テストともに切断前に完了済みであり、作り直しは行わず
> 検証のみを実施した。検証用テストは `scripts/verify.mjs` に severity 別（H / M / L）で常駐。

| # | 指摘 | 対応 | 検証テスト | 状況 |
|---|------|------|-----------|------|
| 1 | sw.js の削除対象を Cyber Runner 専用 cache prefix へ限定 | `CACHE_PREFIX = 'cyber-runner-cache-'`。activate は `k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME` のみ削除 | H-1〜H-4 | **完了** |
| 2 | タッチ操作表示を AUTO／ON／OFF の三状態 UI へ変更 | `<select id="optTouchControls">`（auto/on/off）。options-view が select値↔モデル値(auto/true/false)を相互変換、options.js が三状態を検証、既定 `'auto'` | M1-1〜M1-7 | **完了** |
| 3 | 横画面の操作 UI を左右端へ分離し Canvas 中央を確保 | `.touch-left-group`（左右移動＝左端）/`.touch-right-group`（ダッシュ・一時停止＝右端）、`justify-content:space-between`。`@media (orientation: landscape) and (max-height:480px)` で縦並び・中央寄せ、最小 44px 維持 | M2-1〜M2-3 | **完了** |
| 4 | Wave／Boss／Event を active balance preset の単一参照元へ統一 | waves/bosses/wave-controller は config 定数を直接 import せず `model/balance.js` のアクセサ（`getWaveDurationBase`/`getBossBaseHp`/`getFirewallAttackIntervalBase`/`getEventIntervalSec`）経由。移動した定数は `config/balance-presets.js` が正本。**再レビューで残った演出/休憩/警告/撃破時間・worm/gate 攻撃間隔・Hardcore 補正も preset へ集約（下記「Codex 再レビュー対応」）** | M3-1〜M3-6 / M3b-01〜M3b-10 | **完了** |
| 5 | endGame() を run 単位で冪等化 | 先頭に `if (loopState.ended) return; loopState.ended = true;`（副作用より前）。`loopState.ended` は state.js で false 初期化、START/RETRY の resetAllState で解除。Time Attack FINISH も同経路 | M4-1〜M4-7 | **完了** |
| 6 | analytics rate limit 確認失敗時を fail-closed へ変更 | レート判定 SELECT が `rlErr` のとき INSERT せず 503（Retry-After:60）。INSERT より前に返す。応答に秘密・詳細を含めない。クライアントは 5xx で再送しない | L1-1〜L1-4 | **完了** |
| 7 | Replay 分析をサーバー側で明示的に 400 拒否 | `replay`/`ghost`/`run_id` 検出時に `code:"analytics_not_allowed_for_replay"` 付き 400。generic 検証(422)より前、Training 400 拒否は不変 | L2-1〜L2-3 | **完了** |

### 再開時の状況確認（コード非変更で実施）
- `git status --short -uall`：既存 17 ファイル変更 + Phase 11–13 新規ファイル（未追跡）を保持。commit/push/merge 未実施。
- `git diff --stat`：17 files / +1723 −36。`git diff --check`：異常なし（exit 0）。
- `.claude/`：`settings.local.json` と `settings.local.json.bak` のみ。いずれも gitignore 済み（`git ls-files .claude` 空）＝ローカル専用設定。リポジトリへは含めない。
- 途中切れ／混入：本ファイル末尾に前回中断由来のツール用マークアップ（`</content>` `</invoke>` の 2 行）が混入していたため除去。他ファイルへの波及なし（リポジトリ全体を grep して確認）。

### 最終検証結果
- `npm test` / `npm run verify`：**Total 141 / Passed 141 / Failed 0**（Phase 11–13 の 107 + Codex 対応 34）。`git diff --check` 異常なし。
- 構文確認：JS/MJS 全 53 ファイル `node --check` OK。共有 `analytics-validation.js` は実ロード可・全 export 解決。`submit-analytics/index.ts` は波括弧 37/37・末尾正常（import 先 `cors.ts` 存在）。
- 静的解析（js/ 51 モジュール）：循環依存なし／import-export 不整合なし／未使用 import なし。
- TypeScript 静的確認：Deno 専用 API（`Deno.serve`/`Deno.env`）＋リモート import を含み tsc/deno 未導入のため、共有 .js の node 実行＋verify.mjs の .ts ソース契約テストで代替（フル型チェックは配備環境で実施）。
- ブラウザ確認（`python -m http.server` + Chrome DevTools）：ロード／リロードとも console エラー・未処理例外 0。
  - viewport（横スクロール `scrollWidth-clientWidth`＝0 を全件確認）：360×640 / 390×844 / 412×915 / 740×360 / 844×390 / 1024×768。
  - landscape-short media query：844×390・740×360 で適用、640/768/844/915 高では非適用（1024×768 desktop で非適用を確認）。
  - 横画面（844×390）：左右グループが column 縦並び・左端 10px／右端 25px・Canvas 中央 gap 689px・ボタン 48×44（≥44）。
  - 操作ボタン設定の保存・復元：select on→true / off→false / auto→'auto' を `cyberRunnerOptions` へ保存、reload 後に select が復元（off→'off'）。
  - ※ ヘッドレス環境は最小幅 ~500px にクランプされるため 360/390/412 幅は 500 と計測される既知のクセあり（横スクロール無し・構造は維持を確認）。
- 未実施（仕様上の禁止事項）：本番 migration 適用 / Edge Function deploy / 本番 analytics INSERT。実 Edge Function の HTTP 応答（400/409/422/429/500/503）は純粋検証＋静的契約テストで代替。

### Codex 再レビューへの可否（初回ラウンド）
- 上記のとおり 7 件はコード・テスト・ブラウザ確認まで完了し、回帰（全 141 件）も green。**Codex 再レビューへ進められる状態**。
- ただし commit/push は本依頼の禁止事項のため未実施。再レビュー用に差分を共有する場合は、別途ユーザー承認の上で commit/push する。

---

## Codex 再レビュー対応（Medium 1 件：active preset の単一正本化の徹底）

> 初回 7 件は解消済み。再レビューで唯一残った Medium は「active balance preset が
> Wave／Boss／Event 設定の **完全な** 単一正本になっていない」。`wave-controller.js` と
> `bosses.js`（および `boss-view.js` / `waves.js` / `random-events.js`）が一部の Phase 11
> バランス値を `config.js` から直接参照しており、preset を経由していなかった。
> 他の解消済み 6 件は作り直さず、本件のみ最小修正した。

### 原因
- 初回対応では Wave 時間・ボス HP・Firewall 攻撃間隔・イベント間隔のみを preset へ集約した。
  演出/休憩/警告/撃破時間・Data Worm/Security Gate の攻撃間隔・Hardcore 補正は
  consumer 側が `config.js` を直接 import したままで、preset の網羅範囲外だった。

### 修正（preset へ集約した値）
- `js/config/balance-presets.js`：既定 preset に以下を追加（**config 現在値を参照＝数値の複製なし**）。
  `waveIntroDuration` / `waveOutroDuration` / `waveIntermissionDuration` /
  `bossWarningDuration` / `bossDefeatDuration` / `eventDuration` /
  `bossWormAttackInterval` / `bossGateAttackInterval` /
  `hardcoreWaveFactor` / `hardcoreBossIntervalFactor`。
- `js/model/balance.js`：上記を返す単一参照アクセサを追加（`get*`）。Model は DOM/Canvas 非操作。
- 参照経路（config 直接 import を除去し balance アクセサへ）:
  - **Wave**：`waves.waveDurationSec` は `getWaveDurationBase()`×`getHardcoreWaveFactor()`。
    `wave-controller` の intro/outro/intermission は
    `getWaveIntroDuration()`/`getWaveOutroDuration()`/`getWaveIntermissionDuration()`。
  - **Boss**：`bosses.createBoss` は HP=`getBossBaseHp()`、攻撃間隔=`getFirewallAttackIntervalBase()`/
    `getWormAttackIntervalBase()`/`getGateAttackIntervalBase()`、Hardcore は
    `getHardcoreBossIntervalFactor()`。`wave-controller`/`boss-view` の警告/撃破時間は
    `getBossWarningDuration()`/`getBossDefeatDuration()`。
  - **Event**：効果時間は `controller`/`random-events` ともに `getEventDurationSec()`、間隔は `getEventIntervalSec()`。
- `js/config.js`：Phase 11 バランス定数は **1 箇所のみで定義**し、preset がそれを参照（二重定義なし）。
  consumer は config から直接 import しない旨をコメントで明記。

### 不変性・整合
- 数値は修正前から不変（`M3b-08` が現在値＝config 値と一致を固定）。挙動・スコア・XP・analytics 仕様は変更なし。
- `balance_version` は実使用 preset の version と一致（`analytics.buildPayload` が `model/balance.js` の
  同一 active preset を参照。`M3b-09` で固定）。
- Training の一時選択は通常モードの `initWaveSystem()` の `resetPreset()` で既定へ復元（`M3b-10`）。

### 追加テスト（既存 141 を維持し +10）
- `M3b-01`〜`M3b-10`：intro/outro/intermission・警告/撃破・event 効果時間・worm/gate 攻撃間隔・
  Hardcore 補正が active preset 由来であること、Phase 11 consumer が移動定数を直接 import しないこと
  （静的走査で再発検知）、config との二重定義がないこと、balance_version 一致、Training 復元、数値不変。

### 検証結果
- `npm test` / `npm run verify`：**Total 151 / Passed 151 / Failed 0**（既存 141 + 再レビュー 10）。`git diff --check` 異常なし。
- 構文確認：変更 JS/MJS 全 `node --check` OK。循環依存なし／import-export 整合／未使用 import なし（verify の `04`/`03`/`C-04`）。
- Phase 11 consumer の config 直接参照検索：**0 件**（config.js / balance-presets.js を除く）。各定数の `export const` 定義は **config.js のみ 1 件**。
- ブラウザ確認（`http://localhost:8127` + Chrome DevTools MCP・主要 1 プレイ）：
  START→Wave1（intro→active→outro→intermission 進行）→Training ボス表示（Firewall HP 6/6・攻撃間隔 2.6＝preset 由来）→
  ESC で pause（`waveState.phaseTime`/`gameState.gameTime` 凍結）→ESC で resume（再進行）→RETRY（preset が default へ復元）。
  全操作で **console エラー・未処理例外 0**。
- 未実施（禁止事項）：commit/push/merge、本番 migration 適用、Edge Function deploy、本番 INSERT。

### Codex 再レビューへの可否（3-bis ラウンド）
- 残 Medium 1 件をコード・テスト・ブラウザ確認まで完了。回帰（全 151 件）green。**Codex 再レビューへ進められる状態**。
- commit/push は本依頼の禁止事項のため未実施。

---

## Codex 最終レビュー対応（Medium 3-ter：Phase 11 全 gameplay 値の単一正本化）

> 3-bis で主要な時間/HP/間隔を preset へ集約したが、最終レビューで「Phase 11 の一部
> gameplay／balance 値を consumer が引き続き `config.js` から直接 import している」と指摘。
> 本ラウンドはこの残りをすべて preset 経由へ統一した（解消済みの他指摘は作り直さない）。

### 原因
- 3-bis では「時間・HP・代表的な攻撃間隔・Hardcore 補正」のみを移行していた。
  サイクル係数・spawn 補正・ウェーブ/ボス順序・供給/警告間隔・cooldown・移動速度・同時上限・
  回避幅・イベント倍率/出現率/初回待機/警告が consumer の `config.js` 直接 import のまま残っていた。

### 抽出した config 直接 import（Phase 11 consumer・分類）
- **balance 対象（preset へ移行＝19 値）**：
  `WAVE_SEQUENCE` / `WAVE_SPAWN_BOOST` / `CYCLE_DIFFICULTY_STEP` / `CYCLE_BOSS_HP_STEP` /
  `BOSS_SEQUENCE` / `BOSS_FIREWALL_CORE_INTERVAL` / `BOSS_FIREWALL_MAX_LASERS` / `BOSS_FIREWALL_SAFE_WIDTH` /
  `BOSS_WORM_ATTACK_WARNING` / `BOSS_WORM_HIT_COOLDOWN` / `BOSS_WORM_SPEED` / `BOSS_WORM_MAX_MINIONS` /
  `BOSS_GATE_MIN_GAP` / `EVENT_FIRST_DELAY_SEC` / `EVENT_WARNING_SEC` / `EVENT_CORE_RUSH_MULT` /
  `EVENT_HIGH_SPEED_MULT` / `EVENT_LASER_STORM_RATE` / `EVENT_LASER_STORM_MAX`。
- **balance 対象外（表示/幾何・config に残す＝allowlist）**：
  `CANVAS_WIDTH` / `CANVAS_HEIGHT`（フィールド寸法）、`LASER_WIDTH`（Phase 4 entity 帯幅）、
  `BOSS_WORM_WIDTH` / `BOSS_WORM_HEIGHT`（worm 描画サイズ）、`BOSS_BAR_MARGIN`（HP バー余白）。
  判定基準は「難易度・進行・回避可能性・倍率・出現率・上限に影響するか」。曖昧は balance 側。
  ※ `game-loop.js`/`difficulty.js`/`entities.js` は Phase 1〜5 基盤のため本 preset の対象外。

### 修正（参照経路の統一）
- `config/balance-presets.js`：上記 19 値を既定 preset に追加（**config 現在値を参照＝数値の複製なし**）。
- `model/balance.js`：`active()`（生参照・不正 preset は既定へフォールバック）を導入し、全アクセサを
  これ経由に統一（毎フレーム呼ばれる `getCycleDifficultyStep` 等の不要な複製を回避）。新規アクセサ
  `getWaveSequence`/`getWaveSpawnBoost`/`getCycleDifficultyStep`/`getCycleBossHpStep`/`getBossSequence`/
  `getFirewallCoreAttackInterval`/`getFirewallMaxLasers`/`getFirewallSafeWidth`/`getWormAttackWarningDuration`/
  `getWormHitCooldown`/`getWormSpeed`/`getWormMaxMinions`/`getGateMinGap`/`getEventFirstDelay`/
  `getEventWarningDuration`/`getCoreRushMultiplier`/`getHighSpeedMultiplier`/`getLaserStormRate`/`getLaserStormMax`。
- consumer：`waves.js`（順序・サイクル係数）/ `bosses.js`（順序・HP 係数・供給/警告間隔・安全幅）/
  `random-events.js`（倍率）/ `wave-controller.js`（spawn 補正・上限・速度・cooldown・最小幅・イベント初回/警告/storm）/
  `boss-view.js`（安全幅）から該当 config import を除去し balance アクセサへ。`BOSS_DEFS` は型/名称/ヒントのみへ。
- `waves.js` / `random-events.js` は config 直接 import が **0** に。他 consumer は表示定数のみ。

### verify 静的検査の強化（M3b-06 を実態へ）
- 旧 M3b-06（移行済み定数の再発検知）を、**Phase 11 consumer 全件 × 表示定数 allowlist** 方式へ刷新。
  各 consumer の `config.js` 直接 import が `PHASE11_DISPLAY_ALLOWLIST`（6 表示定数）に含まれなければ
  すべて offender として失敗。これにより「未分類の config 直接 import が増えたら失敗」を保証。
  `M3c-10` は allowlist 判定ロジック自体の自己テスト。

### 不変性・整合・復元
- 数値は修正前から不変（`M3c-09` が active preset 値 == 定義元 config 値を固定）。挙動・スコア・XP・
  analytics 仕様は不変。`balance_version` は実使用 active preset の version と一致（`M3b-09`）。
- Training の一時選択は通常モード `initWaveSystem()` の `resetPreset()` で既定へ復元（`M3b-10`/`M3c-11`）。

### 追加テスト（既存 151 を維持し +11）
- `M3c-01`〜`M3c-11`：サイクル難易度/HP 係数・spawn 補正/順序・Firewall 供給/上限/安全幅・Worm 警告/cooldown/
  速度/上限・Gate 最小幅/ボス順序・イベント初回/警告・CORE RUSH/HIGH SPEED 倍率・LASER STORM rate/max が
  preset 由来であること、数値不変、allowlist 自己テスト、resetPreset 復元。`M3b-06` も全件 allowlist 監査へ強化。

### 検証結果
- `npm test` / `npm run verify`：**Total 162 / Passed 162 / Failed 0**（既存 151 + 3-ter 11）。`git diff --check` 異常なし。
- 構文確認：変更 JS/MJS 全 `node --check` OK。循環依存なし／import-export 整合／未使用 import なし（verify `04`/`03`/`C-04`）。
- 直接 import 検索：Phase 11 consumer の balance 対象 config 直接 import は **0 件**（残るのは表示定数 allowlist のみ）。
  35 個の Phase 11 balance 定数はいずれも `export const` 定義が **config.js のみ 1 件**（二重定義なし）。
- ブラウザ確認（`http://localhost:8127` + Chrome DevTools MCP・主要 1 プレイ）：
  START→Wave 進行（intro→active）→サイクル補正（`waveSpeedBonus = cycleDifficultyBonus(3) = 0.24`）→
  Training Event 開始（CORE RUSH で `eventCoreMult=3`＝preset 由来）→Training ボス表示（Firewall HP 6/6・
  供給間隔 1.6・攻撃間隔 2.6＝preset 由来）→ESC pause（時間凍結）→ESC resume（再進行）→RETRY（preset が default へ復元）。
  全操作で **console エラー・未処理例外 0**。
- 未実施（禁止事項）：commit/push/merge、本番 migration 適用、Edge Function deploy、本番 INSERT。

### Codex 最終レビューへの可否（本ラウンド）
- 残 Medium 1 件をコード・テスト・ブラウザ確認まで完了。回帰（全 162 件）green。**Codex 最終レビューへ進められる状態**。
- commit/push は本依頼の禁止事項のため未実施。
