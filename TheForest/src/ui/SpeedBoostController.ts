import { FirstPersonController } from '../player/FirstPersonController';

export type SpeedBoostState = 'AVAILABLE' | 'ACTIVE' | 'COOLDOWN';

export class SpeedBoostController {
  private container!: HTMLElement;
  private btnEl!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private iconEl!: HTMLElement;
  private fillEl!: SVGCircleElement;
  private cursorEl!: HTMLElement;
  private cursorRingFill!: SVGCircleElement;
  private toastEl!: HTMLElement;
  private toastTimer: number | null = null;

  // Timers and state
  public state: SpeedBoostState = 'AVAILABLE';
  private readonly ACTIVE_DURATION = 5.0; // 5 seconds
  private readonly COOLDOWN_DURATION = 10.0; // 10 seconds
  private readonly DWELL_TIME_REQUIRED = 0.42; // ~420ms dwell to activate

  private timer = 0; // counts down active or cooldown
  private dwellTimer = 0;
  private hasTriggeredThisHover = false;
  private isHovered = false;

  // Smoothed cursor coordinates
  private cursorX = 0;
  private cursorY = 0;
  private isPointerVisible = false;

  // Audio Context for sound effects
  private audioCtx: AudioContext | null = null;

  constructor(private readonly controller: FirstPersonController) {
    this.createDom();
    this.setState('AVAILABLE');
  }

