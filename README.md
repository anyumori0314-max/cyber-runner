# 避けろ！サイバーランナー

ミニゲーム（PCブラウザ向け）。プレイヤーは画面下部のキャラクターを左右に操作し、上から落ちてくる障害物を避け続けます。

---

## 公開URL

[https://anyumori0314-max.github.io/cyber-runner/](https://anyumori0314-max.github.io/cyber-runner/)

## スクリーンショット

（ゲーム画面やタイトル画面のスクリーンショットをここに追加すると見栄えが良くなります）

## 操作方法

- 左移動: ← または `A`
- 右移動: → または `D`
- タイトル画面の `START` でプレイ開始、`RETRY` で再プレイ

## ゲームルール

- 上から落ちてくる障害物を避け続けます。
- 生存時間に応じてスコアが増加します。
- 接触するとゲームオーバーです（ただしシールド効果が有効な場合は1回だけ無効化されます）。

## 障害物の種類

- 通常障害物: 基本的な落下。
- 高速障害物: 細長く速く落下します（回避は難しいが小さい）。
- 大型障害物: 幅広く遅め。回避範囲が狭くなる。
- ジグザグ障害物: 横に揺れながら落下し軌道が読みづらい。

難易度が上がると特殊障害物の出現確率が増えます。

## パワーアップアイテム

- シールド (S): 1回だけ障害物を無効化します（視覚的にプレイヤーにシールド表示）。
- スロー (T): 数秒間、障害物全体の速度が遅くなります。
- ボーナス (+): 取得時にスコアを即時加算します（例: +50）。

画面上に短い取得表示が出ます。RETRY 時は全効果がリセットされます。

## 使用技術

- HTML / CSS / JavaScript（Canvas API）
- ES Modules（ビルドツール不要・`<script type="module">` で直接読み込み）
- Web Audio API（効果音） — 外部音声ファイルは使わず生成しています。
- Supabase REST API（グローバルランキング）

## ファイル構成

ゲーム向けMVC風の責務分離（Model / View / Controller + Services・Audio・Util）。
エントリーは `js/main.js` のみで、各モジュールを配線します。

```
cyber-runner/
├── index.html              # 画面構成（<script type="module" src="./js/main.js">）
├── style.css               # デザイン（ネオン・サイバー風）
├── README.md
├── docs/                   # 設計ドキュメント（MVP仕様 / MVC設計 / ベストプラクティス）
└── js/
    ├── main.js             # エントリ：DOM取得・各層の配線・起動のみ
    ├── config.js           # 全定数（Canvas/速度/出現率/コンボ/ランク/Supabase設定）※リーフ
    ├── state.js            # 共有状態の単一情報源（gameState/player/配列/RAF・delta状態）※リーフ
    ├── model/              # 状態とゲームロジック（DOM/Canvas/通信に触れない）
    │   ├── entities.js     # Player / Obstacle / EnergyCore / PowerUp / Particle
    │   ├── scoring.js      # 生存スコア差分加算 / 合成 / コンボ倍率 / ランク判定
    │   ├── difficulty.js   # レベル / 難易度カーブ / spawn判定
    │   └── powerups.js     # SHIELD / SLOW / BONUS の効果適用・期限解除
    ├── view/               # 表示のみ（stateを読み取り、書き換えない）
    │   ├── renderer.js     # Canvas描画（背景・グリッド・各エンティティ・シールド）
    │   ├── hud.js          # スコア/レベル/コンボ/パワーアップ/SOUND表示
    │   ├── screens.js      # タイトル/ゲーム/GAME OVER 画面切替・結果表示
    │   ├── title-animation.js   # タイトル背景アニメーション
    │   └── leaderboard-view.js  # GLOBAL TOP 10 描画・送信ボタン状態・名前取得
    ├── controller/         # 入力・ループ・各層のオーケストレーション
    │   ├── game-loop.js    # RAFループ / deltaクランプ / start・end・reset
    │   └── input.js        # keydown/keyup/blur（重複登録防止）
    ├── services/
    │   └── leaderboard.js  # Supabase 通信（取得 / 送信）と送信状態
    ├── audio/
    │   └── audio-manager.js  # Web Audio による効果音
    └── util/
        └── errors.js       # エラー処理 / 安全なユーザー向けオーバーレイ
```

依存方向は一方向（`main → controller → model / view / services / audio / util`、`config`・`state` はリーフ）で、循環依存はありません。

## MVC風 責務分離

- **Model**（`model/`・`state.js`）: 状態とゲームロジック。副作用（DOM/Canvas/通信）を持たない純粋なロジック。
- **View**（`view/`）: 描画と表示のみ。`state` を読み取り、書き換えない。`ctx` や DOM 参照は外部から注入される。
- **Controller**（`controller/`）: 入力とゲームループ、各層の呼び出しを統括する。
- **Services / Audio / Util**: 外部I/O（Supabase）・効果音・エラー処理などの横断的関心。
- 配線（DOM取得・各モジュールへの参照注入・イベント登録）は `js/main.js` に集約。ゲームルール・描画・通信ロジックは `main.js` に書きません。

詳細は [docs/MVC_DESIGN.md](./docs/MVC_DESIGN.md) を参照してください。

## グローバルランキング（Supabase）

- ランキングの**取得（GET）** は `services/leaderboard.js` が Supabase REST API から行い、`GLOBAL TOP 10`
  / タイトルの `TOP 5` を表示します。期間（OVERALL / DAILY / WEEKLY）とモードで絞り込めます。
- **スコア送信は Phase 6 でサーバー権威方式へ刷新**しました。クライアントからの**直接 INSERT は廃止**し、
  Edge Functions（`start-run` → `submit-score`）経由でのみ検証付き登録します。RLS でクライアント INSERT を禁止し、
  `service_role` key は **Edge Function の環境変数からのみ** 取得します（フロントには存在しません）。
- 名前は最大 12 文字（未入力は `ANONYMOUS`）。
- クライアントには **publishable (anon) key のみ** を置き（`config.js`）、アクセス制御は Supabase 側の RLS が前提です。
- 通信に失敗しても「Leaderboard unavailable / You can still play.」と表示し、**ゲームプレイは継続**します。
- ⚠ **既定ビルドではオンライン送信は無効**です（`EDGE_FUNCTIONS_BASE` が空）。SEND SCORE 押下時は
  本番へ書き込まず「Online ranking is not enabled in this build.」を表示します。デプロイ手順は
  [docs/SUPABASE_SECURE_LEADERBOARD_SETUP.md](./docs/SUPABASE_SECURE_LEADERBOARD_SETUP.md) を参照。

## Phase 6〜10：プラットフォーム拡張

Phase 1〜5（ゲームプレイ拡張）に続き、プラットフォーム機能を追加しています。詳細・検証状況・既知の制限は
[docs/PHASE_6_10_PROGRESS.md](./docs/PHASE_6_10_PROGRESS.md) が単一の基準です。

- **Phase 6 — セキュアランキング**: 直接 INSERT を廃止し、Edge Functions（`start-run` / `submit-score` /
  `challenges`）＋ RLS によるサーバー権威方式へ。期間（OVERALL/DAILY/WEEKLY）・モード別の取得。
  未配備時はローカルで継続し安全メッセージを表示（上記「グローバルランキング」を参照）。
- **Phase 7 — ゲームモード**: ENDLESS / TIME ATTACK（60 秒で FINISH）/ HARDCORE（高速・x1.5・シールド無し）/
  TRAINING（無敵などを選べる練習。記録・送信・XP なし）。
- **Phase 8 — 成長 / カスタマイズ**: XP・レベル（ゲームスコアとは分離）、プロフィール統計、外観
  （カラー/発光/軌跡/コアエフェクト/称号は**視覚のみ・性能不変**。解放はレベル/実績/チャレンジ）。
- **Phase 9 — チャレンジ**: 全ユーザー共通 seed による決定的なデイリー 3 / ウィークリー 2。サーバー時刻が
  権威、未配備時はローカル UTC フォールバック（UI に明記）。報酬は XP / 外観解放（スコア加点なし）。
- **Phase 10 — ゴースト / リプレイ / 共有**: 自己ベスト時のゴーストを IndexedDB に保存し半透明表示
  （当たり判定なし）。簡易リプレイ（再生/停止/最初から/速度・送信不可）。Canvas 結果カード → PNG ダウンロード
  ＋ 共有文コピー（外部画像 / CDN / 個人情報なし）。

新規ディレクトリ/ファイル: `js/model/{game-modes,progression,cosmetics,challenges,replay}.js`、
`js/services/{run-service,challenge-service}.js`、`js/util/indexed-db.js`、
`js/view/{mode-select,profile,cosmetics,challenges,replay,share}-view.js`、`supabase/`（migration + functions）。
依存方向は従来どおり一方向で、循環依存はありません（再開セッションの静的解析で確認済み）。

### 既知の制限（抜粋）

- **既定ビルドはオンライン送信無効**（`EDGE_FUNCTIONS_BASE` 空）。本番 Supabase は未適用（migration 未実行・
  Edge Functions 未デプロイ）。モード絞り込みは `mode` 列の migration 適用後に有効。
- **⚠ タイトル上部ボタン列のレイアウト崩れ（未修正）**: Phase 8〜10 でボタンが 8 個に増え、`.title-buttons` が
  `flex-wrap` 未指定のため、ビューポートが狭いと **START が画面左外へはみ出す**ことがある（横スクロールが必要）。
  1 行の CSS 修正（`flex-wrap: wrap`）で解消可能。Codex レビューで対応方針を判断。
- リプレイはプレイヤー位置の再生のみ（障害物は再現しない）。詳細は PROGRESS ドキュメント参照。

## 起動方法（ローカル）

ES Modules は `file://` 直開きでは動作しません。**ローカルサーバー**で起動してください。

```bash
# Python 3
py -m http.server 8123        # もしくは  python -m http.server 8123

# Node.js
npx http-server -p 8123
```

その後 `http://localhost:8123/` を開いてください。

## GitHub Pages での公開

- すべての参照は **相対パス**（`./js/main.js`、`import './config.js'` など）で記述しています。
- 絶対パス（`/js/...`）や `<base>` は使いません（リポジトリ名サブパス配信で壊れるため）。
- 追加のビルド・サーバー処理は不要で、リポジトリをそのまま GitHub Pages へ配信できます。

## 開発メモ

- 効果音は `js/audio/audio-manager.js` の `AudioManager` で生成します。ブラウザの自動再生制限のため、`START` ボタン押下後に `AudioContext` を初期化します。
- ゲームループ安定化処理（`requestAnimationFrame` を常に1本に保つ・`MAX_DELTA_TIME` での delta クランプ・`try/catch` による例外保護）は `controller/game-loop.js` で維持しています。
- スコアは「生存スコアの差分加算（`survivalScore += delta * 10 * コンボ倍率`）＋ 加算スコア（コア+100 / ボーナス+50）」を合成（`score = survivalScore + bonusScore`）します。コンボ倍率が下がってもスコアは減少しません。

## 今後の拡張案

- BGMやサウンド設定画面の追加
- 障害物やアイテムの種類追加（ホーミング、分裂など）
- モバイル対応（タッチ操作）、コントローラ対応

---

## ライセンス

自由に使用・改変・配布できます。

## 作成者

anyumori0314-max
