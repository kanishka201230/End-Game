import * as THREE from 'three';
import { Heightfield, WORLD_SIZE } from './heightfield';
import { grassTuftTexture } from '../core/textures';
import { mulberry32, fbm2 } from '../core/noise';
import { shared } from '../core/uniforms';
import { CLOUD_GLSL } from '../core/cloudGlsl';

/**
 * Pradera de pasto alto: un solo InstancedMesh de matas cruzadas.
 *
 * Las instancias viven en una cuadrícula fija alrededor del origen y el
 * vertex shader las "envuelve" (wrap) alrededor del jugador, de modo que el
 * campo de pasto lo sigue infinitamente sin tocar la CPU. La altura del
 * terreno y la máscara (sendero/roca) también se muestrean en el shader
 * desde la textura del heightfield.
 */
export function createGrass(field: Heightfield, count: number): THREE.InstancedMesh {
  // Media anchura del cuadrado de pasto que rodea al jugador.
  const HALF = 110;
  // El desvanecimiento termina antes de la esquina del cuadrado de wrap.
  const FADE_START = 76;
  const FADE_END = 104;

  // Geometría de la mata: 3 planos cruzados con ligera curva.
  const planes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const p = new THREE.PlaneGeometry(1.15, 1.3, 1, 2);
    p.translate(0, 0.65, 0);
    p.rotateY((i * Math.PI) / 3);
    planes.push(p);
  }
  const geo = mergePlanes(planes);

  const mat = new THREE.MeshStandardMaterial({
    map: grassTuftTexture(),
    alphaTest: 0.32,
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uPlayer = shared.uPlayer;
    shader.uniforms.uSunDir = shared.uSunDir;
    shader.uniforms.uField = { value: field.texture };
    shader.uniforms.uWorld = { value: WORLD_SIZE };
    shader.uniforms.uHalf = { value: HALF };
    shader.uniforms.uFadeStart = { value: FADE_START };
    shader.uniforms.uFadeEnd = { value: FADE_END };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uPlayer;
        uniform sampler2D uField;
        uniform float uWorld;
        uniform float uHalf;
        uniform float uFadeStart;
        uniform float uFadeEnd;
        varying vec3 vGWPos;
        float ghash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }`
      )
      .replace(
        '#include <project_vertex>',
        `
        mat3 gRS = mat3(instanceMatrix);
        vec2 gCell = instanceMatrix[3].xz;

        // Wrap toroidal alrededor del jugador.
        vec2 gRel = mod(gCell - uPlayer + uHalf, 2.0 * uHalf) - uHalf;
        vec2 gXZ = uPlayer + gRel;

        vec4 gFld = texture2D(uField, gXZ / uWorld + 0.5);
        float gH = gFld.r;
        float gMask = gFld.g;
        float gRnd = ghash(gCell);

        // Sin pasto en sendero/roca; transición suave con umbral aleatorio.
        float gScale = smoothstep(0.2, 0.7, gMask + (gRnd - 0.5) * 0.25);

        // Lejos de la cámara la mata se encoge hasta hundirse en el suelo:
        // el pasto aparece "creciendo" en vez de hacer pop.
        float gDistCam = distance(cameraPosition.xz, gXZ);
        gScale *= 1.0 - smoothstep(uFadeStart, uFadeEnd, gDistCam + (gRnd - 0.5) * 12.0);

        vec3 gP = gRS * (transformed * gScale);

        // Viento: brisa amplia + agitación fina, curvado desde la base.
        float hf = clamp(position.y / 1.2, 0.0, 1.0);
        hf *= hf;
        float t = uTime;
        float w1 = sin(t * 1.35 + gXZ.x * 0.13 + gXZ.y * 0.09);
        float w2 = sin(t * 2.8 + gXZ.x * 0.8 + gXZ.y * 0.6 + gRnd * 6.283) * 0.5;
        float gust = 0.6 + 0.4 * sin(t * 0.37 + gXZ.x * 0.021 + gXZ.y * 0.017);
        vec2 sway = normalize(vec2(0.82, 0.44)) * (w1 + w2) * 0.22 * gust * hf * (0.6 + 0.75 * gRnd);

        vec3 gWP = vec3(gXZ.x + gP.x + sway.x, gH + gP.y - 0.05, gXZ.y + gP.z + sway.y);
        vGWPos = gWP;

        vec4 mvPosition = viewMatrix * vec4(gWP, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        `
      )
      .replace(
        '#include <worldpos_vertex>',
        `vec4 worldPosition = vec4( vGWPos, 1.0 );`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGWPos;
        uniform vec3 uSunDir;
        uniform float uFadeStart;
        uniform float uFadeEnd;
        uniform float uTime;
        ${CLOUD_GLSL}`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float gDist = distance(cameraPosition, vGWPos);
        diffuseColor.a *= 1.0 - smoothstep(uFadeStart, uFadeEnd * 1.04, gDist);
        // Sombras de las nubes (mismo campo que el domo del cielo).
        diffuseColor.rgb *= 1.0 - cloudShadowAt(vGWPos.xz, vGWPos.y, uSunDir, uTime) * 0.42;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Translucidez falsa: el pasto brilla a contraluz del sol.
        vec3 gToFrag = normalize(vGWPos - cameraPosition);
        float gBack = pow(clamp(dot(gToFrag, uSunDir), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * gBack * 0.7;`
      );
  };

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  // Distribución fija en el cuadrado [-HALF, HALF]^2 (el wrap hace el resto).
  const rng = mulberry32(90210);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const x = (rng() * 2 - 1) * HALF;
    const z = (rng() * 2 - 1) * HALF;
    const s = 0.85 + rng() * 0.8;
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.85 + rng() * 0.4), s));
    mesh.setMatrixAt(i, m);

    // Parches secos amarillentos según ruido de baja frecuencia.
    const dry = THREE.MathUtils.clamp(fbm2(x * 0.03 + 3.7, z * 0.03 + 9.1, 3, 77) * 1.8 - 0.4, 0, 1);
    col.setRGB(
      (0.80 + 0.30 * dry) * (0.9 + rng() * 0.16),
      (0.92 + 0.10 * dry) * (0.9 + rng() * 0.16),
      (0.82 - 0.30 * dry) * (0.88 + rng() * 0.2)
    );
    mesh.setColorAt(i, col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return mesh;
}

/** Une varios PlaneGeometry (posición/normal/uv indexados) en una sola geometría. */
function mergePlanes(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let offset = 0;

  for (const g of list) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      uvs.push(uv.getX(i), uv.getY(i));
    }
    const idx = g.index!;
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + offset);
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
