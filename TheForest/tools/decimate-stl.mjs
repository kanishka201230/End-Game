import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * Decima un STL binario por clustering de vértices y lo guarda como binario
 * indexado compacto: [u32 nVerts][u32 nTris][f32 pos×3n][u32 idx×3t]
 * Convención de salida: Y-up (STL viene Z-up), centrado en XZ, base en y=0.
 *
 * Uso: node tools/decimate-stl.mjs <entrada.stl> <salida.bin> <celda>
 */
const [, , IN, OUT, CELL_ARG] = process.argv;
if (!IN || !OUT) {
  console.error('Uso: node tools/decimate-stl.mjs <entrada.stl> <salida.bin> <celda>');
  process.exit(1);
}
const CELL = parseFloat(CELL_ARG ?? '0.4');

const buf = readFileSync(IN);
const tris = buf.readUInt32LE(80);
console.log(`${IN}: ${tris} tris de entrada, celda ${CELL}`);

const cells = new Map();
const triCells = new Uint32Array(tris * 3);
let nextId = 0;
const KX = 2048;
const KY = 2048;

for (let t = 0; t < tris; t++) {
  const off = 84 + t * 50 + 12;
  for (let v = 0; v < 3; v++) {
    const x = buf.readFloatLE(off + v * 12);
    const yz = buf.readFloatLE(off + v * 12 + 4);
    const z = buf.readFloatLE(off + v * 12 + 8);
    // Z-up -> Y-up: (x, y, z) := (x, z, -y)
    const px = x;
    const py = z;
    const pz = -yz;
    const ix = Math.round(px / CELL) + 1024;
    const iy = Math.round(py / CELL);
    const iz = Math.round(pz / CELL) + 1024;
    const key = (iy * KY + iz) * KX + ix;
    let c = cells.get(key);
    if (!c) {
      c = { sx: 0, sy: 0, sz: 0, n: 0, id: nextId++ };
      cells.set(key, c);
    }
    c.sx += px;
    c.sy += py;
    c.sz += pz;
    c.n++;
    triCells[t * 3 + v] = c.id;
  }
}

const nv = nextId;
const positions = new Float32Array(nv * 3);
let minX = Infinity;
let maxX = -Infinity;
let minY = Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
for (const c of cells.values()) {
  const x = c.sx / c.n;
  const y = c.sy / c.n;
  const z = c.sz / c.n;
  positions[c.id * 3] = x;
  positions[c.id * 3 + 1] = y;
  positions[c.id * 3 + 2] = z;
  if (x < minX) minX = x;
  if (x > maxX) maxX = x;
  if (y < minY) minY = y;
  if (z < minZ) minZ = z;
  if (z > maxZ) maxZ = z;
}
// Centrar XZ y apoyar la base en y=0.
const cx = (minX + maxX) / 2;
const cz = (minZ + maxZ) / 2;
for (let i = 0; i < nv; i++) {
  positions[i * 3] -= cx;
  positions[i * 3 + 1] -= minY;
  positions[i * 3 + 2] -= cz;
}

const indices = [];
for (let t = 0; t < tris; t++) {
  const a = triCells[t * 3];
  const b = triCells[t * 3 + 1];
  const c = triCells[t * 3 + 2];
  if (a !== b && b !== c && a !== c) indices.push(a, b, c);
}
const nt = indices.length / 3;
console.log(`salida: ${nv} verts, ${nt} tris`);

const out = new ArrayBuffer(8 + nv * 12 + nt * 12);
const dv = new DataView(out);
dv.setUint32(0, nv, true);
dv.setUint32(4, nt, true);
new Float32Array(out, 8, nv * 3).set(positions);
new Uint32Array(out, 8 + nv * 12, nt * 3).set(indices);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.from(out));
console.log(`escrito ${OUT}: ${(out.byteLength / 1e6).toFixed(2)} MB`);
