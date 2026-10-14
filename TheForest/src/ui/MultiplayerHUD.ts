import { NetRole } from '../net/NetworkClient';

export class MultiplayerHUD {
  private container: HTMLElement;
  private roleBadge!: HTMLElement;
  private opponentBadge!: HTMLElement;
  private roomLabel!: HTMLElement;
  private copyBtn!: HTMLButtonElement;
  private banner!: HTMLElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'multiplayer-hud';
    this.createDom();
    document.body.appendChild(this.container);
  }

  private createDom(): void {
    const style = document.createElement('style');
    style.textContent = `
      #multiplayer-hud {
        position: fixed;
        top: 14px;
        left: 18px;
        z-index: 60;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        user-select: none;
        pointer-events: auto;
      }
      .mp-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 12px;
        background: rgba(10, 15, 12, 0.88);
        border: 1.5px solid rgba(212, 175, 55, 0.4);
        border-radius: 10px;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(8px);
        font-size: 12px;
        color: #e2e8f0;
      }
      .mp-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        border-radius: 6px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        font-size: 11px;
      }
      .mp-badge-p1 {
        background: rgba(37, 99, 235, 0.25);
        color: #60a5fa;
        border: 1px solid rgba(59, 130, 246, 0.6);
      }
      .mp-badge-p2 {
        background: rgba(234, 88, 12, 0.25);
        color: #fb923c;
        border: 1px solid rgba(249, 115, 22, 0.6);
      }
      .mp-opp-waiting {
        color: #facc15;
        font-style: italic;
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .mp-opp-waiting::before {
        content: '';
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #facc15;
        box-shadow: 0 0 8px #facc15;
        animation: mp-pulse 1.4s infinite;
      }
      @keyframes mp-pulse {
        0%, 100% { opacity: 0.3; transform: scale(0.9); }
        50% { opacity: 1; transform: scale(1.2); }
      }
      .mp-opp-online {
        color: #4ade80;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .mp-opp-online::before {
        content: '';
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #4ade80;
        box-shadow: 0 0 8px #4ade80;
      }
      .mp-copy-btn {
        background: rgba(212, 175, 55, 0.18);
        border: 1px solid rgba(212, 175, 55, 0.5);
        color: #fce79f;
        padding: 3px 8px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
        transition: all 0.2s ease;
      }
      .mp-copy-btn:hover {
        background: rgba(212, 175, 55, 0.35);
        border-color: #ffd700;
      }
      .mp-banner {
        padding: 6px 14px;
        border-radius: 8px;
        background: rgba(16, 24, 18, 0.95);
        border-left: 4px solid #3b82f6;
        color: #f8fafc;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        opacity: 0;
        transform: translateY(-8px);
        transition: all 0.3s ease;
        pointer-events: none;
      }
      .mp-banner.show {
        opacity: 1;
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);

    this.container.innerHTML = `
      <div class="mp-bar">
        <span id="mp-room-name" style="color:#94a3b8;font-size:11px;">Room: <b>...</b></span>
        <span id="mp-role-badge" class="mp-badge mp-badge-p1">Connecting...</span>
        <span id="mp-opp-status" class="mp-opp-waiting">Waiting for Opponent...</span>
        <button id="mp-copy-btn" class="mp-copy-btn" title="Copy Invite Link to Clipboard">📋 Copy Link</button>
      </div>
      <div id="mp-notification" class="mp-banner"></div>
    `;

    this.roleBadge = this.container.querySelector('#mp-role-badge')!;
    this.opponentBadge = this.container.querySelector('#mp-opp-status')!;
    this.roomLabel = this.container.querySelector('#mp-room-name')!;
    this.copyBtn = this.container.querySelector('#mp-copy-btn')!;
    this.banner = this.container.querySelector('#mp-notification')!;

    this.copyBtn.addEventListener('click', () => {
      this.copyInviteLink();
    });
  }

  setRoom(roomId: string): void {
    this.roomLabel.innerHTML = `Room: <b style="color:#f8fafc;">${roomId}</b>`;
  }

  setRole(role: NetRole): void {
    if (role === 1) {
      this.roleBadge.className = 'mp-badge mp-badge-p1';
      this.roleBadge.textContent = 'YOU: P1 (TACTICAL FIGHTER)';
    } else {
      this.roleBadge.className = 'mp-badge mp-badge-p2';
      this.roleBadge.textContent = 'YOU: P2 (FOREST SURVIVOR)';
    }
  }

  setOpponentStatus(hasOpponent: boolean, role?: NetRole, pingMs?: number): void {
    if (!hasOpponent) {
      this.opponentBadge.className = 'mp-opp-waiting';
      this.opponentBadge.textContent = 'Waiting for Player 2...';
    } else {
      this.opponentBadge.className = 'mp-opp-online';
      const name = role === 1 ? 'P1 Tactical Fighter' : 'P2 Forest Survivor';
      const pingText = pingMs ? ` (${pingMs}ms)` : '';
      this.opponentBadge.textContent = `${name} Online${pingText}`;
    }
  }

  showNotification(text: string, color = '#3b82f6'): void {
    this.banner.style.borderLeftColor = color;
    this.banner.textContent = text;
    this.banner.classList.add('show');
    setTimeout(() => {
      this.banner.classList.remove('show');
    }, 4500);
  }

  copyInviteLink(): void {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      const orig = this.copyBtn.textContent;
      this.copyBtn.textContent = '✓ Copied!';
      this.showNotification('Invite link copied to clipboard! Share it with the 2nd player.', '#10b981');
      setTimeout(() => {
        this.copyBtn.textContent = orig;
      }, 2000);
    }).catch(() => {
      this.showNotification(`Invite link: ${url}`);
    });
  }
}
