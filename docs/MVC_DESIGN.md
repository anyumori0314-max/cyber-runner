# MVC設計書 — ゲーム向けMVC風 責務分離

> 本書は **Stage 0** の成果物です。現行 `script.js`（単一ファイル・約1300行）の責務を整理し、
> 段階的に「ゲーム向けMVC風」の責務分離へ移行するための設計方針を定めます。
> Stage 0 ではコードを分割しません。本書は **移行の地図** です。

---

## 1. 設計方針：厳密なMVCではなく「ゲーム向けMVC風」

- Web業務アプリの厳密なMVCへ全面刷新することは **目的としない**。
- ゲームでは「エンティティが自身の `update()`（状態更新）と `draw(ctx)`（描画）を持つ」構造が一般的かつ実用的。
  この同居は **許容**し、無理に純粋なModel/Viewへ割らない。
- 目的は「**責務の境界を明確にし、変更の影響範囲を局所化すること**」。とくに以下を優先:
  - **Supabase通信（Services）の分離**（最初に剥がす対象）。
  - **設定（config）・状態（state）の集約**。
- 一度に全分割しない。**ストラングラー方式**（外周から少しずつ剥がし、`main.js` に残りを集約）で進める。

---

## 2. レイヤ定義

| レイヤ | 責務 | 例 |
|---|---|---|
| **Model** | 状態とゲームロジック。副作用（DOM/Canvas/通信）を持たない。 | `gameState`/`player`/配列、エンティティの `update`・衝突、`calculateRank`、`getComboMultiplier`、`updateDifficulty`、`applyPowerUp` |
| **View** | 描画と表示のみ。状態を読むが書き換えない。 | Canvas描画（`draw`/`drawGrid`、各 `draw(ctx)`）、HUD更新、画面遷移、タイトルアニメ、リーダーボード表示 |
| **Controller** | 入力・ゲームループ・各レイヤのオーケストレーション。 | `loop`、`startGame`/`endGame`/`resetAllState`、入力ハンドラ、`init` |
| **Services** | 外部I/O（ネットワーク）。 | Supabase ヘッダ生成・送信・取得、リーダーボード読み込み/送信 |
| **Cross-cutting（横断的関心）** | 全レイヤから使われる共通機能。 | 設定（config）、サウンド（AudioManager）、エラーハンドリング/オーバーレイ、ユーティリティ |

---

## 3. 現在の `script.js` 責務分類

現行コードの責務マッピング（行は目安。Stage進行で更新）。

| 観点 | 該当箇所（行・目安） | 内容 |
|---|---|---|
| Model（状態） | 61–91, 258–270 | `gameState`, `player`(状態), 各配列, `leaderboardState`, ループ制御変数 |
| Model（ロジック） | 96–253, 378–529, 597–616, 1003–1035 | エンティティ `update`/衝突, `calculateRank`, `getComboMultiplier`, `shouldSpawn`, `updateDifficulty`, `applyPowerUp` |
| View（Canvas） | 119–137, 210–237, 393–464, 508–525, 1040–1129 | 各 `draw`, `draw()`, `drawGrid()`, シールド/ポップアップ描画 |
| View（DOM/HUD） | 275–302, 623–639, 682–704, 1134–1147, 1163–1203 | DOM参照, `updateUI`, status/button表示, `renderLeaderboard`, タイトルアニメ |
| Controller | 536–590, 744–829, 835–998, 1152–1161, 1206–1252 | 入力, `startGame`/`endGame`, `loop`, `init`, `resetAllState` |
| Services（Supabase） | 16–18, 641–680, 706–739 | 設定, ヘッダ, insert/fetch, `loadLeaderboard`, `handleSendScore` |
| Cross-cutting（Sound） | 307–373 | `AudioManager` |
| Cross-cutting（Util/Error） | 618–621, 1254–1296 | `getPlayerName`, エラーオーバーレイ, `handleGameError` |

> 結合度の所見: **Services（Supabase）と AudioManager は最も独立**しており、外部呼び出し点が少なく境界が明確。
> 逆に `loop`/`draw`/`state` は相互依存が強く、後段で慎重に剥がす。

---

## 4. 推奨依存方向

```
        ┌─────────── Controller ───────────┐
        │            │            │         │
        ▼            ▼            ▼         ▼
      Model        View       Services   Cross-cutting
        │            │            │      (config/audio/
        └──────┬─────┘            │       error/util)
               ▼                  ▼
          state / config  ◀──────┘  （リーフ：誰からでも import 可）
```

