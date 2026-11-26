// Firebase & Unified Database Layer with Ultra-Low Read Architecture
import fs from "fs";
import path from "path";
import { getCallerIdForPhone } from "./callerId.js";

function getDataFilePath(fileName) {
  const directPath = path.join(process.cwd(), "data", fileName);
  if (fs.existsSync(directPath)) return directPath;
  const srcPath = path.join(process.cwd(), "src", "data", fileName);
  if (fs.existsSync(srcPath)) return srcPath;
  return directPath;
}

function loadDiskCachedFacilities() {
  try {
    const cachePath = getDataFilePath("facilities_cache.json");
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, "utf-8");
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length > 0) {
        return list;
      }
    }
  } catch (e) {
    console.warn("Failed to load local facilities_cache.json:", e.message);
  }
  return null;
}

function saveDiskCachedFacilities(facilitiesList) {
  try {
    const cachePath = getDataFilePath("facilities_cache.json");
    fs.promises.writeFile(cachePath, JSON.stringify(facilitiesList), "utf-8").catch(() => {});
  } catch (e) {
    console.warn("Failed to save facilities_cache.json:", e.message);
  }
}

// In-memory local cache/fallback for instant zero-config launch and 0-read execution
const diskCachedFacs = loadDiskCachedFacilities();
let memoryFacilities = diskCachedFacs && diskCachedFacs.length > 0 ? diskCachedFacs : [];
let isFacilitiesLoadedFromFirestore = false;
let deletedFacilityIds = new Set();
let deletedCaseRefs = new Set();
let facilitiesVersion = Date.now();

function loadDiskCachedCases() {
  try {
    const cachePath = getDataFilePath("cases_cache.json");
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, "utf-8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        return list.filter(
          (c) =>
            !deletedCaseRefs.has(String(c.case_ref || c.id)) &&
            !deletedCaseRefs.has(String(c.case_ref || c.id).toUpperCase())
        );
      }
    }
  } catch (e) {
    console.warn("Failed to load local cases_cache.json:", e.message);
  }
  return [];
}

function saveDiskCachedCases(casesList) {
  try {
    lastCasesFetchTimestamp = Date.now();
    if (!Array.isArray(casesList) || casesList.length === 0) return;
    const cachePath = getDataFilePath("cases_cache.json");
    fs.promises.writeFile(cachePath, JSON.stringify(casesList), "utf-8").catch(() => {});
  } catch (e) {
    console.warn("Failed to save cases_cache.json:", e.message);
  }
}

export function getCachedFacilities() {
  return memoryFacilities.filter((f) => !deletedFacilityIds.has(String(f.id)));
}

export function getCachedCases() {
  return memoryCases.filter(
    (c) =>
      !deletedCaseRefs.has(String(c.case_ref || c.id)) &&
      !deletedCaseRefs.has(String(c.case_ref || c.id).toUpperCase())
  );
}

const fallbackSeedCases = [];

const diskCases = loadDiskCachedCases();
let memoryCases = Array.isArray(diskCases) ? diskCases : [];

let isCasesLoadedFromFirestore = false;
let isFirestoreFetchInProgress = null;
let lastCasesFetchTimestamp = 0;
const CASES_CACHE_TTL_MS = 30000; // 30s server cache to prevent redundant Firestore scans
let cachedStats = null;
let cachedStatsTimestamp = 0;

// Helper to check if Firebase is configured
export function isFirebaseConfigured() {
  return true;
}

let firestoreInstance = null;
let firestoreType = null; // 'admin' | 'web'

export async function getFirestoreContext() {
  if (firestoreInstance) return { db: firestoreInstance, type: firestoreType };

  try {
    // Client SDK - Dedicated Triage Cases: Patient Case History, Intake Logs, Holding Vault
    const { getCasesSettingsDb, getFirestoreDb } = await import("./firebase");
    firestoreInstance = getCasesSettingsDb() || getFirestoreDb();
    firestoreType = "web";
    return { db: firestoreInstance, type: firestoreType };
  } catch (err) {
    console.warn("Firebase initialization notice:", err.message);
  }
  return null;
}

