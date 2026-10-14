import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

import { CharacterOutfit, PlayerOutfitType } from './CharacterOutfit';

export type CharacterAction = 'IDLE' | 'RUNNING' | 'KICK' | 'PUNCH';

export class CharacterAnimation {
  public model: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Record<string, THREE.AnimationAction> = {};
  private currentAction: THREE.AnimationAction | null = null;
  public currentActionName: CharacterAction = 'IDLE';
  public outfitType: PlayerOutfitType = 'TACTICAL_FIGHTER';
  public isVisible = true;

  private isAttacking = false;
  private isMoving = false;
  private audioCtx: AudioContext | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  async load(outfitType: PlayerOutfitType = 'TACTICAL_FIGHTER', autoAddToScene = true): Promise<void> {
    this.outfitType = outfitType;
    const loader = new FBXLoader();

    // Determine paths for Player 1 or Player 2 respective folders
    const isP1 = outfitType === 'TACTICAL_FIGHTER';
    const runPath = isP1 ? '/animations/player1/Running (2).fbx' : '/animations/player2/Running.fbx';
    const kickPath = isP1 ? '/animations/player1/Mma Kick (1).fbx' : '/animations/player2/Mma Kick.fbx';
    const punchPath = isP1 ? '/animations/player1/Combo Punch.fbx' : '/animations/player2/Combo Punch (1).fbx';

    // Remove old model if replacing
    if (this.model && this.model.parent) {
      this.model.parent.remove(this.model);
    }
    if (this.mixer) {
      this.mixer.stopAllAction();
    }
    this.actions = {};

    // 1. Load character model + running action from respective player folder
    let runFbx: THREE.Group;
    try {
      runFbx = await loader.loadAsync(runPath);
    } catch (err) {
      console.warn(`Failed to load ${runPath}, falling back to generic run:`, err);
      runFbx = await loader.loadAsync('/animations/Running (1).fbx');
    }
    this.model = runFbx;

    // Scale from cm to meters (180cm -> 1.80m)
    this.model.scale.set(0.01, 0.01, 0.01);

    // Apply realistic outfit materials and identification markings
    CharacterOutfit.applyOutfit(this.model, this.outfitType);

    this.model.visible = this.isVisible;

    if (autoAddToScene) {
      this.scene.add(this.model);
    }

    // 2. Load respective kick and punch animations
    const [kickFbx, punchFbx] = await Promise.all([
      loader.loadAsync(kickPath).catch((err) => {
        console.warn(`Failed to load ${kickPath}, falling back to generic kick:`, err);
        return loader.loadAsync('/animations/Mma Kick.fbx');
      }),
      loader.loadAsync(punchPath).catch((err) => {
        console.warn(`Failed to load ${punchPath}, falling back to generic punch:`, err);
        return loader.loadAsync('/animations/Punch Combo.fbx');
      })
    ]);

    // 3. Process animation clips
    // Running animation: convert to in-place by neutralizing forward Z progression on hips
    const rawRunClip = (runFbx.animations && runFbx.animations.length > 0)
      ? runFbx.animations[0]
      : (await loader.loadAsync('/animations/Running (1).fbx')).animations[0];

    const runClip = rawRunClip.clone();
    runClip.name = 'running';
    for (const track of runClip.tracks) {
      if (track.name.endsWith('.position')) {
        const baseZ = track.values[2];
        for (let i = 0; i < track.values.length / 3; i++) {
          track.values[i * 3 + 2] = baseZ;
        }
      }
    }

    // Kick animation: neutralize horizontal drift to kick in place
    const rawKickClip = (kickFbx.animations && kickFbx.animations.length > 0)
      ? kickFbx.animations[0]
      : (await loader.loadAsync('/animations/Mma Kick.fbx')).animations[0];
    const kickClip = rawKickClip.clone();
    kickClip.name = 'kick';
    for (const track of kickClip.tracks) {
      if (track.name.endsWith('.position')) {
        const baseX = track.values[0];
        const baseZ = track.values[2];
        for (let i = 0; i < track.values.length / 3; i++) {
          track.values[i * 3] = baseX;
          track.values[i * 3 + 2] = baseZ;
        }
      }
    }

    // Punch animation: neutralize horizontal drift to punch in place
    const rawPunchClip = (punchFbx.animations && punchFbx.animations.length > 0)
      ? punchFbx.animations[0]
      : (await loader.loadAsync('/animations/Punch Combo.fbx')).animations[0];
    const punchClip = rawPunchClip.clone();
    punchClip.name = 'punch';
    for (const track of punchClip.tracks) {
      if (track.name.endsWith('.position')) {
        const baseX = track.values[0];
        const baseZ = track.values[2];
        for (let i = 0; i < track.values.length / 3; i++) {
          track.values[i * 3] = baseX;
          track.values[i * 3 + 2] = baseZ;
        }
      }
    }

    // Procedural combat-ready idle loop with subtle natural breathing
    const idleTracks: THREE.KeyframeTrack[] = [];
    for (const track of punchClip.tracks) {
      if (track instanceof THREE.QuaternionKeyframeTrack) {
        const q0 = track.values.slice(0, 4);
        idleTracks.push(new THREE.QuaternionKeyframeTrack(track.name, [0, 1.2, 2.4], [...q0, ...q0, ...q0]));
      } else if (track instanceof THREE.VectorKeyframeTrack) {
        const v0 = track.values.slice(0, 3);
        const v1 = [v0[0], v0[1] + 0.8, v0[2]];
        idleTracks.push(new THREE.VectorKeyframeTrack(track.name, [0, 1.2, 2.4], [...v0, ...v1, ...v0]));
      }
    }
    const idleClip = new THREE.AnimationClip('idle', 2.4, idleTracks);

    // 4. Setup AnimationMixer on the character model
    this.mixer = new THREE.AnimationMixer(this.model);

    this.actions['idle'] = this.mixer.clipAction(idleClip);
    this.actions['idle'].setLoop(THREE.LoopRepeat, Infinity);

    this.actions['running'] = this.mixer.clipAction(runClip);
    this.actions['running'].setLoop(THREE.LoopRepeat, Infinity);

    this.actions['kick'] = this.mixer.clipAction(kickClip);
    this.actions['kick'].setLoop(THREE.LoopOnce, 1);
    this.actions['kick'].clampWhenFinished = true;

    this.actions['punch'] = this.mixer.clipAction(punchClip);
    this.actions['punch'].setLoop(THREE.LoopOnce, 1);
    this.actions['punch'].clampWhenFinished = true;

    // Start in Idle pose
    this.currentAction = this.actions['idle'];
    this.currentAction.play();
    this.currentActionName = 'IDLE';

    // When an attack finishes, smoothly return to running or idle
    this.mixer.addEventListener('finished', (e: { action?: THREE.AnimationAction }) => {
      if (e.action === this.actions['kick'] || e.action === this.actions['punch']) {
        this.isAttacking = false;
        if (this.isMoving) {
          this.transitionTo('RUNNING', 0.2);
        } else {
          this.transitionTo('IDLE', 0.25);
        }
      }
    });
  }

