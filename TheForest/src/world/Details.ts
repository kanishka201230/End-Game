import * as THREE from 'three';
import { Heightfield, WORLD_SIZE } from './heightfield';
import { barkTexture, softDotTexture } from '../core/textures';
import { mulberry32, fbm2, noise2 } from '../core/noise';
import { mergeGeos, Collider } from './Trees';

/** Rocas con musgo en la cara superior (colores de vértice horneados). */
export function createRocks(field: Heightfield, scene: THREE.Scene, colliders: Collider[]): void {
  const rng = mulberry32(31337);

  // Dos variantes de roca desplazada por ruido.
  const variants: THREE.BufferGeometry[] = [];
  for (let v = 0; v < 2; v++) {
    const g = new THREE.IcosahedronGeometry(1, 3);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const seed = 400 + v * 77;
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const n = fbm2(p.x * 1.4 + p.y * 0.9 + seed, p.z * 1.4 - p.y * 0.7, 4, seed);
      p.multiplyScalar(0.75 + n * 0.55);
      p.y *= 0.72;
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    g.computeVertexNormals();

    // Colores de vértice: gris con grietas + musgo arriba.
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const crack = fbm2(px * 3.1 + seed, pz * 3.1 + py * 2.0, 3, seed + 5);
      let r = 0.15 + crack * 0.13;
      let gg = 0.147 + crack * 0.125;
      let b = 0.14 + crack * 0.12;
      const upness = Math.max(0, nor.getY(i));
      const moss = Math.pow(upness, 1.2) * (0.45 + 0.55 * noise2(px * 2.2 + seed, pz * 2.2, seed + 9));
      r = r * (1 - moss) + 0.13 * moss;
      gg = gg * (1 - moss) + 0.21 * moss;
      b = b * (1 - moss) + 0.05 * moss;
      colors[i * 3] = r;
      colors[i * 3 + 1] = gg;
      colors[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    variants.push(g);
  }

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0
  });

  interface P {
    x: number;
    z: number;
    s: number;
    rot: number;
  }
  const lists: P[][] = [[], []];

  // Roca musgosa protagonista a la izquierda del sendero (como en la imagen).
  lists[0].push({ x: -15, z: 118, s: 1.7, rot: 0.6 });
  lists[1].push({ x: -12.4, z: 116.2, s: 1.0, rot: 2.4 });

  let placed = 0;
  let attempts = 0;
  while (placed < 26 && attempts < 900) {
    attempts++;
    const x = (rng() * 2 - 1) * (WORLD_SIZE / 2 - 25);
    const z = (rng() * 2 - 1) * (WORLD_SIZE / 2 - 25);
    if (field.sampleHeight(x, z) > 60) continue;
    if (field.distToPath(x, z) < 2.5) continue;
    const slopeBias = field.sampleSlope(x, z) > 0.3 ? 1.6 : 0.6;
    if (rng() > 0.5 * slopeBias) continue;
    lists[Math.floor(rng() * 2)].push({ x, z, s: 0.35 + rng() * 1.3, rot: rng() * Math.PI * 2 });
    placed++;
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let v = 0; v < 2; v++) {
    const list = lists[v];
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(variants[v], mat, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const y = field.sampleHeight(p.x, p.z) + p.s * 0.12;
      q.setFromAxisAngle(up, p.rot);
      m.compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
      mesh.setMatrixAt(i, m);
      if (p.s > 0.7) colliders.push({ x: p.x, z: p.z, r: p.s * 0.85 });
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  }
}

/** Troncos caídos y tocones cerca del sendero. */
export function createLogs(field: Heightfield, scene: THREE.Scene, colliders: Collider[]): void {
  const bark = new THREE.MeshStandardMaterial({
    map: barkTexture(),
    color: 0xb0a496,
    roughness: 0.95
  });

  const parts: { geo: THREE.BufferGeometry; x: number; z: number; ry: number; rz: number }[] = [];

  const log1 = new THREE.CylinderGeometry(0.28, 0.36, 5.2, 8, 3);
  parts.push({ geo: log1, x: -13, z: 112, ry: 0.5, rz: Math.PI / 2 - 0.06 });

  const log2 = new THREE.CylinderGeometry(0.2, 0.26, 3.6, 7, 2);
  parts.push({ geo: log2, x: 18, z: 78, ry: 2.1, rz: Math.PI / 2 + 0.1 });

  const stump = new THREE.CylinderGeometry(0.34, 0.48, 1.5, 8, 2);
  parts.push({ geo: stump, x: -2.5, z: 96, ry: 0, rz: 0.12 });

  for (const p of parts) {
    const mesh = new THREE.Mesh(p.geo, bark);
    const y = field.sampleHeight(p.x, p.z);
    mesh.position.set(p.x, y + (p.rz > 1 ? 0.32 : 0.6), p.z);
    mesh.rotation.set(0, p.ry, p.rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push({ x: p.x, z: p.z, r: 0.6 });
  }
}

/** Motas de polen/polvo flotando a contraluz. */
export class Motes {
  readonly points: THREE.Points;
  private readonly base: Float32Array;
  private readonly phase: Float32Array;
  private readonly count = 350;
  private readonly radius = 22;

  constructor(scene: THREE.Scene) {
    const rng = mulberry32(2718);
    const positions = new Float32Array(this.count * 3);
    this.base = new Float32Array(this.count * 3);
    this.phase = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      this.base[i * 3] = (rng() * 2 - 1) * this.radius;
      this.base[i * 3 + 1] = 0.3 + rng() * 4.5;
      this.base[i * 3 + 2] = (rng() * 2 - 1) * this.radius;
      this.phase[i] = rng() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      map: softDotTexture(),
      size: 0.045,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      sizeAttenuation: true,
      color: 0xfff2cc
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(time: number, playerPos: THREE.Vector3, field: Heightfield): void {
    const pos = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const r2 = this.radius * 2;
    for (let i = 0; i < this.count; i++) {
      const ph = this.phase[i];
      // Deriva lenta + envoltura alrededor del jugador.
      let x = this.base[i * 3] + Math.sin(time * 0.11 + ph) * 3 + time * 0.25;
      let z = this.base[i * 3 + 2] + Math.cos(time * 0.09 + ph * 1.3) * 3;
      x = ((((x - playerPos.x + this.radius) % r2) + r2) % r2) - this.radius + playerPos.x;
      z = ((((z - playerPos.z + this.radius) % r2) + r2) % r2) - this.radius + playerPos.z;
      const y =
        field.sampleHeight(x, z) +
        this.base[i * 3 + 1] +
        Math.sin(time * 0.5 + ph * 2.7) * 0.4;
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  }
}
