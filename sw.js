// Augmenter VERSION à chaque déploiement : c'est ce qui déclenche « Nouvelle version disponible ».
const VERSION = '0.1.2';
const CACHE = `coach-echecs-${VERSION}`;

const PIECES = ['K', 'Q', 'R', 'B', 'N', 'P'].flatMap((p) => [`vendor/pieces/w${p}.svg`, `vendor/pieces/b${p}.svg`]);
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/analyzer.js',
  'js/app.js',
  'js/board.js',
  'js/chart.js',
  'js/chesscom.js',
  'js/db.js',
  'js/engine.js',
  'js/lichess.js',
  'js/review.js',
  'js/ui.js',
  'vendor/chess.js',
  'vendor/stockfish-19-lite-single.js',
  'vendor/stockfish-19-lite-single.wasm',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  ...PIECES,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('coach-echecs-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'VERSION') event.ports[0]?.postMessage(VERSION);
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = event.request.mode === 'navigate' ? 'index.html' : event.request;
    return (await cache.match(key, { ignoreSearch: true })) ?? fetch(event.request);
  })());
});
