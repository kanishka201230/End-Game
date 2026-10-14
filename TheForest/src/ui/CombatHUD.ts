import { FirstPersonController } from '../player/FirstPersonController';

export class CombatHUD {
  private container!: HTMLElement;
  private punchBtn!: HTMLButtonElement;
  private kickBtn!: HTMLButtonElement;
  private viewBtn!: HTMLButtonElement;

  constructor(private readonly controller: FirstPersonController) {
    this.createDom();
  }

  private createDom(): void {
    const style = document.createElement('style');
    style.textContent = `
      #combat-hud {
        position: fixed;
        bottom: 84px;
        right: 24px;
        z-index: 54;
        display: flex;
        gap: 10px;
        user-select: none;
      }
      .combat-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        border-radius: 20px;
        background: rgba(14, 24, 18, 0.92);
        backdrop-filter: blur(6px);
        border: 1.5px solid rgba(182, 146, 78, 0.6);
        color: #fef3c7;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(0,0,0,0.6);
        transition: transform 0.15s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        outline: none;
      }
      .combat-btn:hover {
        background: rgba(28, 48, 32, 0.95);
        border-color: #f59e0b;
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(245, 158, 11, 0.4);
      }
      .combat-btn:active,
      .combat-btn.active-press {
        transform: scale(0.94);
        background: rgba(59, 130, 246, 0.35);
        border-color: #38bdf8;
        box-shadow: 0 0 18px rgba(56, 189, 248, 0.7);
      }
      .combat-btn .icon {
        font-size: 14px;
      }
      .combat-btn .key-hint {
        font-size: 9px;
        padding: 1px 4px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.15);
        color: #cbd5e1;
      }
    `;
    document.head.appendChild(style);

    const hud = document.createElement('div');
    hud.id = 'combat-hud';
    hud.innerHTML = `
      <button class="combat-btn" id="btn-punch" type="button" tabindex="-1">
        <span class="icon">🥊</span>
        <span>PUNCH</span>
        <span class="key-hint">J</span>
      </button>
      <button class="combat-btn" id="btn-kick" type="button" tabindex="-1">
        <span class="icon">🥋</span>
        <span>KICK</span>
        <span class="key-hint">K</span>
      </button>
      <button class="combat-btn" id="btn-cam-view" type="button" tabindex="-1">
        <span class="icon">🎥</span>
        <span id="cam-view-label">VIEW (3RD)</span>
        <span class="key-hint">V</span>
      </button>
    `;
    document.body.appendChild(hud);

    this.container = hud;
    this.punchBtn = hud.querySelector('#btn-punch')!;
    this.kickBtn = hud.querySelector('#btn-kick')!;
    this.viewBtn = hud.querySelector('#btn-cam-view')!;

    this.punchBtn.addEventListener('click', () => {
      this.flashButton(this.punchBtn);
      this.controller.triggerPunch();
    });

    this.kickBtn.addEventListener('click', () => {
      this.flashButton(this.kickBtn);
      this.controller.triggerKick();
    });

    this.viewBtn.addEventListener('click', () => {
      this.controller.toggleCameraView();
      const label = this.viewBtn.querySelector('#cam-view-label')!;
      label.textContent = this.controller.isThirdPerson ? 'VIEW (3RD)' : 'VIEW (1ST)';
    });
  }

  update(): void {
    const canFight = this.controller.canFight;
    if (canFight) {
      this.punchBtn.style.opacity = '1';
      this.punchBtn.style.filter = 'none';
      this.punchBtn.title = 'Punch Combo (Opponent in range!)';
      this.kickBtn.style.opacity = '1';
      this.kickBtn.style.filter = 'none';
      this.kickBtn.title = 'MMA Kick (Opponent in range!)';
    } else {
      this.punchBtn.style.opacity = '0.4';
      this.punchBtn.style.filter = 'grayscale(0.6)';
      this.punchBtn.title = 'Punch disabled (Opponent must be near)';
      this.kickBtn.style.opacity = '0.4';
      this.kickBtn.style.filter = 'grayscale(0.6)';
      this.kickBtn.title = 'Kick disabled (Opponent must be near)';
    }
  }

  flashButton(btn: HTMLElement): void {
    btn.classList.add('active-press');
    setTimeout(() => btn.classList.remove('active-press'), 200);
  }

  destroy(): void {
    this.container.remove();
  }
}
