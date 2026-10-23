// Test stand-in for https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js
// Accounts live in localStorage "__mockusers" ({ email: { uid, password } }); who is signed in to each
// Firebase app lives in "__mockauth:<appName>", so tabs of one browser context share the sign-in.
const USERS_KEY = '__mockusers';
const loadUsers = () => { try { return JSON.parse(localStorage.getItem(USERS_KEY) || '{}'); } catch (e) { return {}; } };
const saveUsers = (u) => localStorage.setItem(USERS_KEY, JSON.stringify(u));
const authErr = (code) => Object.assign(new Error(code), { code, name: 'FirebaseError' });

const auths = new Map();
function makeUser(auth, email) {
    const rec = loadUsers()[email];
    return rec ? { uid: rec.uid, email, _auth: auth } : null;
}
export function getAuth(app) {
    const name = (app && app.name) || '[DEFAULT]';
    if (auths.has(name)) return auths.get(name);
    const key = '__mockauth:' + name;
    const auth = { key, observers: new Set(), currentUser: null };
    const saved = localStorage.getItem(key);
    if (saved) auth.currentUser = makeUser(auth, saved);
    auths.set(name, auth);
    return auth;
}
function setUser(auth, user) {
    auth.currentUser = user;
    if (user) localStorage.setItem(auth.key, user.email); else localStorage.removeItem(auth.key);
    for (const fn of [...auth.observers]) setTimeout(() => fn(auth.currentUser), 0);
}
export function onAuthStateChanged(auth, fn) {
    auth.observers.add(fn);
    setTimeout(() => { if (auth.observers.has(fn)) fn(auth.currentUser); }, 0);
    return () => auth.observers.delete(fn);
}
export async function signInWithEmailAndPassword(auth, email, password) {
    const rec = loadUsers()[String(email).toLowerCase()];
    if (!rec || rec.password !== password) throw authErr('auth/invalid-credential');
    const user = makeUser(auth, String(email).toLowerCase());
    setUser(auth, user);
    return { user };
}
export async function createUserWithEmailAndPassword(auth, email, password) {
    email = String(email).toLowerCase();
    if (String(password).length < 6) throw authErr('auth/weak-password');
    const users = loadUsers();
    if (users[email]) throw authErr('auth/email-already-in-use');
    users[email] = { uid: 'uid_' + Math.random().toString(36).slice(2, 12), password };
    saveUsers(users);
    const user = makeUser(auth, email);
    setUser(auth, user);
    return { user };
}
export async function signOut(auth) { setUser(auth, null); }
export async function updatePassword(user, password) {
    if (String(password).length < 6) throw authErr('auth/weak-password');
    const users = loadUsers();
    if (!users[user.email]) throw authErr('auth/user-not-found');
    users[user.email].password = password;
    saveUsers(users);
}
export async function deleteUser(user) {
    const users = loadUsers();
    delete users[user.email];
    saveUsers(users);
    if (user._auth && user._auth.currentUser && user._auth.currentUser.email === user.email) setUser(user._auth, null);
}
export const EmailAuthProvider = { credential: (email, password) => ({ email, password }) };
export async function reauthenticateWithCredential(user, cred) {
    const rec = loadUsers()[user.email];
    if (!rec || rec.password !== cred.password) throw authErr('auth/invalid-credential');
    return { user };
}
