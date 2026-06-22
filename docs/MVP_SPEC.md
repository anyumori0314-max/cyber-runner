# MVP仕様書 — 避けろ！サイバーランナー

> 本書は **Stage 0（設計資料整備）** の成果物です。
> 現行コード（`index.html` / `style.css` / `script.js`）の **実装挙動をそのまま記述** したものであり、
> このStageではゲーム挙動を一切変更していません。数値・仕様はすべて現行コード基準です。

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

- `titleCanvas` に背景アニメーションを `requestAnimationFrame` で描画（`animateTitleCanvas`）。
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

### 5.6 スコア計算 ※現行仕様（Stage 0では変更しない）

- 基本式: **`score = gameTime × 10 × コンボ倍率`**
- **この計算はゲームループ内で毎フレーム実行され、`gameState.score` を上書きする**（`script.js` の `loop`）。
- そのため、以下の「直接加算」は **加算された次フレームで上書きされ、表示スコアには永続的に反映されない**:
  - エネルギーコア取得時の `+100`（`ENERGY_CORE_SCORE`）
  - ボーナスアイテム取得時の `+50`
- 結果として、コア／ボーナスの主なスコア寄与は **コンボ倍率の上昇を通じた間接的なもの**となる（コア取得 → コンボ増加 → 倍率上昇 → 生存スコア全体が倍化）。
- 表示は `Math.floor(gameState.score)`。

> ⚠️ **重要**: この「毎フレーム再計算・上書き」は **現行仕様**として確定的に扱う。
> バグか意図かの判断・修正は本Stageでは行わない。将来変更する場合は独立したPR・仕様変更として扱うこと（[BEST_PRACTICES](./BEST_PRACTICES.md)・[MVC_DESIGN](./MVC_DESIGN.md) 参照）。

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
| ボーナス | + | 取得時に `+50`（※5.6の上書き仕様に従う） | 即時 |

- 取得時に短いポップアップ表示（`Shield Acquired` / `Slow Down` / `+50`）。
- シールド被弾時は障害物を消去し `Shield!` 表示＋pickup音（ゲームオーバーにならない）。

### 5.9 エネルギーコア

- 出現率 `0.03`。接触取得で:
  - `score += 100`（※5.6の上書き仕様に従う）
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

- キー: `cyberRunnerHighScore`（`parseFloat` で数値化、未設定時 0）。
- スコアがハイスコアを更新した場合に保存。タイトル/ゲームオーバー画面に表示。

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
- **ゲームループ安定化（現行・維持必須）**:
  - `requestAnimationFrame` の多重起動防止（`rafId` 管理）。
  - `deltaTime`（秒）による更新。`MAX_DELTA_TIME = 0.1` で大ジャンプを抑制。
  - ループ内 `try/catch` ＋ グローバル `error` / `unhandledrejection` 捕捉でエラーオーバーレイ表示。
  - 配列の削除は逆順 `splice`（インデックスずれ防止）。
- **HiDPI**: `devicePixelRatio` に応じて Canvas をスケール。
- **オフライン耐性**: Supabase通信が失敗してもゲームは継続可能（プレイは妨げない）。
- **公開**: 静的ファイルのみ。相対パスで参照（GitHub Pages配信を維持）。

---

## 7. 既知の仕様・曖昧点

1. **スコアの毎フレーム上書き（5.6）**: コア `+100`・ボーナス `+50` は次フレームで上書きされ、表示上は1フレームのみ反映。現行仕様として固定（修正は別Stage）。
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
17. **スコア毎フレーム上書き仕様**が変化していないこと（意図的判断を記録）
