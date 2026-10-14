import * as THREE from 'three';
import { EffectComposer } from 'postprocessing';
import { Heightfield, SPAWN } from '../world/heightfield';
import { createTerrain } from '../world/Terrain';
import { SkyEnv } from '../world/SkyEnv';
import { createGrass } from '../world/Grass';
import { createForest, Collider } from '../world/Trees';
import { createRocks, createLogs, Motes } from '../world/Details';
import { createLandmarks } from '../world/Landmarks';
import { Drone } from '../world/Drone';
import { FirstPersonController } from '../player/FirstPersonController';
import { createComposer } from '../fx/PostProcessing';
import { AudioSystem } from '../audio/AudioSystem';
import { shared } from './uniforms';
import { ArenaMap, DOOR1_POS, DOOR2_POS, CUP_POS, P1_SPAWN, P2_SPAWN } from '../world/ArenaMap';
import { ScrollQuizUI } from '../ui/ScrollQuiz';
import { Minimap } from '../ui/Minimap';
import { HandGestureController } from '../input/HandGestureController';
import { SpeedBoostController } from '../ui/SpeedBoostController';
import { CharacterAnimation } from '../player/CharacterAnimation';
import { CombatHUD } from '../ui/CombatHUD';
import { RemotePlayer } from '../player/RemotePlayer';
import { NetworkClient, NetRole, WorldNetState } from '../net/NetworkClient';
import { MultiplayerHUD } from '../ui/MultiplayerHUD';

type Progress = (fraction: number, label: string) => void;

interface QualityPreset {
  grassCount: number;
  shadowMapSize: number;
  pixelRatioCap: number;
}

