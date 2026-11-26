"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  Search,
  Inbox,
  ChevronLeft,
  ChevronRight,
  Trash2,
  X,
  Eye,
  Bot,
  Sparkles,
  AlertTriangle,
  ShieldCheck,
  Building2,
  MapPin,
  Clock,
  PhoneCall,
  Navigation,
  ArrowRight,
  User,
  Activity,
  History,
  CheckCircle2,
  CalendarCheck,
  Calendar,
  Ambulance,
  RefreshCw,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { recordDeletedCase, isCaseDeleted, logSystemActivity, formatAgentDisplayName } from "@/lib/activityLogger";
import { archiveToRecentlyDeleted } from "@/lib/recentlyDeleted";
import { getFirestoreDb, getCasesSettingsDb } from "@/lib/firebase";
import { collection, onSnapshot, getDocs, query, orderBy, limit } from "firebase/firestore";
import { api, normalizeUrgency } from "@/lib/api";
import { UrgencyBadge } from "./UrgencyBadge";
import { normalizePhone } from "@/lib/caseId";
import {
  getCachedCases,
  setCachedCases,
  removeCaseFromLocalCache,
  appendCaseToLocalCache,
  getCachedStats,
  setCachedStats,
} from "@/lib/clientCache";
import { subscribeToSync, broadcastEvent } from "@/lib/broadcastSync";
import { formatBeneficiaryName, formatBeneficiaryPhone } from "@/lib/maskUtils";
import { getCallerIdForPhone } from "@/lib/callerId";
import { CaseHandoverForwarding } from "./CaseHandoverForwarding";

function getCaseDateString(c) {
  const ts = c?.created_at || c?.createdAt || c?.timestamp;
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) {
    const match = String(ts).match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : "";
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTomorrowDateString() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getCaseFacilityName(c) {
  if (!c) return "";
  const appt = c.booked_appointment || c.appointment;
  const t = c.triage || {};
  return (
    appt?.facilityName ||
    appt?.facilityShortName ||
    c.forwarded_facility_name ||
    c.forwarded_short_name ||
    c.forwarded_to ||
    t.forwarded_to ||
    t.call_referral_primary ||
    t.referral_destination ||
    t.recommended_facility_type ||
    ""
  );
}

export function areFacilitiesMatching(facA, facB) {
  if (!facA || !facB) return false;
  const cleanA = String(facA).toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanB = String(facB).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;
  return false;
}

export function isCaseItemForwarded(c) {
  if (!c) return false;
  if (c.is_forwarded || c.forwarded_at || c.dispatch_id || c.handover_sent || c.status === "forwarded") {
    return true;
  }
  if (typeof window !== "undefined") {
    try {
      const keys = [
        c.case_ref,
        c.id,
        c.case_id,
        c.caller_id,
        c.intake?.phone,
      ].filter(Boolean);
      for (const k of keys) {
        const str = String(k).trim();
        if (
          localStorage.getItem(`ekms_forwarded_${str}`) ||
          sessionStorage.getItem(`ekms_forwarded_${str}`) ||
          localStorage.getItem(`ekms_forwarded_${str.toUpperCase()}`) ||
          sessionStorage.getItem(`ekms_forwarded_${str.toUpperCase()}`) ||
          localStorage.getItem(`ekms_forwarded_${str.toLowerCase()}`) ||
          sessionStorage.getItem(`ekms_forwarded_${str.toLowerCase()}`)
        ) {
          return true;
        }
      }
    } catch (e) {}
  }
  return false;
}

export function mergeCaseForwardStatus(casesList) {
  if (!Array.isArray(casesList) || typeof window === "undefined") return casesList;
  return casesList.map((c) => {
    if (c.is_forwarded || c.forwarded_at || c.dispatch_id || c.status === "forwarded") return c;
    const keys = [
      c.case_ref,
      c.id,
      c.case_id,
      c.caller_id,
      c.intake?.phone,
    ].filter(Boolean);
    for (const k of keys) {
      const str = String(k).trim();
      const stored =
        localStorage.getItem(`ekms_forwarded_${str}`) ||
        sessionStorage.getItem(`ekms_forwarded_${str}`) ||
        localStorage.getItem(`ekms_forwarded_${str.toUpperCase()}`) ||
        sessionStorage.getItem(`ekms_forwarded_${str.toUpperCase()}`) ||
        localStorage.getItem(`ekms_forwarded_${str.toLowerCase()}`) ||
        sessionStorage.getItem(`ekms_forwarded_${str.toLowerCase()}`);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          return { ...c, ...parsed, is_forwarded: true, status: "forwarded" };
        } catch (e) {}
      }
    }
    return c;
  });
}

const PAGE_SIZE = 20;

const inputCls =
  "rounded-md border border-border/80 bg-secondary/50 px-3 py-2 text-sm outline-none transition-colors duration-200 focus:border-primary/70";

