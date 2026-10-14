/**
 * Campo de nubes 2D compartido (GLSL) — la misma función define lo que se ve
 * en el cielo y la sombra que proyecta sobre el mundo (idea tomada del
 * sistema de sombras de nubes de "Three.js Sky Pro").
 *
 * El campo vive en un plano virtual a CLOUD_HEIGHT metros, anclado al mundo:
 * - El domo del cielo interseca la dirección de vista con ese plano.
 * - El terreno/pasto proyecta su posición hacia el plano a lo largo del sol.
 * Ambos muestrean cloudField() con las mismas coordenadas → correspondencia.
 *
 * Incluye "evolución": además de derivar con el viento, las formas mutan
 * fundiendo dos campos de ruido desfasados.
 */
export const CLOUD_HEIGHT = 600.0;
export const CLOUD_SCALE = 520.0;

export const CLOUD_GLSL = `
#define CS_CLOUD_H ${CLOUD_HEIGHT.toFixed(1)}
#define CS_CLOUD_SCALE ${CLOUD_SCALE.toFixed(1)}

float cshash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float csnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = cshash(i); float b = cshash(i + vec2(1.0, 0.0));
  float c = cshash(i + vec2(0.0, 1.0)); float d = cshash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float csfbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for (int k = 0; k < 4; k++){ v += a * csnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}

/** Deriva del viento en unidades del campo (misma dirección que el pasto). */
vec2 csWind(float t){
  return normalize(vec2(0.82, 0.44)) * t * 0.0115;
}

/**
 * Cobertura de nubes en el punto q del plano (coordenadas ya escaladas).
 * "soft" controla la suavidad del borde (0.14 nube nítida, ~0.3 penumbra).
 */
float cloudField(vec2 q, float t, float soft){
  vec2 p = q + csWind(t);
  float mask = csfbm(p * 0.18 + 11.7);
  float maskSm = smoothstep(0.34, 0.66, mask);
  // Evolución: fundido continuo entre dos campos desfasados.
  float ev = smoothstep(0.0, 1.0, abs(fract(t * 0.004) * 2.0 - 1.0));
  float n = mix(csfbm(p), csfbm(p + 61.7), ev);
  float thr = mix(0.72, 0.42, maskSm);
  return smoothstep(thr, thr + soft, n);
}

/** Sombra de nube (0 = despejado, 1 = sombra plena) sobre un punto del mundo. */
float cloudShadowAt(vec2 worldXZ, float worldY, vec3 sunDir, float t){
  vec2 q = (worldXZ + sunDir.xz / max(sunDir.y, 0.2) * (CS_CLOUD_H - worldY)) / CS_CLOUD_SCALE;
  return cloudField(q, t, 0.3);
}
`;
