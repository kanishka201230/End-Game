import * as THREE from 'three';
import { Heightfield, WORLD_SIZE } from './heightfield';
import { barkTexture, leafClusterTexture } from '../core/textures';
import { mulberry32, fbm2 } from '../core/noise';
import { shared } from '../core/uniforms';
import { growSkeleton, meshSkeleton, MeshDetail, TreeParams } from './TreeGen';

export interface Collider {
  x: number;
  z: number;
  r: number;
}

/**
 * Niveles de detalle (estilo ez-tree). Cada árbol instanciado se asigna al
 * nivel que corresponde a su distancia a la cámara; el reparto se rehace
 * cuando el jugador se desplaza.
 */
const LODS: { dist: number; detail: MeshDetail; castShadow: boolean }[] = [
  { dist: 70, detail: {}, castShadow: true },
  {
    dist: 160,
    detail: { sectionStride: 2, segmentFactor: 0.65, leafStride: 2, leafScale: 1.25 },
    castShadow: true
  },
  {
    dist: Infinity,
    detail: {
      sectionStride: 3,
      segmentFactor: 0.4,
      leafStride: 3,
      leafScale: 1.4,
      singleBillboard: true
    },
    castShadow: false
  }
];

/** Parámetros de las variantes (esqueleto recursivo estilo ez-tree). */
function deciduousParams(seed: number, rng: () => number): TreeParams {
  return {
    seed,
    levels: 3,
    length: [8.5 + rng() * 3, 3.2 + rng() * 1.2, 2.6 + rng() * 0.8, 1.6 + rng() * 0.5],
    trunkRadius: 0.3 + rng() * 0.12,
    radiusFactor: [1, 0.8, 0.68, 0.6],
    angle: [0, 48 + rng() * 14, 54 + rng() * 12, 32 + rng() * 10],
    children: [4, 3, 3],
    start: [0, 0.38 + rng() * 0.12, 0.08, 0.12],
    taper: [0.7, 0.52, 0.62, 0.72],
    gnarliness: [0.045, 0.11, 0.18, 0.11],
    sections: [7, 5, 3, 2],
    segments: [6, 5, 4, 3],
    forceUp: 0.011 + rng() * 0.005,
    leaves: {
      countPerTip: 6,
      size: 1.15 + rng() * 0.35,
      sizeVariance: 0.45,
      angleDeg: 38 + rng() * 10
    }
  };
}

function deadParams(seed: number): TreeParams {
  return {
    seed,
    levels: 3,
    length: [8.5, 2.6, 1.9, 1.2],
    trunkRadius: 0.23,
    radiusFactor: [1, 0.7, 0.62, 0.55],
    angle: [0, 52, 56, 46],
    children: [3, 3, 2],
    start: [0, 0.45, 0.18, 0.2],
    taper: [0.78, 0.68, 0.7, 0.8],
    gnarliness: [0.11, 0.28, 0.34, 0.3],
    sections: [6, 4, 3, 2],
    segments: [6, 4, 3, 3],
    forceUp: 0.005,
    leaves: null
  };
}

interface Placement {
  matrix: THREE.Matrix4;
  color: THREE.Color;
  x: number;
  z: number;
  /** Desfase del umbral LOD por árbol: evita cambios en masa al cruzarlo. */
  lodBias: number;
}

interface VariantMeshes {
  placements: Placement[];
  trunkLods: THREE.InstancedMesh[];
  foliageLods: (THREE.InstancedMesh | null)[];
}

/**
 * Bosque procedural instanciado con LOD dinámico por distancia.
 */
