import * as THREE from 'three';
import { mulberry32 } from '../core/noise';

/**
 * Generador de árboles por esqueleto recursivo, basado en el algoritmo de
 * ez-tree (https://github.com/dgreenheck/ez-tree, MIT, Daniel Greenheck):
 *
 * - Cada rama crece por secciones (anillos) cuya orientación se perturba con
 *   "gnarliness" y una fuerza de crecimiento hacia arriba.
 * - Las ramas hijas brotan a lo largo del padre con muestreo estratificado
 *   (franjas de altura y de ángulo barajadas, sin patrones visibles) y
 *   continúan la curva/radio del padre en el punto de anclaje.
 * - Las hojas son quads dobles cruzados en las ramas del último nivel, con
 *   normales "redondeadas" hacia fuera para un sombreado suave de copa.
 *
 * Reimplementado de forma autónoma para encajar con nuestro pipeline
 * (geometrías fusionadas para InstancedMesh + texturas procedurales).
 */

export interface TreeParams {
  seed: number;
  /** Niveles de recursión de ramas (3 = tronco + 3). */
  levels: number;
  /** Longitud por nivel [tronco, n1, n2, n3]. */
  length: number[];
  /** Radio absoluto del tronco. */
  trunkRadius: number;
  /** Multiplicador de radio para hijas por nivel (índice 1..levels). */
  radiusFactor: number[];
  /** Ángulo de las hijas respecto al padre, en grados (índice 1..levels). */
  angle: number[];
  /** Número de hijas por nivel (índice 0..levels-1). */
  children: number[];
  /** Fracción del padre donde empiezan a brotar hijas (índice 1..levels). */
  start: number[];
  /** Adelgazamiento del extremo por nivel (0..1). */
  taper: number[];
  /** Nudosidad por nivel. */
  gnarliness: number[];
  /** Anillos por nivel. */
  sections: number[];
  /** Segmentos radiales por nivel. */
  segments: number[];
  /** Fuerza de enderezado hacia arriba. */
  forceUp: number;
  /** null = árbol seco sin hojas. */
  leaves: {
    countPerTip: number;
    size: number;
    sizeVariance: number;
    angleDeg: number;
  } | null;
}

interface Section {
  origin: THREE.Vector3;
  quat: THREE.Quaternion;
  radius: number;
}

interface SkeletonBranch {
  sections: Section[];
  segments: number;
}

interface LeafPlacement {
  origin: THREE.Vector3;
  quat: THREE.Quaternion;
  size: number;
}

interface QueuedBranch {
  origin: THREE.Vector3;
  quat: THREE.Quaternion;
  length: number;
  radius: number;
  level: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Nivel de detalle para el mallado (estilo ez-tree): el mismo esqueleto se
 * puede mallar varias veces con distinta resolución sin consumir RNG.
 */
export interface MeshDetail {
  /** Muestrear 1 de cada N anillos (el primero y el último siempre quedan). */
  sectionStride?: number;
  /** Multiplicador de segmentos radiales (mínimo 3). */
  segmentFactor?: number;
  /** Conservar 1 de cada N hojas. */
  leafStride?: number;
  /** Escala de las hojas conservadas (compensa el raleo). */
  leafScale?: number;
  /** Un solo quad por hoja en vez de cruz doble (para lejos). */
  singleBillboard?: boolean;
}

export interface TreeSkeleton {
  branches: SkeletonBranch[];
  leaves: LeafPlacement[];
  hasLeaves: boolean;
}

/** Genera el esqueleto del árbol (todo el RNG ocurre aquí). */
export function growSkeleton(params: TreeParams): TreeSkeleton {
  const rng = mulberry32(params.seed);
  const branches: SkeletonBranch[] = [];
  const leaves: LeafPlacement[] = [];

  const queue: QueuedBranch[] = [
    {
      origin: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      length: params.length[0],
      radius: params.trunkRadius,
      level: 0
    }
  ];

  while (queue.length > 0) {
    growBranch(queue.shift()!, params, rng, queue, branches, leaves);
  }

  return { branches, leaves, hasLeaves: params.leaves !== null };
}

/** Malla un esqueleto al detalle indicado. */
export function meshSkeleton(
  skeleton: TreeSkeleton,
  detail: MeshDetail = {}
): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry | null } {
  const trunk = meshBranches(
    skeleton.branches,
    Math.max(1, Math.floor(detail.sectionStride ?? 1)),
    detail.segmentFactor ?? 1
  );
  const leaves = skeleton.hasLeaves
    ? meshLeaves(
        skeleton.leaves,
        Math.max(1, Math.floor(detail.leafStride ?? 1)),
        detail.leafScale ?? 1,
        detail.singleBillboard ?? false
      )
    : null;
  return { trunk, leaves };
}