export function getCaseBookedAppointment(c) {
  if (!c) return null;

  // 1. If explicitly call_only or booked_appointment is null/false, no booking was done
  if (
    c.status === "call_only" ||
    c.booking_status === "call_only" ||
    c.booked_appointment === null ||
    c.booked_appointment === false ||
    c.has_appointment === false
  ) {
    return null;
  }

  // 2. Check if case has an active, valid booked_appointment object with actual booking details
  // An appointment is ONLY booked if it has an actual booked date and time slot!
  const b = c.booked_appointment || c.appointment;
  if (b && typeof b === "object" && !Array.isArray(b)) {
    if (b.status === "cancelled" || b.isCancelled || b.status === "call_only") return null;
    if (b.date && b.timeSlot) {
      return b;
    }
    if (b.date || (b.timeSlot && b.facilityName)) {
      return b;
    }
  }

  // 3. ONLY check case-specific localStorage keys, NEVER phone or caller_id (which leaks previous calls)
  if (typeof window !== "undefined") {
    try {
      const keys = [c.case_ref, c.id, c.case_id].filter(Boolean);
      for (const k of keys) {
        const str = String(k).trim();
        const saved =
          localStorage.getItem(`ekms_appt_${str}`) ||
          localStorage.getItem(`ekms_appt_${str.toUpperCase()}`) ||
          localStorage.getItem(`ekms_appt_${str.toLowerCase()}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (
            parsed &&
            typeof parsed === "object" &&
            parsed.status !== "cancelled" &&
            parsed.status !== "call_only" &&
            parsed.date &&
            parsed.timeSlot
          ) {
            return parsed;
          }
        }
      }
    } catch (e) {}
  }
  return null;
}

export function normalizeFacilityTarget(text) {
  if (!text) return "";
  const s = String(text).toLowerCase().trim();
  if (s.includes("108") || s.includes("ambulance") || s === "call_108") return "108_AMBULANCE";
  if (s.includes("104") || s.includes("helpline") || s.includes("tele-doctor") || s.includes("tele_104") || s === "104_medical") return "104_MEDICAL";
  if (s.includes("district") || s.includes("dist_hospital") || s.includes("govt dist") || s.includes("public health")) return "DIST_HOSPITAL";
  if (s.includes("esic hospital") || s.includes("esic_hospital") || (s.includes("esic") && s.includes("hospital")) || s.includes("casualty")) return "ESIC_HOSPITAL";
  if (s.includes("dispensary") || s.includes("esis") || s.includes("esis_dispensary")) return "ESIS_DISPENSARY";
  if (s.includes("tie") || s.includes("empanelled") || s.includes("tie_up") || s.includes("tie_up_facility")) return "TIE_UP_FACILITY";
  return s;
}

export function getReferralBadge(c) {
  const t = c?.triage || {};
  const appt = c?.booked_appointment || c?.appointment;
  const dest = (
    appt?.facilityName ||
    appt?.facilityShortName ||
    c?.forwarded_short_name ||
    c?.forwarded_to ||
    t.forwarded_to ||
    t.call_referral_primary ||
    t.referral_destination ||
    t.recommended_facility_type ||
    ""
  );
  const norm = normalizeFacilityTarget(dest);

  switch (norm) {
    case "108_AMBULANCE":
      return {
        label: "108 Ambulance",
        icon: "🚨",
        color: "bg-rose-700 text-white border-rose-800",
      };
    case "DIST_HOSPITAL":
      return {
        label: "Govt District Hospital",
        icon: "🏥",
        color: "bg-blue-800 text-white border-blue-900",
      };
    case "ESIC_HOSPITAL":
      return {
        label: "ESIC Hospital",
        icon: "🏥",
        color: "bg-amber-700 text-white border-amber-800",
      };
    case "TIE_UP_FACILITY":
      return {
        label: "Tie-Up Facility",
        icon: "🏥",
        color: "bg-cyan-700 text-white border-cyan-800",
      };
    case "104_MEDICAL":
      return {
        label: "104 Health Helpline",
        icon: "📞",
        color: "bg-blue-700 text-white border-blue-800",
      };
    case "ESIS_DISPENSARY":
    default:
      return {
        label: c?.forwarded_short_name || "ESIS Dispensary",
        icon: "🩺",
        color: "bg-emerald-700 text-white border-emerald-800",
      };
  }
}

export function getSecondaryReferralBadge(c) {
  const t = c?.triage || {};
  const dest = (
    t.call_referral_secondary ||
    t.secondary_referral_destination ||
    "104 Health Helpline"
  ).toLowerCase();

  if (dest.includes("108") || dest.includes("ambulance")) {
    return {
      label: "108 Ambulance",
      icon: "🚨",
      color: "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800",
    };
  }
  if (dest.includes("hospital") || dest.includes("casualty")) {
    return {
      label: "ESIC Hospital Casualty (24x7)",
      icon: "🏥",
      color: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800",
    };
  }
  if (dest.includes("tie") || dest.includes("empanelled")) {
    return {
      label: "Empanelled Tie-Up Hospital",
      icon: "🏥",
      color: "bg-cyan-100 text-cyan-900 border-cyan-300 dark:bg-cyan-950/60 dark:text-cyan-200 dark:border-cyan-800",
    };
  }
  return {
    label: "104 Health Helpline (Doctor on Call)",
    icon: "📞",
    color: "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-800",
  };
}

export function getAgentDisplayName(c, currentAgent) {
  if (!c) {
    if (currentAgent?.displayName || currentAgent?.name) {
      return formatAgentDisplayName(currentAgent.displayName || currentAgent.name, currentAgent.email, currentAgent.agentId);
    }
    return "Agent";
  }

  // 1. Direct agent name recorded on the case
  const directName =
    c.agent_name ||
    c.agentName ||
    c.booked_appointment?.bookedByName ||
    c.booked_appointment?.agentName ||
    c.intake?.agent_name;
  if (directName) {
    const formatted = formatAgentDisplayName(directName, null, null);
    if (formatted && formatted !== "Agent") return formatted;
  }

  // 2. Explicit registered agent ID or email
  const explicit = c.agent_id || c.intake?.agent_id || c.agent || c.intake?.agent;
  if (explicit) {
    const formatted = formatAgentDisplayName(null, null, explicit);
    if (formatted && formatted !== "Agent") return formatted;
  }

  // 3. Match from local stored registered team members
  if (typeof window !== "undefined") {
    try {
      const teamsRaw = localStorage.getItem("ekms_admin_teams_v2");
      if (teamsRaw) {
        const teamList = JSON.parse(teamsRaw);
        if (Array.isArray(teamList)) {
          const match = teamList.find((m) => {
            if (!explicit) return false;
            const expUpper = String(explicit).toUpperCase().trim();
            const expLower = String(explicit).toLowerCase().trim();
            return (
              (m.agentId && m.agentId.toUpperCase() === expUpper) ||
              (m.email && m.email.toLowerCase() === expLower) ||
              (m.id && m.id.toLowerCase() === expLower)
            );
          });
          if (match?.name || match?.displayName) {
            return formatAgentDisplayName(match.name || match.displayName, match.email, match.agentId);
          }
        }
      }
    } catch (e) {}
  }

  return "Agent";
}

export function getAgentCode(c) {
  const explicit = c?.agent_id || c?.intake?.agent_id || c?.agent || c?.intake?.agent;
  if (explicit) {
    const s = String(explicit).toUpperCase().trim();
    if (s.startsWith("ESIC")) return s;
    return s;
  }
  return "";
}

export function getAgentFullLabel(agentCodeOrCase, currentAgent) {
  if (agentCodeOrCase && typeof agentCodeOrCase === "object") {
    return getAgentDisplayName(agentCodeOrCase, currentAgent);
  }
  return formatAgentDisplayName(null, null, agentCodeOrCase);
}

export function getCleanComplaintSummary(c) {
  if (!c) return "Caller arrived with acute health inquiry.";
  
  const intake = c.intake || {};
  const triage = c.triage || {};

  // 1. Check if summary_en is already set and clean
  let summary = triage.summary_en || "";

  // 2. If summary is empty or has bracketed/technical text, check ekms_ai_context / clinicalSummary
  if (!summary || summary.startsWith("[")) {
    summary = c.ekms_ai_context?.triageState?.clinicalSummary || c.ekms_ai_context?.clinicalSummary || triage.clinical_summary || "";
  }

  // 3. If still empty, check intake.symptom_notes
  if (!summary && intake.symptom_notes) {
    summary = intake.symptom_notes;
  }

  // 4. Strip any leading bracketed prefixes like [Clinical Findings: ...] or [Suspected: ...] and strip "Clinical Reason: ..."
  if (summary) {
    summary = summary
      .replace(/^\[(?:Clinical Findings|Suspected):?[^\]]+\]\s*/i, "")
      .replace(/Clinical Reason:[\s\S]*$/i, "")
      .trim();
  }

  // 5. If summary is still missing or just raw short keyword or bracketed leftover, construct the standard clinical summary paragraph
  if (!summary || summary.length < 20 || summary.startsWith("[")) {
    const ageStr = intake.age ? `${intake.age}-year-old` : "Adult";
    const sexStr = intake.sex ? `${intake.sex.toLowerCase()} caller` : "caller";
    const cond = triage.suspected_condition || triage.condition || intake.symptom || triage.primary_complaint || "Acute Health Condition";
    const cleanCond = cond.replace(/^\[[^\]]+\]\s*/, "").trim();
    const dur = intake.duration || triage.duration || "Less than 2 hours";
    const ref = triage.call_referral_primary || triage.primary_referral_destination || "104 Health Helpline";
    const normLevel = normalizeUrgency(triage.urgency_level || intake.severity_reported);
    summary = `${ageStr} ${sexStr} reports ${cleanCond} (${normLevel} · ${dur}); guided to ${ref} for medical consultation.`;
  }

  return summary;
}

// Generate unique row identifier even if multiple rows share the same case_ref
export function getCaseUniqueKey(c, idx = 0) {
  if (c?.id) return String(c.id);
  const ref = c?.case_ref || "CASE";
  const ts = c?.created_at || idx;
  return `${ref}_${ts}`;
}

export const CaseLogs = ({ refreshKey, onCaseDeleted, currentAgent }) => {
  const isAdmin =
    String(currentAgent?.role || "").toLowerCase() === "admin" ||
    String(currentAgent?.role || "").toLowerCase() === "master admin" ||
    Boolean(currentAgent?.isAdmin) ||
    Boolean(currentAgent?.isMasterAdmin);

  const canDeleteCase = useCallback(
    (caseObj) => {
      if (isAdmin) return true;
      if (!caseObj) return false;
      // In clinical triage console, active logged in agents and admins can delete cases
      if (currentAgent) return true;
      return true;
    },
    [isAdmin, currentAgent]
  );
  const [cases, setCases] = useState(() => {
    // 1. Initial load from browser storage, merged with persistent forward state
    const cached = getCachedCases();
    const active = Array.isArray(cached) ? cached : [];
    const merged = mergeCaseForwardStatus(active);
    const seen = new Set();
    return merged.filter((c) => {
      const ref = String(c.case_ref || c.id || "").trim().toUpperCase();
      if (!ref) return true;
      if (seen.has(ref)) return false;
      seen.add(ref);
      return true;
    });
  });
  const [dateFilter, setDateFilter] = useState("today");
  const [customDate, setCustomDate] = useState("");
  const [recordTypeFilter, setRecordTypeFilter] = useState("all");
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [urgency, setUrgency] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [q, setQ] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [openRowKey, setOpenRowKey] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [caseToDelete, setCaseToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [selectedCaseForConvo, setSelectedCaseForConvo] = useState(null);

  useEffect(() => {
    setCurrentPage(1);
  }, [urgency, agentFilter, facilityFilter, q, dateFilter, customDate, recordTypeFilter]);

  // 2. Authoritative sync with server & live Firebase Firestore
  const fetchCases = useCallback((showToast = false) => {
    setIsRefreshing(true);

    api
      .get("/cases")
      .then(({ data }) => {
        if (Array.isArray(data)) {
          const merged = mergeCaseForwardStatus(data);
          const seen = new Set();
          const deduped = merged.filter((c) => {
            const ref = String(c.case_ref || c.id || "").trim().toUpperCase();
            if (!ref) return true;
            if (seen.has(ref)) return false;
            seen.add(ref);
            return true;
          });
          setCases(deduped);
          setCachedCases(deduped);
          const currentStats = getCachedStats() || {};
          const updatedStats = { ...currentStats, total: deduped.length };
          setCachedStats(updatedStats);
          broadcastEvent("SYNC_STATS_TOTAL", { total: deduped.length });
          if (showToast) toast.success("Case logs synced");
        }
      })
      .catch((err) => {
        console.warn("Failed to fetch cases:", err);
      })
      .finally(() => {
        setIsRefreshing(false);
      });
  }, []);

  // Real-time live Firestore listener with limit(60) for minimal reads & high performance
  useEffect(() => {
    let unsub = null;
    try {
      const db = getCasesSettingsDb() || getFirestoreDb();
      if (db) {
        let qRef;
        try {
          qRef = query(collection(db, "cases"), orderBy("created_at", "desc"), limit(60));
        } catch (_) {
          qRef = query(collection(db, "cases"), limit(60));
        }
        unsub = onSnapshot(
          qRef,
          (snapshot) => {
            // 1. Capture explicitly removed documents
            const removedRefs = new Set();
            snapshot.docChanges().forEach((change) => {
              if (change.type === "removed") {
                const dData = change.doc.data() || {};
                const r1 = String(change.doc.id || "").trim().toUpperCase();
                const r2 = String(dData.case_ref || "").trim().toUpperCase();
                if (r1) removedRefs.add(r1);
                if (r2) removedRefs.add(r2);
              }
            });

            if (snapshot.empty) {
              setCases([]);
              setCachedCases([]);
              const currentStats = getCachedStats() || {};
              setCachedStats({ ...currentStats, total: 0 });
              return;
            }

            const liveList = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
            setCases((prev) => {
              const map = new Map();

              // 1. Authoritative live items from Firestore
              liveList.forEach((c) => {
                const ref = String(c.case_ref || c.id || "").trim().toUpperCase();
                if (ref && !removedRefs.has(ref) && !isCaseDeleted(ref)) map.set(ref, c);
              });

              // 2. Only retain older prev items if Firestore query hit the limit of 60
              if (liveList.length >= 60) {
                const oldestLiveTime = Math.min(
                  ...liveList
                    .map((c) => new Date(c.created_at || c.createdAt || 0).getTime())
                    .filter((t) => !isNaN(t) && t > 0)
                );
                (prev || []).forEach((c) => {
                  const ref = String(c.case_ref || c.id || "").trim().toUpperCase();
                  if (!ref || removedRefs.has(ref) || map.has(ref) || isCaseDeleted(ref)) return;
                  const cTime = new Date(c.created_at || c.createdAt || 0).getTime();
                  if (cTime > 0 && oldestLiveTime > 0 && cTime < oldestLiveTime) {
                    map.set(ref, c);
                  }
                });
              }

              const merged = Array.from(map.values()).sort(
                (a, b) =>
                  new Date(b.created_at || b.createdAt || 0).getTime() -
                  new Date(a.created_at || a.createdAt || 0).getTime()
              );
              setCachedCases(merged);
              const currentStats = getCachedStats() || {};
              setCachedStats({ ...currentStats, total: merged.length });
              return merged;
            });
          },
          (err) => {
            console.warn("Firestore live snapshot notice:", err);
          }
        );
      }
    } catch (e) {}
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  useEffect(() => {
    fetchCases();
  }, [fetchCases, refreshKey]);

  // 3. Real-time tab-to-tab sync listener (0 network requests & 0 Firestore reads)
  useEffect(() => {
    const unsub = subscribeToSync((event) => {
      if (event?.type === "NEW_CASE" && event?.payload) {
        const newCase = event.payload;
        setCases((prev) => {
          const exists = prev.some(
            (c) => (c.id && c.id === newCase.id) || (c.case_ref && c.case_ref === newCase.case_ref)
          );
          if (exists) return prev;
          const updated = [newCase, ...prev];
          setCachedCases(updated);
          return updated;
        });
      } else if (event?.type === "DELETE_CASE" && event?.payload) {
        const { caseRef, id } = event.payload;
        setCases((prev) => {
          const updated = prev.filter((c) => c.case_ref !== caseRef && c.id !== id);
          setCachedCases(updated);
          return updated;
        });
      } else if ((event?.type === "CASE_FORWARDED" || event?.type === "CASE_UPDATED") && event?.payload) {
        const { case_ref, id, all_targets } = event.payload;
        const targetSet = new Set(
          [case_ref, id, ...(Array.isArray(all_targets) ? all_targets : [])]
            .filter(Boolean)
            .map((k) => String(k).trim().toUpperCase())
        );
        setCases((prev) => {
          const updated = prev.map((c) => {
            const cRef = String(c.case_ref || "").trim().toUpperCase();
            const cId = String(c.id || "").trim().toUpperCase();
            if ((cRef && targetSet.has(cRef)) || (cId && targetSet.has(cId))) {
              return {
                ...c,
                ...event.payload,
                is_forwarded: true,
                status: event.payload.booked_appointment ? "booked" : (event.payload.status || "forwarded"),
                booking_status: event.payload.booked_appointment ? "booked" : (event.payload.booking_status || "forwarded"),
                has_appointment: Boolean(event.payload.booked_appointment),
              };
            }
            return c;
          });
          setCachedCases(updated);
          return updated;
        });
      } else if (event?.type === "CASE_APPOINTMENT_BOOKED" && event?.payload) {
        const { case_ref, appointment } = event.payload;
        setCases((prev) => {
          const updated = prev.map((c) => {
            if (String(c.case_ref).toUpperCase() === String(case_ref).toUpperCase()) {
              return {
                ...c,
                booked_appointment: appointment,
                status: "booked",
                booking_status: "booked",
                has_appointment: true,
              };
            }
            return c;
          });
          setCachedCases(updated);
          return updated;
        });
      } else if ((event?.type === "CASE_APPOINTMENT_CANCELLED" || event?.type === "APPOINTMENT_DELETED") && event?.payload) {
        const targetRef = String(event.payload.case_ref || event.payload.caseRef || "").toUpperCase();
        const targetToken = String(event.payload.tokenNo || event.payload.referenceNo || "").toUpperCase();
        setCases((prev) => {
          const updated = prev.map((c) => {
            const cRef = String(c.case_ref || c.id || "").toUpperCase();
            const cTok = String(c.booked_appointment?.tokenNo || c.booked_appointment?.referenceNo || "").toUpperCase();
            if ((targetRef && cRef === targetRef) || (targetToken && cTok === targetToken)) {
              const copy = { ...c };
              delete copy.booked_appointment;
              return {
                ...copy,
                booked_appointment: null,
                has_appointment: false,
                status: "call_only",
                booking_status: "call_only",
              };
            }
            return c;
          });
          setCachedCases(updated);
          return updated;
        });
      }
    });
    return unsub;
  }, []);


  // Filter cases by date, agent, and record type (used for responsive metric cards)
  const baseFilteredCases = useMemo(() => {
    let list = [...cases];

    // Filter by date
    if (dateFilter === "today") {
      const target = getTodayDateString();
      list = list.filter((c) => getCaseDateString(c) === target || c.booked_appointment?.date === target);
    } else if (dateFilter === "tomorrow") {
      const target = getTomorrowDateString();
      list = list.filter((c) => getCaseDateString(c) === target || c.booked_appointment?.date === target);
    } else if (dateFilter === "custom" && customDate) {
      list = list.filter((c) => getCaseDateString(c) === customDate || c.booked_appointment?.date === customDate);
    }

    // Filter by agent
    if (agentFilter && agentFilter !== "all") {
      list = list.filter((c) => {
        const name = getAgentDisplayName(c, currentAgent);
        return name.toLowerCase() === agentFilter.toLowerCase();
      });
    }

    // Filter by facility
    if (facilityFilter && facilityFilter !== "all") {
      list = list.filter((c) => areFacilitiesMatching(getCaseFacilityName(c), facilityFilter));
    }

    // Filter by record type (call only or booked)
    if (recordTypeFilter === "call_only") {
      list = list.filter((c) => !getCaseBookedAppointment(c));
    } else if (recordTypeFilter === "booked") {
      list = list.filter((c) => Boolean(getCaseBookedAppointment(c)));
    }

    return list;
  }, [cases, dateFilter, customDate, agentFilter, facilityFilter, recordTypeFilter, currentAgent]);

  const counts = useMemo(() => {
    let severe = 0;
    let moderate = 0;
    let mild = 0;
    baseFilteredCases.forEach((c) => {
      const lvl = normalizeUrgency(c.triage?.urgency_level || c.urgency_level);
      if (lvl === "Severe") severe++;
      else if (lvl === "Moderate") moderate++;
      else mild++;
    });
    return {
      total: baseFilteredCases.length,
      severe,
      moderate,
      mild,
    };
  }, [baseFilteredCases]);

  const uniqueFacilities = useMemo(() => {
    const set = new Set();
    cases.forEach((c) => {
      const fac = getCaseFacilityName(c);
      if (fac && fac !== "—") set.add(fac);
    });
    return Array.from(set).sort();
  }, [cases]);

  const uniqueAgents = useMemo(() => {
    const set = new Set();
    cases.forEach((c) => {
      const name = getAgentDisplayName(c, currentAgent);
      if (name && name !== "—") set.add(name);
    });
    return Array.from(set).sort();
  }, [cases, currentAgent]);

  const sortedCases = useMemo(() => {
    let list = [...baseFilteredCases];

    // Filter by urgency (from clicking 4 cards)
    if (urgency && urgency !== "all") {
      list = list.filter((c) => {
        const lvl = normalizeUrgency(c.triage?.urgency_level || c.urgency_level);
        return lvl.toLowerCase() === urgency.toLowerCase();
      });
    }

    // Filter by search query
    if (q && q.trim()) {
      const query = q.toLowerCase().trim();
      list = list.filter((c) => {
        const callerId = String(
          c.caller_id ||
          c.intake?.caller_id ||
          c.intake?.callerId ||
          (c.intake?.phone ? getCallerIdForPhone(c.intake.phone) : "")
        ).toLowerCase();
        const matchCallerId = callerId.includes(query);
        const matchName = c.intake?.caller_name?.toLowerCase().includes(query);
        const matchPhone = c.intake?.phone?.toLowerCase().includes(query);
        const matchNotes = c.intake?.symptom_notes?.toLowerCase().includes(query);
        const matchRef = (c.case_ref || c.id || "").toLowerCase().includes(query);
        const matchAge = c.intake?.age != null && String(c.intake?.age).includes(query);
        const matchSex = c.intake?.sex?.toLowerCase().includes(query);
        const matchAgent = (c.agent_name || c.agent_id || getAgentDisplayName(c, currentAgent)).toLowerCase().includes(query);
        return matchCallerId || matchName || matchPhone || matchNotes || matchRef || matchAge || matchSex || matchAgent;
      });
    }
    return list.sort((a, b) => {
      const timeA = new Date(a.created_at || a.createdAt || a.timestamp || 0).getTime();
      const timeB = new Date(b.created_at || b.createdAt || b.timestamp || 0).getTime();
      return timeB - timeA;
    });
  }, [baseFilteredCases, urgency, q, currentAgent]);

  const totalPages = Math.ceil(sortedCases.length / PAGE_SIZE) || 1;
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const paginatedCases = sortedCases.slice(startIndex, startIndex + PAGE_SIZE);

  const isPageAllSelected =
    paginatedCases.length > 0 &&
    paginatedCases.every((c, idx) => selectedKeys.has(getCaseUniqueKey(c, startIndex + idx)));

  const toggleSelectAllPage = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (isPageAllSelected) {
        paginatedCases.forEach((c, idx) => next.delete(getCaseUniqueKey(c, startIndex + idx)));
      } else {
        paginatedCases.forEach((c, idx) => next.add(getCaseUniqueKey(c, startIndex + idx)));
      }
      return next;
    });
  };

  const selectAllMatching = () => {
    setSelectedKeys(new Set(sortedCases.map((c, idx) => getCaseUniqueKey(c, idx))));
  };

  const clearSelection = () => {
    setSelectedKeys(new Set());
  };

  const toggleSelectOne = (rowKey, e) => {
    e?.stopPropagation();
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const handleCancelAppointmentOnly = async () => {
    if (!caseToDelete) return;
    setIsDeleting(true);
    const targetRef = caseToDelete.case_ref || caseToDelete.id;
    try {
      await api.patch("/cases", {
        case_ref: targetRef,
        updates: {
          status: "call_only",
          booking_status: "call_only",
          booked_appointment: null,
          has_appointment: false,
        },
      });

      const token =
        caseToDelete.booked_appointment?.tokenNo ||
        caseToDelete.booked_appointment?.referenceNo;
      if (token) {
        await api.post("/appointments/delete", { tokenNo: token }).catch(() => {});
      }

      broadcastEvent("CASE_APPOINTMENT_CANCELLED", { case_ref: targetRef });

      setCases((prev) => {
        const updated = prev.map((c) => {
          if (c.case_ref === targetRef || c.id === targetRef) {
            const copy = { ...c };
            delete copy.booked_appointment;
            return {
              ...copy,
              status: "call_only",
              booking_status: "call_only",
              booked_appointment: null,
              has_appointment: false,
            };
          }
          return c;
        });
        setCachedCases(updated);
        return updated;
      });

      toast.success(`Appointment cancelled. Case ${targetRef} preserved as Call Only.`);
      setCaseToDelete(null);
    } catch (e) {
      toast.error("Failed to cancel appointment: " + (e.message || "Network error"));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!caseToDelete) return;
    setIsDeleting(true);
    const targetRef = caseToDelete.case_ref || caseToDelete.id;
    const targetId = caseToDelete.id;
    const targetKey = getCaseUniqueKey(caseToDelete);

    // Archive to 7-Day Recently Deleted holding area
    try {
      await archiveToRecentlyDeleted({
        item: caseToDelete,
        itemType: "case",
        deletedBy: currentAgent?.name || currentAgent?.displayName || "Administrator",
        deletedByEmail: currentAgent?.email || "",
      });
    } catch (_) {}

    try {
      if (targetRef) {
        await api
          .delete("/cases", {
            data: { case_refs: [targetRef, targetId, caseToDelete.case_ref].filter(Boolean) },
            params: { case_ref: targetRef },
          })
          .catch(() => {
            return api.delete(`/cases/${encodeURIComponent(targetRef)}`);
          });
      }
      removeCaseFromLocalCache(targetRef);
      if (caseToDelete.case_ref) removeCaseFromLocalCache(caseToDelete.case_ref);
      if (targetId) removeCaseFromLocalCache(targetId);

      logSystemActivity({
        user: currentAgent,
        type: "DELETE_CASE",
        caseId: targetRef || targetId,
        details: `Deleted case entry with Case ID- ${targetRef || targetId}`,
      });
      broadcastEvent("DELETE_CASE", { caseRef: targetRef, id: targetId });
      setCases((prev) => {
        const updated = prev.filter((c, idx) => {
          if (getCaseUniqueKey(c, idx) === targetKey) return false;
          if (targetRef && (c.case_ref === targetRef || c.id === targetRef)) return false;
          if (caseToDelete.case_ref && c.case_ref === caseToDelete.case_ref) return false;
          if (targetId && c.id === targetId) return false;
          return true;
        });
        setCachedCases(updated);
        broadcastEvent("SYNC_STATS_TOTAL", { total: updated.length });
        return updated;
      });
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(targetKey);
        return next;
      });
      toast.success(`Case ${targetRef || "entry"} deleted successfully`);
      setCaseToDelete(null);
      onCaseDeleted?.();
    } catch (err) {
      console.warn("Delete case fallback:", err);
      removeCaseFromLocalCache(targetRef);
      if (caseToDelete.case_ref) removeCaseFromLocalCache(caseToDelete.case_ref);
      if (targetId) removeCaseFromLocalCache(targetId);
      setCases((prev) => {
        const updated = prev.filter((c, idx) => {
          if (getCaseUniqueKey(c, idx) === targetKey) return false;
          if (targetRef && (c.case_ref === targetRef || c.id === targetRef)) return false;
          if (caseToDelete.case_ref && c.case_ref === caseToDelete.case_ref) return false;
          if (targetId && c.id === targetId) return false;
          return true;
        });
        setCachedCases(updated);
        broadcastEvent("SYNC_STATS_TOTAL", { total: updated.length });
        return updated;
      });
      toast.success(`Case ${targetRef || "entry"} deleted`);
      setCaseToDelete(null);
      onCaseDeleted?.();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedKeys.size === 0) return;

    // Collect all case references from selected items
    const selectedCasesList = cases.filter((c, idx) =>
      selectedKeys.has(getCaseUniqueKey(c, idx))
    );
    if (selectedCasesList.length === 0) {
      toast.error("Please select cases to delete.");
      setShowBulkDeleteModal(false);
      return;
    }
    const targetRefs = Array.from(
      new Set(selectedCasesList.flatMap((c) => [c.case_ref, c.id]).filter(Boolean))
    );

    setIsBulkDeleting(true);

    try {
      // Archive selected cases to 7-Day Recently Deleted holding area
      for (const c of selectedCasesList) {
        try {
          await archiveToRecentlyDeleted({
            item: c,
            itemType: "case",
            deletedBy: currentAgent?.name || currentAgent?.displayName || "Administrator",
            deletedByEmail: currentAgent?.email || "",
          });
        } catch (_) {}
      }

      if (targetRefs.length > 0) {
        await api.delete("/cases", { data: { case_refs: targetRefs } });
        for (const ref of targetRefs) {
          removeCaseFromLocalCache(ref);
          recordDeletedCase(ref);
          broadcastEvent("DELETE_CASE", { caseRef: ref });
        }
        logSystemActivity({
          user: currentAgent,
          type: "DELETE_CASE",
          details: `Deleted ${targetRefs.length} cases from case history (${targetRefs.slice(0, 3).join(", ")}${targetRefs.length > 3 ? "..." : ""})`,
        });
      }
      setCases((prev) => {
        const updated = prev.filter(
          (c, idx) =>
            !selectedKeys.has(getCaseUniqueKey(c, idx)) &&
            !targetRefs.includes(c.case_ref) &&
            !targetRefs.includes(c.id)
        );
        setCachedCases(updated);
        broadcastEvent("SYNC_STATS_TOTAL", { total: updated.length });
        return updated;
      });
      toast.success(`Successfully deleted ${selectedKeys.size} cases`);
      setSelectedKeys(new Set());
      setShowBulkDeleteModal(false);
      onCaseDeleted?.();
    } catch (err) {
      console.warn("Bulk delete fallback:", err);
      for (const ref of targetRefs) {
        removeCaseFromLocalCache(ref);
        recordDeletedCase(ref);
      }
      setCases((prev) => {
        const updated = prev.filter(
          (c, idx) =>
            !selectedKeys.has(getCaseUniqueKey(c, idx)) &&
            !targetRefs.includes(c.case_ref) &&
            !targetRefs.includes(c.id)
        );
        setCachedCases(updated);
        return updated;
      });
      toast.success(`Deleted ${selectedKeys.size} cases`);
      setSelectedKeys(new Set());
      setShowBulkDeleteModal(false);
      onCaseDeleted?.();
    } finally {
      setIsBulkDeleting(false);
    }
  };


  return (
    <div className="w-full max-w-full space-y-6 pb-16 animate-in fade-in duration-200">
      {/* Top Header & Integrated Filter Bar directly on background */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Case logs</h1>
        </div>

        {/* Top Controls: Date Filter, Agent Filter, Call Only / Booked Filter */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Date Filter: All Dates, Today, Tomorrow, Custom Pick Date */}
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs shadow-2xs">
            <button
              type="button"
              onClick={() => {
                setDateFilter("all");
                setCustomDate("");
              }}
              className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer text-xs ${
                dateFilter === "all"
                  ? "bg-white text-blue-600 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              title="Show all cases without date restriction"
            >
              All Dates
            </button>
            <button
              type="button"
              onClick={() => {
                setDateFilter("today");
                setCustomDate("");
              }}
              className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer text-xs ${
                dateFilter === "today"
                  ? "bg-white text-blue-600 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                setDateFilter("tomorrow");
                setCustomDate("");
              }}
              className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer text-xs ${
                dateFilter === "tomorrow"
                  ? "bg-white text-blue-600 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Tomorrow
            </button>
            <div className="relative flex items-center">
              <input
                type="date"
                value={customDate}
                onClick={(e) => {
                  try {
                    e.target.showPicker?.();
                  } catch (err) {}
                }}
                onChange={(e) => {
                  setCustomDate(e.target.value);
                  setDateFilter("custom");
                }}
                className={`px-2 py-1 text-xs rounded-lg border outline-none cursor-pointer transition ${
                  dateFilter === "custom"
                    ? "bg-white text-blue-600 border-blue-400 font-bold shadow-2xs"
                    : "bg-transparent text-slate-600 border-transparent hover:text-slate-900"
                }`}
                title="Pick specific date"
              />
            </div>
          </div>

          {/* All Facility Filter */}
          <div className="relative">
            <select
              data-testid="case-log-filter-facility"
              value={facilityFilter}
              onChange={(e) => setFacilityFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 max-w-[190px] truncate cursor-pointer shadow-2xs"
              title="Filter by Facility"
            >
              <option value="all">All Facilities ({uniqueFacilities.length})</option>
              {uniqueFacilities.map((fac) => (
                <option key={fac} value={fac}>
                  {fac}
                </option>
              ))}
            </select>
          </div>

          {/* All Agent Filter */}
          <div className="relative">
            <select
              data-testid="case-log-filter-agent"
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[190px] truncate cursor-pointer"
            >
              <option value="all">All Agents ({uniqueAgents.length})</option>
              {uniqueAgents.map((ag) => (
                <option key={ag} value={ag}>
                  {ag}
                </option>
              ))}
            </select>
          </div>

          {/* Record Type Filter (in place of mild/severe filter): Call Only or Booked */}
          <div className="relative">
            <select
              data-testid="case-log-filter-record-type"
              value={recordTypeFilter}
              onChange={(e) => setRecordTypeFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="all">All Records</option>
              <option value="call_only">Call Only</option>
              <option value="booked">Booked</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4 Interactive Clickable Metric Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Card 1: Total Cases */}
        <button
          type="button"
          onClick={() => setUrgency("all")}
          className={`text-left rounded-2xl p-4 transition-all cursor-pointer bg-white select-none ${
            urgency === "all"
              ? "border-2 border-slate-800 shadow-xs"
              : "border border-slate-200 hover:border-slate-300 shadow-2xs"
          }`}
          title="Filter: All Cases"
        >
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-500">Total Cases</span>
            <FileText className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black mt-2 text-slate-900">{counts.total}</div>
          <div className="text-[11px] mt-0.5 text-slate-400">All audit trail logs</div>
        </button>

        {/* Card 2: Severe */}
        <button
          type="button"
          onClick={() => setUrgency((prev) => (prev === "Severe" ? "all" : "Severe"))}
          className={`text-left rounded-2xl p-4 transition-all cursor-pointer bg-white select-none ${
            urgency === "Severe"
              ? "border-2 border-rose-500 shadow-xs"
              : "border border-slate-200 hover:border-slate-300 shadow-2xs"
          }`}
          title="Filter: Severe Cases"
        >
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-500">Severe</span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-black mt-2 text-rose-600">{counts.severe}</div>
          <div className="text-[11px] mt-0.5 text-slate-400">Emergency & urgent cases</div>
        </button>

        {/* Card 3: Moderate */}
        <button
          type="button"
          onClick={() => setUrgency((prev) => (prev === "Moderate" ? "all" : "Moderate"))}
          className={`text-left rounded-2xl p-4 transition-all cursor-pointer bg-white select-none ${
            urgency === "Moderate"
              ? "border-2 border-amber-500 shadow-xs"
              : "border border-slate-200 hover:border-slate-300 shadow-2xs"
          }`}
          title="Filter: Moderate Cases"
        >
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-500">Moderate</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black mt-2 text-amber-600">{counts.moderate}</div>
          <div className="text-[11px] mt-0.5 text-slate-400">Semi-urgent cases</div>
        </button>

        {/* Card 4: Mild */}
        <button
          type="button"
          onClick={() => setUrgency((prev) => (prev === "Mild" ? "all" : "Mild"))}
          className={`text-left rounded-2xl p-4 transition-all cursor-pointer bg-white select-none ${
            urgency === "Mild"
              ? "border-2 border-emerald-500 shadow-xs"
              : "border border-slate-200 hover:border-slate-300 shadow-2xs"
          }`}
          title="Filter: Mild Cases"
        >
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-500">Mild</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black mt-2 text-emerald-600">{counts.mild}</div>
          <div className="text-[11px] mt-0.5 text-slate-400">Routine & non-urgent</div>
        </button>
      </div>

      {/* Search Bar along with Select Page line */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 w-full">
        {/* Search Bar on the left */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            data-testid="case-log-search"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search caller ID, case ref, name, phone, notes..."
            className="w-full pl-8 pr-8 py-2 bg-white border border-slate-200 rounded-2xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs transition"
          />
          {Boolean(q) && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer text-xs"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Action Controls: Select Page directly aligned with search */}
        {paginatedCases.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <label className="flex items-center gap-2 cursor-pointer bg-white px-3.5 py-2 border border-slate-200 rounded-2xl text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs select-none">
              <input
                type="checkbox"
                checked={isPageAllSelected}
                onChange={toggleSelectAllPage}
                className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4 border-slate-300 cursor-pointer"
              />
              <span>Select Page</span>
              <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                {paginatedCases.length}
              </span>
            </label>
          </div>
        )}
      </div>

      {/* Bulk Action & Selection Bar */}
      {selectedKeys.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-xs shadow-2xs animate-in fade-in duration-150">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-[11px] font-bold text-white">
              {selectedKeys.size}
            </span>
            <span className="font-bold text-rose-950">
              {selectedKeys.size} case{selectedKeys.size > 1 ? "s" : ""} selected
            </span>
            {selectedKeys.size < sortedCases.length && (
              <button
                type="button"
                onClick={selectAllMatching}
                className="ml-2 font-bold text-rose-700 underline underline-offset-2 hover:text-rose-900 cursor-pointer"
              >
                Select all {sortedCases.length} matching
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearSelection}
              className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shadow-2xs transition"
            >
              <X className="h-3.5 w-3.5" /> Deselect all
            </button>
            <button
              type="button"
              data-testid="cases-bulk-delete-button"
              onClick={() => setShowBulkDeleteModal(true)}
              className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 font-bold text-white shadow-xs hover:bg-rose-700 active:scale-95 cursor-pointer transition"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete Selected ({selectedKeys.size})</span>
            </button>
          </div>
        </div>
      )}

      {cases.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs flex flex-col items-center gap-2 py-16 text-center">
          <Inbox className="h-10 w-10 text-slate-300" strokeWidth={1.5} />
          <p className="text-sm font-semibold text-slate-600">No cases logged yet</p>
          <p className="text-xs text-slate-400">Incoming caller consultations and triage outcomes will appear here.</p>
        </div>
      ) : sortedCases.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs flex flex-col items-center gap-2 py-16 text-center">
          <Search className="h-10 w-10 text-slate-300" strokeWidth={1.5} />
          <p className="text-sm font-semibold text-slate-600">No matching cases found</p>
          <p className="text-xs text-slate-400">Try adjusting your search query or urgency filter.</p>
          <button
            type="button"
            onClick={() => {
              setQ("");
              setUrgency("all");
              setAgentFilter("all");
              setFacilityFilter("all");
              setDateFilter("today");
              setCustomDate("");
              setRecordTypeFilter("all");
            }}
            className="mt-2 text-xs font-bold text-blue-600 hover:underline cursor-pointer"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm" data-testid="case-log-table">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                  <th className="w-10 py-3.5 pl-4 pr-2 text-center">
                    <input
                      type="checkbox"
                      checked={isPageAllSelected}
                      onChange={toggleSelectAllPage}
                      className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600 cursor-pointer"
                      title="Select all on current page"
                    />
                  </th>
                  <th className="py-3.5 pr-3 font-bold">Caller ID</th>
                  <th className="py-3.5 pr-3 font-bold">Case</th>
                  <th className="py-3.5 pr-3 font-bold">Agent</th>
                  <th className="py-3.5 pr-3 font-bold">Caller</th>
                  <th className="py-3.5 pr-3 font-bold">Complaint</th>
                  <th className="py-3.5 pr-3 font-bold">Urgency</th>
                  <th className="py-3.5 pr-3 font-bold">Navigation</th>
                  <th className="py-3.5 pr-3 font-bold">Time</th>
                  <th className="py-3.5 pr-4 text-right font-bold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedCases.map((c, idx) => {
                  const rowKey = getCaseUniqueKey(c, startIndex + idx);
                  const isOpen = openRowKey === rowKey;
                  const isSelected = selectedKeys.has(rowKey);

                  return (
                    <tr
                      key={rowKey}
                      data-testid="case-log-row"
                      onClick={() => setOpenRowKey(isOpen ? null : rowKey)}
                      className={`cursor-pointer transition-colors duration-150 hover:bg-slate-50/80 ${
                        isSelected ? "bg-blue-50/50" : ""
                      }`}
                    >
                      <td className="w-10 py-3.5 pl-4 pr-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => toggleSelectOne(rowKey, e)}
                          className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 pr-3">
                        <span className="text-xs font-bold text-slate-700 font-mono tracking-wider">
                          {c.caller_id || c.intake?.caller_id || getCallerIdForPhone(c.intake?.phone)}
                        </span>
                      </td>
                      <td className="py-3.5 pr-3">
                        <span className="text-xs font-bold text-slate-800 tracking-wide">
                          {c.case_ref}
                        </span>
                      </td>
                      <td className="py-3.5 pr-3">
                        <span className="inline-flex items-center justify-center rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-800 border border-slate-200 whitespace-nowrap">
                          {getAgentDisplayName(c, currentAgent)}
                        </span>
                      </td>
                      <td className="py-3.5 pr-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-bold text-slate-900">{formatBeneficiaryName(c.intake?.caller_name) || "—"}</p>
                          {(c.intake?.age || c.intake?.sex) && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 border border-slate-200">
                              {[c.intake?.age ? `${c.intake.age}y` : null, c.intake?.sex].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-medium text-slate-500 tracking-wide mt-0.5">{formatBeneficiaryPhone(c.intake?.phone) || "—"}</p>
                      </td>
                      <td className="max-w-[340px] py-3.5 pr-3">
                        <p className="text-slate-800 font-medium text-xs leading-relaxed">
                          {getCleanComplaintSummary(c)}
                        </p>
                      </td>
                      <td className="py-3.5 pr-3">
                        <UrgencyBadge
                          level={c.triage?.urgency_level}
                          size="sm"
                          testId="case-log-urgency-badge"
                        />
                      </td>
                      <td className="py-3.5 pr-3">
                        <div className="flex flex-col items-start gap-1">
                          {(() => {
                            const badge = getReferralBadge(c);
                            const appt = getCaseBookedAppointment(c);

                            return (
                              <>
                                {/* Facility Type Badge */}
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold shadow-2xs border ${badge.color}`}
                                >
                                  <span className="text-xs shrink-0 leading-none">{badge.icon}</span>
                                  <span className="truncate">{appt?.facilityName || badge.label}</span>
                                </span>

                                {/* Booked Appointment Date & Time Badge OR Call Only */}
                                {appt ? (
                                  <span
                                    title={`OPD Appointment Booked: ${appt.facilityName || ""} · ${appt.date || ""} ${appt.timeSlot ? `(${appt.timeSlot})` : ""} · Ref #${appt.referenceNo || appt.tokenNo || ""}`}
                                    className="inline-flex items-center gap-1 rounded-md bg-orange-50 border border-orange-300 px-2 py-0.5 text-[10.5px] font-extrabold text-orange-700 shadow-2xs whitespace-nowrap"
                                  >
                                    <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-orange-600" />
                                    <span>
                                      Appointment Booked · {appt.date && appt.timeSlot
                                        ? `${appt.date} (${appt.timeSlot})`
                                        : appt.date || appt.timeSlot || `Ref: ${appt.referenceNo || appt.tokenNo}`}
                                    </span>
                                  </span>
                                ) : (
                                  <span
                                    title="Triage completed — Call Only (No appointment booked)"
                                    className="inline-flex items-center gap-1 rounded-md bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 px-2 py-0.5 text-[10.5px] font-extrabold text-purple-700 dark:text-purple-300 shadow-2xs whitespace-nowrap"
                                  >
                                    <PhoneCall className="h-3 w-3 shrink-0 text-purple-600 dark:text-purple-400" />
                                    <span>Call Only</span>
                                  </span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="py-3.5 pr-3 text-[11px] text-slate-500 whitespace-nowrap font-medium">
                        {new Date(c.created_at || Date.now()).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-3.5 pr-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            data-testid={`view-convo-${c.case_ref}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCaseForConvo(c);
                            }}
                            title={`View AI & Agent Consultation for ${c.case_ref}`}
                            className="inline-flex items-center justify-center rounded-xl border border-blue-200 bg-blue-50 p-2 text-blue-700 transition hover:bg-blue-100 hover:text-blue-800 active:scale-95 shadow-2xs cursor-pointer"
                            aria-label={`View conversation for case ${c.case_ref}`}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {canDeleteCase(c) && (
                            <button
                              type="button"
                              data-testid={`delete-case-${c.case_ref}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setCaseToDelete(c);
                              }}
                              title={`Delete case ${c.case_ref}`}
                              className="inline-flex items-center justify-center rounded-xl border border-rose-300 bg-rose-50 p-2 text-rose-700 transition hover:bg-rose-100 hover:text-rose-800 active:scale-95 shadow-2xs cursor-pointer"
                              aria-label={`Delete case ${c.case_ref}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Integrated Pagination Controls inside the Card */}
          {sortedCases.length > PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/50 px-4 py-3 text-xs">
              <div className="text-slate-500 font-medium">
                Showing <span className="font-bold text-slate-800">{startIndex + 1}</span> to{" "}
                <span className="font-bold text-slate-800">
                  {Math.min(startIndex + PAGE_SIZE, sortedCases.length)}
                </span>{" "}
                of <span className="font-bold text-slate-800">{sortedCases.length}</span> cases
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Previous
                </button>

                <span className="px-2 font-mono font-bold text-slate-800">
                  {currentPage} / {totalPages}
                </span>

                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delete Single Case Modal */}
      {caseToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-destructive font-bold text-base">
                <Trash2 className="h-5 w-5" />
                <span>Delete Case Entry</span>
              </div>
              <button
                type="button"
                onClick={() => setCaseToDelete(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to permanently delete case{" "}
              <strong className="text-foreground font-mono">{caseToDelete.case_ref}</strong> for{" "}
              <strong className="text-foreground">{caseToDelete.intake?.caller_name || "caller"}</strong>?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border flex-wrap">
              <button
                type="button"
                onClick={() => setCaseToDelete(null)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary cursor-pointer"
              >
                Cancel
              </button>
              {(caseToDelete.has_appointment || caseToDelete.booked_appointment) && (
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleCancelAppointmentOnly}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50 cursor-pointer shadow-2xs"
                >
                  {isDeleting ? "Processing..." : "Cancel Appointment Only (Keep Case)"}
                </button>
              )}
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="rounded-lg bg-destructive px-3.5 py-1.5 text-xs font-bold text-white hover:brightness-110 disabled:opacity-50 cursor-pointer shadow-2xs"
              >
                {isDeleting ? "Deleting..." : "Permanently Delete Case"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-background p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-destructive font-bold text-base">
                <Trash2 className="h-5 w-5" />
                <span>Bulk Delete Cases</span>
              </div>
              <button
                type="button"
                onClick={() => setShowBulkDeleteModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              You are about to permanently delete{" "}
              <strong className="text-destructive font-bold">{selectedKeys.size}</strong> selected case
              records. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setShowBulkDeleteModal(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isBulkDeleting}
                onClick={handleConfirmBulkDelete}
                className="rounded-lg bg-destructive px-3.5 py-1.5 text-xs font-bold text-white hover:brightness-110 disabled:opacity-50"
              >
                {isBulkDeleting ? "Deleting Cases..." : `Delete ${selectedKeys.size} Cases`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Consultation Transcript & Triage Referral View Modal */}
      {selectedCaseForConvo && (
        <CaseConversationModal
          caseItem={selectedCaseForConvo}
          allCases={cases}
          currentAgent={currentAgent}
          onCaseForwarded={(caseRef, statusData) => {
            const forwardPayload = {
              is_forwarded: true,
              status: "forwarded",
              forwarded_to: statusData.teamName,
              forwarded_short_name: statusData.shortName,
              dispatch_id: statusData.dispatchId,
              forwarded_at: new Date().toISOString(),
            };
            setCases((prev) =>
              prev.map((c) => {
                const cRef = String(c.case_ref || "").trim().toUpperCase();
                const targetRef = String(caseRef || "").trim().toUpperCase();
                return (cRef && cRef === targetRef) || c.id === caseRef
                  ? { ...c, ...forwardPayload }
                  : c;
              })
            );
            setSelectedCaseForConvo((prev) =>
              prev ? { ...prev, ...forwardPayload } : null
            );
          }}
          onClose={() => setSelectedCaseForConvo(null)}
        />
      )}
    </div>
  );
};

function formatChatTime(m, fallbackDate) {
  const ts = m?.timestamp || m?.created_at || m?.time;
  if (ts) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    }
  }
  if (m?.id) {
    const match = String(m.id).match(/\d{10,13}/);
    if (match) {
      const d = new Date(parseInt(match[0], 10));
      if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) {
        return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
      }
    }
  }
  const base = fallbackDate ? new Date(fallbackDate) : new Date();
  if (!isNaN(base.getTime())) {
    return base.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  }
  return "";
}

function CaseConversationModal({ caseItem: initialCaseItem, allCases = [], currentAgent, onCaseForwarded, onClose }) {
  const [forwardOverride, setForwardOverride] = useState(null);

  const caseItem = useMemo(() => {
    if (!initialCaseItem) return null;
    const initialUpper = String(initialCaseItem.case_ref || "").trim().toUpperCase();
    const found = allCases?.find(
      (c) => {
        const cRef = String(c.case_ref || "").trim().toUpperCase();
        return (cRef && cRef === initialUpper) || (c.id && c.id === initialCaseItem.id);
      }
    );
    const base = found ? { ...initialCaseItem, ...found } : initialCaseItem;
    return forwardOverride ? { ...base, ...forwardOverride } : base;
  }, [initialCaseItem, allCases, forwardOverride]);

  if (!caseItem) return null;

  const agentName = getAgentDisplayName(caseItem, currentAgent);
  const agentInitials = agentName ? (agentName.length > 2 ? agentName.slice(0, 2).toUpperCase() : agentName.toUpperCase()) : "AG";
  const agentCode = agentInitials;
  const triage = caseItem.triage || {};
  const intake = caseItem.intake || {};
  const nearest = caseItem.nearest_facilities?.[0];
  const primaryBadge = getReferralBadge(caseItem);
  const secondaryBadge = getSecondaryReferralBadge(caseItem);

  const bookedAppt = getCaseBookedAppointment(caseItem);
  const isCaseForwarded = Boolean(
    forwardOverride || isCaseItemForwarded(caseItem) || caseItem.is_forwarded || caseItem.forwarded_at
  );

  const forwardedTarget = String(
    forwardOverride?.forwarded_facility_name ||
    forwardOverride?.forwarded_short_name ||
    forwardOverride?.forwarded_to ||
    caseItem.forwarded_facility_name ||
    caseItem.forwarded_short_name ||
    caseItem.forwarded_to ||
    caseItem.dispatch_to ||
    bookedAppt?.facilityName ||
    bookedAppt?.facilityShortName ||
    ""
  ).trim();

  const forwardedNorm = normalizeFacilityTarget(forwardedTarget);

  const getCleanFacilityLabel = (norm, raw) => {
    if (
      raw &&
      !raw.startsWith("ESIC_") &&
      !raw.startsWith("DIST_") &&
      !raw.startsWith("ESIS_") &&
      !raw.startsWith("TIE_") &&
      !raw.startsWith("104_") &&
      !raw.startsWith("108_")
    ) {
      return raw;
    }
    switch (norm) {
      case "ESIC_HOSPITAL":
        return "ESIC Hospital (Secondary Care & Casualty)";
      case "DIST_HOSPITAL":
        return "Govt District Hospital / Public Health Desk";
      case "ESIS_DISPENSARY":
        return "ESIS Dispensary (Primary Care OPD)";
      case "TIE_UP_FACILITY":
        return "Empanelled Tie-Up Hospital";
      case "104_MEDICAL":
        return "104 Health Helpline (Tele-Doctor)";
      case "108_AMBULANCE":
        return "108 Emergency Ambulance";
      default:
        return raw || "ESIS Dispensary";
    }
  };

  const initialPrimary = triage.call_referral_primary || triage.referral_destination || nearest?.name || "ESIS Dispensary";
  const initialSecondary = triage.call_referral_secondary || triage.secondary_referral_destination || "104 Health Helpline";

  let card1Name = initialPrimary;
  let card1IsForwarded = false;
  let card2Name = initialSecondary;
  let card2IsForwarded = false;

  if (isCaseForwarded && forwardedNorm) {
    const rawPrimaryNorm = normalizeFacilityTarget(initialPrimary);
    const rawSecondaryNorm = normalizeFacilityTarget(initialSecondary);

    if (forwardedNorm === rawSecondaryNorm && forwardedNorm !== rawPrimaryNorm) {
      card1Name = initialPrimary;
      card1IsForwarded = false;
      card2Name = getCleanFacilityLabel(forwardedNorm, forwardedTarget);
      card2IsForwarded = true;
    } else {
      card1Name = getCleanFacilityLabel(forwardedNorm, forwardedTarget);
      card1IsForwarded = true;
      if (["ESIC_HOSPITAL", "DIST_HOSPITAL", "ESIS_DISPENSARY", "TIE_UP_FACILITY"].includes(forwardedNorm)) {
        card2Name = "104 Health Helpline (24x7 Doctor on Call)";
      } else if (forwardedNorm === "104_MEDICAL") {
        card2Name = "ESIS Dispensary (Primary Care OPD)";
      } else if (forwardedNorm === "108_AMBULANCE") {
        card2Name = "ESIC Hospital Casualty (24x7 Emergency)";
      }
      card2IsForwarded = false;
    }
  }

  const getDestinationMeta = (cardName, isForwarded) => {
    const norm = normalizeFacilityTarget(cardName);
    const is104 = norm === "104_MEDICAL" || String(cardName).includes("104");
    const is108 = norm === "108_AMBULANCE" || String(cardName).includes("108");

    if (is104) {
      return {
        type: "104",
        subtext: "📞 24x7 Doctor on Call Tele-Consultation (Toll-Free)",
        icon: PhoneCall,
        iconColor: "text-blue-600",
        borderClass: isForwarded
          ? "border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20 ring-1 ring-emerald-500/30"
          : "border-blue-300 dark:border-blue-800 bg-white dark:bg-card",
        distance: null,
      };
    }

    if (is108) {
      return {
        type: "108",
        subtext: "🚑 24x7 Emergency Ambulance Dispatch",
        icon: Ambulance,
        iconColor: "text-rose-600",
        borderClass: isForwarded
          ? "border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20 ring-1 ring-emerald-500/30"
          : "border-rose-300 dark:border-rose-800 bg-white dark:bg-card",
        distance: null,
      };
    }

    const facs = Array.isArray(caseItem.nearest_facilities) ? caseItem.nearest_facilities : [];
    const cleanCard = String(cardName).toLowerCase();
    const matchedFac = facs.find((f) => {
      const fn = (f.name || "").toLowerCase();
      return fn === cleanCard || cleanCard.includes(fn) || fn.includes(cleanCard);
    });

    let dist = matchedFac?.distance_km ?? nearest?.distance_km;
    if (dist == null) dist = 0.5;

    const isDisp = norm === "ESIS_DISPENSARY" || cleanCard.includes("dispensary");
    const subtext = isDisp ? "OPD: Mon–Fri 10:00 AM – 4:00 PM" : "Open · IPD & Casualty: 24x7";

    return {
      type: "facility",
      subtext,
      icon: Building2,
      iconColor: isDisp ? "text-emerald-600" : "text-purple-600",
      borderClass: isForwarded
        ? "border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20 ring-1 ring-emerald-500/30"
        : "border-emerald-300 dark:border-emerald-800 bg-white dark:bg-card",
      distance: dist != null ? Math.round(Number(dist) * 10) / 10 : 0.5,
    };
  };

  // Scope transcript strictly to this single triage conversation
  const singleCaseTranscript = useMemo(() => {
    const hist =
      caseItem.ekms_ai_context?.chatHistory ||
      caseItem.chatHistory ||
      caseItem.chat_history;
    if (Array.isArray(hist) && hist.length > 0) return hist;
    return null;
  }, [caseItem]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal Dialog Card */}
      <div className="relative z-10 flex flex-col w-full max-w-3xl max-h-[92vh] rounded-2xl border border-border bg-background shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border/80 bg-linear-to-r from-blue-50/70 via-background to-secondary/40 dark:from-blue-950/30 dark:via-background dark:to-secondary/20 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-foreground">
                  AI & Agent Consultation
                </h3>
                <span className="mono rounded-md bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20 px-2 py-0.5 text-xs font-bold font-mono">
                  {caseItem.caller_id || caseItem.intake?.caller_id || getCallerIdForPhone(caseItem.intake?.phone)}
                </span>
                <span className="mono rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-xs font-bold">
                  {caseItem.case_ref}
                </span>
                <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-bold text-foreground border border-border">
                  {agentName}
                </span>
                <UrgencyBadge level={triage.urgency_level} size="sm" />
                {(() => {
                  const bAppt = getCaseBookedAppointment(caseItem);
                  if (bAppt) {
                    return (
                      <span className="inline-flex items-center gap-1 text-xs font-extrabold text-orange-800 dark:text-orange-200 bg-orange-100 dark:bg-orange-950/80 px-2.5 py-0.5 rounded-md border border-orange-500/50 shadow-2xs">
                        <Calendar className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />{" "}
                        {bAppt.date && bAppt.timeSlot
                          ? `${bAppt.date} (${bAppt.timeSlot})`
                          : `Ref: ${bAppt.referenceNo || bAppt.tokenNo}`}
                      </span>
                    );
                  }
                  return (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-purple-700 dark:text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded-md border border-purple-500/20">
                      <PhoneCall className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                      Call Only
                    </span>
                  );
                })()}
              </div>
              <p className="mt-1 text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-semibold text-foreground">
                  Caller: {intake.caller_name || "Caller"}
                </span>
                {intake.phone && (
                  <span className="mono font-semibold">({intake.phone})</span>
                )}
                {(intake.age || intake.sex) && (
                  <span>
                    &bull; {[intake.age ? `${intake.age}y` : null, intake.sex].filter(Boolean).join(" ")}
                  </span>
                )}
                {(intake.city || intake.district) && (
                  <span>&bull; {intake.city || intake.district}</span>
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Conversation Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/50 dark:bg-background">
          <div className="flex items-center justify-center my-1">
            <span className="rounded-full bg-border/60 px-3 py-1 text-[10px] font-semibold text-muted-foreground tracking-wide uppercase">
              Consultation Started &bull; {new Date(caseItem.created_at || Date.now()).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>

          {singleCaseTranscript ? (
            /* Render recorded live chatHistory for this single case */
            singleCaseTranscript.map((m, idx) => {
              const isAgent = m.sender === "user" || m.role === "user";
              return (
                <div
                  key={m.id || idx}
                  className={`flex items-start gap-2.5 ${isAgent ? "flex-row-reverse" : "flex-row"}`}
                >
                  {/* Avatar */}
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-2xs ${
                      isAgent
                        ? "bg-slate-800 text-white dark:bg-slate-700"
                        : "bg-blue-600 text-white"
                    }`}
                  >
                    {isAgent ? agentCode : <Bot className="h-4 w-4" />}
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`max-w-[82%] sm:max-w-[75%] rounded-2xl p-3.5 shadow-2xs space-y-1.5 ${
                      isAgent
                        ? "bg-primary text-primary-foreground rounded-tr-xs"
                        : "border border-border bg-white dark:bg-card text-foreground rounded-tl-xs"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[10px] opacity-80 font-semibold">
                      <div className="flex items-center gap-1.5">
                        <span className={isAgent ? "text-primary-foreground font-bold" : "text-blue-600 dark:text-blue-400 font-bold"}>
                          {isAgent ? agentName : "EKMS AI Assistant"}
                        </span>
                        <span className={`text-[10px] font-medium ${isAgent ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                          &bull; {formatChatTime(m, caseItem.created_at)}
                        </span>
                      </div>
                      {isAgent && (m.isVoice === true || m.source === "voice") && (
                        <span className="rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-bold tracking-wide uppercase">
                          Voice NLP
                        </span>
                      )}
                    </div>

                    <p className="text-xs sm:text-[13px] leading-relaxed whitespace-pre-wrap">
                      {m.text || m.content}
                    </p>

                    {/* Probing suggestion chips if any */}
                    {Array.isArray(m.suggestions) && m.suggestions.length > 0 && (
                      <div className="pt-2 mt-1 border-t border-border/50 flex flex-wrap gap-1.5">
                        <span className="text-[10px] font-bold text-muted-foreground block w-full">
                          AI Suggested Answer Chips:
                        </span>
                        {m.suggestions.map((chip, cIdx) => (
                          <span
                            key={cIdx}
                            className="rounded-full bg-secondary/80 border border-border px-2 py-0.5 text-[10px] font-medium text-foreground"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            /* Reconstruct clean conversational transcript for direct/legacy cases */
            <div className="space-y-4">
              {/* Turn 1: Agent Intake */}
              <div className="flex items-start gap-2.5 flex-row-reverse">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-white text-xs font-bold shadow-2xs">
                  {agentCode}
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-tr-xs p-3.5 shadow-2xs bg-primary text-primary-foreground space-y-1">
                  <div className="flex items-center justify-between text-[10px] opacity-80 font-semibold">
                    <div className="flex items-center gap-1.5">
                      <span>{agentName} (Caller Intake)</span>
                      <span className="font-normal opacity-75">&bull; {formatChatTime(null, caseItem.created_at)}</span>
                    </div>
                  </div>
                  <p className="text-xs sm:text-[13px] leading-relaxed">
                    {intake.symptom_notes || triage.summary_en || "Caller arrived with acute health inquiry."}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1 text-[10px] opacity-90 font-medium">
                    {intake.duration && <span>Duration: {intake.duration}</span>}
                    {intake.severity_reported && <span>Reported Severity: {normalizeUrgency(intake.severity_reported)}</span>}
                  </div>
                </div>
              </div>

              {/* Turn 2: AI Probing & Clinical Screening */}
              <div className="flex items-start gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-2xs">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-tl-xs p-3.5 shadow-2xs border border-border bg-white dark:bg-card text-foreground space-y-2">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground font-semibold">
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-1 text-blue-600 font-bold">
                        <Sparkles className="h-3 w-3" /> EKMS AI Clinical Probing
                      </span>
                      <span className="font-normal text-muted-foreground">&bull; {formatChatTime(null, caseItem.created_at)}</span>
                    </div>
                  </div>
                  
                  {Array.isArray(triage.followup_questions) && triage.followup_questions.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-xs text-foreground/90 font-medium">
                        Screened against clinical red-flag protocols. Probing questions asked:
                      </p>
                      <ul className="list-disc pl-4 text-xs space-y-1 text-foreground/80">
                        {triage.followup_questions.map((q, qIdx) => (
                          <li key={qIdx}>{q}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-xs sm:text-[13px] leading-relaxed">
                      Conducted real-time symptom analysis and cross-referenced emergency danger signs.
                    </p>
                  )}

                  {Array.isArray(triage.red_flags) && triage.red_flags.length > 0 && (
                    <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 p-2 space-y-1">
                      <span className="text-[10px] font-bold text-rose-800 dark:text-rose-300 uppercase tracking-wide flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-rose-600" /> Danger Signs Evaluated:
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {triage.red_flags.map((rf, rIdx) => (
                          <span
                            key={rIdx}
                            className="rounded-full bg-rose-100 dark:bg-rose-900/80 text-rose-900 dark:text-rose-200 border border-rose-300 text-[10px] px-2 py-0.5 font-medium"
                          >
                            {rf}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Turn 3: Agent Verification */}
              <div className="flex items-start gap-2.5 flex-row-reverse">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-white text-xs font-bold shadow-2xs">
                  {agentCode}
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-tr-xs p-3 shadow-2xs bg-primary/90 text-primary-foreground space-y-1">
                  <div className="text-[10px] opacity-80 font-semibold flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span>{agentName} (Probing Completed)</span>
                      <span className="font-normal opacity-75">&bull; {formatChatTime(null, caseItem.created_at)}</span>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed">
                    Verified caller location ({intake.district || intake.city || "Assam District"}, PIN: {intake.pincode || "Mapped"}) and confirmed symptom severity. Requesting final dispatch referral.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Final Outcome Card inside Transcript */}
          <div className="mt-4 rounded-xl border border-emerald-300/80 bg-linear-to-b from-emerald-50/70 to-white dark:from-emerald-950/30 dark:to-card p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200/60 dark:border-emerald-900/40 pb-2">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
                  Triage Decision & Dual Referral Architecture
                </span>
              </div>
              <UrgencyBadge level={triage.urgency_level} size="sm" />
            </div>

            <div className="text-xs space-y-1 text-slate-800 dark:text-slate-200">
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                {triage.summary_en || triage.recommended_action}
              </p>
              {triage.reasoning && (
                <p className="text-[11.5px] leading-relaxed text-muted-foreground pt-1">
                  <strong className="text-foreground">Clinical Rationale:</strong> {triage.reasoning}
                </p>
              )}
            </div>

            {/* Destination Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {/* Primary Destination Card */}
              {(() => {
                const meta1 = getDestinationMeta(card1Name, card1IsForwarded);
                const Icon1 = meta1.icon;
                return (
                  <div className={`rounded-lg border p-2.5 space-y-1 text-xs shadow-2xs ${meta1.borderClass}`}>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase">
                        Primary Destination
                      </div>
                    </div>
                    <div className="font-bold text-foreground flex items-center gap-1.5 truncate">
                      <Icon1 className={`h-3.5 w-3.5 ${meta1.iconColor} shrink-0`} />
                      <span className="truncate">{card1Name}</span>
                    </div>
                    <div className="space-y-0.5 pt-0.5">
                      {meta1.distance != null && (
                        <p className="text-[10.5px] font-semibold text-emerald-800 dark:text-emerald-300 font-mono">
                          📍 Distance: {meta1.distance} km
                        </p>
                      )}
                      <p className="text-[10.5px] text-muted-foreground">
                        {meta1.subtext}
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* Secondary Destination Card */}
              {(() => {
                const meta2 = getDestinationMeta(card2Name, card2IsForwarded);
                const Icon2 = meta2.icon;
                return (
                  <div className={`rounded-lg border p-2.5 space-y-1 text-xs shadow-2xs ${meta2.borderClass}`}>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-bold text-blue-800 dark:text-blue-300 uppercase">
                        Secondary Destination
                      </div>
                    </div>
                    <div className="font-bold text-foreground flex items-center gap-1.5 truncate">
                      <Icon2 className={`h-3.5 w-3.5 ${meta2.iconColor} shrink-0`} />
                      <span className="truncate">{card2Name}</span>
                    </div>
                    <div className="space-y-0.5 pt-0.5">
                      {meta2.distance != null && (
                        <p className="text-[10.5px] font-semibold text-emerald-800 dark:text-emerald-300 font-mono">
                          📍 Distance: {meta2.distance} km
                        </p>
                      )}
                      <p className="text-[10.5px] text-muted-foreground">
                        {meta2.subtext}
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Booked OPD Appointment Card (Below Dual Forwards) OR Call Only Banner */}
            {(() => {
              const bookedAppt = getCaseBookedAppointment(caseItem);
              if (!bookedAppt) {
                return (
                  <div className="mt-2.5 rounded-xl border border-purple-200/90 dark:border-purple-800/80 bg-purple-50/60 dark:bg-purple-950/30 p-3 sm:p-3.5 space-y-1 text-xs">
                    <div className="flex items-center gap-1.5">
                      <PhoneCall className="h-4 w-4 text-purple-600 dark:text-purple-400 shrink-0" />
                      <span className="font-extrabold uppercase text-[11px] text-purple-900 dark:text-purple-200 tracking-wider">
                        Call Only — No OPD Appointment Booked
                      </span>
                    </div>
                    <p className="text-[11px] text-purple-800/80 dark:text-purple-300/80">
                      This case was completed via clinical triage advisory and phone consultation. No appointment or slot booked.
                    </p>
                  </div>
                );
              }
              return (
                <div className="mt-2.5 rounded-xl border border-orange-400/90 bg-linear-to-r from-orange-50/90 to-amber-50/70 dark:from-orange-950/50 dark:to-amber-950/40 p-3 sm:p-3.5 space-y-2 text-xs shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-orange-200/80 dark:border-orange-900/60 pb-2">
                    <div className="flex items-center gap-1.5">
                      <CalendarCheck className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                      <span className="font-extrabold uppercase text-[11px] text-orange-950 dark:text-orange-200 tracking-wider">
                        Official OPD Appointment Booked
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-md bg-orange-600 text-white px-2.5 py-0.5 text-xs font-mono font-black shadow-2xs">
                      Ref No: {bookedAppt.referenceNo || bookedAppt.tokenNo}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-foreground font-medium pt-0.5">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                        Facility &amp; Department
                      </span>
                      <span className="font-bold flex items-center gap-1 mt-0.5 text-foreground">
                        <Building2 className="h-3.5 w-3.5 text-orange-600 shrink-0" />
                        {bookedAppt.facilityName}
                      </span>
                      <span className="text-[11px] text-muted-foreground block">
                        {bookedAppt.department}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                        Date, Time Slot &amp; Department
                      </span>
                      <span className="font-bold flex items-center gap-1 mt-0.5 text-foreground">
                        <Calendar className="h-3.5 w-3.5 text-orange-600 shrink-0" />
                        {bookedAppt.date} ({bookedAppt.timeSlot})
                      </span>
                      {bookedAppt.department && (
                        <span className="text-[11px] text-muted-foreground block">
                          {bookedAppt.department}
                        </span>
                      )}
                    </div>
                  </div>

                  {bookedAppt.chiefComplaint && (
                    <div className="border-t border-orange-200/80 dark:border-orange-900/60 pt-2 text-[11px]">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                        Chief Reason:
                      </span>
                      <p className="text-foreground mt-0.5 font-medium leading-relaxed bg-white/70 dark:bg-card/70 p-2 rounded-lg border border-orange-200/60 dark:border-orange-900/40">
                        {bookedAppt.chiefComplaint}
                      </p>
                    </div>
                  )}

                  {bookedAppt.redFlags && bookedAppt.redFlags.length > 0 && (
                    <div className="text-[11px]">
                      <span className="text-[10px] uppercase font-bold text-rose-600 dark:text-rose-400 block">
                        Clinical Red Flags:
                      </span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {bookedAppt.redFlags.map((flag, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 rounded bg-rose-100 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-800 px-2 py-0.5 text-[10.5px] font-bold text-rose-800 dark:text-rose-200"
                          >
                            • {typeof flag === "string" ? flag : flag.label || String(flag)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {bookedAppt.agentNotes && (
                    <div className="text-[11px]">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                        Agent Visit Notes:
                      </span>
                      <p className="text-foreground mt-0.5 italic bg-white/70 dark:bg-card/70 p-2 rounded-lg border border-orange-200/60 dark:border-orange-900/40">
                        {bookedAppt.agentNotes}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border bg-background px-4 py-3 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground text-[11px]">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              Logged {new Date(caseItem.created_at || Date.now()).toLocaleString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-secondary px-4 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary/80 transition-colors shadow-2xs cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
