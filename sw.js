const CACHE="asta-mantra-v1.42.2";
const ASSETS=["./","./index.html","./styles.css?v=1.42.2","./app.js?v=1.42.2","./players.js?v=1.42.2","./formations.js?v=1.42.2","./market.js?v=1.42.2","./listone-current.json","./manifest.webmanifest","./icon-192.png","./icon-512.png","./apple-touch-icon.png","./favicon-32.png"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  if(url.pathname.endsWith("/listone-current.json")){
    event.respondWith(fetch(event.request,{cache:"no-store"}).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put("./listone-current.json",copy))}
      return response;
    }).catch(()=>caches.match("./listone-current.json")));
    return;
  }
  if(event.request.mode==="navigate"){
    event.respondWith(fetch(event.request).then(response=>{
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put("./index.html",copy));return response;
    }).catch(()=>caches.match("./index.html")));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
  })));
});
