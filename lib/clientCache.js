// Client-Side High-Performance Browser Storage & Cache Manager
// Eliminates duplicate downloads, enables instant 0ms page loads, and avoids redundant Firestore reads

import fallbackFacilities from "@/data/facilities_cache.json";

const CACHE_KEYS = {
  CASES: "ekms_cache_cases_v3",
  CASES_META: "ekms_cache_cases_meta_v3",
  FACILITIES: "ekms_cache_facilities_v2",
  FACILITIES_META: "ekms_cache_facilities_meta_v2",
  STATS: "ekms_cache_stats_v3",
};

// Automatic one-time cleanup of legacy cached cases and stale appointments
if (typeof window !== "undefined") {
  try {
    if (localStorage.getItem("ekms_cache_cases_v2") || localStorage.getItem("ekms_cache_stats_v2")) {
      localStorage.removeItem("ekms_cache_cases_v2");
      localStorage.removeItem("ekms_cache_cases_meta_v2");
      localStorage.removeItem("ekms_cache_stats_v2");
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith("ekms_appt_") || k.startsWith("ekms_forwarded_") || k.startsWith("ekms_deleted_case_")) {
          localStorage.removeItem(k);
        }
      });
      Object.keys(sessionStorage).forEach((k) => {
        if (k.startsWith("ekms_appt_") || k.startsWith("ekms_forwarded_") || k.startsWith("ekms_deleted_case_")) {
          sessionStorage.removeItem(k);
        }
      });
    }
  } catch (e) {}
}

export function getCachedCases() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CACHE_KEYS.CASES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export function setCachedCases(cases) {
  if (typeof window === "undefined" || !Array.isArray(cases)) return;
  try {
    localStorage.setItem(CACHE_KEYS.CASES, JSON.stringify(cases));
    localStorage.setItem(
      CACHE_KEYS.CASES_META,
      JSON.stringify({
        updated_at: Date.now(),
        count: cases.length,
        latest_created_at: cases[0]?.created_at || null,
      })
    );
  } catch (e) {
    console.warn("Could not save cases to localStorage:", e);
  }
}

export function appendCaseToLocalCache(newCase) {
  if (typeof window === "undefined" || !newCase) return;
  try {
    const cases = getCachedCases();
    const newRef = String(newCase.case_ref || "").trim().toUpperCase();
    const newId = String(newCase.id || "").trim().toUpperCase();
    const filtered = cases.filter((c) => {
      const cRef = String(c.case_ref || "").trim().toUpperCase();
      const cId = String(c.id || "").trim().toUpperCase();
      if (newRef && cRef === newRef) return false;
      if (newId && cId === newId) return false;
      return true;
    });
    filtered.unshift(newCase);
    setCachedCases(filtered);
  } catch (e) {}
}

export function removeCaseFromLocalCache(caseRefOrId) {
  if (typeof window === "undefined" || !caseRefOrId) return;
  try {
    const cases = getCachedCases();
    const target = String(caseRefOrId).trim().toUpperCase();
    const filtered = cases.filter((c) => {
      const cRef = String(c.case_ref || "").trim().toUpperCase();
      const cId = String(c.id || "").trim().toUpperCase();
      return cRef !== target && cId !== target;
    });
    setCachedCases(filtered);
  } catch (e) {}
}

export function updateCaseInLocalCache(caseRefOrId, updates) {
  if (typeof window === "undefined" || !caseRefOrId || !updates) return;
  try {
    const cases = getCachedCases();
    const target = String(caseRefOrId).trim().toUpperCase();
    let matchedRef = target;
    const updated = cases.map((c) => {
      const cRef = String(c.case_ref || "").trim().toUpperCase();
      const cId = String(c.id || "").trim().toUpperCase();
      if (cRef === target || cId === target) {
        if (c.case_ref) matchedRef = String(c.case_ref);
        return { ...c, ...updates };
      }
      return c;
    });
    setCachedCases(updated);
    if (updates.is_forwarded) {
      localStorage.setItem(`ekms_forwarded_${target}`, JSON.stringify(updates));
      localStorage.setItem(`ekms_forwarded_${caseRefOrId}`, JSON.stringify(updates));
      if (matchedRef && matchedRef !== target) {
        localStorage.setItem(`ekms_forwarded_${matchedRef}`, JSON.stringify(updates));
        localStorage.setItem(`ekms_forwarded_${matchedRef.toUpperCase()}`, JSON.stringify(updates));
      }
    }
  } catch (e) {}
}

