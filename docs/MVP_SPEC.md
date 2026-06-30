# MVP仕様書 — 避けろ！サイバーランナー

> 本書は **Stage 0 で起草し、Stage 1〜5 のリファクタリング完了に合わせて現行実装へ更新** しています。
> ゲーム挙動（数値・バランス・ルール）はリファクタ前後で等価です。
>
> **現在の実装構成**:
> - エントリーポイントは **`js/main.js`**（`index.html` は `<script type="module" src="./js/main.js">` を読み込む）。
> - 旧 `script.js`（単一ファイル）は **削除済み**。責務は ES Modules による
>   **Model / View / Controller + Services・Audio・Util** へ分離済み（詳細は [MVC_DESIGN](./MVC_DESIGN.md) / [README](../README.md)）。
> - 構成は `js/config.js`・`js/state.js`・`js/model/*`・`js/view/*`・`js/controller/*`・
>   `js/services/leaderboard.js`・`js/audio/audio-manager.js`・`js/util/errors.js`。
> - スコアは **生存点の差分加算方式**（コンボ倍率低下でも既獲得分は減少しない。詳細は §5.6）。
>
> **拡張ステータス（2026-06 時点）**: 本書は MVP（Phase 1〜5 まで）の仕様を定義する。
> その後の **Phase 6〜10（セキュアランキング / ゲームモード / 成長・カスタマイズ / チャレンジ /
> ゴースト・リプレイ・共有）** の仕様・実装内容・未実施テスト・既知の制限は
> [PHASE_6_10_PROGRESS](./PHASE_6_10_PROGRESS.md) を単一の基準とする（本書の MVP スコープは不変）。
> なお Phase 6 以降、スコア送信は **直接 INSERT を廃止し Edge Functions 経由のサーバー権威方式** へ変更
> （本番未配備の既定ビルドではオンライン送信は無効）。

---

## 1. アプリ名と概要

- **アプリ名**: 避けろ！サイバーランナー（cyber-runner）
- **概要**: PCブラウザ向けのミニアクションゲーム。プレイヤーは画面下部のキャラクターを左右に操作し、上から落ちてくる障害物を避け続ける。生存時間とエネルギーコア取得でスコアを伸ばし、ランクとグローバルランキングを競う。
- **公開URL**: https://anyumori0314-max.github.io/cyber-runner/
- **配信形態**: GitHub Pages による静的サイト配信。

## 2. MVPの目的

- 「避ける」コアループ（操作 → 回避 → スコア → ランク）を最小構成で成立させる。
- ローカル（localStorage）とオンライン（Supabase）の二段ハイスコアで再挑戦動機を与える。
- ビルドツール非依存・静的配信のまま、誰でもURLひとつで遊べる状態を維持する。

## 3. 対象ユーザー

- PCブラウザでカジュアルに遊ぶユーザー（キーボード操作前提）。
- 短時間でハイスコアを競いたいユーザー。
- ※モバイル/タッチ操作・ゲームパッドは現時点では**MVP対象外**（後述）。

## 4. 使用技術

- HTML / CSS / JavaScript（フレームワーク・ビルドツールなし）
- ES Modules（`<script type="module">` + `import`/`export`。エントリーは `js/main.js`）
- Canvas API（ゲーム描画・タイトル背景アニメ、`800x600` 論理解像度、HiDPI対応）
- Web Audio API（効果音をコード生成。外部音声ファイル不使用）
- localStorage（ローカルハイスコア永続化）
- Supabase REST API（`/rest/v1`）によるグローバルランキング（anon/publishable key + RLS前提）

---

## 5. 現在実装されている機能

### 5.1 画面構成（3画面）

`index.html` 内の3つの `.screen` を `.active` クラスで切り替える（同時表示は1画面）。