export function createForest(
  field: Heightfield,
  scene: THREE.Scene
): { group: THREE.Group; colliders: Collider[]; update: (camPos: THREE.Vector3) => void } {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const rng = mulberry32(5150);

  const bark = new THREE.MeshStandardMaterial({
    map: barkTexture(),
    roughness: 0.92,
    metalness: 0
  });
  const deadBark = new THREE.MeshStandardMaterial({
    map: barkTexture(),
    color: 0x9a9186,
    roughness: 0.95,
    metalness: 0
  });
  const leaves = new THREE.MeshStandardMaterial({
    map: leafClusterTexture(),
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0
  });

  // Balanceo suave de las copas con el viento; las hojas se agitan más en
  // la punta (uv.y) como en ez-tree.
  leaves.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 fIp = instanceMatrix[3].xyz;
          #else
            vec3 fIp = vec3(0.0);
          #endif
          float fPh = fIp.x * 0.31 + fIp.z * 0.27;
          float fSw = sin(uTime * 1.05 + fPh) + 0.5 * sin(uTime * 2.3 + fPh * 1.7);
          float fAmp = 0.06 * smoothstep(1.5, 7.0, transformed.y);
          transformed.x += fSw * fAmp * 0.9;
          transformed.z += fSw * fAmp * 0.45;
          transformed.x += sin(uTime * 3.1 + fPh + position.y * 2.1) * 0.02 * (0.4 + 0.6 * uv.y);
        }`
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * 0.12;`
    );
  };

  // Variantes: 3 frondosos + 1 seco. Un esqueleto por variante, mallado a
  // cada nivel de detalle.
  const variantGeos: {
    trunkRadius: number;
    lods: { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry | null }[];
  }[] = [];

  for (let v = 0; v < 3; v++) {
    const vrng = mulberry32(2000 + v * 517);
    const params = deciduousParams(3000 + v * 131, vrng);
    const skeleton = growSkeleton(params);
    variantGeos.push({
      trunkRadius: params.trunkRadius,
      lods: LODS.map((l) => meshSkeleton(skeleton, l.detail))
    });
  }
  {
    const params = deadParams(4242);
    const skeleton = growSkeleton(params);
    variantGeos.push({
      trunkRadius: params.trunkRadius,
      lods: LODS.map((l) => meshSkeleton(skeleton, l.detail))
    });
  }

  // --- Dispersión ---
  const placedXZ: [number, number, number][] = []; // x, z, minSep
  const byVariant: Placement[][] = [[], [], [], []];

  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  const tryPlace = (x: number, z: number, minSep: number): boolean => {
    const margin = WORLD_SIZE / 2 - 15;
    if (Math.abs(x) > margin || Math.abs(z) > margin) return false;
    const h = field.sampleHeight(x, z);
    if (h > 72) return false;
    if (field.sampleSlope(x, z) > 0.5) return false;
    if (field.distToPath(x, z) < 5) return false;
    if (field.sampleMask(x, z) < 0.2) return false;
    // Claro alrededor del punto de aparición.
    const dsx = x - 0;
    const dsz = z - 140;
    if (dsx * dsx + dsz * dsz < 15 * 15) return false;
    for (const [px, pz, ps] of placedXZ) {
      const dx = x - px;
      const dz = z - pz;
      const s = Math.max(minSep, ps);
      if (dx * dx + dz * dz < s * s) return false;
    }
    return true;
  };

  const place = (variant: number, x: number, z: number, scale: number, minSep: number) => {
    const y = field.sampleHeight(x, z) - 0.15;
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      q,
      new THREE.Vector3(scale, scale, scale)
    );
    const w = rng();
    const color = new THREE.Color(
      0.85 + w * 0.3,
      0.9 + rng() * 0.18,
      0.8 + rng() * 0.25
    );
    byVariant[variant].push({ matrix, color, x, z, lodBias: (rng() - 0.5) * 14 });
    placedXZ.push([x, z, minSep]);
    const tr = variantGeos[variant].trunkRadius;
    colliders.push({ x, z, r: Math.max(0.4, tr * scale * 1.4) });
  };

  // Árboles "héroe" que replican la composición de la referencia.
  place(0, -22, 102, 1.65, 6); // gran árbol a la izquierda
  place(1, 26, 52, 1.45, 6); // árbol medio a la derecha
  place(3, -4, 62, 1.15, 6); // árbol seco al centro
  place(2, 17, 118, 1.35, 6); // árbol cercano a la derecha del sendero

  // Dispersión general: más denso ladera arriba y por parches de ruido.
  let attempts = 0;
  let placed = 0;
  const target = 150;
  while (placed < target && attempts < 6000) {
    attempts++;
    const x = (rng() * 2 - 1) * (WORLD_SIZE / 2 - 20);
    const z = (rng() * 2 - 1) * (WORLD_SIZE / 2 - 20);

    const density = fbm2(x * 0.008 + 50, z * 0.008 + 20, 3, 91);
    const upslope = THREE.MathUtils.clamp((170 - z) / 300, 0.25, 1);
    // En lo alto del cerro los árboles ralean (matorral disperso).
    const hh = field.sampleHeight(x, z);
    const highTaper = 1 - THREE.MathUtils.clamp((hh - 28) / 40, 0, 1) * 0.75;
    if (rng() > density * 1.4 * upslope * highTaper) continue;
    if (!tryPlace(x, z, 7)) continue;

    const isDead = rng() < 0.14;
    const variant = isDead ? 3 : Math.floor(rng() * 3);
    let scale = 0.8 + rng() * 0.75;
    if (hh > 35) scale *= 0.65;
    place(variant, x, z, scale, 7);
    placed++;
  }

  // --- Un InstancedMesh por variante y nivel; el reparto se hace en update ---
  const variants: VariantMeshes[] = [];
  for (let v = 0; v < 4; v++) {
    const list = byVariant[v];
    const geos = variantGeos[v];
    const trunkMat = v < 3 ? bark : deadBark;
    const trunkLods: THREE.InstancedMesh[] = [];
    const foliageLods: (THREE.InstancedMesh | null)[] = [];

    for (let l = 0; l < LODS.length; l++) {
      const trunkMesh = new THREE.InstancedMesh(geos.lods[l].trunk, trunkMat, list.length);
      trunkMesh.castShadow = LODS[l].castShadow;
      trunkMesh.receiveShadow = true;
      trunkMesh.frustumCulled = false;
      trunkMesh.count = 0;
      group.add(trunkMesh);
      trunkLods.push(trunkMesh);

      if (geos.lods[l].leaves) {
        const foliageMesh = new THREE.InstancedMesh(geos.lods[l].leaves!, leaves, list.length);
        foliageMesh.castShadow = LODS[l].castShadow;
        foliageMesh.receiveShadow = false;
        foliageMesh.frustumCulled = false;
        // Reservar el buffer de color de instancia desde el inicio para que
        // el programa del material no cambie al primer reparto.
        for (let i = 0; i < list.length; i++) foliageMesh.setColorAt(i, list[i].color);
        foliageMesh.count = 0;
        group.add(foliageMesh);
        foliageLods.push(foliageMesh);
      } else {
        foliageLods.push(null);
      }
    }
    variants.push({ placements: list, trunkLods, foliageLods });
  }

  // Reparto de instancias por distancia; se rehace al desplazarse el jugador.
  const lastCam = new THREE.Vector3(Infinity, 0, Infinity);
  const update = (camPos: THREE.Vector3): void => {
    if (camPos.distanceToSquared(lastCam) < 36) return;
    lastCam.copy(camPos);

    for (const variant of variants) {
      const counts = [0, 0, 0];
      for (const p of variant.placements) {
        const d = Math.hypot(p.x - camPos.x, p.z - camPos.z) + p.lodBias;
        const level = d < LODS[0].dist ? 0 : d < LODS[1].dist ? 1 : 2;
        const i = counts[level]++;
        variant.trunkLods[level].setMatrixAt(i, p.matrix);
        const fol = variant.foliageLods[level];
        if (fol) {
          fol.setMatrixAt(i, p.matrix);
          fol.setColorAt(i, p.color);
        }
      }
      for (let l = 0; l < LODS.length; l++) {
        const trunk = variant.trunkLods[l];
        trunk.count = counts[l];
        trunk.instanceMatrix.needsUpdate = true;
        const fol = variant.foliageLods[l];
        if (fol) {
          fol.count = counts[l];
          fol.instanceMatrix.needsUpdate = true;
          if (fol.instanceColor) fol.instanceColor.needsUpdate = true;
        }
      }
    }
  };

  scene.add(group);
  return { group, colliders, update };
}

/** Fusión manual de geometrías indexadas con position/normal/uv. */
export function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let offset = 0;

  for (const g of list) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
      else uvs.push(0, 0);
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) indices.push(g.index.getX(i) + offset);
    } else {
      for (let i = 0; i < p.count; i++) indices.push(i + offset);
    }
    offset += p.count;
    g.dispose();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}
