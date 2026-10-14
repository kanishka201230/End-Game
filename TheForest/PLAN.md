# TheForest — Plan de desarrollo

> **Estado (2020-12-14):** Fases 0–6 completas y muy ampliadas después: cerro con sendero a la cumbre,
> efigie del Marcador (STL decimado) con glifos latientes, anillo de cristales, dron con IA de inspección,
> nubes con sombras móviles, material fotogramétrico en el camino, LOD de árboles y despliegue estático verificado.
> Documentación completa en [README.md](README.md) y [ARCHITECTURE.md](ARCHITECTURE.md).
> Pendiente: audio posicional (zumbido de efigie/dron), ciclo día/noche, gameplay.

Juego en primera persona con WebGL + Three.js. Objetivo visual: un bosque realista en una ladera — pasto alto y denso iluminado por el sol, árboles caducifolios, troncos secos, rocas y un pico de montaña al fondo bajo un cielo azul con nubes (ver imagen de referencia).

---

## 1. Análisis de la imagen de referencia

Elementos que hay que reproducir para lograr ese look:

| Elemento | Técnica en Three.js |
|---|---|
| Ladera con pendiente suave | Terreno por heightmap (malla desplazada) |
| Pasto alto, denso y retroiluminado | `InstancedMesh` con miles de matas (tarjetas con alpha), shader de viento y translucidez |
| Árboles frondosos + árboles secos | Modelos GLTF instanciados con LOD (malla → billboard) |
| Rocas y tocones | GLTF con texturas PBR fotogramétricas |
| Pico rocoso al fondo | Malla lejana de bajo detalle + niebla atmosférica |
| Cielo azul con nubes dispersas | HDRI de cielo (iluminación IBL) o shader `Sky` |
| Luz solar cálida, sombras largas | `DirectionalLight` con CSM (cascaded shadow maps) |
| Aspecto fotográfico | Tone mapping ACES, exposición ajustada, postproceso (bloom, SSAO, viñeta, color grading) |

La clave del realismo no es un solo efecto sino la suma: iluminación basada en imagen (IBL), materiales PBR, sombras de calidad, densidad de vegetación y postproceso.

---

## 2. Stack tecnológico

- **Three.js** (última versión) — motor de render WebGL2.
- **Vite** — dev server y bundler (arranque instantáneo, HMR).
- **TypeScript** — robustez en un proyecto que crecerá.
- **three/examples/jsm** — `Sky`, `PointerLockControls`, loaders GLTF/KTX2/Draco.
- **postprocessing** (pmndrs) — pipeline de efectos más rápido y de mejor calidad que EffectComposer clásico.
- **three-csm** o implementación propia — sombras en cascada para exteriores grandes.
- **stats-gl / lil-gui** — medición de FPS y paneles de ajuste en desarrollo.
- **Howler.js** o `THREE.Audio` — audio posicional y ambiental.

Assets (gratuitos, licencia CC0/libre):
- **Poly Haven** — texturas PBR de suelo/roca, HDRIs de cielo, algunos modelos.
- **Quixel Megascans** (con cuenta Epic) o **ambientCG** — texturas fotogramétricas.
- **Sketchfab (CC0/CC-BY)** — árboles, tocones, rocas en GLTF.
- Alternativa procedural: **ez-tree** para generar árboles ajustables.

---

## 3. Estructura del proyecto

