# Phase 6〜10 実装進捗（再開用）

> このファイルは「途中停止しても同じ作業ツリーから再開できる」ための単一の基準です。
> 各 Phase 完了時に追記します。**commit/push/merge は行いません**（既存変更は破棄しない）。

## 基本情報

- 作業ブランチ: `feature/phase6-10-platform-expansion`
- 作業開始時 commit hash: `1fb26a2c15c898e8ccfbcba9c5fd6ba242616650`
  （= `feat: add Phase 1-5 gameplay expansion`）
- ⚠️ **重要な前提のずれ**: 指示では「Phase 1〜5 は main へマージ済み」とあったが、
  実際の `main`（`4368e22`）には Phase 1〜5 が**含まれていない**。Phase 1〜5 は
  `feature/phase1-5-gameplay-expansion`（`1fb26a2`）にのみコミット済み。
  Phase 6〜10 は Phase 1〜5 の上に積む必要があるため、本ブランチは **`main` ではなく
  `1fb26a2`（Phase 1〜5 tip）から分岐**した。これは Phase 1〜5 を維持するための唯一の選択。
  （ローカルブランチ作成のみ。push/merge はしていないため完全に巻き戻し可能。）

## 再開手順（停止後）

1. `git status` で作業ツリーの未コミット変更を確認（破棄しない）。
2. 本ファイルの「Phase 別状況」で最後に完了した Phase と「次に再開する箇所」を確認。
3. `npm test` を実行し、現状のグリーン範囲を把握。
4. 「次に再開する箇所」から実装を継続。

## 進捗サマリ

| Phase | 内容 | 状況 |
|---|---|---|
| 事前確認 | ブランチ/clean/baseline test | ✅ 完了 |
| 6 | ランキング強化・不正対策 | ✅ 完了 |
| 7 | ゲームモード | ✅ 完了 |
| 8 | 成長・カスタマイズ | ✅ 完了 |
| 9 | デイリー/ウィークリーチャレンジ | ✅ 完了 |
| 10 | ゴースト/リプレイ/共有 | ✅ 完了 |
| テスト/ドキュメント | verify 拡張・docs 更新・ブラウザ確認 | ✅ 完了 |

---

## Phase 別状況

### 事前確認 — ✅ 完了
- ブランチ `feature/phase6-10-platform-expansion`（`1fb26a2` 起点）。
- `git status` clean。
- Phase 1〜5 機能ファイル存在を確認。
- `npm test` / `npm run verify` = 19/19 PASS。
- `index.html` は `./js/main.js` を module 読み込み。
- 次に再開する箇所: Phase 6 実装。

### Phase 6 — ✅ 完了
- 新規ファイル:
  - `supabase/migrations/20260627090000_secure_leaderboard.sql`
  - `supabase/functions/_shared/cors.ts`, `supabase/functions/_shared/score-validation.js`
  - `supabase/functions/start-run/index.ts`, `submit-score/index.ts`, `challenges/index.ts`
  - `js/services/run-service.js`, `js/services/challenge-service.js`
  - `docs/SUPABASE_SECURE_LEADERBOARD_SETUP.md`
- 変更ファイル:
  - `js/config.js`（Phase 6-10 定数追加：EDGE_FUNCTIONS_BASE 等）
  - `js/services/leaderboard.js`（直接 INSERT 廃止 → Edge Function 経由 / period・mode クエリ / 自分の順位）
  - `js/util/storage.js`（loadString/saveString 追加）
  - `js/state.js`（mode 等のモード関連フィールド）
  - `js/model/scoring.js`（modeMultiplier。既定1で Phase1-5 不変）
  - `js/model/difficulty.js`（difficultyMultiplier。既定1で不変）
  - `js/controller/game-loop.js`（startRun 配線 / endGame に duration・metrics・runId / FINISH / Training ガード）
  - `js/view/screens.js`（FINISH/GAME OVER 見出し・モード表示）
  - `js/view/leaderboard-view.js`（setMyRankText / setScoreSubmitVisible）
  - `js/main.js`（ランキングフィルタ配線）
  - `index.html` / `style.css`（フィルタ UI・FINISH 見出し）
  - `scripts/verify.mjs`（Phase 6 テスト追加・旧 直接INSERT テスト置換）
