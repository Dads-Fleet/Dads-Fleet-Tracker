// Shared test setup: a tiny local web server for the repo, plus a browser whose requests to Firebase's CDN
// are answered by the stand-ins in tests/mocks. Nothing here can reach the real Firebase project.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const TESTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TESTS, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export async function startServer() {
    const server = http.createServer((req, res) => {
        const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const file = path.join(ROOT, p === '/' ? 'index.html' : p);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return { server, base: 'http://127.0.0.1:' + server.address().port };
}

export async function startBrowser() {
    return chromium.launch();
}

// A fresh browser context (its own localStorage = its own mock database) with the CDNs rerouted.
export async function newContext(browser, opts = {}) {
    const context = await browser.newContext({ serviceWorkers: 'block', geolocation: { latitude: 42.36, longitude: -71.06 }, permissions: ['geolocation'], ...opts });
    await context.route(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.8\.1\/([a-z-]+\.js)$/, (route) => {
        const name = route.request().url().split('/').pop();
        route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(TESTS, 'mocks', name)) });
    });
    // Leaflet: use the local build if there is one (offline sandboxes), otherwise the real CDN (CI).
    await context.route(/^https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/(leaflet\.(?:js|css))$/, (route) => {
        const name = route.request().url().split('/').pop();
        const local = path.join(TESTS, 'vendor', name);
        if (fs.existsSync(local)) route.fulfill({ status: 200, contentType: TYPES[path.extname(name)], body: fs.readFileSync(local) });
        else route.continue();
    });
    await context.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
    await context.route(/nominatim\.openstreetmap\.org|router\.project-osrm\.org/, (route) => route.fulfill({ status: 503, body: '' }));
    return context;
}

// Seed the mock database/accounts for this context, then open the app at `hash`.
export async function openApp(context, base, hash = '', seed = null) {
    const page = await context.newPage();
    page.on('pageerror', (e) => { (page.__errors ||= []).push(String(e && e.message || e)); });
    if (seed) {
        await page.goto(base + '/manifest.json');
        await page.evaluate((s) => {
            const today = new Date().toLocaleDateString('en-CA');
            const fill = (o) => JSON.parse(JSON.stringify(o).replaceAll('{TODAY}', today));
            if (s.db) localStorage.setItem('__mockdb', JSON.stringify(fill(s.db)));
            if (s.users) localStorage.setItem('__mockusers', JSON.stringify(s.users));
            if (s.local) for (const [k, v] of Object.entries(fill(s.local))) localStorage.setItem(k, v);
        }, seed);
    }
    await page.goto(base + '/' + hash);
    return page;
}

export const dbGet = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('__mockdb') || '{}'));

// A small, standard world: a main admin and one truck (truck2, PIN 1234).
export const pinPassword = (pin, truckId) => 'pin-' + pin + '-' + truckId;
export function standardSeed() {
    return {
        users: {
            'admin@dispatch.local': { uid: 'uid_admin', password: 'admin-test-pass' },
            'truck2@dispatch.local': { uid: 'uid_truck2', password: pinPassword('1234', 'truck2') }
        },
        db: {
            'setup/admin': { username: 'Boss' },
            'trucks/truck2': { city: 'Springfield', driverName: 'Dana', createdAt: { __ts: 1760000000000 } },
            'pins/truck2': { pin: '1234' },
            'config/metrics': { stops: true, sales: true, items: true }
        }
    };
}

export async function signIn(page, who, secret) {
    await page.waitForSelector('#login-who option[value="' + who + '"]', { state: 'attached' });
    await page.selectOption('#login-who', who);
    await page.fill('#login-pass', secret);
    await page.click('#login-btn');
}