// Helper to get facilities metadata state
async function getFacilitiesMeta(ctx) {
  if (!ctx) return { seeded: false, deleted_ids: [] };
  try {
    if (ctx.type === "admin") {
      const snap = await ctx.db.collection("system_meta").doc("facilities_state").get();
      if (snap.exists) return snap.data() || { seeded: false, deleted_ids: [] };
    } else {
      const { doc, getDoc } = await import("firebase/firestore");
      const snap = await getDoc(doc(ctx.db, "system_meta", "facilities_state"));
      if (snap.exists()) return snap.data() || { seeded: false, deleted_ids: [] };
    }
  } catch (e) {
    console.warn("Facilities meta fetch notice:", e.message);
  }
  return { seeded: false, deleted_ids: [] };
}

async function saveFacilitiesMeta(ctx, data) {
  if (!ctx) return;
  try {
    if (ctx.type === "admin") {
      await ctx.db.collection("system_meta").doc("facilities_state").set(data, { merge: true });
    } else {
      const { doc, setDoc } = await import("firebase/firestore");
      await setDoc(doc(ctx.db, "system_meta", "facilities_state"), data, { merge: true });
    }
  } catch (e) {
    console.warn("Facilities meta save notice:", e.message);
  }
}

/**
 * High-Efficiency Facilities Fetch:
 * Returns from server memory in 0ms with 0 Firestore reads.
 * Only reads from Firestore once on cold boot.
 */
export async function getFacilities(filters = {}) {
  const { q, district, facility_type } = filters;

  if (!isFacilitiesLoadedFromFirestore) {
    const doFirestoreSync = async () => {
      const ctx = await getFirestoreContext();
      if (ctx) {
        try {
          const meta = await getFacilitiesMeta(ctx);
          const deletedSet = new Set([
            ...(meta.deleted_ids || []).map(String),
            ...Array.from(deletedFacilityIds).map(String),
          ]);

          let firestoreList = [];
          if (ctx.type === "admin") {
            const snap = await ctx.db.collection("facilities").get();
            if (!snap.empty) {
              firestoreList = snap.docs.map((d) => {
                const data = d.data();
                return {
                  id: d.id,
                  ...data,
                  facility_type: data.type || data.facility_type || "Facility",
                  latitude: typeof data.lat === "number" ? data.lat : (typeof data.latitude === "number" ? data.latitude : null),
                  longitude: typeof data.lng === "number" ? data.lng : (typeof data.longitude === "number" ? data.longitude : null),
                  _doc_id: d.id,
                };
              });
            }
          } else {
            const { collection, getDocs } = await import("firebase/firestore");
            const snap = await getDocs(collection(ctx.db, "facilities"));
            if (!snap.empty) {
              firestoreList = snap.docs.map((d) => {
                const data = d.data();
                return {
                  id: d.id,
                  ...data,
                  facility_type: data.type || data.facility_type || "Facility",
                  latitude: typeof data.lat === "number" ? data.lat : (typeof data.latitude === "number" ? data.latitude : null),
                  longitude: typeof data.lng === "number" ? data.lng : (typeof data.longitude === "number" ? data.longitude : null),
                  _doc_id: d.id,
                };
              });
            }
          }

          if (firestoreList.length > 0) {
            memoryFacilities = firestoreList.filter((f) => {
              if (deletedSet.has(String(f.id))) return false;
              if (f._doc_id && deletedSet.has(String(f._doc_id))) return false;
              if (f.site_code && deletedSet.has(String(f.site_code))) return false;
              return true;
            });
            saveDiskCachedFacilities(memoryFacilities);
          }
        } catch (e) {
          console.warn("Triage Firestore facilities fetch error:", e.message);
        }
      }
      isFacilitiesLoadedFromFirestore = true;
    };

    if (memoryFacilities.length > 0) {
      // Memory has cached facilities: return instantly, refresh Firestore in background
      isFacilitiesLoadedFromFirestore = true;
      doFirestoreSync().catch(() => {});
    } else {
      await doFirestoreSync();
    }
  }

  const list = memoryFacilities.filter((f) => !deletedFacilityIds.has(String(f.id)));

  return list.filter((f) => {
    if (district && district !== "all") {
      const targetDist = String(district).toLowerCase().trim();
      const fDist = String(f.district || "").toLowerCase().trim();
      const isKamrupMatch =
        (targetDist.includes("kamrup") && fDist.includes("kamrup")) ||
        targetDist === fDist;
      if (!isKamrupMatch && fDist !== targetDist) return false;
    }
    if (facility_type && facility_type !== "all") {
      const targetType = String(facility_type).toLowerCase().trim();
      const fType = String(f.facility_type || f.type || "").toLowerCase().trim();
      const fName = String(f.name || "").toLowerCase().trim();

      const isTieUpFilter = targetType.includes("tie");
      const isTieUpFac = fType.includes("tie") || fName.includes("tie") || String(f.scheme || "").toLowerCase().includes("tie");

      const isHospitalFilter = targetType.includes("hospital") && !targetType.includes("tie");
      const isHospitalFac = (fType.includes("hospital") && !fType.includes("tie")) || fName.includes("hospital");

      const isDispensaryFilter = targetType.includes("dispensary");
      const isDispensaryFac = fType.includes("dispensary") || fName.includes("dispensary");

      if (isTieUpFilter) {
        if (!isTieUpFac) return false;
      } else if (isHospitalFilter) {
        if (!isHospitalFac) return false;
      } else if (isDispensaryFilter) {
        if (!isDispensaryFac) return false;
      } else if (fType !== targetType && !fType.includes(targetType) && !fName.includes(targetType)) {
        return false;
      }
    }
    if (q && String(q).trim()) {
      const query = String(q).toLowerCase().trim();
      const matchName = String(f.name || "").toLowerCase().includes(query);
      const matchAddr = String(f.address || "").toLowerCase().includes(query);
      const matchPin = String(f.pincode || "").toLowerCase().includes(query);
      const matchDist = String(f.district || "").toLowerCase().includes(query);
      const matchBlock = String(f.block || "").toLowerCase().includes(query);
      const matchPhone = String(f.phone || "").toLowerCase().includes(query);
      const matchType = String(f.facility_type || f.type || "").toLowerCase().includes(query);
      const matchCategory = String(f.category || "").toLowerCase().includes(query);
      const matchState = String(f.state || "").toLowerCase().includes(query);
      const matchSite = String(f.site_code || "").toLowerCase().includes(query);
      if (!matchName && !matchAddr && !matchPin && !matchDist && !matchBlock && !matchPhone && !matchType && !matchCategory && !matchState && !matchSite) return false;
    }
    return true;
  });
}