- 実装内容: サーバー権威 run（start-run）→ submit-score 経由送信のみ（直接 INSERT 廃止）。
  score-validation を Node/Deno 共有。RLS で client INSERT 不可・SELECT 公開・legacy 保持の
  非破壊 migration。overall/daily/weekly + mode 取得。Edge Function 未配備時はローカル run で継続し
  「安全メッセージ」表示。**本番は未適用（リポジトリ生成のみ）**。
- テスト結果: `npm test` = 27/27 PASS（P6-11〜P6-18 + submit payload）。
- 未解決事項: 「自分の順位（fetchMyRank）」は PostgREST count に依存する best-effort（失敗時は非表示）。
- 次に再開する箇所: Phase 7（game-modes.js / mode-select-view.js とモード適用配線）。

### Phase 7 — ✅ 完了
- 新規ファイル: `js/model/game-modes.js`, `js/view/mode-select-view.js`
- 変更ファイル: `js/controller/game-loop.js`（applyModeToState 配線 / モード別 powerup 重み /
  spawnTrainingPowerup / Training パネル表示）, `js/main.js`（モード選択配線）,
  `index.html`（モード選択 UI・Training パネル）, `style.css`。
  ※ 状態・ループ・スコア・難易度の土台は Phase 6 で先行追加済み。
- 実装内容: Endless（既存維持）/ Time Attack（60秒 FINISH）/ Hardcore（高速・x1.5・シールド無し・
  パワーアップ制限）/ Training（無敵・速度・障害物選択・パワーアップ確認・記録/送信/XP なし）。
  resetState→applyModeToState でモード切替時に完全リセット。
- テスト結果: `npm test` = 33/33 PASS（P7-19〜P7-24 含む）。Endless 回帰なし（既存 7〜17 PASS）。
- 未解決事項: -
- 次に再開する箇所: Phase 8（progression.js / cosmetics.js / profile-view / cosmetics-view + 配線）。

### Phase 8 — ✅ 完了
- 新規ファイル: `js/model/progression.js`, `js/model/cosmetics.js`,
  `js/view/profile-view.js`, `js/view/cosmetics-view.js`
- 変更ファイル: `js/model/entities.js`（Player.draw に style / Particle に colorOverride・視覚のみ）,
  `js/view/renderer.js`（player style + 移動軌跡）, `js/controller/game-loop.js`（コア取得エフェクト /
  onRunComplete サマリ拡張）, `js/view/screens.js`（profile/cosmetics/challenges オーバーレイ）,
  `js/main.js`（成長/外観 配線・run 完了ハンドラ・challengeHooks 注入口）, `index.html`, `style.css`。
- 実装内容: XP/レベル（ゲームスコアと分離）+ 累計統計 + モード別ベスト。外観（カラー6/発光3/軌跡3/
  コアエフェクト3/称号）は**視覚のみ**で性能不変。解放は初期/レベル/実績/チャレンジ。破損時は既定値で起動。
  Training は XP/記録なし（controller ガード）。
- localStorage キー: `cyberRunnerProfile` / `cyberRunnerProgress` / `cyberRunnerCosmetics`。
- テスト結果: `npm test` = 37/37 PASS（P8-25〜P8-31）。
- 未解決事項: challenge 連携は Phase 9 で `setChallengeHooks` 経由で注入（現状は no-op フォールバック）。
- 次に再開する箇所: Phase 9（challenges.js / challenges-view + main の challengeHooks 実装）。

### Phase 9 — ✅ 完了
- 新規ファイル: `js/model/challenges.js`, `js/view/challenges-view.js`
- 変更ファイル: `js/controller/game-loop.js`（run サマリに maxCombo/dashCount/shieldUsed/reachedLevel 追加）,
  `js/main.js`（challenges 読込・取得・描画・challengeHooks 注入）, `index.html`, `style.css`。
- 実装内容: 全ユーザー共通 seed（mulberry32）でデイリー3/ウィークリー2を決定的生成。進捗保存・
  報酬重複防止（claimed）・期間（日付/週）変更で再生成。サーバー時刻権威（challenges Edge Function）、
  未配備時はローカル UTC フォールバック（isFallback で内部判別）。報酬は XP/外観解放（スコア加点なし）。
  pause 中・Training は進捗しない。