export function getCachedFacilities() {
  if (typeof window === "undefined") return fallbackFacilities || [];
  try {
    const raw = localStorage.getItem(CACHE_KEYS.FACILITIES);
    if (!raw) return fallbackFacilities || [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : (fallbackFacilities || []);
  } catch (e) {
    return fallbackFacilities || [];
  }
}

export function setCachedFacilities(facilities) {
  if (typeof window === "undefined" || !Array.isArray(facilities)) return;
  try {
    localStorage.setItem(CACHE_KEYS.FACILITIES, JSON.stringify(facilities));
    localStorage.setItem(
      CACHE_KEYS.FACILITIES_META,
      JSON.stringify({
        updated_at: Date.now(),
        count: facilities.length,
      })
    );
  } catch (e) {
    console.warn("Could not save facilities to localStorage:", e);
  }
}

export function getCachedStats() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEYS.STATS);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function setCachedStats(stats) {
  if (typeof window === "undefined" || !stats) return;
  try {
    localStorage.setItem(CACHE_KEYS.STATS, JSON.stringify(stats));
  } catch (e) {}
}

export function getCachedMeta() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("ekms_cache_app_meta_v2");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function setCachedMeta(meta) {
  if (typeof window === "undefined" || !meta) return;
  try {
    localStorage.setItem("ekms_cache_app_meta_v2", JSON.stringify(meta));
  } catch (e) {}
}

// ================= CRM BENEFICIARIES & CALL HISTORY CACHE =================
export function getCachedCrmBeneficiaries() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("crm_beneficiaries_registry");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export function setCachedCrmBeneficiaries(list) {
  if (typeof window === "undefined" || !Array.isArray(list)) return;
  try {
    localStorage.setItem("crm_beneficiaries_registry", JSON.stringify(list));
    localStorage.setItem("crm_beneficiaries_synced_at", String(Date.now()));
  } catch (e) {}
}

export function isCrmBeneficiariesCacheFresh(maxAgeMs = 15 * 60 * 1000) {
  if (typeof window === "undefined") return false;
  try {
    const syncedAt = Number(localStorage.getItem("crm_beneficiaries_synced_at") || 0);
    return syncedAt > 0 && Date.now() - syncedAt < maxAgeMs;
  } catch (e) {
    return false;
  }
}

