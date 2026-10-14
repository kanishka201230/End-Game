import * as THREE from 'three';
import { Heightfield, SUMMIT } from './heightfield';

type DroneState = 'orbit' | 'approach' | 'inspect' | 'return';

/**
 * Dron cuadricóptero que patrulla sobre la efigie de la cumbre. Si el
 * jugador se acerca, interrumpe la ronda, baja a inspeccionarlo de cerca
 * (rodeándolo con el LED en alerta) y después vuelve a su órbita.
 * Procedural (el dron.bin.gz aportado resultó ser una imagen, no una malla);
 * la geometría es sustituible por un modelo real vía tools/decimate-stl.mjs.
 */
export class Drone {
  private readonly group = new THREE.Group();
  private readonly rotors: THREE.Object3D[] = [];
  private readonly led: THREE.MeshStandardMaterial;
  private readonly baseY: number;

  private state: DroneState = 'orbit';
  private stateTime = 0;
  private cooldownUntil = 0;
  private arcAngle = 0;
  private yaw = 0;
  private pitch = 0;
  private bank = 0;
  private alert = false;

  constructor(scene: THREE.Scene, field: Heightfield) {
    this.baseY = field.sampleHeight(SUMMIT.x, SUMMIT.z);

    const plastic = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.03, 0.03, 0.035),
      roughness: 0.55,
      metalness: 0.25
    });
    const darkMetal = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.02, 0.02, 0.022),
      roughness: 0.4,
      metalness: 0.6
    });

    // Cuerpo central con domo.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.36), plastic);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), plastic);
    dome.scale.set(1.1, 0.55, 1.1);
    dome.position.y = 0.07;
    this.group.add(body, dome);

    // Cámara/gimbal inferior.
    const cam = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), darkMetal);
    cam.position.y = -0.09;
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.03, 0.04, 8),
      new THREE.MeshStandardMaterial({ color: 0x111133, roughness: 0.2, metalness: 0.8 })
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, -0.09, 0.06);
    this.group.add(cam, lens);

    // Brazos, motores y rotores (disco semitransparente = giro borroso).
    const rotorMat = new THREE.MeshBasicMaterial({
      color: 0x0a0a0c,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const dx = Math.cos(a);
      const dz = Math.sin(a);

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.035, 0.055), plastic);
      arm.position.set(dx * 0.24, 0.01, dz * 0.24);
      arm.rotation.y = -a;
      this.group.add(arm);

      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.06, 10), darkMetal);
      motor.position.set(dx * 0.42, 0.04, dz * 0.42);
      this.group.add(motor);

      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.006, 18), rotorMat);
      rotor.position.set(dx * 0.42, 0.085, dz * 0.42);
      this.group.add(rotor);
      this.rotors.push(rotor);

      // Aspas tenues dentro del disco para que el giro se lea de cerca.
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.004, 0.03), plastic);
      blade.position.y = 0.002;
      rotor.add(blade);
    }

    // LED rojo parpadeante (delante) y verde fijo (detrás).
    this.led = new THREE.MeshStandardMaterial({
      color: 0x220505,
      emissive: new THREE.Color(1, 0.05, 0.02),
      emissiveIntensity: 0
    });
    const ledMesh = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), this.led);
    ledMesh.position.set(0, 0.02, 0.19);
    const tail = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 8, 6),
      new THREE.MeshStandardMaterial({
        color: 0x052205,
        emissive: new THREE.Color(0.05, 0.9, 0.1),
        emissiveIntensity: 0.9
      })
    );
    tail.position.set(0, 0.02, -0.19);
    this.group.add(ledMesh, tail);

    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    scene.add(this.group);
  }

  update(dt: number, t: number, playerPos: THREE.Vector3): void {
    this.stateTime += dt;
    const pos = this.group.position;

    // Punto de la ronda normal (órbita elíptica que respira sobre la efigie).
    const radius = 9 + Math.sin(t * 0.11) * 2.5;
    const angle = t * 0.22;
    const orbit = new THREE.Vector3(
      SUMMIT.x + Math.cos(angle) * radius,
      this.baseY + 19 + Math.sin(t * 0.35) * 1.3,
      SUMMIT.z + Math.sin(angle) * radius
    );

    const dPlayerSummit = Math.hypot(playerPos.x - SUMMIT.x, playerPos.z - SUMMIT.z);
    this.alert = false;

    switch (this.state) {
      case 'orbit': {
        pos.copy(orbit);
        this.faceTo(-angle - Math.PI / 2, 0.05, 0.16 + Math.sin(t * 0.11) * 0.03, 1, dt);
        if (dPlayerSummit < 22 && t > this.cooldownUntil) {
          this.state = 'approach';
          this.stateTime = 0;
        }
        break;
      }

      case 'approach': {
        // Punto de inspección: frente al jugador, un poco por encima.
        const away = new THREE.Vector3(pos.x - playerPos.x, 0, pos.z - playerPos.z);
        if (away.lengthSq() < 0.01) away.set(1, 0, 0);
        away.normalize();
        const target = new THREE.Vector3(
          playerPos.x + away.x * 2.6,
          playerPos.y + 1.15,
          playerPos.z + away.z * 2.6
        );
        const arrived = this.flyToward(target, 10, dt, 0.9);
        this.lookWhileFlying(target, dt);
        if (arrived) {
          this.state = 'inspect';
          this.stateTime = 0;
          this.arcAngle = Math.atan2(pos.z - playerPos.z, pos.x - playerPos.x);
        }
        break;
      }

      case 'inspect': {
        // Rodear lentamente al jugador mirándolo, con vaivén de hover.
        this.alert = true;
        this.arcAngle += dt * 0.45;
        const target = new THREE.Vector3(
          playerPos.x + Math.cos(this.arcAngle) * 2.6,
          playerPos.y + 1.15 + Math.sin(t * 2.6) * 0.12,
          playerPos.z + Math.sin(this.arcAngle) * 2.6
        );
        this.flyToward(target, 6, dt);
        // Mirar al jugador (el morro/cámara apunta hacia él).
        const dx = playerPos.x - pos.x;
        const dz = playerPos.z - pos.z;
        const dy = playerPos.y - 0.2 - pos.y;
        this.faceTo(
          Math.atan2(dx, dz),
          -Math.atan2(dy, Math.hypot(dx, dz)) * 0.6,
          0,
          4,
          dt
        );
        if (this.stateTime > 5.5) {
          this.state = 'return';
          this.stateTime = 0;
        }
        break;
      }

      case 'return': {
        // Umbral holgado: la órbita es un objetivo móvil (~2 m/s).
        const arrived = this.flyToward(orbit, 9, dt, 1.8);
        this.lookWhileFlying(orbit, dt);
        if (arrived) {
          this.state = 'orbit';
          this.cooldownUntil = t + 40;
        }
        break;
      }
    }

    this.group.rotation.set(this.pitch, this.yaw, this.bank, 'YXZ');

    // Rotores contrarrotantes (más revolucionados en maniobra).
    const rpm = this.state === 'orbit' ? 85 : 110;
    for (let i = 0; i < this.rotors.length; i++) {
      this.rotors[i].rotation.y += dt * rpm * (i % 2 === 0 ? 1 : -1);
    }

    // LED rojo: doble destello en ronda; parpadeo rápido en inspección.
    let blink: number;
    if (this.alert) {
      blink = t % 0.4 < 0.18 ? 3.6 : 0;
    } else {
      const phase = t % 1.6;
      blink = phase < 0.08 || (phase > 0.22 && phase < 0.3) ? 3.2 : 0;
    }
    this.led.emissiveIntensity = blink;
  }

  /** Vuela hacia el objetivo con velocidad proporcional limitada. Devuelve true al llegar. */
  private flyToward(target: THREE.Vector3, maxSpeed: number, dt: number, arriveDist = 0.5): boolean {
    const pos = this.group.position;
    const dir = new THREE.Vector3().subVectors(target, pos);
    const d = dir.length();
    if (d < 0.001) return true;
    const speed = Math.min(Math.max(d * 2.2, 2.5), maxSpeed);
    pos.addScaledVector(dir.normalize(), Math.min(d, speed * dt));
    return d < arriveDist;
  }

  /** Orientación de crucero: morro hacia el objetivo, alabeo según el giro. */
  private lookWhileFlying(target: THREE.Vector3, dt: number): void {
    const pos = this.group.position;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    if (dx * dx + dz * dz < 0.04) return;
    const prevYaw = this.yaw;
    this.faceTo(Math.atan2(dx, dz), 0.12, 0, 3, dt);
    const turn = THREE.MathUtils.clamp((this.yaw - prevYaw) / Math.max(dt, 1e-3), -2, 2);
    this.bank = THREE.MathUtils.damp(this.bank, -turn * 0.25, 4, dt);
  }

  /** Suaviza yaw (con envoltura angular), pitch y alabeo hacia los objetivos. */
  private faceTo(yaw: number, pitch: number, bank: number, lambda: number, dt: number): void {
    let dyaw = yaw - this.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.yaw += dyaw * (1 - Math.exp(-lambda * dt));
    this.pitch = THREE.MathUtils.damp(this.pitch, pitch, lambda, dt);
    this.bank = THREE.MathUtils.damp(this.bank, bank, lambda, dt);
  }
}