- localStorage キー: `cyberRunnerChallenges`。
- テスト結果: `npm test` = 42/42 PASS（P9-32〜P9-38）。
- 未解決事項: PC 時刻変更の完全防止はサーバー seed 利用時のみ（UI に明記）。
- 次に再開する箇所: Phase 10（indexed-db.js / replay.js / replay-view / share-view + 配線）。

### Phase 10 — ✅ 完了
- 新規ファイル: `js/util/indexed-db.js`, `js/model/replay.js`,
  `js/view/replay-view.js`, `js/view/share-view.js`
- 変更ファイル: `js/model/entities.js`（既に Phase 8 で視覚拡張済み）,
  `js/view/renderer.js`（半透明ゴースト描画・当たり判定なし）, `js/controller/game-loop.js`
  （ゴースト記録/サンプリング・結果カードデータ・ベストゴースト読込）, `js/view/screens.js`
  （replay オーバーレイ）, `js/main.js`（自己ベスト時ゴースト保存・リプレイ/共有配線）, `index.html`, `style.css`。
- 実装内容: 固定間隔（0.1s）でプレイヤー位置をサンプリングし、自己ベスト更新時のみ IndexedDB へ保存。
  通常プレイ中は半透明ゴースト表示（ON/OFF・当たり判定なし・モード別）。旧バージョン記録は再生不可/警告。
  簡易リプレイ（再生/停止/最初から/1x・2x・専用 RAF・state 分離・送信不可）。Canvas 結果カード
  （CYBER RUNNER/SCORE/RANK/MAX COMBO/MODE/TITLE/PLAYER LEVEL）→ PNG ダウンロード + 共有文コピー
  （外部画像/CDN なし・個人情報なし）。IndexedDB 例外時もゲーム継続。
- IndexedDB: DB `cyberRunnerReplays` / store `ghosts`（key = mode）。
- テスト結果: `npm test` = 53/53 PASS（P10-39〜P10-46 + 共通 C-04〜07 + 回帰 R-47〜54）。
- ブラウザ確認: `py -m http.server 8126` + Chrome DevTools MCP で
  START/プレイ/スコア加算/GAME OVER/RETRY/pause・resume/BACK TO TITLE/
  PROFILE・COSMETICS(19)・CHALLENGES(5) オーバーレイ/結果カード PNG/モード切替を確認。
  **Console 例外・警告ゼロ**（leaderboard GET 回帰なし。favicon 404 も inline icon で解消）。
- 既知の問題: 後述「既知の問題」を参照。
- 次に再開する箇所: なし（全 Phase 完了）。

---

## 最終検証（再開セッション・2026-06-28）

セッション上限で中断していた「最終テスト・ドキュメント・ブラウザ確認」を、作業ツリーを破棄せず
同一ブランチで再開して実施した結果。**コード変更は行わず（docs のみ更新）、git add / commit / push / merge、
本番 Supabase への migration・deploy・INSERT は一切なし。**

| 検証 | 結果 |
|---|---|
| `npm test` / `npm run verify` | ✅ 53/53 PASS（VERIFY OK） |
| 全 JS/MJS 構文（`node --check` ×38） | ✅ エラー 0 |
| import/export 整合・未使用 import | ✅ 問題 0（静的解析 + 既存 C-04） |
| 循環依存 | ✅ 0（DFS 検出） |
| `git diff --check`（空白/競合マーカー） | ✅ 異常 0 |
| service_role のフロント混入 | ✅ なし（コメントでの言及のみ。Edge Function は `Deno.env` から取得） |
| 直接 INSERT の有無 | ✅ フロントに `.insert(` なし |
| ブラウザ smoke（Chrome DevTools / `http://127.0.0.1:8127`） | ✅ Console 例外 0（後述の getImageData 警告は検証スクリプト由来） |
| 60 秒以上の連続プレイ | ✅ Training 無敵で約 100 秒、Lv12 まで、例外 0 |
| ネットワーク（本番 Supabase） | ✅ GET のみ 3 件（200）。POST/INSERT 0。テーブルは `[]`（空） |