```
TheForest/
├── index.html
├── vite.config.ts
├── package.json
├── public/
│   └── assets/
│       ├── models/        (GLTF/GLB: árboles, rocas, tocones)
│       ├── textures/      (KTX2: suelo, pasto, corteza, roca)
│       ├── hdri/          (cielo .hdr)
│       └── audio/         (viento, aves, pasos)
└── src/
    ├── main.ts            (bootstrap, loop de render)
    ├── core/
    │   ├── Engine.ts      (renderer, escena, cámara, resize, clock)
    │   ├── AssetManager.ts(carga con LoadingManager + pantalla de carga)
    │   └── Quality.ts     (presets bajo/medio/alto)
    ├── world/
    │   ├── Terrain.ts     (heightmap, splatting, colisión por altura)
    │   ├── Sky.ts         (HDRI/Sky shader, sol, niebla)
    │   ├── Grass.ts       (instancing + shader de viento)
    │   ├── Vegetation.ts  (scatter de árboles/rocas con LOD)
    │   └── Mountain.ts    (fondo lejano)
    ├── player/
    │   ├── FirstPersonController.ts (movimiento, gravedad, sprint, head-bob)
    │   └── Footsteps.ts   (sonido de pasos según superficie)
    ├── fx/
    │   └── PostProcessing.ts (SSAO, bloom, viñeta, grading, antialiasing)
    └── audio/
        └── Ambience.ts    (viento, aves, capa espacial)
```

---

## 4. Fases de desarrollo

