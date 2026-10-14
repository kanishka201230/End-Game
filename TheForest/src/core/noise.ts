/** Ruido procedural determinista (PRNG + value noise + fBm). */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep01(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise 2D en [0,1]. */
export function noise2(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smoothstep01(x - ix);
  const fz = smoothstep01(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** fBm en [0,1] aprox. */
export function fbm2(x: number, z: number, octaves = 4, seed = 0): number {
  let v = 0;
  let amp = 0.5;
  let fx = x;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise2(fx, fz, seed + i * 101);
    fx *= 2.03;
    fz *= 2.03;
    amp *= 0.5;
  }
  return v;
}

/** Ruido "ridged" para crestas rocosas, en [0,1]. */
export function ridged2(x: number, z: number, octaves = 4, seed = 0): number {
  let v = 0;
  let amp = 0.5;
  let fx = x;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(2 * noise2(fx, fz, seed + i * 131) - 1);
    v += amp * n * n;
    fx *= 2.11;
    fz *= 2.11;
    amp *= 0.5;
  }
  return v;
}
