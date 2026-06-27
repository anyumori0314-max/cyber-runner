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

// Supabase 通信は fetch をモックして「実コードが組み立てる URL / payload」を検証する。
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
    assert(getUrl.includes(`limit=${config.LEADERBOARD_LIMIT}`), `limit=${config.LEADERBOARD_LIMIT} missing: ${getUrl}`);

    let titleUrl = null;
    globalThis.fetch = async (url) => { titleUrl = url; return { ok: true, status: 200, json: async () => [] }; };
    await silenceConsole(async () => leaderboard.loadTitleLeaderboard());
    assert(titleUrl.includes(`limit=${config.TITLE_LEADERBOARD_LIMIT}`), `title limit=${config.TITLE_LEADERBOARD_LIMIT} missing: ${titleUrl}`);
});

await test('19/20. Supabase POST payload は4キーのみ（created_at を送らない）', async () => {
    let postBody = null;
    let postMethod = null;
    globalThis.fetch = async (url, opts) => {
        if (opts && opts.method === 'POST') {
            postMethod = 'POST';
            postBody = JSON.parse(opts.body);
        }
        return { ok: true, status: 200, json: async () => [] };
    };
    leaderboard.configureLeaderboard({ getRawName: () => 'TESTER' });
    leaderboard.prepareSubmission({ score: 1234.7, maxCombo: 42, rank: 'A' });
    await silenceConsole(async () => leaderboard.handleSendScore());

    assertEqual(postMethod, 'POST', 'a POST should have been issued');
    assert(postBody, 'POST body captured');
    const keys = Object.keys(postBody).sort();
    assertDeepEqual(keys, ['max_combo', 'player_name', 'rank', 'score'], 'payload keys must be exactly the 4 allowed');
    assert(!('created_at' in postBody), 'created_at must NOT be in POST payload');
    assertEqual(postBody.player_name, 'TESTER', 'player_name');
    assertEqual(postBody.score, 1234, 'score floored');
    assertEqual(postBody.max_combo, 42, 'max_combo');
    assertEqual(postBody.rank, 'A', 'rank');
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
