# ベストプラクティス方針 — cyber-runner

> 本書は **Stage 0** の成果物です。今後のリファクタリング・機能追加で守るべき方針をまとめます。
> 関連: [MVP_SPEC](./MVP_SPEC.md)（現行仕様）／[MVC_DESIGN](./MVC_DESIGN.md)（責務分離計画）。

---

## 1. アーキテクチャ / 配信

### 1.1 ES Modules を使用する
- モジュール分割は `<script type="module">` と `import`/`export` で行う。
- グローバル変数による受け渡しを避け、依存関係を明示する。

### 1.2 ビルドツールは現時点で導入しない
- バンドラ・トランスパイラ・フレームワークは追加しない。
- 「便利そう」だけで依存を増やさない。導入が必要になった場合は、理由と影響を明文化して別途合意する。

### 1.3 GitHub Pages の静的配信を維持する
- サーバーサイド処理に依存しない（静的ファイルのみ）。
- 参照は **相対パス**で書く。絶対パス（`/js/...`）や `<base>` は使わない（リポジトリ名サブパス配信で壊れるため）。

### 1.4 file:// ではなくローカルサーバーを使う
- ES Modules は `file://` 直開きでは動作しない。開発時は必ずローカルサーバーを使う:
  ```bash
  python -m http.server 8000   # または  npx http-server
  ```

---

## 2. コード設計

### 2.1 設定値を config へ集約する
- Canvas寸法、速度、出現率、コンボ倍率、ランク閾値、Supabase設定などの定数を `config` モジュールへ集約する。
- マジックナンバーをロジック中に散在させない。

### 2.2 状態を単一 state module へ集約する
- `gameState` / `player` / 各配列を単一の `state` モジュールに集約し、唯一の真実の源とする。
- 状態は直接の再代入を避け、更新関数経由で変更することを推奨。
- `config` と `state` は **リーフモジュール**（他を import しない）に保ち、循環依存を防ぐ。

### 2.3 Canvas描画と DOM操作の責務を整理する
- Canvas描画（View/renderer）と DOM操作（View/HUD・画面遷移）を混在させない。
- Model（ロジック）は DOM / Canvas / 通信に触れない。
- エンティティの `draw(ctx)` 同居は許容するが、`ctx` は外部から引数で渡す。

### 2.4 純粋関数を優先する
- 副作用のないロジック（例: `calculateRank`、`getComboMultiplier`、`shouldSpawn`）は純粋関数として切り出す。
- 純粋関数は入出力が明確で、単体検証・再利用がしやすい。

---

## 3. Supabase / セキュリティ

### 3.1 publishable key の扱い
- クライアントに置くのは anon/publishable key のみ（公開前提）。`config` モジュールへ集約する。
- これは「秘匿対象」ではないが、**散在させず一箇所**で管理する。

### 3.2 service_role key 禁止
- service_role key はクライアント／リポジトリに**絶対に置かない**。漏洩すると RLS を回避してDB全体を操作できるため。

### 3.3 RLS 前提
- アクセス制御は Supabase 側の Row Level Security（RLS）ポリシーで担保する前提を維持する。
- 想定ポリシー: `leaderboard_scores` への anon の INSERT / SELECT を許可。UPDATE/DELETE は許可しない（要確認）。

### 3.4 入力検証
- プレイヤー名は `trim` → 空なら `ANONYMOUS` → 先頭 12 文字に切り詰め（`services/leaderboard.js` の `normalizePlayerName` で実施）。
- 送信 payload は必要なカラム（`player_name`/`score`/`max_combo`/`rank`）のみに限定する。

### 3.5 textContent を使用する
- ユーザー由来の文字列（プレイヤー名など）は `textContent` で描画する（`innerHTML` に流し込まない）。
- 現行 `renderLeaderboard` は `textContent` 使用（XSS安全）。この方針を維持する。