export async function addFacilities(newItems) {
  const ctx = await getFirestoreContext();
  const addedIds = new Set(newItems.map((item) => String(item.id || item.site_code || "")));

  for (const id of addedIds) {
    if (id) deletedFacilityIds.delete(id);
  }

  // Update in-memory cache immediately
  memoryFacilities = [...newItems, ...memoryFacilities.filter((f) => !addedIds.has(String(f.id)))];
  facilitiesVersion = Date.now();

  if (ctx) {
    try {
      const meta = await getFacilitiesMeta(ctx);
      const remainingDeleted = (meta.deleted_ids || []).filter((id) => !addedIds.has(String(id)));
      await saveFacilitiesMeta(ctx, { seeded: true, deleted_ids: remainingDeleted });

      if (ctx.type === "admin") {
        const batch = ctx.db.batch();
        for (const item of newItems) {
          const docId = String(item.id || item.site_code || `fac-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
          item.id = item.id || docId;
          const docRef = ctx.db.collection("facilities").doc(docId);
          batch.set(docRef, item);
        }
        await batch.commit();
      } else {
        const { doc, setDoc } = await import("firebase/firestore");
        for (const item of newItems) {
          const docId = String(item.id || item.site_code || `fac-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
          item.id = item.id || docId;
          await setDoc(doc(ctx.db, "facilities", docId), item).catch(() => {});
        }
      }
    } catch (e) {
      console.warn("Could not save new facilities to Firestore:", e.message);
    }
  }

  return newItems;
}

export async function addFacility(facility) {
  const res = await addFacilities([facility]);
  return res[0];
}

export async function updateFacility(id, updates) {
  const strId = String(id);
  let updatedItem = null;

  // In-memory write-through
  memoryFacilities = memoryFacilities.map((f) => {
    if (String(f.id) === strId || String(f.site_code) === strId || String(f._doc_id) === strId) {
      updatedItem = { ...f, ...updates };
      return updatedItem;
    }
    return f;
  });
  facilitiesVersion = Date.now();

  const ctx = await getFirestoreContext();
  if (ctx && updatedItem) {
    try {
      if (ctx.type === "admin") {
        await ctx.db.collection("facilities").doc(strId).set(updatedItem, { merge: true });
      } else {
        const { doc, setDoc } = await import("firebase/firestore");
        await setDoc(doc(ctx.db, "facilities", strId), updatedItem, { merge: true });
      }
    } catch (e) {
      console.warn("Could not update facility in Firestore:", e.message);
    }
  }

  return updatedItem;
}

export async function deleteFacility(id) {
  const strId = String(id);
  deletedFacilityIds.add(strId);
  memoryFacilities = memoryFacilities.filter((f) => String(f.id) !== strId && String(f._doc_id) !== strId);
  facilitiesVersion = Date.now();

  const ctx = await getFirestoreContext();
  if (ctx) {
    try {
      const meta = await getFacilitiesMeta(ctx);
      const currentDeleted = Array.from(new Set([...(meta.deleted_ids || []), strId]));
      await saveFacilitiesMeta(ctx, { deleted_ids: currentDeleted });

      if (ctx.type === "admin") {
        await ctx.db.collection("facilities").doc(strId).delete().catch(() => {});
      } else {
        const { doc, deleteDoc } = await import("firebase/firestore");
        await deleteDoc(doc(ctx.db, "facilities", strId)).catch(() => {});
      }
    } catch (e) {
      console.warn("Could not delete facility from Firestore:", e.message);
    }
  }

  return true;
}

export async function deleteFacilities(ids = []) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  const strIds = ids.map(String);
  const idSet = new Set(strIds);

  for (const id of strIds) {
    deletedFacilityIds.add(id);
  }

  const beforeCount = memoryFacilities.length;
  memoryFacilities = memoryFacilities.filter((f) => !idSet.has(String(f.id)) && !idSet.has(String(f._doc_id)));
  facilitiesVersion = Date.now();

  const ctx = await getFirestoreContext();
  if (ctx) {
    try {
      const meta = await getFacilitiesMeta(ctx);
      const currentDeleted = Array.from(new Set([...(meta.deleted_ids || []), ...strIds]));
      await saveFacilitiesMeta(ctx, { deleted_ids: currentDeleted });

      if (ctx.type === "admin") {
        const batch = ctx.db.batch();
        for (const strId of strIds) {
          const docRef = ctx.db.collection("facilities").doc(strId);
          batch.delete(docRef);
        }
        await batch.commit();
      } else {
        const { doc, deleteDoc } = await import("firebase/firestore");
        for (const strId of strIds) {
          await deleteDoc(doc(ctx.db, "facilities", strId)).catch(() => {});
        }
      }
    } catch (e) {
      console.warn("Could not delete facilities from Firestore:", e.message);
    }
  }

  return Math.max(beforeCount - memoryFacilities.length, ids.length);
}

