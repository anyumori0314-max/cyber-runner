// ===================================
// scripts/verify.mjs — 依存ゼロの最小検証ハーネス（Node 標準機能のみ）
//
// 目的: Phase 1〜5 一括実装の「公開前 品質ゲート」を再現可能な単一コマンドで提供する。
//   外部ライブラリ・ビルドツール・テストフレームワークは使わない（node のみ）。
//
// 実行: `npm test` または `npm run verify`（= `node scripts/verify.mjs`）。
//
// 検証範囲（ブラウザ依存部は無理に再現せず、純粋関数・モジュール構成・配線を中心に）:
//   1. 対象 JS ファイルの存在            11. ニアミス +25
//   2. 全 JS ファイルの構文確認           12. ミッション報酬 +500
//   3. import 先ファイルの存在            13. DOUBLE SCORE は新規加算のみ倍率
//   4. 循環依存なし                       14. options 正常/破損/localStorage例外
//   5. main.js が新規モジュールを読込      15. 実績の重複解除防止
//   6. 旧 script.js の機能参照なし         16. ミッション報酬の重複防止
//   7. スコア純粋関数                      17. 称号判定
//   8. コンボ 1→3→1 倍でスコア非減少      18. Supabase GET の order と limit
//   9. コア +100（コンボ倍率は乗らない）   19. Supabase POST payload が4キーのみ
//  10. ボーナス +50                       20. created_at を POST しない
// ===================================

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');

// ===================================
// 極小アサート/テストランナー
// ===================================
const results = [];
async function test(name, fn) {
    try {
        await fn();
        results.push({ name, ok: true });
    } catch (err) {
        results.push({ name, ok: false, err: err && err.message ? err.message : String(err) });
    }
}
function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(`${msg || 'expected'}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
    }
}
function assertDeepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${msg || 'deep equal'}: got ${a}, want ${e}`);
}

// 期待される例外/警告で出力を汚さないため、対象実行中だけ console を黙らせる。
async function silenceConsole(fn) {
    const warn = console.warn;
    const error = console.error;
    console.warn = () => {};
    console.error = () => {};
    try {
        return await fn();
    } finally {
        console.warn = warn;
        console.error = error;
    }
}

// ===================================
// ファイル探索 / import 解析ヘルパ
// ===================================
function listJsFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listJsFiles(full));
        else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
    }
    return out.sort();
}

// import / export ... from '...' / 動的 import / 副作用 import を抽出（ブロックコメント除去後）。
function extractImportSpecifiers(source) {
    const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const specs = new Set();
    const fromRe = /(?:^|\n)\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
    const bareRe = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
    const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = fromRe.exec(noBlock))) specs.add(m[1]);
    while ((m = bareRe.exec(noBlock))) specs.add(m[1]);
    while ((m = dynRe.exec(noBlock))) specs.add(m[1]);
    return [...specs];
}

// 相対指定子を実ファイルへ解決する（.js 補完・/index.js 補完）。見つからなければ null。
function resolveSpecifier(importerFile, spec) {
    if (!spec.startsWith('.')) return null; // 外部/裸指定子はこのプロジェクトには存在しない
    const base = path.resolve(path.dirname(importerFile), spec);
    const candidates = [base, base + '.js', path.join(base, 'index.js')];
    for (const c of candidates) {
        if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return null;
}

// ===================================
// テスト用ヘルパ（localStorage / fetch のモックと gameState 生成）
// ===================================
function memLocalStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
        clear: () => store.clear()
    };
}
function throwingLocalStorage() {
    return {
        getItem() { throw new Error('localStorage blocked'); },
        setItem() { throw new Error('localStorage blocked'); },
        removeItem() { throw new Error('localStorage blocked'); }
    };
}
function makeGameState(over = {}) {
    return {
        combo: 0,
        survivalScore: 0,
        bonusScore: 0,
        score: 0,
        maxCombo: 0,
        comboLastTime: 0,
        gameTime: 0,
        doubleUntil: 0,
        ...over
    };
}

// 動的 import 用パス（ファイル URL）。
const modUrl = (rel) => pathToFileURL(path.join(JS_DIR, rel)).href;

// ===================================
// 静的構成チェック（1〜6）
// ===================================
const NEW_FILES = [
    'js/model/achievements.js',
    'js/model/missions.js',
    'js/model/options.js',
    'js/model/titles.js',
    'js/util/storage.js',
    'js/view/achievements-view.js',
    'js/view/options-view.js'
];

const allJsFiles = listJsFiles(JS_DIR);

await test('01. 対象 JS ファイルが存在する（新規7ファイル含む / 24ファイル以上）', () => {
    for (const rel of NEW_FILES) {
        assert(existsSync(path.join(ROOT, rel)), `missing new file: ${rel}`);
    }
    assert(existsSync(path.join(ROOT, 'js/main.js')), 'missing js/main.js');
    assert(allJsFiles.length >= 24, `expected >=24 JS files, found ${allJsFiles.length}`);
});

await test('02. 全 JS ファイルの構文確認（node --check, 解析のみ・非実行）', () => {
    const failures = [];
    for (const f of allJsFiles) {
        try {
            execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
        } catch (e) {
            failures.push(`${path.relative(ROOT, f)}: ${e.stderr ? e.stderr.toString().trim() : e.message}`);
        }
    }
    assert(failures.length === 0, `syntax errors:\n  ${failures.join('\n  ')}`);
});

// import グラフを構築（3・4・5 で共有）。
const graph = new Map(); // file -> [resolved import file]
const importIssues = [];
for (const f of allJsFiles) {
    const specs = extractImportSpecifiers(readFileSync(f, 'utf8'));
    const edges = [];
    for (const s of specs) {
        if (!s.startsWith('.')) continue; // このプロジェクトに外部依存はない
        const resolved = resolveSpecifier(f, s);
        if (!resolved) importIssues.push(`${path.relative(ROOT, f)} -> '${s}' (unresolved)`);
        else edges.push(resolved);
    }
    graph.set(f, edges);
}

await test('03. import 先ファイルがすべて存在する', () => {
    assert(importIssues.length === 0, `unresolved imports:\n  ${importIssues.join('\n  ')}`);
});

await test('04. 循環依存がない', () => {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map(allJsFiles.map((f) => [f, WHITE]));
    const stack = [];
    let cycle = null;
    const visit = (node) => {
        if (cycle) return;
        color.set(node, GRAY);
        stack.push(node);
        for (const next of graph.get(node) || []) {
            if (cycle) break;
            const c = color.get(next);
            if (c === GRAY) {
                const idx = stack.indexOf(next);
                cycle = stack.slice(idx).concat(next).map((p) => path.relative(ROOT, p));
                break;
            }
            if (c === WHITE) visit(next);
        }
        stack.pop();
        color.set(node, BLACK);
    };
    for (const f of allJsFiles) {
        if (color.get(f) === WHITE) visit(f);
        if (cycle) break;
    }
    assert(!cycle, `circular dependency: ${cycle ? cycle.join(' -> ') : ''}`);
});

await test('05. main.js が新規モジュールを（推移的に）読み込める', () => {
    const main = path.join(JS_DIR, 'main.js');
    const seen = new Set();
    const stack = [main];
    while (stack.length) {
        const cur = stack.pop();
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const next of graph.get(cur) || []) stack.push(next);
    }
    for (const rel of NEW_FILES) {
        const abs = path.join(ROOT, rel);
        assert(seen.has(abs), `main.js does not reach ${rel} via imports`);
    }
});

