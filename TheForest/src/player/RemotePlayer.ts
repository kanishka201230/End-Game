import * as THREE from 'three';
import { CharacterAnimation, CharacterAction } from './CharacterAnimation';
import { PlayerOutfitType } from './CharacterOutfit';
import { PlayerNetState } from '../net/NetworkClient';

export class RemotePlayer {
  public characterAnimation: CharacterAnimation;
  public readonly position = new THREE.Vector3();
  public yaw = 0;
  public role: 1 | 2 = 2;
  public isVisible = false;

  private targetPosition = new THREE.Vector3();
  private targetYaw = 0;
  private lastAction: CharacterAction = 'IDLE';
  private tagMesh: THREE.Sprite | null = null;

  constructor(private readonly scene: THREE.Scene) {
    this.characterAnimation = new CharacterAnimation(scene);
  }

  async load(outfitType: PlayerOutfitType, spawnPos: THREE.Vector3, spawnYaw: number): Promise<void> {
    this.position.copy(spawnPos);
    this.targetPosition.copy(spawnPos);
    this.yaw = spawnYaw;
    this.targetYaw = spawnYaw;

    await this.characterAnimation.load(outfitType, true);

    // Create 3D floating overhead nametag
    this.createNameTag(outfitType);

    this.setVisible(false);
  }

  private createNameTag(outfitType: PlayerOutfitType): void {
    const isP1 = outfitType === 'TACTICAL_FIGHTER';
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    // Rounded background pill
    ctx.fillStyle = 'rgba(10, 15, 12, 0.85)';
    ctx.strokeStyle = isP1 ? '#3b82f6' : '#f97316';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(10, 10, 492, 108, 24);
    ctx.fill();
    ctx.stroke();

    // Player role badge
    ctx.fillStyle = isP1 ? '#2563eb' : '#ea580c';
    ctx.beginPath();
    ctx.roundRect(24, 24, 80, 80, 16);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isP1 ? 'P1' : 'P2', 64, 64);

    // Player Title text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(isP1 ? 'TACTICAL FIGHTER' : 'FOREST SURVIVOR', 124, 52);

    // Status subtitle
    ctx.fillStyle = isP1 ? '#93c5fd' : '#fdba74';
    ctx.font = '24px sans-serif';
    ctx.fillText('ONLINE PLAYER', 124, 86);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true
    });
    this.tagMesh = new THREE.Sprite(spriteMat);
    this.tagMesh.scale.set(1.6, 0.4, 1.0);
    this.scene.add(this.tagMesh);
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.characterAnimation.setVisible(visible);
    if (this.tagMesh) {
      this.tagMesh.visible = visible;
    }
  }

  setOutfit(outfitType: PlayerOutfitType): void {
    this.role = outfitType === 'TACTICAL_FIGHTER' ? 1 : 2;
    this.characterAnimation.setOutfit(outfitType);
    if (this.tagMesh) {
      this.scene.remove(this.tagMesh);
      this.tagMesh = null;
    }
    this.createNameTag(outfitType);
    this.setVisible(this.isVisible);
  }

  applyNetState(state: PlayerNetState): void {
    this.targetPosition.set(state.x, state.y, state.z);
    this.targetYaw = state.yaw;

    // Trigger attacks if action transitioned
    if (state.action === 'PUNCH' && this.lastAction !== 'PUNCH') {
      this.characterAnimation.playPunch();
    } else if (state.action === 'KICK' && this.lastAction !== 'KICK') {
      this.characterAnimation.playKick();
    } else if (state.action === 'RUNNING') {
      this.characterAnimation.setMoving(true, state.speedMult);
    } else if (state.action === 'IDLE') {
      this.characterAnimation.setMoving(false);
    }

    this.lastAction = state.action;
  }

  update(dt: number): void {
    if (!this.isVisible) return;

    // Smooth position interpolation (lerp)
    const posLerpFactor = Math.min(1, dt * 16);
    this.position.lerp(this.targetPosition, posLerpFactor);

    // Smooth yaw rotation interpolation with shortest angular path
    let diff = this.targetYaw - this.yaw;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * 14);

    // Update animations and bones
    this.characterAnimation.update(dt, this.position, this.yaw);

    // Update floating overhead tag
    if (this.tagMesh) {
      this.tagMesh.position.set(this.position.x, this.position.y + 0.45, this.position.z);
    }
  }

  destroy(): void {
    if (this.characterAnimation.model) {
      this.scene.remove(this.characterAnimation.model);
    }
    if (this.tagMesh) {
      this.scene.remove(this.tagMesh);
    }
  }
}
