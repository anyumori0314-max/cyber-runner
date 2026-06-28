// ===================================
// supabase/functions/_shared/score-validation.js
//   サーバー（Edge Function / Deno）と Node テストの双方から import できる
//   「依存ゼロ・純粋関数」のスコア検証ロジック。
//
//   ブラウザゲームのため完全なチート防止は不可能。目的は
//   「異常値の拒否 / 重複防止 / レート制限 / mode 検証」に絞る。
//
//   ※ Deno / Node どちらの ESM からも import 可能（外部依存・ランタイム API 不使用）。
// ===================================

export const ALLOWED_MODES = ['endless', 'timeattack', 'hardcore', 'training'];
export const VALID_RANKS = ['S', 'A', 'B', 'C', 'D'];

// サニティ境界（通常プレイでは到達しない防御的上限）。
export const LIMITS = {
    SCORE_MAX: 1000000000,
    COMBO_MAX: 1000000,
    DURATION_MAX_MS: 60 * 60 * 1000, // 1時間
    DURATION_MIN_MS: 500, // 0.5秒未満は不成立
    NAME_MAX_LENGTH: 12,
    // duration と score の矛盾検出：1秒あたりに獲得しうるスコアの寛容な上限 + 固定許容。
    MAX_SCORE_PER_SEC: 5000,
    SCORE_FLAT_ALLOWANCE: 5000,
    METRICS: {
        core_count: 100000,
        near_miss_count: 100000,
        dash_count: 100000,
        reached_level: 100000
    }
};

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

// duration（ミリ秒）に対して妥当なスコア上限を返す。
export function maxPlausibleScore(durationMs) {
    const sec = Math.max(0, Number(durationMs) || 0) / 1000;
    return Math.ceil(sec * LIMITS.MAX_SCORE_PER_SEC + LIMITS.SCORE_FLAT_ALLOWANCE);
}

// duration と score が明らかに矛盾していないか。
export function isDurationScoreConsistent(score, durationMs) {
    if (!isFiniteNumber(score) || !isFiniteNumber(durationMs)) return false;
    if (durationMs < LIMITS.DURATION_MIN_MS) return false;
    return score <= maxPlausibleScore(durationMs);
}

// プレイヤー名を既存制限内へ正規化（trim → 空なら ANONYMOUS → 12文字）。
// 後方互換のため残す（緩い正規化）。厳格検証は validatePlayerName を使う。
export function normalizeName(rawName) {
    const name = String(rawName == null ? '' : rawName).trim();
    return (name || 'ANONYMOUS').slice(0, LIMITS.NAME_MAX_LENGTH);
}

// プレイヤー名のサーバー側「正本」検証（Medium 2）。
//   日本語・英数字・通常の空白・ハイフン・アンダースコア等の通常名は許可しつつ、
//   制御文字・不可視文字・方向制御（bidi）・行/段落区切り・改行/タブを拒否する。
//   返り値: { ok, value }（成功）/ { ok:false, error }（失敗 → Edge Function は 400）。
//
//   - \p{Cc}: C0/C1 制御文字
//   - \p{Cf}: format 文字（ゼロ幅 ZWSP/ZWNJ/ZWJ、BOM、bidi 制御 LRO/RLO/LRI 等を含む）
//   - \p{Zl}/\p{Zp}: 行区切り(U+2028)/段落区切り(U+2029)
const DANGEROUS_NAME_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
export function validatePlayerName(rawName) {
    if (rawName == null) return { ok: false, error: 'name required' };
    let name = String(rawName);
    // 1) Unicode 正規化（合成済み・互換文字のばらつきを統一）。
    if (typeof name.normalize === 'function') name = name.normalize('NFC');
    // 2) 改行・タブの拒否（trim 前に判定して内部の改行も弾く）。
    if (/[\r\n\t]/.test(name)) return { ok: false, error: 'name has newline/tab' };
    // 3) 制御/不可視/方向制御/行段落区切りの拒否。
    if (DANGEROUS_NAME_CHARS.test(name)) return { ok: false, error: 'name has control/invisible chars' };
    // 4) 前後空白除去 → 空は拒否（呼び出し側が安全な既定名へ置換可能）。
    name = name.trim();
    if (name.length === 0) return { ok: false, error: 'name empty' };
    // 5) コードポイント単位の長さ制限（サロゲートペアを1文字として数える）。
    const cp = Array.from(name);
    if (cp.length > LIMITS.NAME_MAX_LENGTH) name = cp.slice(0, LIMITS.NAME_MAX_LENGTH).join('');
    return { ok: true, value: name };
}

