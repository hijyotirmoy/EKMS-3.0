import { doc, getDoc, setDoc, getDocs, collection, DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase";

interface SystemMetadata {
  qnaUpdatedAt?: number;
  facilitiesUpdatedAt?: number;
  filesUpdatedAt?: number;
  quizzesUpdatedAt?: number;
  onboardingUpdatedAt?: number;
  announcementsUpdatedAt?: number;
  usersUpdatedAt?: number;
  [key: string]: number | undefined;
}

// In-memory cache for metadata to prevent repeated metadata reads during a single browser session
let cachedMetadata: SystemMetadata | null = null;
let lastMetadataFetch = 0;
const METADATA_TTL = 5 * 60 * 1000; // 5 minutes in-memory TTL

/**
 * Fetch or get cached system metadata (1 single document read)
 */
export async function getSystemMetadata(force = false): Promise<SystemMetadata> {
  const now = Date.now();
  if (!force && cachedMetadata && now - lastMetadataFetch < METADATA_TTL) {
    return cachedMetadata;
  }

  try {
    const metaDocRef = doc(db, "system", "metadata");
    const metaSnap = await getDoc(metaDocRef);
    if (metaSnap.exists()) {
      cachedMetadata = metaSnap.data() as SystemMetadata;
    } else {
      // Initialize default metadata if not yet created
      cachedMetadata = {
        qnaUpdatedAt: 1,
        facilitiesUpdatedAt: 1,
        filesUpdatedAt: 1,
        quizzesUpdatedAt: 1,
        onboardingUpdatedAt: 1,
        announcementsUpdatedAt: 1,
        usersUpdatedAt: 1,
      };
      await setDoc(metaDocRef, cachedMetadata, { merge: true });
    }
    lastMetadataFetch = now;
    return cachedMetadata;
  } catch (e) {
    console.warn("System metadata fetch failed, using fallback cache:", e);
    return cachedMetadata || {};
  }
}

/**
 * Bump metadata timestamp when an admin creates, updates, or deletes records in a collection
 */
export async function touchMetadata(collectionKey: string): Promise<void> {
  try {
    const fieldKey = `${collectionKey}UpdatedAt`;
    const now = Date.now();
    const metaDocRef = doc(db, "system", "metadata");
    await setDoc(metaDocRef, { [fieldKey]: now }, { merge: true });

    if (cachedMetadata) {
      cachedMetadata[fieldKey] = now;
    }

    // Also invalidate local cache on current machine
    if (typeof window !== "undefined") {
      localStorage.removeItem(`ekms_cache_${collectionKey}`);
      localStorage.removeItem(`ekms_meta_${collectionKey}`);
      sessionStorage.removeItem(`ekms_cache_sidebar_${collectionKey}`);
      sessionStorage.removeItem(`ekms_cache_sidebar_${collectionKey}zes`);
      sessionStorage.removeItem(`ekms_cache_sidebar_${collectionKey}s`);
      sessionStorage.removeItem("ekms_cache_sidebar_quizzes");
      sessionStorage.removeItem("ekms_cache_sidebar_courses");
    }
  } catch (e) {
    console.error(`Failed to touch metadata for ${collectionKey}:`, e);
  }
}

/**
 * Smart fetch with browser localStorage caching.
 * Only makes Firestore network reads when data has been updated on the server.
 */
export async function getOrFetchCollection<T = any>(
  collectionName: string,
  options?: {
    metaKey?: string;
    forceRefresh?: boolean;
    transform?: (docData: DocumentData, docId: string) => T;
  }
): Promise<T[]> {
  const metaKey = options?.metaKey || collectionName;
  const storageKey = `ekms_cache_${collectionName}`;
  const metaStorageKey = `ekms_meta_${metaKey}`;

  // 1. Try reading from browser storage
  if (typeof window !== "undefined" && !options?.forceRefresh) {
    try {
      const cachedRaw = localStorage.getItem(storageKey);
      const localVersion = Number(localStorage.getItem(metaStorageKey) || 0);

      if (cachedRaw && localVersion > 0) {
        const serverMeta = await getSystemMetadata();
        const serverVersion = serverMeta[`${metaKey}UpdatedAt`] || 1;

        // If local version matches or exceeds server version, serve directly from cache! (0 reads!)
        if (localVersion >= serverVersion) {
          const parsed = JSON.parse(cachedRaw) as T[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      }
    } catch (e) {
      console.warn(`Local storage cache read failed for ${collectionName}:`, e);
    }
  }

  // 2. Cache miss or outdated: Fetch from Firestore (1 batch read)
  try {
    const snap = await getDocs(collection(db, collectionName));
    const items: T[] = [];
    snap.forEach((d) => {
      if (options?.transform) {
        items.push(options.transform(d.data(), d.id));
      } else {
        const dData = d.data();
        items.push({ id: d.id, email: dData.email || d.id, ...dData } as unknown as T);
      }
    });

    // 3. Save to browser storage for next visits
    if (typeof window !== "undefined") {
      try {
        const serverMeta = await getSystemMetadata();
        const serverVersion = serverMeta[`${metaKey}UpdatedAt`] || Date.now();
        localStorage.setItem(storageKey, JSON.stringify(items));
        localStorage.setItem(metaStorageKey, String(serverVersion));
      } catch (e) {
        console.warn(`Could not cache ${collectionName} to localStorage (quota exceeded or private mode):`, e);
      }
    }

    return items;
  } catch (e) {
    console.error(`Error fetching collection ${collectionName}:`, e);

    // Fallback: If network fails, try returning stale localStorage data if available
    if (typeof window !== "undefined") {
      try {
        const fallback = localStorage.getItem(storageKey);
        if (fallback) return JSON.parse(fallback);
      } catch {
        // ignore
      }
    }
    return [];
  }
}

/**
 * Manually invalidate local cache for a collection
 */
export function invalidateLocalCache(collectionName: string) {
  if (typeof window !== "undefined") {
    localStorage.removeItem(`ekms_cache_${collectionName}`);
    localStorage.removeItem(`ekms_meta_${collectionName}`);
  }
}
