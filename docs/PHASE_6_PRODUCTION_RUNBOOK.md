# Phase 6 本番反映 ランブック（Supabase セキュアランキング）

> **状態: 未適用 / NOT YET APPLIED。**
> 本番 Supabase への `db push` / `functions deploy` / `secrets set` は **まだ実行していません**。
> このランブックは「人間が承認後に実行する手順」をまとめたものです。
> Claude（自動エージェント）は本番操作を行いません。**手順 3 の承認ゲートで必ず停止**します。

このリポジトリの作業環境には **Supabase CLI が入っていません**（`supabase: command not found`）。
本番操作を行う人間が、Supabase へのアクセス権を持つ端末で以下を実施してください。

---

## 0. 対象プロジェクトの確認（最重要）

- 本番 project ref: **`pfgutguzgskdtntoovkc`**
  （`js/config.js` の `SUPABASE_URL = https://pfgutguzgskdtntoovkc.supabase.co` から。これは公開値）
- publishable(anon) key・URL は公開値（`js/config.js` に既出）。**service_role key と RATE_LIMIT_IP_SALT のみが秘密**。

```bash
supabase --version            # CLI が入っていること
supabase login                # 対話ログイン（トークンは記録しない）
supabase link --project-ref pfgutguzgskdtntoovkc
supabase projects list        # link 先が本番 ref であることを目視確認
supabase migration list       # 未適用 migration に 20260627090000 が出ること
```

> ⚠️ まずステージング環境がある場合はステージングで通すことを推奨。本番は最後。

---

## 1. 適用前キャプチャ（READ-ONLY）

`scripts/supabase/preflight_capture.sql` を Supabase ダッシュボード > SQL Editor、
または `psql "$DB_URL" -f scripts/supabase/preflight_capture.sql` で実行し、**出力を全て保存**する。

記録する必須項目（指示書の必須確認 1〜3）:
- [ ] `leaderboard_total`（適用前の件数）= __________
- [ ] mode 別件数（特に `(null)` 行数。適用後に `legacy` へ移る）= __________
- [ ] 既存 RLS ポリシー一覧（migration が全 DROP するため、復元の唯一の根拠）
- [ ] 既存テーブル権限（anon/authenticated）

---

## 2. バックアップ

```bash
# データのみダンプ（推奨：ファイルは安全な場所へ。Git へは入れない）
supabase db dump --data-only -f backup_leaderboard_$(date +%Y%m%d_%H%M%S).sql
```
または Supabase ダッシュボード > Database > Backups からスナップショットを取得。

- [ ] バックアップ取得済み（保管場所を記録、Git には入れない）
- [ ] `supabase db diff` で反映予定の差分を確認した（DELETE/TRUNCATE が無いこと）

### migration 安全性（適用前の静的監査・確認済み）

`supabase/migrations/20260627090000_secure_leaderboard.sql` を確認した結果、**非破壊・冪等**:
- `create table if not exists` / `add column if not exists` のみ。**DROP TABLE / DELETE / TRUNCATE は無い**。
- `update ... set mode='legacy' where mode is null` は旧行への列バックフィルのみ（行は消えない）。
- ポリシーは `leaderboard_scores` / `runs` に限定して DROP→SELECT 公開のみ再作成（名前非依存の監査）。
- RPC・GRANT/REVOKE は冪等（`create or replace` / ロール存在チェック付き）。
- 末尾にロールバック手順をコメントとして同梱（`scripts/supabase/rollback.sql` にも整理済み）。

---

## 3. 🛑 承認ゲート（ここで停止）

ここまで（手順 0〜2）が完了し、以下を**人間が確認**してから手順 4 へ進む。

- [ ] link 先が本番 ref `pfgutguzgskdtntoovkc` で正しい
- [ ] バックアップ取得済み・適用前件数を記録済み
- [ ] `supabase db diff` に破壊的操作が無い
- [ ] ロールバック手順（`scripts/supabase/rollback.sql`）を把握済み

**承認者: ____________  日時: ____________**

> Claude はこの行より先（本番への push/deploy）を自動実行しません。

---

## 4. migration 適用

```bash
supabase db push
```

- [ ] 適用がエラー無く完了

## 5. 適用後の DB 検証（READ-ONLY）

`scripts/supabase/post_apply_verify.sql` を実行し、preflight と突き合わせる。

