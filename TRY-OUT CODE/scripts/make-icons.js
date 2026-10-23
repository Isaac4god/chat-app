/* Generates the PWA icon set as PNG files, with no external dependencies. */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT_DIR = path.join(__dirname, "..", "public", "icons");

/* ---------- minimal PNG writer ---------- */

const CRC_TABLE = (function () {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    return table;
})();

function crc32(buffer) {
    let crc = -1;
    for (let i = 0; i < buffer.length; i += 1) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const head = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head, data])), 0);
    return Buffer.concat([length, head, data, crc]);
}

function writePng(file, size, pixels) {
    const raw = Buffer.alloc(size * (size * 4 + 1));
    let offset = 0;
    for (let y = 0; y < size; y += 1) {
        raw[offset] = 0;
        offset += 1;
        pixels.copy(raw, offset, y * size * 4, (y + 1) * size * 4);
        offset += size * 4;
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // truecolour with alpha
    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0))
    ]);
    fs.writeFileSync(file, png);
}

/* ---------- shape helpers (unit coordinates, 0..1) ---------- */

function circle(x, y, cx, cy, radius) {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
}

function roundedRect(x, y, left, top, right, bottom, radius) {
    const cx = Math.min(Math.max(x, left + radius), right - radius);
    const cy = Math.min(Math.max(y, top + radius), bottom - radius);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
}

// Signed area test: is the point inside the triangle a-b-c?
function inTriangle(x, y, a, b, c) {
    const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
    const d1 = sign([x, y], a, b);
    const d2 = sign([x, y], b, c);
    const d3 = sign([x, y], c, a);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(hasNeg && hasPos);
}


/* ---------- the icon artwork ---------- */

// A speech bubble on the brand gradient, matching the app's accent colours.
function shade(u, v, maskable) {
    // Background: rounded square, or full bleed for maskable icons.
    let bgAlpha = 0;
    if (maskable) {
        bgAlpha = 255;
    } else if (roundedRect(u, v, 0.0, 0.0, 1.0, 1.0, 0.22)) {
        bgAlpha = 255;
    }

    // Gradient from #4f7dff to #6d5cf6, diagonally.
    const t = Math.min(1, Math.max(0, (u + v) / 2));
    const r = Math.round(0x4f + (0x6d - 0x4f) * t);
    const g = Math.round(0x7d + (0x5c - 0x7d) * t);
    const b = Math.round(0xff + (0xf6 - 0xff) * t);

    // Bubble body, plus a tail under the lower-left corner.
    const inBody = roundedRect(u, v, 0.20, 0.22, 0.80, 0.66, 0.13);
    const inTail = inTriangle(u, v, [0.30, 0.64], [0.46, 0.64], [0.27, 0.82]);

    // Three dots inside the bubble.
    const dotY = 0.44;
    const inDots =
        circle(u, v, 0.375, dotY, 0.052) ||
        circle(u, v, 0.500, dotY, 0.052) ||
        circle(u, v, 0.625, dotY, 0.052);

    if (!inBody && !inTail && !inDots) {
        return [r, g, b, bgAlpha];
    }

    // White artwork.
    return [255, 255, 255, bgAlpha];
}



/* ---------- main ---------- */

function render(size, maskable) {
    const pixels = Buffer.alloc(size * size * 4);
    for (let py = 0; py < size; py += 1) {
        for (let px = 0; px < size; px += 1) {
            // Sample the centre of each pixel.
            const u = (px + 0.5) / size;
            const v = (py + 0.5) / size;
            const colour = shade(u, v, maskable);
            const offset = (py * size + px) * 4;
            pixels[offset] = colour[0];
            pixels[offset + 1] = colour[1];
            pixels[offset + 2] = colour[2];
            pixels[offset + 3] = colour[3];
        }
    }
    return pixels;
}

function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const targets = [
        { file: "icon-192.png", size: 192, maskable: false },
        { file: "icon-512.png", size: 512, maskable: false },
        { file: "icon-maskable-192.png", size: 192, maskable: true },
        { file: "icon-maskable-512.png", size: 512, maskable: true },
        { file: "apple-touch-icon.png", size: 180, maskable: false },
        { file: "favicon-32.png", size: 32, maskable: false }
    ];

    targets.forEach(function (target) {
        const pixels = render(target.size, target.maskable);
        writePng(path.join(OUT_DIR, target.file), target.size, pixels);
        console.log("wrote " + target.file + " (" + target.size + "x" + target.size + ")");
    });
}

main();
