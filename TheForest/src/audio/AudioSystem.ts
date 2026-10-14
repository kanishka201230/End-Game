import * as THREE from 'three';
import { Heightfield } from '../world/heightfield';
import { FirstPersonController } from '../player/FirstPersonController';

/**
 * Ambiente sonoro 100% procedural con Web Audio API:
 * - Viento: ruido marrón filtrado, con ráfagas sincronizadas al viento visual.
 * - Roce del pasto al caminar entre la hierba.
 * - Aves: trinos sintetizados (frecuencia y ritmo aleatorios, paneo estéreo).
 * - Pasos: golpe grave + crujido de ruido, distinto en tierra que en pasto.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rustleGain!: GainNode;
  private noiseBuf!: AudioBuffer;

  private birdCountdown = 3;
  private stepAccum = 0;
  private readonly lastPos = new THREE.Vector3();
  private firstFrame = true;

  // Background Music
  private bgm: HTMLAudioElement | null = null;
  private isVictory = false;
  private quizActive = false;

  constructor(
    private readonly field: Heightfield,
    private readonly controller: FirstPersonController
  ) {
    if (typeof window !== 'undefined') {
      this.bgm = new Audio('/bgm.mp3');
      this.bgm.loop = true;
      this.bgm.volume = 0.55;
    }
  }

  /** Debe llamarse desde un gesto del usuario (clic) por la política de autoplay. */
  start(): void {
    if (this.bgm && !this.isVictory && !this.quizActive) {
      this.bgm.play().catch((err) => {
        console.warn('BGM autoplay waiting for interaction:', err);
      });
    }

    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Ruido blanco (pasos, roce) y marrón (viento).
    this.noiseBuf = this.makeNoise(2, false);
    const brown = this.makeNoise(6, true);

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = brown;
    windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 480;
    this.windFilter.Q.value = 0.4;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.1;
    windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master);
    windSrc.start();

    const rustleSrc = ctx.createBufferSource();
    rustleSrc.buffer = this.noiseBuf;
    rustleSrc.loop = true;
    const rustleHp = ctx.createBiquadFilter();
    rustleHp.type = 'highpass';
    rustleHp.frequency.value = 2400;
    this.rustleGain = ctx.createGain();
    this.rustleGain.gain.value = 0;
    rustleSrc.connect(rustleHp).connect(this.rustleGain).connect(this.master);
    rustleSrc.start();

    if (ctx.state === 'suspended') void ctx.resume();
  }

  /** Silencia en el menú, restaura al jugar. */
  setMenu(inMenu: boolean): void {
    if (this.bgm && !this.isVictory) {
      if (this.quizActive) {
        this.bgm.volume = 0;
        this.bgm.pause();
        return;
      }
      if (inMenu) {
        this.bgm.volume = 0.2;
      } else {
        this.bgm.volume = 0.55;
        if (this.bgm.paused) {
          this.bgm.play().catch(() => {});
        }
      }
    }

    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(inMenu ? 0.06 : 0.55, t, 0.4);
  }

  /**
   * In the time period of asking all five questions, the background music will NOT play.
   * Only after the opening of the door does the background music resume and play!
   */
  setQuizActive(active: boolean): void {
    this.quizActive = active;
    if (this.bgm && !this.isVictory) {
      if (active) {
        this.bgm.volume = 0;
        this.bgm.pause();
      } else {
        this.bgm.volume = 0.55;
        this.bgm.play().catch(() => {});
      }
    }
  }

  /** Mutes environmental audio while the question is being dictated so only the question voice plays */
  setDucking(ducked: boolean): void {
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(ducked ? 0.0 : 0.55, t, 0.1);
    }
  }

  /** Se llama al alcanzar la meta final (Copa de la Victoria) */
  stopBgm(fadeOutDuration = 2.5): void {
    this.isVictory = true;
    if (!this.bgm) return;
    const startVol = this.bgm.volume;
    const startTime = performance.now();
    const fade = () => {
      if (!this.bgm) return;
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed < fadeOutDuration) {
        this.bgm.volume = Math.max(0, startVol * (1 - elapsed / fadeOutDuration));
        requestAnimationFrame(fade);
      } else {
        this.bgm.volume = 0;
        this.bgm.pause();
      }
    };
    fade();
  }

  update(dt: number, time: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const pos = this.controller.position;

    if (this.firstFrame) {
      this.lastPos.copy(pos);
      this.firstFrame = false;
    }

    // Ráfagas de viento coherentes con el shader del pasto.
    const gust =
      0.6 +
      0.4 * Math.sin(time * 0.37 + pos.x * 0.021 + pos.z * 0.017) * (0.7 + 0.3 * Math.sin(time * 0.13));
    this.windGain.gain.setTargetAtTime(0.07 + gust * 0.13, ctx.currentTime, 0.35);
    this.windFilter.frequency.setTargetAtTime(380 + gust * 480, ctx.currentTime, 0.35);

    // Movimiento horizontal de este frame.
    const dx = pos.x - this.lastPos.x;
    const dz = pos.z - this.lastPos.z;
    const dist = Math.hypot(dx, dz);
    const speed = dt > 0 ? dist / dt : 0;
    this.lastPos.copy(pos);

    const grassMask = this.field.sampleMask(pos.x, pos.z);

    // Roce del pasto al avanzar entre hierba alta.
    const rustleTarget =
      grassMask > 0.4 && this.controller.isGrounded
        ? THREE.MathUtils.clamp(speed / 7.5, 0, 1) * 0.16
        : 0;
    this.rustleGain.gain.setTargetAtTime(rustleTarget, ctx.currentTime, 0.12);

    // Pasos por distancia recorrida.
    if (this.controller.isGrounded && speed > 0.6) {
      this.stepAccum += dist;
      const stride = 1.55 + speed * 0.12;
      if (this.stepAccum >= stride) {
        this.stepAccum = 0;
        this.playStep(speed, grassMask);
      }
    } else {
      this.stepAccum = Math.min(this.stepAccum, 1.2);
    }

    // Aterrizaje tras un salto o caída.
    if (this.controller.landingSpeed > 3.5) {
      this.playStep(this.controller.landingSpeed * 1.6, grassMask, true);
    }

    // Trinos de aves a intervalos irregulares.
    this.birdCountdown -= dt;
    if (this.birdCountdown <= 0) {
      this.birdCountdown = 2.5 + Math.random() * 8;
      this.playBird();
    }
  }

  private playStep(speed: number, grassMask: number, landing = false): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const onGrass = grassMask > 0.4;

    const g = ctx.createGain();
    const amp =
      (landing ? 0.34 : 0.14 + Math.min(speed / 8, 1) * 0.1) * (0.85 + Math.random() * 0.3);
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (landing ? 0.22 : 0.13));
    g.connect(this.master);

    // Golpe grave.
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const f0 = (landing ? 58 : 72) + Math.random() * 24;
    osc.frequency.setValueAtTime(f0 * 1.5, t);
    osc.frequency.exponentialRampToValueAtTime(f0, t + 0.07);
    const og = ctx.createGain();
    og.gain.value = onGrass ? 0.5 : 1.0;
    osc.connect(og).connect(g);
    osc.start(t);
    osc.stop(t + 0.16);

    // Crujido: banda alta en pasto, media en tierra.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = onGrass ? 2100 + Math.random() * 900 : 620 + Math.random() * 260;
    bp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(onGrass ? 1.0 : 0.8, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    src.connect(bp).connect(ng).connect(g);
    src.start(t, Math.random() * 1.2);
    src.stop(t + 0.14);
  }

  private playBird(): void {
    const ctx = this.ctx!;
    let t = ctx.currentTime + 0.05;

    // Distancia simulada: las lejanas suenan más suaves y apagadas.
    const far = 0.25 + Math.random() * 0.75;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.85;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500 - far * 3800;
    const vol = ctx.createGain();
    vol.gain.value = 0.16 * (1 - far * 0.72);
    lp.connect(pan).connect(vol).connect(this.master);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    osc.connect(og).connect(lp);

    const syllables = 2 + Math.floor(Math.random() * 5);
    const baseF = 2100 + Math.random() * 1700;
    for (let i = 0; i < syllables; i++) {
      const dur = 0.05 + Math.random() * 0.09;
      const f1 = baseF * (0.9 + Math.random() * 0.25);
      const f2 = Math.max(500, f1 + (Math.random() * 2 - 1) * 900);
      osc.frequency.setValueAtTime(f1, t);
      osc.frequency.exponentialRampToValueAtTime(f2, t + dur * 0.85);
      og.gain.linearRampToValueAtTime(1, t + 0.012);
      og.gain.linearRampToValueAtTime(0.0001, t + dur);
      t += dur + 0.03 + Math.random() * 0.09;
    }
    osc.start(ctx.currentTime + 0.05);
    osc.stop(t + 0.05);
  }

  /** Buffer de ruido blanco, o marrón (integrado) para el viento. */
  private makeNoise(seconds: number, brown: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    return buf;
  }
}
