/**
 * UI controller for the Ancient Parchment Scroll Rapid-Fire Quiz.
 * Includes real-time webcam gesture pointer support (pointing index finger to select answers).
 */

export interface Question {
  question: string;
  options: string[];
  correct: number;
}

export const DOOR1_QUESTIONS: Question[] = [
  {
    question: "What has keys, but no locks; space, but no room; and you can enter, but cannot go in?",
    options: ["A keyboard", "A treasure chest", "A musical piano", "A dungeon"],
    correct: 0
  },
  {
    question: "The more of this you take, the more you leave behind. What are they?",
    options: ["Seconds", "Footsteps", "Memories", "Breaths"],
    correct: 1
  },
  {
    question: "What gets wetter the more it dries?",
    options: ["A sponge", "A cloud", "A towel", "A leaf"],
    correct: 2
  },
  {
    question: "What belongs to you, but other people use it far more than you do?",
    options: ["Your shoes", "Your name", "Your phone", "Your shadow"],
    correct: 1
  },
  {
    question: "What has hands, but cannot clap?",
    options: ["A clock", "A statue", "A compass", "A tree"],
    correct: 0
  }
];

export const DOOR2_QUESTIONS: Question[] = [
  {
    question: "I speak without a mouth and hear without ears. I come alive with wind. What am I?",
    options: ["A whisper", "A flute", "An echo", "A river"],
    correct: 2
  },
  {
    question: "What has one eye, but cannot see anything at all?",
    options: ["A needle", "A storm", "A potato", "A lock"],
    correct: 0
  },
  {
    question: "What can travel around the entire world while staying in a single corner?",
    options: ["A bird", "A compass", "A postage stamp", "The sun"],
    correct: 2
  },
  {
    question: "What has many sharp teeth, but can never bite?",
    options: ["A saw", "A comb", "A zipper", "A gear"],
    correct: 1
  },
  {
    question: "What has a head and a tail, but has no body?",
    options: ["A snake", "A comet", "A coin", "A kite"],
    correct: 2
  }
];

export class ScrollQuizUI {
  private container!: HTMLElement;
  private scrollEl!: HTMLElement;
  private badgeEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private questionEl!: HTMLElement;
  private optionsEl!: HTMLElement;
  private feedbackEl!: HTMLElement;

  // Gesture Cursor Elements
  private cursorEl!: HTMLElement;
  private cursorRingFill!: SVGCircleElement;
  private cursorX = 0;
  private cursorY = 0;
  private dwellTimer = 0;
  private currentHoverBtn: HTMLButtonElement | null = null;
  private isAnswerLocked = false;
  private lastPointerTime = 0;

  private currentQuestions: Question[] = [];
  private currentIndex = 0;
  private activeDoorId: number | null = null;
  private onCompleteCallback: ((doorId: number) => void) | null = null;
  private isOpen = false;
  private isSpeaking = false;

  public onVoiceStart?: () => void;
  public onVoiceEnd?: () => void;

  constructor() {
    this.createDom();
  }

  get isQuizActive(): boolean {
    return this.isOpen;
  }