  setMoving(moving: boolean, speedMultiplier = 1.0): void {
    this.isMoving = moving;
    if (this.isAttacking) return;

    if (moving) {
      if (this.currentActionName !== 'RUNNING') {
        this.transitionTo('RUNNING', 0.18);
      }
      if (this.actions['running']) {
        this.actions['running'].timeScale = Math.max(0.8, speedMultiplier);
      }
    } else {
      if (this.currentActionName !== 'IDLE') {
        this.transitionTo('IDLE', 0.22);
      }
    }
  }

  playKick(): void {
    if (!this.actions['kick'] || this.isAttacking) return;
    this.isAttacking = true;
    this.transitionTo('KICK', 0.12);
    this.playAttackAudio(140, 55, 0.28);
  }

  playPunch(): void {
    if (!this.actions['punch'] || this.isAttacking) return;
    this.isAttacking = true;
    this.transitionTo('PUNCH', 0.12);
    this.playAttackAudio(340, 110, 0.22);
  }

  get isAttackPlaying(): boolean {
    return this.isAttacking;
  }

  private transitionTo(name: CharacterAction, duration: number): void {
    const key = name.toLowerCase();
    const nextAction = this.actions[key];
    if (!nextAction || nextAction === this.currentAction) return;

    nextAction.reset();
    nextAction.fadeIn(duration);
    nextAction.play();

    if (this.currentAction) {
      this.currentAction.fadeOut(duration);
    }

    this.currentAction = nextAction;
    this.currentActionName = name;
  }

  update(dt: number, position: THREE.Vector3, yaw: number): void {
    if (this.mixer) {
      this.mixer.update(dt);
    }
    if (this.model) {
      // Feet on ground (eye height is 1.68m)
      this.model.position.set(position.x, position.y - 1.68, position.z);
      // Mixamo forward is +Z; rotate by yaw + Math.PI to face moving direction
      this.model.rotation.y = yaw + Math.PI;
    }
  }

  private playAttackAudio(startFreq: number, endFreq: number, duration: number): void {
    try {
      if (!this.audioCtx) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) this.audioCtx = new AudioCtx();
      }
      if (!this.audioCtx) return;
      if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // Audio fallback silent
    }
  }

  setOutfit(outfitType: PlayerOutfitType): void {
    if (this.outfitType !== outfitType) {
      this.outfitType = outfitType;
      void this.load(outfitType);
    } else if (this.model) {
      CharacterOutfit.applyOutfit(this.model, outfitType);
    }
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (this.model) {
      this.model.visible = visible;
    }
  }
}