export function getCachedCrmCallHistory(identifier) {
  if (typeof window === "undefined" || !identifier) return null;
  try {
    const raw = localStorage.getItem(`crm_call_history_${identifier}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    if (!identifier.startsWith("phone_")) {
      return parsed.filter((item) => !item.beneficiaryId || String(item.beneficiaryId) === String(identifier));
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

export function setCachedCrmCallHistory(identifier, history) {
  if (typeof window === "undefined" || !identifier || !Array.isArray(history)) return;
  try {
    let clean = history;
    if (!identifier.startsWith("phone_")) {
      clean = history.filter((item) => !item.beneficiaryId || String(item.beneficiaryId) === String(identifier));
    }
    // Deduplicate: filter out 00:00 placeholder if a real call exists nearby
    const deduped = [];
    for (const item of clean) {
      const isPlaceholder = item.duration === "00:00" || item.duration === "0" || (item.notes && item.notes.includes("Beneficiary form opened"));
      if (isPlaceholder) {
        const itemTime = item.createdAt ? new Date(item.createdAt).getTime() : 0;
        const hasReal = clean.some((other) => {
          if (other.id === item.id) return false;
          const otherTime = other.createdAt ? new Date(other.createdAt).getTime() : 0;
          const isReal = other.duration && other.duration !== "00:00" && other.duration !== "0";
          return isReal && Math.abs(itemTime - otherTime) < 5 * 60 * 1000;
        });
        if (hasReal) continue;
      }
      deduped.push(item);
    }
    localStorage.setItem(`crm_call_history_${identifier}`, JSON.stringify(deduped));
    localStorage.setItem(`crm_call_history_synced_${identifier}`, String(Date.now()));
  } catch (e) {}
}

export function appendCrmCallLog(callLog) {
  if (typeof window === "undefined" || !callLog) return;
  try {
    const raw = localStorage.getItem("crm_all_call_logs") || "[]";
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];
    const targetBen = String(callLog.beneficiaryId || callLog.cleanPhone || "");
    const nowTime = callLog.createdAt ? new Date(callLog.createdAt).getTime() : Date.now();
    const updated = [
      callLog,
      ...list.filter((c) => {
        if (!c || c.id === callLog.id) return false;
        const cBen = String(c.beneficiaryId || c.cleanPhone || "");
        if (targetBen && cBen === targetBen) {
          const cTime = c.createdAt ? new Date(c.createdAt).getTime() : 0;
          const isPlaceholder = c.duration === "00:00" || c.duration === "0" || (c.notes && c.notes.includes("Beneficiary form opened"));
          if (isPlaceholder && Math.abs(nowTime - cTime) < 5 * 60 * 1000) {
            return false;
          }
        }
        return true;
      }),
    ];
    localStorage.setItem("crm_all_call_logs", JSON.stringify(updated));
  } catch (e) {}
}

// ================= AI CHAT & CLINICAL STATE CACHE =================
const CRM_CHAT_TTL_MS = 3 * 60 * 1000; // 3 minutes local storage TTL when leaving chat in between

export function getCachedAiChatSession(key = "ekms_main_ai_chat_session") {
  if (typeof window === "undefined") return null;
  try {
    if (key === "ekms_main_ai_chat_session") {
      // Main home chat is strictly session-scoped and never persists across page navigation or tabs
      localStorage.removeItem(key);
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.data || parsed;
    }
    let raw = sessionStorage.getItem(key);
    if (!raw) raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "cachedAt" in parsed && "data" in parsed) {
      const ttl = parsed.ttlMs || (key.startsWith("crm_triage_chat_") ? CRM_CHAT_TTL_MS : null);
      if (ttl && Date.now() - parsed.cachedAt > ttl) {
        // Expired after 3 min! Delete from local storage without touching database
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
        return null;
      }
      return parsed.data;
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

export function setCachedAiChatSession(data, key = "ekms_main_ai_chat_session", ttlMs = null) {
  if (typeof window === "undefined" || !data) return;
  try {
    const defaultTtl = key.startsWith("crm_triage_chat_") ? CRM_CHAT_TTL_MS : null;
    const payload = {
      data,
      cachedAt: Date.now(),
      ttlMs: ttlMs !== null ? ttlMs : defaultTtl,
    };
    sessionStorage.setItem(key, JSON.stringify(payload));
    if (key !== "ekms_main_ai_chat_session") {
      localStorage.setItem(key, JSON.stringify(payload));
    } else {
      localStorage.removeItem(key);
    }
  } catch (e) {}
}

export function clearCachedAiChatSession(key = "ekms_main_ai_chat_session") {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  } catch (e) {}
}

// ================= APPOINTMENTS & DOCTORS MEMORY / LOCAL CACHE =================
// Fast 0ms memory cache to eliminate redundant Firebase read/write overhead
let inMemoryAppointments = null;
let inMemoryDoctors = null;
let inMemoryAvailability = null;

const APPOINTMENTS_CACHE_KEY = "ekms_cache_appointments_v3";
const DOCTORS_CACHE_KEY = "ekms_cache_dispensary_doctors_v3";
const AVAILABILITY_CACHE_KEY = "ekms_cache_doctor_avail_v3";

export function getCachedAppointments() {
  if (inMemoryAppointments && Array.isArray(inMemoryAppointments)) {
    return inMemoryAppointments;
  }
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(APPOINTMENTS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      inMemoryAppointments = parsed;
      return parsed;
    }
    return [];
  } catch (e) {
    return [];
  }
}

export function setCachedAppointments(list) {
  if (!Array.isArray(list)) return;
  inMemoryAppointments = list;
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(APPOINTMENTS_CACHE_KEY, JSON.stringify(list));
    localStorage.setItem(`${APPOINTMENTS_CACHE_KEY}_synced_at`, String(Date.now()));
  } catch (e) {}
}

export function updateAppointmentInCache(tokenOrId, updates) {
  if (!tokenOrId || !updates) return;
  const target = String(tokenOrId).trim().toLowerCase();
  const current = getCachedAppointments();
  const updated = current.map((item) => {
    const matchToken = String(item.tokenNo || "").trim().toLowerCase() === target;
    const matchRef = String(item.referenceNo || "").trim().toLowerCase() === target;
    const matchId = String(item.id || "").trim().toLowerCase() === target;
    if (matchToken || matchRef || matchId) {
      return { ...item, ...updates };
    }
    return item;
  });
  setCachedAppointments(updated);
}

export function getCachedDoctors() {
  if (inMemoryDoctors && Array.isArray(inMemoryDoctors)) {
    return inMemoryDoctors;
  }
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(DOCTORS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      inMemoryDoctors = parsed;
      return parsed;
    }
    return [];
  } catch (e) {
    return [];
  }
}

export function setCachedDoctors(list) {
  if (!Array.isArray(list)) return;
  inMemoryDoctors = list;
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DOCTORS_CACHE_KEY, JSON.stringify(list));
  } catch (e) {}
}

export function getCachedDoctorAvailability() {
  if (inMemoryAvailability && Array.isArray(inMemoryAvailability)) {
    return inMemoryAvailability;
  }
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(AVAILABILITY_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      inMemoryAvailability = parsed;
      return parsed;
    }
    return [];
  } catch (e) {
    return [];
  }
}

export function setCachedDoctorAvailability(list) {
  if (!Array.isArray(list)) return;
  inMemoryAvailability = list;
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AVAILABILITY_CACHE_KEY, JSON.stringify(list));
  } catch (e) {}
}

/**
 * Generates and persists a unique client browser token for private 1-to-1 Dhwani CRM live sync.
 * Guarantees that CRM sync data only reaches the specific browser / computer that triggered it.
 */
export function getOrCreateClientSyncId() {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem("ekms_crm_client_sync_id");
    if (!id || id.length < 8) {
      id = "c_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now().toString(36);
      localStorage.setItem("ekms_crm_client_sync_id", id);
    }
    return id;
  } catch (e) {
    return "c_fallback_" + Date.now();
  }
}



