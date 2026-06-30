# 匿名プレイ分析 プライバシー方針（Phase 13）

Cyber Runner は、ゲームバランス改善のために「匿名・1プレイ1件の要約」を収集できる仕組みを持ちます。
個人を特定する情報は収集しません。

## 分析は初期 OFF
- 初期状態は分析 **OFF**。明示的に同意した場合のみ送信します。
- 同意しなくても、すべてのゲーム機能（プレイ・ランキング閲覧・送信・実績など）を利用できます。

## 同意方法
- 設定（OPTIONS）画面の「**匿名プレイ分析を許可する**」をオンにします。
- 同意状態は `localStorage` キー `cyberRunnerAnalyticsConsent`（`granted` / `denied`）に保存します。

## 収集項目（1プレイ終了時に最大 1 件）
`event_id`（1プレイの一意 ID・個人 ID ではない） / `game_version` / `balance_version` / `mode` /
`score` / `duration_ms` / `reached_level` / `max_combo` / `core_count` / `near_miss_count` /
`dash_count` / `death_cause` / `wave_reached` / `boss_reached` / `boss_defeated` /
`powerups_collected` / `pwa_mode` / `device_class` / `created_at`（サーバー側で付与）。

## 収集しない項目
プレイヤー名 / メールアドレス / Supabase ユーザー ID / 匿名プレイヤー ID（ランキング用）/
生 IP アドレス / 正確な位置情報 / ブラウザ指紋 / User-Agent 全文 / 自由入力テキスト /
リプレイデータ / ゴーストデータ / ランキングの `run_id`。

> レート制限が必要な場合でも、**生 IP は保存しません**。サーバー側でソルト付きハッシュ
> （`ip_hash`）を計算し、短時間の連投防止にのみ使用します。集計クエリでも参照しません。

## 利用目的
- モード別の難易度・到達率・終了原因などの母集団傾向の把握。
- `balance_version` 別の比較によるバランス調整の評価。
- 端末区分（`device_class`）・PWA 表示モード別の体験差の把握。
- 個人の追跡・広告・第三者提供には**利用しません**。

## 保存期間（案）
- 既定の保存期間は **180 日** を目安とします（運用ポリシーに応じて調整）。
- 期間超過分は定期的に削除する想定です（例: `delete from gameplay_analytics where created_at < now() - interval '180 days';`）。

## 削除方針
- 収集データは個人と結び付かないため、個別レコードの本人特定削除は想定しません。
- 管理者は上記 SQL により期間ベースで一括削除できます。
- 同意を撤回すると、以後の送信は停止します（既送信の匿名集計値は個人に紐づきません）。

## 送信失敗時の挙動
- 送信はゲーム本体に**一切影響しません**（失敗しても続行・スコア/XP に影響なし）。
- 失敗したデータを**無断で再送しません**（`event_id` はセッション内で送信済み扱い）。
- オフライン時は送信しません。

## 同意撤回方法
- OPTIONS 画面の同チェックを OFF にすると、即座に送信を停止します（いつでも変更可）。

## PWA / オフライン時の挙動
- Service Worker は分析 API（`submit-analytics`）を**キャッシュしません**。
- オフライン時は送信しません（オンライン復帰後の自動再送も行いません）。
- ホーム画面追加（PWA, standalone）でも方針は同じです。`pwa_mode` は standalone/browser の区別のみを記録します。

## 実装メモ
- クライアント: `js/model/analytics.js`（同意・payload 構築）/ `js/services/analytics-service.js`（送信のみ）。
- サーバー: `supabase/functions/submit-analytics/index.ts`（service_role・検証・重複/レート制限）/
  `supabase/migrations/20260628120000_gameplay_analytics.sql`（RLS・CHECK 制約・public SELECT 禁止）。
- 本リポジトリでは**本番 migration 適用・Function deploy・本番 INSERT は行いません**（コードと手順のみ）。