await test('06. 旧 script.js の機能参照がない（import / <script src>）', () => {
    const offenders = [];
    // import/require の指定子に script.js を含まないこと
    for (const f of allJsFiles) {
        const src = readFileSync(f, 'utf8');
        const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
        if (/(?:from|import|require)\s*\(?\s*['"][^'"]*script\.js['"]/.test(noBlock)) {
            offenders.push(path.relative(ROOT, f));
        }
    }
    // index.html が script.js を読み込まないこと
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    if (/<script[^>]*src\s*=\s*['"][^'"]*script\.js['"]/.test(html)) offenders.push('index.html');
    assert(offenders.length === 0, `functional script.js reference in: ${offenders.join(', ')}`);
});

// ===================================
// 純粋関数 / モデルの動作チェック（7〜20）— 実コードを import して検証
// ===================================
const scoring = await import(modUrl('model/scoring.js'));
const config = await import(modUrl('config.js'));

await test('07. スコア純粋関数（コンボ倍率 / ランク / 次ランク / floor）', () => {
    assertEqual(scoring.getComboMultiplier(0), 1.0, 'combo<5');
    assertEqual(scoring.getComboMultiplier(5), 1.5, 'combo>=5');
    assertEqual(scoring.getComboMultiplier(10), 2.0, 'combo>=10');
    assertEqual(scoring.getComboMultiplier(20), 3.0, 'combo>=20');
    assertEqual(scoring.getComboMultiplier(25), 3.0, 'combo>=20 (cap)');
    assertEqual(scoring.calculateRank(3000).rank, 'S', 'rank S');
    assertEqual(scoring.calculateRank(0).rank, 'D', 'rank D');
    assertEqual(scoring.getNextRankInfo(3000), null, 'top rank -> null');
    const next0 = scoring.getNextRankInfo(0);
    assertEqual(next0.rank, 'C', 'next rank from 0');
    assertEqual(next0.remaining, 500, 'remaining to C');
    assertEqual(scoring.floorScore(123.99), 123, 'floor');
});

await test('08. コンボ 1倍→3倍→1倍 でスコアが減少しない（差分加算）', () => {
    const gs = makeGameState();
    scoring.accumulateSurvivalScore(gs, 1); // combo0: +10
    const a = gs.survivalScore;
    gs.combo = 20;
    scoring.accumulateSurvivalScore(gs, 1); // combo20: +30
    const b = gs.survivalScore;
    gs.combo = 0;
    scoring.accumulateSurvivalScore(gs, 1); // combo0: +10
    const c = gs.survivalScore;
    assertEqual(a, 10, 'step A (x1.0)');
    assertEqual(b, 40, 'step B (+x3.0)');
    assertEqual(c, 50, 'step C (+x1.0)');
    assert(a <= b && b <= c, 'survivalScore must be non-decreasing across combo changes');
});

await test('09. コア +100（コンボ倍率は加算スコアに乗らない）', () => {
    assertEqual(config.ENERGY_CORE_SCORE, 100, 'ENERGY_CORE_SCORE');
    const gs = makeGameState({ combo: 20 }); // 高コンボでも加算スコアは倍率なし
    scoring.addCoreScore(gs);
    assertEqual(gs.bonusScore, 100, 'core adds exactly +100 (no combo multiplier)');
});

await test('10. ボーナス +50', () => {
    assertEqual(config.BONUS_SCORE, 50, 'BONUS_SCORE');
    const gs = makeGameState();
    scoring.addBonusScore(gs);
    assertEqual(gs.bonusScore, 50, 'bonus adds +50');
});

await test('11. ニアミス +25', () => {
    assertEqual(config.NEAR_MISS_SCORE, 25, 'NEAR_MISS_SCORE');
    const gs = makeGameState();
    scoring.addNearMissScore(gs);
    assertEqual(gs.bonusScore, 25, 'near miss adds +25');
});

await test('12. ミッション報酬 +500', () => {
    assertEqual(config.MISSION_REWARD, 500, 'MISSION_REWARD');
    const gs = makeGameState();
    scoring.addMissionReward(gs);
    assertEqual(gs.bonusScore, 500, 'mission reward adds +500');
});

await test('13. DOUBLE SCORE は「効果中の新規獲得」のみ倍率（既獲得は不変）', () => {
    const gs = makeGameState({ bonusScore: 100, survivalScore: 10, gameTime: 0, doubleUntil: 10 });
    // 既存 bonusScore=100 は二重化されない。新規コア +100 のみ ×2。
    scoring.addCoreScore(gs);
    assertEqual(gs.bonusScore, 300, 'existing 100 untouched, new core +200');
    // 生存スコア: 既存10 は不変、新規 +10×2=20。
    scoring.accumulateSurvivalScore(gs, 1);
    assertEqual(gs.survivalScore, 30, 'existing 10 untouched, new survival +20');
    scoring.composeScore(gs);
    assertEqual(gs.score, 330, 'compose = survival(30) + bonus(300)');
    // 効果終了後は倍率 1。
    gs.doubleUntil = 0;
    scoring.addCoreScore(gs);
    assertEqual(gs.bonusScore, 400, 'after double ends, core adds +100 only');
});

await test('14. options 正常値 / 破損値 / localStorage 例外で安全に動作', async () => {
    const options = await import(modUrl('model/options.js'));
    const { OPTIONS_STORAGE_KEY, DEFAULT_OPTIONS } = config;

    // (a) 正常値: 保存済み JSON を読み込めること（Phase 12: touchControls を含む）
    const good = { soundEnabled: false, soundVolume: 0.5, screenShakeEnabled: false, particlesEnabled: true, showControls: false, touchControls: true };
    globalThis.localStorage = memLocalStorage({ [OPTIONS_STORAGE_KEY]: JSON.stringify(good) });
    await silenceConsole(async () => options.loadOptions());
    assertDeepEqual(options.getOptions(), good, 'valid options round-trip');

    // (b) 破損値: 不正 JSON は既定値へフォールバック
    globalThis.localStorage = memLocalStorage({ [OPTIONS_STORAGE_KEY]: '{not valid json' });
    await silenceConsole(async () => options.loadOptions());
    assertDeepEqual(options.getOptions(), { ...DEFAULT_OPTIONS }, 'corrupt JSON -> defaults');

    // (b2) 型不正/範囲外: フィールド単位で既定値補完
    globalThis.localStorage = memLocalStorage({
        [OPTIONS_STORAGE_KEY]: JSON.stringify({ soundEnabled: 'yes', soundVolume: 5, particlesEnabled: false })
    });
    await silenceConsole(async () => options.loadOptions());
    const sanitized = options.getOptions();
    assertEqual(sanitized.soundEnabled, DEFAULT_OPTIONS.soundEnabled, 'bad bool -> default');
    assertEqual(sanitized.soundVolume, DEFAULT_OPTIONS.soundVolume, 'out-of-range volume -> default');
    assertEqual(sanitized.particlesEnabled, false, 'valid field preserved');

    // (c) localStorage 例外: throw せず既定値で継続、setOption も throw しない
    globalThis.localStorage = throwingLocalStorage();
    await silenceConsole(async () => options.loadOptions());
    assertDeepEqual(options.getOptions(), { ...DEFAULT_OPTIONS }, 'localStorage throw on load -> defaults');
    let threw = false;
    await silenceConsole(async () => {
        try { options.setOption('soundVolume', 0.3); } catch (e) { threw = true; }
    });
    assert(!threw, 'setOption must not throw when localStorage fails');
    assertEqual(options.getOptions().soundVolume, 0.3, 'in-memory update still applied');

    delete globalThis.localStorage;
});

await test('15. 実績の重複解除を防止する（既解除は再通知しない）', async () => {
    const ach = await import(modUrl('model/achievements.js'));
    globalThis.localStorage = memLocalStorage();
    await silenceConsole(async () => ach.loadAchievements());

    const first = ach.recordRunAndUnlock({ maxCombo: 20 });
    const firstIds = first.map((a) => a.id);
    assert(firstIds.includes('combo_master'), 'combo_master unlocked on first 20-combo run');
    assert(firstIds.includes('first_run'), 'first_run unlocked on first run');
    assert(ach.isUnlocked('combo_master'), 'combo_master persisted as unlocked');

    const second = ach.recordRunAndUnlock({ maxCombo: 20 });
    const secondIds = second.map((a) => a.id);
    assert(!secondIds.includes('combo_master'), 'combo_master must NOT re-unlock');
    assert(!secondIds.includes('first_run'), 'first_run must NOT re-unlock');

    delete globalThis.localStorage;
});

await test('16. ミッション報酬の重複防止（達成判定 + missionDone ガード）', async () => {
    const missions = await import(modUrl('model/missions.js'));
    // 実モデルの達成判定 + 実スコア加算で「1プレイ1回」契約を再現。
    const mission = missions.MISSIONS.find((m) => m.id === 'cores5');
    const gs = makeGameState({ coreCount: 5, missionDone: false });
    assert(missions.isMissionComplete(mission, gs), 'cores5 should be complete at 5 cores');

    const award = () => {
        if (!gs.missionDone && missions.isMissionComplete(mission, gs)) {
            gs.missionDone = true;
            scoring.addMissionReward(gs);
        }
    };
    award();
    award(); // 2回目は missionDone により加算されない
    assertEqual(gs.bonusScore, 500, 'mission reward applied exactly once');

    // 実コントローラ側に二重防止ガードが配線されていること（静的確認）。
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    assert(/!gameState\.missionDone\s*&&\s*isMissionComplete/.test(loopSrc), 'game-loop guards with !missionDone');
    assert(/gameState\.missionDone\s*=\s*true/.test(loopSrc), 'game-loop sets missionDone = true');
});

await test('17. プレイスタイル称号判定', async () => {
    const titles = await import(modUrl('model/titles.js'));
    assertEqual(titles.determineTitle({ maxCombo: 30 }), 'コンボ職人', 'high combo -> コンボ職人');
    assertEqual(titles.determineTitle({ coreCount: 20 }), 'コアハンター', 'many cores -> コアハンター');
    assertEqual(titles.determineTitle({ nearMissCount: 10 }), 'ニアミスマスター', 'near miss -> ニアミスマスター');
    assertEqual(titles.determineTitle({ dashCount: 10 }), 'ダッシュランナー', 'dashes -> ダッシュランナー');
    assertEqual(titles.determineTitle({ survivalTime: 60 }), '回避の達人', 'survival -> 回避の達人');
    assertEqual(titles.determineTitle({}), 'サイバールーキー', 'nothing notable -> rookie');
});

// ===================================
// Phase 6: セキュアランキング / 不正対策
// ===================================
const scoreValidationUrl = pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/score-validation.js')).href;
const sv = await import(scoreValidationUrl);

function goodPayload(over = {}) {
    return {
        run_id: 'run-abcdefgh',
        anonymous_player_id: 'anon-123',
        player_name: 'TESTER',
        mode: 'endless',
        score: 1234,
        max_combo: 42,
        duration_ms: 30000,
        rank: 'A',
        game_version: '1.0.0',
        metrics: { core_count: 10, near_miss_count: 5, dash_count: 2, mission_completed: true, reached_level: 4 },
        ...over
    };
}

await test('P6-11. score validation（正常→ok / 欠落→拒否）', () => {
    const ok = sv.validateScorePayload(goodPayload());
    assert(ok.ok, `valid payload should pass: ${ok.errors.join(',')}`);
    assertEqual(ok.cleaned.score, 1234, 'cleaned score');
    assert(!sv.validateScorePayload(goodPayload({ run_id: undefined })).ok, 'missing run_id rejected');
    assert(!sv.validateScorePayload(goodPayload({ game_version: '' })).ok, 'missing game_version rejected');
    assert(!sv.validateScorePayload(goodPayload({ rank: 'Z' })).ok, 'invalid rank rejected');
});

await test('P6-12. run_id 重複/再利用の拒否（checkRunRecord）', () => {
    const now = 1_000_000;
    const base = { id: 'run-x', mode: 'endless', started_at: now - 30000, expires_at: now + 60000, submitted: false };
    assert(sv.checkRunRecord(base, { now, durationMs: 30000, mode: 'endless' }).ok, 'fresh run ok');
    assert(!sv.checkRunRecord({ ...base, submitted: true }, { now, durationMs: 30000, mode: 'endless' }).ok, 'submitted run rejected (reuse)');
    assert(!sv.checkRunRecord(null, { now, durationMs: 30000, mode: 'endless' }).ok, 'missing run rejected');
    assert(!sv.checkRunRecord({ ...base, expires_at: now - 1 }, { now, durationMs: 30000, mode: 'endless' }).ok, 'expired run rejected');
});

await test('P6-13. 異常 score の拒否（範囲外 / 負 / duration 矛盾）', () => {
    assert(!sv.validateScorePayload(goodPayload({ score: -5 })).ok, 'negative score rejected');
    assert(!sv.validateScorePayload(goodPayload({ score: sv.LIMITS.SCORE_MAX + 1 })).ok, 'over-max score rejected');
    // 30秒で 1,000,000,000 点は不可能（duration 矛盾）。
    assert(!sv.validateScorePayload(goodPayload({ score: 1_000_000_00, duration_ms: 30000 })).ok, 'implausible score/duration rejected');
    assert(!sv.validateScorePayload(goodPayload({ duration_ms: 10 })).ok, 'too-short duration rejected');
});

await test('P6-14. mode 検証（許可値のみ）', () => {
    assertDeepEqual(sv.ALLOWED_MODES, ['endless', 'timeattack', 'hardcore', 'training'], 'allowed modes');
    assert(!sv.validateScorePayload(goodPayload({ mode: 'cheatmode' })).ok, 'invalid mode rejected');
    assert(sv.validateScorePayload(goodPayload({ mode: 'hardcore' })).ok, 'hardcore mode accepted');
});

await test('P6-15. クライアントに直接 INSERT コードがない', () => {
    const offenders = [];
    for (const f of allJsFiles) {
        const src = readFileSync(f, 'utf8');
        const hasRest = /rest\/v1\//.test(src);
        const hasPost = /method:\s*['"]POST['"]/.test(src);
        const hasInsert = /\.from\(\s*['"]leaderboard[^'"]*['"]\s*\)[\s\S]*?\.insert\(/.test(src);
        if ((hasRest && hasPost) || hasInsert) offenders.push(path.relative(ROOT, f));
    }
    assert(offenders.length === 0, `direct INSERT pattern found in: ${offenders.join(', ')}`);
});

await test('P6-16. service_role がフロントに混入していない（コメント記述は除外）', () => {
    const offenders = [];
    for (const f of allJsFiles) {
        const src = readFileSync(f, 'utf8');
        // コメント（ブロック / 行）を除去してから実コードのみ走査する。
        // （"service_role は使用しない" 等の注意書きコメントを誤検出しないため。）
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
        if (/service_role/i.test(code)) offenders.push(path.relative(ROOT, f));
    }
    assert(offenders.length === 0, `service_role reference in frontend code: ${offenders.join(', ')}`);
});

const leaderboard = await import(modUrl('services/leaderboard.js'));
const originalFetch = globalThis.fetch;

await test('18. Supabase GET の order と limit が仕様どおり', async () => {
    let getUrl = null;
    globalThis.fetch = async (url, opts) => {
        if (!opts || opts.method === 'GET') getUrl = url;
        return { ok: true, status: 200, json: async () => [] };
    };
    await silenceConsole(async () => leaderboard.loadLeaderboard());
    assert(getUrl, 'GET should have been issued');
    assert(getUrl.includes('order=score.desc,max_combo.desc,created_at.asc'), `order clause missing: ${getUrl}`);
    assert(getUrl.includes(`limit=${config.LEADERBOARD_LIMIT}`), `limit missing: ${getUrl}`);

    let titleUrl = null;
    globalThis.fetch = async (url) => { titleUrl = url; return { ok: true, status: 200, json: async () => [] }; };
    await silenceConsole(async () => leaderboard.loadTitleLeaderboard());
    assert(titleUrl.includes(`limit=${config.TITLE_LEADERBOARD_LIMIT}`), `title limit missing: ${titleUrl}`);
});

await test('P6-17. daily / weekly / overall + mode クエリ', () => {
    const now = new Date('2026-06-27T12:00:00.000Z'); // 土曜
    const overall = leaderboard.buildLeaderboardQuery({ period: 'overall', mode: 'all', now });
    assert(!overall.includes('created_at=gte'), 'overall has no date filter');
    assert(overall.includes('order=score.desc,max_combo.desc,created_at.asc'), 'order present');

    const daily = leaderboard.buildLeaderboardQuery({ period: 'daily', mode: 'all', now });
    assert(daily.includes('created_at=gte.2026-06-27'), `daily filter wrong: ${daily}`);

    const weekly = leaderboard.buildLeaderboardQuery({ period: 'weekly', mode: 'all', now });
    assert(weekly.includes('created_at=gte.2026-06-22'), `weekly filter (Mon) wrong: ${weekly}`); // 週の月曜=6/22

    const modeQ = leaderboard.buildLeaderboardQuery({ period: 'overall', mode: 'hardcore', now });
    assert(modeQ.includes('mode=eq.hardcore'), `mode filter missing: ${modeQ}`);
});

await test('P6-18. Edge Function 未配備でもゲーム継続（local run / safe submit）', async () => {
    globalThis.localStorage = memLocalStorage();
    const runSvc = await import(modUrl('services/run-service.js'));
    runSvc.configureRunService({ endpointBase: '' }); // 未配備
    assert(!runSvc.isOnlineConfigured(), 'online should be unconfigured');
    const run = await runSvc.startRun('endless');
    assertEqual(run.source, 'local', 'startRun returns local run when unconfigured');
    assert(typeof run.run_id === 'string' && run.run_id.length >= 8, 'local run has id');
    const submit = await silenceConsole(async () => runSvc.submitScore({ runId: run.run_id, playerName: 'X', mode: 'endless', score: 10, maxCombo: 1, durationMs: 5000, rank: 'D', metrics: {} }));
    assert(submit.unavailable === true, 'submit returns unavailable (no direct insert)');

    // handleSendScore も throw せず安全メッセージを表示する。
    let lastStatus = null;
    leaderboard.configureLeaderboard({ getRawName: () => 'X', setStatus: (m) => { lastStatus = m; }, updateButton: () => {} });
    leaderboard.prepareSubmission({ score: 10, maxCombo: 1, rank: 'D', mode: 'endless', durationMs: 5000, runId: run.run_id, metrics: {} });
    await silenceConsole(async () => leaderboard.handleSendScore());
    assert(/not enabled/i.test(lastStatus || ''), `safe message expected, got: ${lastStatus}`);
    delete globalThis.localStorage;
});

await test('P6-submit. 配備時の submit payload は created_at を含まない', async () => {
    globalThis.localStorage = memLocalStorage();
    const runSvc = await import(modUrl('services/run-service.js'));
    runSvc.configureRunService({ endpointBase: 'https://example.test/functions/v1' });
    let postBody = null;
    let postUrl = null;
    globalThis.fetch = async (url, opts) => {
        if (opts && opts.method === 'POST') { postUrl = url; postBody = JSON.parse(opts.body); }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    const res = await silenceConsole(async () => runSvc.submitScore({
        runId: 'run-abcdefgh', playerName: 'TESTER', mode: 'endless',
        score: 1234, maxCombo: 42, durationMs: 30000, rank: 'A',
        metrics: { core_count: 1, near_miss_count: 0, dash_count: 0, mission_completed: false, reached_level: 2 }
    }));
    assert(res.ok, 'configured submit should succeed');
    assert(postUrl.endsWith('/submit-score'), `submit posts to submit-score: ${postUrl}`);
    assert(!('created_at' in postBody), 'created_at must NOT be in submit payload');
    for (const k of ['run_id', 'player_name', 'mode', 'score', 'max_combo', 'duration_ms', 'rank', 'game_version', 'metrics']) {
        assert(k in postBody, `submit payload missing ${k}`);
    }
    runSvc.configureRunService({ endpointBase: '' }); // 後続テストへ影響させない
    delete globalThis.localStorage;
});

if (originalFetch) globalThis.fetch = originalFetch; else delete globalThis.fetch;

// ===================================
// Phase 6 セキュリティ強化（Codex 最終レビュー対応）— SEC-01〜SEC-20
//   原子的登録 / policy 監査 / レート制限 / player_name 検証 / CORS 許可リスト /
//   GET キャッシュフォールバック / 秘密情報の非混入。
// ===================================
const corsUtil = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/cors-util.js')).href);
const migrationSrc = readFileSync(path.join(ROOT, 'supabase/migrations/20260627090000_secure_leaderboard.sql'), 'utf8');
const submitSrc = readFileSync(path.join(ROOT, 'supabase/functions/submit-score/index.ts'), 'utf8');
const startRunSrc = readFileSync(path.join(ROOT, 'supabase/functions/start-run/index.ts'), 'utf8');
const corsTsSrc = readFileSync(path.join(ROOT, 'supabase/functions/_shared/cors.ts'), 'utf8');

function makeRunStore(over = {}) {
    const now = 1_000_000;
    const runs = new Map();
    runs.set('run-abcdefgh', {
        mode: 'endless', started_at: now - 30000, expires_at: now + 60000,
        submitted: false, anonymous_player_id: 'anon-1', ...over
    });
    return { runs, scores: [], now };
}
const cleanedFor = (over = {}) => ({
    run_id: 'run-abcdefgh', anonymous_player_id: 'anon-1', player_name: 'X', mode: 'endless', score: 100, ...over
});

await test('SEC-01. 同じ run_id を2回送ると1回だけ成功・1行だけ登録', () => {
    const s = makeRunStore();
    const r1 = sv.simulateAtomicSubmit(s, cleanedFor(), { now: s.now });
    const r2 = sv.simulateAtomicSubmit(s, cleanedFor(), { now: s.now });
    assert(r1.ok && r1.status === 200, 'first submit succeeds');
    assert(!r2.ok && r2.status === 409, 'second submit -> 409');
    assertEqual(s.scores.length, 1, 'exactly one leaderboard row');
    // Edge Function が原子 RPC を呼ぶ配線。
    assert(/rpc\(\s*["']submit_score_atomic["']/.test(submitSrc), 'submit-score calls submit_score_atomic RPC');
    assert(/for update/i.test(migrationSrc), 'RPC locks run FOR UPDATE');
});

await test('SEC-02. 競合送信は片方が 409（already_submitted）', () => {
    // 先に別トランザクションが消費済み（submitted=true）の状態を模擬。
    const s = makeRunStore({ submitted: true });
    const r = sv.simulateAtomicSubmit(s, cleanedFor(), { now: s.now });
    assert(!r.ok && r.status === 409 && /already submitted/.test(r.error), 'concurrent loser -> 409');
    assertEqual(s.scores.length, 0, 'no extra row from loser');
    assert(/already_submitted/.test(migrationSrc), 'RPC returns already_submitted on conflict');
});

await test('SEC-03. INSERT 失敗時に run が不正に消費されない（ロールバック）', () => {
    const s = makeRunStore();
    const r = sv.simulateAtomicSubmit(s, cleanedFor(), { now: s.now }, { insert: () => { throw new Error('insert boom'); } });
    assert(!r.ok && r.status === 500, 'insert failure surfaced as 500');
    assertEqual(s.runs.get('run-abcdefgh').submitted, false, 'run NOT consumed when insert fails');
    assertEqual(s.scores.length, 0, 'no row persisted');
    const retry = sv.simulateAtomicSubmit(s, cleanedFor(), { now: s.now });
    assert(retry.ok, 'retry succeeds after rollback (run still usable)');
});

await test('SEC-04. 存在しない run_id を拒否', () => {
    const s = { runs: new Map(), scores: [], now: 1_000_000 };
    const r = sv.simulateAtomicSubmit(s, cleanedFor(), { now: s.now });
    assert(!r.ok && /not found/.test(r.error), 'missing run -> reject');
});

await test('SEC-05. 期限切れ run を拒否', () => {
    const s = makeRunStore({ expires_at: 999_999 });
    const r = sv.simulateAtomicSubmit(s, cleanedFor(), { now: 1_000_000 });
    assert(!r.ok && /expired/.test(r.error), 'expired run -> reject');
    assert(/run_expired/.test(migrationSrc), 'RPC checks expiry');
});

await test('SEC-06. Training の送信を拒否', () => {
    const s = makeRunStore({ mode: 'training' });
    const r = sv.simulateAtomicSubmit(s, cleanedFor({ mode: 'training' }), { now: s.now });
    assert(!r.ok && r.status === 400, 'training -> 400');
    assert(/training is not ranked/.test(submitSrc), 'edge function early-rejects training (400)');
    assert(/training_not_ranked/.test(migrationSrc), 'RPC double-guards training');
});

await test('SEC-07. migration が未知の書き込み policy を残さない', () => {
    assert(/from pg_policies[\s\S]*?tablename\s*=\s*'leaderboard_scores'/.test(migrationSrc), 'audits pg_policies for table');
    assert(/drop policy if exists %I on public\.leaderboard_scores/.test(migrationSrc), 'drops every policy by name independently');
    // create policy 単一文の中に for insert/update/delete が無いこと（文境界 ; を跨がせない）。
    assert(!/create\s+policy[^;]*\bfor\s+(insert|update|delete)\b/i.test(migrationSrc), 'no client write policy is created');
    assert(/create policy[^;]*for select\s+using \(true\)/i.test(migrationSrc), 'only public SELECT policy recreated');
});

await test('SEC-08. anon / authenticated に書き込み権限を付与しない', () => {
    assert(/revoke insert, update, delete on public\.leaderboard_scores from anon/i.test(migrationSrc), 'revoke writes from anon');
    assert(/revoke insert, update, delete on public\.leaderboard_scores from authenticated/i.test(migrationSrc), 'revoke writes from authenticated');
    assert(!/grant\s+(insert|update|delete)/i.test(migrationSrc), 'no write grants in migration');
    assert(/grant select on public\.leaderboard_scores to anon/i.test(migrationSrc), 'public read kept (select grant)');
    // 原子 RPC は service_role のみ EXECUTE 可（anon が PostgREST 経由で呼べない）。
    assert(/revoke all on function public\.submit_score_atomic[\s\S]*?from public/i.test(migrationSrc), 'RPC execute revoked from public');
    assert(/grant execute on function public\.submit_score_atomic[\s\S]*?to service_role/i.test(migrationSrc), 'RPC execute granted to service_role only');
});

await test('SEC-09. start-run のレート制限（純粋関数）', () => {
    const now = 1_000_000;
    const atLimit = Array.from({ length: sv.START_RUN_RATE.MAX_PER_ANON }, (_, i) => now - i * 100);
    assert(sv.isStartRateLimited(atLimit, now), 'at limit -> limited');
    assert(!sv.isStartRateLimited(atLimit.slice(1), now), 'below limit -> not limited');
    // 窓外は数えない。
    const old = atLimit.map((t) => t - sv.START_RUN_RATE.WINDOW_MS - 1);
    assert(!sv.isStartRateLimited(old, now), 'outside window not counted');
});

await test('SEC-10. 制限超過時に 429 + Retry-After', () => {
    const now = 1_000_000;
    const ra = sv.retryAfterSeconds([now - 1000], now, sv.START_RUN_RATE.WINDOW_MS);
    assert(ra > 0, 'retry-after seconds positive');
    assert(/429/.test(startRunSrc) && /Retry-After/.test(startRunSrc), 'start-run returns 429 + Retry-After');
    assert(/ip_hash/.test(startRunSrc) && /RATE_LIMIT_IP_SALT/.test(startRunSrc), 'DB-backed by anon + salted IP hash');
    assert(/\.from\(["']runs["']\)[\s\S]*?gte\(["']started_at["']/.test(startRunSrc), 'counts recent runs from DB (not memory only)');
});

await test('SEC-11. 正常な日本語 player_name を許可', () => {
    for (const n of ['たろう', 'プレイヤー1', 'Yamada_太郎', 'A B-C_1', '日本語のなまえ', 'ASCII_99']) {
        const r = sv.validatePlayerName(n);
        assert(r.ok, `valid name wrongly rejected: "${n}" (${r.error})`);
    }
    // 12 コードポイント超は切り詰め（拒否ではない）。
    const long = sv.validatePlayerName('あ'.repeat(20));
    assert(long.ok && Array.from(long.value).length === sv.LIMITS.NAME_MAX_LENGTH, 'long name trimmed by codepoint');
});

await test('SEC-12. 制御文字入り player_name を拒否', () => {
    assert(!sv.validatePlayerName('abc').ok, 'C0 control rejected');
    assert(!sv.validatePlayerName('abcd').ok, 'C1 (NEL) rejected');
    assert(!sv.validatePlayerName('a\tb').ok, 'tab rejected');
    assert(!sv.validatePlayerName('a\nb').ok, 'newline rejected');
    assert(!sv.validatePlayerName('   ').ok, 'whitespace-only -> empty rejected');
    assert(!sv.validatePlayerName('').ok, 'empty rejected');
});

await test('SEC-13. bidi 制御文字入り player_name を拒否', () => {
    for (const c of ['‮', '‪', '‭', '⁦', '⁧', '‏', '‎']) {
        assert(!sv.validatePlayerName('x' + c + 'y').ok, `bidi U+${c.codePointAt(0).toString(16)} rejected`);
    }
});

await test('SEC-14. ゼロ幅/format 文字入り player_name を拒否', () => {
    for (const c of ['​', '‌', '‍', '﻿', '⁠']) {
        assert(!sv.validatePlayerName('a' + c + 'b').ok, `zero-width U+${c.codePointAt(0).toString(16)} rejected`);
    }
});

await test('SEC-15. 許可 origin へ CORS ヘッダーを返す', () => {
    const allowed = corsUtil.parseAllowedOrigins('https://anyumori0314-max.github.io, http://localhost:8127 ,');
    assertDeepEqual(allowed, ['https://anyumori0314-max.github.io', 'http://localhost:8127'], 'parsed + trimmed + empties removed');
    const o = corsUtil.resolveAllowedOrigin('http://localhost:8127', allowed);
    assertEqual(o, 'http://localhost:8127', 'allowed origin echoed exactly');
    const h = corsUtil.buildCorsHeaders(o);
    assertEqual(h['Access-Control-Allow-Origin'], 'http://localhost:8127', 'ACAO set for allowed origin');
    assertEqual(h['Vary'], 'Origin', 'Vary: Origin present');
    assert(h['Access-Control-Allow-Origin'] !== '*', 'no wildcard ACAO');
});

await test('SEC-16. 未許可 origin を拒否（ACAO を返さない）', () => {
    const allowed = corsUtil.parseAllowedOrigins('https://good.example');
    assertEqual(corsUtil.resolveAllowedOrigin('https://evil.example', allowed), null, 'disallowed -> null');
    assertEqual(corsUtil.resolveAllowedOrigin('', allowed), null, 'no Origin (server-to-server) -> null');
    const h = corsUtil.buildCorsHeaders(null);
    assert(!('Access-Control-Allow-Origin' in h), 'no ACAO when origin not allowed');
    assertEqual(h['Vary'], 'Origin', 'Vary present even when denied');
    assert(/ALLOWED_ORIGINS/.test(corsTsSrc) && /resolveAllowedOrigin/.test(corsTsSrc), 'cors.ts wires env allowlist');
    assert(!/Allow-Origin["']?\s*:\s*["']\*/.test(corsTsSrc), 'cors.ts has no wildcard origin');
});

await test('SEC-17. GET 失敗時にキャッシュを利用', async () => {
    globalThis.localStorage = memLocalStorage();
    leaderboard.setLeaderboardFilter({ period: 'overall', mode: 'all' });
    let rendered = null;
    leaderboard.configureLeaderboard({
        render: (s) => { rendered = s; }, renderUnavailable: () => { rendered = 'EMPTY'; }, setStatus: () => {}
    });
    // 1) 正常取得 → キャッシュされる
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [{ player_name: 'CACHED', score: 50, max_combo: 1, rank: 'D' }] });
    await silenceConsole(async () => leaderboard.loadLeaderboard());
    assert(Array.isArray(rendered) && rendered[0].player_name === 'CACHED', 'live load rendered + cached');
    // 2) 失敗 → キャッシュ表示
    rendered = null;
    globalThis.fetch = async () => { throw new Error('network down'); };
    await silenceConsole(async () => leaderboard.loadLeaderboard());
    assert(Array.isArray(rendered) && rendered[0].player_name === 'CACHED', 'fallback rendered cached data');
    delete globalThis.localStorage;
});

await test('SEC-18. キャッシュなしで空表示（架空データを作らない）', async () => {
    globalThis.localStorage = memLocalStorage(); // 空
    leaderboard.setLeaderboardFilter({ period: 'weekly', mode: 'hardcore' }); // キャッシュ未保存のキー
    let outcome = 'NONE';
    leaderboard.configureLeaderboard({
        render: () => { outcome = 'LIVE'; }, renderUnavailable: () => { outcome = 'EMPTY'; }, setStatus: () => {}
    });
    globalThis.fetch = async () => { throw new Error('down'); };
    await silenceConsole(async () => leaderboard.loadLeaderboard());
    assertEqual(outcome, 'EMPTY', 'no cache -> empty (renderUnavailable), not fabricated');
    leaderboard.setLeaderboardFilter({ period: 'overall', mode: 'all' });
    delete globalThis.localStorage;
});

await test('SEC-19. Supabase 失敗時もゲームを開始できる（loadLeaderboard は throw しない）', async () => {
    globalThis.localStorage = memLocalStorage();
    globalThis.fetch = async () => { throw new Error('down'); };
    leaderboard.configureLeaderboard({ render: () => {}, renderUnavailable: () => {}, setStatus: () => {} });
    let threw = false;
    await silenceConsole(async () => { try { await leaderboard.loadLeaderboard(); } catch (_e) { threw = true; } });
    assert(!threw, 'loadLeaderboard must not throw on failure');
    delete globalThis.localStorage;
});

await test('SEC-20. service_role / DB パスワード等の秘密がフロントにない', () => {
    const secretPatterns = [
        /service_role/i,
        /SERVICE_ROLE_KEY/i,
        /postgres(ql)?:\/\/[^'"\s]*:[^'"\s]*@/i, // 接続文字列（パスワード入り）
        /db[_-]?password|database[_-]?password/i,
        /RATE_LIMIT_IP_SALT/ // salt はサーバー環境変数のみ。フロントに出さない。
    ];
    const offenders = [];
    for (const f of allJsFiles) {
        const src = readFileSync(f, 'utf8');
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
        for (const re of secretPatterns) if (re.test(code)) offenders.push(`${path.relative(ROOT, f)} :: ${re}`);
    }
    assert(offenders.length === 0, `secret-like content in frontend: ${offenders.join(', ')}`);
});

if (originalFetch) globalThis.fetch = originalFetch; else delete globalThis.fetch;

// ===================================
// Phase 7: ゲームモード
// ===================================
const gameModes = await import(modUrl('model/game-modes.js'));

await test('P7-19. 4モードが定義され開始情報を持つ', () => {
    const ids = gameModes.getModes().map((m) => m.id).sort();
    assertDeepEqual(ids, ['endless', 'hardcore', 'timeattack', 'training'], '4 modes');
    for (const id of ['endless', 'timeattack', 'hardcore', 'training']) {
        gameModes.setMode(id);
        const gs = makeGameState();
        gameModes.applyModeToState(gs);
        assertEqual(gs.mode, id, `applyModeToState sets mode ${id}`);
    }
});

await test('P7-20. モード切替で前モードの state が残らない', () => {
    const gs = makeGameState();
    gameModes.setMode('hardcore');
    gameModes.applyModeToState(gs);
    assert(gs.modeScoreMultiplier !== 1 && gs.difficultyMultiplier !== 1, 'hardcore applied');
    // Endless へ切替→適用で完全リセット
    gameModes.setMode('endless');
    gameModes.applyModeToState(gs);
    assertEqual(gs.modeScoreMultiplier, 1, 'score mult reset');
    assertEqual(gs.difficultyMultiplier, 1, 'difficulty reset');
    assertEqual(gs.timeLimitSec, 0, 'time limit reset');
    assertEqual(gs.invincible, false, 'invincible reset');
    assertEqual(gs.allowedObstacles, 'all', 'obstacles reset');
});

await test('P7-21. Time Attack は 60 秒で FINISH（設定 + ループ配線）', () => {
    gameModes.setMode('timeattack');
    const gs = makeGameState();
    gameModes.applyModeToState(gs);
    assertEqual(gs.timeLimitSec, config.TIME_ATTACK_DURATION_SEC, 'time limit = 60');
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    assert(/timeLimitSec\s*>\s*0\s*&&\s*gameState\.gameTime\s*>=\s*gameState\.timeLimitSec/.test(loopSrc), 'time-up check wired');
    assert(/endGame\(\{\s*finished:\s*true\s*\}\)/.test(loopSrc), 'finish path calls endGame finished');
});

await test('P7-22. Hardcore 設定（速度・スコア倍率・シールド無し）', () => {
    gameModes.setMode('hardcore');
    const gs = makeGameState();
    gameModes.applyModeToState(gs);
    assert(gs.difficultyMultiplier > 1, 'hardcore is faster');
    assertEqual(gs.modeScoreMultiplier, 1.5, 'hardcore score x1.5');
    const w = gameModes.getModePowerupWeights('hardcore');
    assert(!('shield' in w), 'hardcore has no shield powerup');
    // スコア倍率が実加算へ効く（コア +100 → +150）。
    const gs2 = makeGameState({ modeScoreMultiplier: 1.5 });
    scoring.addCoreScore(gs2);
    assertEqual(gs2.bonusScore, 150, 'hardcore core score x1.5');
});

await test('P7-23. Training はランキング送信しない（model + 配線 + ガード）', async () => {
    assertEqual(gameModes.isRanked('training'), false, 'training not ranked');
    gameModes.setMode('training');
    gameModes.setTrainingSetting('invincible', true);
    gameModes.setTrainingSetting('obstacles', 'basic');
    const gs = makeGameState();
    gameModes.applyModeToState(gs);
    assertEqual(gs.invincible, true, 'training invincible applied');
    assertEqual(gs.allowedObstacles, 'basic', 'training obstacle set applied');

    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    assert(/isTraining\s*\?\s*\[\]\s*:\s*recordRunAndUnlock/.test(loopSrc), 'training skips achievements/stats');
    assert(/setScoreSubmitVisible\(!isTraining\)/.test(loopSrc), 'training hides submit section');

    // handleSendScore は training を二重防御で拒否する。
    let st = null;
    leaderboard.configureLeaderboard({ getRawName: () => 'X', setStatus: (m) => { st = m; }, updateButton: () => {} });
    leaderboard.prepareSubmission({ score: 100, maxCombo: 1, rank: 'D', mode: 'training' });
    await silenceConsole(async () => leaderboard.handleSendScore());
    assert(/not ranked/i.test(st || ''), `training submit refused, got: ${st}`);
    gameModes.setMode('endless'); // 後続テストへ影響させない
});

await test('P7-24. モード別ランキングクエリ', () => {
    for (const m of ['endless', 'timeattack', 'hardcore']) {
        const q = leaderboard.buildLeaderboardQuery({ period: 'overall', mode: m });
        assert(q.includes(`mode=eq.${m}`), `mode filter for ${m}`);
    }
    assert(!leaderboard.buildLeaderboardQuery({ mode: 'all' }).includes('mode=eq'), 'all = no mode filter');
});

// ===================================
// Phase 8: 成長 / カスタマイズ
// ===================================
await test('P8-25/26. XP 加算とレベル計算', async () => {
    const prog = await import(modUrl('model/progression.js'));
    // レベル曲線
    assertEqual(prog.totalXpForLevel(1), 0, 'L1 needs 0');
    assertEqual(prog.totalXpForLevel(2), 250, 'L2 needs 250');
    assertEqual(prog.totalXpForLevel(3), 750, 'L3 needs 750');
    assertEqual(prog.levelForXp(0), 1, 'xp0 -> L1');
    assertEqual(prog.levelForXp(250), 2, 'xp250 -> L2');
    assertEqual(prog.levelForXp(749), 2, 'xp749 -> L2');
    assertEqual(prog.levelForXp(750), 3, 'xp750 -> L3');
    // XP 配分（score 1000, mission, 実績1件）
    assertEqual(prog.computeRunXp({ score: 1000, missionCompleted: true, newlyAchievements: 1 }), 130, 'run xp');
});

await test('P8-27/28. profile 保存・復元 / localStorage 破損で既定値', async () => {
    const prog = await import(modUrl('model/progression.js'));
    globalThis.localStorage = memLocalStorage();
    await silenceConsole(async () => prog.loadProgression());
    const res = prog.recordRun({ mode: 'endless', score: 1000, survivalTime: 30, coreCount: 5, nearMissCount: 3 });
    assertEqual(res.xpGained, 40, 'xp = 20 + 1000*0.02'); // mission/ach なし
    assertEqual(prog.getBestForMode('endless'), 1000, 'mode best stored');
    // 復元（同じ localStorage から再読込）
    await silenceConsole(async () => prog.loadProgression());
    assertEqual(prog.getXp(), 40, 'xp restored');
    assertEqual(prog.getProgress().runs, 1, 'runs restored');

    // 破損 JSON → 既定値
    globalThis.localStorage = memLocalStorage({ [config.PROFILE_STORAGE_KEY]: '{broken', [config.PROGRESS_STORAGE_KEY]: 'nope' });
    await silenceConsole(async () => prog.loadProgression());
    assertEqual(prog.getXp(), 0, 'corrupt -> xp 0');
    assertEqual(prog.getLevel(), 1, 'corrupt -> L1');
    delete globalThis.localStorage;
});

await test('P8-29/30. 外観解放 と 未解放選択の禁止', async () => {
    const cos = await import(modUrl('model/cosmetics.js'));
    globalThis.localStorage = memLocalStorage();
    await silenceConsole(async () => cos.loadCosmetics());
    // 初期はレベル/実績ゲートが未解放
    assert(!cos.isUnlocked('color_magenta'), 'magenta locked initially');
    assertEqual(cos.selectCosmetic('color', 'color_magenta'), false, 'cannot select locked');
    // レベル3で解放 → 選択可
    const newly = cos.syncUnlocks({ level: 3, achievements: {}, challenges: {} });
    assert(newly.some((c) => c.id === 'color_magenta'), 'magenta unlocked at L3');
    assertEqual(cos.selectCosmetic('color', 'color_magenta'), true, 'can select after unlock');
    assertEqual(cos.getActive().color, '#ff44cc', 'active color applied');
    // 実績で解放
    const ach = cos.syncUnlocks({ level: 3, achievements: { combo_master: true }, challenges: {} });
    assert(ach.some((c) => c.id === 'color_orange'), 'achievement unlock');
    delete globalThis.localStorage;
});

await test('P8-31. 外観は性能差を生まない（視覚のみ）', async () => {
    const cos = await import(modUrl('model/cosmetics.js'));
    const keys = Object.keys(cos.getActive()).sort();
    assertDeepEqual(keys, ['color', 'coreEffect', 'glow', 'title', 'trail'], 'getActive exposes only visual fields');
    // モデルが速度/当たり判定/無敵/スコアへ触れていないこと（静的）。
    const src = readFileSync(path.join(JS_DIR, 'model/cosmetics.js'), 'utf8');
    assert(!/\b(speed|width|height|collid|invuln|shield|score)\b/i.test(src), 'cosmetics must not reference gameplay fields');
});

// ===================================
// Phase 9: デイリー / ウィークリーチャレンジ
// ===================================
const challenges = await import(modUrl('model/challenges.js'));
const challengeSvc = await import(modUrl('services/challenge-service.js'));

await test('P9-32/33. デイリー/ウィークリー seed が決定的（全ユーザー共通）', () => {
    const a = challenges.pickTemplates(challenges.DAILY_TEMPLATES, 12345, 3).map((t) => t.id);
    const b = challenges.pickTemplates(challenges.DAILY_TEMPLATES, 12345, 3).map((t) => t.id);
    assertDeepEqual(a, b, 'same seed -> same daily set');
    assertEqual(a.length, 3, 'daily picks 3');
    const w = challenges.pickTemplates(challenges.WEEKLY_TEMPLATES, 999, 2).map((t) => t.id);
    assertEqual(w.length, 2, 'weekly picks 2');
    // ISO 週（UTC）アルゴリズムの健全性
    const info = challengeSvc.localChallengeInfo(new Date('2026-06-27T12:00:00Z'));
    assertEqual(info.utc_date, '2026-06-27', 'utc date');
    assert(/^\d{4}-W\d{2}$/.test(info.iso_week), 'iso week format');
});

await test('P9-34/35. 進捗保存 と 報酬の重複取得防止', () => {
    globalThis.localStorage = memLocalStorage();
    challenges.loadChallenges();
    const info = challengeSvc.localChallengeInfo(new Date('2026-06-27T00:00:00Z'));
    challenges.refreshChallenges(info);

    const maxRun = {
        mode: 'endless', score: 100000, rank: 'S', survivalTime: 300,
        coreCount: 200, nearMissCount: 50, maxCombo: 30, dashCount: 0,
        shieldUsed: false, reachedLevel: 10
    };
    const r1 = challenges.applyRun(maxRun);
    assert(r1.xp > 0, 'first run awards XP');
    assert(r1.newly.length >= 3, 'daily (3) completed at least');
    const dailyDone = challenges.getChallengesView().daily.items.every((c) => c.completed);
    assert(dailyDone, 'all daily completed and progress saved');

    const r2 = challenges.applyRun(maxRun);
    assertEqual(r2.xp, 0, 'no XP re-award (dedup)');
    assertEqual(r2.newly.length, 0, 'no duplicate completion');
    delete globalThis.localStorage;
});

await test('P9-36. 期間変更で新チャレンジへ更新（同一キーは保持）', () => {
    globalThis.localStorage = memLocalStorage();
    challenges.loadChallenges();
    const info1 = challengeSvc.localChallengeInfo(new Date('2026-06-27T00:00:00Z'));
    challenges.refreshChallenges(info1);
    challenges.applyRun({ mode: 'endless', score: 100000, coreCount: 200, survivalTime: 300, nearMissCount: 50, dashCount: 0, shieldUsed: false, reachedLevel: 10, maxCombo: 30, rank: 'S' });
    // 同一キーで再 refresh → 進捗保持
    challenges.refreshChallenges(info1);
    assert(challenges.getChallengesView().daily.items.some((c) => c.progress > 0), 'same key keeps progress');
    // 別日 → daily 再生成（進捗リセット）
    const info2 = challengeSvc.localChallengeInfo(new Date('2026-06-28T00:00:00Z'));
    challenges.refreshChallenges(info2);
    const reset = challenges.getChallengesView().daily.items.every((c) => c.progress === 0 && !c.completed);
    assert(reset, 'new day resets daily progress');
    delete globalThis.localStorage;
});

await test('P9-37. Training ではチャレンジ進捗しない（controller ガード）', () => {
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    // onRunComplete（= XP/チャレンジ/ゴーストのフック）は Training 以外でのみ呼ばれる。
    assert(/if \(!isTraining\) \{[\s\S]*?onRunComplete\(/.test(loopSrc), 'onRunComplete guarded by !isTraining');
});

await test('P9-38. API 失敗時はローカル UTC フォールバック', async () => {
    challengeSvc.configureChallengeService({ endpointBase: '' });
    const info = await challengeSvc.fetchChallengeInfo();
    assertEqual(info.source, 'local', 'unconfigured -> local fallback');
    globalThis.localStorage = memLocalStorage();
    challenges.loadChallenges();
    challenges.refreshChallenges(info);
    assert(challenges.isFallback() === true, 'isFallback true on local');
    delete globalThis.localStorage;
});

// ===================================
// Phase 10: ゴースト / リプレイ / 共有
// ===================================
const replay = await import(modUrl('model/replay.js'));
const idb = await import(modUrl('util/indexed-db.js'));
const share = await import(modUrl('view/share-view.js'));

await test('P10-39. IndexedDB ラッパーは未対応環境でも throw しない（保存 API）', async () => {
    assertEqual(idb.idbAvailable(), false, 'Node: IndexedDB unavailable');
    const put = await silenceConsole(async () => idb.idbPut(config.REPLAY_DB_NAME, config.REPLAY_STORE_NAME, 'k', { a: 1 }));
    assertEqual(put, false, 'idbPut graceful false');
    const got = await silenceConsole(async () => idb.idbGet(config.REPLAY_DB_NAME, config.REPLAY_STORE_NAME, 'k'));
    assertEqual(got, null, 'idbGet graceful null');
    // ゴースト記録のサンプリングと補間（純粋）
    assert(replay.shouldSample(-Infinity, 0), 'first sample');
    assert(!replay.shouldSample(0, 0.05, 0.1), 'below interval');
    assert(replay.shouldSample(0, 0.1, 0.1), 'at interval');
    assertEqual(replay.interpolateX([{ t: 0, x: 100 }, { t: 1, x: 200 }], 0.5), 150, 'interpolate mid');
});

await test('P10-40/41. 自己ベスト時のみ保存（配線）/ モード別キー', async () => {
    // 自己ベスト判定の配線（main: prevBest 比較 + ランクモード限定）。
    const mainSrc = readFileSync(path.join(JS_DIR, 'main.js'), 'utf8');
    assert(/summary\.score > prevBest/.test(mainSrc), 'ghost saved only on personal best');
    assert(/RANKED_MODES\.includes\(summary\.mode\)/.test(mainSrc), 'only ranked modes');
    // モード別キーで保存（idbPut の key = mode）。
    const repSrc = readFileSync(path.join(JS_DIR, 'model/replay.js'), 'utf8');
    assert(/idbPut\([^)]*mode,/.test(repSrc.replace(/\s+/g, ' ')), 'ghost stored keyed by mode');
    // 記録の中身もモードを保持
    const rec = replay.buildGhostRecord('hardcore', [{ t: 0, x: 1 }], { score: 9 });
    assertEqual(rec.mode, 'hardcore', 'record carries mode');
    assertEqual(rec.version, config.GAME_VERSION, 'record carries version');
});

await test('P10-42. ゴーストは当たり判定を持たない（描画専用）', () => {
    const repSrc = readFileSync(path.join(JS_DIR, 'model/replay.js'), 'utf8');
    assert(!/collidesWith|intersect|collision/i.test(repSrc), 'replay model has no collision');
    // renderer はゴーストを描くが衝突に使わない（getGhostDisplayX を描画のみで使用）。
    const rendSrc = readFileSync(path.join(JS_DIR, 'view/renderer.js'), 'utf8');
    assert(/getGhostDisplayX/.test(rendSrc), 'renderer draws ghost');
    // game-loop の衝突は dashInvuln/invincible のみ（ゴーストを参照しない）。
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    assert(!/ghost/i.test(loopSrc.split('collidesWith')[1] || ''), 'collision path does not use ghost');
});

await test('P10-43/44. リプレイは state 分離・スコア送信しない（静的）', () => {
    for (const f of ['model/replay.js', 'view/replay-view.js']) {
        const src = readFileSync(path.join(JS_DIR, f), 'utf8');
        assert(!/from '\.\.?\/.*state\.js'/.test(src), `${f} must not import state`);
        assert(!/leaderboard\.js|run-service\.js|submitScore|handleSendScore/.test(src), `${f} must not submit scores`);
    }
    // リプレイプレイヤーは record のみで動作（gameState 不要）。
    const player = replay.createReplayPlayer({ version: config.GAME_VERSION, mode: 'endless', samples: [{ t: 0, x: 0 }, { t: 2, x: 400 }] });
    assertEqual(player.getDuration(), 2, 'duration from samples');
    player.play();
    player.step(1);
    assert(player.getTime() > 0 && player.getTime() <= 2, 'time advances');
    assertEqual(player.positionAt(), 200, 'position interpolated at t=1');
});

await test('P10-45/46. 結果カードと共有テキスト（PII なし）', () => {
    share.setShareData({ score: 1234, rank: 'A', maxCombo: 42, mode: 'endless', title: 'コンボ職人', level: 5 });
    const text = share.buildShareText();
    assert(text.includes('CYBER RUNNER'), 'has title');
    assert(text.includes('SCORE 1234 (A)'), 'score+rank');
    assert(text.includes('MODE ENDLESS'), 'mode');
    assert(text.includes('MAX COMBO 42'), 'combo');
    assert(text.includes('PLAYER LV 5'), 'level');
    // プレイヤー名などの個人情報を含めない。
    assert(!/player_name|anonymous_player_id/i.test(text), 'no PII fields');
});

// ===================================
// Phase 11: ウェーブ / ボス / イベント
// ===================================
globalThis.localStorage = memLocalStorage();
const waves = await import(modUrl('model/waves.js'));
const bosses = await import(modUrl('model/bosses.js'));
const randomEvents = await import(modUrl('model/random-events.js'));
const stateMod = await import(modUrl('state.js'));
const waveCtrl = await import(modUrl('controller/wave-controller.js'));

// ウェーブ系の共有状態をクリーンにしてから 1 ラン分の前提をそろえる。
function freshRun(mode = 'endless') {
    stateMod.gameState.mode = mode;
    stateMod.gameState.allowedObstacles = 'all';
    stateMod.gameState.difficultyMultiplier = 1;
    stateMod.gameState.gameTime = 0;
    stateMod.obstacles.length = 0;
    stateMod.energyCores.length = 0;
    stateMod.particles.length = 0;
    stateMod.popups.length = 0;
    waveCtrl.initWaveSystem();
}
function stepWave(seconds, step = 0.1) {
    let killed = false;
    const n = Math.ceil(seconds / step);
    for (let i = 0; i < n; i++) {
        const r = waveCtrl.updateWaveSystem(step);
        if (r && r.playerKilled) killed = true;
    }
    return killed;
}

await test('P11-01. Wave 1→5 遷移・休憩・ボス出現（状態機械）', () => {
    freshRun('endless');
    assert(stateMod.waveState.enabled, 'wave system enabled');
    assertEqual(stateMod.waveState.waveNumber, 1, 'starts at wave 1');
    assertEqual(stateMod.waveState.phase, 'intro', 'starts in intro');
    const seenWaves = new Set();
    const seenPhases = new Set();
    let reachedBoss = false;
    for (let i = 0; i < 3000 && !reachedBoss; i++) {
        waveCtrl.updateWaveSystem(0.1);
        seenWaves.add(stateMod.waveState.waveNumber);
        seenPhases.add(stateMod.waveState.phase);
        if (stateMod.waveState.phase === 'boss') reachedBoss = true;
    }
    for (const w of [1, 2, 3, 4, 5]) assert(seenWaves.has(w), `wave ${w} reached`);
    assert(seenPhases.has('intermission'), 'wave intermission happened');
    assert(seenPhases.has('boss-warning'), 'boss warning shown before boss');
    assert(reachedBoss, 'boss phase reached');
    assert(stateMod.waveState.boss && stateMod.waveState.boss.type === 'firewall', 'cycle 1 boss = firewall');
});

await test('P11-02. ボス HP 減少・撃破・次サイクル移行', () => {
    freshRun('endless');
    // ボスへ直接到達させる（cycle1 = firewall）。
    let guard = 0;
    while (stateMod.waveState.phase !== 'boss' && guard++ < 3000) waveCtrl.updateWaveSystem(0.1);
    const boss = stateMod.waveState.boss;
    assert(boss, 'boss exists');
    const startHp = boss.hp;
    waveCtrl.applyBossDamage(1);
    assertEqual(boss.hp, startHp - 1, 'boss HP decreases by 1');
    for (let k = 0; k < boss.maxHp; k++) waveCtrl.applyBossDamage(1);
    assert(boss.defeated, 'boss defeated when HP 0');
    assertEqual(stateMod.waveState.phase, 'boss-defeated', 'defeat phase');
    assertEqual(stateMod.gameState.bossDefeated, 1, 'bossDefeated stat incremented');
    const cycleBefore = stateMod.waveState.cycle;
    stepWave(3.0); // 撃破演出（BOSS_DEFEAT_SEC）を消化
    assertEqual(stateMod.waveState.cycle, cycleBefore + 1, 'advances to next cycle (Endless)');
    assertEqual(stateMod.waveState.waveNumber, 1, 'next cycle starts at wave 1');
    assert(stateMod.gameState.waveSpeedBonus > 0, 'cycle difficulty increased');
});

await test('P11-03. pause で全ウェーブ/ボス時間が停止（deltaTime・専用RAFなし）', () => {
    const wcSrc = readFileSync(path.join(JS_DIR, 'controller/wave-controller.js'), 'utf8');
    assert(!/setInterval\s*\(/.test(wcSrc), 'wave-controller uses no setInterval');
    assert(!/requestAnimationFrame\s*\(/.test(wcSrc), 'wave-controller adds no extra RAF');
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    assert(/updateWaveSystem\(delta\)/.test(loopSrc), 'wave system advanced by loop delta');
    assert(/if \(!gameState\.isRunning \|\| gameState\.isPaused\) return/.test(loopSrc), 'loop frozen while paused');
    assert(/initWaveSystem\(\)/.test(loopSrc), 'startGame initializes wave system');
});

await test('P11-04. RETRY / モード変更で完全リセット', () => {
    // 状態を汚す
    stateMod.waveState.cycle = 7;
    stateMod.waveState.phase = 'boss';
    stateMod.waveState.boss = { type: 'worm', hp: 3, maxHp: 5 };
    stateMod.waveState.event = { id: 'high_speed' };
    stateMod.gameState.darkZone = true;
    stateMod.gameState.eventSpeedMult = 2;
    stateMod.gameState.eventCoreMult = 3;
    stateMod.gameState.laserStorm = true;
    stateMod.gameState.waveSpeedBonus = 0.5;
    stateMod.resetState();
    assertEqual(stateMod.waveState.enabled, false, 'wave disabled after reset');
    assertEqual(stateMod.waveState.cycle, 1, 'cycle reset');
    assertEqual(stateMod.waveState.boss, null, 'boss cleared');
    assertEqual(stateMod.waveState.event, null, 'event cleared');
    assertEqual(stateMod.waveState.phase, 'intro', 'phase reset');
    assertEqual(stateMod.gameState.darkZone, false, 'darkZone reset');
    assertEqual(stateMod.gameState.eventSpeedMult, 1, 'eventSpeedMult reset to 1');
    assertEqual(stateMod.gameState.eventCoreMult, 1, 'eventCoreMult reset to 1');
    assertEqual(stateMod.gameState.laserStorm, false, 'laserStorm reset');
    assertEqual(stateMod.gameState.waveSpeedBonus, 0, 'waveSpeedBonus reset');
});

await test('P11-05. Hardcore 補正（ウェーブ短縮・ボス間隔短縮・回避不能化しない）', () => {
    assert(waves.waveDurationSec('hardcore') < waves.waveDurationSec('endless'), 'hardcore waves are shorter');
    assert(bosses.bossAttackInterval(10, 'hardcore') < bosses.bossAttackInterval(10, 'endless'), 'hardcore boss attacks faster');
    assert(config.HARDCORE_WAVE_SPEED_FACTOR < 1 && config.HARDCORE_BOSS_INTERVAL_FACTOR < 1, 'hardcore factors < 1');
    // 回避不能化の禁止: 警告時間と最小通過幅が確保されている。
    assert(config.BOSS_WARNING_SEC > 0 && config.LASER_WARNING_TIME > 0 && config.BOSS_WORM_ATTACK_WARNING > 0, 'warnings remain');
    assert(config.BOSS_GATE_MIN_GAP >= config.PLAYER_WIDTH + 40, 'gate min gap stays passable');
});

await test('P11-06. ボス HP はサイクルで増加し撃破可能（巡回）', () => {
    assertEqual(bosses.bossTypeForCycle(1), 'firewall', 'cycle1 firewall');
    assertEqual(bosses.bossTypeForCycle(2), 'worm', 'cycle2 worm');
    assertEqual(bosses.bossTypeForCycle(3), 'gate', 'cycle3 gate');
    assertEqual(bosses.bossTypeForCycle(4), 'firewall', 'cycle4 wraps to firewall');
    assert(bosses.scaledBossHp(5, 2) >= bosses.scaledBossHp(5, 1), 'HP scales up with cycle');
    const b = bosses.createBoss('gate', { cycle: 1, mode: 'endless' });
    assert(b.hp === b.maxHp && b.hp >= 1, 'boss starts full HP');
    const dead = bosses.damageBoss(b, b.maxHp);
    assert(dead && b.defeated, 'boss is defeatable');
});

await test('P11-07. 各イベントの効果適用と終了後の完全復元', () => {
    const gs = makeGameState({ gameTime: 0 });
    gs.eventCoreMult = 1; gs.eventSpeedMult = 1; gs.darkZone = false; gs.laserStorm = false; gs.doubleUntil = 0;
    // CORE RUSH
    let snap = randomEvents.applyEvent(gs, 'core_rush');
    assertEqual(gs.eventCoreMult, config.EVENT_CORE_RUSH_MULT, 'core rush boosts core rate');
    randomEvents.restoreEvent(gs, snap);
    assertEqual(gs.eventCoreMult, 1, 'core rate restored exactly');
    // HIGH SPEED
    snap = randomEvents.applyEvent(gs, 'high_speed');
    assertEqual(gs.eventSpeedMult, config.EVENT_HIGH_SPEED_MULT, 'high speed multiplies speed');
    randomEvents.restoreEvent(gs, snap);
    assertEqual(gs.eventSpeedMult, 1, 'speed restored exactly to 1');
    // DARK ZONE
    snap = randomEvents.applyEvent(gs, 'dark_zone');
    assertEqual(gs.darkZone, true, 'dark zone on');
    randomEvents.restoreEvent(gs, snap);
    assertEqual(gs.darkZone, false, 'dark zone off');
    // LASER STORM
    snap = randomEvents.applyEvent(gs, 'laser_storm');
    assertEqual(gs.laserStorm, true, 'laser storm on');
    randomEvents.restoreEvent(gs, snap);
    assertEqual(gs.laserStorm, false, 'laser storm off');
});

await test('P11-08. DOUBLE SCORE 終了後もスコアが減少しない', () => {
    const gs = makeGameState({ gameTime: 5, bonusScore: 200, survivalScore: 100 });
    randomEvents.applyEvent(gs, 'double_score');
    assert(gs.doubleUntil >= 5 + config.EVENT_DURATION_SEC - 1e-6, 'double extends doubleUntil');
    scoring.composeScore(gs);
    const before = gs.score;
    // 効果終了（時間を進める）→ 既獲得スコアは不変
    gs.gameTime = 5 + config.EVENT_DURATION_SEC + 1;
    scoring.composeScore(gs);
    assert(gs.score >= before, 'score never decreases after double ends');
    // 終了後の新規コアは x1（倍率は失効）
    const bonusBefore = gs.bonusScore;
    scoring.addCoreScore(gs);
    assertEqual(gs.bonusScore, bonusBefore + config.ENERGY_CORE_SCORE, 'post-double core adds x1');
});

await test('P11-09. イベントは同時に1つ・開始/警告/終了/復元の一連が動く（controller）', () => {
    freshRun('training'); // 手動モード（自動進行・自動イベントなし）
    assertEqual(stateMod.waveState.manual, true, 'training is manual');
    stateMod.gameState.eventSpeedMult = 1;
    waveCtrl.trainingStartEvent('high_speed');
    assert(stateMod.waveState.event && stateMod.waveState.event.id === 'high_speed', 'event started');
    // 別イベントを開始しても同時に2つにならない（直前を終了して置換）
    waveCtrl.trainingStartEvent('core_rush');
    assertEqual(stateMod.waveState.event.id, 'core_rush', 'only one event active at a time');
    // core_rush（警告なし）は即適用
    assertEqual(stateMod.gameState.eventCoreMult, config.EVENT_CORE_RUSH_MULT, 'no-warning event applies immediately');
    // 終了まで進める → 完全復元
    stepWave(config.EVENT_DURATION_SEC + 1.0);
    assertEqual(stateMod.waveState.event, null, 'event ends');
    assertEqual(stateMod.gameState.eventCoreMult, 1, 'effect fully restored after event');
});

await test('P11-10. HIGH SPEED は警告後に適用され終了で正確に元へ戻る（controller）', () => {
    freshRun('training');
    stateMod.gameState.eventSpeedMult = 1;
    waveCtrl.trainingStartEvent('high_speed');
    // 警告中は未適用
    assertEqual(stateMod.gameState.eventSpeedMult, 1, 'effect not applied during warning');
    stepWave(config.EVENT_WARNING_SEC + 0.3);
    assertEqual(stateMod.gameState.eventSpeedMult, config.EVENT_HIGH_SPEED_MULT, 'applied after warning');
    stepWave(config.EVENT_DURATION_SEC + 1.0);
    assertEqual(stateMod.gameState.eventSpeedMult, 1, 'restored to exactly 1 after end');
});

await test('P11-11. game-loop にボスダメージ判定が配線されている（core/dash弱点/gate通過）', () => {
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    assert(/boss\.type === 'firewall'[\s\S]*?applyBossDamage\(1\)/.test(loopSrc), 'firewall core damage wired');
    assert(/bossWeakPoint[\s\S]*?applyBossDamage\(1\)/.test(loopSrc), 'worm weak-point dash damage wired');
    assert(/bossGate[\s\S]*?applyBossDamage\(1\)/.test(loopSrc), 'gate pass damage wired');
    // 弱点はダッシュ無敵中のみ有効（通常接触は失敗扱い）。
    assert(/bossWeakPoint && gameState\.gameTime < gameState\.dashInvulnUntil/.test(loopSrc), 'weak-point requires dash invuln');
});

await test('P11-12. Firewall 安全地帯は常に画面内に存在し上限レーザーで塞がない', () => {
    const boss = bosses.createBoss('firewall', { cycle: 1, mode: 'endless' });
    for (let p = 0; p < 24; p++) {
        boss.safePhase = p * 0.37;
        const c = bosses.firewallSafeCenter(boss);
        const left = c - config.BOSS_FIREWALL_SAFE_WIDTH / 2;
        const right = c + config.BOSS_FIREWALL_SAFE_WIDTH / 2;
        assert(left >= 0 && right <= config.CANVAS_WIDTH, `safe zone within screen at phase ${p}`);
    }
    assert(config.BOSS_FIREWALL_MAX_LASERS >= 1, 'laser cap exists');
    assert(config.BOSS_FIREWALL_SAFE_WIDTH >= config.PLAYER_WIDTH + 40, 'safe zone wider than player');
});

delete globalThis.localStorage;

// ===================================
// Phase 12: モバイル操作 / PWA
// ===================================
const touchSrc = readFileSync(path.join(JS_DIR, 'controller/touch-input.js'), 'utf8');
const swSrc = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const htmlSrc = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cssSrc = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const manifestRaw = readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8');

await test('P12-01. タッチ入力は Pointer Events と解除イベントを扱う', () => {
    for (const ev of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) {
        assert(touchSrc.includes(ev), `touch-input handles ${ev}`);
    }
    assert(/visibilitychange/.test(touchSrc), 'clears input on visibilitychange');
    assert(/setPointerCapture/.test(touchSrc), 'uses pointer capture (finger off-screen safe)');
    assert(/let registered = false/.test(touchSrc), 'touch input dedups registration');
    assert(/maxTouchPoints|ontouchstart/.test(touchSrc), 'touch device detection present');
});

await test('P12-02. タッチとキーボードが同一の player フラグを共有（共存）', () => {
    // touch-input も input.js も player.moveLeft/Right を更新する（共存・破綻しない）。
    assert(/player\.moveLeft|player\.moveRight/.test(touchSrc), 'touch updates player move flags');
    const inputSrc = readFileSync(path.join(JS_DIR, 'controller/input.js'), 'utf8');
    assert(/player\.moveLeft|player\.moveRight/.test(inputSrc), 'keyboard updates same player move flags');
    // game-loop は遷移時にキー/タッチ両方を解除する。
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    assert(/clearTouch\(\)/.test(loopSrc), 'game-loop clears touch on lifecycle transitions');
});

await test('P12-03. PWA サービスは SW 非対応環境で throw しない', async () => {
    const pwa = await import(modUrl('services/pwa-service.js'));
    let threw = false;
    let result;
    await silenceConsole(async () => {
        try { result = await pwa.registerServiceWorker(); } catch (_e) { threw = true; }
    });
    assert(!threw, 'registerServiceWorker must not throw without SW support');
    assertEqual(result, null, 'returns null when serviceWorker unavailable');
    assertEqual(typeof pwa.isOnline(), 'boolean', 'isOnline returns boolean safely');
});

await test('P12-04. manifest が必須項目を満たし相対パス（GitHub Pages サブパス対応）', () => {
    const m = JSON.parse(manifestRaw);
    for (const k of ['id', 'name', 'short_name', 'description', 'start_url', 'scope', 'display', 'theme_color', 'background_color', 'icons']) {
        assert(k in m, `manifest has ${k}`);
    }
    assertEqual(m.display, 'standalone', 'display standalone');
    assert(m.start_url.startsWith('./') || m.start_url.startsWith('?') || m.start_url === '.', 'start_url is relative');
    assert(m.scope === './' || m.scope === '.', 'scope is relative');
    assert(Array.isArray(m.icons) && m.icons.length >= 2, 'has icons');
    const sizes = m.icons.map((i) => i.sizes);
    assert(sizes.includes('192x192') && sizes.includes('512x512'), 'has 192 and 512 icons');
    assert(m.icons.some((i) => /maskable/.test(i.purpose || '')), 'has a maskable icon');
    for (const i of m.icons) assert(i.src.startsWith('./'), `icon src relative: ${i.src}`);
    // アイコン実体が存在する。
    for (const rel of ['assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png', 'assets/icons/icon.svg']) {
        assert(existsSync(path.join(ROOT, rel)), `icon file exists: ${rel}`);
    }
});

await test('P12-05. Service Worker: バージョン付きキャッシュ・install/activate/fetch・旧削除', () => {
    assert(/const CACHE_VERSION/.test(swSrc) && /cyber-runner-cache-/.test(swSrc), 'versioned cache name');
    for (const ev of ["addEventListener('install'", "addEventListener('activate'", "addEventListener('fetch'"]) {
        assert(swSrc.includes(ev), `sw has ${ev}`);
    }
    assert(/caches\.delete/.test(swSrc), 'deletes old caches on activate');
    assert(/networkFirst/.test(swSrc) && /text\/html/.test(swSrc), 'HTML network-first');
    assert(/staleWhileRevalidate/.test(swSrc), 'static stale-while-revalidate');
    assert(/SKIP_WAITING/.test(swSrc), 'supports user-triggered update (skipWaiting)');
});

await test('P12-06. Service Worker は API/POST/Supabase をキャッシュしない', () => {
    assert(/req\.method !== 'GET'/.test(swSrc), 'non-GET (POST) bypassed');
    assert(/url\.origin !== self\.location\.origin/.test(swSrc), 'cross-origin (Supabase) bypassed');
    for (const api of ['start-run', 'submit-score', 'submit-analytics', 'challenges', 'analytics']) {
        assert(swSrc.includes(api), `no-cache pattern includes ${api}`);
    }
});

await test('P12-07. index.html の PWA/タッチ配線（manifest・theme・viewport・aria）', () => {
    assert(/rel="manifest"/.test(htmlSrc), 'manifest linked');
    assert(/name="theme-color"/.test(htmlSrc), 'theme-color meta');
    assert(/viewport-fit=cover/.test(htmlSrc), 'viewport-fit=cover for safe-area');
    assert(/id="touchControls"/.test(htmlSrc), 'touch controls container');
    for (const id of ['touchLeft', 'touchRight', 'touchDash', 'touchPause']) {
        assert(htmlSrc.includes(`id="${id}"`), `has ${id} button`);
    }
    // 各操作ボタンに aria-label。
    const ariaCount = (htmlSrc.match(/class="touch-btn[^"]*"[^>]*aria-label=/g) || []).length;
    assert(ariaCount >= 4, 'touch buttons have aria-label');
});

await test('P12-08. CSS: 44px 以上のタッチ領域・safe-area・reduced-motion・focus 可視', () => {
    assert(/min-width:\s*(4[4-9]|[5-9]\d|\d{3,})px/.test(cssSrc) || /min-width:\s*64px/.test(cssSrc), 'touch target >= 44px width');
    assert(/min-height:\s*(4[4-9]|[5-9]\d|\d{3,})px/.test(cssSrc), 'touch target >= 44px height');
    assert(/env\(safe-area-inset/.test(cssSrc), 'uses safe-area-inset');
    assert(/prefers-reduced-motion/.test(cssSrc), 'respects reduced motion');
    assert(/:focus-visible/.test(cssSrc), 'visible focus styles');
    assert(/touch-action:\s*none/.test(cssSrc), 'canvas/buttons prevent gesture scroll');
    assert(/\.touch-btn\.pressed/.test(cssSrc), 'pressed state styled (not color-only: scale+outline)');
});

await test('P12-09. touchControls オプションは三状態（auto/true/false）で安全に検証', async () => {
    const options = await import(modUrl('model/options.js'));
    globalThis.localStorage = memLocalStorage({ [config.OPTIONS_STORAGE_KEY]: JSON.stringify({ touchControls: 'nonsense' }) });
    await silenceConsole(async () => options.loadOptions());
    assertEqual(options.getOptions().touchControls, 'auto', 'invalid -> auto');
    await silenceConsole(async () => options.setOption('touchControls', false));
    assertEqual(options.getOptions().touchControls, false, 'explicit false kept');
    await silenceConsole(async () => options.setOption('touchControls', true));
    assertEqual(options.getOptions().touchControls, true, 'explicit true kept');
    delete globalThis.localStorage;
});

await test('P12-10. 外部 CDN を追加していない（アイコン等はプロジェクト内）', () => {
    // index.html / manifest / sw に http(s) の外部参照が無い（Supabase はフロント JS の API 用で別途許可済み）。
    assert(!/https?:\/\//.test(manifestRaw), 'manifest has no external URLs');
    const htmlExternal = (htmlSrc.match(/(href|src)="https?:\/\/[^"]+"/g) || []);
    assert(htmlExternal.length === 0, `index.html has no external CDN refs: ${htmlExternal.join(', ')}`);
});

// ===================================
// Phase 13: 匿名分析 / バランス管理
// ===================================
const analyticsValidationUrl = pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/analytics-validation.js')).href;
const av = await import(analyticsValidationUrl);
const analyticsMigration = readFileSync(path.join(ROOT, 'supabase/migrations/20260628120000_gameplay_analytics.sql'), 'utf8');
const submitAnalyticsSrc = readFileSync(path.join(ROOT, 'supabase/functions/submit-analytics/index.ts'), 'utf8');

function goodAnalytics(over = {}) {
    return {
        event_id: 'evt-abcdefgh', game_version: '1.0.0', balance_version: '1.0.0', mode: 'endless',
        score: 1234, duration_ms: 30000, reached_level: 4, max_combo: 12, core_count: 8,
        near_miss_count: 3, dash_count: 2, death_cause: 'obstacle', wave_reached: 3,
        boss_reached: 0, boss_defeated: 0, powerups_collected: 2, pwa_mode: 'browser', device_class: 'desktop',
        ...over
    };
}

await test('P13-01. 初期同意 OFF / 同意 ON / 撤回後 OFF', async () => {
    const analytics = await import(modUrl('model/analytics.js'));
    globalThis.localStorage = memLocalStorage(); // キーなし = 初期
    assertEqual(analytics.hasConsent(), false, 'default consent OFF');
    await silenceConsole(async () => analytics.setConsent(true));
    assertEqual(analytics.hasConsent(), true, 'consent ON after grant');
    await silenceConsole(async () => analytics.setConsent(false));
    assertEqual(analytics.hasConsent(), false, 'consent OFF after revoke');
    delete globalThis.localStorage;
});

await test('P13-02. payload に個人情報項目が無く、必須項目を含む / balance_version 記録', async () => {
    globalThis.localStorage = memLocalStorage();
    const analytics = await import(modUrl('model/analytics.js'));
    const balance = await import(modUrl('model/balance.js'));
    const payload = analytics.buildPayload({
        mode: 'endless', score: 500, durationMs: 20000, reachedLevel: 3, maxCombo: 5,
        coreCount: 4, nearMissCount: 2, dashCount: 1, deathCause: 'laser',
        waveReached: 2, bossReached: 0, bossDefeated: 0, powerupsCollected: 1
    }, { deviceClass: 'desktop', pwaMode: 'browser' });
    for (const k of ['player_name', 'email', 'user_id', 'anonymous_player_id', 'ip', 'ip_address', 'run_id', 'replay', 'ghost', 'user_agent', 'fingerprint', 'created_at']) {
        assert(!(k in payload), `payload must not include ${k}`);
    }
    for (const k of ['event_id', 'game_version', 'balance_version', 'mode', 'score', 'duration_ms', 'reached_level', 'max_combo', 'core_count', 'near_miss_count', 'dash_count', 'death_cause', 'wave_reached', 'boss_reached', 'boss_defeated', 'powerups_collected', 'pwa_mode', 'device_class']) {
        assert(k in payload, `payload missing ${k}`);
    }
    assertEqual(payload.balance_version, balance.getBalanceVersion(), 'balance_version recorded');
    // 検証器でも合格すること（クライアント payload はサーバー契約を満たす）。
    assert(av.validateAnalyticsPayload(payload).ok, 'client payload passes server validation');
    delete globalThis.localStorage;
});

await test('P13-03. 分析検証: 正常→ok / Training→拒否 / 異常値→拒否', () => {
    assert(av.validateAnalyticsPayload(goodAnalytics()).ok, 'valid analytics ok');
    assert(!av.validateAnalyticsPayload(goodAnalytics({ mode: 'training' })).ok, 'training rejected');
    assert(!av.validateAnalyticsPayload(goodAnalytics({ mode: 'cheat' })).ok, 'invalid mode rejected');
    assert(!av.validateAnalyticsPayload(goodAnalytics({ score: -1 })).ok, 'negative score rejected');
    assert(!av.validateAnalyticsPayload(goodAnalytics({ score: av.ANALYTICS_LIMITS.SCORE_MAX + 1 })).ok, 'over-max score rejected');
    assert(!av.validateAnalyticsPayload(goodAnalytics({ death_cause: 'meteor' })).ok, 'invalid death_cause rejected');
    assert(!av.validateAnalyticsPayload(goodAnalytics({ device_class: 'watch' })).ok, 'invalid device_class rejected');
    assert(!av.validateAnalyticsPayload(goodAnalytics({ event_id: 'short' })).ok, 'too-short event_id rejected');
    assert(!av.validateAnalyticsPayload(goodAnalytics({ boss_defeated: 3, boss_reached: 1 })).ok, 'boss_defeated > boss_reached rejected');
});

await test('P13-04. 個人情報項目の混入を検証で拒否 / cleaned に残さない', () => {
    for (const k of ['player_name', 'email', 'user_id', 'run_id', 'ip', 'created_at']) {
        const res = av.validateAnalyticsPayload(goodAnalytics({ [k]: 'x' }));
        assert(!res.ok, `payload with forbidden ${k} rejected`);
    }
    // 余分な許可外キーは cleaned に持ち越さない（許可フィールドのみ）。
    const cleaned = av.validateAnalyticsPayload(goodAnalytics()).cleaned;
    for (const k of Object.keys(cleaned)) assert(av.ANALYTICS_ALLOWED_FIELDS.includes(k), `cleaned only allowed fields: ${k}`);
});

await test('P13-05. payload サイズ上限 / レート制限関数', () => {
    const huge = goodAnalytics({ event_id: 'e'.repeat(40), game_version: 'v'.repeat(30) });
    huge.death_cause = 'obstacle';
    // 巨大な不要文字列を足してサイズ超過させる（検証器はサイズ＋禁止キーで弾く）。
    const oversized = { ...goodAnalytics(), blob: 'x'.repeat(3000) };
    assert(!av.validateAnalyticsPayload(oversized).ok, 'oversized payload rejected');
    const now = 1_000_000;
    const many = Array.from({ length: 20 }, (_, i) => now - i * 100);
    assert(av.isAnalyticsRateLimited(many, now, 60000, 20), 'at limit -> limited');
    assert(!av.isAnalyticsRateLimited(many.slice(1), now, 60000, 20), 'below limit -> ok');
    void huge;
});

await test('P13-06. 送信サービス: 未配備/オフライン/重複は送らない・失敗で throw しない・無断再送なし', async () => {
    const svc = await import(modUrl('services/analytics-service.js'));
    let calls = 0;
    const origFetch = globalThis.fetch;

    // (a) 未配備 → 送らない
    svc.configureAnalyticsService({ endpointBase: '' });
    globalThis.fetch = async () => { calls++; return { ok: true, status: 200 }; };
    let r = await silenceConsole(async () => svc.submitAnalytics(goodAnalytics({ event_id: 'evt-unconfig1' })));
    assert(!r.ok && r.skipped === 'unconfigured', 'unconfigured -> skipped');
    assertEqual(calls, 0, 'no fetch when unconfigured');

    // (b) 配備済み + 成功 → 1回だけ送信
    svc.configureAnalyticsService({ endpointBase: 'https://example.test/functions/v1' });
    r = await silenceConsole(async () => svc.submitAnalytics(goodAnalytics({ event_id: 'evt-send-0001' })));
    assert(r.ok, 'configured send ok');
    assertEqual(calls, 1, 'one fetch on success');

    // (c) 同一 event_id は再送しない（重複防止）
    r = await silenceConsole(async () => svc.submitAnalytics(goodAnalytics({ event_id: 'evt-send-0001' })));
    assert(!r.ok && r.skipped === 'duplicate', 'duplicate event_id skipped');
    assertEqual(calls, 1, 'no second fetch for duplicate');

    // (d) 失敗しても throw せず、失敗データを無断再送しない
    globalThis.fetch = async () => { throw new Error('network down'); };
    let threw = false;
    r = await silenceConsole(async () => { try { return await svc.submitAnalytics(goodAnalytics({ event_id: 'evt-fail-0002' })); } catch (_e) { threw = true; } });
    assert(!threw, 'submit must not throw on failure');
    assert(r && !r.ok, 'failure returns not-ok');
    // 再試行しても同一 event_id は再送されない
    let calls2 = 0;
    globalThis.fetch = async () => { calls2++; return { ok: true, status: 200 }; };
    await silenceConsole(async () => svc.submitAnalytics(goodAnalytics({ event_id: 'evt-fail-0002' })));
    assertEqual(calls2, 0, 'no auto-resend of failed event_id');

    svc.configureAnalyticsService({ endpointBase: '' });
    if (origFetch) globalThis.fetch = origFetch; else delete globalThis.fetch;
});

await test('P13-07. Training/Replay は分析を送らない（配線・モード判定）', async () => {
    globalThis.localStorage = memLocalStorage();
    const analytics = await import(modUrl('model/analytics.js'));
    assertEqual(analytics.isAnalyticsMode('training'), false, 'training not an analytics mode');
    assert(analytics.isAnalyticsMode('endless') && analytics.isAnalyticsMode('timeattack') && analytics.isAnalyticsMode('hardcore'), 'ranked modes are analytics modes');
    // main は !isTraining の onRunComplete 内で、かつ isAnalyticsMode のときのみ送信する。
    const mainSrc = readFileSync(path.join(JS_DIR, 'main.js'), 'utf8');
    assert(/hasConsent\(\)\s*&&\s*isAnalyticsMode\(summary\.mode\)/.test(mainSrc), 'consent + analytics-mode gate');
    // Replay 関連は analytics を一切 import しない。
    for (const f of ['model/replay.js', 'view/replay-view.js']) {
        const src = readFileSync(path.join(JS_DIR, f), 'utf8');
        assert(!/analytics/i.test(src), `${f} must not touch analytics`);
    }
    delete globalThis.localStorage;
});

await test('P13-08. 分析はゲーム/スコア/XP へ影響しない（モデルが gameState を変更しない）', async () => {
    const aSrc = readFileSync(path.join(JS_DIR, 'model/analytics.js'), 'utf8');
    const sSrc = readFileSync(path.join(JS_DIR, 'services/analytics-service.js'), 'utf8');
    assert(!/gameState/.test(aSrc), 'analytics model does not reference gameState');
    assert(!/\b(score|xp|survivalScore|bonusScore)\s*=/.test(aSrc), 'analytics model does not assign score/xp');
    assert(!/gameState/.test(sSrc), 'analytics service does not reference gameState');
    // main は失敗を握りつぶす（.catch）。
    const mainSrc = readFileSync(path.join(JS_DIR, 'main.js'), 'utf8');
    assert(/submitAnalytics\([\s\S]*?\)\.catch\(/.test(mainSrc), 'analytics submit is fire-and-forget (.catch)');
});

await test('P13-09. migration: RLS / public SELECT 禁止 / event_id 一意 / CHECK / 生 IP 列なし', () => {
    assert(/enable row level security/i.test(analyticsMigration), 'RLS enabled');
    assert(/revoke all on public\.gameplay_analytics from anon/i.test(analyticsMigration), 'anon revoked');
    assert(/revoke all on public\.gameplay_analytics from authenticated/i.test(analyticsMigration), 'authenticated revoked');
    assert(!/create policy/i.test(analyticsMigration), 'no client-accessible policy (writes via service_role only)');
    assert(/event_id\s+text\s+not null\s+unique/i.test(analyticsMigration), 'event_id unique');
    assert(/created_at\s+timestamptz\s+not null\s+default now\(\)/i.test(analyticsMigration), 'created_at server-side default');
    assert(/check \(mode in \('endless','timeattack','hardcore'\)\)/i.test(analyticsMigration), 'mode CHECK (no training)');
    assert(/check \(score >= 0 and score <= 1000000000\)/i.test(analyticsMigration), 'score CHECK');
    assert(/boss_defeated <= boss_reached/i.test(analyticsMigration), 'boss logical CHECK');
    // 個人情報列を持たない（SQL コメントを除いた本体で判定）。
    const migrationCode = analyticsMigration.replace(/--[^\n]*/g, '');
    for (const col of ['player_name', 'email', 'user_id', 'ip_address', 'user_agent', 'run_id']) {
        assert(!new RegExp('\\b' + col + '\\b').test(migrationCode), `no ${col} column`);
    }
    // ip_hash（ソルト付き）は許容。生 IP は無いこと（上で ip_address を禁止済み）。
    assert(/ip_hash/.test(migrationCode), 'ip_hash (salted, for rate-limit) present, raw IP absent');
});

await test('P13-10. submit-analytics Edge Function の契約（service_role/検証/各ステータス/秘密非ログ）', () => {
    assert(/SUPABASE_SERVICE_ROLE_KEY/.test(submitAnalyticsSrc), 'service_role from env');
    assert(/validateAnalyticsPayload/.test(submitAnalyticsSrc), 'uses shared validation');
    assert(/training is not analyzed[\s\S]*?400/.test(submitAnalyticsSrc) || /mode === "training"[\s\S]*?400/.test(submitAnalyticsSrc), 'training -> 400');
    assert(/422/.test(submitAnalyticsSrc), 'validation failure -> 422');
    assert(/23505[\s\S]*?409/.test(submitAnalyticsSrc), 'duplicate event_id -> 409');
    assert(/429/.test(submitAnalyticsSrc) && /Retry-After/.test(submitAnalyticsSrc), 'rate limit -> 429 + Retry-After');
    assert(/insert failed[\s\S]*?500/.test(submitAnalyticsSrc), 'DB error -> 500');
    assert(/RATE_LIMIT_IP_SALT/.test(submitAnalyticsSrc) && /hashIp/.test(submitAnalyticsSrc), 'salted IP hash for rate limit (no raw IP stored)');
    // 秘密をログに出さない（console.log で serviceKey/payload を出力しない）。
    assert(!/console\.log\([^)]*serviceKey/.test(submitAnalyticsSrc), 'no secret logging');
});

await test('P13-11. balance: BALANCE_VERSION と単一参照点 / 現在値の移行', async () => {
    const balance = await import(modUrl('model/balance.js'));
    const presets = await import(modUrl('config/balance-presets.js'));
    assert(typeof balance.getBalanceVersion() === 'string' && balance.getBalanceVersion().length > 0, 'BALANCE_VERSION string');
    assertEqual(balance.getBalanceVersion(), presets.BALANCE_VERSION, 'version single source');
    const p = balance.getActivePreset();
    // 既定 preset は現在値（config）を移行（速度・ダッシュ等が一致）。
    assertEqual(p.obstacleSpeedInitial, config.INITIAL_SPEED, 'preset migrates INITIAL_SPEED');
    assertEqual(p.dashCooldown, config.DASH_COOLDOWN, 'preset migrates DASH_COOLDOWN');
    assertEqual(p.scoreMultiplier, 1, 'default score multiplier 1 (no ranking impact)');
    assertEqual(p.xpMultiplier, 1, 'default xp multiplier 1');
});

await test('P13-12. Service Worker は analytics API をキャッシュしない（再確認）', () => {
    assert(/submit-analytics|analytics/.test(swSrc), 'sw no-cache pattern includes analytics');
    assert(/url\.origin !== self\.location\.origin/.test(swSrc), 'cross-origin analytics bypassed');
    assert(/req\.method !== 'GET'/.test(swSrc), 'POST analytics never cached');
});

// ===================================
// 共通（追加）: 未使用 import / state 二重定義 / 単一 RAF / listener 重複
// ===================================
// import 文を除いた本体を返す（未使用 import 判定用）。
function stripImports(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(?:^|\n)\s*import\b[\s\S]*?from\s*['"][^'"]+['"];?/g, '\n')
        .replace(/(?:^|\n)\s*import\s*['"][^'"]+['"];?/g, '\n');
}
// import 文から「ローカル束縛名」を取り出す（default / * as ns / { a, b as c }）。
function importedLocalNames(src) {
    const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const names = [];
    const re = /(?:^|\n)\s*import\s+([\s\S]*?)\s+from\s*['"][^'"]+['"]/g;
    let m;
    while ((m = re.exec(noBlock))) {
        let clause = m[1].trim();
        const braceMatch = clause.match(/\{([\s\S]*?)\}/);
        if (braceMatch) {
            for (const part of braceMatch[1].split(',')) {
                const p = part.trim();
                if (!p) continue;
                const asMatch = p.match(/\sas\s+(\w+)$/);
                names.push(asMatch ? asMatch[1] : p.replace(/^\w+\s+as\s+/, '').trim());
            }
            clause = clause.replace(/\{[\s\S]*?\}/, '').trim();
        }
        const ns = clause.match(/\*\s+as\s+(\w+)/);
        if (ns) names.push(ns[1]);
        const def = clause.replace(/^,/, '').trim().match(/^(\w+)/);
        if (def && !ns) names.push(def[1]);
    }
    return names.filter(Boolean);
}

await test('C-04. 未使用 import がない', () => {
    const offenders = [];
    for (const f of allJsFiles) {
        const src = readFileSync(f, 'utf8');
        const body = stripImports(src);
        for (const name of importedLocalNames(src)) {
            const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
            if (!re.test(body)) offenders.push(`${path.relative(ROOT, f)}: ${name}`);
        }
    }
    assert(offenders.length === 0, `unused imports:\n  ${offenders.join('\n  ')}`);
});

await test('C-05. state（gameState/player/配列）の二重定義がない', () => {
    const decls = allJsFiles.filter((f) => /export const gameState\b/.test(readFileSync(f, 'utf8')));
    assertEqual(decls.length, 1, 'gameState declared exactly once');
    assert(decls[0].endsWith('state.js'), 'gameState lives in state.js');
    const playerDecls = allJsFiles.filter((f) => /export const player\b/.test(readFileSync(f, 'utf8')));
    assertEqual(playerDecls.length, 1, 'player declared exactly once');
});

await test('C-06. 単一 RAF（game-loop は loopState.rafId を一本化・replay は二重起動防止）', () => {
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    // requestAnimationFrame の結果は loopState.rafId にのみ格納する。
    const rafAssigns = loopSrc.match(/(\w[\w.]*)\s*=\s*requestAnimationFrame/g) || [];
    for (const a of rafAssigns) assert(/loopState\.rafId\s*=\s*requestAnimationFrame/.test(a), `RAF must go to loopState.rafId: ${a}`);
    // 開始前に既存 RAF を必ず cancel（多重起動防止）。
    assert(/cancelAnimationFrame\(loopState\.rafId\)/.test(loopSrc), 'cancel before restart');
    // replay-view は専用 RAF を二重起動させない。
    const repSrc = readFileSync(path.join(JS_DIR, 'view/replay-view.js'), 'utf8');
    assert(/if \(replayRaf != null\) return/.test(repSrc), 'replay RAF guarded');
});

await test('C-07. listener 重複登録の防止フラグがある', () => {
    assert(/let registered = false/.test(readFileSync(path.join(JS_DIR, 'controller/input.js'), 'utf8')), 'input dedup');
    for (const f of ['view/options-view.js', 'view/mode-select-view.js', 'view/replay-view.js']) {
        assert(/let bound = false/.test(readFileSync(path.join(JS_DIR, f), 'utf8')), `${f} bind dedup`);
    }
});

// ===================================
// 全回帰（静的配線 + 挙動）
// ===================================
await test('R-47/48/49. START / pause・resume / GAME OVER・RETRY の配線が残っている', () => {
    const mainSrc = readFileSync(path.join(JS_DIR, 'main.js'), 'utf8');
    assert(/startBtn.*addEventListener\('click', startGame\)/.test(mainSrc), 'START wired');
    assert(/retryBtn.*addEventListener\('click', restart\)/.test(mainSrc), 'RETRY wired');
    assert(/resumeBtn.*addEventListener\('click', resumeGame\)/.test(mainSrc), 'RESUME wired');
    const inputSrc = readFileSync(path.join(JS_DIR, 'controller/input.js'), 'utf8');
    assert(/callbacks\.onPause\(\)/.test(inputSrc), 'ESC -> pause');
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    assert(/showGameOverScreen\(\)/.test(loopSrc), 'GAME OVER shown');
    assert(/prepareMission\(\);\s*\n\s*startGame\(\)/.test(mainSrc), 'restart = prepareMission + startGame');
});

await test('R-54. Supabase 失敗時もゲーム継続（loadLeaderboard は throw しない）', async () => {
    let unavailable = false;
    leaderboard.configureLeaderboard({
        render: () => {},
        renderUnavailable: () => { unavailable = true; },
        setStatus: () => {}
    });
    globalThis.fetch = async () => { throw new Error('network down'); };
    let threw = false;
    await silenceConsole(async () => {
        try { await leaderboard.loadLeaderboard(); } catch (e) { threw = true; }
    });
    assert(!threw, 'loadLeaderboard must not throw on failure');
    assert(unavailable, 'renderUnavailable called on failure');
});
if (originalFetch) globalThis.fetch = originalFetch; else delete globalThis.fetch;

// ===================================
// Codex 指摘修正の追加検証（High / Medium / Low）
// ===================================

// 文字列から「最初の { から対応する } まで」を取り出す（ネストした CSS ブロック抽出用）。
function extractBlock(src, startPattern) {
    const start = src.search(startPattern);
    if (start < 0) return null;
    const open = src.indexOf('{', start);
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    return null;
}

// --- High: Service Worker のキャッシュ削除スコープ ---
// sw.js を関数として読み込み、self/caches を注入して登録ハンドラを取り出す（実コードを実行）。
function loadServiceWorker(src, mocks) {
    const handlers = {};
    const swSelf = {
        addEventListener: (type, fn) => { handlers[type] = fn; },
        clients: { claim: () => Promise.resolve() },
        skipWaiting: () => {},
        location: { origin: 'https://example.test' }
    };
    // eslint-disable-next-line no-new-func
    const fn = new Function('self', 'caches', 'Response', 'fetch', 'URL', src);
    fn(swSelf, mocks.caches, mocks.Response || function () {}, mocks.fetch || (() => {}), mocks.URL || URL);
    return handlers;
}
async function swActivateDeletions(keys) {
    const deleted = [];
    const cachesMock = {
        keys: () => Promise.resolve(keys.slice()),
        delete: (k) => { deleted.push(k); return Promise.resolve(true); },
        open: () => Promise.resolve({ addAll: () => Promise.resolve(), match: () => Promise.resolve(undefined), put: () => Promise.resolve() })
    };
    const handlers = loadServiceWorker(swSrc, { caches: cachesMock });
    let waited;
    await handlers.activate({ waitUntil: (p) => { waited = p; } });
    await waited;
    return deleted;
}
const SW_KEYS = ['cyber-runner-cache-v1', 'cyber-runner-cache-v0', 'other-app-cache-v1', 'my-cyber-runner-cache-v1'];

await test('H-1. SW activate: 現行キャッシュ（cyber-runner-cache-v1）は削除しない', async () => {
    const deleted = await swActivateDeletions(SW_KEYS);
    assert(!deleted.includes('cyber-runner-cache-v1'), `current cache kept (deleted=${deleted.join(',')})`);
});
await test('H-2. SW activate: 自アプリの旧キャッシュ（cyber-runner-cache-v0）は削除する', async () => {
    const deleted = await swActivateDeletions(SW_KEYS);
    assert(deleted.includes('cyber-runner-cache-v0'), `old cyber-runner cache deleted (deleted=${deleted.join(',')})`);
});
await test('H-3. SW activate: 他アプリのキャッシュ（other-app-cache-v1）は削除しない', async () => {
    const deleted = await swActivateDeletions(SW_KEYS);
    assert(!deleted.includes('other-app-cache-v1'), `other app cache NOT deleted (deleted=${deleted.join(',')})`);
});
await test('H-4. SW activate: 接頭辞不一致の類似名（my-cyber-runner-cache-v1）は削除しない', async () => {
    const deleted = await swActivateDeletions(SW_KEYS);
    assert(!deleted.includes('my-cyber-runner-cache-v1'), `similar-prefix cache NOT deleted (deleted=${deleted.join(',')})`);
    assert(/CACHE_PREFIX\s*=\s*'cyber-runner-cache-'/.test(swSrc), 'CACHE_PREFIX defined');
    assert(/k\.startsWith\(CACHE_PREFIX\)\s*&&\s*k\s*!==\s*CACHE_NAME/.test(swSrc), 'filter uses prefix + not current');
});

// --- Medium 1: 操作ボタン設定の三状態 UI（AUTO/ON/OFF） ---
function mockControl(initial) {
    return {
        value: initial,
        checked: false,
        _l: {},
        addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn); },
        dispatch(type) { (this._l[type] || []).forEach((f) => f()); }
    };
}
await test('M1-1. 操作ボタン設定UIは <select> の三状態で checkbox ではない', () => {
    const sel = htmlSrc.match(/<select[^>]*id="optTouchControls"[\s\S]*?<\/select>/);
    assert(sel, 'optTouchControls is a <select>');
    assert(!/<input[^>]*id="optTouchControls"/.test(htmlSrc), 'optTouchControls is not a checkbox input');
    assert(/value="auto"/.test(sel[0]) && /value="on"/.test(sel[0]) && /value="off"/.test(sel[0]), 'has auto/on/off options');
});
await test('M1-2. 各状態の意味を示す説明文があり aria/ラベルで関連付けられている', () => {
    const sel = htmlSrc.match(/<select[^>]*id="optTouchControls"[\s\S]*?<\/select>/);
    assert(sel && /aria-describedby="touchControlsNote"/.test(sel[0]), 'select has aria-describedby');
    assert(/id="touchControlsNote"/.test(htmlSrc), 'note element present');
    assert(/for="optTouchControls"/.test(htmlSrc), 'label associated to select');
});
await test('M1-3. options-view: select値(auto/on/off)とモデル値(auto/true/false)を相互変換', async () => {
    const ov = await import(modUrl('view/options-view.js'));
    const options = await import(modUrl('model/options.js'));
    globalThis.localStorage = memLocalStorage();
    await silenceConsole(async () => options.loadOptions());
    await silenceConsole(async () => options.setOption('touchControls', 'auto'));
    const touch = mockControl('off');
    let applied = null;
    ov.configureOptionsView({ touchControls: touch }, (o) => { applied = o; });
    assertEqual(touch.value, 'auto', 'render: model auto -> select auto');
    touch.value = 'on'; touch.dispatch('change');
    assertEqual(options.getOptions().touchControls, true, 'select on -> model true');
    assertEqual(touch.value, 'on', 're-render keeps on');
    touch.value = 'off'; touch.dispatch('change');
    assertEqual(options.getOptions().touchControls, false, 'select off -> model false');
    touch.value = 'auto'; touch.dispatch('change');
    assertEqual(options.getOptions().touchControls, 'auto', 'select auto -> model auto');
    assert(applied !== null, 'applyEffect invoked on change');
    delete globalThis.localStorage;
});
await test('M1-4. resolveTouchControls: auto=端末判定 / true=常時ON / false=常時OFF', () => {
    const mainSrc = readFileSync(path.join(JS_DIR, 'main.js'), 'utf8');
    assert(mainSrc.includes("value === 'auto' ? isTouchDevice() : value === true"), 'resolver maps three states');
});
await test('M1-5. 操作ボタン設定はリロードを跨いで永続（auto/true/false）', async () => {
    const options = await import(modUrl('model/options.js'));
    globalThis.localStorage = memLocalStorage();
    await silenceConsole(async () => options.loadOptions());
    await silenceConsole(async () => options.setOption('touchControls', false));
    await silenceConsole(async () => options.loadOptions());
    assertEqual(options.getOptions().touchControls, false, 'false persists across reload');
    await silenceConsole(async () => options.setOption('touchControls', 'auto'));
    await silenceConsole(async () => options.loadOptions());
    assertEqual(options.getOptions().touchControls, 'auto', 'auto persists across reload');
    delete globalThis.localStorage;
});
await test('M1-6. 破損 localStorage では auto にフォールバック（三状態でも安全）', async () => {
    const options = await import(modUrl('model/options.js'));
    globalThis.localStorage = memLocalStorage({ [config.OPTIONS_STORAGE_KEY]: '{ broken json' });
    await silenceConsole(async () => options.loadOptions());
    assertEqual(options.getOptions().touchControls, 'auto', 'corrupt -> auto');
    delete globalThis.localStorage;
});
await test('M1-7. select はスタイル・フォーカス可視化があり（キーボード操作可能）', () => {
    assert(/\.option-select\b/.test(cssSrc), '.option-select styled');
    assert(/select:focus-visible/.test(cssSrc), 'select focus-visible styled');
});

// --- Medium 2: 横画面のタッチUIレイアウト ---
await test('M2-1. 横画面（低い高さ）でクラスタを中央寄せ・safe-area を考慮（Canvas 下部を覆わない）', () => {
    const block = extractBlock(cssSrc, /@media \(orientation: landscape\) and \(max-height: 480px\)/);
    assert(block, 'landscape short-height media query present');
    assert(/align-items:\s*center/.test(block), 'clusters vertically centered (not bottom-overlapping)');
    assert(/safe-area-inset/.test(block), 'safe-area-inset honored in landscape');
});
await test('M2-2. 横画面でもタッチボタンは 44x44 CSS px を下回らない', () => {
    const block = extractBlock(cssSrc, /@media \(orientation: landscape\) and \(max-height: 480px\)/);
    const mh = block.match(/min-height:\s*(\d+)px/);
    assert(mh && Number(mh[1]) >= 44, `landscape touch button min-height >= 44px (got ${mh && mh[1]})`);
    const mw = block.match(/min-width:\s*(\d+)px/);
    assert(mw && Number(mw[1]) >= 44, `landscape touch button min-width >= 44px (got ${mw && mw[1]})`);
});
await test('M2-3. 横スクロールを発生させない（body overflow-x: hidden を維持）', () => {
    assert(/body\s*\{[^}]*overflow-x:\s*hidden/.test(cssSrc), 'body overflow-x hidden preserved');
});

// --- Medium 3: Wave/Boss/Event が選択中 balance preset を参照する ---
const balanceMod = await import(modUrl('model/balance.js'));
const presetsMod = await import(modUrl('config/balance-presets.js'));
await test('M3-1. balance アクセサが選択中 preset の現在値を返す（config と一致＝挙動不変）', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getWaveDurationBase(), p.waveDuration, 'wave duration base from preset');
    assertEqual(balanceMod.getWaveDurationBase(), config.WAVE_DURATION_SEC, 'wave duration equals current value');
    assertEqual(balanceMod.getBossBaseHp('firewall'), config.BOSS_FIREWALL_HP, 'firewall hp');
    assertEqual(balanceMod.getBossBaseHp('worm'), config.BOSS_WORM_HP, 'worm hp');
    assertEqual(balanceMod.getBossBaseHp('gate'), config.BOSS_GATE_HP, 'gate hp');
    assertEqual(balanceMod.getFirewallAttackIntervalBase(), config.BOSS_FIREWALL_LASER_INTERVAL, 'firewall laser interval');
    assertEqual(balanceMod.getEventIntervalSec(), config.EVENT_MIN_INTERVAL_SEC, 'event interval');
});
await test('M3-2. waves.waveDurationSec は preset 基準値を使う（Hardcore 短縮は維持）', () => {
    balanceMod.resetPreset();
    assertEqual(waves.waveDurationSec('endless'), balanceMod.getWaveDurationBase(), 'endless == preset base');
    assert(Math.abs(waves.waveDurationSec('hardcore') - balanceMod.getWaveDurationBase() * config.HARDCORE_WAVE_SPEED_FACTOR) < 1e-9, 'hardcore == base * factor');
});
await test('M3-3. bosses.createBoss の HP/Firewall間隔は preset 基準（cycle1・Hardcore補正）', () => {
    balanceMod.resetPreset();
    assertEqual(bosses.createBoss('firewall', { cycle: 1, mode: 'endless' }).maxHp, bosses.scaledBossHp(balanceMod.getBossBaseHp('firewall'), 1), 'firewall hp from preset');
    assertEqual(bosses.createBoss('worm', { cycle: 1, mode: 'endless' }).maxHp, bosses.scaledBossHp(balanceMod.getBossBaseHp('worm'), 1), 'worm hp from preset');
    assertEqual(bosses.createBoss('gate', { cycle: 1, mode: 'endless' }).maxHp, bosses.scaledBossHp(balanceMod.getBossBaseHp('gate'), 1), 'gate hp from preset');
    const fw = bosses.createBoss('firewall', { cycle: 1, mode: 'endless' });
    assertEqual(fw.attackInterval, balanceMod.getFirewallAttackIntervalBase(), 'firewall interval from preset (endless)');
    const fwh = bosses.createBoss('firewall', { cycle: 1, mode: 'hardcore' });
    assert(Math.abs(fwh.attackInterval - balanceMod.getFirewallAttackIntervalBase() * config.HARDCORE_BOSS_INTERVAL_FACTOR) < 1e-9, 'hardcore firewall interval shortened');
});
await test('M3-4. balance-presets.js が正本: waves/bosses/wave-controller は移動した config 定数を直接 import しない', () => {
    const wavesSrc = readFileSync(path.join(JS_DIR, 'model/waves.js'), 'utf8');
    const bossesSrc = readFileSync(path.join(JS_DIR, 'model/bosses.js'), 'utf8');
    const wcSrc = readFileSync(path.join(JS_DIR, 'controller/wave-controller.js'), 'utf8');
    assert(!importedLocalNames(wavesSrc).includes('WAVE_DURATION_SEC'), 'waves.js no direct WAVE_DURATION_SEC import');
    assert(/getWaveDurationBase/.test(wavesSrc), 'waves.js uses balance accessor');
    const bossesImports = importedLocalNames(bossesSrc);
    for (const n of ['BOSS_FIREWALL_HP', 'BOSS_WORM_HP', 'BOSS_GATE_HP', 'BOSS_FIREWALL_LASER_INTERVAL']) {
        assert(!bossesImports.includes(n), `bosses.js no direct ${n} import`);
    }
    assert(/getBossBaseHp/.test(bossesSrc) && /getFirewallAttackIntervalBase/.test(bossesSrc), 'bosses.js uses balance accessors');
    assert(!importedLocalNames(wcSrc).includes('EVENT_MIN_INTERVAL_SEC'), 'wave-controller no direct EVENT_MIN_INTERVAL_SEC import');
    assert(/getEventIntervalSec/.test(wcSrc), 'wave-controller uses balance accessor');
});
await test('M3-5. resetPreset で既定へ戻り、Training の選択を通常モードへ持ち越さない', () => {
    balanceMod.resetPreset();
    assertEqual(balanceMod.getPresetId(), presetsMod.DEFAULT_BALANCE_PRESET_ID, 'reset -> default preset');
    const wcSrc = readFileSync(path.join(JS_DIR, 'controller/wave-controller.js'), 'utf8');
    assert(/resetPreset\(\)/.test(wcSrc), 'wave-controller resets preset for non-training init');
    balanceMod.setPreset('___nonexistent___');
    assertEqual(balanceMod.getPresetId(), presetsMod.DEFAULT_BALANCE_PRESET_ID, 'unknown id ignored');
});
await test('M3-6. balance_version と実際の設定が一致する（単一参照点）', () => {
    balanceMod.resetPreset();
    assertEqual(balanceMod.getActivePreset().version, balanceMod.getBalanceVersion(), 'active preset version == balance version');
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getWaveDurationBase(), p.waveDuration, 'wave from active preset');
    assertEqual(balanceMod.getFirewallAttackIntervalBase(), p.bossAttackInterval, 'firewall interval from active preset');
    assertEqual(balanceMod.getEventIntervalSec(), p.eventInterval, 'event interval from active preset');
});

// ===================================
// Medium 3-bis / 3-ter（Codex 再レビュー）: Phase 11 の全 Wave/Boss/Event の
//   ゲーム進行・難易度・時間・倍率・出現率・上限・回避幅を active balance preset へ集約し、
//   単一正本化したことの検証。
//   - 演出/休憩/警告/撃破時間・worm/gate 攻撃間隔・Hardcore 補正が preset 由来（3-bis）
//   - サイクル難易度/HP 係数・spawn 補正・順序・供給/警告間隔・cooldown・速度・上限・回避幅・
//     イベント倍率/出現率/初回待機/警告が preset 由来（3-ter）
//   - Phase 11 consumer の config 直接 import は「表示定数 allowlist」のみ（balance 値は 0 件・
//     未分類の config import が増えたら失敗）
//   - config との二重定義がない / analytics の balance_version が実使用 preset と一致
//   - Training の一時選択は通常モード初期化で既定 preset へ復元 / 数値は修正前から不変
// ===================================

// active preset へ集約した Phase 11 バランス定数（定義は config.js のみ・consumer は balance 経由）。
const PHASE11_PRESET_CONSTS = [
    // 3-bis（前ラウンド）
    'WAVE_DURATION_SEC', 'WAVE_INTRO_SEC', 'WAVE_OUTRO_SEC', 'WAVE_INTERMISSION_SEC',
    'BOSS_WARNING_SEC', 'BOSS_DEFEAT_SEC',
    'BOSS_FIREWALL_HP', 'BOSS_WORM_HP', 'BOSS_GATE_HP', 'BOSS_FIREWALL_LASER_INTERVAL',
    'BOSS_WORM_SPAWN_INTERVAL', 'BOSS_GATE_WALL_INTERVAL',
    'EVENT_DURATION_SEC', 'EVENT_MIN_INTERVAL_SEC',
    'HARDCORE_WAVE_SPEED_FACTOR', 'HARDCORE_BOSS_INTERVAL_FACTOR',
    // 3-ter（本ラウンド）
    'WAVE_SEQUENCE', 'WAVE_SPAWN_BOOST', 'CYCLE_DIFFICULTY_STEP', 'CYCLE_BOSS_HP_STEP',
    'BOSS_SEQUENCE', 'BOSS_FIREWALL_CORE_INTERVAL', 'BOSS_FIREWALL_MAX_LASERS', 'BOSS_FIREWALL_SAFE_WIDTH',
    'BOSS_WORM_ATTACK_WARNING', 'BOSS_WORM_HIT_COOLDOWN', 'BOSS_WORM_SPEED', 'BOSS_WORM_MAX_MINIONS',
    'BOSS_GATE_MIN_GAP',
    'EVENT_FIRST_DELAY_SEC', 'EVENT_WARNING_SEC', 'EVENT_CORE_RUSH_MULT', 'EVENT_HIGH_SPEED_MULT',
    'EVENT_LASER_STORM_RATE', 'EVENT_LASER_STORM_MAX'
];

// 単一正本ルールの対象 = Phase 11 の Wave/Boss/Event consumer（描画含む）。
const PHASE11_CONSUMERS = [
    'controller/wave-controller.js', 'model/waves.js', 'model/bosses.js', 'model/random-events.js',
    'view/wave-view.js', 'view/boss-view.js', 'view/event-view.js'
];

// balance（難易度/進行）を変えない純粋な表示・幾何・当たり判定サイズだけ config 直接 import を許可。
//   理由つき allowlist（ここに無い config 直接 import は「未分類」として M3b-06 が失敗する）。
const PHASE11_DISPLAY_ALLOWLIST = new Set([
    'CANVAS_WIDTH', 'CANVAS_HEIGHT', // プレイフィールド寸法（幾何）
    'LASER_WIDTH', // Phase 4 WarningLaser entity の帯幅（当たり判定/描画・entity 定義と一体）
    'BOSS_WORM_WIDTH', 'BOSS_WORM_HEIGHT', // Data Worm 本体の描画/当たり判定サイズ
    'BOSS_BAR_MARGIN' // HP バーの画面余白（レイアウト）
]);

// ある JS ソースが config.js から直接 import している束縛名だけを抽出する（balance-presets.js は対象外）。
function configImportedNames(src) {
    const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const names = [];
    const re = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*\/config\.js['"]/g;
    let m;
    while ((m = re.exec(noBlock))) {
        for (const part of m[1].split(',')) {
            const t = part.replace(/\/\/.*$/, '').trim();
            if (t) names.push(t.split(/\s+as\s+/)[0].trim());
        }
    }
    return names;
}

await test('M3b-01. Wave 演出/休憩時間（intro/outro/intermission）が active preset 由来', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getWaveIntroDuration(), p.waveIntroDuration, 'wave intro from active preset');
    assertEqual(balanceMod.getWaveOutroDuration(), p.waveOutroDuration, 'wave outro from active preset');
    assertEqual(balanceMod.getWaveIntermissionDuration(), p.waveIntermissionDuration, 'wave intermission from active preset');
});

await test('M3b-02. ボス警告/撃破演出時間が active preset 由来（controller・boss-view 共通）', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getBossWarningDuration(), p.bossWarningDuration, 'boss warning from active preset');
    assertEqual(balanceMod.getBossDefeatDuration(), p.bossDefeatDuration, 'boss defeat from active preset');
});

await test('M3b-03. イベント効果時間が active preset 由来（controller/random-events 共通）', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getEventDurationSec(), p.eventDuration, 'event duration from active preset');
    // random-events.applyEvent(double_score) は同じ preset 効果時間で doubleUntil を延長する。
    const gs = makeGameState({ gameTime: 0, doubleUntil: 0 });
    randomEvents.applyEvent(gs, 'double_score');
    assert(Math.abs(gs.doubleUntil - balanceMod.getEventDurationSec()) < 1e-9, 'double_score extends by preset event duration');
});

await test('M3b-04. Data Worm / Security Gate 攻撃間隔が active preset 由来（createBoss）', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getWormAttackIntervalBase(), p.bossWormAttackInterval, 'worm interval from active preset');
    assertEqual(balanceMod.getGateAttackIntervalBase(), p.bossGateAttackInterval, 'gate interval from active preset');
    assertEqual(bosses.createBoss('worm', { cycle: 1, mode: 'endless' }).attackInterval, balanceMod.getWormAttackIntervalBase(), 'worm boss interval from preset');
    assertEqual(bosses.createBoss('gate', { cycle: 1, mode: 'endless' }).attackInterval, balanceMod.getGateAttackIntervalBase(), 'gate boss interval from preset');
});

await test('M3b-05. Hardcore のウェーブ/ボス補正が active preset 由来（base × factor）', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getHardcoreWaveFactor(), p.hardcoreWaveFactor, 'hardcore wave factor from preset');
    assertEqual(balanceMod.getHardcoreBossIntervalFactor(), p.hardcoreBossIntervalFactor, 'hardcore boss factor from preset');
    assert(Math.abs(waves.waveDurationSec('hardcore') - balanceMod.getWaveDurationBase() * p.hardcoreWaveFactor) < 1e-9, 'hardcore wave shortened by preset factor');
    const worm = bosses.createBoss('worm', { cycle: 1, mode: 'hardcore' });
    assert(Math.abs(worm.attackInterval - balanceMod.getWormAttackIntervalBase() * p.hardcoreBossIntervalFactor) < 1e-9, 'hardcore worm interval shortened by preset factor');
});

await test('M3b-06. Phase 11 consumer の config 直接 import は表示定数 allowlist のみ（balance 値 0 件・未分類を検知）', () => {
    const offenders = [];
    // (1) Phase 11 consumer 全件：config 直接 import は allowlist の表示定数のみ。
    //     それ以外（balance 値・未分類の新規 import）はすべて offender として失敗させる。
    for (const rel of PHASE11_CONSUMERS) {
        const src = readFileSync(path.join(JS_DIR, rel), 'utf8');
        for (const name of configImportedNames(src)) {
            if (!PHASE11_DISPLAY_ALLOWLIST.has(name)) offenders.push(`js/${rel}: ${name} (not in display allowlist)`);
        }
    }
    // (2) 念のため：移行済みの balance 定数はどの js も直接 import しない（config/balance-presets を除く）。
    for (const f of allJsFiles) {
        const rel = path.relative(ROOT, f).replace(/\\/g, '/');
        if (rel === 'js/config.js' || rel === 'js/config/balance-presets.js') continue;
        const names = importedLocalNames(readFileSync(f, 'utf8'));
        for (const c of PHASE11_PRESET_CONSTS) {
            if (names.includes(c)) offenders.push(`${rel}: ${c} (preset-owned balance constant)`);
        }
    }
    assert(offenders.length === 0, `Phase 11 consumer must read balance values via model/balance.js, not config.js:\n  ${offenders.join('\n  ')}`);

    // (3) 主要 consumer が balance アクセサを使っていることも明示確認（経路の実態）。
    const wcSrc = readFileSync(path.join(JS_DIR, 'controller/wave-controller.js'), 'utf8');
    for (const a of ['getWaveSequence', 'getWaveSpawnBoost', 'getWaveIntroDuration', 'getBossWarningDuration',
        'getBossDefeatDuration', 'getEventDurationSec', 'getEventFirstDelay', 'getEventWarningDuration',
        'getLaserStormRate', 'getLaserStormMax', 'getFirewallMaxLasers', 'getFirewallSafeWidth',
        'getWormSpeed', 'getWormMaxMinions', 'getWormHitCooldown', 'getGateMinGap', 'getBossSequence']) {
        assert(wcSrc.includes(a), `wave-controller uses ${a}`);
    }
    const bossesSrc = readFileSync(path.join(JS_DIR, 'model/bosses.js'), 'utf8');
    for (const a of ['getBossSequence', 'getCycleBossHpStep', 'getFirewallCoreAttackInterval',
        'getFirewallSafeWidth', 'getWormAttackWarningDuration', 'getWormAttackIntervalBase', 'getGateAttackIntervalBase']) {
        assert(bossesSrc.includes(a), `bosses uses ${a}`);
    }
    const wavesSrc = readFileSync(path.join(JS_DIR, 'model/waves.js'), 'utf8');
    for (const a of ['getWaveSequence', 'getCycleDifficultyStep', 'getHardcoreWaveFactor']) {
        assert(wavesSrc.includes(a), `waves uses ${a}`);
    }
    const reSrc = readFileSync(path.join(JS_DIR, 'model/random-events.js'), 'utf8');
    for (const a of ['getCoreRushMultiplier', 'getHighSpeedMultiplier', 'getEventDurationSec']) {
        assert(reSrc.includes(a), `random-events uses ${a}`);
    }
    assert(readFileSync(path.join(JS_DIR, 'view/boss-view.js'), 'utf8').includes('getFirewallSafeWidth'), 'boss-view uses getFirewallSafeWidth');
});

await test('M3b-07. config と preset の二重定義がない（各定数は 1 箇所のみ定義・preset は参照）', () => {
    for (const c of PHASE11_PRESET_CONSTS) {
        const defs = allJsFiles.filter((f) => new RegExp('export const ' + c + '\\b').test(readFileSync(f, 'utf8')));
        assertEqual(defs.length, 1, `${c} defined exactly once`);
        assert(path.relative(ROOT, defs[0]).replace(/\\/g, '/') === 'js/config.js', `${c} defined in config.js only`);
    }
    // balance-presets.js は数値を複製せず config 定数を参照する（手動同期しない）。
    const presetSrc = readFileSync(path.join(JS_DIR, 'config/balance-presets.js'), 'utf8');
    const refs = [
        ['waveIntroDuration', 'WAVE_INTRO_SEC'], ['waveOutroDuration', 'WAVE_OUTRO_SEC'],
        ['waveIntermissionDuration', 'WAVE_INTERMISSION_SEC'], ['bossWarningDuration', 'BOSS_WARNING_SEC'],
        ['bossDefeatDuration', 'BOSS_DEFEAT_SEC'], ['eventDuration', 'EVENT_DURATION_SEC'],
        ['bossWormAttackInterval', 'BOSS_WORM_SPAWN_INTERVAL'], ['bossGateAttackInterval', 'BOSS_GATE_WALL_INTERVAL'],
        ['hardcoreWaveFactor', 'HARDCORE_WAVE_SPEED_FACTOR'], ['hardcoreBossIntervalFactor', 'HARDCORE_BOSS_INTERVAL_FACTOR'],
        // 3-ter で追加した値も「数値リテラルの複製」ではなく config 定数の参照であること。
        ['waveSequence', 'WAVE_SEQUENCE'], ['waveSpawnBoost', 'WAVE_SPAWN_BOOST'],
        ['cycleDifficultyStep', 'CYCLE_DIFFICULTY_STEP'], ['cycleBossHpStep', 'CYCLE_BOSS_HP_STEP'],
        ['bossSequence', 'BOSS_SEQUENCE'], ['firewallCoreAttackInterval', 'BOSS_FIREWALL_CORE_INTERVAL'],
        ['firewallMaxLasers', 'BOSS_FIREWALL_MAX_LASERS'], ['firewallSafeWidth', 'BOSS_FIREWALL_SAFE_WIDTH'],
        ['wormAttackWarningDuration', 'BOSS_WORM_ATTACK_WARNING'], ['wormHitCooldown', 'BOSS_WORM_HIT_COOLDOWN'],
        ['wormSpeed', 'BOSS_WORM_SPEED'], ['wormMaxMinions', 'BOSS_WORM_MAX_MINIONS'],
        ['gateMinGap', 'BOSS_GATE_MIN_GAP'], ['eventFirstDelay', 'EVENT_FIRST_DELAY_SEC'],
        ['eventWarningDuration', 'EVENT_WARNING_SEC'], ['coreRushMultiplier', 'EVENT_CORE_RUSH_MULT'],
        ['highSpeedMultiplier', 'EVENT_HIGH_SPEED_MULT'], ['laserStormRate', 'EVENT_LASER_STORM_RATE'],
        ['laserStormMax', 'EVENT_LASER_STORM_MAX']
    ];
    for (const [field, c] of refs) {
        assert(new RegExp(field + ':\\s*' + c + '\\b').test(presetSrc), `preset.${field} references ${c} (no copied literal)`);
    }
});

await test('M3b-08. 現在値が修正前から不変（active preset 値 == 既知の現在値・config と一致）', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    const expected = {
        waveDuration: 14, waveIntroDuration: 1.8, waveOutroDuration: 1.0, waveIntermissionDuration: 2.4,
        bossWarningDuration: 2.2, bossDefeatDuration: 2.2,
        bossFirewallHp: 6, bossWormHp: 5, bossGateHp: 5,
        bossAttackInterval: 2.6, bossWormAttackInterval: 2.0, bossGateAttackInterval: 3.2,
        eventDuration: 9, eventInterval: 16,
        hardcoreWaveFactor: 0.8, hardcoreBossIntervalFactor: 0.75
    };
    for (const [k, v] of Object.entries(expected)) assertEqual(p[k], v, `${k} unchanged`);
    // 定義元 config と完全一致（挙動不変）。
    assertEqual(p.waveIntroDuration, config.WAVE_INTRO_SEC, 'preset == config WAVE_INTRO_SEC');
    assertEqual(p.bossWarningDuration, config.BOSS_WARNING_SEC, 'preset == config BOSS_WARNING_SEC');
    assertEqual(p.bossDefeatDuration, config.BOSS_DEFEAT_SEC, 'preset == config BOSS_DEFEAT_SEC');
    assertEqual(p.bossWormAttackInterval, config.BOSS_WORM_SPAWN_INTERVAL, 'preset == config BOSS_WORM_SPAWN_INTERVAL');
    assertEqual(p.bossGateAttackInterval, config.BOSS_GATE_WALL_INTERVAL, 'preset == config BOSS_GATE_WALL_INTERVAL');
    assertEqual(p.hardcoreWaveFactor, config.HARDCORE_WAVE_SPEED_FACTOR, 'preset == config HARDCORE_WAVE_SPEED_FACTOR');
    assertEqual(p.hardcoreBossIntervalFactor, config.HARDCORE_BOSS_INTERVAL_FACTOR, 'preset == config HARDCORE_BOSS_INTERVAL_FACTOR');
});

await test('M3b-09. analytics の balance_version が実使用 preset の version と一致', async () => {
    globalThis.localStorage = memLocalStorage();
    const analytics = await import(modUrl('model/analytics.js'));
    balanceMod.resetPreset();
    const payload = analytics.buildPayload({ mode: 'endless', score: 1, durationMs: 1000 });
    assertEqual(payload.balance_version, balanceMod.getActivePreset().version, 'payload version == active preset version');
    assertEqual(payload.balance_version, balanceMod.getBalanceVersion(), 'payload version == BALANCE_VERSION');
    delete globalThis.localStorage;
});

await test('M3b-10. Training の一時 preset 選択は通常モード初期化で既定へ復元', () => {
    globalThis.localStorage = memLocalStorage();
    // 未知 ID は無視（防御）し、既定のまま。
    balanceMod.setPreset('___tmp_training___');
    assertEqual(balanceMod.getPresetId(), presetsMod.DEFAULT_BALANCE_PRESET_ID, 'unknown preset ignored');
    // 通常モードの initWaveSystem は resetPreset を必ず呼ぶ（Training の選択を持ち越さない）。
    stateMod.gameState.mode = 'endless';
    stateMod.gameState.allowedObstacles = 'all';
    stateMod.obstacles.length = 0; stateMod.energyCores.length = 0; stateMod.particles.length = 0;
    waveCtrl.initWaveSystem();
    assertEqual(balanceMod.getPresetId(), presetsMod.DEFAULT_BALANCE_PRESET_ID, 'normal init restores default preset');
    const wcSrc = readFileSync(path.join(JS_DIR, 'controller/wave-controller.js'), 'utf8');
    assert(/gameState\.mode === 'training'[\s\S]*?\} else \{[\s\S]*?resetPreset\(\)/.test(wcSrc), 'resetPreset on non-training init branch');
    delete globalThis.localStorage;
});

// --- Medium 3-ter（本ラウンド）: 残りの Wave/Boss/Event 値も active preset 由来であること ---
await test('M3c-01. サイクル難易度/HP 係数が active preset 由来（waves/bosses が反映）', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getCycleDifficultyStep(), p.cycleDifficultyStep, 'cycleDifficultyStep from preset');
    assertEqual(balanceMod.getCycleBossHpStep(), p.cycleBossHpStep, 'cycleBossHpStep from preset');
    // waves.cycleDifficultyBonus は preset 係数で算出（cycle3 = (3-1)*step）。
    assert(Math.abs(waves.cycleDifficultyBonus(3) - 2 * balanceMod.getCycleDifficultyStep()) < 1e-9, 'cycle bonus uses preset step');
    // bosses.scaledBossHp は preset 係数で増加（cycle2 = round(base*(1+step))）。
    assertEqual(bosses.scaledBossHp(8, 2), Math.max(1, Math.round(8 * (1 + balanceMod.getCycleBossHpStep()))), 'boss hp scale uses preset step');
});

await test('M3c-02. ウェーブ順序と spawn 補正が active preset 由来', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getWaveSequence(), p.waveSequence, 'wave sequence from preset (same ref)');
    assertEqual(balanceMod.getWaveSpawnBoost(), p.waveSpawnBoost, 'wave spawn boost from preset (same ref)');
    assertEqual(waves.waveCount(), balanceMod.getWaveSequence().length, 'waveCount from preset sequence');
    assertEqual(waves.waveTypeAt(1), balanceMod.getWaveSequence()[1], 'waveTypeAt from preset sequence');
    assertEqual(balanceMod.getWaveSpawnBoost(), config.WAVE_SPAWN_BOOST, 'spawn boost === config (unchanged)');
});