// metrics を上限内へクランプ（不正値は 0）。許可キーのみ通す。
export function sanitizeMetrics(raw) {
    const out = { core_count: 0, near_miss_count: 0, dash_count: 0, mission_completed: false, reached_level: 0 };
    if (raw && typeof raw === 'object') {
        for (const k of ['core_count', 'near_miss_count', 'dash_count', 'reached_level']) {
            const v = Number(raw[k]);
            if (isFiniteNumber(v) && v >= 0) out[k] = Math.min(Math.floor(v), LIMITS.METRICS[k]);
        }
        out.mission_completed = raw.mission_completed === true;
    }
    return out;
}

// metrics が上限を超えていないか（境界チェック）。
export function metricsWithinLimits(raw) {
    if (!raw || typeof raw !== 'object') return false;
    for (const k of ['core_count', 'near_miss_count', 'dash_count', 'reached_level']) {
        const v = Number(raw[k]);
        if (!isFiniteNumber(v) || v < 0 || v > LIMITS.METRICS[k]) return false;
    }
    return true;
}

// 送信ペイロードの本体検証。errors[] が空なら ok。cleaned は保存可能な正規化済みデータ。
//   payload = { run_id, anonymous_player_id, player_name, mode, score, max_combo,
//               duration_ms, rank, game_version, metrics }
export function validateScorePayload(payload) {
    const errors = [];
    const p = payload && typeof payload === 'object' ? payload : {};

    if (typeof p.run_id !== 'string' || p.run_id.length < 8) errors.push('invalid run_id');
    if (!ALLOWED_MODES.includes(p.mode)) errors.push('invalid mode');

    if (!isFiniteNumber(p.score) || p.score < 0) errors.push('invalid score');
    else if (p.score > LIMITS.SCORE_MAX) errors.push('score out of range');

    if (!isFiniteNumber(p.max_combo) || p.max_combo < 0) errors.push('invalid max_combo');
    else if (p.max_combo > LIMITS.COMBO_MAX) errors.push('max_combo out of range');

    if (!isFiniteNumber(p.duration_ms) || p.duration_ms < LIMITS.DURATION_MIN_MS) errors.push('invalid duration_ms');
    else if (p.duration_ms > LIMITS.DURATION_MAX_MS) errors.push('duration out of range');

    if (isFiniteNumber(p.score) && isFiniteNumber(p.duration_ms) && !isDurationScoreConsistent(p.score, p.duration_ms)) {
        errors.push('score/duration inconsistent');
    }

    if (!metricsWithinLimits(p.metrics)) errors.push('metrics out of range');
    if (!VALID_RANKS.includes(p.rank)) errors.push('invalid rank');
    if (typeof p.game_version !== 'string' || p.game_version.length === 0) errors.push('missing game_version');

    // player_name はサーバー側正本で厳格検証（制御/不可視/bidi 文字を拒否）。
    const nameCheck = validatePlayerName(p.player_name);
    if (!nameCheck.ok) errors.push('invalid player_name');

    const cleaned = errors.length === 0
        ? {
            run_id: p.run_id,
            anonymous_player_id: typeof p.anonymous_player_id === 'string' ? p.anonymous_player_id.slice(0, 64) : null,
            player_name: nameCheck.value,
            mode: p.mode,
            score: Math.min(Math.floor(p.score), LIMITS.SCORE_MAX),
            max_combo: Math.min(Math.floor(p.max_combo), LIMITS.COMBO_MAX),
            duration_ms: Math.floor(p.duration_ms),
            rank: p.rank,
            game_version: p.game_version,
            metrics: sanitizeMetrics(p.metrics)
        }
        : null;

    return { ok: errors.length === 0, errors, cleaned };
}

// run レコードに対する送信可否（重複送信・run_id 再利用・有効期限・経過時間）。
//   run = DB の runs 行 { id, started_at(ms), expires_at(ms), submitted(bool), mode }
//   ctx = { now(ms), durationMs, mode }
export function checkRunRecord(run, ctx) {
    const errors = [];
    const now = Number(ctx && ctx.now);
    if (!run || typeof run !== 'object') {
        return { ok: false, errors: ['run_id not found'] };
    }
    if (run.submitted === true) errors.push('run already submitted'); // 二重送信 / run_id 再利用
    if (isFiniteNumber(run.expires_at) && now > run.expires_at) errors.push('run expired');
    if (ctx && ALLOWED_MODES.includes(ctx.mode) && run.mode && run.mode !== ctx.mode) errors.push('mode mismatch');

    // run 開始から送信までの経過。報告 duration が経過実時間を大きく超えるのは不正。
    if (isFiniteNumber(run.started_at) && isFiniteNumber(now) && ctx && isFiniteNumber(ctx.durationMs)) {
        const elapsed = now - run.started_at;
        if (elapsed < 0) errors.push('negative elapsed');
        else if (ctx.durationMs > elapsed + 5000) errors.push('duration exceeds server elapsed');
    }
    return { ok: errors.length === 0, errors };
}

