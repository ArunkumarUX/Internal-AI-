// Draws the app and menu bar icons as PNGs (no image tools needed).
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Coverage (0..1) of a shape, supersampled 4×4 for smooth edges.
const coverage = (x, y, inside) => {
  let hits = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) hits++;
  return hits / 16;
};
// Four-point sparkle: |dx|^p + |dy|^p <= r^p with p < 1 gives concave sides.
const sparkle = (cx, cy, r) => (x, y) => {
  const dx = Math.abs(x - cx) / r, dy = Math.abs(y - cy) / r;
  return Math.pow(dx, 0.55) + Math.pow(dy, 0.55) <= 1;
};
const roundedSquare = (size, inset, radius) => (x, y) => {
  const lo = inset, hi = size - inset;
  if (x < lo || y < lo || x > hi || y > hi) return false;
  const cx = Math.min(Math.max(x, lo + radius), hi - radius);
  const cy = Math.min(Math.max(y, lo + radius), hi - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
};

function appIcon(size) {
  // macOS icon grid: artwork inset ~10% with a large corner radius.
  const inset = size * 0.1, radius = size * 0.2;
  const body = roundedSquare(size, inset, radius);
  const big = sparkle(size * 0.46, size * 0.54, size * 0.25);
  const small = sparkle(size * 0.67, size * 0.33, size * 0.1);
  return png(size, (x, y) => {
    const a = coverage(x, y, body);
    if (!a) return [0, 0, 0, 0];
    const t = (x + y) / (2 * size); // diagonal gradient
    const bg = [Math.round(122 - 55 * t), Math.round(108 - 52 * t), Math.round(252 - 50 * t)];
    const s = Math.max(coverage(x, y, big), coverage(x, y, small));
    const c = bg.map((v) => Math.round(v * (1 - s) + 255 * s));
    return [...c, Math.round(255 * a)];
  });
}

function trayIcon(size) {
  const big = sparkle(size * 0.44, size * 0.56, size * 0.4);
  const small = sparkle(size * 0.78, size * 0.22, size * 0.17);
  return png(size, (x, y) => [0, 0, 0, Math.round(255 * Math.max(coverage(x, y, big), coverage(x, y, small)))]);
}

mkdirSync("build", { recursive: true });
mkdirSync("assets", { recursive: true });
writeFileSync("build/icon.png", appIcon(1024));
writeFileSync("assets/icon.png", appIcon(512));
writeFileSync("assets/trayTemplate.png", trayIcon(18));
writeFileSync("assets/trayTemplate@2x.png", trayIcon(36));
console.log("Icons written to build/ and assets/");
