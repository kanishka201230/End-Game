import * as THREE from 'three';
import { Collider } from './Trees';
import {
  ALL_ARENA_SEGMENTS,
  PathSegment,
  PATH_HALF_WIDTH,
  P1_SPAWN,
  P2_SPAWN,
  DOOR1_POS,
  DOOR2_POS,
  CUP_POS,
  DESTINATION_POS,
  JUNCTION_POS,
  findClosestPathPoint,
  getActivePathSegments
} from './PathSystem';

export type { PathSegment };
export {
  ALL_ARENA_SEGMENTS,
  PATH_HALF_WIDTH,
  P1_SPAWN,
  P2_SPAWN,
  DOOR1_POS,
  DOOR2_POS,
  CUP_POS,
  DESTINATION_POS,
  JUNCTION_POS,
  findClosestPathPoint,
  getActivePathSegments
};

/** All segments composing the walkable pathways (curved, branching routes). */
export const ARENA_SEGMENTS: PathSegment[] = ALL_ARENA_SEGMENTS;

export class ArenaMap {
  readonly group = new THREE.Group();
  private door1LeftWing!: THREE.Group;
  private door1RightWing!: THREE.Group;
  private door2LeftWing!: THREE.Group;
  private door2RightWing!: THREE.Group;

  private trophyMesh!: THREE.Group;
  private trophyLight!: THREE.PointLight;

  private door1Unlocked = false;
  private door2Unlocked = false;
  private door1OpenRatio = 0;
  private door2OpenRatio = 0;

  private cupClaimed = false;

  constructor(scene: THREE.Scene, colliders: Collider[]) {
    this.buildPaths();
    this.buildGates(colliders);
    this.buildPodiumAndCup(colliders);
    scene.add(this.group);
  }

  isDoorUnlocked(doorId: number): boolean {
    return doorId === 1 ? this.door1Unlocked : this.door2Unlocked;
  }

  unlockDoor(doorId: number): void {
    if (doorId === 1) this.door1Unlocked = true;
    if (doorId === 2) this.door2Unlocked = true;
  }

  get isVictory(): boolean {
    return this.cupClaimed;
  }

  claimCup(): void {
    this.cupClaimed = true;
  }

  getWalkSurfaceHeight(_x: number, _z: number, terrainY: number): number {
    // The player stops right before the stone steps on the natural trail surface.
    return terrainY;
  }

  /**
   * Queries closest active path segment for navigation, alignment, and distance.
   */
  getClosestSegment(
    x: number,
    z: number,
    role: 1 | 2 = 1,
    selectedBranch: 'left' | 'right' | 'none' = 'none'
  ) {
    const activeSegments = getActivePathSegments(
      role,
      selectedBranch,
      this.door1Unlocked,
      this.door2Unlocked,
      z
    );
    // Prioritize segments in player's local progression window to avoid locking onto distant/parallel tracks
    const localSegments = activeSegments.filter((seg) => {
      const minZ = Math.min(seg.a.y, seg.b.y);
      const maxZ = Math.max(seg.a.y, seg.b.y);
      return maxZ >= z - 6.0 && minZ <= z + 14.0;
    });
    const candidateSegments = localSegments.length > 0 ? localSegments : activeSegments;
    return findClosestPathPoint(x, z, candidateSegments);
  }

