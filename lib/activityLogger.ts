import { doc, setDoc, updateDoc, deleteDoc, arrayUnion, increment, collection } from "firebase/firestore";
import { db, logsDb } from "@/lib/firebase";

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface ActivityEvent {
  time: number;
  desc: string;
  type?:
    | "auth"
    | "doubt"
    | "report"
    | "quiz"
    | "course"
    | "booking"
    | "download"
    | "delete"
    | "search"
    | "add"
    | "edit"
    | "feedback"
    | "facility"
    | "settings"
    | "profile"
    | "general";
  color?: "blue" | "emerald" | "rose" | "amber" | "purple" | "teal" | "slate" | "indigo";
  icon?: string;
}

export interface SystemLogDoc {
  id: string;
  email: string;
  userName: string;
  desc: string;
  type: ActivityEvent["type"];
  color: ActivityEvent["color"];
  icon: string;
  timestamp: number;
  date: string;
  extraData?: Record<string, any>;
}

// In-memory deduplication cache to prevent duplicate activity logging (e.g. React Strict Mode or duplicate triggers)
const recentLogMap = new Map<string, number>();

export async function logUserActivity(
  email: string | null | undefined,
  event: {
    desc: string;
    type?: ActivityEvent["type"];
    color?: ActivityEvent["color"];
    icon?: string;
    extraData?: Record<string, any>;
  }
) {
  if (!email) return;
  const cleanEmail = email.toLowerCase().trim();
  const today = getTodayDateString();
  const docId = `${cleanEmail}_${today}`;
  const now = Date.now();

  // Deduplication check: ignore identical event for the same user within 4 seconds
  const dedupeKey = `${cleanEmail}:${event.desc.trim()}`;
  const lastLogged = recentLogMap.get(dedupeKey);
  if (lastLogged && (now - lastLogged) < 4000) {
    return;
  }
  recentLogMap.set(dedupeKey, now);
  if (recentLogMap.size > 200) {
    // Purge old keys
    recentLogMap.forEach((v, k) => {
      if (now - v > 10000) recentLogMap.delete(k);
    });
  }

  const colorMap: Record<string, ActivityEvent["color"]> = {
    auth: "blue",
    add: "emerald",
    edit: "blue",
    delete: "rose",
    report: "rose",
    feedback: "purple",
    doubt: "amber",
    quiz: "purple",
    course: "emerald",
    booking: "teal",
    facility: "amber",
    download: "teal",
    search: "slate",
    settings: "slate",
    profile: "indigo",
    general: "blue",
  };

  const payloadEvent: ActivityEvent = {
    time: now,
    desc: event.desc,
    type: event.type || "general",
    color: event.color || colorMap[event.type || "general"] || "blue",
    icon: event.icon || (event.type === "delete" ? "Trash2" : event.type === "add" ? "PlusCircle" : event.type === "edit" ? "Edit" : "Activity"),
  };

  // 1. Write to daily_activity in logsDb (primary logs database)
  const updateDailyActivityInDb = async (firestoreInstance: any) => {
    try {
      const activityDocRef = doc(firestoreInstance, "daily_activity", docId);
      await updateDoc(activityDocRef, {
        lastActive: now,
        timelineEvents: arrayUnion(payloadEvent),
        ...(event.type === "download" ? { filesDownloaded: increment(1) } : {}),
        ...(event.type === "quiz" ? { quizzesCompletedCount: increment(1) } : {}),
        ...(event.extraData || {}),
      });
    } catch (err) {
      try {
        const activityDocRef = doc(firestoreInstance, "daily_activity", docId);
        await setDoc(
          activityDocRef,
          {
            email: cleanEmail,
            date: today,
            loginTime: now,
            firstLogin: now,
            lastActive: now,
            timelineEvents: [payloadEvent],
            ...(event.type === "download" ? { filesDownloaded: 1 } : {}),
            ...(event.type === "quiz" ? { quizzesCompletedCount: 1 } : {}),
            ...(event.extraData || {}),
          },
          { merge: true }
        );
      } catch (e) {
        console.error("Daily activity write error:", e);
      }
    }
  };

  await updateDailyActivityInDb(logsDb);

  // 2. Write individual log doc into userActivityLogs collection in logsDb (for System Logs tab)
  try {
    const sysLogRef = doc(collection(logsDb, "userActivityLogs"));
    const userName = cleanEmail.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    await setDoc(sysLogRef, {
      id: sysLogRef.id,
      email: cleanEmail,
      userName,
      desc: event.desc,
      type: payloadEvent.type,
      color: payloadEvent.color,
      icon: payloadEvent.icon,
      timestamp: now,
      date: today,
      extraData: event.extraData || {},
    });
  } catch (e) {
    console.warn("Write to userActivityLogs notice:", e);
  }

  // Update last active in users collection (Throttled to once every 10 mins per session to save writes)
  const lastUserDocWriteKey = `last_user_write_${cleanEmail}`;
  const lastWriteTime = (globalThis as any)[lastUserDocWriteKey] || 0;
  if (now - lastWriteTime > 10 * 60 * 1000) {
    (globalThis as any)[lastUserDocWriteKey] = now;
    try {
      const userDocRef = doc(db, "users", cleanEmail);
      await setDoc(userDocRef, { lastActive: now, isOnline: true }, { merge: true });
    } catch {}
  }
}


