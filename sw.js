/* 配送日報 — オフライン用 Service Worker
   ファイルを更新したら CACHE の数字を上げてください */
const CACHE = 'nippou-v29';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest',
               './icon.svg', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // 同じオリジン（liner12345.github.io）の別アプリのキャッシュは消さない
      .then(keys => Promise.all(keys.filter(k => k.startsWith('nippou-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ネットワーク優先。電波が弱くて NET_TIMEOUT までに返ってこなければ、キャッシュがあればそれを返す
   （キャッシュに無ければそのままネットワークを待つ）。圏外ならキャッシュを返す */
const NET_TIMEOUT = 3000;

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;
  let stored = Promise.resolve();
  const net = fetch(req).then(res => {
    // 404 や 5xx を保存すると、圏外のときにそれが返ってしまう
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      stored = caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  });
  // 先にキャッシュを返しても、遅れて届いた新しい版を保存し終えるまで動かしておく
  e.waitUntil(net.then(() => stored, () => {}));
  e.respondWith(new Promise(resolve => {
    const timer = setTimeout(() => {
      caches.match(req).then(r => { if (r) resolve(r); });
    }, NET_TIMEOUT);
    net.then(res => { clearTimeout(timer); resolve(res); }, () => {
      clearTimeout(timer);
      resolve(caches.match(req).then(r => r || caches.match('./index.html')));
    });
  }));
});
