import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { shared } from '../core/uniforms';
import { CLOUD_GLSL, CLOUD_HEIGHT, CLOUD_SCALE } from '../core/cloudGlsl';

/**
 * Cielo procedural (shader Sky), sol direccional con sombras
 * e iluminación ambiental IBL generada desde el propio cielo.
 */
export class SkyEnv {
  readonly sunDir: THREE.Vector3;
  readonly sun: THREE.DirectionalLight;
  private readonly shadowExtent = 95;
  private clouds!: THREE.Mesh;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, shadowMapSize: number) {
    // Dirección del sol: alto, detrás-derecha del punto de vista inicial.
    const elevation = THREE.MathUtils.degToRad(34);
    const azimuth = THREE.MathUtils.degToRad(38);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(
      1,
      Math.PI / 2 - elevation,
      azimuth
    );
    shared.uSunDir.value.copy(this.sunDir);

    // Cielo.
    const sky = new Sky();
    sky.scale.setScalar(45000);
    const u = sky.material.uniforms;
    u.turbidity.value = 2.6;
    u.rayleigh.value = 1.3;
    u.mieCoefficient.value = 0.0035;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(this.sunDir);

    // IBL: renderizar el cielo a un PMREM y usarlo como entorno.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky);
    const envRT = pmrem.fromScene(envScene);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.45;
    pmrem.dispose();

    // El cielo también se dibuja como fondo.
    scene.add(sky);

    // Niebla atmosférica sutil (perspectiva aérea hacia la montaña).
    scene.fog = new THREE.FogExp2(0xc6ddf2, 0.0012);

    this.createClouds(scene);

    // Sol direccional con sombras.
    const sun = new THREE.DirectionalLight(0xfff1da, 3.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const e = this.shadowExtent;
    sun.shadow.camera.left = -e;
    sun.shadow.camera.right = e;
    sun.shadow.camera.top = e;
    sun.shadow.camera.bottom = -e;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 450;
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.15;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
  }

  /**
   * Domo de nubes cúmulo: fbm animado proyectado sobre un plano virtual,
   * con agrupación en parches, bases sombreadas y borde iluminado hacia
   * el sol. Deriva lentamente en la misma dirección que el viento del pasto.
   */
  private createClouds(scene: THREE.Scene): void {
    const geo = new THREE.SphereGeometry(1750, 48, 20, 0, Math.PI * 2, 0, Math.PI * 0.56);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        uTime: shared.uTime,
        uSunDir: shared.uSunDir
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunDir;
        varying vec3 vDir;

        ${CLOUD_GLSL}

        void main() {
          vec3 dir = normalize(vDir);
          float hor = smoothstep(0.03, 0.18, dir.y);
          if (hor <= 0.002) discard;

          // Intersección de la vista con el plano de nubes: el campo queda
          // anclado al MUNDO (hay paralaje al caminar y las sombras que
          // proyecta sobre el suelo corresponden a lo que se ve arriba).
          float tPlane = (${CLOUD_HEIGHT.toFixed(1)} - cameraPosition.y) / max(dir.y, 0.035);
          vec2 q = (cameraPosition.xz + dir.xz * tPlane) / ${CLOUD_SCALE.toFixed(1)};

          float alpha = cloudField(q, uTime, 0.14);
          // Erosión fina en los bordes para que no queden "de algodón".
          alpha *= 0.8 + 0.35 * csnoise((q + csWind(uTime)) * 3.3 + 5.0);
          if (alpha <= 0.004) discard;

          // Bases sombreadas: densidad muestreada desplazada hacia el sol.
          vec2 sunOffs = normalize(uSunDir.xz + vec2(1e-4)) * 0.14;
          float dens = cloudField(q, uTime, 0.35);
          float densSun = cloudField(q + sunOffs, uTime, 0.35);
          float lit = clamp(0.95 + (dens - densSun) * 1.5, 0.7, 1.3);
          vec3 col = mix(vec3(0.62, 0.66, 0.74), vec3(1.12, 1.1, 1.05), clamp(lit, 0.0, 1.0));
          col += vec3(1.0, 0.95, 0.85) * max(lit - 1.0, 0.0);

          // Borde plateado alrededor del sol.
          col += vec3(0.35, 0.3, 0.22) * pow(max(dot(dir, uSunDir), 0.0), 12.0) * alpha;

          // Hacia el horizonte se funden con la bruma.
          col = mix(vec3(0.85, 0.9, 0.97), col, hor);

          gl_FragColor = vec4(col, alpha * hor * 0.94);
        }`
    });
    mat.fog = false;
    this.clouds = new THREE.Mesh(geo, mat);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 1;
    scene.add(this.clouds);
  }

  /**
   * El volumen de sombras sigue al jugador, ajustado a la cuadrícula de
   * texels del shadow map para evitar el parpadeo de bordes al caminar.
   */
  followPlayer(playerPos: THREE.Vector3): void {
    this.clouds.position.set(playerPos.x, 0, playerPos.z);
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;

    const dir = this.sunDir;
    const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const upv = new THREE.Vector3().crossVectors(right, dir).normalize();

    const tx = Math.round(playerPos.dot(right) / texel) * texel;
    const ty = Math.round(playerPos.dot(upv) / texel) * texel;
    const tz = playerPos.dot(dir);

    const snapped = new THREE.Vector3()
      .addScaledVector(right, tx)
      .addScaledVector(upv, ty)
      .addScaledVector(dir, tz);

    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(dir, 220);
  }
}