// 簡易レート制限：直近送信時刻の配列から、windowMs 内の件数が max 以上なら拒否。
//   recentTimestamps: number[]（ms, 古い→新しい）, now: ms
export function isRateLimited(recentTimestamps, now, windowMs = 60000, max = 5) {
    if (!Array.isArray(recentTimestamps)) return false;
    const since = now - windowMs;
    const count = recentTimestamps.filter((t) => isFiniteNumber(t) && t >= since).length;
    return count >= max;
}

// ---------- start-run レート制限（Medium 1） ----------
// DB 由来の直近 run 生成時刻から判定する純粋関数（serverless メモリに依存しない）。
// 既定は環境変数で上書きできるよう Edge Function 側で渡す（ここは定数の中央集約）。
export const START_RUN_RATE = {
    WINDOW_MS: 60 * 1000, // 集計窓（1分）
    MAX_PER_ANON: 12, // 同一 anonymous_player_id の上限/窓
    MAX_PER_IP: 30 // 同一 IP ハッシュの上限/窓（共有回線を考慮し緩め）
};

// windowMs 内の件数が max 以上なら制限。isRateLimited のエイリアス（意味を明確化）。
export function isStartRateLimited(recentTimestamps, now, windowMs = START_RUN_RATE.WINDOW_MS, max = START_RUN_RATE.MAX_PER_ANON) {
    return isRateLimited(recentTimestamps, now, windowMs, max);
}

// 再試行までの目安秒（窓内最古のタイムスタンプが窓を抜けるまで）。Retry-After 用。
export function retryAfterSeconds(recentTimestamps, now, windowMs = START_RUN_RATE.WINDOW_MS) {
    const since = now - windowMs;
    const inWindow = (Array.isArray(recentTimestamps) ? recentTimestamps : [])
        .filter((t) => isFiniteNumber(t) && t >= since)
        .sort((a, b) => a - b);
    if (inWindow.length === 0) return 0;
    return Math.max(1, Math.ceil((inWindow[0] + windowMs - now) / 1000));
}

// ---------- 原子的スコア登録の参照モデル（High 1） ----------
// SQL の submit_score_atomic（FOR UPDATE ロック → 検証 → INSERT → submitted=true を
// 単一トランザクションで実行）と「同じ判定順序・同じ競合安全契約」を Node で検証するための
// 純粋・同期モデル。JS の同期実行は不可分なので「ロック獲得後の直列化」を模擬できる。
//
//   store = { runs: Map<run_id, {mode, expires_at(ms), submitted, anonymous_player_id}>, scores: [] }
//   cleaned = validateScorePayload の cleaned 相当（run_id/mode/score/player_name/anonymous_player_id）
//   ctx = { now(ms) }
//   opts.insert(row) を渡すと INSERT 失敗を注入できる（throw でロールバックを検証）。
// 返り値: { ok, status, error }。status は Edge Function の HTTP コードに対応（409/400/500/200）。
export function simulateAtomicSubmit(store, cleaned, ctx, opts = {}) {
    const now = Number(ctx && ctx.now);
    const runs = store && store.runs;
    const scores = (store && store.scores) || [];
    // --- BEGIN（FOR UPDATE 相当: 対象 run をロックして直列化） ---
    const run = runs && runs.get ? runs.get(cleaned.run_id) : null;
    if (!run) return { ok: false, status: 409, error: 'run_id not found' };
    if (run.submitted === true) return { ok: false, status: 409, error: 'run already submitted' };
    if (isFiniteNumber(run.expires_at) && now > run.expires_at) return { ok: false, status: 409, error: 'run expired' };
    if (run.mode && cleaned.mode && run.mode !== cleaned.mode) return { ok: false, status: 409, error: 'mode mismatch' };
    if (run.anonymous_player_id && cleaned.anonymous_player_id && run.anonymous_player_id !== cleaned.anonymous_player_id) {
        return { ok: false, status: 409, error: 'anonymous_player_id mismatch' };
    }
    if (cleaned.mode === 'training') return { ok: false, status: 400, error: 'training is not ranked' };
    // --- INSERT → mark（順序が重要: INSERT 成功後にのみ run を消費） ---
    try {
        const insert = typeof opts.insert === 'function'
            ? opts.insert
            : (row) => { scores.push(row); };
        insert({ run_id: cleaned.run_id, mode: cleaned.mode, score: cleaned.score, player_name: cleaned.player_name });
    } catch (_e) {
        // ROLLBACK: run は未消費（submitted=false）のまま。スコアも残らない。
        return { ok: false, status: 500, error: 'insert failed (rolled back)' };
    }
    run.submitted = true; // COMMIT 相当
    return { ok: true, status: 200 };
}