const PRESETS: Record<string, QualityPreset> = {
  low: { grassCount: 45000, shadowMapSize: 2048, pixelRatioCap: 1.25 },
  med: { grassCount: 130000, shadowMapSize: 3072, pixelRatioCap: 1.6 },
  high: { grassCount: 220000, shadowMapSize: 4096, pixelRatioCap: 2 }
};

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();

  private field!: Heightfield;
  private sky!: SkyEnv;
  private controller!: FirstPersonController;
  private composer!: EffectComposer;
  private motes!: Motes;
  private audio!: AudioSystem;
  private drone!: Drone;
  private forestUpdate!: (camPos: THREE.Vector3) => void;
  private arenaMap!: ArenaMap;
  private scrollQuiz!: ScrollQuizUI;
  private minimap!: Minimap;
  private handGesture?: HandGestureController;
  private speedBoost!: SpeedBoostController;
  public characterAnimation!: CharacterAnimation;
  public combatHud!: CombatHUD;
  public remotePlayer!: RemotePlayer;
  public networkClient!: NetworkClient;
  public multiplayerHud!: MultiplayerHUD;
  selectedPlayer: 1 | 2 = 1;
  private readonly quality: QualityPreset;

  constructor(container: HTMLElement) {
    const q = new URLSearchParams(location.search).get('q') ?? 'med';
    this.quality = PRESETS[q] ?? PRESETS.med;

    const pParam = new URLSearchParams(location.search).get('player') || new URLSearchParams(location.search).get('p');
    if (pParam === '2') {
      this.selectedPlayer = 2;
    } else {
      this.selectedPlayer = 1;
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatioCap));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer?.setSize(window.innerWidth, window.innerHeight);
    });
  }

  /** Construye el mundo por pasos, cediendo al DOM para actualizar la barra de carga. */
  async build(progress: Progress): Promise<void> {
    progress(0.05, 'Modelando el terreno…');
    await tick();
    this.field = new Heightfield();

    progress(0.25, 'Iluminando el cielo…');
    await tick();
    this.sky = new SkyEnv(this.renderer, this.scene, this.quality.shadowMapSize);

    progress(0.4, 'Extendiendo la ladera…');
    await tick();
    this.scene.add(await createTerrain(this.field));

    progress(0.55, 'Sembrando el pasto…');
    await tick();
    this.scene.add(createGrass(this.field, this.quality.grassCount));

    progress(0.72, 'Plantando el bosque…');
    await tick();
    const forest = createForest(this.field, this.scene);
    const colliders = forest.colliders;
    this.forestUpdate = forest.update;

    progress(0.85, 'Construyendo senderos de piedra y puertas…');
    await tick();
    createRocks(this.field, this.scene, colliders);
    createLogs(this.field, this.scene, colliders);
    await createLandmarks(this.field, this.scene, colliders);

    this.arenaMap = new ArenaMap(this.scene, colliders);
    this.scrollQuiz = new ScrollQuizUI();
    this.minimap = new Minimap();
    this.drone = new Drone(this.scene, this.field);
    this.motes = new Motes(this.scene);

    progress(0.92, 'Configurando conexión multijugador…');
    await tick();
    this.multiplayerHud = new MultiplayerHUD();
    this.networkClient = new NetworkClient();

    const spawnPos = this.selectedPlayer === 1 ? P1_SPAWN : P2_SPAWN;
    const spawnYaw = this.selectedPlayer === 1 ? -Math.PI / 2 : Math.PI / 2;
    this.controller = new FirstPersonController(this.camera, this.field, colliders, spawnPos);
    this.controller.role = this.selectedPlayer;
    this.controller.teleport(spawnPos, spawnYaw);
    this.controller.arenaMap = this.arenaMap;

    progress(0.95, 'Equipando trajes tácticos de combate…');
    await tick();
    const localOutfit = this.selectedPlayer === 1 ? 'TACTICAL_FIGHTER' : 'FOREST_SURVIVOR';
    this.characterAnimation = new CharacterAnimation(this.scene);
    await this.characterAnimation.load(localOutfit);
    this.controller.characterAnimation = this.characterAnimation;
    this.combatHud = new CombatHUD(this.controller);

    progress(0.97, 'Cargando jugador remoto en línea…');
    await tick();
    const oppOutfit = this.selectedPlayer === 1 ? 'FOREST_SURVIVOR' : 'TACTICAL_FIGHTER';
    const oppSpawn = this.selectedPlayer === 1 ? P2_SPAWN : P1_SPAWN;
    const oppYaw = this.selectedPlayer === 1 ? Math.PI / 2 : -Math.PI / 2;
    this.remotePlayer = new RemotePlayer(this.scene);
    await this.remotePlayer.load(oppOutfit, oppSpawn, oppYaw);

    // Fighting actions (punch & kick) only work when opponent is near!
    this.controller.getOpponentTarget = () => {
      if (this.remotePlayer && this.remotePlayer.isVisible) {
        return { position: this.remotePlayer.position, isVisible: this.remotePlayer.isVisible };
      }
      return null;
    };

    this.setupNetworking();
    this.networkClient.connect();

    this.speedBoost = new SpeedBoostController(this.controller);
    this.handGesture = new HandGestureController(
      this.controller,
      () => this.tryInteractDoor(),
      this.scrollQuiz,
      this.speedBoost
    );
    this.audio = new AudioSystem(this.field, this.controller);
    this.scrollQuiz.onVoiceStart = () => {
      this.audio.setDucking(true);
    };
    this.scrollQuiz.onVoiceEnd = () => {
      this.audio.setDucking(false);
    };
    this.composer = createComposer(this.renderer, this.scene, this.camera);

    // Reparto inicial de LOD del bosque y precompilación de shaders.
    this.forestUpdate(this.controller.position);
    this.sky.followPlayer(this.controller.position);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.composer.render(0);

    progress(1, 'Listo');
  }

  private setupNetworking(): void {
    this.networkClient.onConnected = (role, _playerId, roomId, hasOpponent, worldState) => {
      this.selectedPlayer = role;
      this.controller.role = role;
      const spawnPos = role === 1 ? P1_SPAWN : P2_SPAWN;
      const spawnYaw = role === 1 ? -Math.PI / 2 : Math.PI / 2;
      this.controller.teleport(spawnPos, spawnYaw);

      this.characterAnimation?.setOutfit(role === 1 ? 'TACTICAL_FIGHTER' : 'FOREST_SURVIVOR');
      this.remotePlayer?.setOutfit(role === 1 ? 'FOREST_SURVIVOR' : 'TACTICAL_FIGHTER');

      this.multiplayerHud.setRoom(roomId);
      this.multiplayerHud.setRole(role);
      const oppRole = (role === 1 ? 2 : 1) as NetRole;
      this.multiplayerHud.setOpponentStatus(hasOpponent, oppRole);

      if (worldState.door1Unlocked) this.arenaMap.unlockDoor(1);
      if (worldState.door2Unlocked) this.arenaMap.unlockDoor(2);
      if (worldState.cupClaimed) this.arenaMap.claimCup();

      this.remotePlayer.setVisible(hasOpponent);
    };

    this.networkClient.onOpponentJoined = (role) => {
      this.remotePlayer.setVisible(true);
      this.multiplayerHud.setOpponentStatus(true, role);
      this.multiplayerHud.showNotification(`Opponent joined as Player ${role}!`, '#22c55e');
    };

    this.networkClient.onOpponentState = (state) => {
      this.remotePlayer.applyNetState(state);
    };

    this.networkClient.onOpponentLeft = (role) => {
      this.remotePlayer.setVisible(false);
      this.multiplayerHud.setOpponentStatus(false);
      this.multiplayerHud.showNotification(`Opponent Player ${role} disconnected.`, '#f97316');
    };

    this.networkClient.onDoorUnlocked = (doorId) => {
      this.arenaMap.unlockDoor(doorId);
      this.multiplayerHud.showNotification(`Door ${doorId} unlocked!`, '#22c55e');
    };

    this.networkClient.onVictory = (winnerRole) => {
      if (!this.arenaMap.isVictory) {
        this.arenaMap.claimCup();
        document.exitPointerLock?.();
        this.scrollQuiz.showVictory();
        this.audio.stopBgm();
        this.multiplayerHud.showNotification(`Player ${winnerRole} reached the victory cup!`, '#ffd700');
      }
    };

    this.networkClient.onPingUpdate = (pingMs) => {
      const oppRole = (this.selectedPlayer === 1 ? 2 : 1) as NetRole;
      this.multiplayerHud.setOpponentStatus(this.networkClient.hasOpponent, oppRole, pingMs);
    };

    this.networkClient.onError = (msg) => {
      this.multiplayerHud.showNotification(msg, '#ef4444');
    };
  }

  setPlayer(player: 1 | 2): void {
    this.selectedPlayer = player;
    if (this.controller) {
      this.controller.role = player;
      const spawnPos = player === 1 ? P1_SPAWN : P2_SPAWN;
      this.controller.teleport(spawnPos, player === 1 ? -Math.PI / 2 : Math.PI / 2);
    }
    this.characterAnimation?.setOutfit(player === 1 ? 'TACTICAL_FIGHTER' : 'FOREST_SURVIVOR');
    this.remotePlayer?.setOutfit(player === 1 ? 'FOREST_SURVIVOR' : 'TACTICAL_FIGHTER');
    this.multiplayerHud?.setRole(player);
  }

  setPlaying(playing: boolean): void {
    this.controller.enabled = playing;
    this.audio.setMenu(!playing);
  }

  /** Arranca el audio; debe invocarse desde un gesto del usuario (clic). */
  startAudio(): void {
    this.audio.start();
  }

  start(): void {
    this.clock.getDelta();
    this.renderer.setAnimationLoop(() => this.update());
  }

  private update(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = shared.uTime.value + dt;
    shared.uTime.value = t;

    // Solo mover con teclado si el pergamino de preguntas no está abierto
    if (!this.scrollQuiz.isQuizActive) {
      this.controller.update(dt);
    }

    const p = this.controller.position;
    shared.uPlayer.value.set(p.x, p.z);
    this.sky.followPlayer(p);
    this.forestUpdate(p);
    this.arenaMap.update(dt, t);

    // Synchronize local player state across WebSocket
    if (this.networkClient.isConnected) {
      this.networkClient.sendState({
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: this.controller.rotationYaw,
        action: this.characterAnimation.currentActionName,
        speedMult: this.controller.speedBoostActive ? 2.0 : 1.0,
        speedBoostActive: this.controller.speedBoostActive
      });
    }

    // Update remote opponent and minimap
    this.remotePlayer.update(dt);
    this.minimap.update(
      p,
      this.controller.rotationYaw,
      this.arenaMap.isDoorUnlocked(1),
      this.arenaMap.isDoorUnlocked(2),
      this.selectedPlayer,
      this.remotePlayer
    );

    this.drone.update(dt, t, p);
    this.motes.update(t, p, this.field);
    this.audio.update(dt, t);
    this.speedBoost.update(dt);
    this.combatHud.update();

    // Detección de proximidad: Puerta 1 (Jugador 1)
    if (this.selectedPlayer === 1 && !this.arenaMap.isDoorUnlocked(1) && !this.scrollQuiz.isQuizActive) {
      const d1 = p.distanceTo(DOOR1_POS);
      if (d1 < 3.4 && Math.abs(p.x - DOOR1_POS.x) < 2.0 && p.z > DOOR1_POS.z) {
        document.exitPointerLock?.();
        this.audio.setQuizActive(true); // Background music stops during all 5 questions
        this.scrollQuiz.showQuiz(1, (doorId) => {
          this.arenaMap.unlockDoor(doorId);
          this.networkClient.sendDoorUnlocked(doorId);
          this.audio.setQuizActive(false); // AFTER opening the door ONLY the BGM plays!
          this.renderer.domElement.requestPointerLock?.();
        });
      }
    }

    // Detección de proximidad: Puerta 2 (Jugador 2)
    if (this.selectedPlayer === 2 && !this.arenaMap.isDoorUnlocked(2) && !this.scrollQuiz.isQuizActive) {
      const d2 = p.distanceTo(DOOR2_POS);
      if (d2 < 3.4 && Math.abs(p.x - DOOR2_POS.x) < 2.0 && p.z > DOOR2_POS.z) {
        document.exitPointerLock?.();
        this.audio.setQuizActive(true); // Background music stops during all 5 questions
        this.scrollQuiz.showQuiz(2, (doorId) => {
          this.arenaMap.unlockDoor(doorId);
          this.networkClient.sendDoorUnlocked(doorId);
          this.audio.setQuizActive(false); // AFTER opening the door ONLY the BGM plays!
          this.renderer.domElement.requestPointerLock?.();
        });
      }
    }

    // Detección de proximidad: Llegada a la cumbre frente a las escaleras de piedra
    if (!this.arenaMap.isVictory) {
      const dCup = p.distanceTo(CUP_POS);
      if (dCup <= 9.6 || (Math.abs(p.x - CUP_POS.x) < 3.2 && p.z <= -210.8)) {
        this.arenaMap.claimCup();
        this.networkClient.sendVictory();
        document.exitPointerLock?.();
        this.scrollQuiz.showVictory();
        this.audio.stopBgm();
      }
    }

    this.composer.render(dt);
  }

  private tryInteractDoor(): void {
    if (this.scrollQuiz.isQuizActive) return;
    const p = this.controller.position;
    if (this.selectedPlayer === 1 && !this.arenaMap.isDoorUnlocked(1)) {
      const d1 = p.distanceTo(DOOR1_POS);
      if (d1 < 5.0) {
        document.exitPointerLock?.();
        this.audio.setQuizActive(true);
        this.scrollQuiz.showQuiz(1, (doorId) => {
          this.arenaMap.unlockDoor(doorId);
          this.networkClient.sendDoorUnlocked(doorId);
          this.audio.setQuizActive(false);
          this.renderer.domElement.requestPointerLock?.();
        });
      }
    } else if (this.selectedPlayer === 2 && !this.arenaMap.isDoorUnlocked(2)) {
      const d2 = p.distanceTo(DOOR2_POS);
      if (d2 < 5.0) {
        document.exitPointerLock?.();
        this.audio.setQuizActive(true);
        this.scrollQuiz.showQuiz(2, (doorId) => {
          this.arenaMap.unlockDoor(doorId);
          this.networkClient.sendDoorUnlocked(doorId);
          this.audio.setQuizActive(false);
          this.renderer.domElement.requestPointerLock?.();
        });
      }
    }
  }
}
