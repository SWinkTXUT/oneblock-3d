// A 16x16x16 chunk of block ids. Ids fit in a byte (blocks.js has < 256 entries).
export const CS = 16;
export const CS3 = CS * CS * CS;

export class Chunk {
  constructor(cx, cy, cz) {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.data = new Uint8Array(CS3);
    this.count = 0; // number of non-air blocks
  }
}

// index of local coords inside a chunk
export const lidx = (lx, ly, lz) => (ly * CS + lz) * CS + lx;
