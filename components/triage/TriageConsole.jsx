"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Loader2,
  Sparkles,
  Crosshair,
  RotateCcw,
  UserCheck,
  History,
  CalendarClock,
  Navigation,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Stethoscope,
  User,
  Lock,
  HelpCircle,
  FileCheck,
  CalendarCheck,
  Building2,
  Zap,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { api, normalizeUrgency } from "@/lib/api";
import { TriageResultPanel } from "./TriageResultPanel";
import { EkmsAiChatArea } from "./EkmsAiChatArea";
import { NonClinicalEnquiryForm } from "./NonClinicalEnquiryForm";
import { UrgencyBadge } from "./UrgencyBadge";
import { extractClinicalEntities } from "@/lib/clinicalAdaptiveEngine";
import { broadcastEvent, sendIpToEkmsData } from "@/lib/broadcastSync";
import { appendCaseToLocalCache, getCachedCases, getOrCreateClientSyncId, getCachedStats, setCachedStats } from "@/lib/clientCache";
import { logSystemActivity, formatAgentDisplayName } from "@/lib/activityLogger";
import { getFirestoreDb } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import { CallerHistorySection, getCallerIdForPhone } from "./CallerHistorySection";
import { recordTriageCaseToSheet } from "@/lib/googleSheetsSync";

export const sanitizeIpNumber = (val) => {
  if (!val) return "";
  const cleaned = String(val).trim().replace(/\D/g, "");
  // If IP no is not available, or "0", or <= 4 digits, do not take it; only accept if > 4 digits and not 0!
  if (cleaned.length > 4 && parseInt(cleaned, 10) > 0) {
    return cleaned;
  }
  return "";
};

export const sanitizeCallerName = (val) => {
  if (!val) return "";
  return String(val)
    .replace(/\s+Last\s+Nam(?:e)?$/i, "")
    .replace(/\s+Enter\s+last\s+name$/i, "")
    .trim();
};

export const sanitizeAge = (val) => {
  if (!val) return "";
  const cleaned = String(val).replace(/\D/g, "");
  if (!cleaned) return "";
  const num = parseInt(cleaned, 10);
  if (isNaN(num) || num <= 0) return "";
  const currentYear = new Date().getFullYear();
  // Support 4-digit birth year conversion e.g. 1985 -> 41
  if (num >= 1900 && num <= currentYear) {
    const calculated = currentYear - num;
    return (calculated >= 0 && calculated <= 120) ? String(calculated) : "";
  }
  // Strictly only valid human age 1 to 120 (rejects pincodes, IDs, and phone fragments)
  if (num >= 1 && num <= 120) {
    return String(num);
  }
  return "";
};

const ASSAM_DISTRICTS = [
  "Baksa", "Barpeta", "Bongaigaon", "Cachar", "Charaideo", "Chirang", "Darrang",
  "Dhemaji", "Dhubri", "Dibrugarh", "Dima Hasao", "Goalpara", "Golaghat", "Hailakandi",
  "Hojai", "Jorhat", "Kamrup Metro", "Kamrup Rural", "Karbi Anglong", "Karimganj",
  "Kokrajhar", "Lakhimpur", "Majuli", "Marigaon", "Nagaon", "Nalbari", "Sivasagar",
  "Sonitpur", "Tinsukia", "Udalguri",
];

export const extractAssamDistrict = (raw) => {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s || /select/i.test(s) || /^n\/?a$/i.test(s)) return "";

  const exact = ASSAM_DISTRICTS.find((d) => d.toLowerCase() === s.toLowerCase());
  if (exact) return exact;

  const lower = s.toLowerCase();
  if (lower.includes("metro") || lower.includes("guwahati") || lower === "kamrup m" || lower === "kamrup (m)") {
    return "Kamrup Metro";
  }
  if (lower.includes("rural") || lower === "kamrup r" || lower === "kamrup (r)") {
    return "Kamrup Rural";
  }

  // Extract from first 4 letters, then first 3 letters
  const prefix4 = lower.slice(0, 4);
  const prefix3 = lower.slice(0, 3);

  if (prefix4.length >= 4) {
    const match4 = ASSAM_DISTRICTS.find((d) => d.toLowerCase().startsWith(prefix4));
    if (match4) return match4;
  }

  if (prefix3.length >= 3) {
    const match3 = ASSAM_DISTRICTS.find((d) => d.toLowerCase().startsWith(prefix3));
    if (match3) return match3;
  }

  const contains = ASSAM_DISTRICTS.find((d) => lower.includes(d.toLowerCase()) || d.toLowerCase().includes(lower));
  if (contains) return contains;

  return s;
};

const EMPTY = {
  caller_name: "",
  phone: "",
  caller_id: "",
  ip_number: "",
  age: "",
  sex: "",
  symptom_notes: "",
  duration: "",
  severity_reported: 5,
  city: "",
  district: "",
  pincode: "",
  latitude: "",
  longitude: "",
};

const inputCls =
  "w-full rounded-xl border border-border/80 bg-background px-3 py-2 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-2xs";

const Field = ({ label, children, className = "" }) => (
  <div className={`min-w-0 ${className}`}>
    <label className="field-label text-[10px] sm:text-[11px] mb-1 sm:mb-1.5 truncate">{label}</label>
    {children}
  </div>
);

