/**
 * Seeded pseudo-random numbers.
 *
 * Every random decision in the solver comes from here, so the same roster with
 * the same settings and the same seed always produces the same arrangement.
 * That is what makes a result reproducible for a teacher who wants to show the
 * class "the computer really did shuffle it" twice.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, max). */
  int(max: number): number;
  /** Uniform element, or `undefined` for an empty list. */
  pick<T>(items: readonly T[]): T | undefined;
  /** Fisher–Yates copy. Never mutates the input. */
  shuffle<T>(items: readonly T[]): T[];
}

/** mulberry32 — small, fast and good enough for shuffling a classroom. */
export function createRng(seed: number): Rng {
  let state = (seed >>> 0) || 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (max: number): number => {
    if (max <= 0) return 0;
    return Math.floor(next() * max);
  };

  return {
    next,
    int,
    pick<T>(items: readonly T[]): T | undefined {
      if (items.length === 0) return undefined;
      return items[int(items.length)];
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = int(i + 1);
        const a = out[i] as T;
        const b = out[j] as T;
        out[i] = b;
        out[j] = a;
      }
      return out;
    },
  };
}

/** A fresh seed for "shuffle again". Shown to the teacher so it can be reused. */
export function randomSeed(): number {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return (buf[0] as number) >>> 0;
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/** Derives a child seed so each restart of a multi-start search differs. */
export function deriveSeed(seed: number, index: number): number {
  return (Math.imul(seed ^ 0x85ebca6b, 0xc2b2ae35) + index * 0x9e3779b9) >>> 0;
}