- [ ] A: `leaderboard_total_after` >= 適用前件数（**減っていない**）
- [ ] B: `null_mode_rows = 0`（legacy バックフィル済み）
- [ ] C: `leaderboard_scores` のポリシーは `public read leaderboard`(SELECT) のみ / `runs` はポリシー無し
- [ ] D: anon・authenticated に INSERT/UPDATE/DELETE が**残っていない**（SELECT のみ）
- [ ] E: `submit_score_atomic` の EXECUTE が **service_role のみ**（anon/authenticated/PUBLIC 無し）
- [ ] F: `leaderboard_run_id_uidx` が存在
- [ ] G: `runs` が存在し RLS 有効

---

## 6. Edge Function 環境変数（secrets）

> ⚠️ **秘密値の取り扱い（Codex Medium 3・厳守）。** `SUPABASE_SERVICE_ROLE_KEY` と
> `RATE_LIMIT_IP_SALT` は秘密値である（`SUPABASE_URL` / `ALLOWED_ORIGINS` は公開値）。

秘密値について、次を必ず守る:

- [ ] 秘密値を**チャット／報告／Issue に貼らない**。
- [ ] 秘密値を**スクリーンショットに写さない**。
- [ ] **ターミナルログ・実行ログを共有しない**（画面共有・コピペ含む）。
- [ ] 秘密値を**コマンド履歴に実値で残さない**（`KEY="<実値>"` の直接入力を避ける）。
- [ ] 秘密値を**Git 管理ファイルに保存しない**。**`.env` をリポジトリ内に作らない**。
- [ ] **このランブック・進捗文書には「設定したか否か」だけ記録**し、**値そのものは記録しない**。
- [ ] 作業後に**シェル履歴と一時ファイルを確認し、残っていれば安全に削除**する。

### 秘密値を引数に直接書かない設定方法（実行前に必ず確認）

> ⚠️ **CLI のオプション名を推測で使わない。** 実際に入っている Supabase CLI のバージョンで
> 利用可能な手段だけを採用すること。

- [ ] 実行前に `supabase secrets set --help`（および `supabase secrets --help`）を確認し、
      **値をコマンド引数に直接書かずに設定できる公式手段**（CLI が対応していれば、ファイル経由・
      標準入力経由などの方式）が**あるか確認**する。
- [ ] **安全な方法を確認できない場合**は、CLI で値を引数に渡さず、
      **Supabase Dashboard > Project Settings > Edge Functions（Secrets）画面**から設定する。
- [ ] **一時ファイルを使う場合**は、**Git 管理外**（リポジトリ外 or `.gitignore` 済みパス）に置き、
      設定完了後に**安全に削除**する（中身が秘密値のため確実に消す）。
- [ ] `RATE_LIMIT_IP_SALT` の生成も**値を画面・履歴・Git に残さない手段**で行う
      （生成→設定→破棄。値は記録しない）。

公開値（秘密でない）は通常どおり設定してよい:

```bash
# 公開値（秘密ではない）。これらは引数に書いても問題ない。
supabase secrets set SUPABASE_URL="https://pfgutguzgskdtntoovkc.supabase.co"
supabase secrets set ALLOWED_ORIGINS="https://anyumori0314-max.github.io,http://localhost:8127,http://127.0.0.1:8127"
# （任意）レート制限の上書き
# supabase secrets set START_RUN_WINDOW_MS="60000"
# supabase secrets set START_RUN_MAX_PER_ANON="12"
# supabase secrets set START_RUN_MAX_PER_IP="30"
```

秘密値（`SUPABASE_SERVICE_ROLE_KEY` / `RATE_LIMIT_IP_SALT`）は、上記「引数に直接書かない方法」または
Dashboard で設定する。**実値はここに書かない。**

- [ ] `SUPABASE_SERVICE_ROLE_KEY` を設定済み（**値は記録していない**／引数直書きしていない）
- [ ] `ALLOWED_ORIGINS` を本番 + 開発 origin で設定済み
- [ ] `RATE_LIMIT_IP_SALT` を設定済み（**値は記録していない**／引数直書きしていない）
- [ ] `supabase secrets list` で**キー名のみ**確認（値は表示しない）
- [ ] 一時ファイル・シェル履歴に秘密値が残っていないことを確認・削除済み

---

## 7. Edge Functions deploy

```bash
supabase functions deploy start-run
supabase functions deploy submit-score
supabase functions deploy challenges
```

- [ ] 3 関数が deploy 済み（project ref と関数名を目視確認）

---

## 8. クライアント有効化（**別レビューのコード変更**）

ランキング送信を有効化するには `js/config.js` の `EDGE_FUNCTIONS_BASE` を設定する:

