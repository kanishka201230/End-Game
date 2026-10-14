import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { FirstPersonController } from '../player/FirstPersonController';
import { ScrollQuizUI } from '../ui/ScrollQuiz';
import { SpeedBoostController } from '../ui/SpeedBoostController';

export type GestureType =
  | 'NONE'
  | 'OPEN_PALM'
  | 'V_SIGN'
  | 'POINT_RIGHT'
  | 'POINT_LEFT'
  | 'CLOSED_FIST'
  | 'THUMBS_UP';

export class HandGestureController {
  private video!: HTMLVideoElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private container!: HTMLElement;
  private statusBadge!: HTMLElement;
  private gestureBadge!: HTMLElement;
  private toggleBtn!: HTMLButtonElement;

  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private isRunning = false;
  private isProcessing = false;
  private lastVideoTime = -1;
  private lastFrameTime = -1;
  private openPalmGraceTimer = 0;

  // Single-trigger locks for attack gestures (require gesture release before triggering again)
  private fistPunchArmed = true;
  private kickArmed = true;

  // Calibration center
  private neutralCenterX = 0.5;

  // Current detected gesture
  private activeGesture: GestureType = 'NONE';
  private gestureCooldowns: Record<string, number> = {};
  private candidateGesture: GestureType = 'NONE';
  private candidateFrames = 0;
  private gestureHoldTimer = 0;

  constructor(
    private readonly controller: FirstPersonController,
    private readonly onInteract?: () => void,
    private quiz?: ScrollQuizUI,
    private speedBoost?: SpeedBoostController
  ) {
    this.createDom();
  }

  setQuiz(quiz: ScrollQuizUI): void {
    this.quiz = quiz;
  }

  setSpeedBoost(speedBoost: SpeedBoostController): void {
    this.speedBoost = speedBoost;
  }

