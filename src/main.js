import { Game } from './game/Game.js';
import { currentPlatform } from './platform.js';

const platform = currentPlatform();
const root = document.documentElement;
root.style.setProperty('--ui-scale', String(platform.uiScale));
root.style.setProperty('--safe', String(platform.safeArea));
if (platform.safeArea) root.style.setProperty('--safe-pad', `${platform.safeArea * 100}%`);

if (platform.key === 'ipad') { // no page zoom / scroll / bounce on iPad Safari
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
  // only the game surface is non-scrollable; lists (recipe book, goals, menus, sliders) scroll by finger
  document.addEventListener('touchmove', (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('.booklist, .goallist, .menu, input[type=range]')) return;
    e.preventDefault();
  }, { passive: false });
}
if (platform.key === 'xbox') { // B / Back must never leave the page; the controller is not a mouse
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'BrowserBack' || e.code === 'GamepadB') e.preventDefault(); }, true);
}

const container = document.getElementById('app');
const boot = document.getElementById('boot');
try {
  const game = new Game(container);
  window.__game = game; // handy for debugging / automated verification
  game.boot();
  boot.remove();
} catch (err) {
  console.error(err);
  boot.textContent = 'Failed to start: ' + (err && err.message ? err.message : err);
  boot.classList.add('error');
}