### 3.6 外部通信は try/catch
- `fetch` などの外部通信は必ず `try/catch` で囲み、ユーザー向けステータス表示（成功/送信中/失敗）を行う。

### 3.7 通信失敗時もゲームを継続する
- Supabase の取得/送信が失敗しても、ゲームプレイは妨げない（「Leaderboard unavailable」「You can still play.」等を表示）。
- ランキングはあくまで付加機能。コアループの可用性を最優先する。

---

## 4. ゲームループ / パフォーマンス（現行の安定化を維持）

### 4.1 requestAnimationFrame の二重起動防止
- RAF のハンドル（`rafId`）を管理し、ループが多重に走らないようにする。

### 4.2 deltaTime と MAX_DELTA_TIME
- 更新は `deltaTime`（秒）ベースで行い、フレームレート非依存にする。
- `MAX_DELTA_TIME = 0.1` で delta をクランプし、タブ復帰時などの大ジャンプを抑制する。

### 4.3 逆順 splice
- 配列（障害物・パワーアップ・コア・パーティクル・ポップアップ）の要素削除はループを **逆順**に回して `splice` する（インデックスずれ防止）。

### 4.4 例外でループを止めない
- ループ本体は `try/catch` で保護し、`handleGameError` でオーバーレイ表示する。
- グローバル `error` / `unhandledrejection` も捕捉する。

> ⚠️ これらの安定化処理は**回帰で壊さないことが最重要**。`loop` 本体への変更は最後（[MVC_DESIGN](./MVC_DESIGN.md) Stage 5）に限定する。

### 4.5 スコア計算の現行仕様を尊重する（Stage 2 で修正済み）
- 生存スコアは毎フレーム **差分加算**する: `survivalScore += delta × 10 × コンボ倍率`。
- 加算スコアは累積保持する: コア `+100` / ボーナス `+50` を `bonusScore` に積む（コンボ倍率は掛けない）。
- 最終スコアは合成のみ: `score = survivalScore + bonusScore`。倍率の再適用はしない。
- この方式により **コンボ倍率が下がってもスコアは減少しない**（旧「毎フレーム再計算・上書き」方式で起きていた減少を Stage 2 で修正）。
- スコアロジックは `model/scoring.js` に集約。リファクタで無意識に旧方式へ戻さない。変更する場合は独立した仕様変更PRとして扱う。

---

## 5. 開発フロー / レビュー

### 5.1 Git ブランチ・PR運用
- `main` は常にデプロイ可能な状態を保つ（GitHub Pages 公開元）。
- 作業はフィーチャーブランチで行う（Stage 1〜2 は `feature/mvc-refactor`、Stage 3〜5 は `feature/mvc-complete-refactor`）。
- 直接 `main` へコミット・push しない。マージは PR 経由。

### 5.2 1 ステージ 1 PR
- リファクタは [MVC_DESIGN](./MVC_DESIGN.md) の Stage 単位で進める。
- **1 Stage = 1 PR = 機能等価**を原則とし、レビューと回帰確認を容易にする。
- 1 PR で複数の関心事（分離＋機能追加＋挙動変更）を混ぜない。

### 5.3 Claude Code と Codex の役割分担
- **Claude Code**: 設計・実装・ドキュメント整備・回帰確認を主導。
- **Codex**: 第三者レビュー（独立視点での検証）。
- Codex へ渡す主なレビュー観点:
  1. 機能等価性（リファクタ前後で挙動差分がないか／回帰17項目）
  2. モジュール境界の妥当性・循環依存の有無
  3. 状態管理（単一情報源か／意図しない再代入がないか）
  4. Supabase/RLS運用（publishable keyのみ・service_role不使用・キー集約）
  5. セキュリティ（textContent・入力検証・通信のtry/catch）
  6. ループ安定化の保全（RAF/delta/逆順splice/例外保護）
  7. パフォーマンス（毎フレームDOM更新・GC負荷）
  8. 静的配信整合性（相対パス・GitHub Pages動作）
  9. スコア毎フレーム上書き仕様の扱い（維持/修正の明示）

