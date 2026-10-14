import { readFileSync, writeFileSync, mkdirSync } from 'fs';

/**
 * Hornea el heightfield de src/textures/Rockwall.obj (malla "Relief" de C4D:
 * cuadrícula regular 101×101, sólo varía Y) a una textura de altura binaria:
 * [u16 w][u16 h][u8 alturas normalizadas 0..255]
 * Se usa como relieve macro del sendero (bump + oscurecido de hondonadas).
 */
const SRC = 'c:/xampp/htdocs/TheForest/src/textures/Rockwall.obj';
const OUT = 'c:/xampp/htdocs/TheForest/public/models/relief.bin';
const STEP = 6;
const MIN = -300;
const N = 101;

const txt = readFileSync(SRC, 'utf8');
const grid = new Float32Array(N * N);
let count = 0;
let minY = Infinity;
let maxY = -Infinity;

for (const line of txt.split('\n')) {
  if (!line.startsWith('v ')) continue;
  const [, xs, ys, zs] = line.trim().split(/\s+/);
  const x = Number(xs);
  const y = Number(ys);
  const z = Number(zs);
  const xi = Math.round((x - MIN) / STEP);
  const zi = Math.round((z - MIN) / STEP);
  grid[zi * N + xi] = y;
  count++;
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
}
if (count !== N * N) throw new Error(`esperaba ${N * N} vértices, hay ${count}`);
console.log(`grid ${N}×${N}, alturas ${minY.toFixed(2)}..${maxY.toFixed(2)}`);

const out = new Uint8Array(4 + N * N);
const dv = new DataView(out.buffer);
dv.setUint16(0, N, true);
dv.setUint16(2, N, true);
const range = maxY - minY;
for (let i = 0; i < N * N; i++) {
  out[4 + i] = Math.round(((grid[i] - minY) / range) * 255);
}

mkdirSync('c:/xampp/htdocs/TheForest/public/models', { recursive: true });
writeFileSync(OUT, out);
console.log(`escrito ${OUT}: ${(out.length / 1024).toFixed(1)} KB`);
