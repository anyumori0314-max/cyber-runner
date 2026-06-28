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

    // (a) 正常値: 保存済み JSON を読み込めること
    const good = { soundEnabled: false, soundVolume: 0.5, screenShakeEnabled: false, particlesEnabled: true, showControls: false };
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
