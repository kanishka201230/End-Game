import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import http from 'http'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function forestRouterAndServices() {
  return {
    name: 'forest-router-and-services',
    configureServer(server) {
      // 1. Rewrite /forest or /forest/ requests to /forest/index.html with query parameters preserved
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const urlObj = new URL(req.url, 'http://localhost');
        if (urlObj.pathname === '/forest' || urlObj.pathname === '/forest/') {
          req.url = '/forest/index.html' + urlObj.search;
        }
        next();
      });

      // 2. If dev.mjs is already orchestrating all services, skip auto-spawn
      if (process.env.LASTDOOR_MANAGED === 'true') {
        return;
      }

      // 3. Start multiplayer server (port 3001) in background if not running
      const reqMp = http.get('http://127.0.0.1:3001/health', () => {});
      reqMp.on('error', () => {
        console.log('\x1b[35m[Multiplayer-Server]\x1b[0m Starting background WebSocket Server on port 3001...');
        const s = spawn('node', ['server/multiplayer-server.cjs'], {
          cwd: path.resolve(__dirname, '../TheForest'),
          stdio: 'inherit',
          shell: true
        });
        process.on('exit', () => { try { s.kill(); } catch (_) {} });
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), forestRouterAndServices()],
  server: {
    host: '0.0.0.0',
    port: 5173
  }
});
