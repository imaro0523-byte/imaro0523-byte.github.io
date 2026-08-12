/**
 * Identifier generation.
 *
 * Student identity is always a UUID. Names are display data: two students in
 * one class can share a name, and matching on names would silently merge them.
 */

/**
 * RFC 4122 v4 UUID. Uses `crypto.randomUUID` where available, falls back to
 * `crypto.getRandomValues`, and finally to `Math.random` so that unit tests and
 * older browsers still work.
 */
export function uuid(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i += 1) hex.push((bytes[i] as number).toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

/** Short, human-readable id for seats, groups and desks. Not security relevant. */
export function shortId(prefix: string, counter: number): string {
  return `${prefix}-${counter}`;
}
