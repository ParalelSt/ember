/** A fixed size list that drops its oldest item when full. Used for every
 *  perf record list, so memory stays the same however long the app runs. */
export class Ring<T> {
  private items: T[] = [];
  private next = 0;

  constructor(readonly capacity: number) {}

  push(item: T): void {
    if (this.items.length < this.capacity) {
      this.items.push(item);
      return;
    }
    this.items[this.next] = item;
    this.next = (this.next + 1) % this.capacity;
  }

  /** Oldest first. A copy, so the caller may keep it. */
  toArray(): T[] {
    if (this.items.length < this.capacity) return this.items.slice();
    return [...this.items.slice(this.next), ...this.items.slice(0, this.next)];
  }

  /** Newest item, or undefined when empty. */
  last(): T | undefined {
    if (this.items.length === 0) return undefined;
    if (this.items.length < this.capacity) return this.items[this.items.length - 1];
    return this.items[(this.next + this.capacity - 1) % this.capacity];
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
    this.next = 0;
  }
}