| 画面 | 要素ID | 主な内容 |
|---|---|---|
| タイトル | `titleScreen` | 背景アニメCanvas、タイトル、操作説明、START / SOUND、ハイスコア表示 |
| ゲーム | `gameScreen` | ヘッダ（スコア / コンボ / Lv）、`gameCanvas` |
| ゲームオーバー | `gameOverScreen` | GAME OVER、ランク、スコア、ハイスコア、最大コンボ、ランクメッセージ、名前入力＋送信、TOP10、RETRY |

### 5.2 タイトル画面

- `titleCanvas` に背景アニメーションを `requestAnimationFrame` で描画（`view/title-animation.js` の `startTitleAnimation`）。
- ハイスコア（`highScoreTitle`）を localStorage から読み込んで表示。
- **START**: ゲーム開始。**SOUND**: ミュートトグル。

### 5.3 START / RETRY

- **START（`startBtn`）**: `AudioContext` 初期化 → 状態リセット → ゲーム画面へ遷移 → ゲームループ開始 → start音。
  - ブラウザの自動再生制限のため、`AudioContext` は START 押下時に初期化する。
- **RETRY（`retryBtn`）**: 全状態を `resetAllState` でリセットし、再びゲーム開始。
- RAFは多重起動しないよう管理（既存の安定化を維持）。

### 5.4 操作

| 操作 | キー |
|---|---|
| 左移動 | `←` または `A` |
| 右移動 | `→` または `D` |

- プレイヤー速度: `360 px/秒`（`delta` 秒で移動。フレームレート非依存）。
- 端は Canvas 幅でクランプ（画面外に出ない）。
- ウィンドウ `blur` 時にキー入力状態をクリア（押しっぱなし暴走防止）。

### 5.5 障害物4種類

種別は出現時に決定。`gameState.specialChance` の確率で特殊種、それ以外は通常。
特殊種に決定した場合は内部で3等分（`fast` / `large` / `zigzag`）。

| 種別 | サイズ(px) | 速度 | 色 | 特徴 |
|---|---|---|---|---|
| normal（通常） | 50 × 50 | 基準速度 | `#ff0088` | 基本的な落下 |
| fast（高速） | 20 × 40 | 基準 × 1.6 | `#ff7744` | 細長く速い。回避難だが小さい |
| large（大型） | 80 × 60 | 基準 × 0.75 | `#8855ff` | 幅広く遅い。回避範囲が狭い |
| zigzag（ジグザグ） | 46 × 46 | 基準 | `#ffd400` | `sin` で横揺れ。軌道が読みにくい |

- 基準速度（px/秒）= `gameState.speed × SPEED_UNIT_TO_PX_PER_SEC(60)`。
- `specialChance = min(0.05 + gameTime / 1200, 0.4)`（時間経過で特殊種が最大40%まで増加）。
- 出現判定: `shouldSpawn(rate, delta) = Math.random() < rate × delta × TARGET_FPS(60)`（フレームレート非依存の確率制御）。

### 5.6 スコア計算 ※現行仕様（生存点の差分加算方式）

スコアは **生存スコア（`survivalScore`）** と **加算スコア（`bonusScore`）** の2系統で管理し、最終スコアは両者の合成。
ロジックは `model/scoring.js` に集約（`controller/game-loop.js` のループから呼ばれる）。

- **生存スコアの差分加算**（毎フレーム、再計算・上書きではなく加算）:
  ```js
  survivalScore += delta * 10 * multiplier;   // multiplier = コンボ倍率
  ```
  各フレームの獲得点に、その時点の倍率だけを適用するため、**倍率が下がっても過去フレームの獲得分は再計算されない**。
- **加算スコアの累積保持**（毎フレーム上書きしないため消えない）:
  - エネルギーコア取得時 `bonusScore += 100`（`ENERGY_CORE_SCORE`）
  - ボーナスアイテム取得時 `bonusScore += 50`（`BONUS_SCORE`）
  - **コンボ倍率は加算スコアには掛けない**（生存スコアのみに適用）。
- **最終スコアの合成**（合成のみ。倍率の再適用なし）:
  ```js
  score = survivalScore + bonusScore;
  ```
