# Tests

End-to-end tests for `index.html`, run in a real (headless) Chrome.

They **never touch the real Firebase project**: the page's imports from
`www.gstatic.com/firebasejs/10.8.1/…` are answered by the stand-ins in `mocks/`,
which keep data in the browser's localStorage (`__mockdb`, `__mockusers`).
Map tiles, address search and routing are answered with blanks.

## Run

```
cd tests
npm install
npx playwright install chromium
npm test
```

GitHub runs the same thing on every push (`.github/workflows/test.yml`).

## No internet for unpkg?

Leaflet normally loads from unpkg. In a sandbox that blocks it, put a build of
Leaflet 1.9.4 in `tests/vendor/leaflet.js` and `leaflet.css` (git-ignored) and the
tests use those instead:

```
git clone --depth 1 --branch v1.9.4 https://github.com/Leaflet/Leaflet /tmp/leaflet
npx esbuild /tmp/leaflet/src/Leaflet.js --bundle --format=iife --global-name=L --outfile=vendor/leaflet.js
cp /tmp/leaflet/dist/leaflet.css vendor/
```

## Test switches (in the mocks)

- `localStorage.__mockdeny = '["sales"]'` makes those collections fail with *permission-denied*.
- `localStorage.__mockoffline = '1'` simulates no signal: writes show at once, but don't
  "reach the server" until it's cleared.
