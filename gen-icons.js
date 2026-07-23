// 无依赖生成 PWA 图标（纯 Node，raw 像素 + zlib + PNG 分块）
// 蓝色渐变背景 + 白色浪纹，运行一次即可：node gen-icons.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function makePNG(size) {
  const W = size, H = size;
  // RGBA 像素
  const px = Buffer.alloc(W * H * 4);
  const cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // 垂直渐变：上 #0ea5e9 -> 下 #0369a1
      const t = y / H;
      let r = Math.round(14 + (3 - 14) * t);
      let g = Math.round(165 + (105 - 165) * t);
      let b = Math.round(233 + (161 - 233) * t);
      // 圆角遮罩
      const radius = size * 0.22;
      const inCorner =
        (x < radius && y < radius && dist(x, y, radius, radius) > radius) ||
        (x > W - radius && y < radius && dist(x, y, W - radius, radius) > radius) ||
        (x < radius && y > H - radius && dist(x, y, radius, H - radius) > radius) ||
        (x > W - radius && y > H - radius && dist(x, y, W - radius, H - radius) > radius);
      let a = inCorner ? 0 : 255;

      // 白色浪纹（两条正弦带）
      const amp = size * 0.05;
      const wave1 = cy + Math.sin((x / W) * Math.PI * 3) * amp + size * 0.08;
      const wave2 = cy + Math.sin((x / W) * Math.PI * 3 + 1.5) * amp + size * 0.20;
      if (Math.abs(y - wave1) < size * 0.035 || Math.abs(y - wave2) < size * 0.035) {
        r = g = b = 255;
      }
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  }
  // 加 PNG 每行 filter 字节 0
  const raw = Buffer.alloc(H * (W * 4 + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit, RGBA
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
function dist(x, y, a, b) { return Math.hypot(x - a, y - b); }

const dir = path.join(__dirname, 'icons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-192.png'), makePNG(192));
fs.writeFileSync(path.join(dir, 'icon-512.png'), makePNG(512));
console.log('icons generated');