- ブラウザ確認の内訳: タイトル UI（4 モード / PROFILE / COSMETICS / CHALLENGES / REPLAY / ゴースト表示）、
  PROFILE（LV・XP・統計・モード別ベスト）、CHALLENGES（DAILY 3 / WEEKLY 2 + ローカル時刻フォールバック表記）、
  COSMETICS（5 カテゴリ 19 種・未解放は disabled）、ENDLESS プレイ → GAME OVER（スコア・ランク・称号・
  最大コンボ・OVERALL/DAILY/WEEKLY タブ・All Modes フィルタ）、SEND SCORE（safe message・POST なし）、
  RESULT CARD（600×315 canvas に描画確認）、REPLAY（IndexedDB ゴースト保存＋再生確認）、Training 100 秒連続。
- リーダーボード GET の挙動: 既存 4 列 select は 200。`created_at` フィルタ（daily/weekly 相当）も 200。
  一方 `mode=eq.x`（モード絞り込み）は **400**（`42809`: `mode` は PostgreSQL の予約集約名のため。
  本番に `mode` 列が無い＝migration 未適用を裏付け）→ クライアントは safe message にフォールバック。
- Console の唯一の出力は `Canvas2D: ... willReadFrequently` 警告で、**検証用 `getImageData` 呼び出し由来**
  （ゲーム本体の出力ではない）。

---

## 既知の問題 / 制限

- **本番 Supabase 未適用**: `mode` 列は migration 適用後にのみ存在する。クライアントの GET は
  既存4列のみ select するため未適用でも回帰なし。モード絞り込み（`mode=eq.x`）は migration 適用後に有効
  （未適用時は 400 → 安全メッセージにフォールバック）。Edge Functions も未配備のため、既定ビルドでは
  スコア送信不可（安全メッセージ表示）。`EDGE_FUNCTIONS_BASE` 設定 + deploy 後に有効化（レビュー後）。
- **「自分の順位」(fetchMyRank)** は PostgREST count に依存する best-effort。失敗時は非表示。
- **リプレイは MVP**: プレイヤー位置の再生のみ（障害物は再現しない）。決定論的完全再現は対象外。
  旧 `game_version` の記録は再生不可/警告。
- **PC 時刻変更の不正**: チャレンジはローカル UTC フォールバック時、PC 時刻変更で操作可能。
  完全防止は challenges Edge Function（サーバー seed）利用時のみ。
- **title-animation / replay は専用 RAF**: ゲームループ（`loopState.rafId`）とは別。互いに排他的に動作する
  （ゲーム中はタイトルアニメ停止、リプレイはオーバーレイ表示時のみ）。「単一 RAF」はゲームループに対する不変条件。
- **⚠ タイトル上部ボタン列のレイアウト崩れ（再開セッションで発見・未修正）**:
  `.title-buttons`（`style.css`）は `flex-wrap` 未指定（既定 `nowrap`）の中央寄せ flex 行。Phase 8〜10 で
  ボタンが 4 → 8 個（PROFILE / COSMETICS / CHALLENGES / REPLAY 追加）に増えた結果、行幅が約 2020px となり、
  ビューポート幅 < 約 2020px では行が左右にあふれ、**先頭の START ボタンが画面左外へはみ出す**（横スクロールしないと押せない）。
  1440px 実測で START の left = -298px。機能（JS）の不具合ではなく CSS の責務漏れ。
  同じ差分で他の 4 コンテナには `flex-wrap: wrap` が追加済みで、`.title-buttons` のみ漏れている。
  **修正案（1 行・未適用）**: `.title-buttons` に `flex-wrap: wrap;` を追加。スコープ外のため本セッションでは
  コード変更せず、Codex レビューで判断する。

## 未実施テスト（再開セッション 2026-06-28 で更新）

- 実 Supabase への submit-score 経由 INSERT（**本番未適用のため意図的に未実施**。再開セッションでも
  本番への書き込みは一切行っていない＝GET のみ・テーブルは空のまま）。
- 複数ブラウザ/モバイル実機でのクロスブラウザ検証（Chromium 1 種のみで確認）。
- Edge Functions（start-run / submit-score / challenges）の実デプロイ環境での E2E（本番未配備のため未実施）。

### 再開セッションで新たに検証できた項目（旧「未実施」から消化）

