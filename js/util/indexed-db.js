// ===================================
// util/indexed-db.js — IndexedDB の最小ラッパー（横断的関心）（Phase 10）
//
// 責務: 大きめのデータ（ゴースト/リプレイ）の保存・読込を Promise で提供する。
//   IndexedDB が使えない / 例外を投げる環境でも throw せず、false/null を返す
//   （ゲーム本体は継続できる）。内部例外は console.warn のみ。
//
// 依存方向: なし（リーフ。DOM/Canvas/通信/state に触れない）。
// ===================================

// IndexedDB が利用可能か（Node やプライベートモード等では false）。
export function idbAvailable() {
    try {
        return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch (_e) {
        return false;
    }
}

function openDB(dbName, storeName) {
    return new Promise((resolve, reject) => {
        if (!idbAvailable()) return reject(new Error('IndexedDB unavailable'));
        let req;
        try {
            req = indexedDB.open(dbName, 1);
        } catch (e) {
            return reject(e);
        }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('open failed'));
    });
}

// 値を保存する。成功で true、失敗（未対応含む）で false（throw しない）。
export async function idbPut(dbName, storeName, key, value) {
    try {
        const db = await openDB(dbName, storeName);
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(value, key);
            tx.oncomplete = () => { db.close(); resolve(true); };
            tx.onerror = () => reject(tx.error || new Error('put failed'));
        });
    } catch (err) {
        console.warn('idbPut failed:', err);
        return false;
    }
}

// 値を読み込む。未存在・失敗（未対応含む）で null（throw しない）。
export async function idbGet(dbName, storeName, key) {
    try {
        const db = await openDB(dbName, storeName);
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const r = tx.objectStore(storeName).get(key);
            r.onsuccess = () => { db.close(); resolve(r.result == null ? null : r.result); };
            r.onerror = () => reject(r.error || new Error('get failed'));
        });
    } catch (err) {
        console.warn('idbGet failed:', err);
        return null;
    }
}
