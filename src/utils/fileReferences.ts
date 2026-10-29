import firebaseConfig from '../../firebase-applet-config.json';

export const FILE_CONTENT_ROUTE = '/api/files/content';
export const FILE_BUCKET = firebaseConfig.storageBucket;

export function isFamilyFilePath(value: unknown): value is string {
  return typeof value === 'string' && new TextEncoder().encode(value).length <= 1024
    && /^families\/[A-Za-z0-9_-]{1,128}\/.+/.test(value)
    && !/[\\\u0000-\u001f\u007f]/.test(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

export function fileContentUrl(path: string): string {
  if (!isFamilyFilePath(path)) throw new Error('That file does not belong to a valid space path.');
  return `${FILE_CONTENT_ROUTE}?path=${encodeURIComponent(path)}`;
}

/** Resolve references belonging to THIS app's bucket only. Unrelated web,
 * data and blob URLs remain ordinary external/local resources. */
export function filePathFromReference(value: string, bucket = FILE_BUCKET): string | null {
  try {
    if (value.startsWith(`${FILE_CONTENT_ROUTE}?`)) {
      const url = new URL(value, 'https://teluva.invalid');
      if (url.pathname !== FILE_CONTENT_ROUTE || url.hash || url.searchParams.getAll('path').length !== 1
        || [...url.searchParams.keys()].some(key => key !== 'path')) return null;
      const path = url.searchParams.get('path');
      return isFamilyFilePath(path) ? path : null;
    }
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.username || url.password) return null;
    const match = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
    if (!match || decodeURIComponent(match[1]) !== bucket) return null;
    const path = decodeURIComponent(match[2]);
    return isFamilyFilePath(path) ? path : null;
  } catch { return null; }
}

export function normalizeFileReference(value: string): string {
  const path = filePathFromReference(value);
  return path ? fileContentUrl(path) : value;
}

export function isDurableFileReference(value: string): boolean {
  return /^https?:\/\//i.test(value) || filePathFromReference(value) !== null;
}

/** Stable, persistable references instead of token URLs or transient blobs.
 * Preserve Dates, Firestore Timestamps and every other non-plain object. */
export function normalizeFileReferences<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') return normalizeFileReference(item);
    if (!item || typeof item !== 'object') return item;
    if (seen.has(item)) return seen.get(item);
    if (Array.isArray(item)) {
      const result: unknown[] = [];
      seen.set(item, result);
      item.forEach(entry => result.push(walk(entry)));
      return result;
    }
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) return item;
    const result: Record<string, unknown> = Object.create(prototype);
    seen.set(item, result);
    for (const [key, entry] of Object.entries(item)) Object.defineProperty(result, key, {
      value: walk(entry), enumerable: true, writable: true, configurable: true,
    });
    return result;
  };
  return walk(value) as T;
}

export function collectFilePaths(value: unknown): string[] {
  const paths = new Set<string>(), seen = new WeakSet<object>();
  const walk = (entry: unknown) => {
    if (typeof entry === 'string') {
      const path = isFamilyFilePath(entry) ? entry : filePathFromReference(entry);
      if (path) paths.add(path);
    } else if (entry && typeof entry === 'object' && !seen.has(entry)) {
      seen.add(entry);
      if (Array.isArray(entry)) entry.forEach(walk);
      else if (Object.getPrototypeOf(entry) === Object.prototype || Object.getPrototypeOf(entry) === null) Object.values(entry).forEach(walk);
    }
  };
  walk(value);
  return [...paths];
}

/** Admin profile grants follow an actual new file association, never a
 * cosmetic URL migration or an unrelated save of an existing profile. */
export function newProfileFileBindings(
  members: readonly { id: string }[], baseline: (memberId: string) => unknown, spaceId: string,
): { path: string; memberId: string }[] {
  return members.flatMap(member => {
    const previous = new Set(collectFilePaths(baseline(member.id)));
    return collectFilePaths(member).filter(path => path.startsWith(`families/${spaceId}/`) && !previous.has(path))
      .map(path => ({ path, memberId: member.id }));
  });
}
