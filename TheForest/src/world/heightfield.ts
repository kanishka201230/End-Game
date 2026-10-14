import * as THREE from 'three';
import { fbm2 } from '../core/noise';
import { ARENA_PATHS_ARRAY } from './PathSystem';

/** Tamaño del mundo en metros (centrado en el origen). */
export const WORLD_SIZE = 600;
/** Resolución del campo de alturas (muestras por lado). */
export const FIELD_RES = 512;

/** Puntos de aparición (distantes en el sur). */
export const SPAWN = new THREE.Vector3(-60, 0.2, 90);
export const SPAWN_P2 = new THREE.Vector3(60, 0.2, 90);

/** Segmentos del sendero extendido (curvas naturales, bifurcación y llegada frente a escaleras). */
export const ARENA_PATHS: [number, number, number, number][] = ARENA_PATHS_ARRAY;

/** Cumbre / Copa final (lejos en el norte). */
export const SUMMIT = { x: 0, z: -220 };

const HALF = WORLD_SIZE / 2;

/** Altura analítica del terreno en metros. */
export function terrainHeight(x: number, z: number): number {
  const pd = distToPath(x, z);

  // Colinas onduladas naturales del paisaje
  let rawH = 8 * (fbm2(x * 0.007 + 12, z * 0.007 + 44, 4, 11) - 0.5) * 2;
  rawH += 3.5 * (fbm2(x * 0.02, z * 0.02, 3, 23) - 0.5) * 2;

  // Gran cresta boscosa en el centro entre el inicio y el norte (bloquea la vista de la copa)
  const centerRidge = Math.hypot(x, z - 25);
  if (centerRidge < 50) {
    const t = 1 - centerRidge / 50;
    rawH += 8.5 * t * t * (3 - 2 * t);
  }

  // Otra loma entre el inicio y el corredor norte
  const northRidge = Math.hypot(x, z + 60);
  if (northRidge < 60) {
    const t = 1 - northRidge / 60;
    rawH += 6.5 * t * t * (3 - 2 * t);
  }

  // Aplanar el corredor del sendero para caminar suavemente sobre el suelo de tierra
  const pathFlatten = smooth(2.0, 5.5, pd);
  let h = Math.max(0, rawH) * pathFlatten;

  // Cordón de montañas boscosas en el borde exterior
  const r = Math.sqrt(x * x + z * z);
  if (r > 215) {
    const t = Math.min(1, (r - 215) / 80);
    h += 24 * t * t * (3 - 2 * t);
  }

  return h;
}

function hill(x: number, z: number, cx: number, cz: number, radius: number, height: number, sharp: number): number {
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= radius) return 0;
  const t = 1 - d / radius;
  const ridge = 0.9 + 0.5 * (fbm2(x * 0.012, z * 0.012, 3, 77) - 0.5);
  return height * Math.pow(t, sharp) * ridge;
}