  /**
   * Strictly clamps the player to the active stone/dirt paths and stops them before the steps.
   */
  clampPlayerToPath(
    pos: THREE.Vector3,
    playerRadius = 0.35,
    role: 1 | 2 = 1,
    selectedBranch: 'left' | 'right' | 'none' = 'none'
  ): void {
    // 1. HARD STOP BEFORE THE STEPS:
    // The player is stopped cleanly in front of the grand stone steps (-211.2)
    // without ever clipping or moving inside them.
    if (pos.z < -211.2) {
      pos.z = -211.2;
    }

    // 2. Filter active segments according to player role, door unlocks, and chosen branch
    const activeSegments = getActivePathSegments(
      role,
      selectedBranch,
      this.door1Unlocked,
      this.door2Unlocked,
      pos.z
    );

    // Filter to local segment window around player's current progression to prevent pulling across to distant parallel branches
    const localSegments = activeSegments.filter((seg) => {
      const minZ = Math.min(seg.a.y, seg.b.y);
      const maxZ = Math.max(seg.a.y, seg.b.y);
      return maxZ >= pos.z - 8.0 && minZ <= pos.z + 14.0;
    });
    const candidateSegments = localSegments.length > 0 ? localSegments : activeSegments;

    const p = new THREE.Vector2(pos.x, pos.z);
    let bestDist = Infinity;
    let bestProj = new THREE.Vector2();

    for (const seg of candidateSegments) {
      const ab = seg.b.clone().sub(seg.a);
      const lenSq = ab.lengthSq();
      let t = 0;
      if (lenSq > 0.0001) {
        t = ab.dot(p.clone().sub(seg.a)) / lenSq;
        t = Math.max(0, Math.min(1, t));
      }
      const proj = seg.a.clone().add(ab.multiplyScalar(t));
      const d = p.distanceTo(proj);
      if (d < bestDist) {
        bestDist = d;
        bestProj = proj;
      }
    }

    const maxAllowedDist = PATH_HALF_WIDTH - playerRadius;
    if (bestDist > maxAllowedDist && bestDist > 0.0001) {
      // Clamp strictly back to the path boundary
      const offset = p.clone().sub(bestProj).normalize().multiplyScalar(maxAllowedDist);
      pos.x = bestProj.x + offset.x;
      pos.z = bestProj.y + offset.y;
    }

    // Extra hard barrier at locked doors to prevent crossing gate line
    if (!this.door1Unlocked && Math.abs(pos.x - DOOR1_POS.x) < 2.0) {
      if (pos.z < DOOR1_POS.z + playerRadius) {
        pos.z = DOOR1_POS.z + playerRadius;
      }
    }
    if (!this.door2Unlocked && Math.abs(pos.x - DOOR2_POS.x) < 2.0) {
      if (pos.z < DOOR2_POS.z + playerRadius) {
        pos.z = DOOR2_POS.z + playerRadius;
      }
    }
  }

  update(dt: number, time: number): void {
    // Animate Door 1 opening
    if (this.door1Unlocked && this.door1OpenRatio < 1) {
      this.door1OpenRatio = Math.min(1, this.door1OpenRatio + dt * 1.2);
      const angle = this.door1OpenRatio * (Math.PI * 0.48);
      this.door1LeftWing.rotation.y = -angle;
      this.door1RightWing.rotation.y = angle;
    }

    // Animate Door 2 opening
    if (this.door2Unlocked && this.door2OpenRatio < 1) {
      this.door2OpenRatio = Math.min(1, this.door2OpenRatio + dt * 1.2);
      const angle = this.door2OpenRatio * (Math.PI * 0.48);
      this.door2LeftWing.rotation.y = -angle;
      this.door2RightWing.rotation.y = angle;
    }

    // Animate Trophy floating and spinning
    if (this.trophyMesh) {
      this.trophyMesh.rotation.y += dt * 1.1;
      this.trophyMesh.position.y = CUP_POS.y + Math.sin(time * 2.2) * 0.12;
      this.trophyLight.intensity = 2.5 + Math.sin(time * 3.5) * 0.8;
    }
  }

  private buildPaths(): void {
    // Natural small border stones along the edges of the dirt trail
    this.createTrailBorderStones();
    // Atmospheric wooden signposts at the Forest Junction (branching paths)
    this.createJunctionSignposts();
  }

