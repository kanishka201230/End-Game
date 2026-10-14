const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

/**
 * Room state structure:
 * {
 *   roomId: string,
 *   p1: { ws, id } | null,
 *   p2: { ws, id } | null,
 *   door1Unlocked: boolean,
 *   door2Unlocked: boolean,
 *   cupClaimed: boolean
 * }
 */
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      roomId,
      p1: null,
      p2: null,
      door1Unlocked: false,
      door2Unlocked: false,
      cupClaimed: false
    });
  }
  return rooms.get(roomId);
}

// 1. Create HTTP server for health-checks and status
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health' || req.url === '/status') {
    let totalPlayers = 0;
    for (const r of rooms.values()) {
      if (r.p1) totalPlayers++;
      if (r.p2) totalPlayers++;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      activeRooms: rooms.size,
      totalPlayers,
      uptime: process.uptime()
    }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html>
      <head><title>TheForest Multiplayer Server</title></head>
      <body style="font-family:sans-serif;background:#0d1117;color:#c9d1d9;padding:2rem;">
        <h2 style="color:#58a6ff;">TheForest — 2-Player Game Server</h2>
        <p>Status: <span style="color:#3fb950;font-weight:bold;">ONLINE</span></p>
        <p>Listening on <code>ws://${HOST}:${PORT}</code></p>
        <p>Active Rooms: <b>${rooms.size}</b></p>
      </body>
    </html>
  `);
});

// 2. Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Parse room ID from query string: ?room=forest1
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const roomId = urlObj.searchParams.get('room') || 'forest_main';

  const room = getOrCreateRoom(roomId);

  // Determine assigned role (1 or 2)
  let assignedRole = null;
  if (!room.p1) {
    assignedRole = 1;
  } else if (!room.p2) {
    assignedRole = 2;
  } else {
    // Room is full! Reject 3rd player cleanly
    ws.send(JSON.stringify({
      type: 'ROOM_FULL',
      message: 'This 2-player match is already full. Please join or create another room.'
    }));
    ws.close(1008, 'Room is full');
    return;
  }

  const playerId = `p${assignedRole}_${Math.random().toString(36).substring(2, 9)}`;
  const playerInfo = { ws, id: playerId };

  if (assignedRole === 1) {
    room.p1 = playerInfo;
  } else {
    room.p2 = playerInfo;
  }

  console.log(`[+] Player ${assignedRole} (${playerId}) connected to room [${roomId}]`);

  // Send WELCOME packet to connected client
  const hasOpponent = assignedRole === 1 ? !!room.p2 : !!room.p1;
  ws.send(JSON.stringify({
    type: 'WELCOME',
    role: assignedRole,
    playerId,
    roomId,
    hasOpponent,
    worldState: {
      door1Unlocked: room.door1Unlocked,
      door2Unlocked: room.door2Unlocked,
      cupClaimed: room.cupClaimed
    }
  }));

  // If opponent is already in the room, notify both clients
  if (hasOpponent) {
    const opp = assignedRole === 1 ? room.p2 : room.p1;
    if (opp && opp.ws.readyState === WebSocket.OPEN) {
      opp.ws.send(JSON.stringify({
        type: 'OPPONENT_JOINED',
        role: assignedRole,
        playerId
      }));
      ws.send(JSON.stringify({
        type: 'OPPONENT_JOINED',
        role: assignedRole === 1 ? 2 : 1,
        playerId: opp.id
      }));
    }
  }

  // Handle incoming messages
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', clientTime: msg.time, serverTime: Date.now() }));
        return;
      }

      const opp = assignedRole === 1 ? room.p2 : room.p1;

      if (msg.type === 'STATE_UPDATE') {
        // Forward state update to opponent
        if (opp && opp.ws.readyState === WebSocket.OPEN) {
          opp.ws.send(JSON.stringify({
            type: 'OPPONENT_STATE',
            role: assignedRole,
            state: msg.state
          }));
        }
      } else if (msg.type === 'DOOR_UNLOCKED') {
        if (msg.doorId === 1) room.door1Unlocked = true;
        if (msg.doorId === 2) room.door2Unlocked = true;

        // Broadcast to both players
        const packet = JSON.stringify({ type: 'DOOR_UNLOCKED', doorId: msg.doorId });
        if (room.p1 && room.p1.ws.readyState === WebSocket.OPEN) room.p1.ws.send(packet);
        if (room.p2 && room.p2.ws.readyState === WebSocket.OPEN) room.p2.ws.send(packet);
      } else if (msg.type === 'VICTORY') {
        room.cupClaimed = true;
        const packet = JSON.stringify({ type: 'VICTORY', winnerRole: assignedRole });
        if (room.p1 && room.p1.ws.readyState === WebSocket.OPEN) room.p1.ws.send(packet);
        if (room.p2 && room.p2.ws.readyState === WebSocket.OPEN) room.p2.ws.send(packet);
      }
    } catch (err) {
      console.error('Error parsing client message:', err);
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    console.log(`[-] Player ${assignedRole} (${playerId}) disconnected from room [${roomId}]`);
    if (assignedRole === 1 && room.p1?.id === playerId) {
      room.p1 = null;
    } else if (assignedRole === 2 && room.p2?.id === playerId) {
      room.p2 = null;
    }

    const opp = assignedRole === 1 ? room.p2 : room.p1;
    if (opp && opp.ws.readyState === WebSocket.OPEN) {
      opp.ws.send(JSON.stringify({
        type: 'OPPONENT_LEFT',
        role: assignedRole
      }));
    }

    // Clean up empty room after 30 seconds
    if (!room.p1 && !room.p2) {
      setTimeout(() => {
        if (!room.p1 && !room.p2) {
          rooms.delete(roomId);
          console.log(`[!] Cleaned up empty room [${roomId}]`);
        }
      }, 30000);
    }
  });

  ws.on('error', (err) => {
    console.error(`Socket error for player ${assignedRole}:`, err);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`===============================================`);
  console.log(` TheForest 2-Player Multiplayer Server Online! `);
  console.log(` Listening on ws://${HOST}:${PORT} `);
  console.log(` Health check at http://${HOST}:${PORT}/health `);
  console.log(`===============================================`);
});
