import { getFirestoreDb, getBookingDb, getCasesSettingsDb, logsDb } from "@/lib/firebase";
import { doc, setDoc, deleteDoc, getDocs, collection, query, orderBy } from "firebase/firestore";
import { broadcastEvent } from "@/lib/broadcastSync";
import { unrecordDeletedCase } from "@/lib/activityLogger";
import { getCachedAppointments, setCachedAppointments } from "@/lib/clientCache";

export const RETENTION_PERIOD_DAYS = 7;
export const RETENTION_PERIOD_MS = RETENTION_PERIOD_DAYS * 24 * 60 * 60 * 1000;
const LOCAL_STORAGE_KEY = "ekms_recently_deleted";

/**
 * Format timestamp in IST
 */
export function formatISTTime(dateVal) {
  try {
    if (!dateVal) return "";
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch (_) {
    return String(dateVal);
  }
}

/**
 * Calculate remaining days/hours before 7-day expiration
 */
export function getExpiryRemainingText(expiresAt) {
  if (!expiresAt) return "Expires soon";
  const diffMs = Number(expiresAt) - Date.now();
  if (diffMs <= 0) return "Expired (ready for auto-purge)";
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days >= 1) {
    return `Expires in ${days} day${days > 1 ? "s" : ""}${hours > 0 ? ` ${hours}h` : ""}`;
  }
  return `Expires in ${hours} hour${hours > 1 ? "s" : ""}`;
}

/**
 * Check if item is expired (older than 7 days)
 */
export function isItemExpired(item) {
  if (!item) return true;
  if (item.expiresAt && Date.now() > Number(item.expiresAt)) return true;
  if (item.deletedTimestamp && Date.now() - Number(item.deletedTimestamp) > RETENTION_PERIOD_MS) return true;
  return false;
}

/**
 * Read local items from localStorage
 */
export function getLocalRecentlyDeleted() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    // Auto-filter expired items
    const valid = list.filter((item) => !isItemExpired(item));
    if (valid.length !== list.length) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(valid));
    }
    return valid;
  } catch (_) {
    return [];
  }
}

/**
 * Save local items to localStorage
 */
function setLocalRecentlyDeleted(list) {
  if (typeof window === "undefined") return;
  try {
    const valid = list.filter((item) => !isItemExpired(item));
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(valid));
  } catch (_) {}
}

/**
 * Archive an item (appointment, case, user, log) into Recently Deleted (7-day holding folder)
 */
