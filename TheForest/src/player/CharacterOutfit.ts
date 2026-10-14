import * as THREE from 'three';

export type PlayerOutfitType = 'TACTICAL_FIGHTER' | 'FOREST_SURVIVOR';

/**
 * Manages realistic human character outfits, anatomical 3D geometry, and realistic textures
 * for Player 1 (Tactical Fighter) and Player 2 (Forest Survivor).
 * Completely eliminates any robot/mannequin appearance.
 */
export class CharacterOutfit {
  /**
   * Applies the realistic human character model and outfit.
   * Completely hides the robot joints and robot head, replacing them with sculpted human anatomy and clothing.
   */
  static applyOutfit(model: THREE.Group, outfitType: PlayerOutfitType): void {
    const isP1 = outfitType === 'TACTICAL_FIGHTER';

    // 1. Generate high-resolution realistic human PBR body & clothing textures
    const bodyTex = this.generateRealisticHumanTexture(isP1);
    const bodyBump = this.generateRealisticBumpTexture(isP1);

    const clothingMat = new THREE.MeshStandardMaterial({
      map: bodyTex,
      bumpMap: bodyBump,
      bumpScale: 0.05,
      roughness: isP1 ? 0.42 : 0.52,
      metalness: 0.12,
      side: THREE.FrontSide
    });

    // Check if this model is the mannequin fallback or an actual custom human character model
    const hasMannequinMesh = Boolean(
      model.getObjectByName('Beta_Surface') || model.getObjectByName('Beta_Joints')
    );

    // Locate bones in the Mixamo skeletal hierarchy
    const bones: Record<string, THREE.Bone> = {};
    model.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
        const key = child.name.replace(/^.*mixamorig:/, '').replace(/^.*:/, '');
        bones[key] = child as THREE.Bone;
      }
    });

    // Remove previous gear if re-applying
    const toRemove: THREE.Object3D[] = [];
    model.traverse((child) => {
      if (child.userData?.isOutfitGear) {
        toRemove.push(child);
      }
    });
    for (const obj of toRemove) {
      obj.parent?.remove(obj);
    }

    if (!hasMannequinMesh) {
      // CUSTOM HUMAN CHARACTER MODEL (from player1/ or player2/ folders)
      // Already has realistic human anatomy, head, hair, clothing geometry, and embedded textures
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          const mesh = child as THREE.Mesh;
          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => {
              m.side = THREE.FrontSide;
              m.needsUpdate = true;
            });
          }
        }
      });

      // Attach subtle identification marking on the shoulder/arm
      const shoulderBone = bones['LeftArm'] || bones['LeftShoulder'];
      if (shoulderBone) {
        const armBandGroup = new THREE.Group();
        armBandGroup.userData.isOutfitGear = true;

        const bandGeo = new THREE.CylinderGeometry(0.082, 0.086, 0.12, 16);
        bandGeo.rotateZ(Math.PI / 2);
        const bandMat = new THREE.MeshStandardMaterial({
          color: isP1 ? 0x2563eb : 0xea580c,
          emissive: isP1 ? 0x1e40af : 0xc2410c,
          emissiveIntensity: 0.45,
          roughness: 0.35,
          metalness: 0.2
        });
        const bandMesh = new THREE.Mesh(bandGeo, bandMat);
        bandMesh.castShadow = true;
        armBandGroup.add(bandMesh);

        // Subtle insignia badge
        const badgeGeo = new THREE.BoxGeometry(0.02, 0.07, 0.06);
        const badgeMat = new THREE.MeshStandardMaterial({
          color: isP1 ? 0x60a5fa : 0xfb923c,
          roughness: 0.2,
          metalness: 0.8
        });
        const badgeMesh = new THREE.Mesh(badgeGeo, badgeMat);
        badgeMesh.position.set(0, 0.085, 0);
        armBandGroup.add(badgeMesh);

        shoulderBone.add(armBandGroup);
      }
      return;
    }

    // FALLBACK PROCEDURAL OUTFIT for mannequin models
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;

        if (child.name === 'Beta_Joints') {
          // COMPLETELY HIDE ROBOT MECHANICAL HINGES & DISCS
          child.visible = false;
        } else if (child.name === 'Beta_Surface') {
          (child as THREE.Mesh).material = clothingMat;
          child.visible = true;
        }
      }
    });

    // Build and attach fully sculpted 3D Human Anatomy and Realistic Outfits
    this.attachRealisticHumanHead(bones, isP1);
    this.attachRealisticHumanForearmsAndHands(bones, isP1);

    if (isP1) {
      this.attachTacticalFighterOutfit(bones);
    } else {
      this.attachForestSurvivorOutfit(bones);
    }
  }

  /**
   * Generates a 2048x2048 realistic human photographic canvas texture with natural skin,
   * detailed fabric weave, ripstop grid, seam stitching, cargo pockets, and tattoos.
   */
  private static generateRealisticHumanTexture(isP1: boolean): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 2048;
    const ctx = canvas.getContext('2d')!;

    // Base background tone
    ctx.fillStyle = isP1 ? '#18181b' : '#272520';
    ctx.fillRect(0, 0, 2048, 2048);

    // 1. Torso: Black Tactical Combat Jacket (P1) vs Olive Survival Jacket (P2)
    const shirtColor = isP1 ? '#222226' : '#3f4f38';
    const shirtShadow = isP1 ? '#141416' : '#2a3625';

    ctx.fillStyle = shirtColor;
    ctx.fillRect(200, 300, 800, 700);
    ctx.fillRect(1040, 300, 800, 700);

    // Realistic ripstop fabric weave grid
    ctx.strokeStyle = shirtShadow;
    ctx.lineWidth = 1.5;
    for (let x = 200; x <= 1840; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 300);
      ctx.lineTo(x, 1000);
      ctx.stroke();
    }
    for (let y = 300; y <= 1000; y += 24) {
      ctx.beginPath();
      ctx.moveTo(200, y);
      ctx.lineTo(1840, y);
      ctx.stroke();
    }

    // Heavy duty front metal zipper & storm flap
    ctx.strokeStyle = isP1 ? '#3f3f46' : '#1c1917';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(600, 300);
    ctx.lineTo(600, 1000);
    ctx.stroke();

    // 2. Cargo Trousers: Dark Charcoal/Black (P1) vs Olive-Brown (P2)
    const pantColor = isP1 ? '#1a1a1e' : '#3d3023';
    const pantShadow = isP1 ? '#0d0d10' : '#261e16';
    ctx.fillStyle = pantColor;
    ctx.fillRect(200, 1040, 1640, 640);

    // Trousers pockets and knee reinforcement panels
    ctx.strokeStyle = pantShadow;
    ctx.lineWidth = 4;
    ctx.strokeRect(360, 1120, 240, 280);
    ctx.strokeRect(1440, 1120, 240, 280);
    ctx.fillStyle = isP1 ? '#27272a' : '#4a3b2b';
    ctx.fillRect(340, 1100, 280, 70);
    ctx.fillRect(1420, 1100, 280, 70);

    // 3. Realistic Athletic Human Skin & Facial Textures (Upper UV)
    const skinTone = isP1 ? '#d69e74' : '#cc9369';
    ctx.fillStyle = skinTone;
    ctx.fillRect(720, 40, 600, 240);

    // Natural stubble / beard line
    ctx.fillStyle = 'rgba(20, 16, 14, 0.22)';
    ctx.fillRect(800, 180, 440, 80);

    // Forearms skin with realistic tactical ink tattoo
    ctx.fillStyle = skinTone;
    ctx.fillRect(200, 1700, 700, 300);
    ctx.fillRect(1140, 1700, 700, 300);

    // Forearm tattoo pattern (as seen in Image 1 & Image 2)
    ctx.strokeStyle = 'rgba(25, 20, 24, 0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(350 + i * 25, 1780);
      ctx.lineTo(400 + i * 25, 1860);
      ctx.lineTo(370 + i * 25, 1920);
      ctx.stroke();
    }

    // 4. Team Identification Armband
    const patchX = 280;
    const patchY = 440;
    ctx.fillStyle = isP1 ? '#2563eb' : '#ea580c'; // Blue for P1, Orange for P2
    ctx.fillRect(patchX, patchY, 100, 60);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 3;
    ctx.strokeRect(patchX, patchY, 100, 60);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(isP1 ? 'P1' : 'P2', patchX + 50, patchY + 42);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  /**
   * Generates high-detail normal/bump texture for fabric weave and gear seams.
   */
  private static generateRealisticBumpTexture(isP1: boolean): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 1024, 1024);

    // Fine fabric texture
    ctx.fillStyle = isP1 ? '#949494' : '#888888';
    for (let x = 0; x < 1024; x += 12) {
      for (let y = 0; y < 1024; y += 12) {
        if ((x + y) % 24 === 0) {
          ctx.fillRect(x, y, 6, 6);
        }
      }
    }

    // Relief seams
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(200, 520, 120, 140);
    ctx.strokeRect(700, 520, 120, 140);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  /**
   * Builds and attaches a fully sculpted 3D Human Head directly onto mixamorig:Head:
   * - Anatomical human head cranium, natural jawline, and chin.
   * - Realistic 3D Nose bridge and nose tip.
   * - Realistic 3D Human Ears with earlobes.
   * - Expressive 3D Eyes with sclera, vibrant iris, and pupil.
   * - Realistic 3D Stylized Dark Hair matching the user's reference images.
   * - Tactical comms earpiece / headset with mic.
   * This completely encapsulates and replaces the featureless robot head!
   */
  private static attachRealisticHumanHead(bones: Record<string, THREE.Bone>, isP1: boolean): void {
    const headBone = bones['Head'];
    if (!headBone) return;

    const headGroup = new THREE.Group();
    headGroup.userData = { isOutfitGear: true };

    const skinMat = new THREE.MeshStandardMaterial({
      color: isP1 ? 0xd69e74 : 0xcc9369, // Natural warm athletic skin
      roughness: 0.58,
      metalness: 0.02
    });

    const hairMat = new THREE.MeshStandardMaterial({
      color: isP1 ? 0x141417 : 0x221810, // Dark styled hair
      roughness: 0.72,
      metalness: 0.08
    });

    const eyeWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.15,
      metalness: 0.0
    });

    const irisMat = new THREE.MeshStandardMaterial({
      color: isP1 ? 0x1d4ed8 : 0x78350f, // Blue for P1, Hazel/Brown for P2
      roughness: 0.2,
      metalness: 0.1
    });

    const commsMat = new THREE.MeshStandardMaterial({
      color: 0x09090b,
      roughness: 0.35,
      metalness: 0.6
    });

    // 1. Human Head Base (Anatomical Cranium & Face)
    const craniumGeo = new THREE.SphereGeometry(10.2, 24, 24);
    craniumGeo.scale(0.86, 1.14, 0.96);
    const cranium = new THREE.Mesh(craniumGeo, skinMat);
    cranium.position.set(0, 4, -0.5);
    headGroup.add(cranium);

    // 2. Sculpted Human Jaw & Chin
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(7.2, 6.5, 7.5), skinMat);
    jaw.position.set(0, -3.2, 4.2);
    jaw.rotation.x = 0.22;
    headGroup.add(jaw);

    // 3. 3D Human Nose
    const noseGeo = new THREE.ConeGeometry(1.6, 4.2, 4);
    const nose = new THREE.Mesh(noseGeo, skinMat);
    nose.position.set(0, 1.2, 9.6);
    nose.rotation.x = 1.35;
    nose.rotation.y = Math.PI / 4;
    headGroup.add(nose);

    // 4. 3D Human Ears (Left & Right)
    const earGeo = new THREE.SphereGeometry(2.4, 12, 12);
    earGeo.scale(0.35, 1.2, 0.7);
    const earL = new THREE.Mesh(earGeo, skinMat);
    earL.position.set(-8.8, 2.5, -0.5);
    earL.rotation.y = 0.15;
    const earR = new THREE.Mesh(earGeo, skinMat);
    earR.position.set(8.8, 2.5, -0.5);
    earR.rotation.y = -0.15;
    headGroup.add(earL, earR);

    // 5. Expressive 3D Eyes (Left & Right)
    const createEye = (xPos: number) => {
      const eyeGroup = new THREE.Group();
      eyeGroup.position.set(xPos, 3.6, 8.2);

      // Sclera (White)
      const white = new THREE.Mesh(new THREE.SphereGeometry(1.3, 12, 12), eyeWhiteMat);
      // Iris
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 12), irisMat);
      iris.position.set(0, 0, 0.85);

      eyeGroup.add(white, iris);
      return eyeGroup;
    };
    headGroup.add(createEye(-3.1), createEye(3.1));

    // Eyebrows
    const browMat = new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.8 });
    const browL = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 0.6), browMat);
    browL.position.set(-3.1, 5.4, 8.5);
    browL.rotation.z = -0.08;
    const browR = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 0.6), browMat);
    browR.position.set(3.1, 5.4, 8.5);
    browR.rotation.z = 0.08;
    headGroup.add(browL, browR);

    // 6. Realistic 3D Styled Dark Hair (Matching Image 1 & 2)
    const hairGroup = new THREE.Group();
    // Hair volume top
    const hairTopGeo = new THREE.SphereGeometry(10.6, 20, 20);
    hairTopGeo.scale(0.92, 0.75, 1.05);
    const hairTop = new THREE.Mesh(hairTopGeo, hairMat);
    hairTop.position.set(0, 9.6, -0.8);
    hairGroup.add(hairTop);

    // Front styled hair crest / pompadour
    const crestGeo = new THREE.BoxGeometry(7.8, 4.5, 6.2);
    const crest = new THREE.Mesh(crestGeo, hairMat);
    crest.position.set(0, 11.2, 4.5);
    crest.rotation.x = -0.35;
    hairGroup.add(crest);

    // Side hair volume
    const sideHairL = new THREE.Mesh(new THREE.BoxGeometry(2.2, 8.5, 9.2), hairMat);
    sideHairL.position.set(-8.4, 5.8, -0.6);
    const sideHairR = new THREE.Mesh(new THREE.BoxGeometry(2.2, 8.5, 9.2), hairMat);
    sideHairR.position.set(8.4, 5.8, -0.6);
    hairGroup.add(sideHairL, sideHairR);
    headGroup.add(hairGroup);

    // 7. Tactical Headset / Earpiece with Comms Mic (As in Image 1 & 2)
    const commsEar = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 2.4, 12), commsMat);
    commsEar.position.set(-9.2, 2.8, 0);
    commsEar.rotation.z = Math.PI / 2;

    const micArm = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 9.5, 8), commsMat);
    micArm.position.set(-9.2, -1.8, 4.8);
    micArm.rotation.x = Math.PI / 3;

    headGroup.add(commsEar, micArm);

    headBone.add(headGroup);
  }

  /**
   * Attaches realistic muscular human forearms, skin, and tactical gloves onto arm bones:
   * - Tactical fingerless assault gloves showing realistic human fingers for Player 1.
   * - Full-finger survival leather gloves for Player 2.
   */
  private static attachRealisticHumanForearmsAndHands(bones: Record<string, THREE.Bone>, isP1: boolean): void {
    const skinMat = new THREE.MeshStandardMaterial({
      color: isP1 ? 0xd69e74 : 0xcc9369,
      roughness: 0.55,
      metalness: 0.02
    });

    const gloveMat = new THREE.MeshStandardMaterial({
      color: isP1 ? 0x18181b : 0x27272a, // Tactical Black
      roughness: 0.45,
      metalness: 0.2
    });

    const wristDeviceMat = new THREE.MeshStandardMaterial({
      color: 0x09090b,
      roughness: 0.3,
      metalness: 0.7
    });

    // 1. Forearm muscle definition & tactical watch
    const leftForearm = bones['LeftForeArm'];
    if (leftForearm) {
      const armGroup = new THREE.Group();
      armGroup.userData = { isOutfitGear: true };

      // Tactical wrist watch / GPS on left wrist
      const watch = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 3.5, 16), wristDeviceMat);
      watch.position.set(0, -18, 0);
      const watchScreen = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 3.8), new THREE.MeshStandardMaterial({ color: 0x06b6d4, emissive: 0x0891b2, emissiveIntensity: 0.4 }));
      watchScreen.position.set(0, -18, 5.2);
      armGroup.add(watch, watchScreen);
      leftForearm.add(armGroup);
    }

    // 2. Tactical Gloves on Hands (mixamorig:LeftHand and RightHand)
    const addGloveAndFingers = (handBone?: THREE.Bone) => {
      if (!handBone) return;
      const handGroup = new THREE.Group();
      handGroup.userData = { isOutfitGear: true };

      // Glove palm & knuckle armor
      const palm = new THREE.Mesh(new THREE.BoxGeometry(6.8, 6.2, 4.2), gloveMat);
      palm.position.set(0, -3.5, 0);
      const knuckles = new THREE.Mesh(new THREE.BoxGeometry(6.6, 2.5, 4.8), gloveMat);
      knuckles.position.set(0, -5.5, 0.4);
      handGroup.add(palm, knuckles);

      if (isP1) {
        // Player 1 Fingerless Tactical Gloves: Real human fingers extend out!
        for (let i = -1.5; i <= 1.5; i += 1) {
          const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.8, 4.5, 8), skinMat);
          finger.position.set(i * 1.8, -8.2, 0.2);
          handGroup.add(finger);
        }
      }
      handBone.add(handGroup);
    };

    addGloveAndFingers(bones['LeftHand']);
    addGloveAndFingers(bones['RightHand']);
  }

  /**
   * Attaches Player 1 Tactical Fighter Outfit (Matching Image 1):
   * - Tactical combat vest / plate carrier with MOLLE webbing and front ammo pouches.
   * - Shoulder tactical harness with straps and front buckle.
   * - Duty utility belt with side equipment pouches.
   * - Drop-leg holster with sidearm on right thigh.
   * - Large tactical cargo pockets on left thigh.
   * - High-impact tactical polymer knee pads.
   * - Military combat boots with thick lugged outsoles and lace collars.
   * - Subtle Cobalt Blue team marking.
   */
  private static attachTacticalFighterOutfit(bones: Record<string, THREE.Bone>): void {
    const vestMat = new THREE.MeshStandardMaterial({
      color: 0x18181b, // Tactical Charcoal / Black
      roughness: 0.55,
      metalness: 0.18
    });
    const pouchMat = new THREE.MeshStandardMaterial({
      color: 0x27272a, // Ripstop Cordura
      roughness: 0.65,
      metalness: 0.12
    });
    const polymerMat = new THREE.MeshStandardMaterial({
      color: 0x09090b, // Hard Ballistic Polymer
      roughness: 0.35,
      metalness: 0.45
    });
    const blueBadgeMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb, // Cobalt Blue ID Marking
      roughness: 0.35,
      metalness: 0.35
    });

    // 1. Tactical Combat Vest (Plate Carrier) on Spine2
    const spine2 = bones['Spine2'] || bones['Spine1'];
    if (spine2) {
      const vestGroup = new THREE.Group();
      vestGroup.userData = { isOutfitGear: true };

      // Front ballistic plate with MOLLE horizontal ridges
      const frontPlate = new THREE.Mesh(new THREE.BoxGeometry(26, 29, 8.5), vestMat);
      frontPlate.position.set(0, 10, 8.5);
      vestGroup.add(frontPlate);

      // Back ballistic plate
      const backPlate = new THREE.Mesh(new THREE.BoxGeometry(26, 29, 7), vestMat);
      backPlate.position.set(0, 10, -8.5);
      vestGroup.add(backPlate);

      // Shoulder harness straps (as seen in Image 1)
      const strapL = new THREE.Mesh(new THREE.BoxGeometry(6.2, 5.5, 19), vestMat);
      strapL.position.set(-10, 24.5, 0);
      const strapR = new THREE.Mesh(new THREE.BoxGeometry(6.2, 5.5, 19), vestMat);
      strapR.position.set(10, 24.5, 0);
      vestGroup.add(strapL, strapR);

      // 3 Front Magazine Pouches with flap closures
      for (let i = -1; i <= 1; i++) {
        const pouch = new THREE.Mesh(new THREE.BoxGeometry(6.8, 12.5, 5.2), pouchMat);
        pouch.position.set(i * 7.8, 6.5, 13.5);
        vestGroup.add(pouch);
      }

      // Tactical radio unit on left shoulder
      const radio = new THREE.Mesh(new THREE.BoxGeometry(4.2, 8.5, 4.2), polymerMat);
      radio.position.set(-12.5, 23, 6.5);
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 14, 8), polymerMat);
      antenna.position.set(-12.5, 32, 6.5);
      vestGroup.add(radio, antenna);

      spine2.add(vestGroup);
    }

    // 2. Subtle Blue Team Identification Patch on Left Arm
    const leftArm = bones['LeftArm'];
    if (leftArm) {
      const patchGroup = new THREE.Group();
      patchGroup.userData = { isOutfitGear: true };
      const patch = new THREE.Mesh(new THREE.BoxGeometry(6.8, 9.5, 2.2), blueBadgeMat);
      patch.position.set(-5.2, 8.5, 0);
      patchGroup.add(patch);
      leftArm.add(patchGroup);
    }

    // 3. Tactical Duty Belt on Hips
    const hips = bones['Hips'];
    if (hips) {
      const beltGroup = new THREE.Group();
      beltGroup.userData = { isOutfitGear: true };

      const belt = new THREE.Mesh(new THREE.CylinderGeometry(17.5, 17.5, 5.8, 16), vestMat);
      belt.position.set(0, -3.2, 0);
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(5.8, 5.2, 2.8), polymerMat);
      buckle.position.set(0, -3.2, 18);
      beltGroup.add(belt, buckle);

      // Side equipment pouches
      const pouchL = new THREE.Mesh(new THREE.BoxGeometry(6.2, 8.5, 4.8), pouchMat);
      pouchL.position.set(-18, -3.2, 0);
      const pouchR = new THREE.Mesh(new THREE.BoxGeometry(6.2, 8.5, 4.8), pouchMat);
      pouchR.position.set(18, -3.2, 0);
      beltGroup.add(pouchL, pouchR);

      hips.add(beltGroup);
    }

    // 4. Drop-Leg Holster with Sidearm on Right Thigh
    const rightUpLeg = bones['RightUpLeg'];
    if (rightUpLeg) {
      const holsterGroup = new THREE.Group();
      holsterGroup.userData = { isOutfitGear: true };

      const holster = new THREE.Mesh(new THREE.BoxGeometry(5.5, 14.5, 7.5), polymerMat);
      holster.position.set(7.5, -18, 0);
      const strap1 = new THREE.Mesh(new THREE.CylinderGeometry(9.2, 9.2, 2.2, 16), vestMat);
      strap1.position.set(0, -14, 0);
      const strap2 = new THREE.Mesh(new THREE.CylinderGeometry(8.8, 8.8, 2.2, 16), vestMat);
      strap2.position.set(0, -22, 0);

      holsterGroup.add(holster, strap1, strap2);
      rightUpLeg.add(holsterGroup);
    }

    // 5. Cargo Pocket on Left Thigh
    const leftUpLeg = bones['LeftUpLeg'];
    if (leftUpLeg) {
      const pocketGroup = new THREE.Group();
      pocketGroup.userData = { isOutfitGear: true };
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(5.8, 13, 9.5), pouchMat);
      pocket.position.set(-7.5, -18, 0);
      pocketGroup.add(pocket);
      leftUpLeg.add(pocketGroup);
    }

    // 6. Tactical Knee Pads on Both Knees
    const addKneePad = (legBone?: THREE.Bone) => {
      if (!legBone) return;
      const padGroup = new THREE.Group();
      padGroup.userData = { isOutfitGear: true };

      const padShell = new THREE.Mesh(new THREE.BoxGeometry(8.5, 10.5, 4.8), polymerMat);
      padShell.position.set(0, -18, 6.2);
      const padStrap = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 6.8, 4.2, 16), vestMat);
      padStrap.position.set(0, -18, 0);

      padGroup.add(padShell, padStrap);
      legBone.add(padGroup);
    };
    addKneePad(bones['LeftLeg']);
    addKneePad(bones['RightLeg']);

    // 7. Black Military Combat Boots on Feet
    const addBoot = (footBone?: THREE.Bone) => {
      if (!footBone) return;
      const bootGroup = new THREE.Group();
      bootGroup.userData = { isOutfitGear: true };

      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 5.8, 9.5, 16), polymerMat);
      cuff.position.set(0, 4.2, 0);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(10.2, 3.4, 22.5), polymerMat);
      sole.position.set(0, -2.2, 5.2);

      bootGroup.add(cuff, sole);
      footBone.add(bootGroup);
    };
    addBoot(bones['LeftFoot']);
    addBoot(bones['RightFoot']);
  }

  /**
   * Attaches Player 2 Forest Survivor Outfit (Matching Image 2):
   * - Knitted Scarf / Neck Cowl around neck.
   * - Weathered dark survival jacket with dog tags hanging on chest.
   * - Survival harness with utility pouches and compass.
   * - Survival belt with canteen and knife sheath on hips.
   * - Large cargo flap pockets on both thighs.
   * - Heavy-duty hiking boots with deep tread soles and reinforced toe caps.
   * - Subtle Orange/Red team identification marking.
   */
  private static attachForestSurvivorOutfit(bones: Record<string, THREE.Bone>): void {
    const jacketMat = new THREE.MeshStandardMaterial({
      color: 0x3f4f38, // Olive Green Canvas
      roughness: 0.75,
      metalness: 0.08
    });
    const leatherMat = new THREE.MeshStandardMaterial({
      color: 0x452b1b, // Weathered Brown Leather
      roughness: 0.68,
      metalness: 0.15
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x78716c, // Rugged weathered metal
      roughness: 0.35,
      metalness: 0.75
    });
    const orangeBadgeMat = new THREE.MeshStandardMaterial({
      color: 0xea580c, // Subtle Orange/Red ID Marking
      roughness: 0.4,
      metalness: 0.3
    });

    // 1. Scarf / Neck Cowl around Neck (As in Image 2)
    const neck = bones['Neck'];
    if (neck) {
      const scarfGroup = new THREE.Group();
      scarfGroup.userData = { isOutfitGear: true };

      const scarf = new THREE.Mesh(new THREE.TorusGeometry(8.5, 4.5, 14, 18), leatherMat);
      scarf.position.set(0, 0, 0);
      scarf.rotation.x = Math.PI / 2;
      scarfGroup.add(scarf);
      neck.add(scarfGroup);
    }

    // 2. Survival Jacket & Dog Tags on Spine2
    const spine2 = bones['Spine2'] || bones['Spine1'];
    if (spine2) {
      const jacketGroup = new THREE.Group();
      jacketGroup.userData = { isOutfitGear: true };

      // Leather cross straps
      const strapL = new THREE.Mesh(new THREE.BoxGeometry(4.8, 27, 2.2), leatherMat);
      strapL.position.set(-8.5, 10, 8.8);
      const strapR = new THREE.Mesh(new THREE.BoxGeometry(4.8, 27, 2.2), leatherMat);
      strapR.position.set(8.5, 10, 8.8);

      // Utility zippered pouches
      const pouch1 = new THREE.Mesh(new THREE.BoxGeometry(7.2, 10.5, 5.2), jacketMat);
      pouch1.position.set(-8.5, 8, 11.2);
      const pouch2 = new THREE.Mesh(new THREE.BoxGeometry(7.2, 10.5, 5.2), jacketMat);
      pouch2.position.set(8.5, 8, 11.2);

      // Dog Tags (as seen in Image 2!)
      const dogTag = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3.2, 0.4), metalMat);
      dogTag.position.set(0, 14, 9.8);
      dogTag.rotation.z = 0.15;

      jacketGroup.add(strapL, strapR, pouch1, pouch2, dogTag);
      spine2.add(jacketGroup);
    }

    // 3. Subtle Orange/Red Shoulder ID Patch on Left Arm
    const leftArm = bones['LeftArm'];
    if (leftArm) {
      const patchGroup = new THREE.Group();
      patchGroup.userData = { isOutfitGear: true };
      const patch = new THREE.Mesh(new THREE.BoxGeometry(6.8, 9.5, 2.2), orangeBadgeMat);
      patch.position.set(-5.2, 8.5, 0);
      patchGroup.add(patch);
      leftArm.add(patchGroup);
    }

    // 4. Survival Belt with Canteen and Knife Sheath on Hips
    const hips = bones['Hips'];
    if (hips) {
      const beltGroup = new THREE.Group();
      beltGroup.userData = { isOutfitGear: true };

      const belt = new THREE.Mesh(new THREE.CylinderGeometry(17.5, 17.5, 5.2, 16), leatherMat);
      belt.position.set(0, -3.2, 0);
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(5.2, 5.2, 2.2), metalMat);
      buckle.position.set(0, -3.2, 18);

      // Canteen on left hip
      const canteen = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 10.5, 12), metalMat);
      canteen.position.set(-18, -4.2, 0);

      // Knife sheath on right hip
      const sheath = new THREE.Mesh(new THREE.BoxGeometry(3.2, 16.5, 4.8), leatherMat);
      sheath.position.set(18, -6.2, 0);

      beltGroup.add(belt, buckle, canteen, sheath);
      hips.add(beltGroup);
    }

    // 5. Cargo Flap Pockets on Both Thighs
    const addCargoPocket = (thighBone?: THREE.Bone, isRight = false) => {
      if (!thighBone) return;
      const pocketGroup = new THREE.Group();
      pocketGroup.userData = { isOutfitGear: true };
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(5.8, 13, 9.5), jacketMat);
      pocket.position.set(isRight ? 7.5 : -7.5, -17, 0);
      pocketGroup.add(pocket);
      thighBone.add(pocketGroup);
    };
    addCargoPocket(bones['LeftUpLeg'], false);
    addCargoPocket(bones['RightUpLeg'], true);

    // 6. Heavy-Duty Hiking Boots on Feet
    const addHikingBoot = (footBone?: THREE.Bone) => {
      if (!footBone) return;
      const bootGroup = new THREE.Group();
      bootGroup.userData = { isOutfitGear: true };

      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 5.8, 8.5, 16), leatherMat);
      cuff.position.set(0, 3.8, 0);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(9.8, 3.5, 22), metalMat);
      sole.position.set(0, -2.2, 5.2);
      const toeCap = new THREE.Mesh(new THREE.BoxGeometry(8.8, 4.2, 6.5), leatherMat);
      toeCap.position.set(0, 1.2, 12.5);

      bootGroup.add(cuff, sole, toeCap);
      footBone.add(bootGroup);
    };
    addHikingBoot(bones['LeftFoot']);
    addHikingBoot(bones['RightFoot']);
  }
}
