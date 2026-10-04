import { Game } from './game/Game.js';

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