- **60 秒以上の連続プレイ**: Training（無敵 ON）で **約 100 秒以上** 連続稼働を実測。GAME OVER に
  ならず（`gameOver:false`）、レベルが Lv 1 → Lv 12 まで進行、Console 例外・unhandledrejection は **0 件**。
- **IndexedDB への実保存・再生**: ブラウザ実機で自己ベスト時にゴーストが `cyberRunnerReplays/ghosts`
  （key=`endless`, score=37, samples=37）へ **実保存されることを確認**。REPLAY オーバーレイで再生
  （canvas が毎フレーム更新）も確認。
- **直接 INSERT 廃止 / safe submit**: GAME OVER の SEND SCORE 押下で **POST/INSERT は発生せず**
  「Online ranking is not enabled in this build.」を表示（`EDGE_FUNCTIONS_BASE` 空のため）。

---

## Codex セキュリティ指摘 修正セッション（再開・2026-06-28）

> セッション上限で中断していた「Codex 最終レビュー指摘のセキュリティ修正」を、作業ツリーを破棄せず
> 同一ブランチで再開・検証した記録。**git add / commit / push / merge、本番 migration 適用・
> Edge Function deploy・本番 INSERT は一切なし。** 既存の完了機能の作り直しもしていない。

### 指摘 10 項目の状況（全 ✅ 実装・テスト済み）

| # | 指摘 | 実装場所 | テスト |
|---|---|---|---|
| 1 | submit-score の原子的スコア登録 | `submit_score_atomic()`（FOR UPDATE 単一Tx）+ submit-score が RPC 呼び出し | SEC-01 |
| 2 | 同一 run_id の二重送信拒否 | `already_submitted` + `leaderboard_run_id_uidx`（一意） | SEC-01/02 |
| 3 | INSERT 失敗時の run 消費防止 | INSERT 成功後にのみ `submitted=true`・例外で ROLLBACK | SEC-03 |
| 4 | 未知 INSERT/UPDATE/DELETE policy 撤去 | `pg_policies` 監査で名前非依存に全 DROP → SELECT のみ再作成 | SEC-07 |
| 5 | anon / authenticated 書き込み REVOKE | `revoke insert,update,delete` + RPC EXECUTE は service_role のみ | SEC-08 |
| 6 | start-run の永続レート制限 | `runs` テーブル由来の anon / salted IP hash 集計 → 429+Retry-After | SEC-09/10 |
| 7 | player_name の Unicode 制御文字検証 | `validatePlayerName`（`\p{Cc}\p{Cf}\p{Zl}\p{Zp}` 拒否・NFC・改行/タブ拒否） | SEC-11〜14 |
| 8 | ALLOWED_ORIGINS 方式 CORS | `_shared/cors-util.js`（許可リスト・ワイルドカード不使用）+ `cors.ts` | SEC-15/16 |
| 9 | ランキング GET 失敗時キャッシュ／空表示 | `cacheLeaderboard`/`readCachedLeaderboard`/`renderLeaderboardFallback`（throw しない） | SEC-17〜19 |
| 10 | セットアップ・ロールバック文書更新 | `SUPABASE_SECURE_LEADERBOARD_SETUP.md`（ALLOWED_ORIGINS / RATE_LIMIT_IP_SALT / 原子RPC / ロールバック） | — |

### 検証結果（このセッション）

| 検証 | 結果 |
|---|---|
| `npm test` / `npm run verify` | ✅ **73/73 PASS**（SEC-01〜20 を含む。前回 53 → +20 SEC） |
| 全 JS/MJS 構文（`node --check`） | ✅ 25 ファイル エラー 0 |
| TS（cors.ts / 3 Edge Function） | ⚠ deno 未導入で `node --check` 不可。SEC テストが構文・配線を正規表現で参照検証。全文読了で整合確認 |
| import/export 整合 | ✅ 全 named import が export に解決（38 モジュール） |
| 循環依存 | ✅ なし（DFS・38 モジュール） |
| 未使用 import | ✅ なし（C-04） |
| `git diff --check`（空白/競合マーカー） | ✅ 異常 0 |
| 秘密情報のフロント混入 | ✅ service_role はコメント言及のみ・Edge Function は `Deno.env`。`RATE_LIMIT_IP_SALT` 等の値なし。`.insert(` なし（SEC-20） |
| ブラウザ smoke（`http://127.0.0.1:8128`・Chrome DevTools） | ✅ Console 例外 0。タイトル UI / ENDLESS プレイ / GAME OVER / OVERALL・DAILY・WEEKLY / モードフィルタ / SEND SCORE 確認 |
| 本番 Supabase（GET のみ・読み取り専用） | ✅ 書き込み 0。SEND SCORE でも **POST/INSERT 不発**（GET 3 件・全 200） |