  private createDom(): void {
    const style = document.createElement('style');
    style.textContent = `
      #webcam-panel {
        position: fixed;
        bottom: 24px;
        left: 24px;
        z-index: 60;
        background: rgba(12, 22, 14, 0.88);
        backdrop-filter: blur(8px);
        border: 2px solid rgba(182, 146, 78, 0.65);
        border-radius: 12px;
        padding: 10px 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.7), 0 0 16px rgba(182, 146, 78, 0.2);
        color: #e2eccd;
        font-family: Georgia, 'Times New Roman', serif;
        user-select: none;
        width: 220px;
        transition: transform 0.25s ease, opacity 0.25s ease;
      }
      #webcam-panel.minimized {
        transform: translateY(calc(100% - 38px));
      }
      #webcam-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
        font-weight: bold;
        letter-spacing: 0.1em;
        margin-bottom: 8px;
        cursor: pointer;
      }
      #webcam-header .title {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      #webcam-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ef4444;
        display: inline-block;
        box-shadow: 0 0 6px #ef4444;
      }
      #webcam-status-dot.active {
        background: #22c55e;
        box-shadow: 0 0 8px #22c55e;
      }
      #webcam-status-dot.init {
        background: #eab308;
        box-shadow: 0 0 8px #eab308;
      }
      #webcam-view-wrap {
        position: relative;
        width: 100%;
        height: 140px;
        border-radius: 8px;
        overflow: hidden;
        background: #060e08;
        border: 1px solid rgba(255,255,255,0.1);
      }
      #webcam-video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scaleX(-1); /* Mirror camera */
        display: block;
      }
      #webcam-canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        transform: scaleX(-1); /* Mirror canvas to match */
        pointer-events: none;
      }
      #webcam-badge {
        margin-top: 8px;
        padding: 5px 8px;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.5);
        border: 1px solid rgba(182, 146, 78, 0.4);
        font-size: 11px;
        font-weight: bold;
        text-align: center;
        color: #ffd700;
        min-height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        letter-spacing: 0.05em;
      }
      #webcam-controls {
        display: flex;
        gap: 6px;
        margin-top: 8px;
      }
      .webcam-btn {
        flex: 1;
        padding: 5px 8px;
        font-size: 10px;
        font-family: inherit;
        letter-spacing: 0.08em;
        font-weight: bold;
        background: rgba(45, 65, 35, 0.6);
        border: 1px solid rgba(182, 146, 78, 0.5);
        border-radius: 4px;
        color: #e2eccd;
        cursor: pointer;
        transition: background 0.2s;
      }
      .webcam-btn:hover {
        background: rgba(70, 105, 55, 0.8);
      }
      .webcam-btn.active {
        background: rgba(34, 197, 94, 0.3);
        border-color: #22c55e;
        color: #86efac;
      }
      #gesture-guide {
        margin-top: 8px;
        background: rgba(0, 0, 0, 0.45);
        border: 1px solid rgba(182, 146, 78, 0.45);
        border-radius: 8px;
        padding: 6px 8px;
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-size: 10px;
        font-family: Georgia, serif;
      }
      .guide-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 3px 6px;
        border-radius: 4px;
        color: #94a3b8;
        transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
      }
      .guide-row .g-label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: bold;
        color: #cbd5e1;
      }
      .guide-row .g-action {
        font-size: 9px;
        color: #fbbf24;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .guide-row.active {
        background: rgba(34, 197, 94, 0.25);
        border: 1px solid rgba(34, 197, 94, 0.65);
        transform: scale(1.02);
      }
      .guide-row.active .g-label {
        color: #ffffff;
      }
      .guide-row.active .g-action {
        color: #86efac;
        font-weight: bold;
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'webcam-panel';

    panel.innerHTML = `
      <div id="webcam-header" title="Click to minimize/expand">
        <div class="title">
          <span id="webcam-status-dot"></span>
          <span>HAND GESTURES</span>
        </div>
        <span id="webcam-min-btn">▼</span>
      </div>
      <div id="webcam-view-wrap">
        <video id="webcam-video" autoplay playsinline muted></video>
        <canvas id="webcam-canvas" width="220" height="140"></canvas>
      </div>
      <div id="webcam-badge">✋ Ready to Start</div>
      <div id="webcam-controls">
        <button id="webcam-toggle-btn" class="webcam-btn">START CAM</button>
        <button id="webcam-calib-btn" class="webcam-btn">CALIBRATE</button>
      </div>
      <div id="gesture-guide">
        <div class="guide-row" data-gesture="OPEN_PALM">
          <span class="g-label">✋ Open Palm</span>
          <span class="g-action">Run Forward</span>
        </div>
        <div class="guide-row" data-gesture="V_SIGN">
          <span class="g-label">✌️ V Sign</span>
          <span class="g-action">Stop Running</span>
        </div>
        <div class="guide-row" data-gesture="POINT_RIGHT">
          <span class="g-label">👉 Point Right</span>
          <span class="g-action">Turn / Path Right</span>
        </div>
        <div class="guide-row" data-gesture="POINT_LEFT">
          <span class="g-label">👈 Point Left</span>
          <span class="g-action">Turn / Path Left</span>
        </div>
        <div class="guide-row" data-gesture="CLOSED_FIST">
          <span class="g-label">✊ Closed Fist</span>
          <span class="g-action">Punch Combo</span>
        </div>
        <div class="guide-row" data-gesture="THUMBS_UP">
          <span class="g-label">👍 Thumbs Up</span>
          <span class="g-action">MMA Kick</span>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    this.container = panel;
    this.video = panel.querySelector('#webcam-video')!;
    this.canvas = panel.querySelector('#webcam-canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.statusBadge = panel.querySelector('#webcam-status-dot')!;
    this.gestureBadge = panel.querySelector('#webcam-badge')!;
    this.toggleBtn = panel.querySelector('#webcam-toggle-btn')!;

    // Minimize toggle
    panel.querySelector('#webcam-header')!.addEventListener('click', () => {
      panel.classList.toggle('minimized');
      const minBtn = panel.querySelector('#webcam-min-btn')!;
      minBtn.textContent = panel.classList.contains('minimized') ? '▲' : '▼';
    });

    // Start / Stop toggle
    this.toggleBtn.addEventListener('click', () => {
      if (this.isRunning) {
        this.stop();
      } else {
        void this.start();
      }
    });

    // Calibration button
    panel.querySelector('#webcam-calib-btn')!.addEventListener('click', () => {
      this.gestureBadge.textContent = '🎯 Calibrated Center';
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.statusBadge.className = 'init';
    this.gestureBadge.textContent = '⏳ Loading AI Model...';
    this.toggleBtn.disabled = true;

    try {
      // 1. Initialize MediaPipe HandLandmarker
      if (!this.landmarker) {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
        this.landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numHands: 1
        });
      }

      // 2. Request Camera
      this.gestureBadge.textContent = '📷 Requesting Camera...';
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, frameRate: { ideal: 30 } }
      });

      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();

