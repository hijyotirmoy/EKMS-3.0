import { collection, doc, getDocs, getDoc, Query, DocumentReference } from "firebase/firestore";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const memoryCache = new Map<string, CacheEntry<any>>();

/**
 * Retrieves data from in-memory or sessionStorage cache if valid within TTL.
 */
export function getCachedData<T>(key: string, ttlMs: number): T | null {
  const now = Date.now();
  // 1. Memory Cache
  const memoryItem = memoryCache.get(key);
  if (memoryItem && now - memoryItem.timestamp < ttlMs) {
    return memoryItem.data;
  }

  // 2. SessionStorage Cache
  if (typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem(`ekms_cache_${key}`);
      if (raw) {
        const item: CacheEntry<T> = JSON.parse(raw);
        if (now - item.timestamp < ttlMs) {
          memoryCache.set(key, item);
          return item.data;
        }
      }
    } catch (e) {}
  }
  return null;
}

/**
 * Stores data in memory and sessionStorage cache.
 */
export function setCachedData<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = { data, timestamp: Date.now() };
  memoryCache.set(key, entry);
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(`ekms_cache_${key}`, JSON.stringify(entry));
    } catch (e) {}
  }
}

/**
 * Clears specific cache entry from memory and sessionStorage.
 */
export function clearCachedData(key: string): void {
  memoryCache.delete(key);
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(`ekms_cache_${key}`);
    } catch (e) {}
  }
}

/**
 * Clears all EKMS cache entries.
 */
export function clearAllEkmsCache(): void {
  memoryCache.clear();
  if (typeof window !== "undefined") {
    try {
      Object.keys(sessionStorage).forEach((k) => {
        if (k.startsWith("ekms_cache_")) {
          sessionStorage.removeItem(k);
        }
      });
    } catch (e) {}
  }
}
