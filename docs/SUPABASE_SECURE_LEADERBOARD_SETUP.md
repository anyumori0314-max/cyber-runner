# Supabase セキュアランキング 設定手順（Phase 6）

> ⚠️ **本番適用はレビュー後**に行ってください。本リポジトリには migration / Edge Function が
> **存在するだけ**で、自動適用・自動 deploy は一切行いません。
> このプロジェクトの作業では `supabase db push` / migration 適用 / `functions deploy` を**実行していません**。

## 目的

- ブラウザからの `leaderboard_scores` への**直接 INSERT を廃止**する。
- スコア送信を **submit-score Edge Function（service_role）**経由に限定し、
  異常値拒否・重複防止・レート制限・mode 検証を行う。
- ランキング SELECT は公開可能な範囲のみに保つ。
- 既存ランキングは破壊せず **legacy データとして保持**する。

## 構成

```
supabase/
├── migrations/20260627090000_secure_leaderboard.sql
└── functions/
    ├── _shared/cors.ts
    ├── _shared/score-validation.js   # Node テストと共有する純粋検証ロジック
    ├── start-run/index.ts            # run 発行（サーバー権威）
    ├── submit-score/index.ts         # 検証通過後にのみ INSERT
    └── challenges/index.ts           # UTC 日付 / 週 / seed の時刻権威
```

クライアント側:
```
js/services/run-service.js        # start-run 呼び出し + submit-score 送信（直接 INSERT しない）
js/services/challenge-service.js  # challenges 取得 + ローカル UTC フォールバック
js/config.js  -> EDGE_FUNCTIONS_BASE = ''  # 空 = 未配備（ローカルフォールバックで動作）
```

## 1. 適用前の確認

- [ ] 対象プロジェクト（ref）が**本番かステージングか**を確認。まずステージング推奨。
- [ ] `supabase link` 済みのプロジェクト ref を確認。
- [ ] 既存 `leaderboard_scores` のスキーマ（列・制約・RLS ポリシー）を控える。
- [ ] 既存の「anon が INSERT できる」ポリシー名を確認（migration の DROP 対象に追記）。

## 2. バックアップ

```bash
# 既存データのエクスポート（例）
supabase db dump --data-only -f backup_leaderboard_$(date +%Y%m%d).sql
# もしくは Supabase ダッシュボード > Database > Backups からスナップショットを取得
```
- [ ] バックアップファイルを安全な場所に保管。
- [ ] 行数を記録（適用後に件数が減っていないことを確認するため）。

## 3. RLS 変更（migration 内容）

`20260627090000_secure_leaderboard.sql` は以下を行う（**非破壊・冪等**）:

- `runs` テーブル作成（RLS 有効・クライアントポリシーなし = service_role のみ）。`ip_hash` 列を含む
  （生 IP は保存せず、salt 付き SHA-256 ハッシュのみ。レート制限の集計用インデックス付き）。
- `leaderboard_scores` に列追加（`run_id, anonymous_player_id, mode, duration_ms, game_version, metrics`）。
- 既存行を `mode = 'legacy'` でバックフィル（legacy 保持）。
- ランキング用インデックス + `run_id` 一意インデックス。
- **ポリシーの一括監査・撤去（名前非依存）**: `pg_policies` を `schemaname='public'` かつ
  対象テーブルに限定して走査し、`leaderboard_scores` / `runs` の**既存ポリシーを全削除**してから、
  安全な **SELECT 公開ポリシーのみ再作成**する（別名の INSERT/UPDATE/DELETE ポリシーが残っていても確実に塞ぐ）。
- **テーブル権限でも多層防御**: `anon` / `authenticated` から `INSERT/UPDATE/DELETE` を `REVOKE`、
  `SELECT` のみ `GRANT`（ロール存在時のみ実行）。
- **原子的スコア登録 RPC `submit_score_atomic()`** を作成（High 1）。`FOR UPDATE` で run をロックし、
  存在/二重送信/期限/mode/anon/duration を検証 → `leaderboard_scores` へ INSERT → `runs.submitted=true` を
  **単一トランザクション**で行う。`SECURITY DEFINER` + `search_path=public`。**EXECUTE は service_role のみ**
  （`anon`/`authenticated`/`public` からは REVOKE。PostgREST 経由で anon が直接呼べない）。

> 既存の anon INSERT ポリシー名が分からなくても、`pg_policies` 監査で**名前に依存せず**撤去される。
> ただし適用前に既存ポリシー一覧を控えておくこと（ロールバック時の復元に使う）。

適用:
```bash
# 反映予定の差分を確認
supabase db diff
# 適用（レビュー後）
supabase db push
```

## 4. Edge Function 環境変数

submit-score / start-run は **service_role key** を環境変数から取得する（フロントには置かない）。