await test('M3c-03. Firewall の供給間隔/同時上限/安全幅が active preset 由来（createBoss）', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getFirewallCoreAttackInterval(), p.firewallCoreAttackInterval, 'core interval from preset');
    assertEqual(balanceMod.getFirewallMaxLasers(), p.firewallMaxLasers, 'max lasers from preset');
    assertEqual(balanceMod.getFirewallSafeWidth(), p.firewallSafeWidth, 'safe width from preset');
    const fw = bosses.createBoss('firewall', { cycle: 1, mode: 'endless' });
    assertEqual(fw.supplyInterval, balanceMod.getFirewallCoreAttackInterval(), 'firewall boss supplyInterval from preset');
});

await test('M3c-04. Data Worm の警告/cooldown/速度/上限が active preset 由来（createBoss）', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getWormAttackWarningDuration(), p.wormAttackWarningDuration, 'worm warning from preset');
    assertEqual(balanceMod.getWormHitCooldown(), p.wormHitCooldown, 'worm hit cooldown from preset');
    assertEqual(balanceMod.getWormSpeed(), p.wormSpeed, 'worm speed from preset');
    assertEqual(balanceMod.getWormMaxMinions(), p.wormMaxMinions, 'worm max minions from preset');
    const worm = bosses.createBoss('worm', { cycle: 1, mode: 'endless' });
    assertEqual(worm.warning, balanceMod.getWormAttackWarningDuration(), 'worm boss warning from preset');
});