- 表示・確定値は `Math.floor(gameState.score)`。
- **コンボ倍率が 3倍 → 1倍 に下がっても、表示スコアは減少しない**（生存分は加算済み・加算スコアは保持）。

> ✅ GAME OVER の最終スコア / ランク判定 / localStorage ハイスコア / Supabase 送信は、いずれも
> **同一の丸め済み最終スコア（`Math.floor(gameState.score)`）** を使う（値の不一致は生じない）。

> 🗄️ **旧仕様（参考・現在は廃止）**: Stage 1 以前は `score = gameTime × 10 × コンボ倍率` を毎フレーム
> 再計算・上書きしており、コア `+100`・ボーナス `+50` が次フレームで上書きされ、かつコンボ倍率低下時に
> 表示スコアが減少していた。**この挙動は Stage 2 で上記の差分加算方式へ修正済みで、現行仕様ではない。**

### 5.7 レベルと難易度上昇

- レベル: `level = floor(gameTime / 10) + 1`（10秒ごとに+1）。レベルアップ時に levelUp 音。
- 難易度（時間に対する線形増加・上限クランプ）:

| 項目 | 初期値 | 最大値 | 到達時間 |
|---|---|---|---|
| baseSpeed | 3 | 12 | 60秒 |
| spawnRate（障害物出現率） | 0.02 | 0.08 | 60秒 |
| powerupSpawnRate | 0.002 | 0.01 | 120秒 |
| specialChance | 0.05 | 0.40 | 約420秒（`gameTime/1200`） |

- 実効速度 = `baseSpeed × slowFactor`（スロー効果中は 0.5 倍）。
- エネルギーコア出現率は固定 `0.03`。

### 5.8 パワーアップ（3種）

低確率で出現し、接触で取得（pickup音）。RETRY時に全効果リセット。

| アイテム | 表記 | 効果 | 持続 |
|---|---|---|---|
| シールド | S | 障害物を1回だけ無効化（視覚表示あり） | 8秒（または1回被弾するまで） |
| スロー | T | 障害物全体の速度を 0.5 倍 | 6秒 |
| ボーナス | + | 取得時に `bonusScore += 50`（累積保持・§5.6） | 即時 |

- 取得時に短いポップアップ表示（`Shield Acquired` / `Slow Down` / `+50`）。
- シールド被弾時は障害物を消去し `Shield!` 表示＋pickup音（ゲームオーバーにならない）。

### 5.9 エネルギーコア

- 出現率 `0.03`。接触取得で:
  - `bonusScore += 100`（累積保持・§5.6）
  - `combo++`、`maxCombo` 更新
  - `comboLastTime` を現在の `gameTime` に更新
  - パーティクル生成（core 5個 + combo 1個）、pickup音

### 5.10 コンボ

- エネルギーコア取得で加算。最後の取得から **`COMBO_TIMEOUT = 5秒`**（`gameTime` 基準）経過でコンボ 0 にリセット。
- コンボ倍率（`getComboMultiplier`）:

| コンボ数 | 倍率 |
|---|---|
| 0–4 | 1.0 |
| 5–9 | 1.5 |
| 10–19 | 2.0 |
| 20+ | 3.0 |

- 倍率はスコア式（5.6）とヘッダのコンボ表示（`comboText`）に反映。最大コンボはゲームオーバー画面に表示。

### 5.11 ランク判定

ゲームオーバー時、最終スコアから判定（`calculateRank`、上から最初に閾値を満たすもの）。

| ランク | 必要スコア | メッセージ |
|---|---|---|
| S | 3000 | 完璧だ！君はサイバーの支配者だ！ |
| A | 2000 | すばらしい！もう一度挑戦できるな |
| B | 1000 | いい動きだ。次は頑張ろう |
| C | 500 | まあまあ。練習だ |
| D | 0 | もう一度。今度こそ！ |

### 5.12 localStorage ハイスコア

