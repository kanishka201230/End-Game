import * as THREE from 'three';
import { mulberry32, fbm2 } from './noise';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Mata de pasto alto: abanico de hojas afiladas sobre fondo transparente. */
export function grassTuftTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 512);
  const rng = mulberry32(4021);
  const W = 512;
  const H = 512;

  const blades = 34;
  for (let i = 0; i < blades; i++) {
    const bx = W * (0.5 + (rng() - 0.5) * 0.55);
    const by = H * (0.995 - rng() * 0.03);
    const lean = (rng() - 0.5) * 1.5;
    const len = H * (0.55 + rng() * 0.42);
    const width = 8 + rng() * 10;

    const tipX = bx + lean * len * 0.55;
    const tipY = by - len;
    const cpX = bx + lean * len * 0.18;
    const cpY = by - len * 0.55;

    // Gradiente: base oscura -> punta amarillenta cálida.
    const g = ctx.createLinearGradient(bx, by, tipX, tipY);
    const dry = rng();
    const baseCol = `rgb(${28 + dry * 10 | 0}, ${46 + dry * 10 | 0}, ${12 + dry * 5 | 0})`;
    const midCol = `rgb(${60 + dry * 32 | 0}, ${96 + dry * 26 | 0}, ${22 + dry * 10 | 0})`;
    const tipCol = `rgb(${118 + dry * 62 | 0}, ${140 + dry * 36 | 0}, ${44 + dry * 26 | 0})`;
    g.addColorStop(0, baseCol);
    g.addColorStop(0.55, midCol);
    g.addColorStop(1, tipCol);
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(bx - width / 2, by);
    ctx.quadraticCurveTo(cpX - width / 2, cpY, tipX, tipY);
    ctx.quadraticCurveTo(cpX + width / 2, cpY, bx + width / 2, by);
    ctx.closePath();
    ctx.fill();
  }
  const t = toTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Racimo de hojas para copas de árboles (billboard con alpha). */
