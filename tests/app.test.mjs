// End-to-end tests for index.html. Run with:  node --test tests/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, startBrowser, newContext, openApp, dbGet, standardSeed, signIn } from './harness.mjs';

let srv, browser;
before(async () => { srv = await startServer(); browser = await startBrowser(); });
after(async () => { await browser?.close(); srv?.server.close(); });

const docsIn = (db, coll) => Object.entries(db).filter(([p]) => p.startsWith(coll + '/')).map(([, v]) => v);

test('customer page sends a request', async () => {
    const ctx = await newContext(browser);
    const page = await openApp(ctx, srv.base, '', { db: {} });
    await page.fill('#cust-party', '4');
    await page.fill('#cust-time', '14:30');
    await page.fill('#cust-notes', 'Birthday party');
    await page.click('#cust-submit');
    await page.waitForFunction(() => /Request sent/.test(document.getElementById('cust-status').textContent));
    const reqs = docsIn(await dbGet(page), 'customer_requests');
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].partySize, 4);
    assert.equal(reqs[0].notes, 'Birthday party');
    assert.deepEqual(page.__errors || [], []);
    await ctx.close();
});

test('driver signs in with truck PIN and logs a sale', async () => {
    const ctx = await newContext(browser);
    const page = await openApp(ctx, srv.base, '#staff', standardSeed());
    await signIn(page, 'truck2', '1234');
    await page.waitForSelector('#sale-btn', { state: 'visible' });
    await page.fill('#sale-amount', '12.50');
    await page.fill('#sale-items', '3');
    await page.click('#sale-btn');
    await page.waitForFunction(() => /\$12\.50/.test(document.getElementById('sales-total').textContent));
    const db = await dbGet(page);
    const sales = docsIn(db, 'sales');
    assert.equal(sales.length, 1);
    assert.equal(sales[0].amount, 12.5);
    const daily = docsIn(db, 'daily');
    assert.equal(daily[0].sales, 12.5);
    assert.equal(daily[0].items, 3);
    assert.deepEqual(page.__errors || [], []);
    await ctx.close();
});

test('sale logged with no signal shows at once and is not doubled', async () => {
    const ctx = await newContext(browser);
    const page = await openApp(ctx, srv.base, '#staff', standardSeed());
    await signIn(page, 'truck2', '1234');
    await page.waitForSelector('#sale-btn', { state: 'visible' });
    await page.evaluate(() => localStorage.setItem('__mockoffline', '1'));
    await page.fill('#sale-amount', '8');
    await page.fill('#sale-items', '2');
    await page.click('#sale-btn');
    // The driver must see the sale right away, even though the "server" hasn't confirmed it.
    await page.waitForFunction(() => document.getElementById('sales-list').textContent.includes('$8.00'), null, { timeout: 3000 });
    assert.equal(await page.inputValue('#sale-amount'), '', 'amount box should clear so the driver knows it took');
    assert.match(await page.textContent('#sales-card'), /signal/i, 'driver should be told it will sync when signal returns');
    // Back online: everything syncs, and there is exactly one sale.
    await page.evaluate(() => localStorage.removeItem('__mockoffline'));
    await page.waitForFunction(() => window.__mockPendingWrites === 0);
    const db = await dbGet(page);
    assert.equal(docsIn(db, 'sales').length, 1);
    assert.equal(docsIn(db, 'daily')[0].sales, 8);
    // ...and the "waiting" marks go away.
    await page.waitForFunction(() => !document.getElementById('sales-card').textContent.includes('waiting for signal'));
    assert.equal(await page.isVisible('#sales-sync'), false);
    await ctx.close();
});

test('the no-signal note appears if a save takes more than a moment', async () => {
    const ctx = await newContext(browser);
    const page = await openApp(ctx, srv.base, '#staff', standardSeed());
    await signIn(page, 'truck2', '1234');
    await page.waitForSelector('#sale-btn', { state: 'visible' });
    await page.evaluate(() => localStorage.setItem('__mockoffline', '1'));
    await page.fill('#sale-amount', '5');
    await page.click('#sale-btn');
    await page.waitForSelector('#sales-sync', { state: 'visible', timeout: 4000 });
    assert.match(await page.textContent('#sales-sync'), /saved on this phone/i);
    await page.evaluate(() => localStorage.removeItem('__mockoffline'));
    await page.waitForSelector('#sales-sync', { state: 'hidden' });
    await ctx.close();
});

