import * as THREE from 'three';
import { Heightfield } from '../world/heightfield';
import { Collider } from '../world/Trees';
import { ArenaMap } from '../world/ArenaMap';
import { CharacterAnimation } from './CharacterAnimation';
import { getOrderedRouteWaypoints } from '../world/PathSystem';

const EYE_HEIGHT = 1.68;

// ISSUE 1: Calibrated movement speeds
export const NORMAL_RUN_SPEED = 10.5; // Fast, responsive baseline running speed (was 7.5 / 4.0)
export const SPRINT_MULT = 1.35;      // Keyboard Shift multiplier (14.18 m/s)
export const BOOST_MULTIPLIER = 1.9;  // Speed Boost active multiplier: 19.95 m/s (~20 m/s)
const GRAVITY = 22;
const JUMP_SPEED = 5.2;

/**
 * First & Third Person Controller:
 * Handles frame-rate independent movement, authoritative gesture steering,
 * sequential waypoint progression, and speed boost integration.
 */
export class FirstPersonController {
  readonly position: THREE.Vector3;
  enabled = false;
  arenaMap: ArenaMap | null = null;
  landingSpeed = 0;

  /** Speed boost active state */
  speedBoostActive = false;

  /** Camera mode: 3rd person by default */
  isThirdPerson = true;
  characterAnimation?: CharacterAnimation;

  /** Player role (1 = P1, 2 = P2) */
  role: 1 | 2 = 1;

  /** Selected trail branch ('left' | 'right' | 'none') */
  selectedBranch: 'left' | 'right' | 'none' = 'none';
  private branchLocked = false;

  // Waypoint progression system (ISSUE 3)
  private routeWaypoints: THREE.Vector2[] = [];
  public currentWaypointIndex = 0;

  // Manual steer timer for authoritative gesture override (ISSUE 2)
  private manualSteerTimer = 0;

  // Stuck detection (ISSUE 3)
  private stuckTimer = 0;
  private lastStuckCheckPos = new THREE.Vector3();

  private yaw = Math.PI;
  private pitch = 0;
  private readonly velocity = new THREE.Vector3();
  private grounded = true;
  private readonly keys = new Set<string>();
  private bobTime = 0;
  private bobAmount = 0;

