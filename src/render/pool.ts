/**
 * Frame pool for sprites: `begin()` at the start of a frame, `next()` for every item drawn,
 * `end()` hides whatever was not used. Objects are created on demand and never destroyed, so a
 * steady scene allocates nothing per frame.
 */
export class FramePool<T> {
  private readonly items: T[] = [];
  private used = 0;

  constructor(
    private readonly create: () => T,
    private readonly show: (item: T, visible: boolean) => void,
  ) {}

  /** Starts a frame: every item becomes available again. */
  begin(): void {
    this.used = 0;
  }

  /** Next item for this frame (made visible). */
  next(): T {
    let item = this.items[this.used];
    if (item === undefined) {
      item = this.create();
      this.items.push(item);
    }
    this.used++;
    this.show(item, true);
    return item;
  }

  /** Ends a frame: hides the items not used this frame. */
  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.show(this.items[i] as T, false);
  }

  /** Items in use this frame. */
  get active(): number {
    return this.used;
  }

  /** Items ever created. */
  get size(): number {
    return this.items.length;
  }
}
