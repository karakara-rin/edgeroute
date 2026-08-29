/**
 * Fast 32-bit FNV-1a non-cryptographic hashing algorithm for string identifiers and feature hashing.
 */
export function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash;
}

/**
 * Fast 32-bit FNV-1a hex string hash for deterministic cache entry keys.
 */
export function fastHexHash(str: string): string {
  return (fnv1a32(str) >>> 0).toString(16).padStart(8, '0');
}