await test('M3c-05. ボス巡回順と Security Gate 最小通過幅が active preset 由来', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getBossSequence(), p.bossSequence, 'boss sequence from preset (same ref)');
    assertEqual(balanceMod.getGateMinGap(), p.gateMinGap, 'gate min gap from preset');
    assertEqual(bosses.bossTypeForCycle(2), balanceMod.getBossSequence()[1], 'bossTypeForCycle from preset sequence');
    assert(balanceMod.getGateMinGap() >= config.PLAYER_WIDTH + 40, 'gate min gap stays passable (avoidability)');
});

await test('M3c-06. イベント初回待機/警告時間が active preset 由来', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getEventFirstDelay(), p.eventFirstDelay, 'event first delay from preset');
    assertEqual(balanceMod.getEventWarningDuration(), p.eventWarningDuration, 'event warning from preset');
});

await test('M3c-07. CORE RUSH / HIGH SPEED 倍率が active preset 由来（applyEvent）', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getCoreRushMultiplier(), p.coreRushMultiplier, 'core rush mult from preset');
    assertEqual(balanceMod.getHighSpeedMultiplier(), p.highSpeedMultiplier, 'high speed mult from preset');
    const gs = makeGameState({ eventCoreMult: 1, eventSpeedMult: 1, gameTime: 0 });
    randomEvents.applyEvent(gs, 'core_rush');
    assertEqual(gs.eventCoreMult, balanceMod.getCoreRushMultiplier(), 'applyEvent core_rush uses preset multiplier');
    randomEvents.applyEvent(gs, 'high_speed');
    assertEqual(gs.eventSpeedMult, balanceMod.getHighSpeedMultiplier(), 'applyEvent high_speed uses preset multiplier');
});

