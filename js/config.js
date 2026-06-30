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
export const OPTIONS_STORAGE_KEY = 'cyberRunnerOptions';
export const ACHIEVEMENTS_STORAGE_KEY = 'cyberRunnerAchievements';
export const STATS_STORAGE_KEY = 'cyberRunnerStats';

// ===================================
// Phase 1〜5: ユーザー向け機能拡張の定数（値はここに集約）
// ===================================

// ====== Phase 1: タイトルランキング ======
export const TITLE_LEADERBOARD_LIMIT = 5; // タイトル画面の上位表示件数

// ====== Phase 2: 効果時間（秒・gameTime基準。一時停止で凍結させるため秒で管理） ======
export const POWERUP_SHIELD_DURATION_SEC = 8;
export const POWERUP_SLOW_DURATION_SEC = 6;

// ====== Phase 2: オプション既定値 ======
export const AUDIO_BASE_VOLUME = 0.18; // マスター音量の基準値（従来の master gain）
export const DEFAULT_OPTIONS = {
    soundEnabled: true,
    soundVolume: 0.8, // 0.0〜1.0（AUDIO_BASE_VOLUME に乗算）
    screenShakeEnabled: true,
    particlesEnabled: true,
    showControls: true,
    // Phase 12: 画面の操作ボタン。'auto' = タッチ端末で ON / PC で OFF（実体は main が解決）。
    touchControls: 'auto'
};

// ====== Phase 3: 演出 ======
export const COUNTDOWN_SECONDS = 3; // 開始カウントダウン（3,2,1,GO!）
export const COMBO_WARNING_SECONDS = 1.0; // コンボ終了まで残りこの秒数で警告
export const NEAR_MISS_SCORE = 25; // ニアミス加点
export const NEAR_MISS_DISTANCE = 30; // ニアミス判定の水平距離しきい値(px)
export const POPUP_TTL = 1.0; // スコアポップアップの表示秒数

// ====== Phase 4-1: ダッシュ ======
export const DASH_DISTANCE = 180; // ダッシュ移動距離(px)
export const DASH_COOLDOWN = 3.0; // クールタイム(秒)
export const DASH_INVULN_DURATION = 0.35; // ダッシュ無敵時間(秒)

// ====== Phase 4-2: 新障害物（出現開始レベル・パラメータ） ======
export const LASER_START_LEVEL = 3;
export const LASER_WARNING_TIME = 1.2; // 警告表示時間(秒)：回避猶予
export const LASER_ACTIVE_TIME = 0.6; // レーザー発生時間(秒)
export const LASER_WIDTH = 48; // 縦レーザー帯の横幅(px)（左右移動で回避）
export const LASER_SPAWN_RATE = 0.006; // フレーム確率(shouldSpawnで補正)

export const HOMING_START_LEVEL = 4;
export const HOMING_SIZE = 34;
export const HOMING_DRIFT_SPEED = 70; // プレイヤー方向への水平追尾速度(px/秒・緩やか)
export const HOMING_FALL_FACTOR = 0.7; // 落下速度係数（基準速度に対する）
export const HOMING_SPAWN_RATE = 0.006;

export const GAPWALL_START_LEVEL = 5;
export const GAPWALL_HEIGHT = 28;
export const GAPWALL_GAP_WIDTH = 130; // 隙間の幅(px)（プレイヤー40pxより十分広い）
export const GAPWALL_FALL_FACTOR = 0.85;
export const GAPWALL_SPAWN_RATE = 0.004;

// ====== Phase 4-3: 新パワーアップ ======
export const POWERUP_MAGNET_DURATION = 6.0; // MAGNET 効果(秒)
export const MAGNET_PULL_SPEED = 320; // コアを引き寄せる速度(px/秒)
export const POWERUP_DOUBLE_DURATION = 8.0; // DOUBLE SCORE 効果(秒)
export const DOUBLE_SCORE_MULTIPLIER = 2; // 効果中の新規獲得スコア倍率
// パワーアップ出現の重み（合計に対する相対比率。新種は控えめ・DASH CHARGEは希少）
export const POWERUP_WEIGHTS = {
    shield: 22,
    slow: 18,
    bonus: 18,
    magnet: 12,
    bomb: 8,
    double: 12,
    dashcharge: 10
};

// ====== Phase 5: ミッション / 実績 ======
export const MISSION_REWARD = 500; // ミッション達成報酬（基本）

// ===================================
// Phase 6〜10: プラットフォーム拡張の定数（値はここに集約）
// ===================================