  private createDom(): void {
    const style = document.createElement('style');
    style.textContent = `
      #scroll-overlay {
        position: fixed;
        inset: 0;
        z-index: 100;
        pointer-events: none;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        transition: background 0.4s ease;
      }
      #scroll-overlay.active {
        pointer-events: auto;
        background: rgba(8, 12, 8, 0.45);
        backdrop-filter: blur(3px);
      }
      #parchment-scroll {
        position: relative;
        width: min(530px, 92vw);
        margin-top: 2rem;
        transform: translateY(-130%);
        transition: transform 0.65s cubic-bezier(0.18, 1.15, 0.32, 1);
        filter: drop-shadow(0 18px 30px rgba(0, 0, 0, 0.65));
        font-family: 'Georgia', 'Times New Roman', serif;
        user-select: none;
      }
      #scroll-overlay.active #parchment-scroll {
        transform: translateY(0);
      }
      .scroll-roller {
        height: 26px;
        background: linear-gradient(180deg, #533618 0%, #875727 45%, #b1793b 55%, #422912 100%);
        border-radius: 13px;
        box-shadow: inset 0 2px 3px rgba(255,255,255,0.3), 0 4px 10px rgba(0,0,0,0.5);
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 10px;
      }
      .scroll-knob {
        width: 18px;
        height: 18px;
        background: radial-gradient(circle, #ecd089 20%, #996f2a 80%);
        border-radius: 50%;
        box-shadow: 0 1px 4px rgba(0,0,0,0.6);
      }
      .scroll-body {
        position: relative;
        background: #f1dfba;
        background-image: 
          radial-gradient(ellipse at 50% 20%, rgba(255,255,255,0.4) 0%, transparent 70%),
          radial-gradient(circle at 10% 50%, rgba(139, 90, 43, 0.12) 0%, transparent 40%),
          radial-gradient(circle at 90% 70%, rgba(139, 90, 43, 0.15) 0%, transparent 45%);
        border-left: 6px solid #cfb484;
        border-right: 6px solid #cfb484;
        box-shadow: inset 0 0 40px rgba(110, 68, 26, 0.3);
        padding: 1.8rem 2.2rem 1.6rem;
        color: #38240f;
        text-align: center;
      }
      .scroll-badge {
        display: inline-block;
        padding: 0.25rem 0.9rem;
        background: #422912;
        color: #f7e8c8;
        font-size: 0.75rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        border-radius: 20px;
        margin-bottom: 0.6rem;
        font-weight: bold;
      }
      .scroll-title {
        font-size: 1.55rem;
        font-weight: bold;
        letter-spacing: 0.08em;
        color: #0e3a6c;
        text-shadow: 0 1px 1px rgba(255,255,255,0.4);
        margin-bottom: 0.8rem;
        border-bottom: 1px dashed rgba(80, 50, 20, 0.35);
        padding-bottom: 0.5rem;
      }
      .scroll-question {
        font-size: 1.15rem;
        line-height: 1.45;
        font-style: italic;
        color: #2b1808;
        margin-bottom: 1.4rem;
        min-height: 3.2rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .scroll-options {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
        margin-bottom: 0.8rem;
      }
      .scroll-btn {
        padding: 0.85rem 1rem;
        background: linear-gradient(180deg, #fbf2dc 0%, #e6cb9b 100%);
        border: 1.5px solid #a4763e;
        border-radius: 6px;
        color: #2d1806;
        font-family: inherit;
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 3px 5px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.6);
        transition: transform 0.15s, background 0.2s, border-color 0.2s, box-shadow 0.15s;
        position: relative;
      }
      .scroll-btn:hover, .scroll-btn.gesture-hover {
        background: linear-gradient(180deg, #fff3cf 0%, #ffdf79 100%) !important;
        border-color: #d4a017 !important;
        transform: scale(1.04) translateY(-3px) !important;
        box-shadow: 0 8px 18px rgba(212, 160, 23, 0.45), 0 0 16px rgba(255, 215, 0, 0.6) !important;
        color: #1a0f00 !important;
      }
      .scroll-btn:active {
        transform: translateY(1px);
      }
      .scroll-btn.correct {
        background: linear-gradient(180deg, #d4f7c5 0%, #8ee070 100%) !important;
        border-color: #2e7a16 !important;
        color: #0d3803 !important;
      }
      .scroll-btn.wrong {
        background: linear-gradient(180deg, #ffd4d4 0%, #e87b7b 100%) !important;
        border-color: #a81d1d !important;
        color: #4a0808 !important;
      }
      .scroll-feedback {
        min-height: 1.5rem;
        font-size: 0.88rem;
        font-weight: bold;
        color: #8c2612;
        letter-spacing: 0.05em;
      }
      .scroll-feedback.success {
        color: #1a6d14;
      }
      #quiz-gesture-hint {
        margin-top: 0.5rem;
        font-size: 0.82rem;
        color: #6e4c1f;
        font-style: italic;
        letter-spacing: 0.04em;
        background: rgba(160, 110, 45, 0.12);
        padding: 4px 10px;
        border-radius: 4px;
        display: inline-block;
      }
      @keyframes scrollShake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-8px); }
        40%, 80% { transform: translateX(8px); }
      }
      .shake {
        animation: scrollShake 0.4s ease;
      }

      /* Glowing Gesture Finger Reticle Cursor */
      #quiz-gesture-cursor {
        position: fixed;
        top: 0;
        left: 0;
        width: 48px;
        height: 48px;
        margin-top: -24px;
        margin-left: -24px;
        pointer-events: none;
        z-index: 300;
        display: none;
        will-change: transform;
      }
      #quiz-gesture-cursor.visible {
        display: block;
      }
      .cursor-dot {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 14px;
        height: 14px;
        margin-top: -7px;
        margin-left: -7px;
        border-radius: 50%;
        background: radial-gradient(circle, #ffffff 10%, #ffd700 60%, #ff8800 100%);
        box-shadow: 0 0 16px #ffd700, 0 0 26px rgba(255, 215, 0, 0.9);
      }
      .cursor-ring {
        position: absolute;
        inset: 0;
        transform: rotate(-90deg);
      }
      .ring-bg {
        fill: none;
        stroke: rgba(255, 255, 255, 0.25);
        stroke-width: 3.5;
      }
      .ring-fill {
        fill: none;
        stroke: #22c55e;
        stroke-width: 4;
        stroke-dasharray: 113.1;
        stroke-dashoffset: 113.1;
        stroke-linecap: round;
        transition: stroke-dashoffset 0.04s linear;
      }

      /* Victory Banner */
      #victory-banner {
        position: fixed;
        inset: 0;
        z-index: 120;
        background: rgba(10, 18, 8, 0.78);
        backdrop-filter: blur(8px);
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: #f7e8c8;
        font-family: 'Georgia', serif;
        text-align: center;
      }
      #victory-banner.visible {
        display: flex;
        animation: victoryFade 0.6s ease-out;
      }
      @keyframes victoryFade {
        from { opacity: 0; transform: scale(0.9); }
        to { opacity: 1; transform: scale(1); }
      }
      #victory-banner h2 {
        font-size: clamp(2.2rem, 5vw, 3.8rem);
        color: #ffd700;
        text-shadow: 0 0 30px rgba(255, 215, 0, 0.6);
        letter-spacing: 0.15em;
        margin-bottom: 0.5rem;
      }
      #victory-banner p {
        font-size: 1.2rem;
        color: #e8f0d8;
        margin-bottom: 2rem;
        letter-spacing: 0.1em;
      }
      #victory-restart {
        padding: 0.9rem 2.8rem;
        background: linear-gradient(180deg, #d4a017 0%, #8c6200 100%);
        border: 2px solid #ffec8b;
        color: #1a1000;
        font-family: inherit;
        font-size: 1.1rem;
        font-weight: bold;
        letter-spacing: 0.15em;
        border-radius: 6px;
        cursor: pointer;
        box-shadow: 0 0 25px rgba(255, 215, 0, 0.4);
        transition: transform 0.2s, box-shadow 0.2s;
      }
      #victory-restart:hover {
        transform: scale(1.05);
        box-shadow: 0 0 35px rgba(255, 215, 0, 0.7);
      }
    `;
    document.head.appendChild(style);

    // Scroll Overlay Container
    const overlay = document.createElement('div');
    overlay.id = 'scroll-overlay';

    overlay.innerHTML = `
      <div id="parchment-scroll">
        <div class="scroll-roller top">
          <div class="scroll-knob"></div>
          <div class="scroll-knob"></div>
        </div>
        <div class="scroll-body">
          <div class="scroll-badge" id="scroll-badge">Question 1 / 5</div>
          <div class="scroll-title" id="scroll-title">DOOR 1: 5 RAPID FIRE QUESTIONS</div>
          <div class="scroll-question" id="scroll-question">Loading riddle...</div>
          <div class="scroll-options" id="scroll-options"></div>
          <div class="scroll-feedback" id="scroll-feedback"></div>
          <div id="quiz-gesture-hint">👉 Point your index finger at an answer to select it (or click)</div>
        </div>
        <div class="scroll-roller bottom">
          <div class="scroll-knob"></div>
          <div class="scroll-knob"></div>
        </div>
      </div>
      <div id="quiz-gesture-cursor">
        <div class="cursor-dot"></div>
        <svg class="cursor-ring" viewBox="0 0 44 44">
          <circle class="ring-bg" cx="22" cy="22" r="18" />
          <circle class="ring-fill" id="quiz-ring-fill" cx="22" cy="22" r="18" />
        </svg>
      </div>
    `;
    document.body.appendChild(overlay);

    // Victory Banner
    const victory = document.createElement('div');
    victory.id = 'victory-banner';
    victory.innerHTML = `
      <h2>🏆 VICTORY! 🏆</h2>
      <p>You have conquered the trials and claimed the Champion's Cup!</p>
      <button id="victory-restart">PLAY AGAIN</button>
    `;
    document.body.appendChild(victory);

    this.container = overlay;
    this.scrollEl = overlay.querySelector('#parchment-scroll')!;
    this.badgeEl = overlay.querySelector('#scroll-badge')!;
    this.titleEl = overlay.querySelector('#scroll-title')!;
    this.questionEl = overlay.querySelector('#scroll-question')!;
    this.optionsEl = overlay.querySelector('#scroll-options')!;
    this.feedbackEl = overlay.querySelector('#scroll-feedback')!;
    this.cursorEl = overlay.querySelector('#quiz-gesture-cursor')!;
    this.cursorRingFill = overlay.querySelector('#quiz-ring-fill')!;

    victory.querySelector('#victory-restart')!.addEventListener('click', () => {
      window.location.reload();
    });
  }

