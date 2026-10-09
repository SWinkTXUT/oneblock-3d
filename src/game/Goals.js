// Achievements / goals (SPEC §11).
export const GOALS = [
  { id: 'wood', name: 'Getting Wood', desc: 'Punch the One Block until it gives you a log.' },
  { id: 'table', name: 'Benchmarking', desc: 'Craft a Crafting Table.' },
  { id: 'wpick', name: 'Time to Mine', desc: 'Craft a Wooden Pickaxe.' },
  { id: 'spick', name: 'Upgrade', desc: 'Craft a Stone Pickaxe.' },
  { id: 'furnace', name: 'Hot Topic', desc: 'Craft a Furnace.' },
  { id: 'iron', name: 'Iron Age', desc: 'Obtain an Iron Ingot.' },
  { id: 'shear', name: 'Shear Delight', desc: 'Shear a sheep with Shears.' },
  { id: 'zombie', name: 'Monster Hunter', desc: 'Kill a Zombie.' },
  { id: 'bread', name: 'Bake Bread', desc: 'Craft Bread from wheat.' },
  { id: 'tree', name: 'Plant a Tree', desc: 'Grow a tree from a sapling.' },
  { id: 'armor', name: 'Suit Up', desc: 'Wear a piece of armor.' },
  { id: 'diamond', name: 'Diamonds!', desc: 'Obtain a Diamond.' },
  { id: 'sleep', name: 'Sweet Dreams', desc: 'Sleep in a bed.' },
  { id: 'phase4', name: 'Phase Walker', desc: 'Reach Phase 4: Sunlit Dunes.' },
  { id: 'cycle', name: 'Full Circle', desc: 'Complete the first full cycle.' },
];

export class Goals {
  constructor(game) { this.game = game; this.done = {}; this.pollT = 0; this.bind(); }

  bind() {
    const ev = this.game.events;
    ev.on('pickup', (k) => { if (k === 'oak_log' || k === 'spruce_log') this.award('wood'); });
    ev.on('craft', (k) => {
      if (k === 'crafting_table') this.award('table');
      else if (k === 'wooden_pickaxe') this.award('wpick');
      else if (k === 'stone_pickaxe') this.award('spick');
      else if (k === 'furnace') this.award('furnace');
      else if (k === 'bread') this.award('bread');
    });
    ev.on('kill', (k) => { if (k === 'zombie') this.award('zombie'); });
    ev.on('shear', () => this.award('shear'));
    ev.on('grow', () => this.award('tree'));
    ev.on('sleep', () => this.award('sleep'));
  }

  award(id) {
    if (this.done[id]) return;
    const g = GOALS.find((x) => x.id === id); if (!g) return;
    this.done[id] = true;
    this.game.ui.toast(g.name, g.desc);
    this.game.goalHintT = 10;
    this.game.sound.play('achievement');
  }

  /** inventory/state polling for "obtain"-style goals. */
  poll(dt) {
    this.pollT += dt; if (this.pollT < 0.5) return; this.pollT = 0;
    const g = this.game;
    const has = (k) => g.seats.some((s) => s.inv.count(k) > 0);
    if (!this.done.wood && (has('oak_log') || has('spruce_log'))) this.award('wood');
    if (!this.done.iron && has('iron_ingot')) this.award('iron');
    if (!this.done.diamond && has('diamond')) this.award('diamond');
    if (!this.done.armor && g.seats.some((s) => s.inv.armor.some(Boolean))) this.award('armor');
    if (!this.done.phase4 && (g.state.blocksBroken >= 400 || g.cycle > 1)) this.award('phase4');
    if (!this.done.cycle && g.cycle > 1) this.award('cycle');
  }

  /** First goal not yet done. */
  next() { return GOALS.find((x) => !this.done[x.id]) || null; }

  get count() { return GOALS.filter((x) => this.done[x.id]).length; }
  serialize() { return { ...this.done }; }
  deserialize(d) { this.done = { ...(d || {}) }; }
}