// =========================================================================
// Triage & Call Center Agent Formatting & Activity Extensions
// =========================================================================

const KNOWN_AGENT_MAP: Record<string, string> = {
  ESIC001T: "Ekmsoffice",
  ESIC001: "Ekmsoffice",
  ESIC002T: "Agent",
  ESIC007T: "Esha Doley",
  ESIC008T: "Himangshu Bezbaruah",
  ESIC009T: "Joysmita Tete",
  ESIC010T: "Jyotirmoy Choudhury",
  ESIC011T: "Kaushik Das",
  ESIC012T: "Mohsin Ansari",
  ESIC013T: "Munmi Boruah",
  ESIC014T: "Neha Thakur",
};

export function formatTriageAgentId(id: any): string {
  if (!id) return "ESIC001T";
  const str = String(id).trim();
  if (/^ESIC\d+[A-Z]$/i.test(str)) {
    return str.slice(0, -1).toUpperCase() + "T";
  }
  if (/^ESIC\d+$/i.test(str)) {
    return str.toUpperCase() + "T";
  }
  return str;
}

export function formatAgentDisplayName(rawName?: any, rawEmail?: any, rawId?: any): string {
  if (rawName && typeof rawName === "string" && rawName.trim()) {
    const cleaned = rawName.split("(")[0].replace(/<.*?>/, "").trim();
    if (cleaned && cleaned.toLowerCase() !== "agent" && cleaned.toLowerCase() !== "staff") {
      return cleaned;
    }
  }

  const candidate = rawEmail || rawId || rawName;
  if (!candidate) return "Agent";

  let str = String(candidate).trim();
  if (str.includes("@")) {
    str = str.split("@")[0];
  }

  const cleanId = String(rawId || "").toUpperCase().trim();
  if (cleanId && KNOWN_AGENT_MAP[cleanId]) return KNOWN_AGENT_MAP[cleanId];
  const candidateUpper = str.toUpperCase();
  if (KNOWN_AGENT_MAP[candidateUpper]) return KNOWN_AGENT_MAP[candidateUpper];

  const parts = str.split(/[._\-\s]+/).filter(Boolean);
  if (parts.length > 0) {
    return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function unrecordDeletedCase(caseRef: any): void {
  if (!caseRef || typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem("ekms_deleted_case_refs");
    if (!raw) return;
    const set = new Set(JSON.parse(raw));
    const s = String(caseRef).trim();
    set.delete(s);
    set.delete(s.toLowerCase());
    set.delete(s.toUpperCase());
    localStorage.setItem("ekms_deleted_case_refs", JSON.stringify(Array.from(set)));
  } catch (e) {}
}

export function recordDeletedCase(caseRef: any): void {
  if (!caseRef || typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem("ekms_deleted_case_refs");
    const set = raw ? new Set(JSON.parse(raw)) : new Set();
    set.add(String(caseRef).toLowerCase().trim());
    localStorage.setItem("ekms_deleted_case_refs", JSON.stringify(Array.from(set)));
  } catch (e) {}
}

export function isCaseDeleted(caseRef: any): boolean {
  if (!caseRef || typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem("ekms_deleted_case_refs");
    if (!raw) return false;
    const set = new Set(JSON.parse(raw));
    const s = String(caseRef).toLowerCase().trim();
    return set.has(s);
  } catch (e) {
    return false;
  }
}

export function getDeletedCaseRefs(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("ekms_deleted_case_refs");
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function removeActivityByCaseId(caseId: any): void {
  // Graceful no-op or local cleanup for deleted case activity
}

export async function logSystemActivity(params: {
  user?: any;
  type?: string;
  details?: string;
  caseId?: string | null;
  bookingId?: string | null;
  ip?: string;
}): Promise<void> {
  const email = params.user?.email || "system@ekms.in";
  const userName = formatAgentDisplayName(params.user?.name, email, params.user?.agentId);
  try {
    await logUserActivity(email, {
      desc: params.details || `Activity [${params.type || "TRIAGE"}] logged by ${userName}.`,
      type: "general",
      color: "emerald",
    });
  } catch (e) {}
}

const DELETED_LOGS_KEY = "ekms_deleted_audit_log_ids";
const STORAGE_LOGS_KEY = "ekms_cached_sys_logs_v1";

// Delete an individual audit log
export async function deleteSystemAuditLog(logId: string): Promise<void> {
  if (!logId) return;
  const strId = String(logId);
  try {
    if (typeof window !== "undefined") {
      const rawDeleted = localStorage.getItem(DELETED_LOGS_KEY);
      const delSet = rawDeleted ? new Set(JSON.parse(rawDeleted)) : new Set();
      delSet.add(strId);
      localStorage.setItem(DELETED_LOGS_KEY, JSON.stringify(Array.from(delSet)));

      const rawLogs = localStorage.getItem(STORAGE_LOGS_KEY);
      if (rawLogs) {
        try {
          const list = JSON.parse(rawLogs);
          if (Array.isArray(list)) {
            const filtered = list.filter((l) => String(l.id) !== strId);
            localStorage.setItem(STORAGE_LOGS_KEY, JSON.stringify(filtered));
          }
        } catch (_) {}
      }
      window.dispatchEvent(new CustomEvent("ekms_system_log_deleted", { detail: { logId: strId } }));
    }

    try {
      await deleteDoc(doc(logsDb, "userActivityLogs", strId));
    } catch (_) {}
  } catch (e) {
    console.warn("deleteSystemAuditLog error:", e);
  }
}

// Bulk delete audit logs
export async function deleteBulkSystemAuditLogs(logIds: string[] = []): Promise<void> {
  if (!Array.isArray(logIds) || !logIds.length) return;
  const idSet = new Set(logIds.map(String));

  try {
    if (typeof window !== "undefined") {
      const rawDeleted = localStorage.getItem(DELETED_LOGS_KEY);
      const delSet = rawDeleted ? new Set(JSON.parse(rawDeleted)) : new Set();
      idSet.forEach((id) => delSet.add(id));
      localStorage.setItem(DELETED_LOGS_KEY, JSON.stringify(Array.from(delSet)));

      const rawLogs = localStorage.getItem(STORAGE_LOGS_KEY);
      if (rawLogs) {
        try {
          const list = JSON.parse(rawLogs);
          if (Array.isArray(list)) {
            const filtered = list.filter((l) => !idSet.has(String(l.id)));
            localStorage.setItem(STORAGE_LOGS_KEY, JSON.stringify(filtered));
          }
        } catch (_) {}
      }
      window.dispatchEvent(new CustomEvent("ekms_system_log_deleted", { detail: { logIds } }));
    }

    // Delete in logsDb
    await Promise.allSettled(
      logIds.map((id) => deleteDoc(doc(logsDb, "userActivityLogs", String(id))))
    );
  } catch (e) {
    console.warn("deleteBulkSystemAuditLogs error:", e);
  }
}

// Clear all system audit logs
export async function clearAllSystemAuditLogs(currentLogIds: string[] = []): Promise<void> {
  try {
    if (typeof window !== "undefined") {
      const rawDeleted = localStorage.getItem(DELETED_LOGS_KEY);
      const delSet = rawDeleted ? new Set(JSON.parse(rawDeleted)) : new Set();
      currentLogIds.forEach((id) => delSet.add(String(id)));
      localStorage.setItem(DELETED_LOGS_KEY, JSON.stringify(Array.from(delSet)));
      localStorage.setItem(STORAGE_LOGS_KEY, JSON.stringify([]));
      window.dispatchEvent(new Event("ekms_system_log_deleted"));
    }

    await Promise.allSettled(
      currentLogIds.map((id) => deleteDoc(doc(logsDb, "userActivityLogs", String(id))))
    );
  } catch (e) {
    console.warn("clearAllSystemAuditLogs error:", e);
  }
}