  /**
   * Updates the gesture pointer location on screen and performs dwell selection on answer options.
   * targetX, targetY are screen coordinates in pixels.
   */
  updateGesturePointer(targetX: number, targetY: number): void {
    if (!this.isOpen) return;

    const now = performance.now();
    const dt = this.lastPointerTime > 0 ? (now - this.lastPointerTime) / 1000 : 0.016;
    this.lastPointerTime = now;

    // Smooth cursor movement with moving average
    if (this.cursorX === 0 && this.cursorY === 0) {
      this.cursorX = targetX;
      this.cursorY = targetY;
    } else {
      this.cursorX += (targetX - this.cursorX) * 0.45;
      this.cursorY += (targetY - this.cursorY) * 0.45;
    }

    if (this.cursorEl) {
      this.cursorEl.style.transform = `translate3d(${this.cursorX}px, ${this.cursorY}px, 0)`;
      this.cursorEl.classList.add('visible');
    }

    if (this.isAnswerLocked) {
      this.clearHover();
      return;
    }

    // Check collision with answer buttons
    const buttons = Array.from(this.optionsEl.querySelectorAll<HTMLButtonElement>('.scroll-btn:not([disabled])'));
    let hoveredBtn: HTMLButtonElement | null = null;

    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      const pad = 12; // Generous hit boundary for easy selection
      if (
        this.cursorX >= rect.left - pad &&
        this.cursorX <= rect.right + pad &&
        this.cursorY >= rect.top - pad &&
        this.cursorY <= rect.bottom + pad
      ) {
        hoveredBtn = btn;
        break;
      }
    }

