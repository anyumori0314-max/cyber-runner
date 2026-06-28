# Supabase セキュアランキング 設定手順（Phase 6）

> ⚠️ **本番適用はレビュー後**に行ってください。本リポジトリには migration / Edge Function が
> **存在するだけ**で、自動適用・自動 deploy は一切行いません。
> このプロジェクトの作業では `supabase db push` / migration 適用 / `functions deploy` を**実行していません**。

> 📋 **本番反映の実行手順は [PHASE_6_PRODUCTION_RUNBOOK.md](./PHASE_6_PRODUCTION_RUNBOOK.md) に集約**しました
> （承認ゲート・正常/異常 E2E チェックリスト付き）。本ドキュメントは設計・背景の説明、ランブックは実行手順です。
> 付随する SQL ヘルパー（適用前キャプチャ / 適用後検証 / ロールバック）は `scripts/supabase/` にあります:
> - `scripts/supabase/preflight_capture.sql`（READ-ONLY・適用前の件数/ポリシー/権限の記録）
> - `scripts/supabase/post_apply_verify.sql`（READ-ONLY・適用後の DB 検証）
> - `scripts/supabase/rollback.sql`（手動ロールバック・既存データは削除しない）
>
> **状態（2026-06-28 時点）: 未適用 / NOT YET APPLIED。** 本番への `db push` / `functions deploy` /
> `secrets set` は未実行。CLI もこの作業環境には未インストール（`supabase: command not found`）。

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

> ⚠️ **秘密値の履歴露出に注意（Codex Medium 3）。** 上の `secrets set` 例は形を示すもので、
> `SUPABASE_SERVICE_ROLE_KEY` / `RATE_LIMIT_IP_SALT` の**実値を引数に直接書くとシェル履歴・ログ・
> プロセス引数に残る**。実運用では **`supabase secrets set --help` で値を引数に書かない方式を確認**し、
> 無ければ **Supabase Dashboard の Secrets 画面**で設定する。一時ファイルは Git 管理外＋作業後に削除。
> 値そのものは記録せず「設定済みか否か」だけを残す。詳細手順は `docs/PHASE_6_PRODUCTION_RUNBOOK.md` 手順 6。

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

## 7. ロールバック手順（安全停止・非破壊 / Codex High 1）

> ロールバックは**破壊的撤去をしない**。`runs` テーブル・追加列・RPC は、二重送信防止・レート制限・
> 監査情報の保全と再適用性のため**残す**。正式手順は `scripts/supabase/rollback.sql` を参照。

- **機能停止（主手段）**: Edge Functions を undeploy
  `supabase functions delete submit-score start-run challenges`
  → service_role 経由の唯一の呼び出し元が消え、RPC は実質未使用になる。
- **クライアント**: `EDGE_FUNCTIONS_BASE` を `''` に戻す（直接 INSERT には**戻さない**）。
- **DB（任意・安全側の再表明）**: `scripts/supabase/rollback.sql`
  - `runs` を**撤去しない／行を消さない**。追加列・RPC も**撤去しない**。
  - anon / authenticated に書き込み権限を**与えない状態を再表明**（直接 INSERT を再開しない）。
  - RPC の一般利用を**禁止のまま維持**（EXECUTE は service_role のみ）。既存スコアは削除しない。
- 完全撤去（テーブル/列/関数の物理削除）は履歴・再適用性を損なうため**既定では行わない**。
  必要時のみ、後日の明示的な保守作業として別レビューで判断する（バックアップ取得後）。

## セキュリティ注意

- **service_role key をフロントへ置かない**（Edge Function 環境変数のみ）。
- フロントは publishable(anon) key のみ使用。
- 直接 INSERT には戻さない（不正対策が無効化されるため）。
- **本番適用はレビュー後**に実施する。
