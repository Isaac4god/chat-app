/* Verifies the PWA in a real browser: service worker registration, manifest
   parsing, offline behaviour, cache freshness and the mobile layout. Uses the
   Chrome DevTools Protocol over the debugging port, so no extra packages are
   needed.

   Run it with the server up:  node server.js   (in another terminal)
                       then:  node test-browser-pwa.js                          */

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const EDGE_CANDIDATES = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];

const BASE = "http://localhost:3000";
const PORT = 9222;
const MOBILE_WIDTH = 380;

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
    if (condition) {
        passed += 1;
        console.log("PASS  " + label);
    } else {
        failed += 1;
        console.log("FAIL  " + label + (detail ? " -> " + detail : ""));
    }
}

function findBrowser() {
    return EDGE_CANDIDATES.find(function (p) { return fs.existsSync(p); });
}

function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

function getJson(url) {
    return new Promise(function (resolve, reject) {
        http.get(url, function (res) {
            let raw = "";
            res.on("data", function (c) { raw += c; });
            res.on("end", function () {
                try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
            });
        }).on("error", reject);
    });
}

// Calls the chat API, optionally with a session token.
function api(method, pathname, body, token) {
    return new Promise(function (resolve, reject) {
        const payload = body ? JSON.stringify(body) : null;
        const headers = { "Content-Type": "application/json" };
        if (token) headers["X-Session-Token"] = token;
        if (payload) headers["Content-Length"] = Buffer.byteLength(payload);

        const req = http.request(BASE + pathname, { method: method, headers: headers }, function (res) {
            let raw = "";
            res.on("data", function (c) { raw += c; });
            res.on("end", function () {
                let parsed = null;
                try { parsed = JSON.parse(raw); } catch (e) { parsed = raw; }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

// Reads the cache version straight from the service worker, so this test
// does not have to be changed every time the version is bumped.
function shellCacheName() {
    const sw = fs.readFileSync(path.join(__dirname, "public", "sw.js"), "utf8");
    const version = sw.match(/VERSION\s*=\s*"([^"]+)"/);
    return version ? version[1] + "-shell" : "shell";
}

function runtimeCacheName() {
    const sw = fs.readFileSync(path.join(__dirname, "public", "sw.js"), "utf8");
    const version = sw.match(/VERSION\s*=\s*"([^"]+)"/);
    return version ? version[1] + "-runtime" : "runtime";
}

/* ---------- CDP client ---------- */

class Cdp {
    constructor(ws) {
        this.ws = ws;
        this.id = 0;
        this.pending = new Map();
        this.events = [];
        const self = this;
        ws.addEventListener("message", function (event) {
            const msg = JSON.parse(event.data);
            if (msg.id && self.pending.has(msg.id)) {
                const entry = self.pending.get(msg.id);
                self.pending.delete(msg.id);
                if (msg.error) entry.reject(new Error(msg.error.message));
                else entry.resolve(msg.result);
            } else if (msg.method) {
                self.events.push(msg);
            }
        });
    }

    send(method, params) {
        const self = this;
        return new Promise(function (resolve, reject) {
            const id = ++self.id;
            self.pending.set(id, { resolve: resolve, reject: reject });
            self.ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
        });
    }

    async evaluate(expression) {
        const result = await this.send("Runtime.evaluate", {
            expression: expression,
            awaitPromise: true,
            returnByValue: true
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.text || "evaluate failed");
        }
        return result.result.value;
    }
}
/* ---------- Browser side snippets ---------- */

// Measures the horizontal overflow and names the elements that cause it, so a
// failure points straight at the guilty rule.
const LAYOUT = "(function () {" +
    "  var vw = window.innerWidth;" +
    "  var offenders = [];" +
    "  var all = document.querySelectorAll('body *');" +
    "  for (var i = 0; i < all.length; i++) {" +
    "    var node = all[i];" +
    "    var rect = node.getBoundingClientRect();" +
    "    if (rect.width === 0 && rect.height === 0) continue;" +
    "    if (rect.right > vw + 0.5 || rect.left < -0.5) {" +
    "      offenders.push(node.tagName.toLowerCase() +" +
    "        (node.id ? '#' + node.id : '') +" +
    "        (node.className ? '.' + String(node.className).trim().split(/\\s+/).join('.') : '') +" +
    "        ' [' + Math.round(rect.left) + '..' + Math.round(rect.right) + ']');" +
    "    }" +
    "  }" +
    "  var docSW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);" +
    "  return { vw: vw, overflow: docSW - vw, offenders: offenders.slice(0, 6) };" +
    "}())";

// Lists the URL of every entry in every cache, grouped by cache name.
const CACHE_URLS = "(function () {" +
    "  return caches.keys().then(function (names) {" +
    "    return Promise.all(names.map(function (name) {" +
    "      return caches.open(name).then(function (cache) {" +
    "        return cache.keys().then(function (keys) {" +
    "          return { name: name, urls: keys.map(function (k) { return k.url; }) };" +
    "        });" +
    "      });" +
    "    })).then(function (groups) { return groups; });" +
    "  });" +
    "}())";

// Reads one file out of a cache.
function cachedText(cacheName, pathname) {
    return "caches.open(" + JSON.stringify(cacheName) + ")" +
        ".then(function (c) { return c.match(" + JSON.stringify(pathname) + "); })" +
        ".then(function (r) { return r ? r.text() : ''; })";
}

// Finds the service worker target of the app.
async function findServiceWorkerTarget() {
    const targets = await getJson("http://127.0.0.1:" + PORT + "/json/list");
    return targets.find(function (t) {
        return t.type === "service_worker" && /\/sw\.js$/.test(t.url);
    }) || null;
}

// Opens a second DevTools session on the service worker. The worker runs its
// own network requests, so the connection has to be cut for the worker as
// well, not just for the page.
async function attachServiceWorker(target) {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(function (resolve, reject) {
        ws.addEventListener("open", resolve);
        ws.addEventListener("error", reject);
    });
    const worker = new Cdp(ws);
    await worker.send("Network.enable");
    return worker;
}
async function main() {
    const browser = findBrowser();
    if (!browser) {
        console.log("SKIP  no Chrome/Edge found - browser checks skipped");
        process.exit(0);
    }
    console.log("Using browser: " + browser + "\n");

    // A real account with a real conversation, so the chat page is measured
    // with real content in it instead of an empty shell.
    const stamp = Date.now();
    const email = "pwa" + stamp + "@gmail.com";
    const peerEmail = "pwapeer" + stamp + "@gmail.com";
    await api("POST", "/api/register", { fullName: "Pwa Tester", email: email, password: "pass1234" });
    await api("POST", "/api/register", {
        fullName: "Bartholomew Featherstonehaugh", email: peerEmail, password: "pass1234"
    });
    const login = await api("POST", "/api/login", { email: email, password: "pass1234" });
    const peerLogin = await api("POST", "/api/login", { email: peerEmail, password: "pass1234" });
    if (!login.body || !login.body.token) {
        throw new Error("could not sign in: " + JSON.stringify(login.body));
    }
    const token = login.body.token;
    await api("POST", "/api/messages", {
        to: email,
        text: "A deliberately long message that must not blow out the layout on a narrow phone, " +
              "not even when it runs on and on and on and on and on and on."
    }, peerLogin.body.token);

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pwa-profile-"));
    const child = spawn(browser, [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--remote-debugging-port=" + PORT,
        "--user-data-dir=" + profile,
        "about:blank"
    ], { stdio: "ignore" });

    let cdp = null;
    let worker = null;
    try {
        // Wait for the debugging endpoint to come up.
        let targets = null;
        for (let i = 0; i < 40; i += 1) {
            try {
                targets = await getJson("http://127.0.0.1:" + PORT + "/json/list");
                if (targets && targets.length) break;
            } catch (error) { /* not up yet */ }
            await sleep(250);
        }
        if (!targets || !targets.length) throw new Error("browser debug port never opened");

        const page = targets.find(function (t) { return t.type === "page"; }) || targets[0];
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(function (resolve, reject) {
            ws.addEventListener("open", resolve);
            ws.addEventListener("error", reject);
        });
        Cdp.self = cdp = new Cdp(ws);

        await cdp.send("Page.enable");
        await cdp.send("Runtime.enable");

        /* --- 1. The page loads and the service worker registers --- */
        await cdp.send("Page.navigate", { url: BASE + "/index.html" });
        await sleep(3000);

        const swState = await cdp.evaluate(
            "navigator.serviceWorker.getRegistration().then(function (r) {" +
            "  return r ? (r.active ? 'active' : (r.installing ? 'installing' : 'waiting')) : 'none';" +
            "})"
        );
        check("service worker registers", swState === "active" || swState === "installing", swState);
/* --- 2. The manifest is fetched and parsed by the browser --- */
        const manifestInfo = await cdp.evaluate(
            "fetch('manifest.json').then(function (r) { return r.json(); }).then(function (m) {" +
            "  return { name: m.name, icons: (m.icons || []).length, display: m.display };" +
            "})"
        );
        check("browser parses the manifest", manifestInfo && manifestInfo.name === "Chat App", JSON.stringify(manifestInfo));
        check("manifest declares standalone display", manifestInfo && manifestInfo.display === "standalone");
        check("manifest lists icons to the browser", manifestInfo && manifestInfo.icons >= 4);

        /* --- 3. The app shell is cached, so the page opens offline --- */
        const cached = await cdp.evaluate(
            "caches.open(" + JSON.stringify(shellCacheName()) + ")" +
            ".then(function (c) { return c.keys(); })" +
            ".then(function (keys) { return keys.map(function (k) { return new URL(k.url).pathname; }); })"
        );
        check("app shell is cached", Array.isArray(cached) && cached.length > 5, "cached: " + (cached || []).length);
        check("login page is cached", Array.isArray(cached) && cached.indexOf("/index.html") !== -1);
        check("styles are cached", Array.isArray(cached) && cached.some(function (p) { return p.indexOf("/css/styles.css") !== -1; }));
        check("the app script is cached", Array.isArray(cached) && cached.some(function (p) { return p.indexOf("/js/chat.js") !== -1; }));

        /* --- 4. The icons load --- */
        const iconOk = await cdp.evaluate(
            "fetch('icons/icon-192.png').then(function (r) { return r.ok && r.headers.get('content-type') === 'image/png'; })"
        );
        check("icon is served as a real PNG", iconOk === true);

        const appleOk = await cdp.evaluate(
            "fetch('icons/apple-touch-icon.png').then(function (r) { return r.ok && r.headers.get('content-type') === 'image/png'; })"
        );
        check("the apple touch icon is a real PNG", appleOk === true);

        // Every page must point at the apple touch icon.
        const appleLinked = await cdp.evaluate(
            "(function () {" +
            "  var pages = ['index.html', 'register.html', 'app.html', 'offline.html'];" +
            "  var missing = [];" +
            "  return Promise.all(pages.map(function (page) {" +
            "    return fetch(page).then(function (r) { return r.text(); }).then(function (html) {" +
            "      if (html.indexOf('rel=\"apple-touch-icon\"') === -1) missing.push(page);" +
            "    });" +
            "  })).then(function () { return missing; });" +
            "}())"
        );
        check("every page uses the apple touch icon", Array.isArray(appleLinked) && appleLinked.length === 0,
            (appleLinked || []).join(", "));
/* --- 5. A second visit lets the worker serve and refresh the shell --- */
        await cdp.send("Page.navigate", { url: BASE + "/index.html" });
        await sleep(2500);

        // A refreshed file has to land in the cache that already holds it.
        // A second copy in another cache is shadowed by the old one, so the
        // browser would keep serving the previous release for ever.
        const groups = await cdp.evaluate(CACHE_URLS);
        const shellUrls = (groups.find(function (g) { return g.name === shellCacheName(); }) || { urls: [] }).urls;
        const runtimeUrls = (groups.find(function (g) { return g.name === runtimeCacheName(); }) || { urls: [] }).urls;
        const shadowed = runtimeUrls.filter(function (url) { return shellUrls.indexOf(url) !== -1; });
        check("no cached file is stored twice", shadowed.length === 0, shadowed.join(", "));

        // The precached stylesheet must be the file that is on disk now.
        const cssOnDisk = fs.readFileSync(path.join(__dirname, "public", "css", "styles.css"), "utf8");
        const cssCached = await cdp.evaluate(cachedText(shellCacheName(), "/css/styles.css"));
        check("the precached stylesheet is the current one", cssCached === cssOnDisk,
            "cached " + cssCached.length + " bytes, on disk " + cssOnDisk.length + " bytes");

        /* --- 6. Offline: the page is served by the service worker --- */
        // The worker has a network of its own, so the connection has to be
        // cut for the worker as well, not just for the page.
        const swTarget = await findServiceWorkerTarget();
        if (swTarget) {
            worker = await attachServiceWorker(swTarget);
            await worker.send("Network.emulateNetworkConditions", {
                offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1
            });
        } else {
            console.log("NOTE  no service worker target found - the offline checks are weaker");
        }
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", {
            offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1
        });

        await cdp.send("Page.navigate", { url: BASE + "/app.html" });
        await sleep(2500);

        // The navigation response must come from the service worker cache.
        const navEvents = cdp.events.filter(function (e) {
            return e.method === "Network.responseReceived" &&
                e.params.type === "Document" &&
                e.params.response.url.indexOf("app.html") !== -1;
        });
        const fromWorker = navEvents.some(function (e) { return e.params.response.fromServiceWorker === true; });
        check("app page is served by the service worker while offline", fromWorker,
            "navigation responses: " + navEvents.length);

        /* --- 7. API responses are never cached --- */
        const apiCached = await cdp.evaluate(
            "caches.keys().then(function (names) {" +
            "  return Promise.all(names.map(function (n) {" +
            "    return caches.open(n).then(function (c) { return c.keys(); });" +
            "  })).then(function (all) {" +
            "    var urls = [];" +
            "    all.forEach(function (list) { list.forEach(function (k) { urls.push(k.url); }); });" +
            "    return urls.filter(function (u) { return u.indexOf('/api/') !== -1; });" +
            "  });" +
            "})"
        );
        check("no API responses are cached", Array.isArray(apiCached) && apiCached.length === 0, JSON.stringify(apiCached));

        /* --- 8. The worker survives a network error --- */
        const offlineStatus = await cdp.evaluate(
            "fetch('/icons/not-in-the-shell-' + Date.now() + '.png')" +
            ".then(function (r) { return r.status; })" +
            ".catch(function (e) { return 'rejected: ' + e.message; })"
        );
        check("the worker answers instead of failing when the network is gone",
            offlineStatus === 503, "status: " + offlineStatus);

        await cdp.send("Network.emulateNetworkConditions", {
            offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1
        });
        if (worker) {
            await worker.send("Network.emulateNetworkConditions", {
                offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1
            }).catch(function () { /* the worker may already be gone */ });
        }
/* --- 9. Layout: no horizontal overflow on any page --- */
        await cdp.send("Emulation.setDeviceMetricsOverride", {
            width: MOBILE_WIDTH, height: 720, deviceScaleFactor: 1, mobile: true
        });

        for (const page of ["/index.html", "/register.html", "/offline.html", "/app.html"]) {
            if (page === "/app.html") {
                // Sign in first, so the chat page is measured with a real
                // conversation in it.
                await cdp.send("Page.navigate", { url: BASE + "/index.html" });
                await sleep(900);
                await cdp.evaluate("localStorage.setItem('chat.session', " + JSON.stringify(token) + ")");
            }
            await cdp.send("Page.navigate", { url: BASE + page });
            await sleep(1600);

            if (page === "/app.html") {
                await cdp.evaluate(
                    "(function () {" +
                    "  var item = document.querySelector('#conversationList li');" +
                    "  if (item) item.click();" +
                    "  return !!item;" +
                    "}())"
                );
                await sleep(1200);
                const thread = await cdp.evaluate(
                    "(function () {" +
                    "  return { conversations: document.querySelectorAll('#conversationList li').length," +
                    "           bubbles: document.querySelectorAll('.bubble').length };" +
                    "}())"
                );
                check("the chat page renders a real conversation",
                    thread.conversations > 0 && thread.bubbles > 0, JSON.stringify(thread));
            }

            const layout = await cdp.evaluate(LAYOUT);
            check(page + " has no horizontal overflow", layout.overflow <= 0,
                "overflow: " + layout.overflow + "px" +
                (layout.offenders.length ? " (" + layout.offenders.join(", ") + ")" : ""));

            const card = await cdp.evaluate(
                "(function () {" +
                "  var card = document.querySelector('.auth-card');" +
                "  if (!card) return null;" +
                "  var rect = card.getBoundingClientRect();" +
                "  return { left: Math.round(rect.left), right: Math.round(rect.right)," +
                "           width: Math.round(rect.width), vw: window.innerWidth };" +
                "}())"
            );
            if (card) {
                check(page + " card fits the viewport",
                    card.left >= 0 && card.right <= card.vw,
                    JSON.stringify(card));
            }
        }

        /* --- 10. The install banner and the update note fit as well --- */
        const overlay = await cdp.evaluate(
            "(function () {" +
            "  var banner = document.getElementById('installBanner');" +
            "  var note = document.getElementById('updateNote');" +
            "  if (banner) banner.classList.remove('hidden');" +
            "  if (note) note.classList.remove('hidden');" +
            "  var vw = window.innerWidth;" +
            "  var bad = [];" +
            "  [banner, note].forEach(function (el) {" +
            "    if (!el) return;" +
            "    var r = el.getBoundingClientRect();" +
            "    if (r.right > vw + 0.5 || r.left < -0.5) {" +
            "      bad.push((el.id || '?') + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');" +
            "    }" +
            "  });" +
            "  return { vw: vw, bad: bad };" +
            "}())"
        );
        check("the install banner and update note fit the viewport", overlay.bad.length === 0,
            JSON.stringify(overlay));

        await cdp.send("Emulation.clearDeviceMetricsOverride");

        /* --- 11. No console errors on a normal page load --- */
        const errors = cdp.events
            .filter(function (e) { return e.method === "Runtime.exceptionThrown"; })
            .map(function (e) { return JSON.stringify(e.params.exceptionDetails.text); });
        check("no uncaught JavaScript errors", errors.length === 0, errors.join(" | "));
    } finally {
        if (cdp) { try { cdp.ws.close(); } catch (e) { /* ignore */ } }
        if (worker) { try { worker.ws.close(); } catch (e) { /* ignore */ } }
        child.kill();
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }

    console.log("\n" + passed + " passed, " + failed + " failed");
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (error) {
    console.error("Test crashed:", error);
    process.exit(1);
});