- キー: `cyberRunnerHighScore`（変更なし）。
- **初期読込（`state.js` の `loadInitialHighScore`）**: `localStorage` から数値化して読み込み、未設定・不正値は 0。
  `localStorage.getItem` が例外を投げる環境でも、`try/catch` で 0 にフォールバックして `state.js` の読み込み／ゲーム起動を止めない（内部例外はユーザー画面に出さず `console.warn` のみ）。
- 更新仕様（変更なし）: 最終スコアがハイスコアを更新した場合に `Math.floor` 値を保存。タイトル/ゲームオーバー画面に表示。

### 5.13 Supabase 全ユーザー共通ランキング

- エンドポイント: `https://<project>.supabase.co/rest/v1/leaderboard_scores`
- 認証: anon/publishable key（`apikey` ヘッダ + `Authorization: Bearer`）。**RLS前提・service_role key不使用**。
- テーブル: `leaderboard_scores`（カラム: `player_name`, `score`, `max_combo`, `rank`, `created_at`）。
- **取得**: `select=player_name,score,max_combo,rank` / `order=score.desc,max_combo.desc,created_at.asc` / `limit=10`（`cache: no-store`）。
- **送信**: POST（`Prefer: return=minimal`）。payload = `{ player_name, score, max_combo, rank }`。
- **読み込みタイミング**: 初期化時（`init`）とゲームオーバー時。
- **プレイヤー名**: `trim` → 空なら `ANONYMOUS` → 先頭 `12` 文字に切り詰め。
- **送信ボタン状態**: `SEND SCORE` / `SENDING...` / `SENT`、送信中・送信済みは `disabled`。
- **表示**: `renderLeaderboard` は `textContent` で描画（XSS安全）。`{name} [{rank}]` と `{score} / C{maxCombo}`。

---

## 6. 非機能要件

- **目標**: 60fps を目安に滑らかに動作。
- **ゲームループ安定化（現行・維持必須。`controller/game-loop.js`）**:
  - `requestAnimationFrame` を常に1本に保つ（`state.js` の `loopState.rafId` 管理・多重起動防止）。
  - `deltaTime`（秒）による更新。`MAX_DELTA_TIME = 0.1` で大ジャンプを抑制。
  - ループ内 `try/catch` ＋ グローバル `error` / `unhandledrejection` 捕捉（`util/errors.js`）でエラーオーバーレイ表示。
  - 配列の削除は逆順 `splice`（インデックスずれ防止）。
- **HiDPI**: `devicePixelRatio` に応じて Canvas をスケール。
- **オフライン耐性**: Supabase通信が失敗してもゲームは継続可能（プレイは妨げない）。
- **公開**: 静的ファイルのみ。相対パスで参照（GitHub Pages配信を維持）。

---

## 7. 既知の仕様・曖昧点

1. **スコア計算（5.6）**: 生存点の差分加算＋加算スコア累積＋合成方式（コンボ倍率低下でも非減少）。旧「毎フレーム上書き」方式は Stage 2 で廃止済み。
2. **未使用フィールド/定数**: `gameState.isPaused`、`gameState.startTime`、`INITIAL_OBSTACLE_SPEED` は実質未使用。
3. **ログ出力**: ゲームループは `console.error` を使わずオーバーレイ表示。一方、リーダーボード処理は失敗時に `console.warn` を使用。
4. **タイトル背景アニメ**は HiDPI スケール対象外（ゲームCanvasのみ対象）。

---

## 8. MVP対象外（将来拡張）

- モバイル/タッチ操作、ゲームパッド対応。
- BGM、サウンド設定画面。
- 障害物・アイテムの追加種別（ホーミング、分裂など）。
- 名前以外のプロフィールやアカウント、リプレイ等。
- ビルドツール/フレームワーク導入。

---

## 9. 回帰テスト項目（17項目）

リファクタリング各Stageで、挙動が変化していないことを確認するチェックリスト（[BEST_PRACTICES](./BEST_PRACTICES.md) と共通）。