    if (hoveredBtn) {
      if (this.currentHoverBtn !== hoveredBtn) {
        this.clearHover();
        this.currentHoverBtn = hoveredBtn;
        hoveredBtn.classList.add('gesture-hover');
        this.dwellTimer = 0;
      } else {
        this.dwellTimer += dt;
        const progress = Math.min(1.0, this.dwellTimer / 0.85); // 850ms to select
        if (this.cursorRingFill) {
          this.cursorRingFill.style.strokeDashoffset = `${113.1 * (1 - progress)}`;
        }
        if (progress >= 1.0) {
          // Confirm answer via gesture!
          this.isAnswerLocked = true;
          this.dwellTimer = 0;
          if (this.cursorRingFill) {
            this.cursorRingFill.style.strokeDashoffset = '113.1';
          }
          hoveredBtn.classList.remove('gesture-hover');
          hoveredBtn.click();
          setTimeout(() => {
            this.isAnswerLocked = false;
          }, 1100);
        }
      }
    } else {
      this.clearHover();
    }
  }

  hideGesturePointer(): void {
    if (this.cursorEl) {
      this.cursorEl.classList.remove('visible');
    }
    this.clearHover();
  }

  private clearHover(): void {
    if (this.currentHoverBtn) {
      this.currentHoverBtn.classList.remove('gesture-hover');
      this.currentHoverBtn = null;
    }
    this.dwellTimer = 0;
    if (this.cursorRingFill) {
      this.cursorRingFill.style.strokeDashoffset = '113.1';
    }
  }

  showQuiz(doorId: number, onComplete: (doorId: number) => void): void {
    if (this.isOpen) return;

    this.activeDoorId = doorId;
    this.onCompleteCallback = onComplete;
    this.currentQuestions = doorId === 2 ? DOOR2_QUESTIONS : DOOR1_QUESTIONS;
    this.currentIndex = 0;
    this.isOpen = true;
    this.isAnswerLocked = false;
    this.dwellTimer = 0;
    this.cursorX = window.innerWidth / 2;
    this.cursorY = window.innerHeight * 0.45;

    this.titleEl.textContent = `DOOR ${doorId}: 5 RAPID FIRE QUESTIONS`;
    this.titleEl.style.color = doorId === 2 ? '#8c2810' : '#0e3a6c';
    this.container.classList.add('active');

    this.renderCurrentQuestion();
  }

  private speakQuestion(text: string): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.volume = 1.0; // Maximum loudness
      utterance.rate = 0.94;   // Natural, articulate question pacing
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';

      // Pick high quality English voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((v) =>
        v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('David') || v.name.includes('Aria') || v.name.includes('Guy'))
      );
      if (preferred) {
        utterance.voice = preferred;
      }

      utterance.onstart = () => {
        this.isSpeaking = true;
        this.onVoiceStart?.();
      };

      utterance.onend = () => {
        this.isSpeaking = false;
        this.onVoiceEnd?.();
      };

      utterance.onerror = () => {
        this.isSpeaking = false;
        this.onVoiceEnd?.();
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
      this.isSpeaking = false;
      this.onVoiceEnd?.();
    }
  }

  private stopVoice(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (this.isSpeaking) {
      this.isSpeaking = false;
      this.onVoiceEnd?.();
    }
  }

  private renderCurrentQuestion(): void {
    const q = this.currentQuestions[this.currentIndex];
    this.badgeEl.textContent = `Question ${this.currentIndex + 1} / ${this.currentQuestions.length}`;
    this.questionEl.textContent = `"${q.question}"`;
    this.feedbackEl.textContent = '';
    this.feedbackEl.className = 'scroll-feedback';
    this.optionsEl.innerHTML = '';
    this.clearHover();

    // Loud Voice-Over reading the question cleanly over ducked music
    this.speakQuestion(`Question ${this.currentIndex + 1}. ${q.question}`);

    q.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'scroll-btn';
      btn.textContent = opt;
      btn.addEventListener('click', () => this.handleAnswer(idx, btn));
      this.optionsEl.appendChild(btn);
    });
  }

  private handleAnswer(selectedIndex: number, btnEl: HTMLButtonElement): void {
    this.stopVoice();
    const q = this.currentQuestions[this.currentIndex];
    const isCorrect = selectedIndex === q.correct;

    const allButtons = Array.from(this.optionsEl.querySelectorAll<HTMLButtonElement>('.scroll-btn'));
    allButtons.forEach((b) => (b.disabled = true));

    if (isCorrect) {
      btnEl.classList.add('correct');
      this.feedbackEl.textContent = '✓ Correct!';
      this.feedbackEl.classList.add('success');
      this.playChime(true);

      setTimeout(() => {
        this.currentIndex++;
        if (this.currentIndex < this.currentQuestions.length) {
          this.renderCurrentQuestion();
        } else {
          // Completed all 5 questions!
          this.badgeEl.textContent = '5 / 5 COMPLETED!';
          this.questionEl.textContent = `All 5 questions answered! Door ${this.activeDoorId} is opening...`;
          this.optionsEl.innerHTML = '';
          this.feedbackEl.textContent = `★ DOOR ${this.activeDoorId} UNLOCKED ★`;
          this.playFanfare();

          setTimeout(() => {
            this.closeQuiz();
            if (this.onCompleteCallback && this.activeDoorId !== null) {
              this.onCompleteCallback(this.activeDoorId);
            }
          }, 1400);
        }
      }, 700);
    } else {
      btnEl.classList.add('wrong');
      this.scrollEl.classList.add('shake');
      this.feedbackEl.textContent = '✗ Incorrect. Try again!';
      this.playChime(false);

      setTimeout(() => {
        this.scrollEl.classList.remove('shake');
        btnEl.classList.remove('wrong');
        allButtons.forEach((b) => (b.disabled = false));
      }, 900);
    }
  }

  closeQuiz(): void {
    this.stopVoice();
    this.isOpen = false;
    this.container.classList.remove('active');
    this.hideGesturePointer();
  }

  showVictory(): void {
    const victory = document.getElementById('victory-banner');
    if (victory) victory.classList.add('visible');
    this.playVictoryTune();
  }

  private playChime(correct: boolean): void {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = correct ? 'sine' : 'sawtooth';
      const now = ctx.currentTime;
      if (correct) {
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      } else {
        osc.frequency.setValueAtTime(220, now); // A3
        osc.frequency.exponentialRampToValueAtTime(146.83, now + 0.25); // D3
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      }
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.38);
    } catch {
      // Audio fallback silent
    }
  }

  private playFanfare(): void {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const start = ctx.currentTime + idx * 0.14;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.25, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.45);
      });
    } catch {
      // Audio fallback silent
    }
  }

  private playVictoryTune(): void {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const notes = [440, 554.37, 659.25, 880, 880, 880, 1108.73];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const start = ctx.currentTime + idx * 0.22;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.3, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.65);
      });
    } catch {
      // Audio fallback silent
    }
  }
}
