// Tiny procedural pixel icons for the HUD (data URLs, drawn once).
const cache = {};
function draw(key, w, h, rows, palette, tint) {
  if (cache[key]) return cache[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x]; if (!ch || ch === '.') continue;
      const col = tint ? tint(ch, x, y, palette) : palette[ch];
      if (!col) continue;
      ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
    }
  });
  return (cache[key] = c.toDataURL());
}

const HEART = ['.XXX.XXX.', 'XWWRXRRRX', 'XWRRRRRRX', 'XRRRRRRRX', '.XRRRRRX.', '..XRRRX..', '...XRX...', '....X....'];
export function heartIcon(kind) { // 'full' | 'half' | 'empty'
  return draw('heart_' + kind, 9, 8, HEART, { X: '#2a0709', W: '#ff9aa0', R: '#e6212b' }, (ch, x) => {
    if (ch === 'X') return '#2a0709';
    const full = kind === 'full' || (kind === 'half' && x < 5);
    if (!full) return ch === 'W' ? '#4a3036' : '#3a2428';
    return ch === 'W' ? '#ff9aa0' : '#e6212b';
  });
}
const FOOD = ['.....XXX.', '....XBBBX', '...XBBHBX', '..XBBBBBX', '.XBBBBBX.', 'XXBBBBX..', 'XWXBBX...', '.XWXX....', '..XX.....'];
export function foodIcon(kind) {
  return draw('food_' + kind, 9, 9, FOOD, {}, (ch, x, y) => {
    if (ch === 'X') return '#2b1608';
    if (ch === 'W') return kind === 'empty' ? '#4a4040' : '#f2eadb';
    const full = kind === 'full' || (kind === 'half' && x < 5);
    if (!full) return '#3e2c1e';
    return ch === 'H' ? '#e6a05a' : '#b8662a';
  });
}
const ARMOR = ['.XX...XX.', 'XWWXXXWWX', 'XWWWWWWWX', 'XWWWWWWWX', '.XWWWWWX.', '.XWWWWWX.', '.XWWWWWX.', '..XXXXX..'];
export function armorIcon(kind) {
  return draw('armor_' + kind, 9, 8, ARMOR, {}, (ch, x) => {
    if (ch === 'X') return '#1c2330';
    const full = kind === 'full' || (kind === 'half' && x < 5);
    return full ? (x < 4 ? '#e4ecf5' : '#aab6c6') : '#394352';
  });
}
const SUN = ['..X.X.X..', '...YYY...', 'X.YYYYY.X', '..YYYYY..', 'X.YYYYY.X', '...YYY...', '..X.X.X..'];
export function sunIcon() { return draw('sun', 9, 7, SUN, { X: '#ffd34e', Y: '#ffb22e' }); }
const MOON = ['...MMM...', '..MM.....', '.MM......', '.MM......', '.MM......', '..MM..M..', '...MMM...'];
export function moonIcon() { return draw('moon', 9, 7, MOON, { M: '#cfd8ff' }); }
const CUP = ['.YYYYYYY.', 'YYWYYYYYY', 'YYWYYYYYY', '.YYYYYYY.', '..YYYYY..', '...YYY...', '...YYY...', '..YYYYY..'];
export function trophyIcon() { return draw('trophy', 9, 8, CUP, { Y: '#ffc933', W: '#fff2a8' }); }
const FLAME = ['....X....', '...XX....', '...XXX...', '..XXYX...', '.XXXYYX..', '.XXYYYX..', '.XXYYYX..', '..XXYXX..', '...XXX...'];
export function flameIcon(on) { return draw('flame_' + on, 9, 9, FLAME, {}, (ch) => (on ? (ch === 'X' ? '#ff6a1a' : '#ffd24a') : (ch === 'X' ? '#3a3a3a' : '#2a2a2a'))); }
const ARROW = ['.....X...', '.....XX..', 'XXXXXXXX.', 'XXXXXXXXX', 'XXXXXXXX.', '.....XX..', '.....X...'];
export function arrowIcon(on) { return draw('arrow_' + on, 9, 7, ARROW, {}, () => (on ? '#f3f3f3' : '#4a4a4a')); }