await test('M3c-08. LASER STORM の出現率/同時上限が active preset 由来', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    assertEqual(balanceMod.getLaserStormRate(), p.laserStormRate, 'laser storm rate from preset');
    assertEqual(balanceMod.getLaserStormMax(), p.laserStormMax, 'laser storm max from preset');
});

await test('M3c-09. 3-ter の現在値が修正前から不変（active preset 値 == 定義元 config 値）', () => {
    balanceMod.resetPreset();
    const p = balanceMod.getActivePreset();
    // 既知の現在値（修正前から不変）。
    const expectedScalars = {
        cycleDifficultyStep: 0.12, cycleBossHpStep: 0.25,
        firewallCoreAttackInterval: 1.6, firewallMaxLasers: 2, firewallSafeWidth: 150,
        wormAttackWarningDuration: 0.9, wormHitCooldown: 0.8, wormSpeed: 150, wormMaxMinions: 4,
        gateMinGap: 120, eventFirstDelay: 12, eventWarningDuration: 1.2,
        coreRushMultiplier: 3.0, highSpeedMultiplier: 1.45, laserStormRate: 0.018, laserStormMax: 3
    };
    for (const [k, v] of Object.entries(expectedScalars)) assertEqual(p[k], v, `${k} unchanged`);
    assertDeepEqual(p.waveSequence, ['normal', 'homing', 'laser', 'gapwall', 'boss'], 'wave sequence unchanged');
    assertDeepEqual(p.bossSequence, ['firewall', 'worm', 'gate'], 'boss sequence unchanged');
    assertDeepEqual(p.waveSpawnBoost, { normal: 0, homing: 0.010, laser: 0.010, gapwall: 0.006 }, 'spawn boost unchanged');
    // 定義元 config と完全一致（preset は参照＝複製していない）。
    const sameAsConfig = [
        ['cycleDifficultyStep', 'CYCLE_DIFFICULTY_STEP'], ['cycleBossHpStep', 'CYCLE_BOSS_HP_STEP'],
        ['firewallCoreAttackInterval', 'BOSS_FIREWALL_CORE_INTERVAL'], ['firewallMaxLasers', 'BOSS_FIREWALL_MAX_LASERS'],
        ['firewallSafeWidth', 'BOSS_FIREWALL_SAFE_WIDTH'], ['wormAttackWarningDuration', 'BOSS_WORM_ATTACK_WARNING'],
        ['wormHitCooldown', 'BOSS_WORM_HIT_COOLDOWN'], ['wormSpeed', 'BOSS_WORM_SPEED'],
        ['wormMaxMinions', 'BOSS_WORM_MAX_MINIONS'], ['gateMinGap', 'BOSS_GATE_MIN_GAP'],
        ['eventFirstDelay', 'EVENT_FIRST_DELAY_SEC'], ['eventWarningDuration', 'EVENT_WARNING_SEC'],
        ['coreRushMultiplier', 'EVENT_CORE_RUSH_MULT'], ['highSpeedMultiplier', 'EVENT_HIGH_SPEED_MULT'],
        ['laserStormRate', 'EVENT_LASER_STORM_RATE'], ['laserStormMax', 'EVENT_LASER_STORM_MAX'],
        ['waveSequence', 'WAVE_SEQUENCE'], ['bossSequence', 'BOSS_SEQUENCE'], ['waveSpawnBoost', 'WAVE_SPAWN_BOOST']
    ];
    for (const [field, c] of sameAsConfig) assertEqual(p[field], config[c], `${field} === config.${c}`);
});