      this.isRunning = true;
      this.statusBadge.className = 'active';
      this.gestureBadge.textContent = '🟢 Camera Active';
      this.toggleBtn.textContent = 'STOP CAM';
      this.toggleBtn.classList.add('active');
      this.toggleBtn.disabled = false;

      // Start processing loop
      this.processLoop();
    } catch (err) {
      console.error('Camera gesture error:', err);
      this.statusBadge.className = '';
      this.gestureBadge.textContent = '❌ Camera Blocked / Error';
      this.toggleBtn.textContent = 'START CAM';
      this.toggleBtn.disabled = false;
      this.toggleBtn.classList.remove('active');
      this.isRunning = false;
    }
  }

  stop(): void {
    this.isRunning = false;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.statusBadge.className = '';
    this.gestureBadge.textContent = '⚪ Cam Off (Keys active)';
    this.toggleBtn.textContent = 'START CAM';
    this.toggleBtn.classList.remove('active');
    this.toggleBtn.disabled = false;

    if (this.quiz) {
      this.quiz.hideGesturePointer();
    }
    if (this.speedBoost) {
      this.speedBoost.hidePointer();
    }

    // Reset controller gesture inputs
    this.controller.gestureForward = false;
    this.controller.gestureMoveLeft = false;
    this.controller.gestureMoveRight = false;
    this.controller.gestureTurnLeft = false;
    this.controller.gestureTurnRight = false;
    this.activeGesture = 'NONE';
    this.openPalmGraceTimer = 0;
    this.fistPunchArmed = true;
    this.kickArmed = true;
    this.updateGuideHighlight('NONE');

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private processLoop = (): void => {
    if (!this.isRunning) return;

    if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && this.landmarker) {
      const now = performance.now();
      if (this.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.video.currentTime;
        const results = this.landmarker.detectForVideo(this.video, now);
        this.handleResults(results);
      }
    }

    requestAnimationFrame(this.processLoop);
  };

  private handleResults(results: { landmarks?: Array<Array<{ x: number; y: number; z: number }>> }): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);

    if (!results.landmarks || results.landmarks.length === 0) {
      if (this.quiz && this.quiz.isQuizActive) {
        this.quiz.hideGesturePointer();
      }
      if (this.speedBoost) {
        this.speedBoost.hidePointer();
      }
      // Hand out of frame -> Stop gesture movement safely
      this.controller.gestureForward = false;
      this.controller.gestureMoveLeft = false;
      this.controller.gestureMoveRight = false;
      this.controller.gestureTurnLeft = false;
      this.controller.gestureTurnRight = false;
      this.openPalmGraceTimer = 0;
      this.fistPunchArmed = true;
      this.kickArmed = true;
      if (this.activeGesture !== 'NONE') {
        this.activeGesture = 'NONE';
        this.gestureBadge.textContent = '✋ Show hand in camera';
        this.updateGuideHighlight('NONE');
      }
      return;
    }

    const lm = results.landmarks[0];
    const now = performance.now();
    const dt = this.lastFrameTime > 0 ? Math.min(0.1, (now - this.lastFrameTime) / 1000) : 0.033;
    this.lastFrameTime = now;

    // Draw Skeleton on Canvas
    this.drawSkeleton(lm, w, h);

    // Finger extension checks for pointer
    const wrist = lm[0];
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const indexExt = dist(lm[8], wrist) > dist(lm[6], wrist) * 1.18 && dist(lm[8], lm[5]) > 0.09;
    const middleExt = dist(lm[12], wrist) > dist(lm[10], wrist) * 1.18 && dist(lm[12], lm[9]) > 0.09;
    const ringExt = dist(lm[16], wrist) > dist(lm[14], wrist) * 1.18 && dist(lm[16], lm[13]) > 0.09;
    const pinkyExt = dist(lm[20], wrist) > dist(lm[18], wrist) * 1.18 && dist(lm[20], lm[17]) > 0.09;
    const isPointing = indexExt && !middleExt && !ringExt && !pinkyExt;

    // In mirrored screen space: x=0 in camera is screen right (1.0 - rawX)
    const tipX = (1.0 - lm[8].x) * window.innerWidth;
    const tipY = lm[8].y * window.innerHeight;

    // When Ancient Parchment Quiz is active, index finger acts as direct question pointer!
    if (this.quiz && this.quiz.isQuizActive) {
      if (this.speedBoost) {
        this.speedBoost.hidePointer();
      }
      this.controller.gestureForward = false;
      this.controller.gestureTurnLeft = false;
      this.controller.gestureTurnRight = false;

      this.quiz.updateGesturePointer(tipX, tipY);
      this.gestureBadge.textContent = '🎯 Point at answer to select';
      return;
    } else {
      if (this.quiz) {
        this.quiz.hideGesturePointer();
      }
    }

    // Update Speed Boost button pointer & dwell detection
    let isTargetingBoost = false;
    if (this.speedBoost) {
      isTargetingBoost = this.speedBoost.updatePointer(tipX, tipY, isPointing, dt);
    }

    // If pointing deliberately at the Speed Boost button, pause camera turning so player can select stably
    if (isTargetingBoost) {
      this.controller.gestureTurnLeft = false;
      this.controller.gestureTurnRight = false;
      this.gestureBadge.textContent = '⚡ Pointing at SPEED BOOST';
      return;
    }

    // Classify Gesture for exploration gameplay
    const rawGesture = this.classifyGesture(lm);

    // Gesture debouncing / smoothing to prevent single-frame drops or flicker
    let gesture = rawGesture;
    if (rawGesture === this.candidateGesture) {
      this.candidateFrames++;
    } else {
      this.candidateGesture = rawGesture;
      this.candidateFrames = 1;
    }

    // Retain previous active running/pointing gesture briefly if a momentary single frame drops to NONE
    if (rawGesture === 'NONE' && (this.activeGesture === 'OPEN_PALM' || this.activeGesture === 'POINT_RIGHT' || this.activeGesture === 'POINT_LEFT')) {
      if (this.candidateFrames < 3 && this.gestureHoldTimer > 0) {
        gesture = this.activeGesture;
      }
    }

    if (gesture !== 'NONE') {
      this.gestureHoldTimer = 0.2;
    } else if (this.gestureHoldTimer > 0) {
      this.gestureHoldTimer -= dt;
    }

    this.applyGesture(gesture, dt);
  }

  private drawSkeleton(lm: Array<{ x: number; y: number; z: number }>, w: number, h: number): void {
    const ctx = this.ctx;

    // Connections between joints
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8], // Index
      [0, 9], [9, 10], [10, 11], [11, 12], // Middle
      [0, 13], [13, 14], [14, 15], [15, 16], // Ring
      [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
      [5, 9], [9, 13], [13, 17] // Palm
    ];

    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    for (const [a, b] of connections) {
      ctx.beginPath();
      ctx.moveTo(lm[a].x * w, lm[a].y * h);
      ctx.lineTo(lm[b].x * w, lm[b].y * h);
      ctx.stroke();
    }

    // Points
    ctx.fillStyle = '#f59e0b';
    for (const p of lm) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Highlight index finger if actively pointing
    if (this.activeGesture === 'POINT_RIGHT' || this.activeGesture === 'POINT_LEFT') {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(lm[5].x * w, lm[5].y * h);
      ctx.lineTo(lm[6].x * w, lm[6].y * h);
      ctx.lineTo(lm[7].x * w, lm[7].y * h);
      ctx.lineTo(lm[8].x * w, lm[8].y * h);
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(lm[8].x * w, lm[8].y * h, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private classifyGesture(lm: Array<{ x: number; y: number; z: number }>): GestureType {
    const wrist = lm[0];
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

    // Finger extension checks:
    const thumbExt = dist(lm[4], wrist) > dist(lm[2], wrist) * 1.15;
    const indexExt = dist(lm[8], wrist) > dist(lm[6], wrist) * 1.18 && dist(lm[8], lm[5]) > 0.085;
    const middleExt = dist(lm[12], wrist) > dist(lm[10], wrist) * 1.18 && dist(lm[12], lm[9]) > 0.085;
    const ringExt = dist(lm[16], wrist) > dist(lm[14], wrist) * 1.18 && dist(lm[16], lm[13]) > 0.085;
    const pinkyExt = dist(lm[20], wrist) > dist(lm[18], wrist) * 1.18 && dist(lm[20], lm[17]) > 0.085;

    // Vector calculation for index finger pointing in user-facing mirrored view:
    // Screen X: 1 - rawX
    // Index vector: dx = lm[5].x - lm[8].x (positive = screen right, negative = screen left)
    const screenIdxDx = lm[5].x - lm[8].x;
    const screenIdxDy = lm[8].y - lm[5].y;
    const screenHandDx = lm[0].x - lm[8].x;

    // 1. OPEN PALM — Run (All 4 main fingers extended facing webcam)
    if (indexExt && middleExt && ringExt && pinkyExt) {
      if (lm[8].y < lm[0].y + 0.12 && lm[12].y < lm[0].y + 0.12) {
        return 'OPEN_PALM';
      }
    }

    // 2. V SIGN — Stop Running (Index and middle extended and separated, other fingers curled)
    if (indexExt && middleExt && !ringExt && !pinkyExt) {
      const vDistance = dist(lm[8], lm[12]);
      const vUpward = lm[8].y < lm[6].y && lm[12].y < lm[10].y;
      if (vDistance > 0.036 && vUpward) {
        return 'V_SIGN';
      }
    }

    // 3 & 4. INDEX FINGER POINTING — Move Right / Move Left
    // Index finger extended while other fingers are curled (relaxed middle tolerance)
    const otherFingersCurled = !ringExt && !pinkyExt && (!middleExt || dist(lm[8], wrist) > dist(lm[12], wrist) * 1.12);
    if (indexExt && otherFingersCurled) {
      // Horizontal threshold: angular tolerance to avoid purely vertical pointing
      const isHorizontal = Math.abs(screenIdxDx) > Math.abs(screenIdxDy) * 0.85;
      if (isHorizontal) {
        if (screenIdxDx > 0.035 && screenHandDx > 0.028) {
          return 'POINT_RIGHT'; // Move Right
        }
        if (screenIdxDx < -0.035 && screenHandDx < -0.028) {
          return 'POINT_LEFT';  // Move Left
        }
      }
    }

    // 5. THUMBS UP — Kick (Thumb extended upward, four fingers curled)
    if (thumbExt && lm[4].y < lm[3].y && lm[4].y < lm[5].y - 0.025 && !indexExt && !middleExt && !ringExt && !pinkyExt) {
      return 'THUMBS_UP';
    }

    // 6. CLOSED FIST — Punch (All 4 main fingers curled, thumb not upward)
    if (!indexExt && !middleExt && !ringExt && !pinkyExt) {
      return 'CLOSED_FIST';
    }

    return 'NONE';
  }

  private applyGesture(gesture: GestureType, dt: number): void {
    // Re-arm single triggers when hands change / reopen
    if (gesture !== 'CLOSED_FIST') {
      this.fistPunchArmed = true;
    }
    if (gesture !== 'THUMBS_UP') {
      this.kickArmed = true;
    }

    // Reset sideways gesture movement & turning
    this.controller.gestureMoveLeft = false;
    this.controller.gestureMoveRight = false;
    this.controller.gestureTurnLeft = false;
    this.controller.gestureTurnRight = false;

    // 1. Open Palm running logic with grace period + forward momentum maintenance during pointing
    if (gesture === 'OPEN_PALM') {
      this.openPalmGraceTimer = 0.35;
      this.controller.gestureForward = true;
      this.gestureBadge.textContent = '✋ OPEN PALM: Running';
    } else if (gesture === 'POINT_RIGHT' || gesture === 'POINT_LEFT') {
      // Maintain forward run while pointing so turns steer along the path instead of stopping
      this.openPalmGraceTimer = 0.35;
      this.controller.gestureForward = true;
    } else if (gesture === 'V_SIGN') {
      // 2. V Sign: Stop running immediately and transition to idle
      this.openPalmGraceTimer = 0;
      this.controller.gestureForward = false;
      this.controller.characterAnimation?.setMoving(false);
      this.gestureBadge.textContent = '✌️ V SIGN: Stopped Running';
    } else {
      // Grace timer counts down, then stops forward run
      if (this.openPalmGraceTimer > 0) {
        this.openPalmGraceTimer -= dt;
        this.controller.gestureForward = true;
      } else {
        this.controller.gestureForward = false;
      }
    }

    switch (gesture) {
      case 'OPEN_PALM':
      case 'V_SIGN':
        break;

      case 'POINT_RIGHT':
        // 3. Turn & Steer Right along the right-hand trail
        this.controller.gestureForward = true;
        this.controller.gestureMoveRight = true;
        this.controller.gestureTurnRight = true;
        this.controller.selectBranch('right');
        this.gestureBadge.textContent = '👉 POINT RIGHT: Turning / Path Right';
        break;

      case 'POINT_LEFT':
        // 4. Turn & Steer Left along the left-hand trail
        this.controller.gestureForward = true;
        this.controller.gestureMoveLeft = true;
        this.controller.gestureTurnLeft = true;
        this.controller.selectBranch('left');
        this.gestureBadge.textContent = '👈 POINT LEFT: Turning / Path Left';
        break;

      case 'CLOSED_FIST':
        // 5. Closed Fist: Punch Combo only works when opponent is near!
        if (!this.controller.canFight) {
          this.gestureBadge.textContent = '✊ FIST: Opponent not in range (Get closer to fight)';
        } else if (this.fistPunchArmed && !this.controller.characterAnimation?.isAttackPlaying) {
          this.controller.triggerPunch();
          this.fistPunchArmed = false;
          this.gestureBadge.textContent = '✊ CLOSED FIST: Punch Combo!';
        } else if (!this.fistPunchArmed) {
          this.gestureBadge.textContent = '✊ FIST: (Open hand to punch again)';
        }
        break;

      case 'THUMBS_UP':
        // 6. Thumbs Up: MMA Kick only works when opponent is near!
        if (!this.controller.canFight) {
          this.gestureBadge.textContent = '👍 THUMBS UP: Opponent not in range (Get closer to fight)';
        } else if (this.kickArmed && !this.controller.characterAnimation?.isAttackPlaying) {
          this.controller.triggerKick();
          this.kickArmed = false;
          this.gestureBadge.textContent = '👍 THUMBS UP: MMA Kick!';
        } else if (!this.kickArmed) {
          this.gestureBadge.textContent = '👍 THUMBS UP: (Release to kick again)';
        }
        break;

      case 'NONE':
      default:
        break;
    }

    this.updateGuideHighlight(gesture);
    this.activeGesture = gesture;
  }

  private updateGuideHighlight(gesture: GestureType): void {
    if (!this.container) return;
    const rows = this.container.querySelectorAll<HTMLElement>('.guide-row');
    rows.forEach((row) => {
      row.classList.toggle('active', row.getAttribute('data-gesture') === gesture);
    });
  }
}