### 本番 Supabase の状態（読み取り専用 GET で確認）

- 既存 4 列クエリ（ゲームと同一）: **HTTP 200**。レガシー行が **3 件存在**（`めーぷる最強` S 8920/7049/7010）。
  これは Phase 1〜5 の**本番デプロイ版で実ユーザーが残した既存データ**であり、本セッションの書き込みではない
  （現ビルドは送信不可・直接 INSERT なし）。※ 前回記録の「テーブルは `[]`」はその時点のスナップショット。
- `mode=eq.endless` クエリ: **HTTP 400（code 42809）** = `mode` 列が存在しない → **migration 未適用**を裏付け。
  本番スキーマは未変更。クライアントはモード絞り込み失敗時に安全メッセージ／キャッシュへフォールバック。

### 未実施 / 制限（このセッションでも未実施）

- 本番への migration 適用・Edge Function deploy・submit-score 経由 INSERT（**意図的に未実施**。禁止事項）。
- 実デプロイ環境での E2E（429 / 409 / 422 / CORS の実 HTTP 応答）。純粋関数・配線レベルでは SEC テストで検証済み。
- クロスブラウザ／モバイル実機（Chromium 1 種のみ）。
- ⚠ タイトル上部ボタン列 `.title-buttons` の `flex-wrap` 欠落（既知・前セッション記載）は**未修正のまま**
  （スコープ外・1 行 CSS。Codex 判断に委ねる）。a11y ツリー上は全ボタン存在し JS 機能不具合はなし。

### 結論

Codex 指摘 10 項目はすべて実装・テスト済みで、コード変更を要する未完了箇所はなし。
**Codex 再レビューへ進行可能**。

---

## Phase 6 本番反映の準備（作業A・ブランチ `ops/phase6-supabase-production`）

> 実施日時: 2026-06-28。**本番操作（`db push` / `functions deploy` / `secrets set`）は未実行**。
> 承認ゲートで停止。commit/push/merge も未実施。

### この作業の前提・ブロッカー

- 作業ブランチ: `ops/phase6-supabase-production`（起点 commit `43aaa31`）。作業ツリー clean。
- `npm test` / `npm run verify` = **73/73 PASS**（baseline 維持）。
- **Supabase CLI がこの作業環境に未インストール**（`supabase: command not found`）。
- 本番適用は (1) CLI、(2) 人間の本番認証情報、(3) 承認ゲート（指示書の必須確認 8）を要するため、
  自動エージェントは実行不可。**準備物の作成＋承認ゲートでの停止**に限定した。

### 追加した準備物（コードの本番動作は変えない・ドキュメント/SQL のみ）

- 新規 `docs/PHASE_6_PRODUCTION_RUNBOOK.md`
  — link/diff/backup → 承認ゲート → `db push` → 適用後検証 → secrets → deploy → クライアント有効化
  → 正常系 6 + **異常系 9 ケース**（409/409/400/422/400/CORS/429/直接INSERT/直接RPC）の E2E チェックリスト。
- 新規 `scripts/supabase/preflight_capture.sql`（READ-ONLY・適用前の件数/ポリシー/権限を記録）。
- 新規 `scripts/supabase/post_apply_verify.sql`（READ-ONLY・適用後の DB 検証）。
- 新規 `scripts/supabase/rollback.sql`（手動ロールバック・既存ランキングデータは削除しない）。
- 更新 `docs/SUPABASE_SECURE_LEADERBOARD_SETUP.md`（ランブック/スクリプトへのポインタと「未適用」状態を明記）。

### migration 静的安全監査（適用前・確認済み）

