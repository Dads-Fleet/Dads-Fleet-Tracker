// Service worker for the Fleet & Dispatch app.
// It does NOT store the app offline. Its only jobs:
//  1) make the app installable ("Add to Home screen" / "Install app"), and
//  2) always fetch the newest page when the app opens, so updates show up right away
//     instead of waiting for GitHub's 10-minute browser cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode !== 'navigate') return; // everything else: browser handles it normally
  event.respondWith(
    fetch(req, { cache: 'no-store' }).catch(() => fetch(req)) // fresh page; fall back to normal if that fails
  );
});