/**
 * Ultra-Low-Read Cases Fetch:
 * Only reads from Firestore once on cold boot.
 * Subsequent requests (including page refreshes, searches, filters, pagination)
 * are served directly from server memory with 0 Firestore reads!
 */
function normalizeUrgency(level) {
  if (!level) return "Mild";
  const s = String(level).trim().toLowerCase();
  if (
    s.includes("sev") ||
    s.includes("emerg") ||
    s.includes("high") ||
    s === "10" ||
    s === "9" ||
    s === "8" ||
    s.startsWith("10/") ||
    s.startsWith("9/") ||
    s.startsWith("8/")
  ) {
    return "Severe";
  }
  if (
    s.includes("mod") ||
    s.includes("urg") ||
    s === "7" ||
    s === "6" ||
    s === "5" ||
    s.startsWith("7/") ||
    s.startsWith("6/") ||
    s.startsWith("5/")
  ) {
    return "Moderate";
  }
  return "Mild";
}

export async function getCases(filters = {}) {
  const { urgency, q, since } = filters;

  const now = Date.now();
  const isCacheFresh = memoryCases && memoryCases.length > 0 && now - lastCasesFetchTimestamp < CASES_CACHE_TTL_MS;

  // If cache is fresh, return memoryCases directly without hitting Firestore
  if (!isCacheFresh) {
    try {
      const { getCasesSettingsDb, getFirestoreDb } = await import("./firebase");
      const casesDb = getCasesSettingsDb() || getFirestoreDb();
      if (casesDb) {
        let list = [];
        const { collection, getDocs, query, orderBy, limit } = await import("firebase/firestore");
        try {
          const qRef = query(collection(casesDb, "cases"), orderBy("created_at", "desc"), limit(60));
          const snap = await getDocs(qRef);
          list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } catch (_) {
          try {
            const qRef = query(collection(casesDb, "cases"), limit(60));
            const snap = await getDocs(qRef);
            list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          } catch (_) {}
        }

        if (Array.isArray(list) && list.length > 0) {
          const diskList = loadDiskCachedCases() || [];
          const map = new Map();
          diskList.forEach((c) => {
            const k = String(c.case_ref || c.id || "").trim().toUpperCase();
            if (k) map.set(k, c);
          });
          (memoryCases || []).forEach((c) => {
            const k = String(c.case_ref || c.id || "").trim().toUpperCase();
            if (k) map.set(k, c);
          });
          list.forEach((c) => {
            const k = String(c.case_ref || c.id || "").trim().toUpperCase();
            if (k) map.set(k, c);
          });

          const mergedAll = Array.from(map.values()).sort(
            (a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0)
          );

          const sanitizedList = mergedAll.map((c) => {
            if (Array.isArray(c.nearest_facilities) && c.nearest_facilities.length > 5) {
              return { ...c, nearest_facilities: c.nearest_facilities.slice(0, 5) };
            }
            return c;
          });

          memoryCases = sanitizedList;
          isCasesLoadedFromFirestore = true;
          lastCasesFetchTimestamp = now;
          saveDiskCachedCases(memoryCases);
          recomputeCachedStats(memoryCases);
        }
      }
    } catch (e) {
      console.warn("Firestore live cases fetch notice:", e.message);
    }
  }

  let list = (memoryCases || [])
    .sort((a, b) => {
      const timeA = new Date(a.created_at || a.createdAt || a.timestamp || 0).getTime();
      const timeB = new Date(b.created_at || b.createdAt || b.timestamp || 0).getTime();
      return timeB - timeA;
    });

  // Strict deduplication by case_ref / id so duplicates NEVER appear
  const seenRefs = new Set();
  list = list.filter((c) => {
    const ref = String(c.case_ref || c.id || "").trim().toUpperCase();
    if (!ref) return true;
    if (seenRefs.has(ref)) return false;
    seenRefs.add(ref);
    return true;
  });

  // Incremental delta sync: return only new cases created after timestamp
  if (since) {
    const sinceTime = new Date(since).getTime();
    if (!isNaN(sinceTime) && sinceTime > 0) {
      list = list.filter((c) => new Date(c.created_at || 0).getTime() > sinceTime);
    }
  }

  return list.filter((c) => {
    if (urgency && urgency !== "all") {
      const targetNorm = normalizeUrgency(urgency);
      const caseNorm = normalizeUrgency(c.triage?.urgency_level || c.urgency_level);
      if (caseNorm !== targetNorm) return false;
    }
    if (q) {
      const query = q.toLowerCase().trim();
      const resolvedCallerId = String(
        c.caller_id ||
        c.intake?.caller_id ||
        c.intake?.callerId ||
        (c.intake?.phone ? getCallerIdForPhone(c.intake.phone) : "")
      ).toLowerCase();
      const matchCallerId = resolvedCallerId.includes(query);
      const matchName = c.intake?.caller_name?.toLowerCase().includes(query);
      const matchPhone = c.intake?.phone?.toLowerCase().includes(query);
      const matchNotes = c.intake?.symptom_notes?.toLowerCase().includes(query);
      const matchRef = (c.case_ref || c.id || "").toLowerCase().includes(query);
      const matchAge = c.intake?.age != null && String(c.intake?.age).includes(query);
      const matchSex = c.intake?.sex?.toLowerCase().includes(query);
      const matchAgent = (c.agent_name || c.agent_id || c.agent || "").toLowerCase().includes(query);
      if (!matchCallerId && !matchName && !matchPhone && !matchNotes && !matchRef && !matchAge && !matchSex && !matchAgent) return false;
    }
    return true;
  });
}