`20260627090000_secure_leaderboard.sql` は**非破壊・冪等**であることを全文確認:
- `create table if not exists` / `add column if not exists` のみ。**DELETE / TRUNCATE / DROP TABLE は無い**。
- `update ... set mode='legacy' where mode is null` は列バックフィルのみ（行は消えない）。
- ポリシーは対象 2 テーブルに限定して DROP→SELECT 公開のみ再作成（名前非依存の監査）。
- RPC・GRANT/REVOKE はロール存在チェック付きで冪等。ロールバック手順を末尾に同梱。

### 秘密情報

- service_role key・`RATE_LIMIT_IP_SALT` の実値は**いかなるファイル/報告にも記載していない**（runbook も placeholder）。
- runbook が参照するのは公開値のみ（project ref `pfgutguzgskdtntoovkc`・publishable anon key。いずれも `js/config.js` に既出）。

### 次アクション（人間）

`docs/PHASE_6_PRODUCTION_RUNBOOK.md` の手順 0〜2 を実施 → 手順 3 の承認ゲートで承認 → 手順 4 以降を実行。

---

## Codex レビュー指摘の修正（本番反映準備・2026-06-28・ブランチ `ops/phase6-supabase-production`）

> 本番 Supabase への接続・migration・deploy・secrets 設定・INSERT は**一切行わず**、
> 指摘ファイル（SQL/Runbook/docs）のみ最小修正。git add/commit/push/merge なし。

判定: 要修正（Critical 0 / High 2 / Medium 3 / Low 1）→ すべて対応済み。

| 指摘 | 対応 | ファイル |
|---|---|---|
| **High 1** rollback の `DROP TABLE public.runs` | 破壊的撤去を全廃。`runs`/追加列/RPC を**残す**安全停止へ刷新。anon/authenticated 書き込みを与えない再表明＋RPC 一般利用禁止維持。完全撤去は散文で「後日の明示保守」に限定（実行可能な DROP/DELETE/TRUNCATE/DROP COLUMN/DROP FUNCTION を含めない） | `scripts/supabase/rollback.sql`（＋ setup §7 整合） |
| **High 2** RPC EXECUTE を明示検証していない | `has_function_privilege` + 完全シグネチャ（`to_regprocedure`）で `public/anon/authenticated/service_role` の EXECUTE 可否を true/false 判定し、期待値（service_role のみ true）と不一致なら **FAIL** を出力。PUBLIC は ACL から判定 | `scripts/supabase/post_apply_verify.sql`（E2） |
| **Medium 1** 追加列全体の検証不足 | migration を正本に、`leaderboard_scores`（run_id/anonymous_player_id/mode/duration_ms/game_version/metrics）と `runs`（id/mode/anonymous_player_id/ip_hash/started_at/expires_at/submitted/created_at）の schema/table/column/data_type/is_nullable/default を出力＋**不足判定（FAIL）**。migration に無い列は推測で含めない | `scripts/supabase/post_apply_verify.sql`（H/H2/H3） |
| **Medium 2** preflight の制約/index baseline 不足 | `pg_constraint` / `pg_index` で対象 2 テーブルに**厳密限定**して constraint（名前/種別/定義）と index（名前/定義/unique/primary）を READ-ONLY で取得 | `scripts/supabase/preflight_capture.sql`（8/9） |
| **Medium 3** secrets 入力の履歴露出 | チャット/SS/ログ/履歴/Git/.env への秘密値残置を禁止。`--help` で引数直書きしない方式を確認、無ければ Dashboard。一時ファイルは Git 管理外＋作業後削除。値は記録せず「設定済みか」だけ記録。CLI オプションは推測で書かない | `docs/PHASE_6_PRODUCTION_RUNBOOK.md`（§6）＋ setup §4 |
| **Low** E2E 失敗時の Phase 11 停止が未明文 | 「E2E 正常系・異常系が全合格するまで Phase 11 実装/PR マージ/本番公開へ進まない」を明記＋停止条件リスト | `docs/PHASE_6_PRODUCTION_RUNBOOK.md`（§13） |

注: `runs` は migration 定義どおり主キー列が `id`（`run_id` ではない）、開始時刻は `started_at`
（`server_started_at` ではない）、`submitted_at` 列は無い。検証 SQL はこの実体に合わせ、
`client_started_at` 等の未追加列は対象にしていない。