function growBranch(
  branch: QueuedBranch,
  p: TreeParams,
  rng: () => number,
  queue: QueuedBranch[],
  branches: SkeletonBranch[],
  leaves: LeafPlacement[]
): void {
  const sectionCount = p.sections[branch.level];
  const sectionLength = branch.length / sectionCount;
  const taper = p.taper[branch.level];

  const quat = branch.quat.clone();
  const origin = branch.origin.clone();
  const sections: Section[] = [];

  for (let i = 0; i <= sectionCount; i++) {
    let radius = branch.radius;
    if (i === sectionCount && branch.level === p.levels) {
      radius = 0.02; // punta casi afilada (0 exacto produce motas de aliasing)
    } else {
      radius *= 1 - taper * (i / sectionCount);
    }

    sections.push({ origin: origin.clone(), quat: quat.clone(), radius });

    // Avanzar a la siguiente sección siguiendo la orientación actual.
    origin.add(new THREE.Vector3(0, sectionLength, 0).applyQuaternion(quat));

    // Nudosidad: cuanto más delgada la rama, más se retuerce.
    const g = Math.max(1, 1 / Math.sqrt(Math.max(radius, 0.01))) * p.gnarliness[branch.level];
    quat.multiply(
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler((rng() * 2 - 1) * g, 0, (rng() * 2 - 1) * g)
      )
    );

    // Fuerza de crecimiento: endereza la rama hacia la vertical, más
    // fuerte cuanto más delgada (rotación en el eje up×objetivo).
    const sectionUp = UP.clone().applyQuaternion(quat);
    const axis = new THREE.Vector3().crossVectors(sectionUp, UP);
    const sinFull = axis.length();
    if (sinFull > 1e-6) {
      axis.divideScalar(sinFull);
      const fullAngle = Math.atan2(sinFull, sectionUp.dot(UP));
      const step = p.forceUp / Math.max(radius, 0.02);
      const clamped = Math.max(-fullAngle, Math.min(fullAngle, step));
      quat.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, clamped));
    }
  }

  branches.push({ sections, segments: p.segments[branch.level] });

  const last = sections[sections.length - 1];

  if (branch.level < p.levels) {
    // Rama terminal: continúa la punta del padre (sella la unión).
    queue.push({
      origin: last.origin.clone(),
      quat: last.quat.clone(),
      length: p.length[branch.level + 1],
      radius: last.radius,
      level: branch.level + 1
    });
    spawnChildren(branch.level + 1, sections, p, rng, queue);
  } else if (p.leaves) {
    // Última rama: hoja en la punta + hojas a lo largo.
    recordLeaf(last.origin, last.quat, p, rng, leaves);
    spawnLeaves(sections, p, rng, leaves);
  }
}

/** Interpola origen/orientación/radio del padre en la fracción t (0..1). */
function sampleParent(
  sections: Section[],
  t: number
): { origin: THREE.Vector3; quat: THREE.Quaternion; radius: number } {
  const idx = Math.min(Math.floor(t * (sections.length - 1)), sections.length - 2);
  const alpha = t * (sections.length - 1) - idx;
  const a = sections[idx];
  const b = sections[idx + 1];
  return {
    origin: new THREE.Vector3().lerpVectors(a.origin, b.origin, alpha),
    quat: a.quat.clone().slerp(b.quat, alpha),
    radius: a.radius * (1 - alpha) + b.radius * alpha
  };
}

/** Baraja de índices 0..n-1 (Fisher-Yates con el RNG del árbol). */
function shuffled(n: number, rng: () => number): number[] {
  const arr = Array.from({ length: n }, (_, k) => k);
  for (let k = n - 1; k > 0; k--) {
    const r = Math.floor(rng() * (k + 1));
    [arr[k], arr[r]] = [arr[r], arr[k]];
  }
  return arr;
}

function spawnChildren(
  level: number,
  parentSections: Section[],
  p: TreeParams,
  rng: () => number,
  queue: QueuedBranch[]
): void {
  const count = p.children[level - 1];
  const startMin = p.start[level];
  const heightStep = (1 - startMin) / count;
  const radialOffset = rng();
  const slots = shuffled(count, rng);
  const angleRad = THREE.MathUtils.degToRad(p.angle[level]);

  for (let i = 0; i < count; i++) {
    // Muestreo estratificado: franja de altura i con jitter, franja de
    // ángulo barajada — reparto uniforme sin espirales visibles.
    const t = startMin + (i + rng()) * heightStep;
    const at = sampleParent(parentSections, Math.min(t, 1));
    const radialAngle = 2 * Math.PI * (radialOffset + (slots[i] + rng() - 0.5) / count);

    const quat = at.quat
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(UP, radialAngle))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angleRad));

    queue.push({
      origin: at.origin,
      quat,
      length: p.length[level] * (0.7 + rng() * 0.6),
      radius: at.radius * p.radiusFactor[level],
      level
    });
  }
}

