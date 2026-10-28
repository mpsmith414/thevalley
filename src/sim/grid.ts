/** Finds the animals near a point without checking them all: a grid of cells, emptied and refilled every tick. */
export class SpatialGrid {
  private cells = new Map<number, number[]>();
  private ids: string[] = [];
  private xs: number[] = [];
  private zs: number[] = [];

  constructor(private cell = 32) {}

  private key(cx: number, cz: number) {
    return cx * 73856093 + cz * 19349663;
  }
  clear(): void {
    this.cells.forEach((c) => (c.length = 0));
    this.ids.length = this.xs.length = this.zs.length = 0;
  }
  insert(id: string, x: number, z: number): void {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = []));
    c.push(this.ids.length);
    this.ids.push(id);
    this.xs.push(x);
    this.zs.push(z);
  }
  /** The ids within `r` metres of the point, into `out` (emptied first) if given. */
  near(x: number, z: number, r: number, out: string[] = []): string[] {
    out.length = 0;
    const r2 = r * r;
    const x0 = Math.floor((x - r) / this.cell), x1 = Math.floor((x + r) / this.cell);
    const z0 = Math.floor((z - r) / this.cell), z1 = Math.floor((z + r) / this.cell);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const c = this.cells.get(this.key(cx, cz));
        if (c) for (const i of c) if ((this.xs[i] - x) ** 2 + (this.zs[i] - z) ** 2 <= r2) out.push(this.ids[i]);
      }
    return out;
  }
}