  /**
   * Atmospheric wooden junction signposts directing the player to the
   * Left (Western Pine) and Right (Eastern Ridge) trails.
   */
  private createJunctionSignposts(): void {
    const postGroup = new THREE.Group();
    postGroup.position.set(JUNCTION_POS.x, 0, JUNCTION_POS.z);

    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x422d1c,
      roughness: 0.85,
      metalness: 0.05
    });
    const signMat = new THREE.MeshStandardMaterial({
      color: 0x5a3d24,
      roughness: 0.8,
      metalness: 0.05
    });

    // Central wooden post
    const postGeo = new THREE.CylinderGeometry(0.1, 0.12, 2.5, 12);
    postGeo.translate(0, 1.25, 0);
    const post = new THREE.Mesh(postGeo, woodMat);
    post.castShadow = true;
    post.receiveShadow = true;
    postGroup.add(post);

    // Left Trail Signboard pointing towards Left Branch
    const leftBoardGeo = new THREE.BoxGeometry(1.3, 0.32, 0.06);
    leftBoardGeo.translate(-0.6, 1.85, 0);
    const leftBoard = new THREE.Mesh(leftBoardGeo, signMat);
    leftBoard.rotation.y = -0.35;
    leftBoard.castShadow = true;
    postGroup.add(leftBoard);

    // Right Trail Signboard pointing towards Right Branch
    const rightBoardGeo = new THREE.BoxGeometry(1.3, 0.32, 0.06);
    rightBoardGeo.translate(0.6, 1.5, 0);
    const rightBoard = new THREE.Mesh(rightBoardGeo, signMat);
    rightBoard.rotation.y = 0.35;
    rightBoard.castShadow = true;
    postGroup.add(rightBoard);

    // Lantern on top of junction post
    this.addLantern(postGroup, new THREE.Vector3(0, 2.6, 0));

    this.group.add(postGroup);
  }

  /**
   * Places natural small river stones/pebbles along the boundary of the dirt trail
   * so the path is completely natural soil without any artificial cement.
   */
  private createTrailBorderStones(): void {
    const stoneGeo = new THREE.DodecahedronGeometry(0.2, 1);
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x5a554a,
      roughness: 0.95,
      metalness: 0.05
    });

    for (const seg of ARENA_SEGMENTS) {
      const dir = seg.b.clone().sub(seg.a);
      const len = dir.length();
      if (len < 0.1) continue;

      const norm = dir.clone().normalize();
      const perp = new THREE.Vector2(-norm.y, norm.x);

      // Place pebbles intermittently along the left & right borders
      const step = 3.5;
      const count = Math.floor(len / step);
      for (let i = 0; i <= count; i++) {
        const t = (i * step) / len;
        const center = seg.a.clone().add(dir.clone().multiplyScalar(t));

        // Random jitter for natural appearance
        const jitter = (Math.sin(center.x * 3.7 + center.y * 2.3) + 1) * 0.15;

        // Left stone
        const leftPos = center.clone().add(perp.clone().multiplyScalar(PATH_HALF_WIDTH + 0.1 + jitter));
        const stoneL = new THREE.Mesh(stoneGeo, stoneMat);
        const sL = 0.7 + Math.abs(Math.sin(center.x * 5.1)) * 0.6;
        stoneL.scale.set(sL, sL * 0.6, sL);
        stoneL.position.set(leftPos.x, 0.04, leftPos.y);
        stoneL.rotation.set(Math.sin(leftPos.x), Math.cos(leftPos.y), 0);
        stoneL.receiveShadow = true;
        this.group.add(stoneL);

        // Right stone
        const rightPos = center.clone().sub(perp.clone().multiplyScalar(PATH_HALF_WIDTH + 0.1 + jitter));
        const stoneR = new THREE.Mesh(stoneGeo, stoneMat);
        const sR = 0.7 + Math.abs(Math.cos(center.y * 4.3)) * 0.6;
        stoneR.scale.set(sR, sR * 0.6, sR);
        stoneR.position.set(rightPos.x, 0.04, rightPos.y);
        stoneR.rotation.set(Math.cos(rightPos.x), Math.sin(rightPos.y), 0);
        stoneR.receiveShadow = true;
        this.group.add(stoneR);
      }
    }
  }

  private buildGates(colliders: Collider[]): void {
    const timberMat = new THREE.MeshStandardMaterial({
      color: 0x3d2817,
      roughness: 0.88,
      metalness: 0.05
    });

    const woodDoorMat = new THREE.MeshStandardMaterial({
      color: 0x4a2e16,
      roughness: 0.78,
      metalness: 0.05
    });

    // DOOR 1 (Blue)
    const d1 = this.createGateStructure(DOOR1_POS, 0x1f75fe, timberMat, woodDoorMat, colliders);
    this.door1LeftWing = d1.left;
    this.door1RightWing = d1.right;

    // DOOR 2 (Red)
    const d2 = this.createGateStructure(DOOR2_POS, 0xd9381e, timberMat, woodDoorMat, colliders);
    this.door2LeftWing = d2.left;
    this.door2RightWing = d2.right;
  }

  private createGateStructure(
    pos: THREE.Vector3,
    _bannerColor: number,
    _timberMat: THREE.Material,
    _woodMat: THREE.Material,
    colliders: Collider[]
  ): { left: THREE.Group; right: THREE.Group } {
    const gateGroup = new THREE.Group();
    gateGroup.position.copy(pos);

    // 1. Ancient Overgrown Stone Arch with Ivy, Vines & Moss (EXACTLY from Image 2)
    const archTex = new THREE.TextureLoader().load('/gate_arch.png');
    archTex.colorSpace = THREE.SRGBColorSpace;
    const archMat = new THREE.MeshStandardMaterial({
      map: archTex,
      transparent: true,
      alphaTest: 0.12,
      roughness: 0.88,
      metalness: 0.05,
      side: THREE.DoubleSide
    });

    const archGeo = new THREE.PlaneGeometry(5.2, 5.2);
    archGeo.translate(0, 2.55, 0); // Base sits right on the soil path

    // Front stone arch plane
    const frontArch = new THREE.Mesh(archGeo, archMat);
    frontArch.position.set(0, 0, 0.18);
    frontArch.castShadow = true;
    gateGroup.add(frontArch);

    // Back stone arch plane (giving 3D thickness to the arch)
    const backArch = new THREE.Mesh(archGeo, archMat);
    backArch.position.set(0, 0, -0.18);
    backArch.castShadow = true;
    gateGroup.add(backArch);

    // Left and Right stone pillar colliders
    colliders.push({ x: pos.x - 1.5, z: pos.z, r: 0.65 });
    colliders.push({ x: pos.x + 1.5, z: pos.z, r: 0.65 });

    // 2. Weathered Stone Step Base (slabs matching the base of Image 2)
    const slabMat = new THREE.MeshStandardMaterial({
      color: 0x5a544a,
      roughness: 0.95,
      metalness: 0.05
    });
    const stepSlab = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.22, 1.2), slabMat);
    stepSlab.position.set(0, 0.11, 0);
    stepSlab.receiveShadow = true;
    gateGroup.add(stepSlab);

    // 3. Arched Wooden Double Door nestled inside the stone arch opening
    const doorWoodMat = new THREE.MeshStandardMaterial({
      color: 0x2e1c0e,
      roughness: 0.85,
      metalness: 0.08
    });
    const ironBandMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.5,
      metalness: 0.85
    });

    // Left Door Wing (Pivot at x = -1.15)
    const leftHinge = new THREE.Group();
    leftHinge.position.set(-1.15, 1.8, 0);

    const wingGeoL = new THREE.BoxGeometry(1.15, 3.2, 0.1);
    wingGeoL.translate(0.575, 0, 0);
    const leftDoorMesh = new THREE.Mesh(wingGeoL, doorWoodMat);
    leftDoorMesh.castShadow = true;
    leftHinge.add(leftDoorMesh);

    // Wrought iron strap bands on left door
    for (const bandY of [-1.0, 0.0, 1.0]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.09, 0.12), ironBandMat);
      band.position.set(0.575, bandY, 0);
      leftHinge.add(band);
    }
    gateGroup.add(leftHinge);

    // Right Door Wing (Pivot at x = +1.15)
    const rightHinge = new THREE.Group();
    rightHinge.position.set(1.15, 1.8, 0);

    const wingGeoR = new THREE.BoxGeometry(1.15, 3.2, 0.1);
    wingGeoR.translate(-0.575, 0, 0);
    const rightDoorMesh = new THREE.Mesh(wingGeoR, doorWoodMat);
    rightDoorMesh.castShadow = true;
    rightHinge.add(rightDoorMesh);

    // Wrought iron strap bands on right door
    for (const bandY of [-1.0, 0.0, 1.0]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.09, 0.12), ironBandMat);
      band.position.set(-0.575, bandY, 0);
      rightHinge.add(band);
    }
    gateGroup.add(rightHinge);

    // Ancient Iron Padlock in center
    const lockMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 16), ironBandMat);
    lockMesh.position.set(0, 1.8, 0.08);
    gateGroup.add(lockMesh);

    // 4. Ethereal Golden Light & Mystic Atmosphere
    const auraLight = new THREE.PointLight(0xffdf80, 2.4, 14, 1.2);
    auraLight.position.set(0, 2.6, 0.5);
    gateGroup.add(auraLight);

    const backAura = new THREE.PointLight(0xfff0b3, 1.8, 12, 1.4);
    backAura.position.set(0, 2.6, -0.6);
    gateGroup.add(backAura);

    this.group.add(gateGroup);

    return { left: leftHinge, right: rightHinge };
  }

  private addLantern(parent: THREE.Group, pos: THREE.Vector3): void {
    const lampGeo = new THREE.BoxGeometry(0.35, 0.5, 0.35);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffaa33 });
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.copy(pos);
    parent.add(lamp);

    const light = new THREE.PointLight(0xff9922, 1.6, 12, 1.2);
    light.position.copy(pos);
    parent.add(light);
  }

  private buildPodiumAndCup(colliders: Collider[]): void {
    const podiumMat = new THREE.MeshStandardMaterial({
      color: 0x68645e,
      roughness: 0.8,
      metalness: 0.1
    });

    const daisGroup = new THREE.Group();
    daisGroup.position.copy(CUP_POS);

    // Main raised dais platform
    const platformGeo = new THREE.BoxGeometry(9.0, 1.4, 9.0);
    const platform = new THREE.Mesh(platformGeo, podiumMat);
    platform.position.set(0, -0.7, 0);
    platform.receiveShadow = true;
    platform.castShadow = true;
    daisGroup.add(platform);

    // Front Stairs leading up to dais
    for (let step = 0; step < 5; step++) {
      const stepGeo = new THREE.BoxGeometry(4.2, 0.28, 0.8);
      const stepMesh = new THREE.Mesh(stepGeo, podiumMat);
      stepMesh.position.set(0, -1.26 + step * 0.28, 4.5 + (4 - step) * 0.8);
      stepMesh.receiveShadow = true;
      daisGroup.add(stepMesh);
    }

    // Physical collision barriers across the front and sides of the stone steps
    // to strictly stop the player before the steps without clipping inside
    for (let sx = -2.4; sx <= 2.4; sx += 0.55) {
      colliders.push({ x: CUP_POS.x + sx, z: -211.8, r: 0.55 });
    }
    for (let sz = -212; sz >= -225; sz -= 2.0) {
      colliders.push({ x: CUP_POS.x - 4.6, z: sz, r: 0.75 });
      colliders.push({ x: CUP_POS.x + 4.6, z: sz, r: 0.75 });
    }
    colliders.push({ x: CUP_POS.x, z: -220.0, r: 3.5 });

    // 4 Corner Pillars with burning braziers
    const cornerOffsets = [
      [-3.8, -3.8],
      [3.8, -3.8],
      [-3.8, 3.8],
      [3.8, 3.8]
    ];

    cornerOffsets.forEach(([cx, cz]) => {
      const pillarGeo = new THREE.CylinderGeometry(0.5, 0.55, 2.4, 16);
      const pillar = new THREE.Mesh(pillarGeo, podiumMat);
      pillar.position.set(cx, 0.4, cz);
      pillar.castShadow = true;
      daisGroup.add(pillar);
      colliders.push({ x: CUP_POS.x + cx, z: CUP_POS.z + cz, r: 0.6 });

      // Fire Bowl Brazier
      const bowlGeo = new THREE.CylinderGeometry(0.7, 0.35, 0.5, 16);
      const bowlMat = new THREE.MeshStandardMaterial({ color: 0x332f2c, metalness: 0.4, roughness: 0.7 });
      const bowl = new THREE.Mesh(bowlGeo, bowlMat);
      bowl.position.set(cx, 1.7, cz);
      daisGroup.add(bowl);

      // Fire Flame Mesh
      const flameGeo = new THREE.ConeGeometry(0.35, 0.8, 12);
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(cx, 2.2, cz);
      daisGroup.add(flame);

      // Warm Torch Light
      const torchLight = new THREE.PointLight(0xff7711, 2.0, 16, 1.2);
      torchLight.position.set(cx, 2.3, cz);
      daisGroup.add(torchLight);
    });

    // Central Plinth for Trophy
    const plinthGeo = new THREE.CylinderGeometry(0.9, 1.1, 0.9, 24);
    const plinth = new THREE.Mesh(plinthGeo, podiumMat);
    plinth.position.set(0, 0.35, 0);
    plinth.receiveShadow = true;
    daisGroup.add(plinth);

    // GOLDEN TROPHY CUP
    this.trophyMesh = new THREE.Group();
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      metalness: 0.95,
      roughness: 0.15,
      emissive: 0x3a2e00
    });

    // Trophy Base
    const baseGeo = new THREE.CylinderGeometry(0.45, 0.6, 0.18, 24);
    const baseMesh = new THREE.Mesh(baseGeo, goldMat);
    baseMesh.position.set(0, 0.1, 0);
    this.trophyMesh.add(baseMesh);

    // Trophy Stem
    const stemGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.45, 16);
    const stemMesh = new THREE.Mesh(stemGeo, goldMat);
    stemMesh.position.set(0, 0.35, 0);
    this.trophyMesh.add(stemMesh);

    // Trophy Bowl
    const cupBowlGeo = new THREE.CylinderGeometry(0.55, 0.22, 0.7, 24, 1, true);
    const cupBowlMesh = new THREE.Mesh(cupBowlGeo, goldMat);
    cupBowlMesh.position.set(0, 0.8, 0);
    this.trophyMesh.add(cupBowlMesh);

    // Trophy Handles (Left and Right Torus)
    const handleGeo = new THREE.TorusGeometry(0.24, 0.05, 12, 24, Math.PI * 1.2);
    const handleL = new THREE.Mesh(handleGeo, goldMat);
    handleL.position.set(-0.52, 0.85, 0);
    handleL.rotation.z = Math.PI * 0.4;
    this.trophyMesh.add(handleL);

    const handleR = new THREE.Mesh(handleGeo, goldMat);
    handleR.position.set(0.52, 0.85, 0);
    handleR.rotation.z = -Math.PI * 0.4;
    this.trophyMesh.add(handleR);

    // Glowing Golden Point Light (subtle local glow on the altar)
    this.trophyLight = new THREE.PointLight(0xffd700, 2.2, 12, 1.2);
    this.trophyLight.position.set(0, 1.2, 0);
    this.trophyMesh.add(this.trophyLight);

    this.trophyMesh.position.set(0, 0.8, 0);
    daisGroup.add(this.trophyMesh);

    this.group.add(daisGroup);
  }
}
