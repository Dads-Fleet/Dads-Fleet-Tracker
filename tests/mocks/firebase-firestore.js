// Test stand-in for https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js
// Only the parts the app uses. Data lives in localStorage under "__mockdb", so every page of the same
// browser context (e.g. an admin tab and a driver tab) shares one database, like the real thing.
//
// Test switches (set from a test with page.evaluate):
//   localStorage.__mockdeny    = '["sales"]'  -> reads/writes to those collections fail with permission-denied
//   localStorage.__mockoffline = '1'          -> writes apply locally at once (like Firestore's local cache),
//                                                but their promises only resolve once this is cleared
const DB_KEY = '__mockdb';

class Timestamp {
    constructor(ms) { this._ms = ms; this.seconds = Math.floor(ms / 1000); this.nanoseconds = (ms % 1000) * 1e6; }
    toMillis() { return this._ms; }
    toDate() { return new Date(this._ms); }
}

const loadDb = () => { try { return JSON.parse(localStorage.getItem(DB_KEY) || '{}'); } catch (e) { return {}; } };
const saveDb = (d) => localStorage.setItem(DB_KEY, JSON.stringify(d));
const denied = (coll) => { try { return JSON.parse(localStorage.getItem('__mockdeny') || '[]').includes(coll); } catch (e) { return false; } };
const offline = () => localStorage.getItem('__mockoffline') === '1';
const permErr = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied', name: 'FirebaseError' });
const autoId = () => Array.from({ length: 20 }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('');

// ---------- values ----------
const SENT = '__op';
export const serverTimestamp = () => ({ [SENT]: 'ts' });
export const increment = (n) => ({ [SENT]: 'inc', n });
export const deleteField = () => ({ [SENT]: 'del' });
const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(SENT in v) && !('__ts' in v);

function resolveValue(v, old) {
    if (v && typeof v === 'object' && SENT in v) {
        if (v[SENT] === 'ts') return { __ts: Date.now() };
        if (v[SENT] === 'inc') return (typeof old === 'number' ? old : 0) + v.n;
    }
    if (isPlain(v)) { const o = {}; for (const k of Object.keys(v)) { const r = resolveValue(v[k], undefined); if (!(r && r[SENT] === 'del')) o[k] = r; } return o; }
    if (Array.isArray(v)) return v.map(x => resolveValue(x));
    return v;
}
function mergeInto(target, src) {
    for (const k of Object.keys(src)) {
        const v = src[k];
        if (v && typeof v === 'object' && v[SENT] === 'del') { delete target[k]; continue; }
        if (isPlain(v)) { if (!isPlain(target[k])) target[k] = {}; mergeInto(target[k], v); continue; }
        target[k] = resolveValue(v, target[k]);
    }
    return target;
}
function decode(v) {
    if (v && typeof v === 'object' && '__ts' in v) return new Timestamp(v.__ts);
    if (Array.isArray(v)) return v.map(decode);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = decode(v[k]); return o; }
    return v;
}

// ---------- references ----------
export function initializeFirestore(app, settings) { return { app, settings, type: 'firestore' }; }
export function getFirestore(app) { return { app, type: 'firestore' }; }
export function persistentLocalCache(opts) { return { kind: 'persistent', ...(opts || {}) }; }
export function persistentMultipleTabManager() { return { kind: 'multiTab' }; }
export function memoryLocalCache() { return { kind: 'memory' }; }

export function collection(db, name) { return { type: 'collection', id: name, path: name }; }
export function doc(a, coll, id) {
    if (a && a.type === 'collection') { const i = coll || autoId(); return { type: 'document', id: i, coll: a.id, path: a.id + '/' + i }; }
    if (id === undefined) { const [c, i] = String(coll).split('/'); return { type: 'document', id: i, coll: c, path: c + '/' + i }; }
    return { type: 'document', id: String(id), coll: coll, path: coll + '/' + id };
}
export const where = (field, op, value) => ({ kind: 'where', field, op, value });
export const orderBy = (field, dir = 'asc') => ({ kind: 'orderBy', field, dir });
export const limit = (n) => ({ kind: 'limit', n });
export function query(coll, ...constraints) { return { type: 'query', coll: coll.id, path: coll.id, constraints }; }