function spawnLeaves(
  parentSections: Section[],
  p: TreeParams,
  rng: () => number,
  leaves: LeafPlacement[]
): void {
  const count = p.leaves!.countPerTip;
  const heightStep = 1 / count;
  const radialOffset = rng();
  const slots = shuffled(count, rng);
  const angleRad = THREE.MathUtils.degToRad(p.leaves!.angleDeg);

  for (let i = 0; i < count; i++) {
    const t = Math.min((i + rng()) * heightStep, 1);
    const at = sampleParent(parentSections, t);
    const radialAngle = 2 * Math.PI * (radialOffset + (slots[i] + rng() - 0.5) / count);
    const quat = at.quat
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(UP, radialAngle))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angleRad));
    recordLeaf(at.origin, quat, p, rng, leaves);
  }
}

function recordLeaf(
  origin: THREE.Vector3,
  quat: THREE.Quaternion,
  p: TreeParams,
  rng: () => number,
  leaves: LeafPlacement[]
): void {
  const v = p.leaves!.sizeVariance;
  leaves.push({
    origin: origin.clone(),
    quat: quat.clone(),
    size: p.leaves!.size * (1 + (rng() * 2 - 1) * v)
  });
}

/** Malla tubular: anillos de vértices por sección, unidos con quads. */
function meshBranches(
  branches: SkeletonBranch[],
  sectionStride: number,
  segmentFactor: number
): THREE.BufferGeometry {
  const verts: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const branch of branches) {
    // Muestrear 1 de cada N anillos, conservando siempre el último para que
    // las puntas y las uniones padre/hija no se muevan entre niveles.
    const sections: Section[] = [];
    for (let i = 0; i < branch.sections.length; i += sectionStride) {
      sections.push(branch.sections[i]);
    }
    if ((branch.sections.length - 1) % sectionStride !== 0) {
      sections.push(branch.sections[branch.sections.length - 1]);
    }
    const segments = Math.max(3, Math.round(branch.segments * segmentFactor));
    const base = verts.length / 3;
    const N = segments + 1;

    for (let k = 0; k < sections.length; k++) {
      const s = sections[k];
      for (let j = 0; j <= segments; j++) {
        const angle = (2 * Math.PI * (j % segments)) / segments;
        const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).applyQuaternion(s.quat);
        verts.push(
          s.origin.x + dir.x * s.radius,
          s.origin.y + dir.y * s.radius,
          s.origin.z + dir.z * s.radius
        );
        normals.push(dir.x, dir.y, dir.z);
        // uv.y alterna 0/1 por anillo para tilear la corteza.
        uvs.push(j / segments, k % 2);
      }
    }

    for (let k = 0; k < sections.length - 1; k++) {
      for (let j = 0; j < segments; j++) {
        const v1 = base + k * N + j;
        const v2 = base + k * N + j + 1;
        const v3 = v1 + N;
        const v4 = v2 + N;
        indices.push(v1, v3, v2, v2, v3, v4);
      }
    }
  }

  return buildGeometry(verts, normals, uvs, indices);
}

/** Hojas: quads cruzados por hoja, con normales redondeadas. */
function meshLeaves(
  leaves: LeafPlacement[],
  leafStride: number,
  leafScale: number,
  singleBillboard: boolean
): THREE.BufferGeometry {
  const verts: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rotations = singleBillboard ? [0] : [0, Math.PI / 2];

  const corner = new THREE.Vector3();
  for (let li = 0; li < leaves.length; li += leafStride) {
    const leaf = leaves[li];
    const W = leaf.size * leafScale;
    const L = leaf.size * leafScale;
    for (const rot of rotations) {
      const i0 = verts.length / 3;
      const rotQ = new THREE.Quaternion()
        .copy(leaf.quat)
        .multiply(new THREE.Quaternion().setFromAxisAngle(UP, rot));
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(rotQ);

      const corners: [number, number][] = [
        [-W / 2, L],
        [-W / 2, 0],
        [W / 2, 0],
        [W / 2, L]
      ];
      for (const [cx, cy] of corners) {
        corner.set(cx, cy, 0).applyQuaternion(rotQ).add(leaf.origin);
        verts.push(corner.x, corner.y, corner.z);
        // Normal redondeada: media entre la normal del quad y la dirección
        // desde la base de la hoja — la copa se sombrea como un volumen.
        const rn = new THREE.Vector3()
          .copy(n)
          .add(corner.clone().sub(leaf.origin).normalize())
          .normalize();
        normals.push(rn.x, rn.y, rn.z);
      }
      uvs.push(0, 1, 0, 0, 1, 0, 1, 1);
      indices.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    }
  }

  return buildGeometry(verts, normals, uvs, indices);
}

function buildGeometry(
  verts: number[],
  normals: number[],
  uvs: number[],
  indices: number[]
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeBoundingSphere();
  return g;
}
