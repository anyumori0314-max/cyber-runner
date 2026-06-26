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

// ===================================
// ゲーム定数（Stage 3: 旧 script.js から集約 / 値はすべて従来と同一）
// ===================================

// ====== キャンバス / プレイヤー / 障害物サイズ ======
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;
export const PLAYER_WIDTH = 40;
export const PLAYER_HEIGHT = 40;
export const OBSTACLE_WIDTH = 50;
export const OBSTACLE_HEIGHT = 50;

// ====== 速度 / 出現率 ======
export const INITIAL_SPEED = 3;
export const MAX_SPEED = 12;
export const INITIAL_SPAWN_RATE = 0.02; // 障害物出現確率
export const MAX_SPAWN_RATE = 0.08;
export const INITIAL_POWERUP_SPAWN = 0.002;
export const MAX_POWERUP_SPAWN = 0.01;

// ====== Delta / speed 調整用定数 ======
// 単位速度 (gameState.speed の 1.0) をピクセル/秒に変換する係数（既存挙動に合わせて 60）。
export const SPEED_UNIT_TO_PX_PER_SEC = 60;
// プレイヤーの移動速度（px/秒）。既存値 360 を定数化。
export const PLAYER_SPEED_PX_PER_SEC = 360;
// 1フレームあたりの最大 delta 秒（大きなジャンプを抑制して安定化）
export const MAX_DELTA_TIME = 0.1;
export const TARGET_FPS = 60;
// 初期障害物速度（論理単位を使う場合の参考値）
export const INITIAL_OBSTACLE_SPEED = INITIAL_SPEED;

// ====== エネルギーコア関連定数 ======
export const ENERGY_CORE_SPAWN_RATE = 0.03; // 本番用の出現率
export const ENERGY_CORE_SCORE = 100; // 基本スコア（コア取得 +100）
export const ENERGY_CORE_WIDTH = 20;
export const ENERGY_CORE_HEIGHT = 20;

// ====== ボーナス / パワーアップ定数 ======
export const BONUS_SCORE = 50; // ボーナスパワーアップ取得 +50
export const POWERUP_SHIELD_DURATION_MS = 8000; // シールド効果時間（8秒）
export const POWERUP_SLOW_DURATION_MS = 6000; // スロー効果時間（6秒）
export const POWERUP_SLOW_FACTOR = 0.5; // スロー時の速度係数

// ====== コンボ関連定数 ======
export const COMBO_TIMEOUT = 5; // コンボリセット時間（秒）
export const COMBO_MULTIPLIERS = {
    0: 1.0,
    5: 1.5,
    10: 2.0,
    20: 3.0
}; // コンボ数に応じた倍率

// ====== ランク定義 ======
export const RANK_THRESHOLDS = [
    { rank: 'S', score: 3000, message: '完璧だ！君はサイバーの支配者だ！' },
    { rank: 'A', score: 2000, message: 'すばらしい！もう一度挑戦できるな' },
    { rank: 'B', score: 1000, message: 'いい動きだ。次は頑張ろう' },
    { rank: 'C', score: 500, message: 'まあまあ。練習だ' },
    { rank: 'D', score: 0, message: 'もう一度。今度こそ！' }
];

// ====== 永続化キー ======
export const HIGH_SCORE_STORAGE_KEY = 'cyberRunnerHighScore';
