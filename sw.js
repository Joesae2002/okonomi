const V = 'okonomi-v9', FILES = ['./', 'index.html', 'app.js', 'style.css', 'config.js', 'lib/parse.js', 'lib/categorize.js', 'lib/analysis.js', 'lib/seasonal.js', 'lib/presets.js', 'lib/calc.js', 'lib/charts.js', 'lib/dynbudget.js', 'lib/subscriptions.js', 'lib/logos.js', 'lib/goals.js', 'lib/fixed.js', 'lib/share.js', 'lib/income.js', 'lib/stores.js', 'lib/uploads.js', 'lib/tax.js', 'lib/salary.js', 'lib/budgetsuggest.js', 'manifest.json', 'vendor/supabase.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(FILES))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))));
// Nettverk først (så oppdateringer vises), cache som reserve. Supabase-kall går aldri via cache.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});

self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: 'Økonomi', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Økonomi', { body: d.body, icon: 'icons/icon.svg', tag: d.tag, data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => cs.length ? cs[0].focus() : clients.openWindow(e.notification.data.url)));
});
