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

// A last-resort answer for a page that is neither cached nor reachable, so
// the worker always has something to respond with instead of failing.
const OFFLINE_FALLBACK = "<!doctype html><meta charset=\"utf-8\">" +
    "<title>Offline - Chat App</title>" +
    "<p style=\"font-family:sans-serif;text-align:center;padding:40px\">" +
    "You are offline. <a href=\"./index.html\">Open the chat app</a>.</p>";

self.addEventListener("install", function (event) {
    event.waitUntil(
        caches.open(SHELL_CACHE).then(function (cache) {
            // addAll fails the whole install if one file 404s, so add
            // them one by one and ignore individual misses. The "reload"
            // cache mode bypasses the HTTP cache, so a new release never
            // precaches a stale copy of a file.
            return Promise.all(SHELL_ASSETS.map(function (asset) {
                return cache.add(new Request(asset, { cache: "reload" }))
                    .catch(function () { return null; });
            }));
        }).then(function () {
            return self.skipWaiting();
        }).catch(function (error) {
            console.warn("Could not precache the app shell", error);
        })
    );
});

self.addEventListener("activate", function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (key) {
                if (key !== SHELL_CACHE && key !== RUNTIME_CACHE) {
                    return caches.delete(key).catch(function () { return false; });
                }
                return null;
            }));
        }).then(function () {
            return self.clients.claim();
        }).catch(function (error) {
            console.warn("Could not clean up the old caches", error);
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

// A cache lookup that never rejects: a failed lookup is simply a miss.
function lookup(cacheName, request) {
    return caches.open(cacheName)
        .then(function (cache) { return cache.match(request); })
        .catch(function () { return undefined; });
}

// Finds an entry in the shell cache first, then in the runtime cache.
function findAsset(request) {
    return lookup(SHELL_CACHE, request).then(function (hit) {
        if (hit) return { hit: hit, cache: SHELL_CACHE };
        return lookup(RUNTIME_CACHE, request).then(function (runtimeHit) {
            return { hit: runtimeHit, cache: RUNTIME_CACHE };
        });
    });
}

// Writes a fresh copy back into the cache that already holds the asset.
// Refreshing "the cache that holds it" matters: the shell cache is searched
// first, so a copy parked in the runtime cache would be shadowed by the old
// one and the browser would keep serving the previous release for ever.
function refreshAsset(cacheName, request, response) {
    // The clone has to be taken while the body is still untouched, so it must
    // happen before the response is handed to the page.
    var copy;
    try {
        copy = response.clone();
    } catch (error) {
        return;
    }
    caches.open(cacheName)
        .then(function (cache) { return cache.put(request, copy); })
        .catch(function () { /* the cached copy stays in use */ });
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
                refreshAsset(SHELL_CACHE, request, response);
                return response;
            }).catch(function () {
                return findAsset(request).then(function (found) {
                    if (found.hit) return found.hit;
                    return lookup(SHELL_CACHE, "./index.html").then(function (fallback) {
                        if (fallback) return fallback;
                        return lookup(SHELL_CACHE, "./offline.html").then(function (offline) {
                            return offline || new Response(OFFLINE_FALLBACK, {
                                status: 503,
                                headers: { "Content-Type": "text/html; charset=utf-8" }
                            });
                        });
                    });
                });
            })
        );
        return;
    }

    // Static assets: cache first, then refresh in the background.
    event.respondWith(
        findAsset(request).then(function (found) {
            if (found.hit) {
                fetch(request).then(function (response) {
                    if (response && response.ok) refreshAsset(found.cache, request, response);
                }).catch(function () { /* keep the cached copy */ });
                return found.hit;
            }

            return fetch(request).then(function (response) {
                if (response && response.ok) refreshAsset(RUNTIME_CACHE, request, response);
                return response;
            }).catch(function () {
                // Only a page navigation can fall back to the offline page;
                // a missing script or image must not be answered with HTML.
                if (request.mode === "navigate") {
                    return lookup(SHELL_CACHE, "./offline.html").then(function (offline) {
                        return offline || new Response("", { status: 503, statusText: "Offline" });
                    });
                }
                return new Response("", { status: 503, statusText: "Offline" });
            });
        })
    );
});