// ---------- snapshots ----------
function docSnap(ref, raw) {
    return { id: ref.id, ref, exists: () => raw !== undefined, data: () => (raw === undefined ? undefined : decode(raw)) };
}
const cmpVal = (v) => (v && typeof v === 'object' && '__ts' in v) ? v.__ts : v;
function runQuery(q) {
    const db = loadDb();
    const coll = q.type === 'collection' ? q.id : q.coll;
    let rows = Object.keys(db).filter(p => p.startsWith(coll + '/') && p.split('/').length === 2)
        .map(p => ({ ref: doc({ type: 'collection', id: coll }, p.split('/')[1]), raw: db[p] }));
    const cons = q.constraints || [];
    cons.filter(c => c.kind === 'where').forEach(c => {
        rows = rows.filter(r => { const v = cmpVal(r.raw[c.field]); return c.op === '==' ? v === c.value : c.op === '!=' ? v !== c.value : c.op === '>=' ? v >= c.value : c.op === '<=' ? v <= c.value : c.op === '>' ? v > c.value : c.op === '<' ? v < c.value : true; });
    });
    cons.filter(c => c.kind === 'orderBy').forEach(c => {
        rows = rows.filter(r => r.raw[c.field] !== undefined);
        rows.sort((a, b) => { const x = cmpVal(a.raw[c.field]), y = cmpVal(b.raw[c.field]); return (x < y ? -1 : x > y ? 1 : 0) * (c.dir === 'desc' ? -1 : 1); });
    });
    const lim = cons.find(c => c.kind === 'limit');
    if (lim) rows = rows.slice(0, lim.n);
    const docs = rows.map(r => docSnap(r.ref, r.raw));
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
}
const collOf = (target) => target.type === 'document' ? target.coll : (target.type === 'collection' ? target.id : target.coll);
function snapOf(target) {
    if (target.type === 'document') return docSnap(target, loadDb()[target.path]);
    return runQuery(target);
}

// ---------- listeners ----------
const listeners = new Set();
function notifyAll() {
    for (const l of [...listeners]) {
        const key = JSON.stringify(snapOf(l.target).docs ? loadDbSlice(l.target) : loadDb()[l.target.path] ?? null);
        if (key !== l.last) { l.last = key; try { l.next(snapOf(l.target)); } catch (e) { console.error(e); } }
    }
}
function loadDbSlice(target) { const db = loadDb(), c = collOf(target); return Object.keys(db).filter(p => p.startsWith(c + '/')).sort().map(p => [p, db[p]]); }
window.addEventListener('storage', (e) => { if (e.key === DB_KEY || e.key === null) notifyAll(); });

export function onSnapshot(target, next, error) {
    const l = { target, next: typeof next === 'function' ? next : (next && next.next) || (() => {}), last: undefined };
    const err = typeof error === 'function' ? error : (next && next.error) || (() => {});
    if (denied(collOf(target))) { setTimeout(() => err(permErr()), 0); return () => {}; }
    listeners.add(l);
    setTimeout(() => { if (listeners.has(l)) { l.last = JSON.stringify(target.type === 'document' ? (loadDb()[target.path] ?? null) : loadDbSlice(target)); l.next(snapOf(target)); } }, 0);
    return () => listeners.delete(l);
}

// ---------- reads ----------
export async function getDoc(ref) { if (denied(ref.coll)) throw permErr(); return snapOf(ref); }
export async function getDocs(q) { if (denied(collOf(q))) throw permErr(); return snapOf(q); }

// ---------- writes ----------
window.__mockPendingWrites = 0;
function commit(coll, apply) {
    if (denied(coll)) return Promise.reject(permErr());
    const db = loadDb();
    apply(db);
    saveDb(db);
    notifyAll();
    if (!offline()) return Promise.resolve();
    // Offline: the change is already visible locally; the promise waits for the "server".
    window.__mockPendingWrites++;
    return new Promise((resolve) => {
        const t = setInterval(() => { if (!offline()) { clearInterval(t); window.__mockPendingWrites--; resolve(); } }, 50);
    });
}
export function setDoc(ref, data, opts) {
    return commit(ref.coll, (db) => {
        db[ref.path] = (opts && opts.merge) ? mergeInto(db[ref.path] ? JSON.parse(JSON.stringify(db[ref.path])) : {}, data) : resolveValue(data);
    });
}
export function updateDoc(ref, data) { return setDoc(ref, data, { merge: true }); }
export async function addDoc(coll, data) {
    const ref = doc(coll);
    await setDoc(ref, data);
    return ref;
}
export function deleteDoc(ref) { return commit(ref.coll, (db) => { delete db[ref.path]; }); }
// All-or-nothing: if any collection in the batch is denied, nothing is written.
export function writeBatch() {
    const ops = [];
    return {
        set(ref, data, opts) { ops.push({ ref, kind: 'set', data, opts }); return this; },
        update(ref, data) { ops.push({ ref, kind: 'set', data, opts: { merge: true } }); return this; },
        delete(ref) { ops.push({ ref, kind: 'delete' }); return this; },
        commit() {
            const bad = ops.find(o => denied(o.ref.coll));
            if (bad) return Promise.reject(permErr());
            return commit(null, (db) => {
                for (const o of ops) {
                    if (o.kind === 'delete') delete db[o.ref.path];
                    else db[o.ref.path] = (o.opts && o.opts.merge) ? mergeInto(db[o.ref.path] ? JSON.parse(JSON.stringify(db[o.ref.path])) : {}, o.data) : resolveValue(o.data);
                }
            });
        }
    };
}
export function waitForPendingWrites() {
    return new Promise((resolve) => { const t = setInterval(() => { if (window.__mockPendingWrites === 0) { clearInterval(t); resolve(); } }, 50); });
}
export { Timestamp };