// ====== Phase 6: セキュアランキング / Edge Functions ======
// Edge Functions のベース URL。空文字 = 未配備（クライアントはローカルフォールバックで継続）。
// 配備後に `${SUPABASE_URL}/functions/v1` を設定する（詳細は docs/SUPABASE_SECURE_LEADERBOARD_SETUP.md）。
export const EDGE_FUNCTIONS_BASE = '';
export const GAME_VERSION = '1.0.0'; // スコア送信に含めるクライアント版数
export const ANON_ID_STORAGE_KEY = 'cyberRunnerAnonId'; // 端末ごとの匿名 ID
export const RUN_LOCAL_EXPIRY_MS = 10 * 60 * 1000; // ローカル run の有効期限（10分）
export const LEADERBOARD_PERIODS = ['overall', 'daily', 'weekly']; // ランキング期間
// ランキング GET 失敗時のフォールバック用キャッシュ（最後に正常取得した結果を保持）。
export const LEADERBOARD_CACHE_KEY = 'cyberRunnerLeaderboardCache';
export const LEADERBOARD_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // これより古いキャッシュは「過去のデータ」と表示

// ====== Phase 7: ゲームモード ======
export const GAME_MODE_IDS = ['endless', 'timeattack', 'hardcore', 'training'];
export const DEFAULT_GAME_MODE = 'endless';
export const TIME_ATTACK_DURATION_SEC = 60; // タイムアタックの制限時間

// ====== Phase 8: 成長 / カスタマイズ ======
export const PROFILE_STORAGE_KEY = 'cyberRunnerProfile';
export const PROGRESS_STORAGE_KEY = 'cyberRunnerProgress';
export const COSMETICS_STORAGE_KEY = 'cyberRunnerCosmetics';
// XP 獲得の基本配分（ゲームスコアとは分離して管理する）
export const XP_PER_RUN = 20; // プレイ完了
export const XP_PER_SCORE = 0.02; // スコア1点あたり
export const XP_PER_MISSION = 50; // ミッション達成
export const XP_PER_CHALLENGE = 80; // チャレンジ達成
export const XP_PER_ACHIEVEMENT = 40; // 実績解除（新規1件あたり）

// ====== Phase 9: チャレンジ ======
export const CHALLENGES_STORAGE_KEY = 'cyberRunnerChallenges';

// ====== Phase 10: ゴースト / リプレイ / 共有 ======
export const REPLAY_DB_NAME = 'cyberRunnerReplays';
export const REPLAY_STORE_NAME = 'ghosts';
export const GHOST_SAMPLE_INTERVAL_SEC = 0.1; // ゴースト記録の固定間隔（秒）
export const GHOST_MAX_SAMPLES = 6000; // 1リプレイの最大サンプル数（容量上限の保険）

// ===================================
// Phase 11〜13: ゲーム拡張の定数（値はここに集約）
// ※ Phase 11 のゲームバランス値（ウェーブ/演出/休憩時間・ボス HP・各ボス攻撃間隔・
//   イベント効果/間隔・Hardcore 補正）は config/balance-presets.js の active preset が
//   唯一の正本。Wave/Boss/Event の各 model/controller/view はこれらを直接 import せず、
//   必ず model/balance.js のアクセサ経由で取得する（balance_version と実値を必ず一致させる）。
//   ここに置く値は「既定 preset と同一の現在値」の単一定義であり、無断変更しない。
// ===================================

// ====== Phase 11: ウェーブ（時間ではなくウェーブ進行で難易度が上がる層） ======
// ウェーブ列（1サイクル）。最後はボス戦。Endless はサイクルで繰り返す。
export const WAVE_SEQUENCE = ['normal', 'homing', 'laser', 'gapwall', 'boss'];
export const WAVE_DURATION_SEC = 14; // 通常ウェーブの長さ（deltaTime 基準・pause で凍結）
export const WAVE_INTRO_SEC = 1.8; // ウェーブ開始演出
export const WAVE_OUTRO_SEC = 1.0; // ウェーブ終了演出
export const WAVE_INTERMISSION_SEC = 2.4; // ウェーブ間の休憩
export const BOSS_WARNING_SEC = 2.2; // ボス出現前の警告
export const BOSS_DEFEAT_SEC = 2.2; // ボス撃破演出
export const CYCLE_DIFFICULTY_STEP = 0.12; // サイクルごとの難易度上昇係数（速度などへ加算的に乗る）
export const CYCLE_BOSS_HP_STEP = 0.25; // サイクルごとのボス HP 増加係数

