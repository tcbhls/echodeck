// EchoDeck 离线 PWA Service Worker：支持 App Shell 离线启动与局域网同步后的音视频/图片缓存（含 Range 206 离线拖拽支持）

const APP_CACHE = "echodeck-shell-v10";
const MEDIA_CACHE = "echodeck-media-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(["./", "./index.html", "./manifest.webmanifest", "./icon.png"]).catch(() => undefined))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_CACHE && k !== MEDIA_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// 为离线缓存的音视频提供 HTTP Range 206 切片响应，确保 iOS/Android 离线状态下照样丝滑 A-B 复读与拖动进度条
async function buildRangeResponse(request, cachedResponse) {
  const rangeHeader = request.headers.get("range");
  if (!rangeHeader) return cachedResponse;
  const buf = await cachedResponse.arrayBuffer();
  const total = buf.byteLength;
  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  if (!match) return cachedResponse;

  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
  if (start >= total || start > end) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${total}` },
    });
  }

  const sliced = buf.slice(start, end + 1);
  const headers = new Headers(cachedResponse.headers);
  headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  headers.set("Content-Length", String(sliced.byteLength));
  headers.set("Accept-Ranges", "bytes");

  return new Response(sliced, {
    status: 206,
    statusText: "Partial Content",
    headers,
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API 请求永远走网络（由前端 IndexedDB 处理离线回退）
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
    return;
  }

  // 媒体静态文件：优先命中离线同步缓存（零流量秒开），未命中则走网络
  if (url.pathname.startsWith("/files/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MEDIA_CACHE);
        const cached = await cache.match(url.pathname);
        if (cached) {
          return buildRangeResponse(request, cached);
        }
        return fetch(request);
      })()
    );
    return;
  }

  // 页面导航与静态前端资源：网络优先并自动刷新离线 Shell 缓存，断网即秒出离线 App
  event.respondWith(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      try {
        const networkResp = await fetch(request);
        if (networkResp && networkResp.status === 200) {
          cache.put(request, networkResp.clone());
        }
        return networkResp;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const fallback = await cache.match("/index.html");
          if (fallback) return fallback;
        }
        return new Response("Offline", { status: 503 });
      }
    })()
  );
});
