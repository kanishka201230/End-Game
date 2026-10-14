# End-Game

## The Last Door (Expo_Game + TheForest Unified)

This project permanently connects both game modules into a **single unified website**:
1. **Cinematic Intro & Multiplayer Chamber Lobby** (`Expo_Game`)
2. **TheForest 3D Arena Trial** (`TheForest`)

Everything runs on **ONE single link**: **`http://localhost:5173`**!

---

## 🚀 How to Run the Project

Run the unified game with a single command from the project root:

```bash
npm run dev
```

This boots the entire game under one single link:
- **Unified Game Website:** `http://localhost:5173`
- **Multiplayer WebSocket Server:** `ws://localhost:3001` (runs invisibly in the background)

---

## 🎮 Connected Flow

1. **Cinematic Intro (`Expo_Game`)**:
   - Navigate to `http://localhost:5173`.
   - The opening sequence plays. You can wait for it to finish or click **"Skip Intro ⏩"**.
   - Click the start button to enter the **Multiplayer Chamber Menu** (`multiplayer.html`).

2. **Create Team / Game**:
   - Click **"Create Game"**.
   - You can click **"Create & Go Inside The Forest"** or **"Generate Room Code"** (e.g., `TLD-4821`).
   - Share this code with your challenger.
   - Click **"Go Inside The Forest (Host / P1)"** to immediately enter the 3D world as Player 1 (Tactical Fighter).
   - Or wait in the lobby: when an attacker challenges you, click **"Join & Enter Forest"** and both players are teleported inside!

3. **Join Team / Game**:
   - Player 2 clicks **"Join Existing Game"**.
   - Enter the host's Room Code (e.g., `TLD-4821`).
   - Click **"Join Game"** or **"Enter The Forest directly as Player 2"**.
   - You are teleported directly into `TheForest` as Player 2 (Forest Survivor).

4. **Inside `TheForest`**:
   - Both players spawn in the 3D forest arena inside the same room.
   - The in-game HUD displays the active room code, player roles, and opponent status.
   - Solve gates, defeat obstacles, run on stone paths, and claim the victory cup!
   - You can click **"← VOLVER AL MENÚ (EXPO GAME)"** in the setup overlay at any time to return to `Expo_Game`.
