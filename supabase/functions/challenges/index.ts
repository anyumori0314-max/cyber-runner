// ===================================
// supabase/functions/challenges/index.ts
//   全ユーザー共通のデイリー/ウィークリーチャレンジの「時刻権威」を提供する。
//   返却: UTC 日付・ISO 週番号・seed・サーバー時刻。
//   チャレンジ定義（カタログ）はクライアントが保持し、seed からマッピングする
//   （= カタログ重複を避けつつ、全ユーザーで同じ seed を共有できる）。
//
//   PC 時刻変更による不正は、このサーバー seed を使う場合のみ完全に防げる。
//   未配備時はクライアントがローカル UTC でフォールバックする。
// ===================================

import { handleOptions, jsonResponse } from "../_shared/cors.ts";

// 文字列から決定的な 32bit 整数 seed を作る（FNV-1a 風）。
function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ISO 週番号（UTC 基準）。
function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // 月曜=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // 木曜へ
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return { year: date.getUTCFullYear(), week };
}

// @ts-ignore Deno グローバル
Deno.serve((req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const now = new Date();
  const utcDate = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const { year, week } = isoWeek(now);
  const isoWeekStr = `${year}-W${String(week).padStart(2, "0")}`;

  return jsonResponse({
    source: "server",
    server_time: now.toISOString(),
    utc_date: utcDate,
    iso_week: isoWeekStr,
    daily_seed: hashSeed("daily:" + utcDate),
    weekly_seed: hashSeed("weekly:" + isoWeekStr),
  }, 200, req);
});