### 5.4 commit 前の確認項目
1. `git status` / `git diff --stat` で変更範囲を確認する。
2. 対象 Stage 以外のファイル（とくに `index.html`/`style.css`/`script.js` を意図せず）が変わっていないか確認する。
3. 回帰テスト17項目（§6）を実施し、挙動差分がないことを確認する。
4. ローカルサーバーで実際に動作確認する（`file://` ではなく）。
5. 機密情報（service_role key 等）が含まれていないことを確認する。
6. コミットメッセージが Stage と変更内容を表しているか確認する。

---

## 6. 回帰テスト 17項目

リファクタ各Stageで、挙動が変化していないことを確認するチェックリスト（[MVP_SPEC](./MVP_SPEC.md) §9 と共通）。

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
17. **スコア計算仕様**（生存スコアの差分加算 + 加算スコア累積 + 合成、倍率低下でも非減少）が変化していないこと

---

## 7. Phase 11〜13 のベストプラクティス（ゲーム拡張）

`scripts/verify.mjs` は Phase 11〜13 を含め **107 件**（Phase 11:12 / Phase 12:10 / Phase 13:12 を追加）。
`npm test` / `npm run verify` で全件 PASS、`git diff --check` clean を維持する。

### 単一 RAF / deltaTime / pause 凍結（Phase 11）
- ボス・イベント・ウェーブ進行は **専用 RAF を作らない**。`game-loop` の単一ループから `updateWaveSystem(delta)` を呼ぶ。
- 時間は **すべて deltaTime 駆動**（`setInterval` でゲーム時間を管理しない）。pause は RAF 停止で全タイマーが自動凍結。
- ボス/イベントの状態は `state.waveState` に**一元管理**（二重定義禁止）。RETRY/モード変更は `resetWaveState` で完全リセット。
- イベント終了時は**スナップショット復元**で速度/倍率/出現率/描画状態を正確に戻す。DOUBLE SCORE は新規加算のみ・過去スコア非減少。
- ボスは安全地帯/最小通過幅/警告時間を**必ず確保**（Hardcore でも回避不能化しない）。同時レーザー/追尾数に上限。

### モバイル / PWA（Phase 12）
- タッチは **Pointer Events + pointer capture**。`pointercancel`/`lostpointercapture`/`visibilitychange` で入力残りを防ぐ。
  キーボードと同じ `player` フラグを更新して共存。操作ボタンは 44px↑・`aria-label`・押下表示（色のみに依存しない）。
- SW は **バージョン付きキャッシュ**・HTML network-first・静的 SWR。**Supabase/POST/start-run/submit-score/challenges/analytics は非キャッシュ**。
  更新はユーザー操作で適用（プレイ中は自動リロードしない）。SW 失敗でも通常版で起動。
- すべて相対参照（GitHub Pages サブパス対応）。`prefers-reduced-motion`/高コントラスト/`:focus-visible`/safe-area を尊重。

### 分析 / バランス（Phase 13）
- 分析は **初期 OFF・明示同意のみ**。Training/Replay/オフラインは送らない。1 プレイ 1 件・**無断再送なし**・ゲーム非影響（fire-and-forget）。
- payload に**個人情報を含めない**（player_name/IP/user_id/run_id 等は client でも server でも拒否）。検証は Deno/Node 共有の純粋関数。
- Supabase は **public SELECT 禁止・anon/auth 書込禁止・service_role のみ**。CHECK 制約・event_id 一意・**生 IP 列なし**（rate-limit は salt 付き hash）。
- バランスは **`BALANCE_VERSION` 付き preset を単一参照**。既存数値は無断変更せず現在値を既定 preset へ移行。ランキング影響変更は版を上げ `BALANCE_GUIDE.md` に明記。
- **本番 migration 適用・Function deploy・本番 INSERT は行わない**（コードと手順のみ）。秘密情報はフロント/ファイルに保存しない。