await test('M3c-10. 監査ロジックは未分類の config 直接 import を検知する（allowlist の自己テスト）', () => {
    // 表示定数だけは許可される。
    const ok = configImportedNames("import { CANVAS_WIDTH, LASER_WIDTH } from '../config.js';");
    assert(ok.length === 2 && ok.every((n) => PHASE11_DISPLAY_ALLOWLIST.has(n)), 'display consts allowed');
    // balance 値（未分類）は offender として検知される。
    const flagged = configImportedNames("import { WAVE_SPAWN_BOOST, CYCLE_DIFFICULTY_STEP } from '../config.js';")
        .filter((n) => !PHASE11_DISPLAY_ALLOWLIST.has(n));
    assertDeepEqual(flagged, ['WAVE_SPAWN_BOOST', 'CYCLE_DIFFICULTY_STEP'], 'balance consts flagged as offenders');
    // 全 PHASE11_PRESET_CONSTS は allowlist に含まれない（balance 値は許可しない）。
    for (const c of PHASE11_PRESET_CONSTS) assert(!PHASE11_DISPLAY_ALLOWLIST.has(c), `${c} must not be allowlisted`);
});

await test('M3c-11. resetPreset で 3-ter の全 Wave/Boss/Event 値が既定（config 現在値）へ復元', () => {
    // Training の一時状態に依らず、resetPreset 後は既定 preset の値（config 現在値）に戻る。
    balanceMod.setPreset('___ephemeral___'); // 未知 ID は無視 → 既定のまま
    balanceMod.resetPreset();
    assertEqual(balanceMod.getPresetId(), presetsMod.DEFAULT_BALANCE_PRESET_ID, 'reset -> default preset');
    assertEqual(balanceMod.getCycleDifficultyStep(), config.CYCLE_DIFFICULTY_STEP, 'cycle step restored');
    assertEqual(balanceMod.getFirewallSafeWidth(), config.BOSS_FIREWALL_SAFE_WIDTH, 'safe width restored');
    assertEqual(balanceMod.getWormSpeed(), config.BOSS_WORM_SPEED, 'worm speed restored');
    assertEqual(balanceMod.getCoreRushMultiplier(), config.EVENT_CORE_RUSH_MULT, 'core rush mult restored');
    assertEqual(balanceMod.getLaserStormMax(), config.EVENT_LASER_STORM_MAX, 'laser storm max restored');
    assertEqual(balanceMod.getWaveSpawnBoost(), config.WAVE_SPAWN_BOOST, 'spawn boost restored');
});

