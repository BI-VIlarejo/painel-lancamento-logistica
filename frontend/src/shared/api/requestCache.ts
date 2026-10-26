type CacheEntry = {
  expiresAt: number;
  promise: Promise<unknown>;
};

const cache = new Map<string, CacheEntry>();
const defaultTtlMs = 30_000;

export function cachedRequest<T>(key: string, request: () => Promise<T>, ttlMs = defaultTtlMs): Promise<T> {
  const now = Date.now();
  const current = cache.get(key);
  if (current && (current.expiresAt === 0 || current.expiresAt > now)) {
    return current.promise as Promise<T>;
  }

  const entry: CacheEntry = { expiresAt: 0, promise: Promise.resolve() };
  entry.promise = Promise.resolve()
    .then(request)
    .then((value) => {
      if (cache.get(key) === entry) entry.expiresAt = Date.now() + ttlMs;
      return value;
    })
    .catch((error: unknown) => {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    });
  cache.set(key, entry);
  return entry.promise as Promise<T>;
}

export function clearRequestCache(): void {
  cache.clear();
}