### Fase 0 — Setup (½ día)
- `npm create vite@latest` con plantilla vanilla-ts.
- Instalar `three`, `@types/three`, `postprocessing`, `lil-gui`, `stats-gl`.
- Renderer con `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, sombras PCF soft activadas, pixel ratio limitado a 2.
- Loop de render con delta time; escena de prueba (cubo + luz) para validar el pipeline.
- **Hito:** proyecto corre en `localhost` con HMR.

### Fase 1 — Terreno y controlador en primera persona (2–3 días)
- Generar heightmap de la ladera (ruido simplex/fBm con pendiente base, o pintado en Krita/Gimp y cargado como textura).
- `PlaneGeometry` subdividida (p. ej. 256×256 sobre 400×400 m) desplazada por el heightmap; recalcular normales.
- Material del suelo: splatting de 2–3 capas (tierra/pasto seco/roca) mezcladas por pendiente y altura en un `ShaderMaterial` u `onBeforeCompile` sobre `MeshStandardMaterial`.
- Controlador FP: `PointerLockControls` + WASD, sprint (Shift), gravedad simple.
- Colisión con el terreno **muestreando la altura del heightmap** (barato y estable; sin física completa). Altura de ojos ~1.7 m.
- Head-bob sutil y suavizado de la cámara al subir pendientes.
- **Hito:** caminar por la ladera con el mouse bloqueado, sin atravesar el suelo.

### Fase 2 — Cielo, luz y atmósfera (1–2 días)
- HDRI de cielo despejado (Poly Haven, 2K para IBL) como `scene.environment` → iluminación ambiental realista gratis. `scene.background` con el mismo HDRI o el shader `Sky`.
- `DirectionalLight` alineada con el sol del HDRI; sombras CSM (3 cascadas) para que haya sombras nítidas cerca y cobertura lejos.
- Niebla: `FogExp2` muy sutil azulada para dar profundidad aérea a la montaña del fondo.
- Ajustar exposición (`toneMappingExposure`) hasta que el pasto "queme" ligeramente al sol como en la referencia.
- **Hito:** el terreno vacío ya se ve fotográfico (luz + cielo + niebla).

### Fase 3 — Pasto (el elemento más importante) (3–4 días)
- Geometría: 2–3 cruces de quads por mata con textura alpha de pasto alto (atlas con variaciones verde/amarillo).
- `InstancedMesh` con 100k–300k instancias distribuidas por chunks alrededor del jugador; densidad decae con la distancia.
- Shader (vertex): balanceo por viento con ruido (dos frecuencias: brisa global + agitación fina), curvado desde la base.
- Shader (fragment): gradiente de color raíz→punta (oscuro→amarillo cálido), translucidez falsa (backlight cuando el sol queda detrás), variación de tono por instancia.
- Los billboards de pasto **no proyectan sombra** (carísimo); reciben una sombra aproximada del terreno.
- Chunks: regenerar/reciclar instancias al moverse el jugador; fade-out por distancia (~60–80 m) disuelto con dithering.
- **Hito:** ladera cubierta de pasto denso ondeando al viento a 60 FPS.

### Fase 4 — Árboles, rocas y detalles (3–4 días)
- 3–4 especies: árbol frondoso (2 variantes), árbol seco sin hojas, pino joven. GLTF optimizados (< 15k tris el LOD0).
- Follaje con `alphaTest` (no transparencia ordenada) y `side: DoubleSide`; normales del follaje "esferizadas" para sombreado suave.
- Instanciado + LOD: LOD0 malla completa (< 50 m), LOD1 malla reducida (< 120 m), LOD2 billboard impostor (resto).
- Viento leve en copas (vertex shader, misma señal de viento que el pasto para coherencia).
- Scatter procedural con semilla fija: árboles evitan pendientes fuertes, claros donde pasa la "senda" de tierra visible en la referencia.
- Rocas, tocones y troncos caídos colocados a mano (los 4–6 puntos focales) + scatter menor.
- Montaña del fondo: malla low-poly con textura de roca, siempre tras la niebla.
- Colisión con árboles/rocas: cilindros/esferas invisibles chequeados en el controlador (barato).
- **Hito:** la escena completa replica la composición de la referencia.

### Fase 5 — Postproceso y calidad de imagen (1–2 días)
- Pipeline con `postprocessing`: SMAA o TAA, **SSAO/GTAO** (asienta pasto y árboles al suelo), **bloom sutil** (el sol sobre el pasto), viñeta ligera, color grading (LUT cálida, +contraste, +saturación en verdes).
- Opcional si el presupuesto de GPU lo permite: god rays desde el sol entre los árboles, motion blur muy leve.
- **Hito:** captura de pantalla comparable lado a lado con la referencia.

### Fase 6 — Audio y vida (1–2 días)
- Capa ambiente: viento + aves (loop estéreo con variación aleatoria).
- Pasto/hojas: intensidad del sonido de viento ligada a la señal de viento del shader.
- Pasos con variación aleatoria de pitch, cadencia ligada a la velocidad; distinto en tierra vs pasto.
- Opcional: partículas de polen/insectos flotando a contraluz (muy barato, mucho realismo).
- **Hito:** cerrar los ojos y "estar" en el bosque.

### Fase 7 — Rendimiento y entrega (2–3 días)
- Texturas a **KTX2/Basis** (GPU-compressed) y geometría con **Draco/meshopt**.
- Presets de calidad (bajo/medio/alto): densidad de pasto, distancia de sombras, resolución de render, efectos activos. Auto-detección inicial midiendo FPS los primeros segundos.
- Presupuesto objetivo: **60 FPS en GPU media** (~4–6 ms de pasto, ~3 ms sombras, ~2 ms postproceso).
- Pantalla de carga con progreso real (`LoadingManager`), menú mínimo (jugar / calidad / sensibilidad), pointer-lock al hacer clic.
- `vite build` → carpeta `dist/` estática; se sirve desde cualquier hosting (o este mismo XAMPP).
- **Hito:** build de producción jugable, < 40 MB de descarga inicial.

---

## 5. Riesgos y decisiones ya tomadas

- **El pasto es el mayor riesgo de rendimiento.** Por eso se hace en fase temprana (3) con instancing + chunks + fade. Si una GPU no llega, el preset "bajo" reduce densidad, no lo elimina.
- **Sombras en exteriores grandes** se resuelven con CSM desde el inicio; una sola shadow map nunca se verá bien a esta escala.
- **Sin motor de física completo** (Rapier/Cannon): para caminar por un terreno con colisiones simples, muestrear el heightmap + colisores cilíndricos es más estable y gratis en rendimiento. Se puede añadir física después si el gameplay lo pide.
- **Transparencia del follaje:** siempre `alphaTest`/alpha-to-coverage, nunca blending ordenado (evita el clásico bug de hojas que desaparecen).
- **Orden de las fases importa:** luz y atmósfera (fase 2) antes que vegetación — ajustar materiales con la iluminación final evita retrabajar colores.

## 6. Estimación total

**~2.5 a 3.5 semanas** de trabajo efectivo para la escena caminable con calidad de la referencia. El "gameplay" adicional (objetivos, interacción, HUD) se planificaría encima de esta base.