// --- Medium 4: endGame の冪等性ガード ---
await test('M4-1. endGame 先頭に多重終了ガード（loopState.ended）がある', () => {
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    assert(/export function endGame\([^)]*\)\s*\{[\s\S]*?if \(loopState\.ended\) return;[\s\S]*?loopState\.ended = true;/.test(loopSrc), 'guard + set at top of endGame');
});
await test('M4-2. ガードは副作用（stopLoop/updateHighScore）より前にある', () => {
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    const body = loopSrc.slice(loopSrc.indexOf('export function endGame'));
    const guardIdx = body.indexOf('loopState.ended = true;');
    const stopIdx = body.indexOf('stopLoop()');
    const hsIdx = body.indexOf('updateHighScore(');
    assert(guardIdx >= 0 && stopIdx > guardIdx, 'guard precedes stopLoop');
    assert(hsIdx > guardIdx, 'guard precedes high score update');
});
await test('M4-3. resetAllState（START/RETRY）でガードを解除する', () => {
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    assert(/export function resetAllState\(\)\s*\{[\s\S]*?loopState\.ended = false;/.test(loopSrc), 'resetAllState clears ended');
});
await test('M4-4. loopState.ended は state.js で false 初期化されている', () => {
    const stateSrc = readFileSync(path.join(JS_DIR, 'state.js'), 'utf8');
    assert(/loopState\s*=\s*\{[\s\S]*?ended:\s*false/.test(stateSrc), 'loopState.ended default false');
});
await test('M4-5. startGame は resetAllState 経由でガード解除（多重起動防止も維持）', () => {
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    const body = loopSrc.slice(loopSrc.indexOf('export function startGame'));
    assert(/resetAllState\(\)/.test(body), 'startGame calls resetAllState');
    assert(/cancelAnimationFrame\(loopState\.rafId\)/.test(body), 'startGame cancels stray RAF');
});
await test('M4-6. endGame 定義は1つ・Time Attack FINISH も同経路（同ガード対象）', () => {
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    const defs = loopSrc.match(/function endGame\(/g) || [];
    assertEqual(defs.length, 1, 'single endGame definition');
    assert(/endGame\(\{\s*finished:\s*true\s*\}\)/.test(loopSrc), 'Time Attack FINISH calls endGame({finished:true})');
});
await test('M4-7. ガードは finished/training 分岐より前に評価される（FINISH も1回だけ）', () => {
    const loopSrc = readFileSync(path.join(JS_DIR, 'controller/game-loop.js'), 'utf8');
    const body = loopSrc.slice(loopSrc.indexOf('export function endGame'));
    const guardIdx = body.indexOf('if (loopState.ended) return;');
    const finishedIdx = body.indexOf('opts.finished === true');
    assert(guardIdx >= 0 && finishedIdx > guardIdx, 'guard runs before finished/training branch');
});

// --- Low 1: レート制限 SELECT 失敗のフェイルクローズ ---
await test('L1-1. レート制限 SELECT 失敗で 503（INSERT せずフェイルクローズ）', () => {
    assert(/error:\s*rlErr/.test(submitAnalyticsSrc), 'SELECT error captured');
    assert(/if \(rlErr\)[\s\S]*?503/.test(submitAnalyticsSrc), 'rlErr -> 503');
});
await test('L1-2. 503 は INSERT より前に返る（過剰受け入れを防ぐ）', () => {
    const rlIdx = submitAnalyticsSrc.indexOf('if (rlErr)');
    const insIdx = submitAnalyticsSrc.indexOf('.insert(');
    assert(rlIdx >= 0 && insIdx > rlIdx, 'rlErr 503 precedes insert');
});
await test('L1-3. 503 応答に秘密・詳細を含めない', () => {
    assert(!/jsonResponse\(\s*\{[^}]*rlErr/.test(submitAnalyticsSrc), 'no rlErr details in response');
    assert(!/console\.log\([^)]*rlErr/.test(submitAnalyticsSrc), 'no rlErr logging');
    assert(!/console\.log\([^)]*serviceKey/.test(submitAnalyticsSrc), 'no secret logging');
});
await test('L1-4. クライアントは 5xx でゲーム継続・再送しない（event_id を送信前にマーク）', () => {
    const sSrc = readFileSync(path.join(JS_DIR, 'services/analytics-service.js'), 'utf8');
    const addIdx = sSrc.indexOf('sentEventIds.add');
    const fetchIdx = sSrc.indexOf('await fetch(');
    assert(addIdx >= 0 && fetchIdx > addIdx, 'event_id marked sent before fetch (no resend)');
    assert(/if \(!res\.ok\) return \{ ok: false/.test(sSrc), '5xx -> return without throw');
    assert(!/throw\b/.test(sSrc.slice(sSrc.indexOf('export async function submitAnalytics'))), 'submitAnalytics never throws');
});

// --- Low 2: Replay の明示的拒否 ---
await test('L2-1. Replay は code 付き 400 で明示的に拒否する', () => {
    assert(/analytics_not_allowed_for_replay/.test(submitAnalyticsSrc), 'explicit replay code');
    assert(/analytics_not_allowed_for_replay[\s\S]*?400|replay is not analyzed[\s\S]*?400/.test(submitAnalyticsSrc), 'replay -> 400');
});
await test('L2-2. Replay 拒否は generic 検証(422)より前・Training 拒否は不変', () => {
    const replayIdx = submitAnalyticsSrc.indexOf('analytics_not_allowed_for_replay');
    const validateIdx = submitAnalyticsSrc.indexOf('validateAnalyticsPayload(payload)');
    const trainIdx = submitAnalyticsSrc.indexOf('training is not analyzed');
    assert(replayIdx >= 0 && validateIdx > replayIdx, 'replay reject precedes generic validation');
    assert(/mode === "training"[\s\S]*?400/.test(submitAnalyticsSrc), 'training -> 400 unchanged');
    assert(trainIdx >= 0 && replayIdx > trainIdx, 'training check stays before replay check');
});
await test('L2-3. Endless/TimeAttack/Hardcore（replay識別子なし）は通常検証へ進む', () => {
    assert(/payload\.mode === "replay"/.test(submitAnalyticsSrc), 'replay mode detected');
    assert(/"replay" in payload/.test(submitAnalyticsSrc) && /"ghost" in payload/.test(submitAnalyticsSrc) && /"run_id" in payload/.test(submitAnalyticsSrc), 'detects replay/ghost/run_id');
    assert(!/payload\.mode === "endless"/.test(submitAnalyticsSrc) && !/payload\.mode === "hardcore"/.test(submitAnalyticsSrc), 'allowed modes not rejected as replay');
});

// ===================================
// 結果サマリ
// ===================================
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;

console.log('\nCyber Runner — verify');
console.log('='.repeat(52));
for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
    if (!r.ok) console.log(`      → ${r.err}`);
}
console.log('='.repeat(52));
console.log(`Total: ${results.length}   Passed: ${passed}   Failed: ${failed}`);

if (failed > 0) {
    process.exitCode = 1;
    console.log('\nVERIFY FAILED');
} else {
    console.log('\nVERIFY OK');
}
