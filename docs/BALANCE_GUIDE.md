# バランス管理ガイド（Phase 13）

ゲームバランス値を **バージョン単位の preset** として管理します。各プレイの分析には
`balance_version` を記録するため、版ごとの効果を比較できます。

## 構成
- `js/config/balance-presets.js` — `BALANCE_VERSION` と `BALANCE_PRESETS`。
  既定 preset の値は **`config.js` の現在値を参照**して構成（＝現行挙動と完全一致・数値の重複コピーなし）。
- `js/model/balance.js` — 選択中 preset と `BALANCE_VERSION` の**単一参照点（正本）**。
  `getBalanceVersion()` / `getActivePreset()` / `setPreset()` / `resetPreset()` / `describeBalance()` に加え、
  Wave/Boss/Event の各値を返すアクセサ（`getWaveDurationBase()` / `getWaveIntroDuration()` /
  `getWaveOutroDuration()` / `getWaveIntermissionDuration()` / `getBossBaseHp()` /
  `getFirewallAttackIntervalBase()` / `getWormAttackIntervalBase()` / `getGateAttackIntervalBase()` /
  `getBossWarningDuration()` / `getBossDefeatDuration()` / `getEventDurationSec()` /
  `getEventIntervalSec()` / `getHardcoreWaveFactor()` / `getHardcoreBossIntervalFactor()`）。

> **active balance preset が Phase 11 の Wave／Boss／Event のゲーム進行・難易度・時間・倍率・
> 出現率・上限・回避幅のすべての単一正本。**
> `controller/wave-controller.js` / `model/waves.js` / `model/bosses.js` / `model/random-events.js` /
> `view/{wave,boss,event}-view.js` はこれらの値を **`config.js` から直接 import しない**。必ず
> `model/balance.js` のアクセサ経由で取得するため、実際にゲーム処理が使う値と `balance_version` が
> 必ず一致する。（静的走査テスト `M3b-06` が直接 import の再発と未分類 import の追加を検知して失敗させる。）

### balance 対象外として `config.js` に残す定数（理由つき allowlist）
Phase 11 consumer が `config.js` から直接 import してよいのは、**難易度・進行を変えない純粋な
表示／幾何／当たり判定サイズ**だけ。これらは `M3b-06` の `PHASE11_DISPLAY_ALLOWLIST` で明示許可し、
それ以外の `config` 直接 import はテスト失敗にする。

| 定数 | 理由（balance 対象外） |
|---|---|
| `CANVAS_WIDTH` / `CANVAS_HEIGHT` | プレイフィールド寸法（幾何）。位置クランプ計算用で難易度を定義しない |
| `LASER_WIDTH` | Phase 4 の `WarningLaser` entity が所有する帯幅（当たり判定/描画）。entity 定義と一体で、Phase 11 の難易度ノブではない |
| `BOSS_WORM_WIDTH` / `BOSS_WORM_HEIGHT` | Data Worm 本体の描画/当たり判定サイズ |
| `BOSS_BAR_MARGIN` | HP バーの画面余白（レイアウト） |

> 判定基準: **数値の変更が難易度・進行・回避可能性・倍率・出現率・上限に影響するなら balance 対象**
> （preset へ集約）。影響しない純粋な寸法・余白・色・文字列・DOM ID のみ対象外。**曖昧なら balance 側**。
> ※ `game-loop.js` / `difficulty.js` / `entities.js` は Phase 1〜5 の基盤（ダッシュ・基本 spawn・
> entity 物理）であり、本 preset（Phase 11 の Wave/Boss/Event）の対象外。

