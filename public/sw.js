/* Chat App service worker: offline app shell + live API calls. */

"use strict";

const VERSION = "chat-app-v1";
const SHELL_CACHE = VERSION + "-shell";
const RUNTIME_CACHE = VERSION + "-runtime";

// The app shell: everything needed to open the app with no network.
const SHELL_ASSETS = [
    "./",
    "./index.html",
    "./register.html",
    "./app.html",
    "./offline.html",
    "./manifest.json",
    "./css/styles.css",
    "./js/validate.js",
    "./js/api.js",
    "./js/login.js",
    "./js/register.js",
    "./js/chat.js",
    "./js/pwa.js",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/apple-touch-icon.png",
    "./icons/favicon-32.png"
];

self.addEventListener("install", function (event) {
    event.waitUntil(
        caches.open(SHELL_CACHE).then(function (cache) {
            // addAll fails the whole install if one file 404s, so add
            // them one by one and ignore individual misses.
            return Promise.all(SHELL_ASSETS.map(function (asset) {
                return cache.add(asset).catch(function () { return null; });
            }));
        }).then(function () {
            return self.skipWaiting();
        })
    );
});

self.addEventListener("activate", function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (key) {
                if (key !== SHELL_CACHE && key !== RUNTIME_CACHE) {
                    return caches.delete(key);
                }
                return null;
            }));
        }).then(function () {
            return self.clients.claim();
        })
    );
});

self.addEventListener("message", function (event) {
    if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

/* ---------- fetch handling ---------- */

function isApiRequest(url) {
    return url.pathname.indexOf("/api/") === 0;
}

self.addEventListener("fetch", function (event) {
    const request = event.request;
    const url = new URL(request.url);

    // Only handle same-origin requests.
    if (url.origin !== self.location.origin) return;

    // API calls are never cached: they are live data and carry auth tokens.
    if (isApiRequest(url)) {
        event.respondWith(fetch(request));
        return;
    }

    // Page navigations: serve the shell from cache, fall back to the network.
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request).then(function (response) {
                const copy = response.clone();
                caches.open(SHELL_CACHE).then(function (cache) {
                    cache.put(request, copy);
                });
                return response;
            }).catch(function () {
                return caches.match(request).then(function (cached) {
                    return cached || caches.match("./index.html") || caches.match("./offline.html");
                });
            })
        );
        return;
    }

    // Static assets: cache first, then refresh in the background.
    event.respondWith(
        caches.match(request).then(function (cached) {
            if (cached) {
                const network = fetch(request).then(function (response) {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches.open(RUNTIME_CACHE).then(function (cache) {
                            cache.put(request, copy);
                        });
                    }
                    return response;
                }).catch(function () { return cached; });
                return cached;
            }

            return fetch(request).then(function (response) {
                if (response && response.ok) {
                    const copy = response.clone();
                    caches.open(RUNTIME_CACHE).then(function (cache) {
                        cache.put(request, copy);
                    });
                }
                return response;
            }).catch(function () {
                // Only a page navigation can fall back to the offline page;
                // a missing script or image must not be answered with HTML.
                if (request.mode === "navigate") {
                    return caches.match("./offline.html");
                }
                return new Response("", { status: 503, statusText: "Offline" });
            });
        })
    );
});
