import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function copyToExpo() {
  return {
    name: 'copy-to-expo',
    closeBundle() {
      const srcDir = path.resolve(__dirname, 'dist');
      const destDir = path.resolve(__dirname, '../Expo_Game/public/forest');
      function copyDir(src, dest) {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          const s = path.join(src, entry.name);
          const d = path.join(dest, entry.name);
          if (entry.isDirectory()) copyDir(s, d);
          else fs.copyFileSync(s, d);
        }
      }
      try {
        if (fs.existsSync(srcDir)) {
          copyDir(srcDir, destDir);
          console.log('\x1b[32m✔ Synchronized TheForest into Expo_Game/public/forest\x1b[0m');
        }
      } catch (err) {
        console.error('Error synchronizing to Expo_Game:', err);
      }
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [copyToExpo()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200
  }
});
