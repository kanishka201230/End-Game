import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect
} from 'postprocessing';

/**
 * Pipeline HDR: render -> bloom -> tone mapping ACES -> SMAA + viñeta.
 * El tone mapping del renderer queda desactivado (lo hace el composer).
 */
export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera
): EffectComposer {
  renderer.toneMapping = THREE.NoToneMapping;

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType
  });

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    intensity: 0.5,
    luminanceThreshold: 0.8,
    luminanceSmoothing: 0.25,
    mipmapBlur: true
  });

  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });

  const smaa = new SMAAEffect();
  const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.42 });

  composer.addPass(new EffectPass(camera, bloom, tone));
  composer.addPass(new EffectPass(camera, smaa, vignette));

  return composer;
}
