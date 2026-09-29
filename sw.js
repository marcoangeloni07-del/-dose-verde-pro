const CACHE_NAME='dose-verde-shell-v1.5.4';
const SHELL=['/','/index.html','/manifest.webmanifest','/icon-192.png','/icon-512.png'];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME && k.startsWith('dose-verde-')).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;

  const url=new URL(req.url);

  // API features require an internet connection.
  if(url.origin===self.location.origin && url.pathname.startsWith('/api/')){
    event.respondWith(
      fetch(req).catch(()=>new Response(
        JSON.stringify({error:'Funzione online non disponibile: controlla la connessione Internet.'}),
        {status:503,headers:{'Content-Type':'application/json; charset=utf-8'}}
      ))
    );
    return;
  }

  // App navigation: network first so updates arrive immediately, cache fallback offline.
  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req)
        .then(res=>{
          const copy=res.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put('/index.html',copy));
          return res;
        })
        .catch(()=>caches.match('/index.html'))
    );
    return;
  }

  // Own static assets: cache first.
  if(url.origin===self.location.origin){
    event.respondWith(
      caches.match(req).then(hit=>hit || fetch(req).then(res=>{
        if(res && res.ok){
          const copy=res.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(req,copy));
        }
        return res;
      }))
    );
    return;
  }

  // External libraries (OCR/PDF.js): use network, and retain a runtime copy after first use.
  if(url.hostname==='cdnjs.cloudflare.com' || url.hostname==='cdn.jsdelivr.net' || url.hostname==='unpkg.com'){
    event.respondWith(
      caches.match(req).then(hit=>{
        const network=fetch(req).then(res=>{
          if(res && (res.ok || res.type==='opaque')){
            const copy=res.clone();
            caches.open(CACHE_NAME).then(cache=>cache.put(req,copy));
          }
          return res;
        });
        return hit || network;
      })
    );
  }
});
