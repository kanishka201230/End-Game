import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const processes = [];

function run(name, command, args, cwd, colorCode, extraEnv = {}, silent = false) {
  const child = spawn(command, args, {
    cwd: path.resolve(__dirname, cwd),
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, ...extraEnv }
  });

  const prefix = `\x1b[${colorCode}m[${name}]\x1b[0m`;

  child.stdout.on('data', (chunk) => {
    if (silent) return;
    const lines = chunk.toString().trimEnd().split('\n');
    lines.forEach((line) => {
      console.log(`${prefix} ${line}`);
    });
  });

  child.stderr.on('data', (chunk) => {
    if (silent) return;
    const lines = chunk.toString().trimEnd().split('\n');
    lines.forEach((line) => {
      console.error(`${prefix} ${line}`);
    });
  });

  processes.push(child);
  return child;
}

console.log('\x1b[35m=========================================================\x1b[0m');
console.log('\x1b[1m\x1b[36m   The Last Door: Unified Game (Expo_Game + TheForest)\x1b[0m');
console.log('\x1b[35m=========================================================\x1b[0m');

// 1. Start Multiplayer WebSocket Server (port 3001) in background
run('Multiplayer-Server', 'node', ['server/multiplayer-server.cjs'], 'TheForest', '35');

// 2. Continuous watch-build of TheForest into Expo_Game/public/forest (silent background sync)
run('TheForest-Sync', 'npm', ['run', 'build', '--', '--watch'], 'TheForest', '36', {}, true);

// 3. Start Single Unified Website (port 5173)
run('Website', 'npm', ['run', 'dev'], 'Expo_Game', '32', { LASTDOOR_MANAGED: 'true' });

console.log('\n\x1b[32m✔ Both folders permanently connected into ONE unified link!\x1b[0m');
console.log('\x1b[1m\x1b[33m👉 Open Website at: \x1b[4mhttp://localhost:5173\x1b[0m\n');

function shutdown() {
  console.log('\nStopping all services...');
  processes.forEach((p) => {
    try {
      p.kill();
    } catch (_) {}
  });
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