## 管理対象（既定 preset のキー）
| キー | 由来（config） | 意味 |
|---|---|---|
| `obstacleSpeedInitial` | `INITIAL_SPEED` | 通常障害物の初速 |
| `obstacleSpawnRate` | `INITIAL_SPAWN_RATE` | 障害物出現間隔 |
| `laserWarningTime` | `LASER_WARNING_TIME` | レーザー警告時間 |
| `homingDrift` | `HOMING_DRIFT_SPEED` | 追尾強度 |
| `gapWidth` | `GAPWALL_GAP_WIDTH` | 隙間幅 |
| `powerupSpawnRate` | `INITIAL_POWERUP_SPAWN` | パワーアップ出現率 |
| `dashCooldown` | `DASH_COOLDOWN` | ダッシュクールタイム |
| `waveSequence` | `WAVE_SEQUENCE` | 1サイクルのウェーブ列（進行順） |
| `waveDuration` | `WAVE_DURATION_SEC` | 通常 Wave 時間 |
| `waveIntroDuration` | `WAVE_INTRO_SEC` | Wave 開始演出時間 |
| `waveOutroDuration` | `WAVE_OUTRO_SEC` | Wave 終了演出時間 |
| `waveIntermissionDuration` | `WAVE_INTERMISSION_SEC` | Wave 間休憩時間 |
| `waveSpawnBoost` | `WAVE_SPAWN_BOOST` | ウェーブ種別ごとの追加出現率 |
| `cycleDifficultyStep` | `CYCLE_DIFFICULTY_STEP` | サイクルごとの難易度上昇係数 |
| `cycleBossHpStep` | `CYCLE_BOSS_HP_STEP` | サイクルごとのボス HP 増加係数 |
| `bossSequence` | `BOSS_SEQUENCE` | サイクルごとのボス巡回順 |
| `bossFirewallHp` / `bossWormHp` / `bossGateHp` | `BOSS_*_HP` | ボス HP |
| `bossAttackInterval` | `BOSS_FIREWALL_LASER_INTERVAL` | Firewall Core レーザー間隔 |
| `firewallCoreAttackInterval` | `BOSS_FIREWALL_CORE_INTERVAL` | Firewall ダメージ用コア供給間隔 |
| `firewallMaxLasers` | `BOSS_FIREWALL_MAX_LASERS` | Firewall 同時レーザー上限 |
| `firewallSafeWidth` | `BOSS_FIREWALL_SAFE_WIDTH` | Firewall 安全地帯の幅（回避可能性） |
| `bossWormAttackInterval` | `BOSS_WORM_SPAWN_INTERVAL` | Data Worm 追尾生成間隔 |
| `wormAttackWarningDuration` | `BOSS_WORM_ATTACK_WARNING` | Data Worm 攻撃前警告時間 |
| `wormHitCooldown` | `BOSS_WORM_HIT_COOLDOWN` | Data Worm 連続ダメージ防止 cooldown |
| `wormSpeed` | `BOSS_WORM_SPEED` | Data Worm 左右移動速度 |
| `wormMaxMinions` | `BOSS_WORM_MAX_MINIONS` | Data Worm 同時追尾上限 |
| `bossGateAttackInterval` | `BOSS_GATE_WALL_INTERVAL` | Security Gate 壁供給間隔 |
| `gateMinGap` | `BOSS_GATE_MIN_GAP` | Security Gate 最小通過幅（回避可能性） |
| `bossWarningDuration` | `BOSS_WARNING_SEC` | ボス出現警告時間 |
| `bossDefeatDuration` | `BOSS_DEFEAT_SEC` | ボス撃破演出時間 |
| `eventDuration` | `EVENT_DURATION_SEC` | イベント効果時間 |
| `eventInterval` | `EVENT_MIN_INTERVAL_SEC` | イベント発生間隔 |
| `eventFirstDelay` | `EVENT_FIRST_DELAY_SEC` | 初回イベントまでの猶予 |
| `eventWarningDuration` | `EVENT_WARNING_SEC` | 事前警告イベントの警告時間 |
| `coreRushMultiplier` | `EVENT_CORE_RUSH_MULT` | CORE RUSH のコア出現倍率 |
| `highSpeedMultiplier` | `EVENT_HIGH_SPEED_MULT` | HIGH SPEED の障害物速度倍率 |
| `laserStormRate` | `EVENT_LASER_STORM_RATE` | LASER STORM の追加レーザー出現率 |
| `laserStormMax` | `EVENT_LASER_STORM_MAX` | LASER STORM の同時レーザー上限 |
| `hardcoreWaveFactor` | `HARDCORE_WAVE_SPEED_FACTOR` | Hardcore の Wave 時間短縮係数（<1） |
| `hardcoreBossIntervalFactor` | `HARDCORE_BOSS_INTERVAL_FACTOR` | Hardcore のボス攻撃間隔短縮係数（<1） |
| `scoreMultiplier` | `1`（固定） | スコア倍率 |
| `xpMultiplier` | `1`（固定） | XP 倍率 |

## ルール
- **既存数値を無断で変更しない**。既定 preset は現在値の移行であり、挙動は変わらない。
- 選択中 preset は `model/balance.js` から**一箇所で参照**する（ハードコード重複を避ける）。
  Wave/Boss/Event を実装するファイルは config 定数を直接 import せず、アクセサ経由で取得する。
- **Training の一時選択を通常モードへ持ち越さない**。通常モードの `initWaveSystem()` は
  `resetPreset()` を呼び、active preset を既定（`DEFAULT_BALANCE_PRESET_ID`）へ必ず復元する。
- 各プレイの分析へ `balance_version` を必ず記録する（実装済み）。
- **ランキングスコアへ影響する変更**（`scoreMultiplier` / `xpMultiplier` / 速度・HP 等）を行う場合は、
  - `BALANCE_VERSION` を必ず上げる、
  - 本ファイルに変更点と影響（ランキング比較の非互換性）を明記する。
- 本番ユーザー向けの **preset 選択 UI は追加しない**。確認は Training（タイトルの Training 設定に
  `BALANCE vX.Y.Z (...)` を表示）と自動テストで行う。

## 新 preset を追加する手順（例）
1. `balance-presets.js` の `BALANCE_PRESETS` に新 preset を追加（必要なキーのみ上書き）。
2. ランキング影響があるなら `BALANCE_VERSION` を更新。
3. `model/balance.js` の `setPreset('<id>')` で切替（テスト/Training 用）。
4. 一定期間運用し、`docs/ANALYTICS_QUERIES.sql` の「balance_version 別比較」で評価。

> 現状の `BALANCE_VERSION` は `1.0.0`（既定 preset のみ）。