- **Controller** が Model / View / Services を結びつける（オーケストレーション）。
- **Model → View / View → Model の直接参照を禁止**（後述の単一state方針で疎結合化）。
- **Services は Model/View を知らない**（純粋な外部I/O。データだけ受け渡す）。
- **`config` と `state` はリーフモジュール**（他に依存せず、誰からでも import される）。

---

## 5. 単一 state module 方針

- `gameState` / `player` / 各エンティティ配列を **単一の `state` モジュール**に集約し、唯一の真実の源（single source of truth）とする。
- 状態は **直接の再代入を避け**、可能な限り更新関数（例: `resetState()`、`addCombo()`）経由で変更する。
- import で **同一の参照を共有**することで、グローバル変数なしに状態を一元管理する。
- マジックナンバー・閾値・Supabase設定は **`config` モジュール**へ集約（[BEST_PRACTICES](./BEST_PRACTICES.md)）。

---

## 6. Model と View の直接参照を避ける方針

- View は state を **読み取り専用**で参照し、書き換えない。
- Model は DOM / Canvas / `document` に触れない（描画は View、I/O は Services）。
- エンティティの `draw(ctx)` 同居は許容するが、**`ctx` は外部（View/Controller）から引数で渡す**（エンティティが自前で DOM を取りに行かない）。
- これにより、ロジック（Model）を描画なしで単体検証でき、描画差し替え時に Model を壊さない。

---

## 7. ES Modules を使用する理由

- ビルドツールなしで **モジュール分割を実現**できる（`<script type="module">`）。
- スコープが自動的にモジュール単位になり、**グローバル汚染を回避**できる。
- 依存関係が `import`/`export` で明示され、責務境界が可視化される。
- GitHub Pages（https配信）で **追加設定なく動作**する。

## 8. GitHub Pages での相対パス方針

- すべての参照は **相対パス**（例: `<script type="module" src="js/main.js">`、`import './config.js'`）で記述する。
- 絶対パス（`/js/...`）や `<base>` は **使用しない**（リポジトリ名サブパス配信で壊れるため）。
- 静的配信のみを維持し、サーバーサイド処理に依存しない。

## 9. file:// ではなくローカルサーバーを使う

- ES Modules は CORS 制約により `file://` 直開きでは動作しない。
- 開発時は必ずローカルサーバーを使う:
  ```bash
  python -m http.server 8000   # もしくは  npx http-server
  ```
- この前提は README にも明記済み（既存記載を維持）。

---

## 10. 段階的リファクタリング計画

各 Stage は **1 PR・機能等価・回帰テスト通過** を必須とする（[BEST_PRACTICES](./BEST_PRACTICES.md) の17項目）。

| Stage | 内容 | 分離対象 | リスク |
|---|---|---|---|
| **0（本Stage）** | 設計資料整備（docs 3点）。コード不変。 | なし | なし |
| **1（最優先）** | ES module足場 + **Supabase/leaderboard分離** + `config` | `services/leaderboard.js`, `config.js` | 低（呼出点は init / endGame の2箇所） |
| **2** | 横断的関心の分離 | `audio/audio-manager.js`, `util/errors.js` | 低（自己完結） |
| **3** | Model抽出 | `model/entities.js`, `scoring.js`, `difficulty.js`, `powerups.js`, `state.js` | 中（state共有・循環依存に注意） |
| **4** | View抽出 | `view/renderer.js`, `hud.js`, `screens.js`, `title-anim.js`, `leaderboard-view.js` | 中（ctx/DOM参照の受け渡し） |
| **5** | Controller抽出・`main.js` 薄化 | `controller/game-loop.js`, `input.js` | 中（ループ安定化を厳守） |

### 推奨ファイル構成（最終ターゲット）

