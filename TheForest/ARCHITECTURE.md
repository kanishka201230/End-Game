# Arquitectura técnica de The Forest

Documentación profunda de cada sistema del juego: algoritmos, shaders, formatos
binarios, decisiones de diseño y los *gotchas* reales encontrados durante el
desarrollo. Complementa al [README](README.md).

**Autor: Jose Alexis Correa Valencia**

---

## Índice

1. [Motor y bucle principal](#1-motor-y-bucle-principal)
2. [Terreno](#2-terreno)
3. [Pradera de pasto](#3-pradera-de-pasto)
4. [Bosque y árboles procedurales](#4-bosque-y-árboles-procedurales)
5. [Cielo, nubes y sombras de nubes](#5-cielo-nubes-y-sombras-de-nubes)
6. [La cumbre: efigie, cristales y pipeline de assets](#6-la-cumbre-efigie-cristales-y-pipeline-de-assets)
7. [El dron](#7-el-dron)
8. [Audio procedural](#8-audio-procedural)
9. [Controlador de primera persona](#9-controlador-de-primera-persona)
10. [Postproceso y color](#10-postproceso-y-color)
11. [Rendimiento](#11-rendimiento)
12. [Gotchas recopilados](#12-gotchas-recopilados)

---

## 1. Motor y bucle principal

**Archivo:** [src/core/Engine.ts](src/core/Engine.ts)

`Engine` orquesta todo: crea el `WebGLRenderer` (sombras PCF soft, tone mapping
delegado al postproceso), construye el mundo por fases asíncronas (cada fase
cede al DOM para que la barra de carga avance de verdad) y ejecuta el bucle.

Orden de construcción — importa, porque hay dependencias:

```
Heightfield → SkyEnv (luz+IBL) → Terrain → Grass → Forest → Rocas/Troncos
→ Landmarks (efigie/cristales, async) → Drone → Motes → Controller → Audio
→ Composer → reparto inicial de LOD → compileAsync (precompila shaders)
```

Por frame: `controller.update` → uniforms compartidos (`uTime`, `uPlayer`) →
`sky.followPlayer` (sombras + domo de nubes) → `forestUpdate` (LOD) →
`drone.update` → `motes.update` → `audio.update` → `composer.render`.

Los **uniforms compartidos** viven en [src/core/uniforms.ts](src/core/uniforms.ts):
un único objeto `{uTime, uPlayer, uSunDir}` que se inyecta por referencia en
todos los materiales — un solo punto de actualización, coherencia total (el
viento del pasto, el de las copas, la deriva de nubes y el audio usan la misma
señal temporal).

**Presets de calidad** (`?q=low|med|high`): densidad de pasto (45k/130k/220k),
resolución de sombras (2048/3072/4096) y tope de pixel ratio (1.25/1.6/2).

---

## 2. Terreno

**Archivos:** [src/world/heightfield.ts](src/world/heightfield.ts),
[src/world/Terrain.ts](src/world/Terrain.ts)

### 2.1 Heightfield analítico

La altura es una función pura `terrainHeight(x, z)` compuesta por:

- pendiente base que sube hacia −Z (~5.5%),
- tres octavas de fBm (colinas amplias, ondulación media, detalle),
- **cerro principal**: domo `height·(1−d/r)^1.25` con ondulación suave — la
  exponente baja lo mantiene caminable (~24° máx),
- loma del sendero, loma menor, **casquete de cumbre** (+4.2 m en r=14 que
  garantiza que la efigie corone el máximo global — verificado numéricamente:
  el máximo del terreno, 73.5 m, cae exactamente en `SUMMIT`),
- cordón de colinas de fondo en el borde del mundo (r>215).

Se muestrea a una cuadrícula de **512×512** (CPU, `Float32Array`) para colisión
y scatter, y se sube a GPU como `DataTexture` **RGBA16F** (R=altura, G=máscara
de pasto) — half float porque su filtrado lineal es core en WebGL2 (el de 32F
requiere extensión).

### 2.2 Máscara de pasto

`G` codifica dónde crece pasto (1) y dónde hay suelo desnudo (0):

- corte por pendiente (>0.56), raleo por altura en el cerro, calvas de erosión
  por fBm umbralizado,
- **sendero**: distancia a una polilínea de 13 puntos que va de la pradera a la
  cumbre; angosto abajo (`smooth(0.7, 1.9, d)`) y ancho/erosionado cuesta
  arriba (+1.5 m del umbral con la altura),
- explanada pisoteada alrededor de la efigie (r 5–10 m).

La misma máscara gobierna: color del terreno, presencia de matas de pasto
(leída en el vertex shader del pasto), scatter de árboles y colisión visual.
**Un solo dato, cinco sistemas coherentes.**

### 2.3 Shader de splatting

`MeshStandardMaterial` + `onBeforeCompile` (patrón usado en todo el proyecto:
conserva sombras, niebla y PBR de three, inyectando chunks GLSL):

- **Pasto**: verdes por parches (fBm), amarillea con la altura del cerro.
- **Suelo desnudo**: material fotogramétrico **Rockwall** — albedo sRGB +
  normal map tangente, tileados a **5.5 m** con envoltura espejada, muestreados
  con `vNormalMapUv`. El **relieve macro** (`relief.bin`, horneado del OBJ que
  es el displacement de ese mismo material) modula el albedo (hondonadas
  oscuras) con las **mismas UVs** → color y relieve corresponden punto a punto.
- El normal map se aplica en un `normal_fragment_maps` sobreescrito usando
  `getTangentFrame`, con la intensidad **enmascarada por `gDirtW·flatW`**: el
  pasto conserva su normal geométrica.
- **Roca gris** solo en cortes casi verticales (pendiente >0.62).
- Grano de detalle en 2 escalas, oclusión falsa bajo pasto denso, y
  **sombras de nubes** (ver §5).

---

## 3. Pradera de pasto

**Archivo:** [src/world/Grass.ts](src/world/Grass.ts)

El sistema más denso del juego: **un único `InstancedMesh`** de hasta 220 000
matas (3 quads cruzados con textura de brizna dibujada en canvas).

### El truco central: wrap toroidal en GPU

Las instancias se distribuyen una sola vez en un cuadrado fijo de ±110 m.
En el vertex shader:

```glsl
vec2 rel = mod(cell - uPlayer + uHalf, 2.0 * uHalf) - uHalf;
vec2 worldXZ = uPlayer + rel;          // la mata "reaparece" delante
float h    = texture2D(uField, worldXZ / uWorld + 0.5).r;  // altura
float mask = texture2D(uField, ...).g;                     // ¿hay pasto aquí?
```

El campo de pasto **sigue al jugador infinitamente sin tocar la CPU**: ni
rescatter, ni chunks, ni re-subida de buffers. La altura del terreno y la
máscara del sendero se leen de la `DataTexture` del heightfield.

Detalles que venden el efecto:

- **Viento**: brisa amplia + agitación fina + ráfagas lentas, curvando desde la
  base (`hf²`); la misma dirección `(0.82, 0.44)` que nubes, copas y audio.
- **Translucidez falsa**: emisivo proporcional a `dot(vista, sol)³` — el pasto
  arde a contraluz.
- **Desvanecimiento por hundimiento** (76–104 m): la mata se encoge hasta
  desaparecer bajo el suelo, con umbral aleatorio por instancia — el pasto
  lejano "crece" del terreno en vez de hacer pop (el borde del cuadrado de
  wrap queda siempre más lejos que el fade).
- Tinte por instancia (`instanceColor`) con parches secos por ruido de baja
  frecuencia.
- Recibe sombras (chunk `worldpos_vertex` sobreescrito para que las
  coordenadas de sombra usen la posición envuelta).

---

## 4. Bosque y árboles procedurales

**Archivos:** [src/world/TreeGen.ts](src/world/TreeGen.ts),
[src/world/Trees.ts](src/world/Trees.ts)

### 4.1 Generador por esqueleto recursivo

Reimplementación propia del algoritmo de **ez-tree** (MIT, Daniel Greenheck):

1. **Esqueleto**: cada rama crece por secciones (anillos con origen,
   cuaternión y radio). Por sección: *gnarliness* (perturbación aleatoria,
   mayor cuanto más delgada: `1/√radio`) y una **fuerza de enderezado** hacia
   la vertical (rotación en el eje `up×objetivo`, paso `forceUp/radio`).
2. **Hijas**: muestreo estratificado — franjas de altura con jitter y franjas
   de ángulo **barajadas con Fisher–Yates** (evita espirales visibles). Cada
   hija interpola origen/orientación/radio del padre en su punto de anclaje.
   Una **rama terminal** continúa la punta del padre y sella la unión.
3. **Mallado**: tubos de anillos conectados con taper; **hojas** = quads dobles
   cruzados en las ramas de último nivel con **normales redondeadas**
   (normal del quad + dirección desde la base, normalizado) → la copa se
   sombrea como un volumen suave.

Todo el RNG ocurre al generar el esqueleto (`mulberry32` sembrado): mallar N
veces produce siempre el mismo árbol — la base del LOD.

### 4.2 LOD por redistribución de instancias

`THREE.LOD` no funciona con instancing, así que: **3 `InstancedMesh` por
variante** (tronco y follaje × 3 niveles), y las ~154 posiciones se reasignan
al bucket de su distancia cuando el jugador se mueve >6 m:

| Nivel | Distancia | Detalle |
|---|---|---|
| LOD0 | <70 m | completo |
| LOD1 | 70–160 m | anillos ½, segmentos ×0.65, hojas ½ ×1.25 |
| LOD2 | >160 m | anillos ⅓, segmentos ×0.4, hojas ⅓ ×1.4, billboard simple, sin sombra |

Cada árbol tiene un **desfase aleatorio del umbral** (±7 m) — la histéresis
del pobre: nunca cambia de nivel una fila entera a la vez. En el spawn solo
2–4 árboles pagan precio completo.

*Gotcha:* `setColorAt` debe llamarse al construir cada malla (aunque el bucket
nazca vacío) para que el programa del material no recompile en caliente.

---

## 5. Cielo, nubes y sombras de nubes

**Archivos:** [src/world/SkyEnv.ts](src/world/SkyEnv.ts),
[src/core/cloudGlsl.ts](src/core/cloudGlsl.ts)

- **Atmósfera**: shader `Sky` de three (turbidez 2.6, Rayleigh 1.3) renderizado
  a PMREM → `scene.environment`: el cielo ilumina la escena (IBL).
- **Sol**: direccional cálida con sombras que **siguen al jugador ancladas a la
  cuadrícula de texels** del shadow map (proyectando el objetivo sobre la base
  ortonormal de la luz y redondeando) — sin shimmer al caminar.
- **Niebla** exponencial azulada sutil.

### El campo de nubes compartido

Idea asimilada de *Three.js Sky Pro*: **una sola función GLSL define la nube y
su sombra**. `CLOUD_GLSL` exporta `cloudField(q, t, soft)` — fBm con máscara de
agrupación que modula el *umbral* (parches nubosos ↔ huecos despejados),
**evolución** (crossfade continuo entre dos campos desfasados: las nubes mutan,
no solo derivan) y viento compartido.

- **El domo** (hemisferio r=1750, `ShaderMaterial` transparente) interseca la
  dirección de vista con el plano virtual a 600 m **en coordenadas de mundo**:
  hay paralaje real al caminar. Sombreado: densidad muestreada desplazada
  hacia el sol (bases oscuras), borde plateado, fundido con la bruma.
- **Las sombras**: terreno y pasto proyectan su posición hacia el plano a lo
  largo del rayo solar y atenúan su color ×(1−0.42·sombra) con penumbra suave.
  Como es el mismo campo, **la nube que ves arriba es la que te da sombra** —
  verificado con capturas A/B avanzando el tiempo del viento.

*Gotcha:* multiplicar el fBm por la máscara de agrupación aplasta todo y no se
ve nada; la máscara debe modular el **umbral** del smoothstep.

---

## 6. La cumbre: efigie, cristales y pipeline de assets

**Archivos:** [src/world/Landmarks.ts](src/world/Landmarks.ts),
[tools/decimate-stl.mjs](tools/decimate-stl.mjs),
[tools/bake-relief.mjs](tools/bake-relief.mjs)

### 6.1 Formato binario propio

```
[u32 nVerts][u32 nTris][f32 × 3·nVerts posiciones][u32 × 3·nTris índices]
```

Y-up, centrado en XZ, base en y=0. Se carga con `fetch` + dos `TypedArray` —
sin loaders. Los STL fuente (70 MB la efigie) **no** se incluyen en el build.

### 6.2 Decimación por clustering

`decimate-stl.mjs` agrupa vértices en celdas de tamaño configurable, promedia
representantes y descarta triángulos degenerados; convierte Z-up→Y-up.
Resultados: efigie 1 410 406→105 222 tris (1.8 MB); cristales 104k→9.4k y
314k→19.5k.

### 6.3 La efigie

- Escala 16 m; **es el punto más alto del mapa** (cumbre 73.5 m + 16).
- **Glifos emisivos con UVs cilíndricas**: el STL no trae UVs, se generan
  `u = atan2(z,x)/2π + 0.5`, `v = y/alto`; sobre ellas, la textura de glifos
  (canvas: trazos angulares rojos en columnas) como `emissiveMap` con **latido**
  `×(0.55 + 0.45·sin(uTime·1.05))` inyectado por shader. El bloom del
  postproceso les da halo en el pico del pulso.
- Normales suaves recalculadas; colisión cilíndrica.

### 6.4 Los cristales

Anillo de ~14 instancias (2 variantes) alrededor de la efigie:

- **Grandes (3.2–5.6 m) enterrados al 32–44%**: solo asoman las coronas de
  puntas. El entierro se referencia al **mínimo del terreno en las 4 esquinas
  de la huella** — en pendiente la base plana jamás asoma (el bug que motivó
  esta regla era muy visible).
- Material semimetálico (`metalness` 0.75, `roughness` 0.24) con
  **`flatShading`**: facetas nítidas sin calcular normales.
- Hueco en el ángulo de llegada del sendero; colisión en todos.

### 6.5 Relieve del camino

`Rockwall.obj` resultó ser un **heightfield en malla** (grid 101×101, el
displacement del material fotogramétrico). `bake-relief.mjs` lo hornea a una
textura de altura de 10 KB (`[u16 w][u16 h][u8 alturas]`) que el terreno usa
como capa macro del sendero (§2.3).

---

## 7. El dron

**Archivo:** [src/world/Drone.ts](src/world/Drone.ts)

Cuadricóptero procedural (~0.9 m: cuerpo, domo, gimbal con lente, 4 brazos,
rotores contrarrotantes como discos semitransparentes con aspas, LED rojo de
doble destello + verde fijo de cola) con **máquina de estados de vuelo**:

```
orbit ──(jugador a <22 m de la cumbre y sin cooldown)──▶ approach
approach ──(a <0.9 m del punto frente al jugador)──▶ inspect
inspect ──(5.5 s rodeándolo a 2.6 m, mirándolo, LED rápido)──▶ return
return ──(a <1.8 m de la órbita)──▶ orbit  (cooldown 40 s)
```

- **Vuelo**: velocidad proporcional a la distancia, acotada
  (`min(max(d·2.2, 2.5), vmax)`) — llega en picado y frena suave.
- **Orientación**: yaw con envoltura angular suavizada, cabeceo hacia el
  objetivo, **alabeo proporcional al giro** en crucero.
- En `inspect` el punto se recalcula contra el jugador cada frame: si caminas,
  te sigue.

*Gotcha central:* contra **objetivos móviles** (el punto de órbita viaja a
~2.2 m/s) el umbral de llegada debe ser holgado (1.8 m) — con 0.5 m el dron
perseguía la órbita eternamente sin "alcanzarla".

---

## 8. Audio procedural

**Archivo:** [src/audio/AudioSystem.ts](src/audio/AudioSystem.ts)

Cero archivos de audio; todo Web Audio API:

- **Viento**: ruido marrón (integración de blanco) → lowpass → ganancia, con
  ráfagas calculadas con la **misma fórmula que el shader del pasto** — oyes
  lo que ves.
- **Aves**: osciladores sinusoidales con 2–6 sílabas de frecuencia y ritmo
  aleatorios, paneo estéreo y "distancia" (lowpass + ganancia). Intervalos
  irregulares de 2.5–10 s.
- **Roce del pasto**: ruido blanco highpass cuya ganancia sigue tu velocidad,
  solo con máscara de pasto alta.
- **Pasos**: triángulo grave con pitch-drop + ráfaga de ruido bandpass,
  disparados por **distancia recorrida** (cadencia natural al correr). La
  banda cambia según superficie: aguda en pasto, seca en tierra. Aterrizajes
  con amplitud proporcional a la velocidad de caída.
- Arranque ligado al clic del menú (política de autoplay); atenuación suave
  al volver al menú.

---

## 9. Controlador de primera persona

**Archivo:** [src/player/FirstPersonController.ts](src/player/FirstPersonController.ts)

- Pointer lock + WASD, sprint ×1.85, salto, gravedad.
- **Colisión con el terreno por muestreo bilineal del heightfield** (sin motor
  de física: estable, barato y suficiente para caminar cualquier pendiente).
- Colisores circulares (árboles, rocas, efigie, cristales) con empuje
  horizontal.
- Head-bob sutil proporcional a la velocidad; cámara YXZ con pitch acotado.
- Expone `isGrounded` y `landingSpeed` para el audio.

---

## 10. Postproceso y color

**Archivo:** [src/fx/PostProcessing.ts](src/fx/PostProcessing.ts)

Pipeline HDR con [postprocessing](https://github.com/pmndrs/postprocessing):
`RenderPass` (buffer half-float) → **Bloom** (umbral 0.8, mipmap blur) →
**Tone mapping ACES** → **SMAA** + **viñeta**.

El renderer trabaja con `NoToneMapping`: el mapeo tonal ocurre una sola vez al
final, en HDR. Consecuencia útil: cualquier valor emisivo >1 (glifos de la
efigie, LED del dron, crestas de nubes) recibe bloom "gratis".

**Pipeline de color**: texturas de albedo marcadas sRGB (decodificación por
hardware), todo lo demás lineal. *Regla aprendida:* un albedo de 0.055 en
lineal ya renderiza gris claro a pleno sol — el "negro" visual está en ~0.02.

---

## 11. Rendimiento

Presupuesto en GPU media a 1080p (~60 FPS):

| Sistema | Coste aproximado |
|---|---|
| Pasto (130k matas, preset med) | ~2.3M tris, 1 draw call |
| Terreno | ~295k tris, 1 draw call |
| Bosque con LOD | ~0.3–0.6M tris efectivos, ~24 draw calls |
| Efigie + cristales | ~135k tris, 3 draw calls |
| Sombras | 1 mapa 3072², cascada única móvil |
| Nubes + sus sombras | 1 draw call + ~12 evals de ruido/píxel de suelo |
| Postproceso | bloom+ACES+SMAA+viñeta |

Claves: instancing agresivo, trabajo por-frame de CPU casi nulo (pasto en GPU,
LOD solo al desplazarse, sombras ancladas), texturas espejadas para tilear sin
costuras, y assets decimados offline.

---

## 12. Gotchas recopilados

Los errores reales del desarrollo, para no repetirlos:

1. **`DirectionalLight.shadow.camera`**: tras cambiar sus límites hay que
   llamar `updateProjectionMatrix()` — si no, la caja de sombras sigue siendo
   la de defecto (±5 m) y "no hay sombras" sin ningún error.
2. **Albedo lineal**: 0.055 parece oscuro pero renderiza gris claro al sol;
   el negro visual ronda 0.02.
3. **Máscaras multiplicativas sobre fBm**: aplastan el resultado; hay que
   modular el umbral del smoothstep, no el valor.
4. **Umbrales de llegada contra objetivos móviles**: deben superar la
   velocidad del objetivo × el tiempo de reacción, o la persecución no
   converge.
5. **Bases planas de modelos enterrados en pendiente**: referenciar el
   entierro al mínimo del terreno bajo la huella, no al centro.
6. **Puntas de geometría con radio ~0**: producen motas de aliasing; radio
   mínimo 2 cm.
7. **`InstancedMesh` + `setColorAt` tardío**: recompila el programa del
   material; reservar el buffer de color al construir.
8. **Filtrado de texturas float**: RGBA32F requiere extensión para lineal;
   RGBA16F es core en WebGL2.
9. **`file://` no sirve para el build**: módulos ES y `fetch` bloqueados;
   siempre un servidor HTTP.
10. **Objetivos de sombra que siguen al jugador**: anclar a la cuadrícula de
    texels del shadow map o los bordes de sombra tiemblan al caminar.
