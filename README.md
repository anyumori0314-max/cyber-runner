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

- GAME OVER 時に `services/leaderboard.js` が Supabase REST API へスコアを送信し、`GLOBAL TOP 10` を取得して表示します。
- 名前は最大 12 文字（未入力は `ANONYMOUS`）。送信中はボタンが `SENDING...` で無効化され、成功後は `SENT` となり再送信を防止します。
- クライアントには **publishable (anon) key のみ** を置き（`config.js`）、アクセス制御は Supabase 側の RLS が前提です。`service_role` key は使用しません。
- 通信に失敗しても「Leaderboard unavailable / You can still play.」と表示し、**ゲームプレイは継続**します。

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
