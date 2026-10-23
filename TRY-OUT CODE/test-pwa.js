/* Checks the PWA pieces: manifest, icons, service worker and the HTML links. */

const fs = require("fs");
const path = require("path");

const PUBLIC = path.join(__dirname, "public");
let problems = 0;

function check(label, condition, detail) {
    if (condition) {
        console.log("PASS  " + label);
    } else {
        problems += 1;
        console.log("FAIL  " + label + (detail ? " -> " + detail : ""));
    }
}

function read(file) {
    return fs.readFileSync(path.join(PUBLIC, file), "utf8");
}

function exists(file) {
    return fs.existsSync(path.join(PUBLIC, file));
}

/* ---------- manifest ---------- */

const manifest = JSON.parse(read("manifest.json"));

check("manifest has a name", typeof manifest.name === "string" && manifest.name.length > 0);
check("manifest has a short_name", typeof manifest.short_name === "string" && manifest.short_name.length > 0);
check("manifest display is standalone", manifest.display === "standalone", manifest.display);
check("manifest has a theme colour", /^#[0-9a-f]{6}$/i.test(manifest.theme_color || ""), manifest.theme_color);
check("manifest has a background colour", /^#[0-9a-f]{6}$/i.test(manifest.background_color || ""), manifest.background_color);
check("manifest has a start_url", typeof manifest.start_url === "string" && manifest.start_url.length > 0);
check("manifest has a scope", typeof manifest.scope === "string" && manifest.scope.length > 0);

const icons = manifest.icons || [];
check("manifest lists at least 2 icons", icons.length >= 2, "count " + icons.length);
check(
    "manifest has a 192x192 icon",
    icons.some(function (i) { return i.sizes === "192x192"; })
);
check(
    "manifest has a 512x512 icon",
    icons.some(function (i) { return i.sizes === "512x512"; })
);
check(
    "manifest has a maskable icon",
    icons.some(function (i) { return (i.purpose || "").indexOf("maskable") !== -1; })
);

icons.forEach(function (icon) {
    check("icon file exists: " + icon.src, exists(icon.src));
    if (icon.src.endsWith(".png")) {
        const data = fs.readFileSync(path.join(PUBLIC, icon.src));
        // PNG signature.
        const isPng = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
        check("icon is a real PNG: " + icon.src, isPng);
    }
});

/* ---------- service worker ---------- */

const sw = read("sw.js");
check("service worker caches a shell", sw.indexOf("SHELL_ASSETS") !== -1);
check("service worker skips API caching", sw.indexOf("isApiRequest") !== -1);
check("service worker handles install", sw.indexOf('addEventListener("install"') !== -1);
check("service worker handles activate", sw.indexOf('addEventListener("activate"') !== -1);
check("service worker handles fetch", sw.indexOf('addEventListener("fetch"') !== -1);
check("service worker has a cache version", /VERSION\s*=\s*"[^"]+"/.test(sw));

// Every shell asset the worker lists must actually exist.
const shellMatch = sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
if (shellMatch) {
    const assets = shellMatch[1].match(/"([^"]+)"/g).map(function (s) { return s.replace(/"/g, ""); });
    let missing = 0;
    assets.forEach(function (asset) {
        if (asset === "./") return;
        const relative = asset.replace(/^\.\//, "");
        if (!exists(relative)) {
            console.log("FAIL  shell asset missing: " + asset);
            missing += 1;
        }
    });
    check("all shell assets exist", missing === 0, missing + " missing");
    console.log(assets.length + " shell assets checked");
} else {
    check("shell asset list found", false);
}

/* ---------- HTML links ---------- */

["index.html", "register.html", "app.html"].forEach(function (file) {
    const html = read(file);
    check(file + " links the manifest", html.indexOf('rel="manifest"') !== -1);
    check(file + " has a theme colour", html.indexOf('name="theme-color"') !== -1);
    check(file + " has an apple touch icon", html.indexOf('rel="apple-touch-icon"') !== -1);
    check(file + " loads the pwa script", html.indexOf("js/pwa.js") !== -1);
    check(file + " loads the manifest link target", html.indexOf('href="manifest.json"') !== -1);
});

check("offline page exists", exists("offline.html"));
check("pwa script exists", exists("js/pwa.js"));

console.log(problems === 0 ? "\nOK - PWA checks passed" : "\n" + problems + " problems found");
process.exit(problems > 0 ? 1 : 0);