1. タイトル表示・背景アニメ・localStorageハイスコア反映
2. START → 画面遷移・start音・AudioContext初期化
3. 移動（←/→ / A/D）と端クランプ、blurでキー解除
4. 障害物4種の出現と難易度上昇（speed / spawn / special）
5. 衝突 → GAME OVER（シールド時は1回無効化）
6. パワーアップ: shield(8秒) / slow(0.5倍, 6秒) / bonus(+50)
7. エネルギーコア: combo++ ・maxCombo更新・パーティクル・音
8. コンボ5秒タイムアウトでリセット、倍率がスコア/HUDに反映
9. レベルアップ音
10. GAME OVER画面: 最終スコア / ハイスコア / ランク / 最大コンボ / メッセージ
11. ハイスコア更新時 localStorage 保存
12. リーダーボード: init・GAME OVER時ロード、TOP10描画、empty / unavailable
13. SEND SCORE: 名前(default ANONYMOUS / 12字)、SENDING / SENT / 失敗時 error 表示
14. RETRY で全状態リセット
15. エラーオーバーレイ表示とループ挙動
16. HiDPI（devicePixelRatio）描画、SOUND トグル
17. **スコア計算仕様**（生存点の差分加算 + 加算スコア累積 + 合成、コンボ倍率低下でも非減少）が変化していないこと

---

## 10. Phase 11〜13 追補（ゲーム拡張）

> §8「MVP対象外」のうち**モバイル/タッチ操作・リプレイ**は実装済み（Phase 10/12）。
> 正式な進捗・検証基準は [PHASE_11_13_PROGRESS.md](./PHASE_11_13_PROGRESS.md)。

### Phase 11（ウェーブ / イベント / ボス）
- ウェーブ列 Wave1（通常）→2（追尾）→3（レーザー）→4（隙間壁）→5（ボス）。状態機械 intro→active→outro→intermission。
- Endless は撃破でサイクル進行（難易度段階上昇・ボス HP 増）。Time Attack は 60 秒優先（ボス中でも残り0で FINISH）。
  Hardcore はウェーブ短縮・ボス間隔短縮（警告・最小通過幅は維持＝回避不能化しない）。Training は任意 Wave/Boss/Event を手動確認。
- ボス: Firewall Core / Data Worm / Security Gate（HP バー・警告・撃破演出・安全地帯/最小通過幅を保証）。
- イベント（同時1つ）: CORE RUSH / DOUBLE SCORE / HIGH SPEED / DARK ZONE / LASER STORM。pause 凍結・RETRY/モード変更で解除・終了で完全復元。
- 単一 RAF / deltaTime / pause 凍結を維持（専用 RAF・`setInterval` 不使用）。設定値は config（Phase 13 で balance preset へ集約）。

### Phase 12（モバイル操作 / PWA）
- オンスクリーン操作（左/右/ダッシュ/一時停止・Pointer Events・44px↑・マルチタッチ・aria-label・キーボード共存・visibilitychange 解除）。
  表示は 'auto'（タッチ端末で初期 ON / PC で初期 OFF）。
- PWA: manifest（standalone・相対）/ SW（versioned cache・HTML network-first・静的 SWR・API/POST/Supabase 非キャッシュ・SKIP_WAITING）/
  offline.html / 192・512・maskable アイコン。更新はユーザー操作・プレイ中は自動リロードしない。オフラインで Endless/Training 起動可。
- アクセシビリティ: prefers-reduced-motion / 高コントラスト / :focus-visible / safe-area-inset / 横スクロールなし。

### Phase 13（匿名分析 / バランス管理）
- 分析は初期 OFF。明示同意でのみ 1 プレイ 1 件の匿名要約を送信（Training/Replay/オフラインは送らない・無断再送なし・ゲーム非影響）。
  収集項目は要約のみ・個人情報なし。Supabase は RLS（public SELECT 禁止・service_role のみ書込）・CHECK・event_id 一意・生 IP 列なし。
- バランスは `BALANCE_VERSION` 付き preset で一元管理（現在値を既定 preset へ移行＝挙動不変）。各プレイの分析へ balance_version を記録。
- 本番 migration 適用・Function deploy・INSERT は未実施（コードと手順のみ）。