```js
export const EDGE_FUNCTIONS_BASE = 'https://pfgutguzgskdtntoovkc.supabase.co/functions/v1';
```

> これはコード変更なので、本ランブックの本番操作とは別に commit/レビュー対象。
> 空のままでもゲームは継続し、送信は「Online ranking is not enabled in this build.」表示で安全。

---

## 9. 本番 E2E（HTTP）

エンドポイント: `https://pfgutguzgskdtntoovkc.supabase.co/functions/v1/<fn>`
共通ヘッダー（クライアント実装に合わせる）:
`apikey: <anon>` と `Authorization: Bearer <anon>`（anon = 公開 publishable key）。

`ORIGIN` は許可 origin（例 `https://anyumori0314-max.github.io`）を使う。

### 9-A. 正常系

| # | 確認 | 期待 |
|---|---|---|
| 1 | `POST /start-run` (mode=endless) | **200** + `run_id` 発行 |
| 2 | run_id を使って `POST /submit-score`（正常 score） | **200**、`leaderboard_scores` が +1 |
| 3 | ランキング GET（overall/daily/weekly） | 反映が見える |
| 4 | mode 絞り込み GET | mode 別に表示 |
| 5 | 許可 origin からの CORS | `Access-Control-Allow-Origin` が**その origin で**返る |
| 6 | GitHub Pages 実機からプレイ→送信→反映 | 一連が通る |

start-run の例:
```bash
curl -i -X POST 'https://pfgutguzgskdtntoovkc.supabase.co/functions/v1/start-run' \
  -H 'apikey: sb_publishable_2KnduyX5juuv05SGAlXqPw_aqwSRzQT' \
  -H 'Authorization: Bearer sb_publishable_2KnduyX5juuv05SGAlXqPw_aqwSRzQT' \
  -H 'Origin: https://anyumori0314-max.github.io' \
  -H 'Content-Type: application/json' \
  -d '{"mode":"endless","anonymous_player_id":"e2e-test-1"}'
# 期待: 200 + {"run_id":"...","server_started_at":"...","mode":"endless","expires_at":"..."}
```

### 9-B. 異常系（指示書の 9 ケース）

| # | ケース | 操作 | 期待 |
|---|---|---|---|
| 1 | 同一 run_id の 2 回目送信 | 同じ run_id で `submit-score` を 2 回 | 2 回目 **409**（`already_submitted`） |
| 2 | 存在しない run_id | 出鱈目な run_id で `submit-score` | **409**（`run_not_found`） |
| 3 | Training 送信 | mode=training で `submit-score` | **400**（`training is not ranked`） |
| 4 | 異常な score | score=-1 や score>1e9、score/duration 矛盾 | **422**（`validation failed`） |
| 5 | 制御文字入り player_name | `player_name:"a b"` 等 | **400**（`invalid player_name`） |
| 6 | 未許可 Origin | `Origin: https://evil.example` | ACAO を**返さない**（ブラウザがブロック） |
| 7 | start-run 連投 | 同一 anon で 1 分に 13 回以上 | **429** + `Retry-After` |
| 8 | anon 直接 INSERT | anon key で `leaderboard_scores` へ INSERT（PostgREST） | **RLS/権限で拒否** |
| 9 | anon 直接 RPC | anon key で `submit_score_atomic` を RPC 直叩き | **EXECUTE 権限無しで拒否** |

異常系の代表例（#1 二重送信 / #6 未許可 origin / #8 直接 INSERT）:
```bash
# #6 未許可 origin: レスポンスに Access-Control-Allow-Origin が無いこと
curl -i -X POST 'https://pfgutguzgskdtntoovkc.supabase.co/functions/v1/start-run' \
  -H 'apikey: sb_publishable_2KnduyX5juuv05SGAlXqPw_aqwSRzQT' \
  -H 'Authorization: Bearer sb_publishable_2KnduyX5juuv05SGAlXqPw_aqwSRzQT' \
  -H 'Origin: https://evil.example' \
  -H 'Content-Type: application/json' -d '{"mode":"endless"}'
# 期待: ヘッダーに Access-Control-Allow-Origin が出ない

# #8 anon 直接 INSERT（RLS/権限で拒否されること）
curl -i -X POST 'https://pfgutguzgskdtntoovkc.supabase.co/rest/v1/leaderboard_scores' \
  -H 'apikey: sb_publishable_2KnduyX5juuv05SGAlXqPw_aqwSRzQT' \
  -H 'Authorization: Bearer sb_publishable_2KnduyX5juuv05SGAlXqPw_aqwSRzQT' \
  -H 'Content-Type: application/json' \
  -d '{"player_name":"HACK","score":999999}'
# 期待: 401/403/42501 等で拒否（INSERT 成功しない）

# #9 anon 直接 RPC（EXECUTE 拒否）
curl -i -X POST 'https://pfgutguzgskdtntoovkc.supabase.co/rest/v1/rpc/submit_score_atomic' \
  -H 'apikey: sb_publishable_2KnduyX5juuv05SGAlXqPw_aqwSRzQT' \
  -H 'Authorization: Bearer sb_publishable_2KnduyX5juuv05SGAlXqPw_aqwSRzQT' \
  -H 'Content-Type: application/json' -d '{}'
# 期待: 権限不足で拒否（EXECUTE は service_role のみ）
```

