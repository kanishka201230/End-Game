import * as THREE from 'three';
import { Heightfield, SUMMIT } from './heightfield';
import { Collider } from './Trees';
import { markerGlyphTexture } from '../core/textures';
import { shared } from '../core/uniforms';
import { mulberry32 } from '../core/noise';

/**
 * Hitos del cerro:
 * - En la cumbre (el punto más alto), la efigie del Marcador: modelo
 *   esculpido real (src/models/efigie.stl) decimado offline a un binario
 *   indexado compacto (public/models/efigie.bin, ver scripts de scratchpad).
 * - Obelisco blanco sobre plataforma de concreto a media ladera.
 */
export async function createLandmarks(
  field: Heightfield,
  scene: THREE.Scene,
  colliders: Collider[]
): Promise<void> {
  await Promise.all([
    buildMarker(field, scene, colliders),
    buildCrystals(field, scene, colliders)
  ]);
  buildObelisk(field, scene, colliders);
}

/** Carga un binario indexado (formato de tools/decimate-stl.mjs). */
async function loadBinGeometry(name: string, computeNormals: boolean): Promise<THREE.BufferGeometry> {
  const res = await fetch(`${import.meta.env.BASE_URL}models/${name}.bin`);
  const ab = await res.arrayBuffer();
  const dv = new DataView(ab);
  const nv = dv.getUint32(0, true);
  const nt = dv.getUint32(4, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ab, 8, nv * 3), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(ab, 8 + nv * 12, nt * 3), 1));
  if (computeNormals) geo.computeVertexNormals();
  return geo;
}

/** Altura del modelo original (unidades STL, Z-up ya convertido a Y-up). */
const MODEL_HEIGHT = 98.4;
/** Altura de la efigie en el mundo (metros). */
const MARKER_HEIGHT = 16;