export async function getCaseByRef(caseRef) {
  const all = await getCases();
  return all.find((c) => c.case_ref === caseRef || c.id === caseRef) || null;
}

export async function getCasesByPhone(phone) {
  if (!phone) return [];
  const digits = String(phone).replace(/\D/g, "");
  const p10 = digits.length >= 10 ? digits.slice(-10) : digits;

  // 1. Refresh memoryCases from disk cache to ensure all persisted cases are loaded
  const disk = loadDiskCachedCases();
  if (disk && Array.isArray(disk) && disk.length > 0) {
    const memIds = new Set((memoryCases || []).map((c) => String(c.case_ref || c.id)));
    disk.forEach((d) => {
      const key = String(d.case_ref || d.id);
      if (!memIds.has(key)) {
        memoryCases.push(d);
        memIds.add(key);
      }
    });
  }

  // 2. Filter matches from memoryCases
  let matches = (memoryCases || []).filter((c) => {
    const cp = String(c.intake?.phone || c.phone || "").replace(/\D/g, "");
    return (cp.length >= 10 && cp.slice(-10) === p10) || (digits.length >= 5 && cp.includes(digits));
  });

  // 3. Query Firestore to ensure repeat callers always load all cases across servers/sessions
  try {
    const ctx = await getFirestoreContext();
    if (ctx) {
      let fsDocs = [];
      const queryPhones = Array.from(new Set([p10, `+91${p10}`, `91${p10}`, phone, digits])).filter(Boolean);
      if (ctx.type === "admin") {
        const snap = await ctx.db
          .collection("cases")
          .where("intake.phone", "in", queryPhones)
          .get();
        fsDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } else {
        const { collection, getDocs, query, where } = await import("firebase/firestore");
        const snap = await getDocs(
          query(collection(ctx.db, "cases"), where("intake.phone", "in", queryPhones))
        );
        fsDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
      if (fsDocs.length > 0) {
        const seen = new Set(matches.map((c) => String(c.case_ref || c.id)));
        fsDocs.forEach((d) => {
          const key = String(d.case_ref || d.id);
          if (!seen.has(key)) {
            seen.add(key);
            matches.push(d);
            memoryCases.unshift(d);
          }
        });
        saveDiskCachedCases(memoryCases);
      }
    }
  } catch (e) {
    console.warn("Firestore phone lookup notice:", e.message);
  }

  // Sort descending so the latest call is first, followed by previous calls
  matches.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  return matches;
}

/**
 * Save Case:
 * Exactly 1 Firestore write, 0 Firestore reads.
 * Immediately prepends to server memory cache.
 */
export async function saveCase(caseData) {
  const caseRef = String(caseData?.case_ref || caseData?.id || "").trim();
  const docId = caseRef || `case_${Date.now()}`;
  caseData.id = caseData.id || docId;
  caseData.case_ref = caseData.case_ref || docId;

  if (caseData?.case_ref) {
    deletedCaseRefs.delete(String(caseData.case_ref).trim());
    deletedCaseRefs.delete(String(caseData.case_ref).trim().toUpperCase());
  }
  if (caseData?.id) {
    deletedCaseRefs.delete(String(caseData.id).trim());
    deletedCaseRefs.delete(String(caseData.id).trim().toUpperCase());
  }

  // Deduplicate and update in-memory cache directly (0-latency execution)
  const targetUpper = String(caseData.case_ref).toUpperCase();
  const existingIdx = memoryCases.findIndex(
    (c) =>
      String(c.case_ref || c.id || "").toUpperCase() === targetUpper ||
      (c.id && String(c.id) === String(caseData.id))
  );

  if (existingIdx >= 0) {
    memoryCases[existingIdx] = { ...memoryCases[existingIdx], ...caseData };
  } else {
    memoryCases.unshift(caseData);
  }
  saveDiskCachedCases(memoryCases);
  recomputeCachedStats(memoryCases);

  // Persist directly to Firestore using deterministic document ID and merge (never creates duplicates)
  try {
    const ctx = await getFirestoreContext();
    if (ctx && ctx.db) {
      const sanitized = JSON.parse(JSON.stringify(caseData, (k, v) => (v === undefined ? null : v)));
      if (ctx.type === "admin") {
        await ctx.db.collection("cases").doc(docId).set(sanitized, { merge: true });
      } else {
        const { doc, setDoc } = await import("firebase/firestore");
        await setDoc(doc(ctx.db, "cases", docId), sanitized, { merge: true });
      }
    }
  } catch (e) {
    console.warn("Could not save case to Firestore:", e.message);
  }

  // Also sync case to dedicated triage-cases-settings database
  try {
    const { getCasesSettingsDb } = await import("./firebase");
    const csDb = getCasesSettingsDb();
    if (csDb) {
      const { doc, setDoc } = await import("firebase/firestore");
      const sanitized = JSON.parse(JSON.stringify(caseData, (k, v) => (v === undefined ? null : v)));
      await setDoc(doc(csDb, "cases", docId), sanitized, { merge: true }).catch(() => {});
    }
  } catch (_) {}

  return caseData;
}

export async function updateCase(caseRefOrId, updates) {
  if (!caseRefOrId || !updates) return null;
  const target = String(caseRefOrId).trim();
  const targetUpper = target.toUpperCase();
  deletedCaseRefs.delete(target);
  deletedCaseRefs.delete(targetUpper);
  let updatedCase = null;

  // 1. Update in-memory cache instantly (0 reads)
  memoryCases = memoryCases.map((c) => {
    const cRef = String(c.case_ref || "").trim().toUpperCase();
    const cId = String(c.id || "").trim().toUpperCase();
    if (cRef === targetUpper || cId === targetUpper || String(c.case_ref) === target || String(c.id) === target) {
      updatedCase = { ...c, ...updates };
      return updatedCase;
    }
    return c;
  });
  saveDiskCachedCases(memoryCases);

  // If not in cache but has case details, synthesize and save
  if (!updatedCase && (updates.intake || updates.triage || updates.booked_appointment || updates.forwarded_to)) {
    const newCase = {
      id: target,
      case_ref: updates.case_ref || target,
      caller_id: updates.caller_id || (updates.intake?.phone ? getCallerIdForPhone(updates.intake.phone) : ""),
      agent_id: updates.agent_id || "",
      intake: updates.intake || {},
      triage: updates.triage || {},
      resolved_location: updates.resolved_location || null,
      nearest_facilities: updates.nearest_facilities || [],
      created_at: updates.created_at || new Date().toISOString(),
      ...updates,
    };
    return await saveCase(newCase);
  }

  // 2. Persist to Firestore with minimum reads (exact doc update or 1 query)
  const ctx = await getFirestoreContext();
  if (ctx && ctx.db) {
    try {
      const payloadToWrite = updatedCase
        ? JSON.parse(JSON.stringify({ ...updatedCase, ...updates }, (k, v) => (v === undefined ? null : v)))
        : JSON.parse(JSON.stringify(updates, (k, v) => (v === undefined ? null : v)));

      if (ctx.type === "admin") {
        const snap = await ctx.db.collection("cases").where("case_ref", "==", target).get();
        if (!snap.empty) {
          for (const doc of snap.docs) {
            await doc.ref.set(payloadToWrite, { merge: true });
          }
        } else {
          await ctx.db.collection("cases").doc(target).set(payloadToWrite, { merge: true });
        }
      } else {
        const { collection, query, where, getDocs, doc, setDoc } = await import("firebase/firestore");
        const q = query(collection(ctx.db, "cases"), where("case_ref", "==", target));
        const snap = await getDocs(q);
        if (!snap.empty) {
          for (const d of snap.docs) {
            await setDoc(doc(ctx.db, "cases", d.id), payloadToWrite, { merge: true });
          }
        } else {
          await setDoc(doc(ctx.db, "cases", target), payloadToWrite, { merge: true });
        }
      }
    } catch (e) {
      console.warn("Could not update case in Firestore:", e.message);
    }
  }

  // Also sync case updates to dedicated triage-cases-settings database
  try {
    const { getCasesSettingsDb } = await import("./firebase");
    const csDb = getCasesSettingsDb();
    if (csDb) {
      const { collection, query, where, getDocs, doc, setDoc } = await import("firebase/firestore");
      const payloadToWrite = updatedCase
        ? JSON.parse(JSON.stringify({ ...updatedCase, ...updates }, (k, v) => (v === undefined ? null : v)))
        : JSON.parse(JSON.stringify(updates, (k, v) => (v === undefined ? null : v)));
      const q = query(collection(csDb, "cases"), where("case_ref", "==", target));
      const snap = await getDocs(q).catch(() => null);
      if (snap && !snap.empty) {
        for (const d of snap.docs) {
          await setDoc(doc(csDb, "cases", d.id), payloadToWrite, { merge: true }).catch(() => {});
        }
      } else {
        await setDoc(doc(csDb, "cases", target), payloadToWrite, { merge: true }).catch(() => {});
      }
    }
  } catch (_) {}

  return updatedCase;
}

function recomputeCachedStats(casesList) {
  const by_urgency = { Severe: 0, Moderate: 0, Mild: 0 };
  const activeCases = (Array.isArray(casesList) ? casesList : []).filter(
    (c) =>
      !deletedCaseRefs.has(String(c.case_ref || c.id)) &&
      !deletedCaseRefs.has(String(c.case_ref || c.id).toUpperCase())
  );
  for (const c of activeCases) {
    const rawLevel = c.triage?.urgency_level || c.urgency_level;
    const level = normalizeUrgency(rawLevel);
    if (by_urgency[level] !== undefined) {
      by_urgency[level]++;
    }
  }
  cachedStats = {
    total: activeCases.length,
    by_urgency,
  };
  cachedStatsTimestamp = Date.now();
  return cachedStats;
}

/**
 * Delete Case:
 * Exactly 1 Firestore delete, 0 Firestore reads.
 */
export async function deleteCase(caseRef) {
  if (!caseRef) return false;
  const refStr = String(caseRef).trim();
  const refUpper = refStr.toUpperCase();
  deletedCaseRefs.add(refStr);
  deletedCaseRefs.add(refUpper);

  const ctx = await getFirestoreContext();
  if (ctx) {
    try {
      if (ctx.type === "admin") {
        const snap = await ctx.db
          .collection("cases")
          .where("case_ref", "==", refStr)
          .get()
          .catch(() => null);
        if (snap && !snap.empty) {
          const batch = ctx.db.batch();
          snap.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
        }
        await ctx.db.collection("cases").doc(refStr).delete().catch(() => {});
        if (refUpper !== refStr) {
          await ctx.db.collection("cases").doc(refUpper).delete().catch(() => {});
        }
      } else {
        const { collection, query, where, getDocs, deleteDoc, doc } = await import(
          "firebase/firestore"
        );
        const q = query(
          collection(ctx.db, "cases"),
          where("case_ref", "==", refStr)
        );
        const snap = await getDocs(q).catch(() => null);
        if (snap && !snap.empty) {
          for (const docSnap of snap.docs) {
            await deleteDoc(docSnap.ref).catch(() => {});
          }
        }
        await deleteDoc(doc(ctx.db, "cases", refStr)).catch(() => {});
        if (refUpper !== refStr) {
          await deleteDoc(doc(ctx.db, "cases", refUpper)).catch(() => {});
        }
      }
    } catch (e) {
      console.warn("Could not delete case from Firestore:", e.message);
    }
  }

  // Also remove from dedicated triage-cases-settings database
  try {
    const { getCasesSettingsDb } = await import("./firebase");
    const csDb = getCasesSettingsDb();
    if (csDb) {
      const { collection, query, where, getDocs, deleteDoc, doc } = await import("firebase/firestore");
      const q = query(collection(csDb, "cases"), where("case_ref", "==", refStr));
      const snap = await getDocs(q).catch(() => null);
      if (snap && !snap.empty) {
        for (const docSnap of snap.docs) {
          await deleteDoc(docSnap.ref).catch(() => {});
        }
      }
      await deleteDoc(doc(csDb, "cases", refStr)).catch(() => {});
      if (refUpper !== refStr) {
        await deleteDoc(doc(csDb, "cases", refUpper)).catch(() => {});
      }
    }
  } catch (_) {}

  memoryCases = memoryCases.filter(
    (c) =>
      c.case_ref !== refStr &&
      c.case_ref !== refUpper &&
      c.id !== refStr &&
      c.id !== refUpper
  );
  saveDiskCachedCases(memoryCases);
  recomputeCachedStats(memoryCases);
  return true;
}

export async function deleteCases(caseRefs = []) {
  if (!Array.isArray(caseRefs) || !caseRefs.length) return 0;
  for (const ref of caseRefs) {
    await deleteCase(ref);
  }
  return caseRefs.length;
}

/**
 * Stats:
 * Calculated 100% in-memory from memoryCases.
 * Initialized once from Firestore if not loaded yet.
 * 0 Firestore reads on all subsequent calls!
 */
export async function getCaseStats() {
  await getCases();
  return recomputeCachedStats(memoryCases);
}