export function leafClusterTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 512);
  const rng = mulberry32(7717);
  const cx = 256;
  const cy = 256;

  const leaves = 170;
  for (let i = 0; i < leaves; i++) {
    // Distribución con más densidad en el centro.
    const ang = rng() * Math.PI * 2;
    const rad = Math.pow(rng(), 0.6) * 215;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad * 0.92;

    const hue = 82 + rng() * 26;
    const sat = 34 + rng() * 22;
    // Hojas exteriores más iluminadas, interiores en sombra.
    const edge = rad / 215;
    const light = 13 + rng() * 11 + edge * 12;
    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, ${0.85 + rng() * 0.15})`;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng() * Math.PI * 2);
    const lw = 12 + rng() * 15;
    const lh = 7 + rng() * 9;
    ctx.beginPath();
    ctx.ellipse(0, 0, lw, lh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const t = toTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Corteza de árbol (tileable vertical). */
export function barkTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 512);
  const rng = mulberry32(1379);

  ctx.fillStyle = '#4d4238';
  ctx.fillRect(0, 0, 256, 512);

  // Estrías verticales.
  for (let i = 0; i < 320; i++) {
    const x = rng() * 256;
    const y = rng() * 512;
    const len = 30 + rng() * 140;
    const w = 1.5 + rng() * 4.5;
    const shade = rng();
    const r = 45 + shade * 52;
    const g = 38 + shade * 46;
    const b = 30 + shade * 38;
    ctx.strokeStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${0.35 + rng() * 0.45})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y - len / 2);
    ctx.bezierCurveTo(x + (rng() - 0.5) * 10, y - len / 4, x + (rng() - 0.5) * 10, y + len / 4, x + (rng() - 0.5) * 6, y + len / 2);
    ctx.stroke();
  }
  // Grietas oscuras.
  for (let i = 0; i < 90; i++) {
    const x = rng() * 256;
    const y = rng() * 512;
    const len = 20 + rng() * 90;
    ctx.strokeStyle = `rgba(18, 14, 10, ${0.3 + rng() * 0.4})`;
    ctx.lineWidth = 1 + rng() * 2;
    ctx.beginPath();
    ctx.moveTo(x, y - len / 2);
    ctx.lineTo(x + (rng() - 0.5) * 8, y + len / 2);
    ctx.stroke();
  }
  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * Grano de detalle para el terreno (lineal, no sRGB): ruido multi-octava +
 * moteado fino. Con MirroredRepeatWrapping tilea sin costuras visibles.
 */
export function groundDetailTexture(): THREE.CanvasTexture {
  const size = 512;
  const [c, ctx] = makeCanvas(size, size);
  const rng = mulberry32(6067);
  const img = ctx.createImageData(size, size);
  const d = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v =
        0.55 * fbm2(x * 0.028, y * 0.028, 4, 611) +
        0.30 * fbm2(x * 0.09, y * 0.09, 3, 733) +
        0.15 * fbm2(x * 0.24, y * 0.24, 2, 857);
      // Moteado: granos sueltos claros y oscuros.
      const r = rng();
      if (r < 0.015) v += 0.25;
      else if (r < 0.03) v -= 0.25;
      const g = Math.max(0, Math.min(255, Math.round((0.28 + v * 0.62) * 255)));
      const i = (y * size + x) * 4;
      d[i] = g;
      d[i + 1] = g;
      d[i + 2] = g;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.MirroredRepeatWrapping;
  t.wrapT = THREE.MirroredRepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/**
 * Suelo de sendero pedregoso (como la foto de referencia): tierra compactada
 * con cientos de piedras incrustadas de forma irregular, gravilla y ramitas.
 * Devuelve albedo (sRGB) + mapa de altura (lineal) ALINEADOS para bump mapping.
 */
export function pathGroundTextures(): {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
} {
  const S = 1024;
  const [ca, a] = makeCanvas(S, S);
  const [cb, b] = makeCanvas(S, S);
  const rng = mulberry32(9182);

  // --- Base: arena/tierra compactada con grano y gravilla fina ---
  const imgA = a.createImageData(S, S);
  const imgB = b.createImageData(S, S);
  const da = imgA.data;
  const db = imgB.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n =
        0.55 * fbm2(x * 0.018, y * 0.018, 4, 921) +
        0.3 * fbm2(x * 0.065, y * 0.065, 3, 443) +
        0.15 * fbm2(x * 0.21, y * 0.21, 2, 887);
      let v = 150 + (n - 0.5) * 95 + (rng() - 0.5) * 18;
      let r = v;
      let g = v * 0.87;
      let bl = v * 0.7;
      const sp = rng();
      if (sp < 0.05) {
        // Gravilla oscura incrustada en la arena.
        const dk = 0.45 + rng() * 0.3;
        r *= dk;
        g *= dk;
        bl *= dk * 0.95;
      } else if (sp < 0.07) {
        // Granos de arena clara.
        r = Math.min(255, r * 1.35);
        g = Math.min(255, g * 1.28);
        bl = Math.min(255, bl * 1.2);
      }
      const i = (y * S + x) * 4;
      da[i] = r;
      da[i + 1] = g;
      da[i + 2] = bl;
      da[i + 3] = 255;
      const hv = 100 + (n - 0.5) * 30 + (rng() - 0.5) * 10;
      db[i] = hv;
      db[i + 1] = hv;
      db[i + 2] = hv;
      db[i + 3] = 255;
    }
  }
  a.putImageData(imgA, 0, 0);
  b.putImageData(imgB, 0, 0);

  // --- Piedras: grandes primero, pequeñas encima ---
  interface Stone {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    rot: number;
  }
  const stones: Stone[] = [];
  for (let i = 0; i < 440; i++) {
    let r = 4 + Math.pow(rng(), 2.1) * 32;
    if (rng() < 0.05) r *= 1.7;
    stones.push({
      cx: rng() * S,
      cy: rng() * S,
      rx: r,
      ry: r * (0.62 + rng() * 0.48),
      rot: rng() * Math.PI
    });
  }
  stones.sort((p, q) => q.rx - p.rx);

  for (const st of stones) {
    // Sombra de contacto bajo la piedra.
    a.save();
    a.translate(2.5, 3.5);
    blobPath(a, st, rng);
    a.fillStyle = 'rgba(25, 20, 15, 0.30)';
    a.fill();
    a.restore();

    // Cuerpo: gris azulado (algunas pardas), con gradiente sutil de luz.
    const g0 = 52 + rng() * 74;
    const warm = rng() < 0.22;
    const cr = warm ? g0 * 1.3 : g0 * (0.9 + rng() * 0.08);
    const cg = warm ? g0 * 1.06 : g0 * (0.97 + rng() * 0.06);
    const cbv = warm ? g0 * 0.76 : g0 * (1.04 + rng() * 0.1);
    const grad = a.createLinearGradient(st.cx - st.rx, st.cy - st.ry, st.cx + st.rx, st.cy + st.ry);
    grad.addColorStop(0, `rgb(${(cr * 1.22) | 0}, ${(cg * 1.22) | 0}, ${(cbv * 1.22) | 0})`);
    grad.addColorStop(1, `rgb(${(cr * 0.78) | 0}, ${(cg * 0.78) | 0}, ${(cbv * 0.78) | 0})`);
    blobPath(a, st, rng);
    a.fillStyle = grad;
    a.fill();
    a.strokeStyle = 'rgba(28, 24, 18, 0.35)';
    a.lineWidth = Math.max(1, st.rx * 0.12);
    a.stroke();

    // Motas de brillo en piedras grandes.
    if (st.rx > 11) {
      a.fillStyle = 'rgba(255, 250, 240, 0.22)';
      const nd = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < nd; k++) {
        a.fillRect(
          st.cx + (rng() - 0.5) * st.rx,
          st.cy + (rng() - 0.5) * st.ry,
          1.5,
          1.5
        );
      }
    }

    // Altura: domo radial (composición "lighten" = máximo al solaparse).
    const peak = 150 + Math.min(1, st.rx / 30) * 85;
    const rg = b.createRadialGradient(st.cx, st.cy, st.rx * 0.1, st.cx, st.cy, Math.max(st.rx, st.ry));
    rg.addColorStop(0, `rgb(${peak | 0}, ${peak | 0}, ${peak | 0})`);
    rg.addColorStop(0.8, 'rgb(116, 116, 116)');
    rg.addColorStop(1, 'rgb(100, 100, 100)');
    b.globalCompositeOperation = 'lighten';
    blobPath(b, st, rng);
    b.fillStyle = rg;
    b.fill();
    b.globalCompositeOperation = 'source-over';
  }

  // --- Ramitas y pajitas secas ---
  for (let i = 0; i < 14; i++) {
    const x0 = rng() * S;
    const y0 = rng() * S;
    const len = 40 + rng() * 80;
    const ang = rng() * Math.PI * 2;
    const x1 = x0 + Math.cos(ang) * len;
    const y1 = y0 + Math.sin(ang) * len;
    const mx = (x0 + x1) / 2 + (rng() - 0.5) * 18;
    const my = (y0 + y1) / 2 + (rng() - 0.5) * 18;
    const w = 1.8 + rng() * 1.6;
    a.strokeStyle = `rgba(${(190 + rng() * 30) | 0}, ${(168 + rng() * 25) | 0}, ${(112 + rng() * 25) | 0}, 0.85)`;
    a.lineWidth = w;
    a.beginPath();
    a.moveTo(x0, y0);
    a.quadraticCurveTo(mx, my, x1, y1);
    a.stroke();
    b.globalCompositeOperation = 'lighten';
    b.strokeStyle = 'rgb(126, 126, 126)';
    b.lineWidth = w;
    b.beginPath();
    b.moveTo(x0, y0);
    b.quadraticCurveTo(mx, my, x1, y1);
    b.stroke();
    b.globalCompositeOperation = 'source-over';
  }

  const albedo = new THREE.CanvasTexture(ca);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.MirroredRepeatWrapping;
  albedo.wrapT = THREE.MirroredRepeatWrapping;
  albedo.anisotropy = 8;
  albedo.needsUpdate = true;

  const bump = new THREE.CanvasTexture(cb);
  bump.wrapS = THREE.MirroredRepeatWrapping;
  bump.wrapT = THREE.MirroredRepeatWrapping;
  bump.anisotropy = 4;
  bump.needsUpdate = true;

  return { albedo, bump };
}

/** Contorno irregular de piedra (blob con vértices perturbados y curvas suaves). */
function blobPath(
  ctx: CanvasRenderingContext2D,
  st: { cx: number; cy: number; rx: number; ry: number; rot: number },
  rng: () => number
): void {
  const k = 9;
  const pts: [number, number][] = [];
  for (let i = 0; i < k; i++) {
    const a2 = (i / k) * Math.PI * 2;
    const wob = 1 + (rng() - 0.5) * 0.4;
    const px = Math.cos(a2) * st.rx * wob;
    const py = Math.sin(a2) * st.ry * wob;
    const xr = px * Math.cos(st.rot) - py * Math.sin(st.rot);
    const yr = px * Math.sin(st.rot) + py * Math.cos(st.rot);
    pts.push([st.cx + xr, st.cy + yr]);
  }
  ctx.beginPath();
  for (let i = 0; i <= k; i++) {
    const [x0, y0] = pts[i % k];
    const [x1, y1] = pts[(i + 1) % k];
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    if (i === 0) ctx.moveTo(mx, my);
    else ctx.quadraticCurveTo(x0, y0, mx, my);
  }
  ctx.closePath();
}

/**
 * Glifos alienígenas para el Marcador (emissive map): trazos angulares
 * rojo-naranja sobre negro, en bandas verticales, con venas tenues.
 */
export function markerGlyphTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 512);
  const rng = mulberry32(66613);

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 256, 512);

  // Venas largas y tenues.
  for (let i = 0; i < 7; i++) {
    const x0 = rng() * 256;
    ctx.strokeStyle = `rgba(180, 30, 15, ${0.18 + rng() * 0.15})`;
    ctx.lineWidth = 1 + rng() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    let x = x0;
    for (let y = 0; y <= 512; y += 32) {
      x += (rng() - 0.5) * 26;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Glifos: símbolos angulares en columnas.
  const cols = [36, 92, 158, 220];
  for (const cx of cols) {
    let y = 14 + rng() * 30;
    while (y < 492) {
      const bright = rng() < 0.25;
      const a = bright ? 0.95 : 0.55 + rng() * 0.3;
      ctx.strokeStyle = bright
        ? `rgba(255, 120, 60, ${a})`
        : `rgba(235, 55, 25, ${a})`;
      ctx.lineWidth = bright ? 2.5 : 1.8;
      const s = 7 + rng() * 9;
      const segs = 2 + Math.floor(rng() * 3);
      ctx.beginPath();
      let px = cx + (rng() - 0.5) * 14;
      let py = y;
      ctx.moveTo(px, py);
      for (let k = 0; k < segs; k++) {
        const dir = Math.floor(rng() * 4);
        px += dir === 0 ? s : dir === 1 ? -s : (rng() - 0.5) * s;
        py += dir >= 2 ? s : s * 0.4;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      // Punto brillante ocasional.
      if (rng() < 0.3) {
        ctx.fillStyle = 'rgba(255, 160, 90, 0.9)';
        ctx.fillRect(cx + (rng() - 0.5) * 20, y + s / 2, 2.5, 2.5);
      }
      y += s + 10 + rng() * 22;
    }
  }

  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * Bandas horizontales talladas con glifos para el Marcador (albedo, mate):
 * 8 bandas por tile, separadores oscuros y filas de símbolos grabados.
 */
export function markerBandTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 512);
  const rng = mulberry32(60443);
  const BANDS = 8;
  const bh = 512 / BANDS;

  for (let b = 0; b < BANDS; b++) {
    const y0 = b * bh;
    // Cuerpo de la banda con leve gradiente (luz en el borde superior).
    const g = ctx.createLinearGradient(0, y0, 0, y0 + bh);
    g.addColorStop(0, '#2e2e33');
    g.addColorStop(0.12, '#242428');
    g.addColorStop(1, '#1d1d21');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, 256, bh);
    // Separador profundo.
    ctx.fillStyle = '#0e0e11';
    ctx.fillRect(0, y0 + bh - 4, 256, 4);

    // Fila de glifos grabados.
    let x = 6 + rng() * 10;
    const cy = y0 + bh * 0.52;
    while (x < 240) {
      const s = 5 + rng() * 7;
      ctx.strokeStyle = `rgba(88, 92, 98, ${0.55 + rng() * 0.35})`;
      ctx.lineWidth = 1.8;
      const segs = 2 + Math.floor(rng() * 3);
      ctx.beginPath();
      let px = x;
      let py = cy + (rng() - 0.5) * 8;
      ctx.moveTo(px, py);
      for (let k = 0; k < segs; k++) {
        const dir = Math.floor(rng() * 4);
        px += dir === 0 ? s : dir === 1 ? -s * 0.6 : s * 0.5;
        py += dir >= 2 ? (rng() < 0.5 ? s : -s) * 0.6 : s * 0.35;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      if (rng() < 0.2) {
        ctx.fillStyle = 'rgba(96, 100, 106, 0.7)';
        ctx.beginPath();
        ctx.arc(x + s, cy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      x += s + 8 + rng() * 12;
    }
  }

  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Punto suave para partículas (polen/polvo). */
export function softDotTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255, 250, 225, 1)');
  g.addColorStop(0.4, 'rgba(255, 248, 215, 0.55)');
  g.addColorStop(1, 'rgba(255, 245, 200, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c);
}
