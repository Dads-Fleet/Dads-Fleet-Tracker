// Test stand-in for https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js
// Tests route the real CDN URL to this file, so the app never talks to the real Firebase project.
const apps = new Map();
export function initializeApp(config, name = '[DEFAULT]') {
    if (apps.has(name)) return apps.get(name);
    const app = { name, options: config };
    apps.set(name, app);
    return app;
}
export function getApp(name = '[DEFAULT]') { return apps.get(name); }