export async function archiveToRecentlyDeleted({
  item,
  itemType = "appointment", // 'appointment' | 'case' | 'user' | 'log'
  deletedBy = "Administrator",
  deletedByEmail = "",
}) {
  if (!item) return null;

  const now = Date.now();
  const expiresAt = now + RETENTION_PERIOD_MS;
  const originalId = String(
    item.id ||
    item.tokenNo ||
    item.referenceNo ||
    item.case_ref ||
    item.caseRef ||
    item.email ||
    now
  ).trim();

  let title = "";
  let subtitle = "";

  if (itemType === "appointment") {
    title = `Appointment #${item.tokenNo || item.referenceNo || originalId} - ${item.patientName || item.name || "Patient"}`;
    subtitle = `${item.facilityName || item.dispensaryName || "ESIS Dispensary"} · Slot: ${item.date || ""} (${item.timeSlot || item.slot || ""})`;
  } else if (itemType === "case") {
    title = `Case #${item.case_ref || item.id || originalId} - ${item.intake?.caller_name || item.caller_name || "Beneficiary"}`;
    subtitle = `${item.triage?.primary_complaint || item.complaint || "Triage Consultation"} · Urgency: ${item.urgency || item.triage?.urgency_level || "Mild"}`;
  } else if (itemType === "user") {
    title = `User Account: ${item.name || item.displayName || "Staff"} (${item.email || originalId})`;
    subtitle = `Role: ${item.role || "Agent"} · Department: ${item.department || "Helpline"}`;
  } else if (itemType === "log") {
    title = `Activity Log #${originalId}`;
    subtitle = `${item.details || item.activity || "System Event"} · Action by: ${item.user || "Staff"}`;
  } else {
    title = `Record #${originalId}`;
    subtitle = `Type: ${itemType}`;
  }

  const cleanDocId = `${itemType}_${originalId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const archiveRecord = {
    id: cleanDocId,
    originalId,
    itemType,
    title,
    subtitle,
    deletedAt: new Date().toISOString(),
    deletedTimestamp: now,
    expiresAt,
    expiresInText: `${RETENTION_PERIOD_DAYS} days`,
    deletedBy: deletedBy || "Administrator",
    deletedByEmail: deletedByEmail || "",
    originalData: JSON.parse(JSON.stringify(item)),
  };

  // 1. Update localStorage
  const currentLocal = getLocalRecentlyDeleted();
  const updatedLocal = [archiveRecord, ...currentLocal.filter((x) => x.id !== cleanDocId)];
  setLocalRecentlyDeleted(updatedLocal);

  // 2. Persist to Firestore: triage-cases-settings database (primary for recently deleted)
  try {
    const csDb = getCasesSettingsDb();
    if (csDb) {
      await setDoc(doc(csDb, "recently_deleted", cleanDocId), archiveRecord, { merge: true });
    }
  } catch (csErr) {
    console.warn("archiveToRecentlyDeleted csDb notice:", csErr.message);
  }

  // Backup to main triageDb if csDb has permissions pending
  try {
    const tDb = getFirestoreDb();
    if (tDb) {
      await setDoc(doc(tDb, "recently_deleted", cleanDocId), archiveRecord, { merge: true });
    }
  } catch (_) {}

  // 3. Post to local server API backup
  try {
    fetch("/api/recently-deleted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive", record: archiveRecord }),
    }).catch(() => {});
  } catch (_) {}

  broadcastEvent("RECENTLY_DELETED_CHANGED", { action: "ARCHIVE", record: archiveRecord });
  return archiveRecord;
}

/**
 * Fetch all active Recently Deleted items across databases & local storage
 */
export async function getRecentlyDeletedList() {
  const map = new Map();

  // 1. From local storage
  const localList = getLocalRecentlyDeleted();
  localList.forEach((item) => {
    if (!isItemExpired(item)) map.set(item.id, item);
  });

  // 2. From server API / disk json
  try {
    const res = await fetch("/api/recently-deleted", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.items)) {
        data.items.forEach((item) => {
          if (!isItemExpired(item)) map.set(item.id, item);
        });
      }
    }
  } catch (_) {}

  // 3. From Firestore (triage-cases-settings, fallback triageDb)
  try {
    const csDb = getCasesSettingsDb() || getFirestoreDb();
    if (csDb) {
      const snap = await getDocs(collection(csDb, "recently_deleted"));
      snap.forEach((d) => {
        const item = d.data();
        if (isItemExpired(item)) {
          // Auto-purge expired item from database!
          deleteDoc(d.ref).catch(() => {});
        } else {
          map.set(d.id, { id: d.id, ...item });
        }
      });
    }
  } catch (e) {
    console.warn("getRecentlyDeletedList Firestore warning:", e.message);
  }

  const result = Array.from(map.values()).sort(
    (a, b) => Number(b.deletedTimestamp || 0) - Number(a.deletedTimestamp || 0)
  );
  setLocalRecentlyDeleted(result);
  return result;
}

/**
 * Restore an item from Recently Deleted back to its original database & position
 */
export async function restoreRecentlyDeletedItem(recordId, currentAgent = null) {
  if (!recordId) return { success: false, error: "Record ID required" };

  const currentList = await getRecentlyDeletedList();
  const target = currentList.find((r) => r.id === recordId || r.originalId === recordId);

  if (!target) {
    return { success: false, error: "Item not found in Recently Deleted" };
  }

  const { itemType, originalData, originalId } = target;

  try {
    if (itemType === "appointment") {
      const bDb = getBookingDb();
      const tDb = getFirestoreDb();
      const csDb = getCasesSettingsDb();
      const docId = String(originalId).replace(/[^a-zA-Z0-9_-]/g, "_");

      const restoredPayload = {
        ...originalData,
        status: originalData.status === "cancelled" ? "scheduled" : (originalData.status || "scheduled"),
        restoredAt: new Date().toISOString(),
        restoredBy: currentAgent?.name || currentAgent?.email || "Admin",
      };

      // 1. Restore into ekmsbooking Firestore
      if (bDb) {
        await setDoc(doc(bDb, "dispensary_appointments", docId), restoredPayload, { merge: true });
        if (originalData.tokenNo && originalData.tokenNo !== docId) {
          await setDoc(doc(bDb, "dispensary_appointments", originalData.tokenNo), restoredPayload, { merge: true });
        }
      }

      // 2. Restore into Triage primary Firestore
      if (tDb) {
        await setDoc(doc(tDb, "dispensary_appointments", docId), restoredPayload, { merge: true });
        if (originalData.tokenNo && originalData.tokenNo !== docId) {
          await setDoc(doc(tDb, "dispensary_appointments", originalData.tokenNo), restoredPayload, { merge: true });
        }
      }

      // 3. Restore into cases-settings Firestore
      if (csDb) {
        try {
          await setDoc(doc(csDb, "dispensary_appointments", docId), restoredPayload, { merge: true });
        } catch (_) {}
      }

      // 4. Update associated Case if any
      const caseRef = originalData.caseRef || originalData.case_ref;
      if (caseRef && tDb) {
        try {
          await setDoc(
            doc(tDb, "cases", caseRef),
            {
              status: "booked",
              booking_status: "booked",
              has_appointment: true,
              booked_appointment: restoredPayload,
            },
            { merge: true }
          );
        } catch (_) {}
      }

      // 5. Update local appointments cache
      const cached = getCachedAppointments();
      const updatedCache = [restoredPayload, ...cached.filter((a) => (a.id || a.tokenNo) !== docId)];
      setCachedAppointments(updatedCache);

      // Remove from browser deleted blacklist if present
      try {
        localStorage.removeItem("ekms_deleted_appointment");
      } catch (_) {}

      broadcastEvent("APPOINTMENT_RESTORED", { appointment: restoredPayload });
      broadcastEvent("APPOINTMENTS_UPDATED", { appointment: restoredPayload });
    } else if (itemType === "case") {
      const tDb = getFirestoreDb();
      const csDb = getCasesSettingsDb();
      const caseRef = target.originalId || originalData.case_ref || originalData.id;

      if (tDb && caseRef) {
        await setDoc(doc(tDb, "cases", caseRef), originalData, { merge: true });
      }
      if (csDb && caseRef) {
        try {
          await setDoc(doc(csDb, "cases", caseRef), originalData, { merge: true });
        } catch (_) {}
      }

      unrecordDeletedCase(caseRef);
      broadcastEvent("NEW_CASE", originalData);
      broadcastEvent("CASE_RESTORED", { case_ref: caseRef, case: originalData });
    } else if (itemType === "user") {
      const tDb = getFirestoreDb();
      const email = String(originalData.email || target.originalId).toLowerCase().trim();
      if (tDb && email) {
        await setDoc(doc(tDb, "users", email), originalData, { merge: true });
        await setDoc(doc(tDb, "team", email), originalData, { merge: true });
      }
      broadcastEvent("TEAM_UPDATED", { user: originalData });
    } else if (itemType === "log") {
      const tDb = getFirestoreDb();
      const csDb = getCasesSettingsDb();
      const logId = String(originalData.id || target.originalId).trim();
      if (logsDb && logId) {
        await setDoc(doc(logsDb, "userActivityLogs", logId), originalData, { merge: true });
      }
      if (tDb && logId) {
        await setDoc(doc(tDb, "system_logs", logId), originalData, { merge: true });
      }
      if (csDb && logId) {
        try {
          await setDoc(doc(csDb, "system_logs", logId), originalData, { merge: true });
        } catch (_) {}
      }
    }

    // Finally, remove from Recently Deleted
    await permanentlyDeleteRecentlyDeletedItem(recordId);

    broadcastEvent("RECENTLY_DELETED_CHANGED", { action: "RESTORE", recordId });
    return { success: true, item: target };
  } catch (err) {
    console.error("restoreRecentlyDeletedItem error:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Permanently purge an item from Recently Deleted
 */
export async function permanentlyDeleteRecentlyDeletedItem(recordId) {
  if (!recordId) return;

  // 1. Remove from localStorage
  const current = getLocalRecentlyDeleted();
  const next = current.filter((r) => r.id !== recordId && r.originalId !== recordId);
  setLocalRecentlyDeleted(next);

  // 2. Remove from Firestore triage-cases-settings & triageDb
  try {
    const csDb = getCasesSettingsDb();
    if (csDb) await deleteDoc(doc(csDb, "recently_deleted", recordId)).catch(() => {});
  } catch (_) {}
  try {
    const tDb = getFirestoreDb();
    if (tDb) await deleteDoc(doc(tDb, "recently_deleted", recordId)).catch(() => {});
  } catch (_) {}

  // 3. Remove from server API backup
  try {
    fetch("/api/recently-deleted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "permanent_delete", recordId }),
    }).catch(() => {});
  } catch (_) {}

  broadcastEvent("RECENTLY_DELETED_CHANGED", { action: "PERMANENT_DELETE", recordId });
}

/**
 * Empty the entire recycle bin
 */
export async function emptyAllRecentlyDeleted() {
  const current = await getRecentlyDeletedList();
  for (const item of current) {
    await permanentlyDeleteRecentlyDeletedItem(item.id);
  }
  setLocalRecentlyDeleted([]);
  broadcastEvent("RECENTLY_DELETED_CHANGED", { action: "EMPTY" });
}