```bash
supabase secrets set SUPABASE_URL="https://<ref>.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"

# CORS 許可 origin（カンマ区切り。ワイルドカードは使わない）
supabase secrets set ALLOWED_ORIGINS="https://anyumori0314-max.github.io,http://localhost:8127,http://127.0.0.1:8127"

# start-run レート制限：IP ハッシュ用 salt（秘密値。生 IP は保存しない）
supabase secrets set RATE_LIMIT_IP_SALT="<長いランダム文字列>"

# （任意）レート制限の上限・窓を上書きする場合
# supabase secrets set START_RUN_WINDOW_MS="60000"
# supabase secrets set START_RUN_MAX_PER_ANON="12"
# supabase secrets set START_RUN_MAX_PER_IP="30"
```

> **`.env` 例（値はリポジトリに保存しない。例示のみ）**
> ```text
> ALLOWED_ORIGINS=https://anyumori0314-max.github.io,http://localhost:8127,http://127.0.0.1:8127
> RATE_LIMIT_IP_SALT=<secret>
> ```

- [ ] `SUPABASE_SERVICE_ROLE_KEY` は**サーバー（Edge Function）専用**。リポジトリ・フロントに含めない。
- [ ] `RATE_LIMIT_IP_SALT` も**サーバー専用の秘密値**。未設定時は IP 次元のレート制限が無効化され、
      `anonymous_player_id` 次元のみで制限する（生 IP は保存しない設計）。
- [ ] `ALLOWED_ORIGINS` 未設定時はブラウザからは**どの origin も許可されない**（ACAO を返さない）安全側。
      本番 origin（GitHub Pages）と開発 origin（localhost/127.0.0.1）を明示的に列挙する。
- [ ] サーバー間呼び出し（`Origin` ヘッダー無し）は CORS の対象外（ブラウザのみが CORS で制限される）。

## 5. デプロイ手順

```bash
supabase functions deploy start-run
supabase functions deploy submit-score
supabase functions deploy challenges
```

クライアント側の有効化:
- `js/config.js` の `EDGE_FUNCTIONS_BASE` を `'<SUPABASE_URL>/functions/v1'` に設定。
  （空のままなら未配備として安全に動作し、送信は「Online ranking is not enabled in this build.」表示。）

## 6. 動作確認

- [ ] 未配備状態（`EDGE_FUNCTIONS_BASE=''`）でゲームが最後まで遊べる。
- [ ] 配備後、プレイ開始で `start-run` が 200 を返す。
- [ ] GAME OVER → SEND SCORE で `submit-score` が 200、`leaderboard_scores` に1行増える。
- [ ] 同じ run_id で再送信が **409**（重複拒否）。**並行送信でも 1 件だけ成功**（原子 RPC）。
- [ ] 異常 score / 不正 mode が **422**。制御/不可視/bidi 文字入り player_name が **400**。
- [ ] 送信連投が **429**（submit レート制限）。`start-run` の大量呼び出しが **429 + Retry-After**（start レート制限）。
- [ ] ランキング GET（overall / daily / weekly / mode 絞り込み）が表示できる。
- [ ] 許可 origin からは `Access-Control-Allow-Origin` が**その origin で**返る。未許可 origin には**返らない**。
- [ ] ランキング GET が失敗してもゲームは継続し、**直近キャッシュ**または空表示にフォールバックする（架空データは出さない）。
- [ ] anon キーで `leaderboard_scores` へ直接 INSERT を試すと **RLS / 権限で拒否**される。
- [ ] anon キーで `submit_score_atomic` RPC を直接呼んでも **EXECUTE 権限が無く拒否**される。

## 7. ロールバック手順

```sql
-- レビュー後・手動で実行（既存ランキングデータは削除しない）
drop function if exists public.submit_score_atomic(
  uuid, text, text, text, integer, integer, integer, text, text, jsonb, timestamptz, integer);
drop table if exists public.runs;
alter table public.leaderboard_scores
  drop column if exists run_id,
  drop column if exists anonymous_player_id,
  drop column if exists mode,
  drop column if exists duration_ms,
  drop column if exists game_version,
  drop column if exists metrics;
-- 旧 INSERT ポリシー / テーブル権限は、適用前に控えた元の定義に従って復元する
-- （本 migration はポリシーを全削除するため、自動復元はしない）。
-- SELECT 公開ポリシー "public read leaderboard" を残すかは運用方針に従う。
```
- Edge Function を戻す: `supabase functions delete submit-score start-run challenges`
- クライアント: `EDGE_FUNCTIONS_BASE` を `''` に戻す（直接 INSERT には**戻さない**）。
- 注意: ロールバックで `runs` を drop すると過去 run の二重送信防止情報も失われる。
  既存スコア（`leaderboard_scores`）自体は削除されない。

## セキュリティ注意

- **service_role key をフロントへ置かない**（Edge Function 環境変数のみ）。
- フロントは publishable(anon) key のみ使用。
- 直接 INSERT には戻さない（不正対策が無効化されるため）。
- **本番適用はレビュー後**に実施する。