async function buildMarker(
  field: Heightfield,
  scene: THREE.Scene,
  colliders: Collider[]
): Promise<void> {
  const geo = await loadBinGeometry('efigie', true);

  // UVs cilíndricas para proyectar los glifos emisivos sobre la escultura:
  // u = ángulo alrededor del eje, v = altura normalizada.
  const positions = geo.attributes.position.array as Float32Array;
  const nv = geo.attributes.position.count;
  const uvs = new Float32Array(nv * 2);
  for (let i = 0; i < nv; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    uvs[i * 2] = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
    uvs[i * 2 + 1] = y / MODEL_HEIGHT;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  // Piedra negra mate; el detalle lo pone la propia escultura. Los glifos
  // rojos laten proyectados con las UVs cilíndricas.
  const glyphs = markerGlyphTexture();
  glyphs.repeat.set(2, 3);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.014, 0.013, 0.016),
    roughness: 0.86,
    metalness: 0.05,
    emissive: new THREE.Color(1.0, 0.08, 0.04),
    emissiveMap: glyphs,
    emissiveIntensity: 1.1
  });
  mat.envMapIntensity = 0.4;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Latido lento y siniestro de los glifos.
        totalEmissiveRadiance *= 0.55 + 0.45 * (0.5 + 0.5 * sin(uTime * 1.05));`
      );
  };

  const y0 = field.sampleHeight(SUMMIT.x, SUMMIT.z);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(MARKER_HEIGHT / MODEL_HEIGHT);
  mesh.position.set(SUMMIT.x, y0 - 0.45, SUMMIT.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  colliders.push({ x: SUMMIT.x, z: SUMMIT.z, r: 2.9 });
}

/** Alturas de los modelos de cristal (unidades STL, Y-up). */
const CRYSTAL_HEIGHTS: Record<string, number> = { crystal_a: 43.4, crystal_b: 33.3 };

/**
 * Anillo de cristales semienterrados alrededor de la efigie, inclinados
 * hacia afuera como si hubieran brotado del suelo, con acabado semimetálico.
 */
async function buildCrystals(
  field: Heightfield,
  scene: THREE.Scene,
  colliders: Collider[]
): Promise<void> {
  const [geoA, geoB] = await Promise.all([
    loadBinGeometry('crystal_a', false),
    loadBinGeometry('crystal_b', false)
  ]);

  // Semimetálico oscuro; flat shading para facetas nítidas de cristal.
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.05, 0.045, 0.062),
    metalness: 0.75,
    roughness: 0.24,
    flatShading: true
  });
  mat.envMapIntensity = 1.1;

  const rng = mulberry32(31666);
  interface P {
    m: THREE.Matrix4;
    big: boolean;
  }
  const listA: P[] = [];
  const listB: P[] = [];

  const COUNT = 14;
  // Hueco en el anillo donde el sendero llega a la cumbre.
  const pathAngle = Math.atan2(-160 - SUMMIT.z, -58 - SUMMIT.x);

  const q = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < COUNT; i++) {
    const a = ((i + rng() * 0.8) / COUNT) * Math.PI * 2;
    let da = Math.abs(a - pathAngle);
    da = Math.min(da, Math.PI * 2 - da);
    if (da < 0.38) continue; // dejar libre la llegada del sendero

    // A: racimo alto (mayoría). B: arrecife ancho y bajo, en el anillo exterior.
    const isB = rng() < 0.22;
    const modelH = isB ? CRYSTAL_HEIGHTS.crystal_b : CRYSTAL_HEIGHTS.crystal_a;
    const radius = isB ? 5.8 + rng() * 1.8 : 3.5 + rng() * 3.0;
    const x = SUMMIT.x + Math.cos(a) * radius;
    const z = SUMMIT.z + Math.sin(a) * radius;

    // Grandes: la mayor parte queda bajo tierra y solo asoman las puntas.
    const targetH = isB ? 2.1 + rng() * 1.1 : 3.2 + rng() * 2.4;
    const s = targetH / modelH;

    // Referencia de entierro: el punto MÁS BAJO del terreno bajo la huella,
    // para que en pendiente la base nunca quede al aire.
    const modelW = isB ? 101.6 : 52.0;
    const half = modelW * s * 0.35;
    let ground = Infinity;
    for (const [ox, oz] of [[half, half], [half, -half], [-half, half], [-half, -half]] as const) {
      ground = Math.min(ground, field.sampleHeight(x + ox, z + oz));
    }
    const sink = (0.32 + rng() * 0.12) * targetH;
    const y = ground - sink;

    // Inclinación leve; el entierro profundo hace el resto.
    qYaw.setFromAxisAngle(UP, rng() * Math.PI * 2);
    const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    qTilt.setFromAxisAngle(tangent, (0.05 + rng() * 0.15) * (rng() < 0.5 ? 1 : -1));
    q.multiplyQuaternions(qTilt, qYaw);

    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      q,
      new THREE.Vector3(s, s, s)
    );
    const visible = targetH - sink;
    (isB ? listB : listA).push({ m, big: visible > 0.9 });
    colliders.push({ x, z, r: 0.5 + visible * 0.45 });
  }

  for (const [geo, list] of [
    [geoA, listA],
    [geoB, listB]
  ] as [THREE.BufferGeometry, P[]][]) {
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    for (let i = 0; i < list.length; i++) mesh.setMatrixAt(i, list[i].m);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function buildObelisk(field: Heightfield, scene: THREE.Scene, colliders: Collider[]): void {
  const ox = -46;
  const oz = -127;
  const y0 = field.sampleHeight(ox, oz);
  const group = new THREE.Group();
  group.position.set(ox, y0, oz);

  const concrete = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.42, 0.42, 0.4),
    roughness: 0.95
  });
  const white = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.66, 0.66, 0.62),
    roughness: 0.85
  });

  // Plataforma, pedestal y fuste piramidal con remate.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 3.4), concrete);
  slab.position.y = 0.05;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.9, 1.15), white);
  plinth.position.y = 0.7;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.44, 3.4, 4, 1), white);
  shaft.rotation.y = Math.PI / 4;
  shaft.position.y = 2.8;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.5, 4), white);
  tip.rotation.y = Math.PI / 4;
  tip.position.y = 4.72;

  for (const m of [slab, plinth, shaft, tip]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  scene.add(group);
  colliders.push({ x: ox, z: oz, r: 1.6 });
}
