// ===================================
// config.js — 設定値の集約（Stage 1）
// publishable key は「公開前提の設定値」。service_role key は絶対に使用しない。
// アクセス制御は Supabase 側の RLS が前提。
// ===================================

// ====== Supabase 接続情報 ======
export const SUPABASE_URL = 'https://pfgutguzgskdtntoovkc.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_2KnduyX5juuv05SGAlXqPw_aqwSRzQT'; // publishable (anon) key
export const LEADERBOARD_TABLE = 'leaderboard_scores';
export const LEADERBOARD_LIMIT = 10; // 取得する上位件数

// ====== プレイヤー名 ======
export const PLAYER_NAME_MAX_LENGTH = 12;
export const DEFAULT_PLAYER_NAME = 'ANONYMOUS';

// ====== 送信データ検証用の上限・許可値 ======
// 通常プレイでは到達しない防御的な上限（不正値・破損値の送信を防ぐためのサニティ境界）。
export const MAX_SCORE = 1000000000;
export const MAX_COMBO = 1000000;
export const VALID_RANKS = ['S', 'A', 'B', 'C', 'D'];
