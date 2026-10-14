export interface PlayerNetState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  action: 'IDLE' | 'RUNNING' | 'PUNCH' | 'KICK';
  speedMult: number;
  speedBoostActive: boolean;
}

export interface WorldNetState {
  door1Unlocked: boolean;
  door2Unlocked: boolean;
  cupClaimed: boolean;
}

export type NetRole = 1 | 2;

export class NetworkClient {
  private ws: WebSocket | null = null;
  public role: NetRole | null = null;
  public playerId: string | null = null;
  public roomId = 'forest_main';
  public isConnected = false;
  public hasOpponent = false;
  public pingMs = 0;

  public onConnected?: (role: NetRole, playerId: string, roomId: string, hasOpponent: boolean, worldState: WorldNetState) => void;
  public onOpponentJoined?: (role: NetRole, playerId: string) => void;
  public onOpponentState?: (state: PlayerNetState) => void;
  public onOpponentLeft?: (role: NetRole) => void;
  public onDoorUnlocked?: (doorId: number) => void;
  public onVictory?: (winnerRole: NetRole) => void;
  public onError?: (msg: string) => void;
  public onPingUpdate?: (ping: number) => void;

  private pingTimer: number | null = null;
  private lastSendTime = 0;
  private sendIntervalMs = 33; // ~30 updates per second

  constructor() {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      this.roomId = roomParam;
    }
  }

  /**
   * Connects to the multiplayer server.
   * Auto-detects server address (from query ?server=ws://... or defaults to ws://${window.location.hostname}:3001).
   */
  connect(): void {
    const params = new URLSearchParams(window.location.search);
    const customServer = params.get('server');

    let wsUrl: string;
    if (customServer) {
      wsUrl = `${customServer}?room=${encodeURIComponent(this.roomId)}`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname || 'localhost';
      const port = 3001;
      wsUrl = `${protocol}//${host}:${port}?room=${encodeURIComponent(this.roomId)}`;
    }

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (e) {
      console.warn('[NetworkClient] Connection failed:', e);
      this.onError?.('Failed to initiate WebSocket connection.');
      return;
    }

    this.ws.onopen = () => {
      this.isConnected = true;
      this.startPingLoop();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        this.handleMessage(msg);
      } catch (err) {
        console.error('[NetworkClient] Message parse error:', err);
      }
    };

    this.ws.onclose = (event) => {
      this.isConnected = false;
      this.stopPingLoop();
      if (event.code === 1008) {
        this.onError?.('Room is full (max 2 players).');
      } else {
        console.log('[NetworkClient] Disconnected from multiplayer server');
      }
    };

    this.ws.onerror = (err) => {
      console.warn('[NetworkClient] WebSocket error:', err);
      this.onError?.('Connection error to multiplayer server.');
    };
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'WELCOME': {
        this.role = msg.role as NetRole;
        this.playerId = msg.playerId as string;
        this.roomId = msg.roomId as string;
        this.hasOpponent = !!msg.hasOpponent;
        const worldState = msg.worldState as WorldNetState;
        this.onConnected?.(this.role, this.playerId, this.roomId, this.hasOpponent, worldState);
        break;
      }
      case 'OPPONENT_JOINED': {
        this.hasOpponent = true;
        this.onOpponentJoined?.(msg.role as NetRole, msg.playerId as string);
        break;
      }
      case 'OPPONENT_STATE': {
        this.onOpponentState?.(msg.state as PlayerNetState);
        break;
      }
      case 'OPPONENT_LEFT': {
        this.hasOpponent = false;
        this.onOpponentLeft?.(msg.role as NetRole);
        break;
      }
      case 'DOOR_UNLOCKED': {
        this.onDoorUnlocked?.(msg.doorId as number);
        break;
      }
      case 'VICTORY': {
        this.onVictory?.(msg.winnerRole as NetRole);
        break;
      }
      case 'PONG': {
        const now = Date.now();
        const clientTime = msg.clientTime as number;
        this.pingMs = Math.max(1, now - clientTime);
        this.onPingUpdate?.(this.pingMs);
        break;
      }
      case 'ROOM_FULL': {
        this.onError?.(msg.message as string);
        break;
      }
    }
  }

  sendState(state: PlayerNetState): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (now - this.lastSendTime < this.sendIntervalMs) return;
    this.lastSendTime = now;

    this.ws.send(JSON.stringify({
      type: 'STATE_UPDATE',
      state
    }));
  }

  sendDoorUnlocked(doorId: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'DOOR_UNLOCKED',
      doorId
    }));
  }

  sendVictory(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'VICTORY'
    }));
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'PING', time: Date.now() }));
      }
    }, 2000);
  }

  private stopPingLoop(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  disconnect(): void {
    this.stopPingLoop();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