export function distToPath(x: number, z: number): number {
  let best = Infinity;
  for (const [ax, az, bx, bz] of ARENA_PATHS) {
    const abx = bx - ax;
    const abz = bz - az;
    const len2 = abx * abx + abz * abz;
    let t = len2 > 0 ? ((x - ax) * abx + (z - az) * abz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + abx * t;
    const pz = az + abz * t;
    const dx = x - px;
    const dz = z - pz;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  // Zona despejada frente a las escaleras de piedra
  const dArrival = Math.hypot(x, z - (-211.5));
  if (dArrival < 3.2) {
    return 0;
  }
  return Math.sqrt(best);
}

/**
 * Campo de alturas precalculado + máscara de pasto.
 * La máscara vale 1 donde crece pasto y cae a 0 en sendero, roca y pendientes.
 */
export class Heightfield {
  readonly heights: Float32Array;
  readonly mask: Float32Array;
  readonly texture: THREE.DataTexture;

  constructor() {
    const n = FIELD_RES;
    this.heights = new Float32Array(n * n);
    this.mask = new Float32Array(n * n);

    const step = WORLD_SIZE / (n - 1);
    for (let iz = 0; iz < n; iz++) {
      const z = -HALF + iz * step;
      for (let ix = 0; ix < n; ix++) {
        const x = -HALF + ix * step;
        this.heights[iz * n + ix] = terrainHeight(x, z);
      }
    }

    // Máscara: pendiente (diferencias finitas), altura de roca y sendero.
    for (let iz = 0; iz < n; iz++) {
      const z = -HALF + iz * step;
      for (let ix = 0; ix < n; ix++) {
        const x = -HALF + ix * step;
        const i = iz * n + ix;
        const hx0 = this.heights[iz * n + Math.max(0, ix - 1)];
        const hx1 = this.heights[iz * n + Math.min(n - 1, ix + 1)];
        const hz0 = this.heights[Math.max(0, iz - 1) * n + ix];
        const hz1 = this.heights[Math.min(n - 1, iz + 1) * n + ix];
        const sx = (hx1 - hx0) / (2 * step);
        const sz = (hz1 - hz0) / (2 * step);
        const slope = Math.sqrt(sx * sx + sz * sz);

        const h = this.heights[i];
        let m = 1 - smooth(0.56, 0.88, slope);

        // En el cerro el pasto ralea con la altura, sin desaparecer del todo.
        m *= 1 - 0.3 * smooth(38, 70, h);

        // Calvas de tierra erosionada dispersas en la ladera.
        const ero = smooth(0.64, 0.85, fbm2(x * 0.045 + 13, z * 0.045 + 71, 3, 313)) * smooth(16, 32, h);
        m *= 1 - 0.75 * ero;

        // Sendero de tierra natural: despeja el pasto con transición suave y orgánica
        const pd = distToPath(x, z);
        m *= smooth(1.3, 2.2, pd);

        this.mask[i] = m;
      }
    }

    // Textura RGBA16F: R = altura (m), G = máscara de pasto.
    const data = new Uint16Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      data[i * 4 + 0] = THREE.DataUtils.toHalfFloat(this.heights[i]);
      data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(this.mask[i]);
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
    }
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.texture = tex;
  }

  /** Altura interpolada bilinealmente (para colisión del jugador, scatter, etc.). */
  sampleHeight(x: number, z: number): number {
    return this.bilinear(this.heights, x, z);
  }

  /** Máscara de pasto interpolada (1 = pasto, 0 = tierra/roca). */
  sampleMask(x: number, z: number): number {
    return this.bilinear(this.mask, x, z);
  }

  /** Pendiente aproximada (magnitud del gradiente). */
  sampleSlope(x: number, z: number): number {
    const e = 1.2;
    const sx = (this.sampleHeight(x + e, z) - this.sampleHeight(x - e, z)) / (2 * e);
    const sz = (this.sampleHeight(x, z + e) - this.sampleHeight(x, z - e)) / (2 * e);
    return Math.sqrt(sx * sx + sz * sz);
  }

  distToPath(x: number, z: number): number {
    return distToPath(x, z);
  }

  private bilinear(arr: Float32Array, x: number, z: number): number {
    const n = FIELD_RES;
    const fx = THREE.MathUtils.clamp((x + HALF) / WORLD_SIZE, 0, 1) * (n - 1);
    const fz = THREE.MathUtils.clamp((z + HALF) / WORLD_SIZE, 0, 1) * (n - 1);
    const ix = Math.min(Math.floor(fx), n - 2);
    const iz = Math.min(Math.floor(fz), n - 2);
    const tx = fx - ix;
    const tz = fz - iz;
    const a = arr[iz * n + ix];
    const b = arr[iz * n + ix + 1];
    const c = arr[(iz + 1) * n + ix];
    const d = arr[(iz + 1) * n + ix + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }
}

function smooth(a: number, b: number, t: number): number {
  const x = THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
}