// ウェーブ別の追加出現率（既存 spawn とは別枠で、そのウェーブの主役障害物を増やす）。
export const WAVE_SPAWN_BOOST = {
    normal: 0,
    homing: 0.010,
    laser: 0.010,
    gapwall: 0.006
};

// ====== Phase 11: ボス（3種。サイクルごとに巡回） ======
export const BOSS_SEQUENCE = ['firewall', 'worm', 'gate'];
export const BOSS_BAR_MARGIN = 16; // HP バーの画面余白(px)

// ボス1: Firewall Core — 左右から警告レーザー。安全地帯が移動。コア取得でダメージ。
export const BOSS_FIREWALL_HP = 6; // コア取得 1 回 = 1 ダメージ
export const BOSS_FIREWALL_LASER_INTERVAL = 2.6; // レーザー発射間隔(秒)
export const BOSS_FIREWALL_MAX_LASERS = 2; // 同時レーザー上限（安全地帯を必ず残す）
export const BOSS_FIREWALL_SAFE_WIDTH = 150; // 安全地帯の最小幅(px)（プレイヤー40pxより十分広い）
export const BOSS_FIREWALL_CORE_INTERVAL = 1.6; // ダメージ用コアの供給間隔(秒)

// ボス2: Data Worm — 上部を左右移動し追尾障害物を生成。ダッシュ接触でダメージ。
export const BOSS_WORM_HP = 5; // ダッシュ有効接触 1 回 = 1 ダメージ
export const BOSS_WORM_WIDTH = 120;
export const BOSS_WORM_HEIGHT = 40;
export const BOSS_WORM_SPEED = 150; // 左右移動速度(px/秒)
export const BOSS_WORM_SPAWN_INTERVAL = 2.0; // 追尾障害物の生成間隔(秒)
export const BOSS_WORM_MAX_MINIONS = 4; // 同時追尾障害物の上限
export const BOSS_WORM_ATTACK_WARNING = 0.9; // 生成前の警告時間(秒)
export const BOSS_WORM_HIT_COOLDOWN = 0.8; // 連続ダメージ防止（秒）

// ボス3: Security Gate — 複数の隙間パターンを切替。正しい隙間通過でダメージ。
export const BOSS_GATE_HP = 5; // 正しい通過 1 回 = 1 ダメージ
export const BOSS_GATE_WALL_INTERVAL = 3.2; // 隙間壁の供給間隔(秒)
export const BOSS_GATE_MIN_GAP = 120; // 最小通過幅(px)（物理的に通過可能を保証）
export const BOSS_GATE_FALL_FACTOR = 0.8; // 隙間壁の落下速度係数

// ====== Phase 11: ランダムイベント（同時に1つのみ） ======
export const EVENT_IDS = ['core_rush', 'double_score', 'high_speed', 'dark_zone', 'laser_storm'];
export const EVENT_DURATION_SEC = 9; // イベント効果時間
export const EVENT_MIN_INTERVAL_SEC = 16; // イベント終了後の最短クールタイム
export const EVENT_FIRST_DELAY_SEC = 12; // 初回イベントまでの猶予
export const EVENT_WARNING_SEC = 1.2; // HIGH SPEED など事前警告が要るイベントの警告時間
export const EVENT_CORE_RUSH_MULT = 3.0; // CORE RUSH のコア出現倍率
export const EVENT_HIGH_SPEED_MULT = 1.45; // HIGH SPEED の障害物速度倍率
export const EVENT_DARK_ZONE_RADIUS = 150; // DARK ZONE の視界半径(px)
export const EVENT_LASER_STORM_RATE = 0.018; // LASER STORM の追加レーザー出現率
export const EVENT_LASER_STORM_MAX = 3; // LASER STORM の同時レーザー上限（安全地帯を必ず残す）

// ====== Phase 11: Hardcore のウェーブ／ボス補正（回避不能化は禁止） ======
export const HARDCORE_WAVE_SPEED_FACTOR = 0.8; // ウェーブ進行を速める（時間を短縮）
export const HARDCORE_BOSS_INTERVAL_FACTOR = 0.75; // ボス攻撃間隔を短縮

// ====== Phase 13: 匿名分析（同意キーのみ。送信先は EDGE_FUNCTIONS_BASE を流用） ======
// 初期状態は分析 OFF。明示同意でのみ ON（保存キー）。
export const ANALYTICS_CONSENT_STORAGE_KEY = 'cyberRunnerAnalyticsConsent';
// 分析を送るモード（Training は対象外）。
export const ANALYTICS_MODES = ['endless', 'timeattack', 'hardcore'];