---

## 10. 既存データ確認

- [ ] 適用前後でランキング件数を比較（減っていない）
- [ ] 既存レコードが残っている
- [ ] mode 未設定の旧レコードが `legacy` として扱われている
- [ ] SELECT ランキングが引き続き表示される

---

## 11. 🛑 停止条件（いずれかで以降を進めず停止）

- migration 適用が失敗
- 既存ランキング件数が減少
- RLS が anon の直接 INSERT を許可してしまう
- Edge Function が 500 を返す
- service_role 権限がフロントから利用可能になっている
- 正常スコアが登録できない
- ロールバック手順が不明

→ 停止時は `scripts/supabase/rollback.sql` とバックアップで復旧を検討。

---

## 12. ロールバック（安全停止・非破壊）

> Codex High 1 対応：ロールバックは**破壊的撤去をしない**。`runs` テーブル・追加列・RPC は
> データ保全と再適用性のため**残す**。機能停止は Edge Functions の undeploy が主手段。

- **Functions（主手段）**: `supabase functions delete submit-score start-run challenges`
  → service_role 経由の唯一の呼び出し元が消え、RPC は実質未使用になる。
- **クライアント**: `js/config.js` の `EDGE_FUNCTIONS_BASE = ''` に戻す（直接 INSERT には戻さない）。
- **DB（任意・安全側の再表明）**: `scripts/supabase/rollback.sql`
  - `runs` を**撤去しない／行を消さない**。追加列・RPC も**撤去しない**。
  - anon / authenticated の書き込み権限を**与えない状態を再表明**（直接 INSERT を再開しない）。
  - RPC の一般利用を**禁止のまま維持**（EXECUTE は service_role のみ）。
  - 既存ランキングデータは**一切削除しない**。
- 完全撤去（テーブル/列/関数の物理削除）は二重送信防止・レート制限・監査履歴を失い再適用性も損なうため、
  **後日の明示的な保守作業として別レビューで判断**する（既定では行わない）。

---

## 13. 🛑 Phase 11 へ進む前提条件（ゲート・Codex Low）

> **Phase 6 本番 E2E の正常系・異常系がすべて合格するまで、Phase 11 以降の実装開始、PR マージ、
> 本番公開判断へ進まない。**

以下のいずれかに該当する間は **Phase 11 へ進まない**:

- migration 適用が失敗した
- 適用前後で既存ランキング件数が**不正に減少**した
- anon / authenticated が `leaderboard_scores` へ**直接書き込み可能**になっている
- anon / authenticated が `submit_score_atomic` RPC を**実行可能**になっている（post_apply_verify E2 が FAIL）
- 正常な `submit-score` が**失敗**する
- 同一 run_id の**再送が拒否されない**（409 にならない）
- **CORS の許可・拒否が仕様と異なる**（許可 origin に ACAO が返らない／未許可 origin に ACAO が返る）
- **start-run のレート制限が動作しない**（連投で 429 + Retry-After にならない）
- **ロールバック判断が必要**な状態にある
- **未解決の Critical / High / Medium** がある

→ 上記が解消し、手順 9（E2E）正常系・異常系がすべて合格して初めて Phase 11 へ進む。

---

## 秘密情報の取り扱い（厳守）

- service_role key・`RATE_LIMIT_IP_SALT` の**実値を、このファイル・報告・Git・Markdown に書かない**。
- フロントは publishable(anon) key のみ使用。service_role は Edge Function の環境変数だけ。
- 秘密値は**コマンド引数に直接書かない**（履歴に残さない）。`--help` で安全な方式を確認、無ければ Dashboard。
- `.env` は commit しない。一時ファイルは Git 管理外＋作業後に安全に削除。
- `supabase secrets list` は**キー名のみ**確認に使う（値は表示しない）。
