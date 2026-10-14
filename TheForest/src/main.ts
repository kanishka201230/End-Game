import { Engine } from './core/Engine';

const overlay = document.getElementById('overlay')!;
const loadingContainer = document.getElementById('loading-container')!;
const pauseMenu = document.getElementById('pause-menu')!;
const playDirectBtn = document.getElementById('play-direct') as HTMLButtonElement | null;
const resumeBtn = document.getElementById('resume-btn') as HTMLButtonElement | null;
const clickHint = document.getElementById('click-hint') as HTMLElement | null;
const loadFill = document.getElementById('loadfill') as HTMLElement | null;
const loadText = document.getElementById('loadtext') as HTMLElement | null;
const roleDisplay = document.getElementById('role-display') as HTMLElement | null;
const btnBackToExpo = document.getElementById('btn-back-to-expo') as HTMLAnchorElement | null;

async function boot(): Promise<void> {
  const engine = new Engine(document.getElementById('app')!);

  // Read URL query params passed from Expo_Game
  const urlParams = new URLSearchParams(window.location.search);
  const playerParam = urlParams.get('player') || urlParams.get('p');

  // Set Player 1 vs Player 2 directly from Expo_Game selection
  const isP2 = playerParam === '2';
  engine.setPlayer(isP2 ? 2 : 1);
  if (roleDisplay) {
    if (isP2) {
      roleDisplay.textContent = 'P2 · FOREST SURVIVOR';
      roleDisplay.className = 'role-badge p2';
    } else {
      roleDisplay.textContent = 'P1 · TACTICAL FIGHTER';
      roleDisplay.className = 'role-badge p1';
    }
  }

  if (btnBackToExpo) {
    btnBackToExpo.href = '/multiplayer.html';
  }

  let isReady = false;

  // Build engine assets
  await engine.build((fraction, label) => {
    if (loadFill) loadFill.style.width = `${Math.round(fraction * 100)}%`;
    if (loadText) loadText.textContent = label;
  });

  isReady = true;
  if (loadFill) loadFill.style.width = '100%';
  if (loadText) loadText.textContent = 'Arena Ready!';
  if (playDirectBtn) playDirectBtn.style.display = 'inline-block';
  if (clickHint) clickHint.style.display = 'block';

  const canvas = engine.renderer.domElement;

  // Direct game entrance function
  const enterGame = () => {
    if (!isReady) return;
    try {
      engine.startAudio();
      canvas.requestPointerLock();
      overlay.classList.add('hidden');
      document.body.classList.add('playing');
      engine.setPlaying(true);
    } catch (e) {
      console.warn('Pointer lock request error:', e);
    }
  };

  // Attempt auto-enter immediately
  enterGame();

  // Also enter on any click on the overlay or keypress
  overlay.addEventListener('click', () => {
    enterGame();
  });
  window.addEventListener('click', () => {
    if (isReady) enterGame();
  });
  window.addEventListener('keydown', () => {
    if (isReady) enterGame();
  });

  if (playDirectBtn) {
    playDirectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      enterGame();
    });
  }

  // Handle Pause Menu on Escape / Pointer Lock changes
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    engine.setPlaying(locked);
    overlay.classList.toggle('hidden', locked);
    document.body.classList.toggle('playing', locked);

    if (!locked) {
      // Game paused
      loadingContainer.style.display = 'none';
      pauseMenu.style.display = 'flex';
    } else {
      // Game running
      pauseMenu.style.display = 'none';
    }
  });

  // Resume button inside pause menu
  resumeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    enterGame();
  });

  engine.start();

  // Debug hook
  (window as unknown as { __engine: Engine }).__engine = engine;
}

boot().catch((err) => {
  if (loadText) loadText.textContent = 'Error loading game. Please check browser console.';
  console.error(err);
});