```
cyber-runner/
├── index.html              # <script type="module" src="js/main.js">
├── style.css
├── js/
│   ├── main.js             # エントリ：配線のみ
│   ├── config.js           # 全定数 + Supabase設定（リーフ）
│   ├── state.js            # gameState / player / 配列（リーフ・単一情報源）
│   ├── model/
│   │   ├── entities.js     # Obstacle / PowerUp / EnergyCore / Particle
│   │   ├── scoring.js      # calculateRank / getComboMultiplier / コンボ処理
│   │   ├── difficulty.js   # updateDifficulty / shouldSpawn
│   │   └── powerups.js     # applyPowerUp
│   ├── view/
│   │   ├── renderer.js     # draw / drawGrid
│   │   ├── hud.js          # updateUI / powerup表示
│   │   ├── screens.js      # 画面遷移
│   │   ├── title-anim.js   # animateTitleCanvas
│   │   └── leaderboard-view.js
│   ├── controller/
│   │   ├── game-loop.js    # loop / startGame / endGame / resetAllState
│   │   └── input.js        # keydown / keyup / blur
│   ├── services/
│   │   └── leaderboard.js  # Supabase ヘッダ/insert/fetch/load/send
│   ├── audio/audio-manager.js
│   └── util/errors.js
└── docs/
```

> 「一度に全分割しない」方針のため、初期Stageでは `main.js`（=旧 `script.js`）＋少数モジュールに留め、外周から段階的に剥離する。

---

## 11. 公開APIの考え方

- 各モジュールは **最小限の `export`** だけを公開し、内部実装は隠す。
- 公開関数は **動詞ベースの明確な名前**と**安定した引数**を持つ（例）:
  - `services/leaderboard.js`: `initLeaderboardUI()`, `loadLeaderboard()`, `prepareSubmission({ score, maxCombo, rank })`, `handleSendScore()`
  - `audio/audio-manager.js`: `init()`, `play(name)`, `toggleMute()`
  - `state.js`: 状態オブジェクト＋`resetState()` 等の更新関数
- Controller は公開APIを **呼ぶだけ**にし、各モジュール内部状態へ直接触れない。

## 12. 循環依存防止策

- **`config` / `state` をリーフ**に保つ（他モジュールを import しない）。
- **Model ↔ View の相互 import を禁止**（依存方向を一方向に保つ）。
- 共有が必要な場合は **Controller を経由**して受け渡す（依存を上位へ集約）。
- エンティティの `draw(ctx)` は `ctx` を引数で受け取り、View 側を import しない。
- 分割の各 PR で、import グラフが一方向（DAG）であることを確認する。

---

## 13. 状態遷移

```
[Title] ──START──▶ [Playing] ──衝突(シールドなし)──▶ [GameOver]
   ▲                   │                                 │
   │                   └─（シールド被弾は継続）            │
   └──────────────────── RETRY ◀───────────────────────┘
```

- **Title → Playing**: `startGame`（AudioContext初期化 → `resetAllState` → 画面切替 → ループ開始）。
- **Playing → GameOver**: 障害物衝突（シールド無効時）。スコア確定 → ランク判定 → ハイスコア保存 → リーダーボード読み込み。
- **GameOver → Playing**: `retryBtn` → `resetAllState` → 再開。

## 14. データフロー（1フレーム）

```
入力(キー状態) ─▶ Controller(loop)
   │  delta算出 (MAX_DELTA_TIMEでクランプ)
   ▼
Model更新: gameTime累積 → score再計算(=gameTime*10*倍率) → 難易度更新
          → spawn判定 → エンティティupdate → 衝突判定 → コンボ/パワーアップ
   ▼
View描画: draw()（Canvas） + updateUI()（HUD）
   ▼
requestAnimationFrame(loop)  ← rafIdで多重起動防止
```

- 例外発生時は `try/catch` → `handleGameError` でオーバーレイ表示（ループ全体を保護）。
- Services（Supabase）は loop の外（init / endGame）で非同期に呼ばれ、**ゲームループをブロックしない**。

---

## 15. リスクと対策

| リスク | 対策 |
|---|---|
| モジュール化で**循環依存** | `config`/`state` をリーフ化、Model↔View直接参照禁止、Controller経由 |
| グローバル状態の**取りこぼし/二重定義** | 単一 state モジュールへ集約、import で参照共有 |
| **ループ安定化の破壊**（RAF/delta/try-catch） | `loop` 本体は Stage 5 まで触らず、最後に移設 |
| `file://` で動かない | ローカルサーバー必須を明記（既存README維持） |
| **スコア毎フレーム上書き**を無意識に変更 | 現行仕様として固定（[MVP_SPEC](./MVP_SPEC.md) §5.6）。変更は別PR |
| GitHub Pages パス解決 | 相対パス厳守、`<base>` 不使用 |
| Supabaseキー/RLS運用の誤変更 | publishable key のみ・service_role禁止・config集約のみ |
| 機能差分の見落とし | 各Stageで回帰17項目 + Codex第三者レビュー |