test('a sale the database refuses is taken back off the screen', async () => {
    const ctx = await newContext(browser);
    const page = await openApp(ctx, srv.base, '#staff', standardSeed());
    await signIn(page, 'truck2', '1234');
    await page.waitForSelector('#sale-btn', { state: 'visible' });
    await page.evaluate(() => localStorage.setItem('__mockdeny', '["sales"]'));
    let alertText = '';
    page.once('dialog', (d) => { alertText = d.message(); d.accept(); });
    await page.fill('#sale-amount', '9');
    await page.click('#sale-btn');
    await page.waitForFunction(() => !document.getElementById('sales-list').textContent.includes('$9.00'));
    assert.match(alertText, /rules/);
    const db = await dbGet(page);
    assert.equal(docsIn(db, 'sales').length, 0);
    assert.equal(docsIn(db, 'daily').length, 0, 'the running total must not change when the sale is refused');
    await ctx.close();
});

test('driver can remove a sale, and the total goes back down', async () => {
    const ctx = await newContext(browser);
    const page = await openApp(ctx, srv.base, '#staff', standardSeed());
    await signIn(page, 'truck2', '1234');
    await page.waitForSelector('#sale-btn', { state: 'visible' });
    await page.fill('#sale-amount', '6');
    await page.fill('#sale-items', '1');
    await page.click('#sale-btn');
    await page.waitForFunction(() => /\$6\.00/.test(document.getElementById('sales-total').textContent));
    page.once('dialog', (d) => d.accept());
    await page.click('#sales-list button:has-text("Remove")');
    await page.waitForFunction(() => /\$0\.00/.test(document.getElementById('sales-total').textContent));
    const db = await dbGet(page);
    assert.equal(docsIn(db, 'sales').length, 0);
    assert.equal(docsIn(db, 'daily')[0].saleCount, 0);
    await ctx.close();
});

test('admin dashboard does not run code planted in daily totals', async () => {
    const ctx = await newContext(browser);
    const seed = standardSeed();
    // A login for a truck number nobody uses (anyone could create one) wrote booby-trapped totals.
    const trap = '<img src=x onerror="window.__pwned=1">';
    seed.db['daily/{TODAY}_truck55'] = { truckId: 'truck55', day: '{TODAY}', sales: 1, items: trap, saleCount: 1, stopCount: trap, stopSec: 0 };
    seed.db['daily/{TODAY}_truck2'] = { truckId: 'truck2', day: '{TODAY}', sales: 20, items: 4, saleCount: 2, stopCount: 1, stopSec: 300 };
    const page = await openApp(ctx, srv.base, '#staff', seed);
    await signIn(page, 'admin', 'admin-test-pass');
    await page.waitForSelector('#admin-stats .stat');
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'planted script ran in the admin page');
    assert.equal(await page.locator('#admin-stats img, #admin-trucks-list img').count(), 0);
    // Real numbers from real trucks still add up.
    assert.match(await page.textContent('#admin-stats'), /\$21\.00/);
    await ctx.close();
});

test('driver starts a shift and the truck shows up live', async () => {
    const ctx = await newContext(browser);
    const page = await openApp(ctx, srv.base, '#staff', standardSeed());
    await signIn(page, 'truck2', '1234');
    await page.waitForSelector('#gps-btn', { state: 'visible' });
    await page.click('#gps-btn');
    await page.waitForFunction(() => !!JSON.parse(localStorage.getItem('__mockdb') || '{}')['active_fleet/truck2'], null, { timeout: 8000 });
    const pos = (await dbGet(page))['active_fleet/truck2'];
    assert.ok(Math.abs(pos.lat - 42.36) < 0.01 && Math.abs(pos.lng + 71.06) < 0.01, 'position comes from the phone GPS');
    assert.deepEqual(page.__errors || [], []);
    await ctx.close();
});

test('admin dashboard loads with the truck list', async () => {
    const ctx = await newContext(browser);
    const page = await openApp(ctx, srv.base, '#staff', standardSeed());
    await signIn(page, 'admin', 'admin-test-pass');
    await page.waitForSelector('#admin-trucks-list .tcard');
    assert.match(await page.textContent('#admin-trucks-list'), /Truck 2/);
    assert.match(await page.textContent('#admin-trucks-list'), /Dana/);
    assert.deepEqual(page.__errors || [], []);
    await ctx.close();
});