  // Cinematic camera smoothing
  private currentCamPos = new THREE.Vector3();
  private currentLookTarget = new THREE.Vector3();
  private camInitialized = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly field: Heightfield,
    private readonly colliders: Collider[],
    spawn: THREE.Vector3
  ) {
    this.position = spawn.clone();
    this.position.y = field.sampleHeight(spawn.x, spawn.z) + EYE_HEIGHT;
    this.yaw = 0;
    this.pitch = 0.02;

    this.initRoute();

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyV') {
        this.toggleCameraView();
        return;
      }
      if (e.code === 'KeyJ' || e.code === 'KeyP') {
        this.triggerPunch();
        return;
      }
      if (e.code === 'KeyK') {
        this.triggerKick();
        return;
      }
      this.keys.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        return;
      }
      this.keys.delete(e.code);
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      this.yaw -= e.movementX * 0.0021;
      this.pitch -= e.movementY * 0.0021;
      const lim = Math.PI / 2 - 0.06;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -lim, lim);
    });

    this.syncCamera(0);
  }

  private initRoute(): void {
    const branch = this.selectedBranch === 'right' ? 'right' : 'left';
    this.routeWaypoints = getOrderedRouteWaypoints(this.role, branch);
    this.currentWaypointIndex = 0;
    this.branchLocked = false;
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  get rotationYaw(): number {
    return this.yaw;
  }

  teleport(pos: THREE.Vector3, yaw = 0): void {
    this.position.copy(pos);
    const rawH = this.field.sampleHeight(pos.x, pos.z);
    const surfaceH = this.arenaMap ? this.arenaMap.getWalkSurfaceHeight(pos.x, pos.z, rawH) : rawH;
    this.position.y = surfaceH + EYE_HEIGHT;
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0.02;
    this.camInitialized = false;
    this.initRoute();
    this.lastStuckCheckPos.copy(this.position);
    this.syncCamera(0);
  }

  selectBranch(branch: 'left' | 'right'): void {
    if (this.branchLocked && this.selectedBranch !== 'none') return;
    this.selectedBranch = branch;
    const oldIdx = this.currentWaypointIndex;
    this.routeWaypoints = getOrderedRouteWaypoints(this.role, branch);
    this.currentWaypointIndex = Math.min(oldIdx, Math.max(0, this.routeWaypoints.length - 2));
  }

  // Hand Gesture Inputs
  gestureForward = false;
  gestureMoveLeft = false;
  gestureMoveRight = false;
  gestureTurnLeft = false;
  gestureTurnRight = false;
  gestureJumpRequested = false;

  triggerJump(): void {
    if (this.enabled && this.grounded) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
    }
  }

  /** Provider to check if opponent is connected, visible, and in combat range */
  getOpponentTarget?: () => { position: THREE.Vector3; isVisible: boolean } | null;
  readonly COMBAT_RANGE = 4.0;

  get canFight(): boolean {
    if (!this.getOpponentTarget) return false;
    const opp = this.getOpponentTarget();
    if (!opp || !opp.isVisible) return false;
    return this.position.distanceTo(opp.position) <= this.COMBAT_RANGE;
  }

  triggerPunch(): void {
    if (!this.canFight) return;
    this.characterAnimation?.playPunch();
  }

  triggerKick(): void {
    if (!this.canFight) return;
    this.characterAnimation?.playKick();
  }

  toggleCameraView(): void {
    this.isThirdPerson = !this.isThirdPerson;
    this.camInitialized = false;
  }

  stopAllMovement(): void {
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.gestureForward = false;
    this.gestureMoveLeft = false;
    this.gestureMoveRight = false;
    this.gestureTurnLeft = false;
    this.gestureTurnRight = false;
    this.characterAnimation?.setMoving(false);
  }

  update(dt: number): void {
    this.landingSpeed = 0;
    dt = Math.min(dt, 0.05);

    // 1. Authoritative Steering Controls (Keys or Gestures)
    const turningLeft = this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.gestureTurnLeft;
    const turningRight = this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.gestureTurnRight;

    if (this.enabled) {
      if (turningLeft) {
        this.yaw += 2.5 * dt;
        this.manualSteerTimer = 1.0; // User input overrides path curve
        if (this.position.z > -55 && this.position.z < -20 && !this.branchLocked) {
          this.selectBranch('left');
        }
      }
      if (turningRight) {
        this.yaw -= 2.5 * dt;
        this.manualSteerTimer = 1.0; // User input overrides path curve
        if (this.position.z > -55 && this.position.z < -20 && !this.branchLocked) {
          this.selectBranch('right');
        }
      }
    }

    if (this.manualSteerTimer > 0) {
      this.manualSteerTimer -= dt;
    }

    // 2. Lock trail branch past the Forest Junction (z <= -40)
    if (this.position.z <= -40 && !this.branchLocked) {
      this.branchLocked = true;
      if (this.selectedBranch === 'none') {
        this.selectBranch(this.role === 1 ? 'left' : 'right');
      }
    }

    // 3. Sequential Waypoint Progression (Monotonically advancing - ISSUE 3)
    if (this.routeWaypoints.length >= 2) {
      const p2D = new THREE.Vector2(this.position.x, this.position.z);
      const currWp = this.routeWaypoints[this.currentWaypointIndex];
      const nextWp = this.routeWaypoints[Math.min(this.currentWaypointIndex + 1, this.routeWaypoints.length - 1)];

      const segVec = nextWp.clone().sub(currWp);
      const segLenSq = segVec.lengthSq();

      let t = 0;
      if (segLenSq > 0.001) {
        t = p2D.clone().sub(currWp).dot(segVec) / segLenSq;
      }
      const distToNext = p2D.distanceTo(nextWp);

      // Advance waypoint when reached or projected forward (NEVER decreases)
      if ((t >= 0.72 || distToNext < 3.4) && this.currentWaypointIndex < this.routeWaypoints.length - 2) {
        this.currentWaypointIndex++;
      }
    }

    // 4. Direction vectors in XZ plane based on character yaw
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);

    const isAttacking = this.characterAnimation?.isAttackPlaying ?? false;
    const input = new THREE.Vector3();

    // 5. User Movement Inputs
    if (this.enabled && !isAttacking) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.gestureForward) input.add(forward);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) input.sub(forward);
      if (this.gestureMoveRight) input.add(right.clone().multiplyScalar(0.4));
      if (this.gestureMoveLeft) input.sub(right.clone().multiplyScalar(0.4));
    }

    // 6. Natural path curvature alignment (ONLY when NOT manually steering)
    const isMovingForward = (this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.gestureForward) && this.enabled && !isAttacking;
    if (isMovingForward && this.manualSteerTimer <= 0 && this.routeWaypoints.length >= 2) {
      const currWp = this.routeWaypoints[this.currentWaypointIndex];
      const nextWp = this.routeWaypoints[Math.min(this.currentWaypointIndex + 1, this.routeWaypoints.length - 1)];
      const segVec = nextWp.clone().sub(currWp);

      if (segVec.lengthSq() > 0.01) {
        const tan = segVec.clone().normalize();
        const pathYaw = Math.atan2(-tan.x, -tan.y);
        const angleDiff = THREE.MathUtils.euclideanModulo(pathYaw - this.yaw + Math.PI, Math.PI * 2) - Math.PI;

        // ONLY gently align if already broadly facing the forward direction (|diff| < 60 deg)
        // Ensures user turns are never overwritten or reversed
        if (Math.abs(angleDiff) < Math.PI / 3) {
          this.yaw += angleDiff * Math.min(1.0, 2.8 * dt);
        }
      }
    }

    // 7. Movement Speed & Speed Boost (ISSUE 1)
    const sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const boostMult = this.speedBoostActive ? BOOST_MULTIPLIER : 1.0;
    const baseSpeed = NORMAL_RUN_SPEED * (sprinting ? SPRINT_MULT : 1.0);
    const targetSpeed = input.lengthSq() > 0 ? baseSpeed * boostMult : 0;
    if (input.lengthSq() > 0) input.normalize();

    // Fast, frame-rate independent horizontal velocity response
    const dampLambda = this.speedBoostActive ? 22 : (this.grounded ? 18 : 8);
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, input.x * targetSpeed, dampLambda, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, input.z * targetSpeed, dampLambda, dt);

    // Gravity and jumping
    if (this.enabled && this.grounded && (this.keys.has('Space') || this.gestureJumpRequested)) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
      this.gestureJumpRequested = false;
    }
    if (!this.grounded) this.velocity.y -= GRAVITY * dt;

    // Position integration
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    // Hard stop in front of the grand stone steps (-211.2)
    if (this.position.z < -211.2) {
      this.position.z = -211.2;
      if (this.velocity.z < 0) this.velocity.z = 0;
    }

    // 8. Stuck Detection & Obstacle Recovery (ISSUE 3)
    if (isMovingForward) {
      const movedDist = this.position.distanceTo(this.lastStuckCheckPos);
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.5) {
        if (movedDist < 0.4 && this.routeWaypoints.length >= 2) {
          // Player commanded movement but position didn't advance -> nudge along active segment
          const currWp = this.routeWaypoints[this.currentWaypointIndex];
          const nextWp = this.routeWaypoints[Math.min(this.currentWaypointIndex + 1, this.routeWaypoints.length - 1)];
          const midX = (currWp.x + nextWp.x) * 0.5;
          const midZ = (currWp.y + nextWp.y) * 0.5;
          this.position.x += (midX - this.position.x) * 0.15;
          this.position.z += (midZ - this.position.z) * 0.15;
        }
        this.lastStuckCheckPos.copy(this.position);
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
      this.lastStuckCheckPos.copy(this.position);
    }

    // 9. Strict Path Clamping (stay on stone/dirt paths, never grass)
    if (this.arenaMap) {
      this.arenaMap.clampPlayerToPath(this.position, 0.35, this.role, this.selectedBranch);
    }

    // Collisions with trees & rocks
    for (const c of this.colliders) {
      const dx = this.position.x - c.x;
      const dz = this.position.z - c.z;
      const rr = c.r + 0.42;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.position.x = c.x + (dx / d) * rr;
        this.position.z = c.z + (dz / d) * rr;
      }
    }

    // Ground surface collision
    const rawH = this.field.sampleHeight(this.position.x, this.position.z);
    const surfaceH = this.arenaMap ? this.arenaMap.getWalkSurfaceHeight(this.position.x, this.position.z, rawH) : rawH;
    const groundY = surfaceH + EYE_HEIGHT;

    if (this.position.y <= groundY) {
      if (!this.grounded && this.velocity.y < -3) this.landingSpeed = -this.velocity.y;
      this.position.y = groundY;
      this.velocity.y = 0;
      this.grounded = true;
    } else if (this.position.y > groundY + 0.05) {
      this.grounded = false;
    }

    // Head-bob
    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const target = this.grounded ? THREE.MathUtils.clamp(hSpeed / NORMAL_RUN_SPEED, 0, 1.8) : 0;
    this.bobAmount = THREE.MathUtils.damp(this.bobAmount, target, 6, dt);
    this.bobTime += dt * (4.6 + hSpeed * 0.9);

    // 10. Synchronize Character Running Animation to Actual Ground Speed (ISSUE 1)
    const isMoving = hSpeed > 0.2 || (this.enabled && this.gestureForward);
    const animScale = THREE.MathUtils.clamp((hSpeed / NORMAL_RUN_SPEED) * 1.35, 0.8, 2.8);
    this.characterAnimation?.setMoving(isMoving, animScale);
    this.characterAnimation?.update(dt, this.position, this.yaw);

    this.syncCamera(dt);

    // Expose targeted debug diagnostics
    (window as unknown as { __navigationDebug: Record<string, unknown> }).__navigationDebug = {
      waypointIndex: this.currentWaypointIndex,
      totalWaypoints: this.routeWaypoints.length,
      normalSpeed: NORMAL_RUN_SPEED,
      activeSpeed: Math.round(hSpeed * 10) / 10,
      boostActive: this.speedBoostActive,
      boostMultiplier: BOOST_MULTIPLIER,
      worldPos: {
        x: Math.round(this.position.x * 10) / 10,
        y: Math.round(this.position.y * 10) / 10,
        z: Math.round(this.position.z * 10) / 10
      },
      branch: this.selectedBranch,
      branchLocked: this.branchLocked,
      manualSteerTimer: Math.round(this.manualSteerTimer * 10) / 10
    };
  }

  private syncCamera(_dt: number): void {
    if (this.isThirdPerson) {
      const dist = 2.6;
      const heightOffset = 0.38;
      const pitchCos = Math.cos(this.pitch);

      const targetCamX = this.position.x + Math.sin(this.yaw) * dist * pitchCos;
      const targetCamZ = this.position.z + Math.cos(this.yaw) * dist * pitchCos;
      const targetCamY = this.position.y + heightOffset + Math.sin(this.pitch) * dist * 0.45;

      const targetLookX = this.position.x - Math.sin(this.yaw) * 1.5;
      const targetLookY = this.position.y + 0.15 - Math.sin(this.pitch) * 1.5;
      const targetLookZ = this.position.z - Math.cos(this.yaw) * 1.5;

      if (!this.camInitialized || _dt <= 0) {
        this.currentCamPos.set(targetCamX, targetCamY, targetCamZ);
        this.currentLookTarget.set(targetLookX, targetLookY, targetLookZ);
        this.camInitialized = true;
      } else {
        this.currentCamPos.x = THREE.MathUtils.damp(this.currentCamPos.x, targetCamX, 12, _dt);
        this.currentCamPos.y = THREE.MathUtils.damp(this.currentCamPos.y, targetCamY, 12, _dt);
        this.currentCamPos.z = THREE.MathUtils.damp(this.currentCamPos.z, targetCamZ, 12, _dt);

        this.currentLookTarget.x = THREE.MathUtils.damp(this.currentLookTarget.x, targetLookX, 14, _dt);
        this.currentLookTarget.y = THREE.MathUtils.damp(this.currentLookTarget.y, targetLookY, 14, _dt);
        this.currentLookTarget.z = THREE.MathUtils.damp(this.currentLookTarget.z, targetLookZ, 14, _dt);
      }

      this.camera.position.copy(this.currentCamPos);
      this.camera.lookAt(this.currentLookTarget);
    } else {
      const bobY = Math.sin(this.bobTime * 2) * 0.032 * this.bobAmount;
      const bobX = Math.cos(this.bobTime) * 0.02 * this.bobAmount;

      this.camera.position.set(
        this.position.x + bobX * Math.cos(this.yaw),
        this.position.y + bobY,
        this.position.z - bobX * Math.sin(this.yaw)
      );
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    }
  }
}