export const TriageConsole = ({ meta, onCaseCreated, currentAgent, onOpenLogin }) => {
  const isAdmin = Boolean(
    currentAgent &&
    (String(currentAgent?.role || "").toLowerCase() === "admin" ||
     String(currentAgent?.role || "").toLowerCase() === "master admin" ||
     Boolean(currentAgent?.isAdmin) ||
     Boolean(currentAgent?.isMasterAdmin))
  );

  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const setActiveRightTab = () => {}; // Safe no-op helper for triage view
  const [activeDirective, setActiveDirective] = useState(null);
  const [ekmsContext, setEkmsContext] = useState(null);
  const [chatPresetTrigger, setChatPresetTrigger] = useState("");
  const [callerFoundInfo, setCallerFoundInfo] = useState(null);
  const [callerHistory, setCallerHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isNonClinical, setIsNonClinical] = useState(false);
  const [nonClinicalForm, setNonClinicalForm] = useState({
    enquiryType: "NA",
    chiefIssue: "",
    remarks: "",
  });
  const lastLookedUpRef = useRef("");
  const chatRef = useRef(null);
  const outcomeRef = useRef(null);

  const set = (k) => (e) => {
    let val = e.target.value;
    if (k === "pincode") {
      val = val.replace(/\D/g, "").slice(0, 6);
    }
    setForm((f) => ({ ...f, [k]: val }));
    if (result) {
      setResult(null);
      setActiveDirective(null);
    }
  };

  const activeCallerId = useMemo(() => {
    const rawDigits = String(form.phone || "").replace(/\D/g, "");
    const clean10 = rawDigits.length >= 10 ? rawDigits.slice(-10) : rawDigits;
    if (clean10.length === 10) {
      return getCallerIdForPhone(clean10, callerHistory);
    }
    if (form.caller_id && /^CID/i.test(form.caller_id)) return form.caller_id;
    if (callerFoundInfo?.caller_id && /^CID/i.test(callerFoundInfo.caller_id)) return callerFoundInfo.caller_id;
    if (clean10.length >= 3) {
      return getCallerIdForPhone(clean10);
    }
    return form.caller_id || callerFoundInfo?.caller_id || "";
  }, [form.caller_id, form.phone, callerFoundInfo, callerHistory]);

  // 1. Session Storage persistence: restore state on initial mount so refreshing inside triage preserves data
  const hasRestoredSessionRef = useRef(false);

  useEffect(() => {
    return () => {
      // Once agent leaves the home page, clear all active session caches and chat instantly
      try {
        sessionStorage.removeItem("ekms_active_triage_session");
        sessionStorage.removeItem("ekms_active_ai_chat_session");
        sessionStorage.removeItem("ekms_main_ai_chat_session");
        localStorage.removeItem("ekms_main_ai_chat_session");
        sessionStorage.removeItem("ekms_active_case_forwarded");
        sessionStorage.removeItem("ekms_active_case_result");
        sessionStorage.removeItem("ekms_active_beneficiary_intake");
        chatRef.current?.resetChat();
      } catch (e) {}
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || hasRestoredSessionRef.current) return;
    hasRestoredSessionRef.current = true;
    try {
      const stored = sessionStorage.getItem("ekms_active_triage_session");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.form && (parsed.form.phone || parsed.form.caller_name || parsed.form.symptom_notes)) {
          if (parsed.form.caller_name === "." || parsed.form.caller_name === "'") parsed.form.caller_name = "";
          if (parsed.form.pincode && !/^\d{6}$/.test(String(parsed.form.pincode).trim())) {
            if (!parsed.form.city) parsed.form.city = String(parsed.form.pincode).trim();
            parsed.form.pincode = "";
          }
          setForm(parsed.form);
        }
        // Never restore an already-forwarded completed case into active intake!
        if (parsed.result && !parsed.result.is_forwarded && !parsed.result.forwarded_at) {
          setResult(parsed.result);
        }
        if (parsed.callerFoundInfo) {
          const storedPhone10 = (parsed.callerFoundInfo.phone || "").replace(/\D/g, "").slice(-10);
          const formPhone10 = (parsed.form?.phone || "").replace(/\D/g, "").slice(-10);
          if (storedPhone10.length === 10 && storedPhone10 === formPhone10) {
            setCallerFoundInfo(parsed.callerFoundInfo);
            if (Array.isArray(parsed.callerHistory) && parsed.callerHistory.length > 0) {
              setCallerHistory(parsed.callerHistory);
            }
          } else {
            setCallerFoundInfo(null);
            setCallerHistory([]);
          }
        }
        if (parsed.activeDirective) {
          setActiveDirective(parsed.activeDirective);
        }
        if (parsed.ekmsContext) {
          setEkmsContext(parsed.ekmsContext);
        }
      }
    } catch (e) {
      console.warn("Could not restore triage session from storage:", e);
    }
  }, []);

  // 2. Save active state to sessionStorage on changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const sessionData = {
        form,
        result,
        callerHistory,
        callerFoundInfo,
        activeDirective,
        ekmsContext,
      };
      sessionStorage.setItem("ekms_active_triage_session", JSON.stringify(sessionData));
    } catch (e) {}
  }, [form, result, callerHistory, callerFoundInfo, activeDirective, ekmsContext]);

  // 3. Auto-save intake draft to database on beforeunload / refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      // If a case is already triaged (result exists), do NOT auto-create a draft case!
      if (result) return;
      const cleanPhone = String(form.phone || "").replace(/\D/g, "");
      if (cleanPhone.length >= 10 && (form.caller_name || form.symptom_notes)) {
        const draftPayload = JSON.stringify({
          phone: form.phone,
          caller_name: form.caller_name || "Caller",
          age: form.age ? Number(form.age) : null,
          sex: form.sex || null,
          symptom_notes: form.symptom_notes || "Triage consultation intake",
          duration: form.duration || null,
          severity_reported: Number(form.severity_reported) || 5,
          city: form.city || null,
          district: form.district || null,
          pincode: form.pincode || null,
          latitude: form.latitude ? Number(form.latitude) : null,
          longitude: form.longitude ? Number(form.longitude) : null,
          ekms_ai_context: ekmsContext,
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/caller/draft", new Blob([draftPayload], { type: "application/json" }));
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [form, ekmsContext, result]);

  // Caller history lookup by phone number - works instantly in 0ms without waiting
  const lookupCaller = useCallback(async (phoneNumber, force = false, preserveForm = false) => {
    if (!phoneNumber) {
      setCallerFoundInfo(null);
      setCallerHistory([]);
      return;
    }
    const clean = String(phoneNumber).replace(/\D/g, "");
    const query = clean.length >= 10 ? clean.slice(-10) : "";
    if (query.length !== 10) {
      setCallerFoundInfo(null);
      setCallerHistory([]);
      lastLookedUpRef.current = "";
      return;
    }
    lastLookedUpRef.current = query;

    // STEP 1: INSTANT LOCAL CLIENT CACHE CHECK (0ms)
    // Check browser-cached cases right away without ANY network delay!
    const localCases = getCachedCases();
    const localMatches = Array.isArray(localCases)
      ? localCases.filter((item) => {
          const rawIp = String(item.intake?.phone || "").replace(/\D/g, "");
          const ip10 = rawIp.length >= 10 ? rawIp.slice(-10) : "";
          return ip10.length === 10 && ip10 === query;
        })
      : [];

    // Deduplicate any repeated cases in client cache
    const seenCaseKeys = new Set();
    const uniqueLocalMatches = [];
    for (const item of localMatches) {
      const matchKey = item.id || (item.case_ref ? `${item.case_ref}_${item.created_at || ""}` : null);
      if (matchKey && seenCaseKeys.has(matchKey)) continue;
      if (matchKey) seenCaseKeys.add(matchKey);
      uniqueLocalMatches.push(item);
    }

    if (uniqueLocalMatches.length > 0) {
      const latestLocal = uniqueLocalMatches[0];
      const intake = latestLocal.intake || {};
      const cleanCallerName =
        intake.caller_name && intake.caller_name.trim() !== "." && intake.caller_name.trim() !== "'"
          ? intake.caller_name
          : "";
      const resolvedCid =
        latestLocal.caller_id ||
        latestLocal.intake?.caller_id ||
        getCallerIdForPhone(query, uniqueLocalMatches);
      const resolvedIp = sanitizeIpNumber(latestLocal.ip_number || latestLocal.intake?.ip_number || latestLocal.intake?.ipNumber);
      const callerInfo = {
        caller_name: cleanCallerName,
        phone: intake.phone || phoneNumber,
        caller_id: resolvedCid,
        ip_number: resolvedIp,
        age: sanitizeAge(intake.age),
        sex: intake.sex && intake.sex !== "." ? intake.sex : "",
        city: intake.city && intake.city !== "." ? intake.city : "",
        district: intake.district && intake.district !== "." ? intake.district : "",
        pincode: intake.pincode && intake.pincode !== "Kamrup Metro" ? intake.pincode : "",
        latitude: intake.latitude ? String(intake.latitude) : "",
        longitude: intake.longitude ? String(intake.longitude) : "",
        last_case_ref: latestLocal.case_ref || "",
        case_count: uniqueLocalMatches.length,
      };

      if (!preserveForm) {
        setForm((f) => ({
          ...f,
          phone: phoneNumber,
          caller_id: resolvedCid,
          caller_name: cleanCallerName || f.caller_name || "",
          ip_number: resolvedIp || (sanitizeIpNumber(f.ip_number) ? f.ip_number : ""),
          age: callerInfo.age || f.age || "",
          sex: callerInfo.sex || f.sex || "",
          city: callerInfo.city || f.city || "",
          district: callerInfo.district || f.district || "",
          pincode: callerInfo.pincode || f.pincode || "",
          latitude: callerInfo.latitude || f.latitude || "",
          longitude: callerInfo.longitude || f.longitude || "",
        }));
      } else {
        setForm((f) => ({
          ...f,
          caller_id: f.caller_id && f.caller_id !== "Pending phone..." ? f.caller_id : resolvedCid,
        }));
      }
      setCallerFoundInfo(callerInfo);
      setCallerHistory(
        uniqueLocalMatches.map((c, i) => ({
          id: c.id || `${c.case_ref || "call"}_${c.created_at || ""}_${i}`,
          case_ref: c.case_ref || "",
          caller_id: c.caller_id || c.intake?.caller_id || resolvedCid,
          created_at: c.created_at || "",
          caller_name: c.intake?.caller_name || "",
          chief_complaint:
            c.triage?.primary_complaint || c.intake?.symptom_notes || c.triage?.summary_en || "",
          reason: c.intake?.symptom_notes || c.triage?.summary_en || "",
          summary: c.triage?.summary_en || "",
          red_flags:
            Array.isArray(c.triage?.red_flags) && c.triage.red_flags.length > 0
              ? c.triage.red_flags
              : c.ekms_ai_context?.triageState?.redFlagsDetected || [],
          urgency_level: normalizeUrgency(c.triage?.urgency_level) || "Mild",
          urgency_score: c.triage?.urgency_score || 0,
          navigation: c.triage?.recommended_action || c.triage?.recommended_facility_type || "",
          recommended_action: c.triage?.recommended_action || "",
          recommended_facility_type: c.triage?.recommended_facility_type || "",
          booked_appointment: c.booked_appointment || null,
          has_appointment: Boolean(c.booked_appointment),
          status: c.booked_appointment ? "booked" : (c.status || "call_only"),
        }))
      );
      setIsLookingUp(false);
      if (!preserveForm) {
        toast.success(
          `Record found for ${cleanCallerName || phoneNumber}: Details loaded instantly.`
        );
      }

      // Silent non-blocking background refresh
      fetch(`/api/caller/lookup?phone=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(2500),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data?.found && data?.caller) {
            setCallerFoundInfo((prev) => ({ ...prev, ...data.caller }));
            if (Array.isArray(data.history) && data.history.length > 0) {
              setCallerHistory(data.history);
            }
          }
        })
        .catch(() => {});
      return;
    }

    // STEP 2: Not in client cache, perform server query with fast timeout
    setIsLookingUp(true);
    try {
      const res = await fetch(`/api/caller/lookup?phone=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(2000),
      });
      const data = await res.json();
      if (data && data.found && data.caller) {
        const c = data.caller;
        const cleanCallerName =
          c.caller_name && c.caller_name.trim() !== "." && c.caller_name.trim() !== "'"
            ? c.caller_name
            : "";
        const resolvedCid = c.caller_id || getCallerIdForPhone(query, data.history);
        const resolvedIp = sanitizeIpNumber(c.ip_number) || sanitizeIpNumber(c.ipNumber) || "";
        c.caller_id = resolvedCid;
        c.ip_number = resolvedIp;
        if (!preserveForm) {
          setForm((f) => ({
            ...f,
            phone: phoneNumber,
            caller_id: resolvedCid,
            caller_name: cleanCallerName || f.caller_name || "",
            ip_number: resolvedIp || (sanitizeIpNumber(f.ip_number) ? f.ip_number : ""),
            age: sanitizeAge(c.age) || (f.age || ""),
            sex: c.sex || f.sex || "",
            city: c.city || f.city || "",
            district: c.district || f.district || "",
            pincode: (c.pincode && c.pincode !== "Kamrup Metro") ? c.pincode : (f.pincode || ""),
            latitude: c.latitude ? String(c.latitude) : (f.latitude || ""),
            longitude: c.longitude ? String(c.longitude) : (f.longitude || ""),
          }));
        } else {
          setForm((f) => ({
            ...f,
            caller_id: f.caller_id && f.caller_id !== "Pending phone..." ? f.caller_id : resolvedCid,
          }));
        }
        setCallerFoundInfo(c);
        if (data.history && Array.isArray(data.history)) {
          setCallerHistory(data.history);
        } else {
          setCallerHistory([]);
        }
        if (!preserveForm) {
          toast.success(
            `Record found for ${cleanCallerName || phoneNumber}: Details loaded.`
          );
        }
      } else {
        // Brand New Number: Clear all previous returning caller state completely!
        const newCid = data?.caller_id || getCallerIdForPhone(query);
        setCallerFoundInfo(null);
        setCallerHistory([]);
        setHistoryPage(1);
        setForm((f) => ({
          ...f,
          phone: phoneNumber,
          caller_id: newCid,
          caller_name: f.caller_name === "." ? "" : f.caller_name,
          pincode: f.pincode === "Kamrup Metro" ? "" : f.pincode,
        }));
      }
    } catch (err) {
      // If server lookup timed out or failed, resolve immediately as new number
      const newCid = getCallerIdForPhone(query);
      setCallerFoundInfo(null);
      setCallerHistory([]);
      setForm((f) => ({
        ...f,
        phone: phoneNumber,
        caller_id: f.caller_id || newCid,
      }));
    } finally {
      setIsLookingUp(false);
    }
  }, []);

  // Support URL query parameter screen-pop (?name=...&phone=...&age=...&district=...)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const name = sp.get("name") || sp.get("caller_name");
      const phone = sp.get("phone") || sp.get("phoneNumber");
      const age = sp.get("age");
      const sex = sp.get("sex") || sp.get("gender");
      const district = sp.get("district");
      const ip = sp.get("ip") || sp.get("ip_number");

      if (name || phone) {
        const cleanP = String(phone || "").replace(/\D/g, "").slice(-10);
        setForm((f) => ({
          ...f,
          caller_name: name || f.caller_name,
          phone: cleanP || f.phone,
          age: age || f.age,
          sex: sex || f.sex,
          district: extractAssamDistrict(district) || f.district,
          ip_number: sanitizeIpNumber(ip) || "",
        }));
        if (cleanP.length === 10) {
          lookupCaller(cleanP, true);
        }
      }
    }
  }, [lookupCaller]);

  // Dhwani CRM Cross-Tab Live Auto-Sync
  const lastCrmSyncTimestampRef = useRef(0);

  const checkCrmSync = useCallback(async () => {
    try {
      const clientId = getOrCreateClientSyncId();
      const rawAgent = (currentAgent?.agentId || "").trim();
      const rawEmail = (currentAgent?.email || "").trim();
      const rawUsername = rawEmail ? rawEmail.split("@")[0].trim() : "";

      const params = new URLSearchParams({
        since: String(lastCrmSyncTimestampRef.current),
        _t: String(Date.now()),
      });
      if (clientId) params.set("client_id", clientId);
      if (rawAgent) params.set("agent_id", rawAgent.toLowerCase());
      if (rawEmail) params.set("agent_email", rawEmail.toLowerCase());
      if (rawUsername) params.set("username", rawUsername.toLowerCase());

      const res = await fetch(`/api/crm/live-sync?${params.toString()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.hasUpdate && data.beneficiary && data.timestamp > lastCrmSyncTimestampRef.current) {
        lastCrmSyncTimestampRef.current = data.timestamp;
        const b = data.beneficiary;

        // Extra client-side guard: verify this update belongs to this agent
        const matchesClient = b.client_id && b.client_id === clientId;
        const matchesAgent =
          (rawAgent && b.agent_id && b.agent_id.toLowerCase() === rawAgent.toLowerCase()) ||
          (rawEmail && (b.agent_id?.toLowerCase() === rawEmail.toLowerCase() || b.crm_user?.toLowerCase() === rawEmail.toLowerCase())) ||
          (rawUsername && (b.agent_id?.toLowerCase() === rawUsername.toLowerCase() || b.crm_user?.toLowerCase().includes(rawUsername.toLowerCase())));

        if (b.client_id || b.agent_id || b.crm_user) {
          if (!matchesClient && !matchesAgent) {
            // Belongs to another agent - ignore!
            return;
          }
        }

        const autoCid = b.phone ? getCallerIdForPhone(b.phone, callerHistory) : "";
        setForm((f) => ({
          ...f,
          caller_name: sanitizeCallerName(b.caller_name) || "",
          phone: b.phone || "",
          caller_id: autoCid || f.caller_id,
          age: sanitizeAge(b.age) || "",
          sex: b.sex || "",
          district: b.district ? String(b.district).trim() : "",
          ip_number: sanitizeIpNumber(b.ip_number) || "",
        }));

        if (b.phone && b.phone.length === 10) {
          lookupCaller(b.phone, true, true);
        }
        toast.success(`Dhwani CRM synced: ${b.caller_name || "Beneficiary"} (+91 ${b.phone || ""})`);
      }
    } catch (_) {}
  }, [currentAgent, lookupCaller]);

  useEffect(() => {
    checkCrmSync();
    // Ultra-fast 350ms polling for instant 1-click sync
    const interval = setInterval(checkCrmSync, 350);

    // Immediate 0ms check on tab focus or visibility change
    const onFocus = () => {
      checkCrmSync();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [checkCrmSync]);

  const useGps = () => {
    if (!navigator.geolocation) return toast.error("Geolocation not available in this browser");
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setForm((f) => ({
          ...f,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        })),
      () => toast.error("Could not read GPS; enter city or pincode instead")
    );
  };

  const submit = async (e, overrideContext) => {
    e?.preventDefault?.();
    if (!currentAgent) {
      toast.warning("Please sign in as an Agent or Admin to perform clinical triage.");
      if (onOpenLogin) onOpenLogin();
      return;
    }
    const activeContext = overrideContext || ekmsContext;
    if (!form.caller_name || !form.caller_name.trim()) {
      return toast.error("Caller Name is mandatory. Please enter caller name.");
    }
    if (!form.phone || !form.phone.trim()) {
      return toast.error("Phone number is mandatory. Please enter or receive a caller phone.");
    }
    if (form.age && (isNaN(Number(form.age)) || Number(form.age) <= 0)) {
      return toast.error("Please enter a valid age.");
    }

    if (isNonClinical) {
      if (!nonClinicalForm.enquiryType || nonClinicalForm.enquiryType === "NA") {
        return toast.error("Please select an Enquiry Type for this non-clinical call.");
      }
      if (!nonClinicalForm.chiefIssue || !nonClinicalForm.chiefIssue.trim()) {
        return toast.error("Please enter the Chief Complaint / Issue.");
      }
    }

    const compiledNotes = isNonClinical
      ? `[Enquiry: ${nonClinicalForm.enquiryType}] Issue: ${nonClinicalForm.chiefIssue}${nonClinicalForm.remarks ? ` | Remarks: ${nonClinicalForm.remarks}` : ""}`
      : (form.symptom_notes?.trim() ||
         activeContext?.triageState?.notes ||
         activeContext?.triageState?.condition ||
         activeContext?.triageState?.symptom ||
         "");

    if (!compiledNotes || compiledNotes.length < 3) {
      return toast.error(isNonClinical ? "Please fill the non-clinical enquiry details" : "Please enter the caller's complaint notes in the chat area");
    }
    setLoading(true);
    setResult(null);

    let rawAgent = currentAgent?.agentId;
    let rawAgentName = currentAgent?.displayName || currentAgent?.name;
    let rawAgentEmail = currentAgent?.email;
    if (!rawAgent || !rawAgentName) {
      try {
        const stored = sessionStorage.getItem("ekms_active_agent") || localStorage.getItem("ekms_active_agent");
        if (stored) {
          const parsed = JSON.parse(stored);
          rawAgent = rawAgent || parsed?.agentId;
          rawAgentName = rawAgentName || parsed?.displayName || parsed?.name;
          rawAgentEmail = rawAgentEmail || parsed?.email;
        }
      } catch (e) {}
    }
    const rawUpper = String(rawAgent || "").toUpperCase().trim();
    const agentCode = rawUpper.startsWith("ESIC") ? rawUpper : (rawAgent || "");

    const activeAgentName = formatAgentDisplayName(rawAgentName, rawAgentEmail, rawAgent || agentCode);
    const activeAgentId = rawAgent || agentCode;

    let ipGeo = null;
    try {
      const cached = sessionStorage.getItem("ekms_agent_geo_telemetry");
      if (cached) ipGeo = JSON.parse(cached);
    } catch (e) {}

    const payload = {
      ...form,
      // CRITICAL: NEVER pass result?.case_ref! Caller intake from console is always a NEW triage case.
      // Passing old result?.case_ref caused previous forwarded/booked status from days ago to attach to this new triage!
      caller_id: activeCallerId,
      agent_id: activeAgentId,
      agent_name: activeAgentName,
      agent_email: rawAgentEmail || null,
      call_type: isNonClinical ? "non_clinical" : "clinical",
      enquiry_type: isNonClinical ? nonClinicalForm.enquiryType : null,
      chief_issue: isNonClinical ? nonClinicalForm.chiefIssue : null,
      remarks: isNonClinical ? nonClinicalForm.remarks : null,
      symptom_notes: compiledNotes,
      age: form.age === "" ? null : Number(form.age),
      severity_reported: Number(form.severity_reported),
      latitude: form.latitude !== "" && form.latitude != null ? Number(form.latitude) : null,
      longitude: form.longitude !== "" && form.longitude != null ? Number(form.longitude) : null,
      district: form.district ? String(form.district).trim() : null,
      pincode: form.pincode ? String(form.pincode).trim() : null,
      city: form.city ? String(form.city).trim() : null,
      ekms_ai_context: activeContext,
      source_app: "console",
    };
    Object.keys(payload).forEach((k) => payload[k] === "" && delete payload[k]);
    let triageData = null;
    try {
      const res = await api.post("/triage", payload);
      triageData = res?.data;
    } catch (err) {
      console.error("Clinical triage API error:", err);
      toast.error(err.response?.data?.detail || "Triage failed. Please retry.");
      setLoading(false);
      return;
    }

    if (!triageData) {
      toast.error("Triage response was empty. Please retry.");
      setLoading(false);
      return;
    }

    const freshResult = {
      ...triageData,
      is_fresh_triage: true,
      is_forwarded: false,
      booked_appointment: null,
    };
    setResult(freshResult);
    setLoading(false);

    const finalCallerId = triageData.caller_id || activeCallerId;
    const urgencyLabel = triageData.triage?.urgency_level || triageData.triage?.assessed_severity || "Routine";
    const refOrId = triageData.case_ref || triageData.case_id || "";

    toast.success(`${urgencyLabel} — ${finalCallerId || refOrId}`);

    // Non-blocking secondary operations (local caching, broadcast sync, audit log, history refresh)
    try {
      const caseRecord = {
        id: triageData.case_id || triageData.case_ref,
        case_ref: triageData.case_ref,
        caller_id: finalCallerId,
        agent_id: activeAgentId || triageData.agent_id || agentCode,
        agent_name: activeAgentName || triageData.agent_name || "Agent",
        agent_email: rawAgentEmail || triageData.agent_email || null,
        status: "call_only",
        booking_status: "call_only",
        booked_appointment: null,
        intake: {
          ...(triageData.intake || payload),
          caller_id: finalCallerId,
          agent_id: activeAgentId || triageData.agent_id || agentCode,
          agent_name: activeAgentName || triageData.agent_name || "Agent",
          agent_email: rawAgentEmail || triageData.agent_email || null,
        },
        triage: triageData.triage,
        resolved_location: triageData.resolved_location,
        nearest_facilities: triageData.nearest_facilities,
        ekms_ai_context: triageData.ekms_ai_context || activeContext,
        created_at: new Date().toISOString(),
      };
      appendCaseToLocalCache(caseRecord);

      // Direct client-side Firestore write guarantees multi-agent sync even across hosts
      try {
        const db = getFirestoreDb();
        if (db) {
          const docId = caseRecord.case_ref || caseRecord.id;
          await setDoc(doc(db, "cases", docId), caseRecord, { merge: true });
        }
      } catch (fsErr) {
        console.warn("Client Firestore case write notice:", fsErr);
      }
      const currentStats = getCachedStats() || {};
      const newStats = {
        ...currentStats,
        total: (currentStats.total || 0) + 1,
      };
      setCachedStats(newStats);
      broadcastEvent("NEW_CASE", caseRecord);
      broadcastEvent("SYNC_STATS_TOTAL", { total: newStats.total });

      // Immediately record triage assessment to Google Sheet as "Call Only"
      recordTriageCaseToSheet(caseRecord, activeAgentName || currentAgent).catch(() => {});

      logSystemActivity({
        user: {
          displayName: activeAgentName || (typeof currentAgent === "object" ? currentAgent?.displayName || currentAgent?.name : null) || "Ekmsoffice",
          name: activeAgentName || (typeof currentAgent === "object" ? currentAgent?.name || currentAgent?.displayName : null) || "Ekmsoffice",
          agentId: (typeof currentAgent === "object" ? currentAgent?.agentId : currentAgent) || agentCode || "ESIC001T",
          email: typeof currentAgent === "object" ? currentAgent?.email : "",
        },
        type: "TRIAGING",
        caseId: triageData.case_ref || triageData.case_id,
        details: `Clinical triage assessment completed for Case ID- ${triageData.case_ref || triageData.case_id} (${urgencyLabel} - ${triageData.triage?.referral_destination || triageData.triage?.call_referral_primary || "ESIS Dispensary"})`,
      }).catch?.(() => {});

      try {
        onCaseCreated?.();
      } catch (_) {}

      if (form.phone) {
        lastLookedUpRef.current = "";
        lookupCaller(form.phone, true, true).catch?.(() => {});
      }
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setTimeout(() => {
          outcomeRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        }, 120);
      }
    } catch (postErr) {
      console.warn("Non-critical post-triage secondary task warning:", postErr);
    }
  };

  const showRightPanel = Boolean(result || loading);

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden min-w-0">
      {/* 2-Column Side-by-Side: Caller Intake (left) and Scribe / Triage Outcome (right) */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] w-full max-w-full overflow-x-hidden min-w-0 items-start">
        {/* Left Column: Intake Form + Caller Call History */}
        <div className="w-full max-w-full min-w-0 flex flex-col space-y-4">
          <form onSubmit={submit} className="w-full max-w-full min-w-0 space-y-4" data-testid="intake-form">
        <div className="mb-2 sm:mb-3 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-xl font-black text-slate-900 tracking-tight sm:text-2xl">Caller intake</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Non-Clinical / Clinical Mode Toggle directly at the left of the reset button */}
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-secondary/60 p-0.5 rounded-xl border border-slate-200 dark:border-border text-xs shadow-2xs">
              <button
                type="button"
                onClick={() => {
                  setIsNonClinical(false);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition cursor-pointer text-xs ${
                  !isNonClinical
                    ? "bg-white text-emerald-700 shadow-2xs border border-slate-200/80 dark:bg-card dark:text-emerald-400"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                }`}
                title="Clinical Triage with AI Probing"
              >
                <Stethoscope className="w-3.5 h-3.5 text-emerald-600" />
                <span>Clinical</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsNonClinical(true);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition cursor-pointer text-xs ${
                  isNonClinical
                    ? "bg-indigo-600 text-white shadow-2xs border border-indigo-700 font-extrabold"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                }`}
                title="Non-Clinical Call (Enquiry, Benefits, e-Pehchan)"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Non-Clinical</span>
              </button>
            </div>

            <button
              type="button"
              data-testid="intake-form-reset"
            onClick={() => {
              try {
                sessionStorage.removeItem("ekms_active_triage_session");
                sessionStorage.removeItem("ekms_active_ai_chat_session");
                sessionStorage.removeItem("ekms_active_case_forwarded");
                sessionStorage.removeItem("ekms_active_case_result");
                sessionStorage.removeItem("ekms_active_beneficiary_intake");
              } catch (e) {}
              setForm(EMPTY);
              setResult(null);
              setActiveDirective(null);
              setChatPresetTrigger("");
              setEkmsContext(null);
              setCallerFoundInfo(null);
              setCallerHistory([]);
              setHistoryPage(1);
              setIsNonClinical(false);
              setNonClinicalForm({ enquiryType: "NA", chiefIssue: "", remarks: "" });
              lastLookedUpRef.current = "";
              chatRef.current?.resetChat();
              toast.success("Intake form and chat reset");
            }}
            className="shrink-0 rounded-md border border-border/70 p-2 text-muted-foreground transition-colors duration-200 hover:border-primary/60 hover:text-foreground cursor-pointer"
            title="Reset form and AI chat"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          </div>
        </div>

        {/* 1. Caller Demographic Fields - 2 in a row on mobile */}
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          {callerFoundInfo && (
            <div className="col-span-2 sm:col-span-2 lg:col-span-4 flex items-center justify-between rounded-md bg-emerald-50 border border-emerald-400 px-3 py-1.5 text-xs text-emerald-950 font-bold shadow-2xs">
              <div className="flex items-center gap-2">
                <UserCheck className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                <span>
                  Returning IP Caller: <strong>{callerFoundInfo.caller_name}</strong>
                  {callerFoundInfo.age ? ` (${callerFoundInfo.age}y, ${callerFoundInfo.sex})` : ""}
                  {sanitizeIpNumber(callerFoundInfo.ip_number) ? ` • IP: ${sanitizeIpNumber(callerFoundInfo.ip_number)}` : ""}
                  {callerFoundInfo.district ? ` • ${callerFoundInfo.district}` : ""}
                </span>
              </div>
              {(callerFoundInfo.caller_id || activeCallerId) ? (
                <span className="font-mono text-[11px] text-emerald-800 hidden sm:inline font-bold">
                  Caller ID: {callerFoundInfo.caller_id || activeCallerId}
                </span>
              ) : callerFoundInfo.last_case_ref && (
                <span className="font-mono text-[11px] text-emerald-800 hidden sm:inline font-bold">
                  Caller ID: {activeCallerId}
                </span>
              )}
            </div>
          )}

          <Field
            label={
              <span className="flex items-center gap-1">
                Caller name <span className="text-red-500 font-bold">*</span>
              </span>
            }
          >
            <input
              data-testid="intake-form-caller-name"
              required
              className={inputCls}
              value={form.caller_name}
              onChange={set("caller_name")}
              placeholder="Akash Gupta"
            />
          </Field>
          <Field
            label={
              <span className="flex items-center gap-1">
                Phone <span className="text-red-500 font-bold">*</span>
                {isLookingUp && <Loader2 className="h-3 w-3 animate-spin text-primary ml-1" />}
              </span>
            }
          >
            <input
              data-testid="intake-form-phone"
              required
              className={inputCls}
              value={form.phone}
              onChange={(e) => {
                const val = e.target.value;
                const digits = val.replace(/\D/g, "");
                const clean10 = digits.length >= 10 ? digits.slice(-10) : digits;
                const autoCid = clean10.length === 10 ? getCallerIdForPhone(clean10, callerHistory) : (clean10.length >= 3 ? getCallerIdForPhone(clean10) : "");
                setForm((f) => ({ ...f, phone: val, caller_id: autoCid || f.caller_id }));
                if (clean10.length !== 10) {
                  if (callerFoundInfo) setCallerFoundInfo(null);
                  if (callerHistory.length > 0) setCallerHistory([]);
                  lastLookedUpRef.current = "";
                  setResult(null);
                } else {
                  setResult(null);
                  lookupCaller(clean10, true);
                }
              }}
              onBlur={() => {
                const digits = (form.phone || "").replace(/\D/g, "");
                const clean10 = digits.length >= 10 ? digits.slice(-10) : digits;
                if (clean10.length === 10) {
                  lookupCaller(clean10, true);
                } else {
                  setCallerFoundInfo(null);
                  setCallerHistory([]);
                }
              }}
              placeholder="987XXXXXXX"
            />
          </Field>
          <Field label="Age">
            <input
              data-testid="intake-form-age"
              type="number"
              min="0"
              max="120"
              className={inputCls}
              value={form.age}
              onChange={set("age")}
              placeholder="45"
            />
          </Field>
          <Field label="Sex">
            <select
              data-testid="intake-form-sex"
              className={inputCls}
              value={form.sex}
              onChange={set("sex")}
            >
              <option value="">Select sex</option>
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </select>
          </Field>
        </div>

        {/* 2. Caller ID & Location Fields - 4 in a row on desktop */}
        <div className="mt-2.5 sm:mt-3 grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <Field label="Caller ID">
            <input
              data-testid="intake-form-caller-id"
              readOnly
              className={`${inputCls} font-mono font-bold bg-muted/40 cursor-default ${
                activeCallerId ? "text-primary dark:text-primary-foreground" : "text-muted-foreground"
              }`}
              value={activeCallerId || (form.phone && form.phone.replace(/\D/g, "").length >= 3 ? getCallerIdForPhone(form.phone) : "Pending phone...")}
              placeholder="e.g. CID0005A810"
              title="Unique permanent Caller ID assigned to this phone number"
            />
          </Field>
          <Field label="IP No">
            <input
              data-testid="intake-form-ip-number"
              className={inputCls}
              inputMode="numeric"
              pattern="[0-9]*"
              value={sanitizeIpNumber(form.ip_number)}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, ""); // Only numbers allowed, not text
                setForm((f) => ({ ...f, ip_number: val }));
                if (val.length >= 8) {
                  sendIpToEkmsData(val, { caller_name: form.caller_name, phone: form.phone, case_ref: form.caller_id });
                }
              }}
              onBlur={() => {
                const val = sanitizeIpNumber(form.ip_number);
                if (val) {
                  sendIpToEkmsData(val, { caller_name: form.caller_name, phone: form.phone, case_ref: form.caller_id });
                }
              }}
              placeholder="e.g. 4300000000"
            />
          </Field>
          <Field label="District">
            <input
              data-testid="intake-form-district"
              className={inputCls}
              value={form.district || ""}
              onChange={set("district")}
              placeholder="Extracted from Dhwani CRM (e.g. Kamrup Metro)"
            />
          </Field>
          <Field label="Pincode">
            <input
              data-testid="intake-form-pincode"
              className={inputCls}
              value={form.pincode}
              onChange={set("pincode")}
              placeholder="e.g. 781022"
              maxLength={6}
            />
          </Field>
        </div>

        {/* 3. Complaint Notes & Adaptive Questioning OR Non-Clinical Form */}
        <div className="mt-4">
          <label className="field-label block mb-2">
            {isNonClinical ? "Non-Clinical Enquiry Details" : "Complaint Notes & Adaptive Questioning"}
          </label>

          {isNonClinical ? (
            <NonClinicalEnquiryForm
              value={nonClinicalForm}
              onChange={(updated) => {
                setNonClinicalForm(updated);
                const compiled = `[Enquiry: ${updated.enquiryType || "NA"}] Issue: ${updated.chiefIssue || "N/A"}${updated.remarks ? ` | Remarks: ${updated.remarks}` : ""}`;
                setForm((f) => ({
                  ...f,
                  symptom_notes: compiled,
                  enquiry_type: updated.enquiryType,
                  chief_issue: updated.chiefIssue,
                  remarks: updated.remarks,
                }));
              }}
            />
          ) : (
            <EkmsAiChatArea
              ref={chatRef}
              currentAgent={currentAgent}
              onOpenLogin={onOpenLogin}
              initialNotes={chatPresetTrigger}
              triageResult={result}
              activeDirective={activeDirective}
              onComplaintChange={(compiledNotes, ctx) => {
                setForm((f) => ({ ...f, symptom_notes: compiledNotes }));
                setEkmsContext(ctx);
                setResult((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    ekms_ai_context: ctx,
                    intake: {
                      ...(prev.intake || {}),
                      symptom_notes: compiledNotes,
                    },
                  };
                });
              }}
              onSyncFields={(field, val) => {
                setForm((f) => ({ ...f, [field]: val }));
              }}
              onReadyToShowResult={(tState) => {
                // Triage outcome panel is always active and visible
              }}
              onRunTriage={(overrideCtx) => {
                submit({ preventDefault: () => {} }, overrideCtx);
              }}
            />
          )}
        </div>

        {/* Run Triage CTA */}
        <button
          type={currentAgent ? "submit" : "button"}
          data-testid="intake-form-submit-button"
          onClick={(e) => {
            if (!currentAgent) {
              e.preventDefault();
              toast.warning("Please sign in as an Agent or Admin to perform clinical triage.");
              if (onOpenLogin) onOpenLogin();
            }
          }}
          disabled={loading}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-all duration-200 hover:brightness-110 active:scale-[0.99] disabled:opacity-60 cursor-pointer shadow-sm"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> {isNonClinical ? "Finding facilities..." : "Analyzing the case..."}
            </>
          ) : isNonClinical ? (
            <>
              <Building2 className="h-4 w-4" /> See Available Facilities
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" /> Run triage
            </>
          )}
        </button>
      </form>

      {/* Caller Consultation History (in the left half only!) */}
      <div className="w-full">
        <CallerHistorySection
          form={form}
          callerHistory={callerHistory}
          currentAgent={currentAgent}
          activeCallerId={activeCallerId}
        />
      </div>
    </div>

      {/* Right Side: Triage Result Panel */}
      <div ref={outcomeRef} className="flex flex-col w-full min-w-0 scroll-mt-16">
        <div className="flex flex-col min-h-0">
          <TriageResultPanel
                  result={result}
                  loading={loading}
                  callerIntake={{
                    ...form,
                    call_type: isNonClinical ? "non_clinical" : "clinical",
                    enquiry_type: nonClinicalForm.enquiryType,
                    enquiryType: nonClinicalForm.enquiryType,
                    chief_issue: nonClinicalForm.chiefIssue,
                    chiefIssue: nonClinicalForm.chiefIssue,
                    remarks: nonClinicalForm.remarks,
                    remarksText: nonClinicalForm.remarks,
                    isNonClinical: isNonClinical,
                  }}
                  currentAgent={currentAgent}
                  onDirectiveChange={setActiveDirective}
                  callerHistory={callerHistory}
                  onForwardSuccess={(statusData) => {
                    try {
                      chatRef.current?.resetChat();
                      sessionStorage.removeItem("ekms_main_ai_chat_session");
                      localStorage.removeItem("ekms_main_ai_chat_session");
                      sessionStorage.removeItem("ekms_active_ai_chat_session");
                    } catch (e) {}
                    setResult((prev) => {
                      const base = prev || {};
                      return {
                        ...base,
                        is_forwarded: true,
                        forwarded_at: statusData?.timestamp || new Date().toISOString(),
                        dispatch_id: statusData?.dispatchId,
                        forwarded_to: statusData?.teamName,
                        forwarded_short_name: statusData?.shortName,
                        status: "forwarded",
                        dispatch_info: statusData,
                      };
                    });
                  }}
                  onAppointmentBooked={(bookingData) => {
                    try {
                      chatRef.current?.resetChat();
                      sessionStorage.removeItem("ekms_main_ai_chat_session");
                      localStorage.removeItem("ekms_main_ai_chat_session");
                      sessionStorage.removeItem("ekms_active_ai_chat_session");
                    } catch (e) {}
                  }}
                  onUpdatePincode={(newPin) => {
                    if (newPin && /^\d{6}$/.test(String(newPin).trim())) {
                      setForm((f) => ({ ...f, pincode: String(newPin).trim() }));
                    } else if (newPin && typeof newPin === "string" && newPin.trim()) {
                      setForm((f) => ({ ...f, city: newPin.trim() }));
                    }
                  }}
                  onUpdateLocation={({ pincode, city, district }) => {
                    setForm((f) => {
                      const next = { ...f };
                      if (pincode && /^\d{6}$/.test(String(pincode).trim())) {
                        next.pincode = String(pincode).trim();
                      } else if (f.pincode && !/^\d{6}$/.test(String(f.pincode).trim())) {
                        next.pincode = "";
                      }
                      if (city && typeof city === "string" && city.trim() && !/^\d{6}$/.test(city.trim())) {
                        next.city = city.trim();
                      }
                      if (district && typeof district === "string" && district.trim()) {
                        next.district = district.trim();
                      }
                      return next;
                    });
                  }}
                />
        </div>
      </div>
      </div>
    </div>
  );
};
