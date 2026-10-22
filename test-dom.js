/* Checks that every getElementById in the browser scripts exists in the HTML. */

const fs = require("fs");
const path = require("path");

const PUBLIC = path.join(__dirname, "public");
const pairs = [
    ["index.html", "js/login.js"],
    ["register.html", "js/register.js"],
    ["app.html", "js/chat.js"],
    ["index.html", "js/pwa.js"],
    ["app.html", "js/pwa.js"]
];

let problems = 0;

pairs.forEach(function (pair) {
    const html = fs.readFileSync(path.join(PUBLIC, pair[0]), "utf8");
    const js = fs.readFileSync(path.join(PUBLIC, pair[1]), "utf8");

    const htmlIds = new Set();
    const idPattern = /id="([^"]+)"/g;
    let match;
    while ((match = idPattern.exec(html)) !== null) htmlIds.add(match[1]);

    const used = new Set();
    const usePattern = /getElementById\("([^"]+)"\)/g;
    while ((match = usePattern.exec(js)) !== null) used.add(match[1]);

    used.forEach(function (id) {
        if (!htmlIds.has(id)) {
            console.log("MISSING in " + pair[0] + ": #" + id);
            problems += 1;
        }
    });

    console.log(pair[0] + ": " + used.size + " ids checked, " + htmlIds.size + " ids in markup");
});

// Every script tag must point at a file that exists.
const scripts = [];
["index.html", "register.html", "app.html"].forEach(function (file) {
    const html = fs.readFileSync(path.join(PUBLIC, file), "utf8");
    const pattern = /<script src="([^"]+)"><\/script>/g;
    let match;
    while ((match = pattern.exec(html)) !== null) scripts.push(match[1]);
});

scripts.forEach(function (src) {
    if (!fs.existsSync(path.join(PUBLIC, src))) {
        console.log("MISSING script file: " + src);
        problems += 1;
    }
});
console.log(scripts.length + " script references checked");

// Stylesheet links must exist too.
["index.html", "register.html", "app.html"].forEach(function (file) {
    const html = fs.readFileSync(path.join(PUBLIC, file), "utf8");
    const pattern = /<link rel="stylesheet" href="([^"]+)">/g;
    let match;
    while ((match = pattern.exec(html)) !== null) {
        if (!fs.existsSync(path.join(PUBLIC, match[1]))) {
            console.log("MISSING stylesheet: " + match[1]);
            problems += 1;
        }
    }
});

console.log(problems === 0 ? "\nOK - no missing references" : "\n" + problems + " problems found");
process.exit(problems > 0 ? 1 : 0);