  private createDom(): void {
    const style = document.createElement('style');
    style.textContent = `
      #speed-boost-panel {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 55;
        user-select: none;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        pointer-events: auto;
      }

      #speed-boost-btn {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 18px 10px 14px;
        border-radius: 40px;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.1em;
        cursor: pointer;
        outline: none;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease, border-color 0.3s ease, filter 0.3s ease;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
        border: 2px solid rgba(245, 158, 11, 0.7);
        background: linear-gradient(135deg, rgba(16, 26, 18, 0.94) 0%, rgba(28, 44, 25, 0.96) 100%);
        color: #fef3c7;
      }

      /* State: AVAILABLE */
      #speed-boost-btn.available {
        border-color: #f59e0b;
        background: linear-gradient(135deg, rgba(20, 32, 20, 0.94) 0%, rgba(36, 56, 28, 0.96) 100%);
        box-shadow: 0 0 18px rgba(245, 158, 11, 0.55), 0 8px 25px rgba(0,0,0,0.7);
        animation: sbGlowPulse 2.4s infinite ease-in-out;
      }
      #speed-boost-btn.available:hover,
      #speed-boost-btn.available.hover-gesture {
        transform: scale(1.05);
        border-color: #fef08a;
        box-shadow: 0 0 28px rgba(254, 240, 138, 0.85), 0 10px 30px rgba(0,0,0,0.8);
      }

      /* State: ACTIVE */
      #speed-boost-btn.active {
        border-color: #38bdf8;
        background: linear-gradient(135deg, rgba(14, 40, 65, 0.96) 0%, rgba(18, 62, 98, 0.98) 100%);
        box-shadow: 0 0 28px rgba(56, 189, 248, 0.85), 0 0 50px rgba(56, 189, 248, 0.35);
        color: #e0f2fe;
        animation: sbLightningBlaze 0.8s infinite alternate ease-in-out;
      }

      /* State: COOLDOWN */
      #speed-boost-btn.cooldown {
        border-color: rgba(148, 163, 184, 0.4);
        background: linear-gradient(135deg, rgba(18, 22, 20, 0.9) 0%, rgba(26, 32, 28, 0.92) 100%);
        color: #94a3b8;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
        filter: grayscale(0.55) opacity(0.75);
        cursor: not-allowed;
      }

      /* Flash upon activation */
      #speed-boost-btn.flash-activate {
        animation: sbFlashBurst 0.5s ease-out;
      }

      .boost-icon-wrap {
        position: relative;
        width: 38px;
        height: 38px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.35);
        border: 1.5px solid rgba(255, 255, 255, 0.15);
      }

      .boost-bolt {
        font-size: 20px;
        line-height: 1;
        filter: drop-shadow(0 0 6px currentColor);
      }

      #speed-boost-btn.available .boost-bolt {
        color: #fbbf24;
      }

      #speed-boost-btn.active .boost-bolt {
        color: #38bdf8;
      }

      #speed-boost-btn.cooldown .boost-bolt {
        color: #64748b;
      }

      .boost-info {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
      }

      .boost-title {
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        font-weight: 800;
        line-height: 1.2;
      }

      .boost-status {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.05em;
        line-height: 1.2;
        margin-top: 2px;
      }

      /* Progress circle inside icon wrap */
      .boost-svg-ring {
        position: absolute;
        inset: -2px;
        width: calc(100% + 4px);
        height: calc(100% + 4px);
        pointer-events: none;
        transform: rotate(-90deg);
      }
      .boost-svg-ring circle {
        fill: none;
        stroke-width: 3.2;
      }
      .boost-ring-bg {
        stroke: rgba(255, 255, 255, 0.08);
      }
      .boost-ring-fill {
        stroke: #38bdf8;
        stroke-dasharray: 113.1;
        stroke-dashoffset: 0;
        stroke-linecap: round;
        transition: stroke-dashoffset 0.1s linear;
      }

      /* Hand pointer cursor */
      #sb-gesture-cursor {
        position: fixed;
        top: 0;
        left: 0;
        width: 38px;
        height: 38px;
        margin: -19px 0 0 -19px;
        pointer-events: none;
        z-index: 999;
        opacity: 0;
        transform: translate3d(-100px, -100px, 0);
        transition: opacity 0.15s ease;
      }
      #sb-gesture-cursor.visible {
        opacity: 1;
      }
      .sb-cursor-dot {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 10px;
        height: 10px;
        margin: -5px 0 0 -5px;
        border-radius: 50%;
        background: #38bdf8;
        box-shadow: 0 0 10px #38bdf8, 0 0 18px #38bdf8;
      }
      .sb-cursor-ring {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        transform: rotate(-90deg);
      }
      .sb-cursor-ring .ring-bg {
        fill: none;
        stroke: rgba(56, 189, 248, 0.25);
        stroke-width: 3;
      }
      .sb-cursor-ring .ring-fill {
        fill: none;
        stroke: #fef08a;
        stroke-width: 3.5;
        stroke-dasharray: 113.1;
        stroke-dashoffset: 113.1;
        stroke-linecap: round;
        transition: stroke-dashoffset 0.04s linear;
      }

      /* Toast Notification */
      #speed-boost-toast {
        position: fixed;
        top: 24px;
        right: 24px;
        z-index: 95;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 18px;
        border-radius: 20px;
        background: rgba(12, 22, 16, 0.94);
        backdrop-filter: blur(6px);
        border: 1.5px solid #38bdf8;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.7), 0 0 20px rgba(56, 189, 248, 0.4);
        color: #e0f2fe;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.12em;
        opacity: 0;
        transform: translateY(-20px);
        pointer-events: none;
        transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      #speed-boost-toast.show {
        opacity: 1;
        transform: translateY(0);
      }
      #speed-boost-toast.toast-active {
        border-color: #38bdf8;
        color: #e0f2fe;
        box-shadow: 0 0 25px rgba(56, 189, 248, 0.6);
      }
      #speed-boost-toast.toast-ready {
        border-color: #f59e0b;
        color: #fef3c7;
        box-shadow: 0 0 25px rgba(245, 158, 11, 0.6);
      }
      #speed-boost-toast.toast-end {
        border-color: #94a3b8;
        color: #cbd5e1;
        box-shadow: 0 0 15px rgba(148, 163, 184, 0.4);
      }

      @keyframes sbGlowPulse {
        0%, 100% { box-shadow: 0 0 16px rgba(245, 158, 11, 0.5), 0 6px 20px rgba(0,0,0,0.6); }
        50% { box-shadow: 0 0 28px rgba(245, 158, 11, 0.85), 0 8px 26px rgba(0,0,0,0.7); }
      }
      @keyframes sbLightningBlaze {
        0% { box-shadow: 0 0 20px rgba(56, 189, 248, 0.7); border-color: #38bdf8; }
        100% { box-shadow: 0 0 35px rgba(56, 189, 248, 1), 0 0 65px rgba(56, 189, 248, 0.4); border-color: #e0f2fe; }
      }
      @keyframes sbFlashBurst {
        0% { transform: scale(1.18); filter: brightness(2.2); }
        100% { transform: scale(1.0); filter: brightness(1.0); }
      }
    `;
    document.head.appendChild(style);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'speed-boost-panel';
    panel.innerHTML = `
      <button id="speed-boost-btn" class="available" type="button" tabindex="-1" aria-label="Speed Boost">
        <div class="boost-icon-wrap">
          <span class="boost-bolt">⚡</span>
          <svg class="boost-svg-ring" viewBox="0 0 44 44">
            <circle class="boost-ring-bg" cx="22" cy="22" r="18" />
            <circle class="boost-ring-fill" id="sb-fill-ring" cx="22" cy="22" r="18" />
          </svg>
        </div>
        <div class="boost-info">
          <div class="boost-title">SPEED BOOST</div>
          <div class="boost-status" id="sb-status">READY [ENTER / POINT]</div>
        </div>
      </button>
    `;
    document.body.appendChild(panel);

    // Cursor element
    const cursor = document.createElement('div');
    cursor.id = 'sb-gesture-cursor';
    cursor.innerHTML = `
      <div class="sb-cursor-dot"></div>
      <svg class="sb-cursor-ring" viewBox="0 0 44 44">
        <circle class="ring-bg" cx="22" cy="22" r="18" />
        <circle class="ring-fill" id="sb-cursor-fill" cx="22" cy="22" r="18" />
      </svg>
    `;
    document.body.appendChild(cursor);

    // Toast element
    const toast = document.createElement('div');
    toast.id = 'speed-boost-toast';
    toast.innerHTML = `
      <span class="toast-bolt">⚡</span>
      <span class="toast-text" id="sb-toast-text">SPEED BOOST ACTIVATED!</span>
    `;
    document.body.appendChild(toast);

    this.container = panel;
    this.btnEl = panel.querySelector('#speed-boost-btn')!;
    this.statusEl = panel.querySelector('#sb-status')!;
    this.iconEl = panel.querySelector('.boost-bolt')!;
    this.fillEl = panel.querySelector('#sb-fill-ring')!;
    this.cursorEl = cursor;
    this.cursorRingFill = cursor.querySelector('#sb-cursor-fill')!;
    this.toastEl = toast;

    // Mouse click support as fallback
    this.btnEl.addEventListener('click', () => {
      this.btnEl.blur();
      if (this.state === 'AVAILABLE') {
        this.activateBoost();
      }
    });

    // Enter key listener: Pressing Enter activates Speed Boost
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      e.stopPropagation();
      if (this.state === 'AVAILABLE') {
        this.activateBoost();
      }
    }
  };

  /**
   * Updates boost active/cooldown timers independently of whether the player is moving.
   * Runs inside the game loop on every frame.
   */
  update(dt: number): void {
    if (this.state === 'ACTIVE') {
      this.timer -= dt;
      const remainingSec = Math.max(1, Math.ceil(this.timer));
      this.statusEl.textContent = `BOOST ACTIVE: ${remainingSec}`;

      // Progress drain (from 0 back to 113.1)
      const fraction = Math.max(0, this.timer / this.ACTIVE_DURATION);
      this.fillEl.style.strokeDashoffset = `${113.1 * (1 - fraction)}`;

      if (this.timer <= 0) {
        this.endBoost();
      }
    } else if (this.state === 'COOLDOWN') {
      this.timer -= dt;
      const remainingSec = Math.max(1, Math.ceil(this.timer));
      this.statusEl.textContent = `READY IN: ${remainingSec}`;

      // Progress recharge (from 113.1 to 0)
      const fraction = 1 - Math.max(0, this.timer / this.COOLDOWN_DURATION);
      this.fillEl.style.strokeDashoffset = `${113.1 * (1 - fraction)}`;

      if (this.timer <= 0) {
        this.setAvailable();
      }
    }
  }

  /**
   * Tracks index fingertip position and executes dwell selection if pointing at the button.
   * targetX, targetY are mirrored screen pixels.
   * Returns true if currently targeting the speed boost button, so turning gestures can be paused.
   */
  updatePointer(targetX: number, targetY: number, isPointing: boolean, dt: number): boolean {
    if (!isPointing) {
      this.hidePointer();
      this.isHovered = false;
      this.hasTriggeredThisHover = false;
      this.dwellTimer = 0;
      this.btnEl.classList.remove('hover-gesture');
      return false;
    }

    // Smooth cursor interpolation
    if (!this.isPointerVisible) {
      this.cursorX = targetX;
      this.cursorY = targetY;
      this.isPointerVisible = true;
      this.cursorEl.classList.add('visible');
    } else {
      this.cursorX += (targetX - this.cursorX) * 0.45;
      this.cursorY += (targetY - this.cursorY) * 0.45;
    }

    this.cursorEl.style.transform = `translate3d(${this.cursorX}px, ${this.cursorY}px, 0)`;

    // Check collision with the Speed Boost button
    const rect = this.btnEl.getBoundingClientRect();
    const pad = 16; // Generous hit boundary for natural finger pointing
    const isInside =
      this.cursorX >= rect.left - pad &&
      this.cursorX <= rect.right + pad &&
      this.cursorY >= rect.top - pad &&
      this.cursorY <= rect.bottom + pad;

    if (isInside) {
      this.isHovered = true;
      this.btnEl.classList.add('hover-gesture');

      if (this.state === 'AVAILABLE') {
        if (!this.hasTriggeredThisHover) {
          this.dwellTimer += dt;
          const progress = Math.min(1.0, this.dwellTimer / this.DWELL_TIME_REQUIRED);
          this.cursorRingFill.style.strokeDashoffset = `${113.1 * (1 - progress)}`;

          if (progress >= 1.0) {
            // Trigger Speed Boost!
            this.activateBoost();
            this.hasTriggeredThisHover = true;
            this.dwellTimer = 0;
            this.cursorRingFill.style.strokeDashoffset = '113.1';
          }
        }
      } else {
        // In ACTIVE or COOLDOWN: cursor stays over button but does not activate
        this.cursorRingFill.style.strokeDashoffset = '113.1';
      }
      return true; // Targeting button
    } else {
      // Finger moved outside button boundary
      this.isHovered = false;
      this.hasTriggeredThisHover = false;
      this.dwellTimer = 0;
      this.btnEl.classList.remove('hover-gesture');
      this.cursorRingFill.style.strokeDashoffset = '113.1';
      return false;
    }
  }

  isTargetingButton(): boolean {
    return this.isHovered;
  }

  hidePointer(): void {
    if (this.isPointerVisible) {
      this.isPointerVisible = false;
      this.cursorEl.classList.remove('visible');
    }
  }

  /**
   * Activates the 5-second speed boost (2x multiplier).
   */
  activateBoost(): void {
    if (this.state !== 'AVAILABLE') return;

    this.state = 'ACTIVE';
    this.timer = this.ACTIVE_DURATION;
    this.controller.speedBoostActive = true;

    // Visuals
    this.btnEl.className = 'active flash-activate';
    setTimeout(() => this.btnEl.classList.remove('flash-activate'), 500);
    this.statusEl.textContent = `BOOST ACTIVE: 5`;
    this.fillEl.style.stroke = '#38bdf8';
    this.fillEl.style.strokeDashoffset = '0';

    // Toast
    this.showToast('SPEED BOOST ACTIVATED!', 'toast-active');

    // Audio
    this.playActivateSound();
  }

  /**
   * Ends the speed boost and initiates the 10-second cooldown.
   */
  private endBoost(): void {
    this.state = 'COOLDOWN';
    this.timer = this.COOLDOWN_DURATION;
    this.controller.speedBoostActive = false;

    // Visuals
    this.btnEl.className = 'cooldown';
    this.statusEl.textContent = `READY IN: 10`;
    this.fillEl.style.stroke = '#64748b';
    this.fillEl.style.strokeDashoffset = '113.1';

    // Toast
    this.showToast('BOOST ENDED', 'toast-end');

    // Audio
    this.playEndSound();
  }

  /**
   * Restores button to AVAILABLE state after cooldown expires.
   */
  private setAvailable(): void {
    this.setState('AVAILABLE');
    this.showToast('SPEED BOOST READY!', 'toast-ready');
    this.playReadySound();
  }

  private setState(state: SpeedBoostState): void {
    this.state = state;
    if (state === 'AVAILABLE') {
      this.timer = 0;
      this.btnEl.className = 'available';
      this.statusEl.textContent = 'READY [ENTER / POINT]';
      this.fillEl.style.stroke = '#fbbf24';
      this.fillEl.style.strokeDashoffset = '0';
    }
  }

  private showToast(text: string, styleClass: string): void {
    const textEl = this.toastEl.querySelector('#sb-toast-text');
    if (textEl) textEl.textContent = text;
    this.toastEl.className = `${styleClass} show`;

    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('show');
      this.toastTimer = null;
    }, 2200);
  }

  // Web Audio Synthesized Sound Effects
  private getAudioContext(): AudioContext | null {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  private playActivateSound(): void {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // High-energy electric sonic riser
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sawtooth';
      osc2.type = 'sine';

      // Pitch sweep from 220Hz up to 880Hz
      osc1.frequency.setValueAtTime(220, now);
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.28);
      osc2.frequency.setValueAtTime(440, now);
      osc2.frequency.exponentialRampToValueAtTime(1320, now + 0.28);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.35);
      osc2.stop(now + 0.35);
    } catch {
      // Audio fallback
    }
  }

  private playEndSound(): void {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.28);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.32);
    } catch {
      // Audio fallback
    }
  }

  private playReadySound(): void {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Pleasant two-tone chime (D5 -> A5)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.1);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.32);
    } catch {
      // Audio fallback
    }
  }

  /**
   * Resets speed boost and clears timers.
   */
  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.controller.speedBoostActive = false;
    this.container.remove();
    this.cursorEl.remove();
    this.toastEl.remove();
  }
}
