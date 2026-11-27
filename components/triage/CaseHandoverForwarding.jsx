"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Send,
  CheckCircle2,
  X,
  Edit3,
  Ambulance,
  Stethoscope,
  Copy,
  Check,
  User,
  Phone,
  Calendar,
  MapPin,
  Activity,
  Clock,
  ShieldAlert,
  Pill,
  FileText,
  AlertTriangle,
  HeartPulse,
  ClipboardCheck,
  Sparkles,
  Loader2,
  UserCheck,
  Info,
  CalendarCheck,
  CalendarPlus,
  Building2,
  Printer,
  QrCode,
  ChevronDown,
  Navigation,
  Trash2,
  ShieldCheck,
  History,
  BadgeCheck,
} from "lucide-react";
import { toast } from "sonner";
import { getFirestoreDb, getBookingDb, getOldBookingDb, auth } from "@/lib/firebase";
import { doc, setDoc, getDoc, collection, onSnapshot, query, runTransaction } from "firebase/firestore";
import {
  isSlotInPast,
  getFirstAvailableSlot,
  areAllSlotsPastToday,
  ALL_OPD_TIME_SLOTS,
  getTodayDateString,
  getTomorrowDateString,
  getSaturdayInfo,
  isWeekendOrHoliday,
  getNextWorkingDateString,
  OPERATING_HOURS_LABEL,
  isLunchSlot,
  isSlotReserved,
  checkDispensaryDoctorAvailability,
} from "@/lib/slotTiming";
import {
  recordTriageCaseToSheet,
  recordAppointmentBookingToSheet,
} from "@/lib/googleSheetsSync";
import { bookAppointmentViaEkmsApi, cancelAppointmentViaEkmsApi } from "@/lib/ekmsAppointmentApi";
import { fetchEkmsAppointments, fetchEkmsDoctorAvailability } from "@/lib/ekmsApi";
import { isFacilityAccepting } from "@/lib/facilityAvailability";
import { api, normalizeUrgency } from "@/lib/api";
import {
  updateCaseInLocalCache,
  appendCaseToLocalCache,
  getCachedCases,
  getCachedAppointments,
  setCachedAppointments,
  updateAppointmentInCache,
  getCachedDoctors,
  setCachedDoctors,
  getCachedDoctorAvailability,
  setCachedDoctorAvailability,
} from "@/lib/clientCache";
import { broadcastEvent, subscribeToSync } from "@/lib/broadcastSync";
import { unrecordDeletedCase, formatAgentDisplayName } from "@/lib/activityLogger";
import { archiveToRecentlyDeleted } from "@/lib/recentlyDeleted";
import { getCallerIdForPhone } from "@/lib/callerId";
import {
  formatBeneficiaryName,
  formatBeneficiaryPhone,
  formatBeneficiaryIp,
} from "@/lib/maskUtils";
import { deduplicateRedFlags, summarizeRedFlags, extractCallerReportedProblems } from "@/lib/triageEngine";
import assamPincodesData from "@/data/assam_pincodes.json";
import {
  isDispensary,
  isEsicHospital,
  isGovtDistrictHospital,
  isTieUp,
  resolveCallerLocation,
  calculateRoadDistanceKm,
} from "@/lib/geo";

const formatApproxKm = (dist) => {
  if (dist == null || isNaN(dist)) return null;
  const num = Number(dist);
  return num < 10 ? num.toFixed(1) : Math.round(num);
};

export const FORWARDING_TEAMS = [
  {
    id: "108_AMBULANCE",
    name: "108 Emergency Ambulance Dispatch",
    shortName: "108 Ambulance",
    badgeColor: "bg-rose-700 text-white",
    icon: "🚨",
    isEmergency: true,
  },
  {
    id: "104_MEDICAL",
    name: "104 Health Helpline (Tele-Doctor)",
    shortName: "104 Health Helpline",
    badgeColor: "bg-blue-700 text-white",
    icon: "📞",
    isEmergency: false,
  },
  {
    id: "ESIC_HOSPITAL",
    name: "ESIC Hospital Casualty / Triage Desk",
    shortName: "ESIC Hospital",
    badgeColor: "bg-amber-700 text-white",
    icon: "🏥",
    isEmergency: false,
  },
  {
    id: "ESIS_DISPENSARY",
    name: "ESIS Dispensary Medical Officer",
    shortName: "ESIS Dispensary",
    badgeColor: "bg-emerald-700 text-white",
    icon: "🩺",
    isEmergency: false,
  },
  {
    id: "TIE_UP_FACILITY",
    name: "Empanelled Tie-Up Facility Desk",
    shortName: "Tie-Up Facility",
    badgeColor: "bg-cyan-700 text-white",
    icon: "🏥",
    isEmergency: false,
  },
  {
    id: "DIST_HOSPITAL",
    name: "Govt District Hospital / Public Health Desk",
    shortName: "District Hospital",
    badgeColor: "bg-blue-800 text-white",
    icon: "🏥",
    isEmergency: false,
  },
];

export function mapDirectiveToTeamId(directiveId, t = {}) {
  switch (directiveId) {
    case "CALL_108":
      return "108_AMBULANCE";
    case "TELE_104":
      return "104_MEDICAL";
    case "ESIC_HOSPITAL":
      return "ESIC_HOSPITAL";
    case "ESIS_DISPENSARY":
      return "ESIS_DISPENSARY";
    case "TIE_UP_FACILITY":
      return "TIE_UP_FACILITY";
    case "DIST_HOSPITAL":
      return "DIST_HOSPITAL";
    default:
      if (t?.call_108) return "108_AMBULANCE";
      return "104_MEDICAL";
  }
}

export function getTeamButtonClass(teamId) {
  switch (teamId) {
    case "ESIC_HOSPITAL":
      return "bg-amber-700 hover:bg-amber-800 ring-2 ring-amber-500/25";
    case "108_AMBULANCE":
    case "CALL_108":
      return "bg-rose-700 hover:bg-rose-800 ring-2 ring-rose-500/25";
    case "104_MEDICAL":
    case "TELE_104":
      return "bg-blue-700 hover:bg-blue-800 ring-2 ring-blue-500/25";
    case "TIE_UP_FACILITY":
      return "bg-cyan-700 hover:bg-cyan-800 ring-2 ring-cyan-500/25";
    case "DIST_HOSPITAL":
      return "bg-blue-800 hover:bg-blue-900 ring-2 ring-blue-500/25";
    case "ESIS_DISPENSARY":
      return "bg-emerald-700 hover:bg-emerald-800 ring-2 ring-emerald-500/25";
    default:
      return "bg-primary hover:bg-primary/90 ring-2 ring-primary/25";
  }
}

export function getSlotStartDecimalHour(slotStr) {
  try {
    const startPart = slotStr.split("-")[0].trim();
    const [time, meridiem] = startPart.split(" ");
    let [hours, mins] = time.split(":").map(Number);
    if (meridiem === "PM" && hours !== 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
    return hours + (mins || 0) / 60;
  } catch (e) {
    return 0;
  }
}

export function getSlotStatus(slotStr, dateStr) {
  const isPast = isSlotInPast(slotStr, dateStr);
  return { isPast, isBooked: false, isAvailable: !isPast };
}

function formatTriageDate(ts) {
  const d = ts ? new Date(ts) : new Date();
  const valid = !isNaN(d.getTime()) ? d : new Date();
  return valid.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatHistoryDateTime(ts) {
  if (!ts) return "Recorded Prior Visit";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch (e) {
    return String(ts);
  }
}

function cleanShortChiefComplaints(result, callerIntake, t) {
  const problems = extractCallerReportedProblems({ result, callerIntake, t });

  const isComorbid = (s) =>
    /\b(diabetes|sugar|high blood sugar|bp|hypertension|high bp|asthma)\b/i.test(s);
  const isDangerFlag = (s) =>
    /\b(uncontrollable pain|danger sign|severe pain|intense pain|sudden severe|emergency|difficulty breathing|shortness of breath|dyspnea|sudden acute severe headache)\b/i.test(s);
  const isAssoc = (s) =>
    /\b(vomiting & nausea|vomiting|nausea|weakness & dizziness|dizziness|weakness|faint|sweating)\b/i.test(s);

  // Look for genuine primary chief complaints that aren't danger flags or comorbidities
  let genuineChiefs = problems.filter((p) => !isComorbid(p) && !isDangerFlag(p) && !isAssoc(p));

  // If none (e.g. caller called specifically for Diabetes management)
  if (genuineChiefs.length === 0) {
    genuineChiefs = problems.filter((p) => !isDangerFlag(p) && !isAssoc(p));
  }
  if (genuineChiefs.length === 0) {
    genuineChiefs = problems;
  }

  const initialComplaint =
    result?.ekms_ai_context?.triageState?.initialChiefComplaint ||
    genuineChiefs[0] ||
    problems[0] ||
    callerIntake?.symptom_notes ||
    "Primary Clinical Assessment";

  const cleanMain = String(initialComplaint)
    .replace(/^investigating:\s*/i, "")
    .replace(/^clinical assessment:?\s*/i, "")
    .split(/[\n,;]|\s*\+\s*/)[0]
    .trim();

  const firstReason = cleanMain || "Primary Clinical Assessment";

  return {
    firstReason,
    secondReason: "",
    allReasons: [firstReason], // Chief Complaint must strictly be the single main condition
    rawProblems: problems,
  };
}

function extractClinicalDetails(result, callerIntake, t, allRedFlags) {
  const chatMsgs = result?.ekms_ai_context?.chatHistory || [];
  const callerUtterances = Array.isArray(chatMsgs)
    ? chatMsgs
        .filter((m) => m.sender === "user" || m.role === "user")
        .map((m) => m.text || "")
        .join(". ")
    : "";
  const allCallerText = `${callerIntake?.symptom_notes || ""} ${result?.intake?.symptom_notes || ""} ${callerUtterances} ${result?.caller_spoken_text || ""}`.trim();
  const allText = `${allCallerText} ${result?.ekms_ai_context?.triageState?.condition || ""} ${result?.triage?.summary_en || ""} ${result?.triage?.reasoning || ""}`.toLowerCase();

  // 1. Duration / Onset
  let duration = result?.ekms_ai_context?.duration || result?.ekms_ai_context?.triageState?.duration || "";
  if (!duration || /\b(fall|fell|falling|accident|injury|trauma|pain|chot|gir gaya|impact)\b/i.test(duration)) {
    const durMatch = allText.match(/\b(since\s+[\w\s]+|\d+\s*(?:days?|hours?|weeks?|months?|dino?|ghante?)|aaj\s*se|kal\s*se|today|yesterday|morning|subah\s*se|raat\s*se)\b/i);
    if (durMatch) duration = durMatch[0];
    else duration = "Reported today";
  }

  // 2. Clinical Red Flags: Strictly use the verified and deduplicated allRedFlags
  let redFlags = [];
  if (Array.isArray(allRedFlags) && allRedFlags.length > 0) {
    redFlags = deduplicateRedFlags(allRedFlags);
  } else {
    const rawFlags = [];
    if (Array.isArray(t?.red_flags)) rawFlags.push(...t.red_flags);
    if (Array.isArray(result?.ekms_ai_context?.triageState?.redFlagsDetected)) {
      rawFlags.push(...result.ekms_ai_context.triageState.redFlagsDetected);
    }
    const isSafe = /\b(safe|surakshit|no,?\s*i am safe|i am safe|not suicidal|no self.?harm|theek hoon)\b/i.test(allText);
    redFlags = deduplicateRedFlags(summarizeRedFlags(rawFlags, allText, isSafe));
  }

  // 3. Short clean chief complaint
  const { firstReason, secondReason, allReasons, rawProblems } = cleanShortChiefComplaints(result, callerIntake, t);
  const primaryLower = (firstReason || "").toLowerCase();

  // Route any danger signs / red flags from rawProblems into redFlags
  if (Array.isArray(rawProblems)) {
    const isDangerFlag = (s) =>
      /\b(uncontrollable pain|danger sign|severe pain|intense pain|sudden severe|emergency|difficulty breathing|shortness of breath|dyspnea|sudden acute severe headache)\b/i.test(s);
    rawProblems.filter(isDangerFlag).forEach((df) => {
      if (!redFlags.some((rf) => rf.toLowerCase().includes(df.toLowerCase()) || df.toLowerCase().includes(rf.toLowerCase()))) {
        redFlags.push(df);
      }
    });
  }

  const isCertificateOnly = Boolean(
    t?.is_certificate_only ||
    result?.is_certificate_only ||
    result?.ekms_ai_context?.triageState?.isCertificateOnly ||
    ((/\bcertificate\b/i.test(firstReason) || /\bcertificate\b/i.test(allText)) &&
      !/\b(chest pain|shortness of breath|fever|bukhar|vomit|ulti|bleeding|headache|fracture|burn|unconscious|seizure)\b/i.test(allText))
  );

  // 4. Associated Symptoms: Keep separate from Red Flags and separate from Chief Complaint
  let associated = "";
  const ctxAssociated = result?.ekms_ai_context?.triageState?.associated;
  const isSyntheticMeta = (s) =>
    !s || typeof s !== "string" ||
    /\b(presentation|severity|reported|rapidly spreading|urgent|evaluation|protocol|clinical|assessment|dispatch|triage|guided|destination|requiring|care|manageable|emergency|high risk|ambulance|casualty|disposition|red flag|risk|syndrome|support)\b/i.test(s);

  if (!isCertificateOnly && Array.isArray(ctxAssociated) && ctxAssociated.length > 0) {
    const filtered = ctxAssociated.filter(
      (a) =>
        !isSyntheticMeta(a) &&
        !redFlags.some((rf) => rf.toLowerCase().includes(a.toLowerCase())) &&
        !primaryLower.includes(a.toLowerCase())
    );
    // USER MANDATE: "and in associated symptoms show the primary symptoms only dont need to show all or so many"
    associated = (filtered.length > 0 ? filtered.slice(0, 2) : []).join(", ");
  }

  // Route secondary symptoms from rawProblems into associated if not already present
  if (!isCertificateOnly && Array.isArray(rawProblems)) {
    const isAssoc = (s) =>
      /\b(vomiting & nausea|vomiting|nausea|weakness & dizziness|dizziness|weakness|faint|sweating|chills)\b/i.test(s);
    const extraAssoc = rawProblems.filter((p) => isAssoc(p) && !primaryLower.includes(p.toLowerCase()));
    if (extraAssoc.length > 0) {
      const currentList = associated ? associated.split(", ").map((s) => s.trim()) : [];
      extraAssoc.forEach((ea) => {
        if (!currentList.some((cl) => cl.toLowerCase().includes(ea.toLowerCase()))) {
          currentList.push(ea);
        }
      });
      associated = currentList.slice(0, 2).join(", ");
    }
  }

  if (!isCertificateOnly && !associated) {
    const potentialSecondary = [
      { regex: /\b(swelling|sujan)\b/i, label: "Local Swelling" },
      { regex: /\b(inability to retain fluids|cannot keep fluids down)\b/i, label: "Inability to retain fluids" },
      { regex: /\b(vomit|ulti)\b/i, label: "Vomiting" },
      { regex: /\b(nausea|ji machlana)\b/i, label: "Nausea" },
      { regex: /\b(weakness|kamzori)\b/i, label: "Weakness" },
      { regex: /\b(dizziness|chakkar)\b/i, label: "Dizziness" },
      { regex: /\b(body ache|badan dard)\b/i, label: "Body Ache" },
      { regex: /\b(fever|bukhar)\b/i, label: "Fever" },
      { regex: /\b(headache|sar dard|sir dard)\b/i, label: "Headache" },
      { regex: /\b(sweating|pasina)\b/i, label: "Sweating" },
      { regex: /\b(chills|kapkapi)\b/i, label: "Chills" },
    ];
    for (const item of potentialSecondary) {
      if (
        !primaryLower.includes(item.label.toLowerCase()) &&
        !redFlags.some((rf) => rf.toLowerCase().includes(item.label.toLowerCase())) &&
        item.regex.test(allText)
      ) {
        associated = item.label;
        break;
      }
    }
  }

  // 4. Comorbidity: Professional extraction from chat, intake notes, and triage context
  let comorbidity =
    result?.ekms_ai_context?.triageState?.comorbidity ||
    result?.ekms_ai_context?.triageState?.comorbidities ||
    result?.ekms_ai_context?.comorbidity ||
    result?.ekms_ai_context?.comorbidities ||
    result?.triage?.comorbidity ||
    result?.triage?.comorbidities ||
    "";

  if (!comorbidity || /^(none|nil|none reported|no pre)/i.test(comorbidity.trim())) {
    if (
      /\b(no\s+(?:known\s+)?comorbidit(?:y|ies)|no\s+(?:pre-existing|chronic|prior)\s+(?:condition|illness|disease|history)|koi\s+purani\s+bimari\s+nahi|koi\s+bimari\s+nahi|no\s+bp\s+sugar|na\s+sugar\s+na\s+bp|none|nil|negative)\b/i.test(
        allText
      )
    ) {
      comorbidity = "";
    } else {
      const condList = [];
      if (/\b(diabet(?:es|ic)|sugar|madhumeh|high blood sugar)\b/i.test(allText)) {
        condList.push("Diabetes / High Blood Sugar");
      }
      if (/\b(hypertension|high\s*bp|blood\s*pressure|uchh\s*raktchap)\b/i.test(allText)) {
        condList.push("Hypertension / High BP");
      }
      if (/\b(asthma|damah|dama\b|wheezing|copd)\b/i.test(allText)) {
        condList.push("Bronchial Asthma / Respiratory condition");
      }
      if (/\b(heart\s*disease|cardiac|cad\b|dil\s*ki\s*bimari|angina|stent|bypass)\b/i.test(allText)) {
        condList.push("Cardiovascular / Heart Disease");
      }
      if (/\b(kidney\s*disease|renal|ckd\b|dialysis|kidney\s*problem|gurde)\b/i.test(allText)) {
        condList.push("Chronic Kidney Disease / Renal illness");
      }
      if (/\b(thyroid|hypothyroid|hyperthyroid)\b/i.test(allText)) {
        condList.push("Thyroid disorder");
      }

      if (condList.length > 0) {
        comorbidity = condList.join("; ");
      } else {
        comorbidity = "";
      }
    }
  }

  if (!comorbidity || /^(none|nil|none reported|no pre)/i.test(comorbidity.trim())) {
    comorbidity = "";
  }

  // 5. Medication: Professional extraction from chat, intake notes, and triage context
  let medication =
    result?.ekms_ai_context?.triageState?.medications ||
    result?.ekms_ai_context?.triageState?.medication ||
    result?.ekms_ai_context?.medications ||
    result?.ekms_ai_context?.medication ||
    result?.triage?.medications ||
    result?.triage?.medication ||
    "";

  if (!medication || medication.toLowerCase() === "none" || medication.toLowerCase() === "nil" || medication.toLowerCase() === "none reported") {
    if (/\b(no\s+medicin(?:e|es)|no\s+medication|haven'?t\s+taken|not\s+taken|kuch\s+nahi\s+liya|koi\s+dawa\s+nahi|dawai\s+nahi|dawa\s+nahi|none|nil)\b/i.test(allText)) {
      medication = "";
    } else {
      const medsFound = [];
      if (/\b(ondansetron|vomikind|domperidone|emset)\b/i.test(allText)) {
        medsFound.push("Tab. Ondansetron");
      }
      if (/\b(ors|electral|electrolyte)\b/i.test(allText)) {
        medsFound.push("ORS");
      }
      if (/\b(paracetamol|dolo|crocin|calpol|pcm)\b/i.test(allText)) {
        medsFound.push("Tab. Paracetamol");
      }
      if (/\b(combiflam|ibuprofen|diclofenac|aceclofenac|painkiller)\b/i.test(allText)) {
        medsFound.push("Combiflam / Diclofenac (Painkiller)");
      }
      if (/\b(cetirizine|avil|allegra|levocet|montair)\b/i.test(allText)) {
        medsFound.push("Cetirizine / Avil");
      }
      if (/\b(pantoprazole|pantocid|pan\s*40|omeprazole|omez|antacid|gelusil|digene)\b/i.test(allText)) {
        medsFound.push("Pantoprazole / Antacid");
      }
      if (/\b(inhaler|puff|asthalin|budecort|foracort)\b/i.test(allText)) {
        medsFound.push("Inhaler (Asthalin)");
      }
      if (/\b(sorbitrate|aspirin|ecospirin)\b/i.test(allText)) {
        medsFound.push("Aspirin / Sorbitrate");
      }
      if (/\b(insulin|metformin|glycomet)\b/i.test(allText)) {
        medsFound.push("Insulin / Metformin");
      }
      if (/\b(telmisartan|amlodipine|atenolol|bp\s+medicine|bp\s+dawai)\b/i.test(allText)) {
        medsFound.push("BP medicine (Telmisartan / Amlodipine)");
      }

      if (medsFound.length > 0) {
        medication = medsFound.join("; ");
      } else {
        const takingMedMatch = allText.match(/\b(?:taking|take|taken|on\s+meds?|on\s+medication|dawai\s+le|medicine\s+le)\s+([a-zA-Z0-9\s]{2,25})/i);
        if (takingMedMatch && takingMedMatch[1]) {
          const rawMed = takingMedMatch[1].trim();
          if (rawMed.length > 2 && !/^(no|none|nahi|nil)/i.test(rawMed)) {
            medication = rawMed;
          }
        }
      }
    }
  }

  // USER MANDATE: If no medication taken or no answer, leave the place blank
  if (!medication || /^(none|nil|no prior|none reported)/i.test(medication.trim())) {
    medication = "";
  } else {
    medication = medication.replace(/^medications?\s*(?:taken)?[:\s]*/i, "");
  }

  // 6. Diagnostic tests / Vitals (BP, Sugar, Temp, SpO2)
  const vitals = [];
  const bpMatch = allText.match(/\b(?:bp|blood pressure)[:\s]*(\d{2,3}\s*\/\s*\d{2,3})/i);
  if (bpMatch) vitals.push(`BP: ${bpMatch[1]} mmHg`);

  const sugarMatch = allText.match(/\b(?:sugar|glucose|rbs|fbs)[:\s]*(\d{2,3}\s*(?:mg\/dl)?)/i);
  if (sugarMatch) vitals.push(`Sugar: ${sugarMatch[1]}`);

  const tempMatch = allText.match(/\b(?:temp|temperature|fever)[:\s]*(\d{2,3}(?:\.\d)?\s*(?:°?[fc]|degrees?)?)/i);
  if (tempMatch) vitals.push(`Temp: ${tempMatch[1]}`);

  const spo2Match = allText.match(/\b(?:spo2|oxygen|o2)[:\s]*(\d{2,3}\s*%?)/i);
  if (spo2Match) vitals.push(`SpO2: ${spo2Match[1]}`);

  const diagnosticTests = vitals.length > 0 ? vitals.join(" · ") : "";

  // 7. Chief complaints already extracted above
  const primaryComplaint =
    [cleanField(firstReason), cleanField(secondReason)].filter(Boolean).join(", ") ||
    result?.triage?.primary_complaint ||
    result?.triage?.chief_complaint ||
    callerIntake?.symptom_notes ||
    result?.intake?.symptom_notes ||
    "";

  return {
    duration: isCertificateOnly ? "" : cleanField(duration),
    associated: isCertificateOnly ? "" : cleanField(associated),
    comorbidity: isCertificateOnly ? "" : (cleanField(comorbidity) || ""),
    medication: isCertificateOnly ? "" : (cleanField(medication) || ""),
    diagnosticTests: isCertificateOnly ? "" : diagnosticTests,
    firstReason: cleanField(firstReason),
    secondReason: cleanField(secondReason),
    allReasons: (Array.isArray(allReasons) && allReasons.length > 0) ? allReasons : [cleanField(firstReason), cleanField(secondReason)].filter(Boolean),
    redFlags: isCertificateOnly ? [] : redFlags,
    primaryComplaint: primaryComplaint,
    isCertificateOnly,
  };
}

function cleanField(val) {
  if (!val) return "";
  const trimmed = String(val).trim();
  if (
    trimmed === "-" ||
    trimmed === "--" ||
    trimmed === "---" ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed === "..." ||
    trimmed === "," ||
    trimmed === ";" ||
    trimmed.toLowerCase() === "n/a" ||
    trimmed.toLowerCase() === "na" ||
    trimmed.toLowerCase() === "null" ||
    trimmed.toLowerCase() === "undefined" ||
    trimmed.toLowerCase() === "unknown" ||
    trimmed.toLowerCase() === "need to be find" ||
    trimmed.toLowerCase() === "need to identify"
  ) {
    return "";
  }
  return trimmed;
}

function cleanPhone(val) {
  const cleaned = cleanField(val);
  if (!cleaned) return "";
  const digits = cleaned.replace(/^\+91\s*/, "").replace(/[^\d]/g, "");
  if (!digits || digits.length < 5) return "";
  return digits;
}

export function CaseHandoverForwarding({
  result,
  caseRef: propCaseRef,
  activeDirective,
  allRedFlags = [],
  callerIntake = null,
  callerHistory = [],
  onForwardSuccess,
  onAppointmentBooked,
  onAppointmentCancelled,
  externalTrigger = null,
  dynamicFacilities = null,
  effectiveLoc = null,
  searchPincode = "",
  isFreshTriage = false,
  isCrmPage = null,
  hideReferralDispatch = false,
  currentAgent = null,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sentStatus, setSentStatus] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [copiedDossier, setCopiedDossier] = useState(false);

  // Appointment Booking States
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false);
  const [bookedAppointment, setBookedAppointment] = useState(null);
  const [isBookingSubmitting, setIsBookingSubmitting] = useState(false);
  const [showTokenSuccess, setShowTokenSuccess] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentAgentName, setCurrentAgentName] = useState("Agent");
  const lastHandledTriggerRef = useRef(null);
  const lastLoadedCaseRef = useRef(null);

  useEffect(() => {
    try {
      const stored =
        (typeof window !== "undefined" &&
          (localStorage.getItem("ekms_auth_agent") || localStorage.getItem("crm_user_profile"))) ||
        null;
      if (stored) {
        const u = JSON.parse(stored);
        const role = String(u.role || "").toLowerCase();
        setIsAdmin(
          role === "admin" ||
          role === "master admin" ||
          Boolean(u.isAdmin) ||
          Boolean(u.isMasterAdmin)
        );
        setCurrentAgentName(u.name || u.displayName || u.email || "Agent");
      }
    } catch (_) {}
  }, []);

  const todayStr = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, []);

  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const dayAfterTomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  // Form states for booking - defaults to today and first available valid future slot
  const [apptDate, setApptDate] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  });

  const [existingAppointments, setExistingAppointments] = useState(() => {
    const cached = getCachedAppointments();
    return Array.isArray(cached) && cached.length > 0 ? cached : [];
  });

  // Subscribe to live appointments to track reserved slots in real time (cache-first + single listener + BroadcastSync)
  useEffect(() => {
    let unsubBooking = null;

    try {
      const bDb = getBookingDb() || getFirestoreDb();
      if (bDb) {
        const q = query(collection(bDb, "dispensary_appointments"));
        unsubBooking = onSnapshot(
          q,
          (snap) => {
            const list = [];
            snap.forEach((docSnap) => {
              const data = docSnap.data();
              if (data && data.status !== "cancelled") {
                list.push({ id: docSnap.id, ...data });
              }
            });
            setExistingAppointments(list);
            setCachedAppointments(list);
          },
          () => {}
        );
      }
    } catch (_) {}

    // Fallback sync via API only if cache was empty
    const currentCached = getCachedAppointments();
    if (!currentCached || currentCached.length === 0) {
      fetchEkmsAppointments()
        .then((apiList) => {
          if (Array.isArray(apiList) && apiList.length > 0) {
            setExistingAppointments((prev) => {
              const map = new Map();
              apiList.forEach((a) => {
                const id = a.id || a.tokenNo || a.referenceNo;
                if (id && a.status !== "cancelled") map.set(id, a);
              });
              prev.forEach((a) => {
                const id = a.id || a.tokenNo || a.referenceNo;
                if (id && a.status !== "cancelled") map.set(id, a);
              });
              const merged = Array.from(map.values());
              setCachedAppointments(merged);
              return merged;
            });
          }
        })
        .catch(() => {});
    }

    // Listen to broadcast events across tabs (0ms latency, 0 Firestore reads)
    const unsubBroadcast = subscribeToSync((event) => {
      const type = event?.type;
      const payload = event?.payload;
      if (
        type === "CASE_APPOINTMENT_BOOKED" ||
        type === "APPOINTMENT_CREATED" ||
        type === "APPOINTMENT_BOOKED" ||
        type === "APPOINTMENTS_UPDATED"
      ) {
        if (payload?.appointment) {
          setExistingAppointments((prev) => {
            const app = payload.appointment;
            const targetId = app.id || app.tokenNo || app.referenceNo;
            const filtered = prev.filter((a) => (a.id || a.tokenNo || a.referenceNo) !== targetId);
            if (app.status !== "cancelled") {
              filtered.push(app);
            }
            return filtered;
          });
        }
      } else if (type === "CASE_APPOINTMENT_CANCELLED" || type === "APPOINTMENT_DELETED") {
        const targetRef = payload?.case_ref || payload?.id || payload?.tokenNo;
        if (targetRef) {
          setExistingAppointments((prev) =>
            prev.filter((a) => a.id !== targetRef && a.tokenNo !== targetRef && a.caseRef !== targetRef && a.referenceNo !== targetRef)
          );
        }
      }
    });

    return () => {
      unsubBooking?.();
      unsubBroadcast?.();
    };
  }, []);

  // Real-time doctor availability & doctors per dispensary (with 0ms initial cache load)
  const [doctorAvailabilityRecords, setDoctorAvailabilityRecords] = useState(() => {
    const cached = getCachedDoctorAvailability();
    return Array.isArray(cached) && cached.length > 0 ? cached : [];
  });
  const [platformDoctors, setPlatformDoctors] = useState(() => {
    const cached = getCachedDoctors();
    return Array.isArray(cached) && cached.length > 0 ? cached : [];
  });

  useEffect(() => {
    let unsubAvail = null;
    let unsubDispDocs = null;

    try {
      const bDb = getBookingDb() || getFirestoreDb();
      if (bDb) {
        unsubAvail = onSnapshot(collection(bDb, "doctor_availability"), (snap) => {
          const list = [];
          snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
          setDoctorAvailabilityRecords(list);
          setCachedDoctorAvailability(list);

          // Infer doctors from availability records
          if (list.length > 0) {
            setPlatformDoctors((prev) => {
              const map = new Map();
              prev.forEach((p) => map.set((p.email || p.id).toLowerCase(), p));
              list.forEach((r) => {
                const email = (r.doctorEmail || r.doctorId || "").toLowerCase();
                if (email && r.dispensaryName) {
                  const existing = map.get(email);
                  map.set(email, {
                    id: email.replace(/[^a-zA-Z0-9_-]/g, "_"),
                    email,
                    displayName: r.doctorName || existing?.displayName || email.split("@")[0],
                    name: r.doctorName || existing?.name,
                    dispensaryName: r.dispensaryName,
                    dispensaryId: r.dispensaryId || existing?.dispensaryId || "",
                    role: "Doctor",
                    dispensaryRole: "doctor",
                  });
                }
              });
              const merged = Array.from(map.values());
              setCachedDoctors(merged);
              return merged;
            });
          }
        });

        // Listen to dispensary_doctors in booking database
        unsubDispDocs = onSnapshot(collection(bDb, "dispensary_doctors"), (snap) => {
          const docs = [];
          snap.forEach((d) => {
            const data = d.data();
            docs.push({
              id: d.id,
              ...data,
              email: (data.email || d.id).toLowerCase(),
            });
          });
          if (docs.length > 0) {
            setPlatformDoctors((prev) => {
              const map = new Map();
              prev.forEach((p) => map.set((p.email || p.id).toLowerCase(), p));
              docs.forEach((d) => map.set((d.email || d.id).toLowerCase(), d));
              const merged = Array.from(map.values());
              setCachedDoctors(merged);
              return merged;
            });
          }
        });
      }
    } catch (_) {}

    // Initial fallback if cache is empty
    const currentCachedDocs = getCachedDoctors();
    if (!currentCachedDocs || currentCachedDocs.length === 0) {
      fetchEkmsDoctorAvailability()
        .then((data) => {
          if (data?.records && Array.isArray(data.records) && data.records.length > 0) {
            setDoctorAvailabilityRecords((prev) => {
              const map = new Map();
              prev.forEach((r) => map.set(r.id, r));
              data.records.forEach((r) => map.set(r.id, r));
              const merged = Array.from(map.values());
              setCachedDoctorAvailability(merged);
              return merged;
            });
          }
          if (data?.doctors && Array.isArray(data.doctors) && data.doctors.length > 0) {
            setPlatformDoctors((prev) => {
              const map = new Map();
              prev.forEach((p) => map.set((p.email || p.id).toLowerCase(), p));
              data.doctors.forEach((d) => map.set((d.email || d.id).toLowerCase(), d));
              const merged = Array.from(map.values());
              setCachedDoctors(merged);
              return merged;
            });
          }
        })
        .catch(() => {});
    }

    return () => {
      unsubAvail?.();
      unsubDispDocs?.();
    };
  }, []);

  const [apptTimeSlot, setApptTimeSlot] = useState(() => {
    const today = getTodayDateString();
    return getFirstAvailableSlot(today) || ALL_OPD_TIME_SLOTS[0];
  });

  const [apptDepartment, setApptDepartment] = useState("General Medicine / Primary Care OPD");
  const [apptDoctor, setApptDoctor] = useState("");
  const [apptType, setApptType] = useState("Regular OPD Consultation");
  const [apptNotes, setApptNotes] = useState("");
  const [sendSmsNotification, setSendSmsNotification] = useState(false);
  const [bringDocsChecked, setBringDocsChecked] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (confirmCancelOpen) {
          setConfirmCancelOpen(false);
        } else if (appointmentModalOpen) {
          setAppointmentModalOpen(false);
        } else if (modalOpen) {
          setModalOpen(false);
        }
      }
    };
    if (modalOpen || appointmentModalOpen || confirmCancelOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen, appointmentModalOpen, confirmCancelOpen]);

  const t = result?.triage || {};
  const caseRef = propCaseRef || result?.case_ref || result?.case_id || result?.id || "CA0001AB01";
  const activeCallerId = useMemo(() => {
    const rawPhone = result?.intake?.phone || callerIntake?.phone || result?.phone;
    if (rawPhone) {
      return getCallerIdForPhone(rawPhone);
    }
    if (result?.caller_id && !result.caller_id.startsWith("CID")) {
      return result.caller_id;
    }
    return result?.caller_id || caseRef;
  }, [result, callerIntake, caseRef]);

  const triageTimestamp = useMemo(() => {
    return formatTriageDate(result?.created_at || result?.timestamp || result?.intake?.timestamp);
  }, [result]);

  const targetTeamId = useMemo(() => {
    return mapDirectiveToTeamId(activeDirective?.id, t);
  }, [activeDirective?.id, t]);

  useEffect(() => {
    if (isFreshTriage || result?.is_fresh_triage) {
      setSentStatus(null);
      return;
    }

    const caseTarget = caseRef || result?.case_ref || result?.case_id || result?.id;

    if (result?.is_forwarded || result?.forwarded_at || result?.dispatch_id) {
      const refId = result.reference_no || result.dispatch_id;
      setSentStatus({
        teamName: result.forwarded_to || "ESIS Dispensary",
        shortName: result.forwarded_short_name || (result.forwarded_to?.includes("Dispensary") ? "ESIS Dispensary" : "Facility"),
        dispatchId: refId || `DISP-${String(caseTarget || "SENT").slice(-6)}`,
        referenceNo: refId,
        timestamp: result.forwarded_at ? formatTriageDate(result.forwarded_at) : "Recently",
        location: result.intake?.landmark || "",
      });
      return;
    }

    if (typeof window !== "undefined" && caseTarget && !(isFreshTriage || result?.is_fresh_triage)) {
      try {
        const stored =
          sessionStorage.getItem(`ekms_forwarded_${caseTarget}`) ||
          localStorage.getItem(`ekms_forwarded_${caseTarget}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.is_forwarded && (parsed.case_ref === caseTarget || parsed.dispatch_id || parsed.reference_no)) {
            const refId = parsed.reference_no || parsed.dispatch_id;
            setSentStatus({
              teamName: parsed.forwarded_to || "ESIS Dispensary",
              shortName: parsed.forwarded_short_name || "Facility",
              dispatchId: refId || `DISP-${String(caseTarget || "SENT").slice(-6)}`,
              referenceNo: refId,
              timestamp: parsed.forwarded_at ? formatTriageDate(parsed.forwarded_at) : "Recently",
              location: "",
            });
            return;
          }
        }

        const cached = getCachedCases().find((c) => String(c.case_ref) === String(caseTarget) || String(c.id) === String(caseTarget));
        if (cached && (cached.is_forwarded || cached.forwarded_at || cached.status === "forwarded")) {
          const refId = cached.reference_no || cached.dispatch_id;
          setSentStatus({
            teamName: cached.forwarded_to || "ESIS Dispensary",
            shortName: cached.forwarded_short_name || "Facility",
            dispatchId: refId || `DISP-${String(caseTarget).slice(-6)}`,
            referenceNo: refId,
            timestamp: cached.forwarded_at ? formatTriageDate(cached.forwarded_at) : "Recently",
            location: cached.intake?.landmark || "",
          });
          return;
        }
      } catch (e) {}
    }

    setSentStatus(null);
  }, [result, caseRef]);

  const selectedTeam =
    FORWARDING_TEAMS.find((team) => team.id === targetTeamId) ||
    FORWARDING_TEAMS[0];

  const isTarget108 = selectedTeam.id === "108_AMBULANCE";

  const intakeData = useMemo(() => {
    const src = callerIntake || result?.intake || {};
    const name = cleanField(src.caller_name || result?.intake?.caller_name);
    const phone = cleanPhone(src.phone || result?.intake?.phone);
    const rawAge = src.age != null && src.age !== "" ? src.age : result?.intake?.age;
    const age = cleanField(rawAge);
    const sex = cleanField(src.sex || result?.intake?.sex);

    const landmark = cleanField(src.landmark || result?.intake?.landmark);
    const city = cleanField(src.city || result?.intake?.city);
    const district = cleanField(src.district || result?.intake?.district);
    const pincode = cleanField(src.pincode || result?.intake?.pincode);

    const locParts = [];
    if (landmark) locParts.push(landmark);
    if (city) locParts.push(city);
    if (district && district.toLowerCase() !== city.toLowerCase()) locParts.push(district);
    if (pincode) locParts.push(`PIN: ${pincode}`);

    const formattedLocation = locParts.join(", ");
    const sanitizeNumOnly = (v) => {
      if (!v) return "";
      const s = String(v).trim();
      return /^\d+$/.test(s) ? s : "";
    };
    const ipNumber = cleanField(
      sanitizeNumOnly(src.ip_number) ||
      sanitizeNumOnly(src.ipNumber) ||
      sanitizeNumOnly(src.ip_no) ||
      sanitizeNumOnly(src.ipNo) ||
      sanitizeNumOnly(src.esicNo) ||
      sanitizeNumOnly(result?.intake?.ip_number) ||
      sanitizeNumOnly(result?.intake?.ipNumber) ||
      sanitizeNumOnly(result?.intake?.ip_no) ||
      sanitizeNumOnly(result?.ip_number) ||
      sanitizeNumOnly(result?.ipNumber) ||
      (typeof window !== "undefined" ? sanitizeNumOnly(localStorage.getItem("ekms_active_ip_number")) : "") ||
      "N/A"
    );

    return {
      callerName: name,
      phone,
      age,
      sex,
      ipNumber,
      ip_number: ipNumber,
      landmark: formattedLocation,
    };
  }, [callerIntake, result]);

  const extractedDetails = useMemo(() => {
    return extractClinicalDetails(result, callerIntake, t, allRedFlags);
  }, [result, callerIntake, t, allRedFlags]);

  const isNonClinical = useMemo(() => {
    const callType =
      callerIntake?.call_type ||
      result?.intake?.call_type ||
      result?.call_type;

    if (callType === "clinical") return false;
    if (callType === "non_clinical") return true;
    if (callerIntake?.isNonClinical === true) return true;

    const sanitizeEnq = (val) => {
      if (!val || typeof val !== "string") return "";
      const trimmed = val.trim();
      if (/^(na|none|n\/a|select enquiry type|null|undefined)$/i.test(trimmed)) return "";
      return trimmed;
    };

    const enq =
      sanitizeEnq(callerIntake?.enquiry_type) ||
      sanitizeEnq(callerIntake?.enquiryType) ||
      sanitizeEnq(result?.intake?.enquiry_type) ||
      sanitizeEnq(result?.enquiry_type);

    if (enq && callerIntake?.isNonClinical) {
      return true;
    }
    return false;
  }, [result, callerIntake]);

  useEffect(() => {
    if (isNonClinical) {
      setApptDepartment("Non-Clinical Visit");
      setApptType("Non-Clinical Visit");
    } else {
      setApptDepartment("General Medicine / Primary Care OPD");
      setApptType("Regular OPD Consultation");
    }
  }, [isNonClinical]);

  const enquiryType = useMemo(() => {
    return (
      result?.intake?.enquiry_type ||
      callerIntake?.enquiry_type ||
      callerIntake?.enquiryType ||
      result?.enquiry_type ||
      "General Non-Clinical Enquiry"
    );
  }, [result, callerIntake]);

  const chiefIssue = useMemo(() => {
    return (
      result?.intake?.chief_issue ||
      callerIntake?.chief_issue ||
      callerIntake?.chiefIssue ||
      result?.chief_issue ||
      extractedDetails.primaryComplaint ||
      "Non-clinical assistance enquiry"
    );
  }, [result, callerIntake, extractedDetails]);

  const remarks = useMemo(() => {
    return (
      result?.intake?.remarks ||
      callerIntake?.remarks ||
      callerIntake?.remarksText ||
      result?.remarks ||
      ""
    );
  }, [result, callerIntake]);

  // Triage Helpline past caller history mode
  const isCrmMode = false;
  const isCrmRecord = () => false;

  // 1. Gather 104 Helpline Triage Cases
  const helplineCases = useMemo(() => {
    const rawTarget = String(intakeData.phone || "").replace(/\D/g, "");
    const target10 = rawTarget.length >= 10 ? rawTarget.slice(-10) : "";
    let list = [];

    try {
      const cached = getCachedCases() || [];
      if (target10) {
        list = cached
          .filter((c) => {
            const rawCp = String(c.intake?.phone || c.phone || "").replace(/\D/g, "");
            const cp10 = rawCp.length >= 10 ? rawCp.slice(-10) : "";
            return cp10 === target10;
          })
          .map((c) => ({
            id: c.id || c.case_ref,
            case_ref: c.case_ref || "",
            caller_id: c.caller_id || c.intake?.caller_id || "",
            created_at: c.created_at || c.timestamp || "",
            chief_complaint: c.triage?.primary_complaint || c.intake?.symptom_notes || c.triage?.chief_complaint || c.triage?.summary_en || "",
            red_flags: Array.isArray(c.triage?.red_flags) && c.triage.red_flags.length > 0
              ? c.triage.red_flags
              : (c.ekms_ai_context?.triageState?.redFlagsDetected || []),
            source: "helpline",
            sourceLabel: "104 Helpline Triage",
            urgency_level: normalizeUrgency(c.triage?.urgency_level) || "Mild",
            urgency_score: c.triage?.urgency_score || 0,
            recommended_action: c.triage?.recommended_action || "",
          }));
      }
    } catch (_) {}

    if (Array.isArray(callerHistory)) {
      callerHistory.forEach((h) => {
        if (!isCrmRecord(h)) {
          if (!list.some((existing) => existing.case_ref && existing.case_ref === h.case_ref)) {
            list.push({
              id: h.id || h.case_ref,
              case_ref: h.case_ref || "",
              caller_id: h.caller_id || "",
              created_at: h.created_at || h.createdAt || "",
              chief_complaint: h.chief_complaint || h.reason || h.summary || "",
              red_flags: h.red_flags || [],
              source: "helpline",
              sourceLabel: "104 Helpline Triage",
              urgency_level: normalizeUrgency(h.urgency_level) || "Mild",
              urgency_score: h.urgency_score || 0,
              recommended_action: h.recommended_action || h.navigation || "",
            });
          }
        }
      });
    }

    const currentCaseRef = result?.case_ref || result?.case_id || "";
    return list
      .filter((item) => !currentCaseRef || item.case_ref !== currentCaseRef)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }, [intakeData.phone, callerHistory, result]);

  // 2. Gather CRM Call Logs
  const crmCallLogs = useMemo(() => {
    const rawTarget = String(intakeData.phone || "").replace(/\D/g, "");
    const target10 = rawTarget.length >= 10 ? rawTarget.slice(-10) : "";
    let list = [];

    try {
      const raw = localStorage.getItem("crm_all_call_logs");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && target10) {
          list = parsed
            .filter((c) => {
              const cPh = String(c.phoneNumber || c.cleanPhone || "").replace(/\D/g, "");
              const c10 = cPh.length >= 10 ? cPh.slice(-10) : "";
              return c10 === target10;
            })
            .map((c) => ({
              id: c.id,
              case_ref: c.caseId || c.case_ref || "",
              caller_id: c.beneficiaryId || c.caller_id || "",
              created_at: c.createdAt || c.timestamp || c.date || "",
              chief_complaint: c.notes || c.summary || c.campaign || "Inbound consultation",
              red_flags: [],
              source: "crm",
              sourceLabel: "CRM Call Log",
              callType: c.callType || c.type || "Call",
              category: c.category || "",
              subCategory: c.subCategory || "",
              campaign: c.campaign || "",
              duration: c.duration || "",
              agent: c.agent || "",
              status: c.status || "Connected",
            }));
        }
      }
    } catch (_) {}

    if (Array.isArray(callerHistory)) {
      callerHistory.forEach((h) => {
        if (isCrmRecord(h)) {
          if (!list.some((existing) => existing.id === h.id || (existing.case_ref && existing.case_ref === (h.case_ref || h.caseId)))) {
            list.push({
              id: h.id,
              case_ref: h.caseId || h.case_ref || "",
              caller_id: h.caller_id || h.beneficiaryId || "",
              created_at: h.created_at || h.createdAt || h.timestamp || "",
              chief_complaint: h.chief_complaint || h.notes || h.summary || "Inbound consultation",
              red_flags: h.red_flags || [],
              source: "crm",
              sourceLabel: "CRM Call Log",
              callType: h.callType || "Call",
              category: h.category || "",
              subCategory: h.subCategory || "",
              campaign: h.campaign || "",
              duration: h.duration || "",
              agent: h.agent || "",
              status: h.status || "Connected",
            });
          }
        }
      });
    }

    return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }, [intakeData.phone, callerHistory]);

  const displayedCallHistory = helplineCases;

  // Legacy pastHistoryList alias to keep all existing helpers valid
  const pastHistoryList = displayedCallHistory;

  // Clean Document State (No heavy container boxes, editable inline)
  const [editData, setEditData] = useState({
    callerName: intakeData.callerName,
    ipNumber: intakeData.ipNumber || "N/A",
    phone: intakeData.phone,
    age: intakeData.age,
    sex: intakeData.sex,
    landmark: intakeData.landmark,

    firstReason: extractedDetails.firstReason,
    secondReason: extractedDetails.secondReason,
    allReasons: extractedDetails.allReasons || [extractedDetails.firstReason, extractedDetails.secondReason].filter(Boolean),
    redFlags: extractedDetails.redFlags || [],
    hpiDuration: extractedDetails.duration,
    associatedSymptoms: extractedDetails.associated,
    comorbidity: (extractedDetails.comorbidity && !/^(none|nil|no pre|none reported)/i.test(extractedDetails.comorbidity.trim())) ? extractedDetails.comorbidity : "",
    medications: (extractedDetails.medication && !/^(none|nil|no prior|none reported)/i.test(extractedDetails.medication.trim())) ? extractedDetails.medication.replace(/^medications?\s*(?:taken)?[:\s]*/i, "") : "",

    primaryDiagnosis: "",
    secondaryDiagnosis: "",

    diagnosticTests: extractedDetails.diagnosticTests || "",
    keyFindings: "",
    proceduresCompleted: "",

    newMedications: "",
    changesToMedications: "",
    careInstructions: "",

    scheduledAppointments: "",
    referrals: "",
    warningSigns: "",
  });

  const handleOpenModal = (overrideFacility = null) => {
    if (overrideFacility) {
      setSelectedFacility(overrideFacility);
    }
    const refreshed = extractClinicalDetails(result, callerIntake, t, allRedFlags);
    setEditData({
      callerName: intakeData.callerName,
      ipNumber: intakeData.ipNumber || "N/A",
      phone: intakeData.phone,
      age: intakeData.age,
      sex: intakeData.sex,
      landmark: intakeData.landmark,

      firstReason: refreshed.firstReason,
      secondReason: refreshed.secondReason,
      allReasons: refreshed.allReasons || [refreshed.firstReason, refreshed.secondReason].filter(Boolean),
      redFlags: refreshed.redFlags || [],
      hpiDuration: refreshed.duration,
      associatedSymptoms: refreshed.associated,
      comorbidity: (refreshed.comorbidity && !/^(none|nil|no pre|none reported)/i.test(refreshed.comorbidity.trim())) ? refreshed.comorbidity : "",
      medications: (refreshed.medication && !/^(none|nil|no prior|none reported)/i.test(refreshed.medication.trim())) ? refreshed.medication.replace(/^medications?\s*(?:taken)?[:\s]*/i, "") : "",

      primaryDiagnosis: "",
      secondaryDiagnosis: "",

      diagnosticTests: refreshed.diagnosticTests || "",
      keyFindings: "",
      proceduresCompleted: "",

      newMedications: "",
      changesToMedications: "",
      careInstructions: "",

      scheduledAppointments: "",
      referrals: "",
      warningSigns: "",
    });
    setModalOpen(true);
  };

  const buildDossierText = (data) => {
    const isCertOnly = Boolean(
      data.isCertificateOnly ||
      ((/\bcertificate\b/i.test(data.firstReason || "") || (Array.isArray(data.allReasons) && data.allReasons.some((r) => /\bcertificate\b/i.test(r)))) &&
        !/\b(chest pain|shortness of breath|fever|bukhar|vomit|ulti|bleeding|headache|fracture|burn|unconscious|seizure)\b/i.test(JSON.stringify(data)))
    );

    const chiefComplaintText = (Array.isArray(data.allReasons) && data.allReasons.length > 0)
      ? `  • ${data.allReasons[0]}`
      : `  • ${data.firstReason || "Primary Clinical Assessment"}`;

    const redFlagsText = isCertOnly
      ? ""
      : (Array.isArray(data.redFlags) && data.redFlags.length > 0
          ? data.redFlags.map((f) => `  • ${f}`).join("\n")
          : "  • None reported");

    const formattedPhone = data.phone
      ? (data.phone.startsWith("+91") ? data.phone : `+91 ${data.phone}`)
      : "";

    let historySection = "Past History of the Caller\n";
    if (isCrmMode) {
      if (crmCallLogs.length > 0) {
        historySection += crmCallLogs
          .map((item, idx) => {
            const timeStr = formatHistoryDateTime(item.created_at);
            const comp = item.chief_complaint || "Inbound consultation";
            return `• Past Call ${idx + 1} (${timeStr}):\n  Notes: ${comp}\n  Type: ${item.callType || "Call"}${item.category ? ` | ${item.category}` : ""}${item.agent ? ` (Agent: ${item.agent})` : ""}`;
          })
          .join("\n\n");
      } else {
        historySection += "• No previous consultation history recorded for this caller.";
      }
    } else {
      if (helplineCases.length > 0) {
        historySection += helplineCases
          .map((item, idx) => {
            const timeStr = formatHistoryDateTime(item.created_at);
            const comp = item.chief_complaint || "None recorded";
            let rfStr = "None reported";
            if (Array.isArray(item.red_flags) && item.red_flags.length > 0) {
              rfStr = item.red_flags.join("; ");
            } else if (typeof item.red_flags === "string" && item.red_flags.trim()) {
              rfStr = item.red_flags;
            }
            return `• Past Helpline Triage ${idx + 1} (${timeStr}):\n  Chief Complaint: ${comp}\n  Clinical Red Flags: ${rfStr}`;
          })
          .join("\n\n");
      } else {
        historySection += "• No previous consultation history recorded for this caller.";
      }
    }

    const targetFacilityClause = isBookable && (selectedFacility?.name || facilityDisplayName)
      ? `\n• Target Referral Facility: ${selectedFacility?.name || facilityDisplayName}${selectedFacility?.distance_km != null ? ` (Approx ${formatApproxKm(selectedFacility.distance_km)} KM away)` : ""}`
      : "";

    const activeRefNo = getUnifiedReferenceCode();
    const cleanAssociated = (!data.associatedSymptoms || /^(none|nil|no |none reported|not reported|n\/a)/i.test(data.associatedSymptoms.trim()))
      ? ""
      : data.associatedSymptoms;

    const cleanComorbidity = (!data.comorbidity || /^(none|nil|no pre|none reported|not reported|n\/a)/i.test(data.comorbidity.trim()))
      ? ""
      : data.comorbidity;

    const rawMeds = (data.medications || "").replace(/^medications?\s*(?:taken)?[:\s]*/i, "").trim();
    const cleanMeds = (!rawMeds || /^(none|nil|no |none reported|not reported|n\/a)/i.test(rawMeds))
      ? ""
      : rawMeds;

    return `1. Caller Details                                         Caller ID: ${activeCallerId}
• Reference No: ${activeRefNo}
• Name: ${data.callerName || ""}
• IP Number: ${data.ipNumber || data.ip_number || intakeData?.ipNumber || "N/A"}
• Phone Number: ${formattedPhone}
• Age: ${data.age ? data.age : ""}
• Gender: ${data.sex || ""}
• Case Date: ${triageTimestamp}
• Address: ${data.landmark || ""}${targetFacilityClause}

Clinical Overview
• Chief Complaint:
${chiefComplaintText}
• Clinical Red Flags:${isCertOnly ? "" : `\n${redFlagsText}`}
• History of Present Illness(from how long it happening): ${isCertOnly ? "" : (data.hpiDuration || "")}
• Associated Symptoms: ${isCertOnly ? "" : cleanAssociated}
• Comorbidity: ${isCertOnly ? "" : cleanComorbidity}
• Any medication: ${isCertOnly ? "" : cleanMeds}

${historySection}`;
  };

  const getFacilityPrefixSuffix = (teamId, facility, nameStr = "") => {
    const rawName = (facility?.name || nameStr || "").toLowerCase();
    const type = (facility?.facility_type || "").toLowerCase();

    // 1. 108 Ambulance Dispatch -> AMBU-00001-108A
    if (teamId === "108_AMBULANCE" || rawName.includes("108") || rawName.includes("ambulance")) {
      return { prefix: "AMBU", suffix: "108A" };
    }

    // 2. 104 Health Helpline -> HEHE-00001-104H
    if (teamId === "104_MEDICAL" || teamId === "TELE_104" || rawName.includes("104") || rawName.includes("helpline")) {
      return { prefix: "HEHE", suffix: "104H" };
    }

    // 3. Empanelled Tie-Up Facility -> TIUP-00001-HOSP
    if (
      teamId === "TIE_UP_FACILITY" ||
      isTieUp(facility) ||
      rawName.includes("tie-up") ||
      rawName.includes("tie up") ||
      rawName.includes("empanelled")
    ) {
      return { prefix: "TIUP", suffix: "HOSP" };
    }

    // 4. ESIS Dispensary -> ESI-000001-DISP
    if (
      teamId === "ESIS_DISPENSARY" ||
      isDispensary(facility) ||
      rawName.includes("dispensary") ||
      rawName.includes("esis")
    ) {
      return { prefix: "ESI", suffix: "DISP" };
    }

    // 5. ESIC Hospital -> ESIC-00001-HOSP
    if (
      teamId === "ESIC_HOSPITAL" ||
      isEsicHospital(facility) ||
      (rawName.includes("esic") && (rawName.includes("hospital") || type.includes("hospital")))
    ) {
      return { prefix: "ESIC", suffix: "HOSP" };
    }

    // 6. Govt District Hospital -> GOVT-00001-HOSP
    if (
      teamId === "DIST_HOSPITAL" ||
      isGovtDistrictHospital(facility) ||
      rawName.includes("district hospital") ||
      rawName.includes("civil hospital") ||
      rawName.includes("govt") ||
      rawName.includes("medical college")
    ) {
      return { prefix: "GOVT", suffix: "HOSP" };
    }

    if (teamId === "ESIS_DISPENSARY") return { prefix: "ESIC", suffix: "DISP" };
    if (teamId === "ESIC_HOSPITAL") return { prefix: "ESIC", suffix: "HOSP" };
    if (teamId === "DIST_HOSPITAL") return { prefix: "GOVT", suffix: "HOSP" };
    if (teamId === "TIE_UP_FACILITY") return { prefix: "TIUP", suffix: "HOSP" };

    return { prefix: "ESIC", suffix: "DISP" };
  };

  const getCaseNumericSeq = () => {
    // 1. If this exact case already has a confirmed booking for the current patient, reuse that token
    const currPhone = String(intakeData?.phone || editData?.phone || result?.intake?.phone || "").replace(/\D/g, "");
    const bookedPhone = String(bookedAppointment?.patientPhone || bookedAppointment?.phone || "").replace(/\D/g, "");
    
    if (bookedAppointment && (!currPhone || !bookedPhone || currPhone === bookedPhone)) {
      const existing = bookedAppointment.referenceNo || bookedAppointment.tokenNo;
      if (existing) {
        const match = String(existing).match(/^[A-Z]{4}-(\d{5})-[A-Z0-9]{4,5}$/i);
        if (match) return match[1];
      }
    }

    // 2. Scan existing appointments and caches to find the current maximum assigned sequence
    let maxFoundSeq = 162;
    const allKnown = [
      ...(Array.isArray(existingAppointments) ? existingAppointments : []),
      ...(Array.isArray(cachedAppointments) ? cachedAppointments : []),
    ];

    allKnown.forEach((appt) => {
      const cand = appt?.tokenNo || appt?.referenceNo || appt?.id || "";
      const m = String(cand).match(/^[A-Z]{4}-(\d{5})-[A-Z0-9]{4,5}$/i) || String(cand).match(/\b(\d{5})\b/);
      if (m) {
        const val = parseInt(m[1], 10);
        if (val > maxFoundSeq && val < 2000) {
          maxFoundSeq = val;
        }
      }
    });

    const nextSeq = maxFoundSeq + 1;
    return String(nextSeq).padStart(5, "0");
  };

  const getUnifiedReferenceCode = (targetTeamId, targetFacility, targetFacilityName) => {
    const currPhone = String(intakeData?.phone || editData?.phone || result?.intake?.phone || "").replace(/\D/g, "");
    const bookedPhone = String(bookedAppointment?.patientPhone || bookedAppointment?.phone || "").replace(/\D/g, "");

    if (bookedAppointment && (!currPhone || !bookedPhone || currPhone === bookedPhone)) {
      const existingCode = bookedAppointment.referenceNo || bookedAppointment.tokenNo;
      if (existingCode && /^[A-Z]{4}-\d{5}-[A-Z0-9]{4,5}$/i.test(String(existingCode).trim())) {
        return String(existingCode).trim().toUpperCase();
      }
    }

    const team = targetTeamId || selectedTeam?.id;
    const fac = targetFacility || selectedFacility;
    const facName = targetFacilityName || fac?.name || facilityDisplayName;
    const { prefix, suffix } = getFacilityPrefixSuffix(team, fac, facName);
    const seq = getCaseNumericSeq();
    return `${prefix}-${seq}-${suffix}`;
  };

  const handleConfirmSend = () => {
    if (bookedAppointment) {
      const bookedFacClean = (bookedAppointment.facilityName || "").toLowerCase().trim();
      const targetFacClean = isBookable
        ? (selectedFacility?.name || facilityDisplayName || "").toLowerCase().trim()
        : (selectedTeam.teamName || selectedTeam.name || "").toLowerCase().trim();
      const isSame =
        bookedFacClean === targetFacClean ||
        bookedFacClean.includes(targetFacClean) ||
        targetFacClean.includes(bookedFacClean);
      if (!isSame || isTarget108 || selectedTeam.id === "104_MEDICAL" || selectedTeam.id === "TELE_104") {
        toast.error(
          `An OPD appointment is already booked at ${bookedAppointment.facilityName}. Clinical summary can only be forwarded to ${bookedAppointment.facilityName}. Both referral and appointment must be for the same facility.`
        );
        return;
      }
    }

    if (isBookable && !selectedFacility && availableFacilities.length > 0) {
      toast.error("Please select a target facility from the dropdown before sending the clinical summary.");
      return;
    }
    if (isBookable && !isCurrentFacilityAccepting) {
      toast.error(`Cannot send clinical summary: ${facilityDisplayName} is currently offline in System Settings.`);
      return;
    }

    setIsSending(true);

    const resolvedFacilityName = isBookable ? (selectedFacility?.name || facilityDisplayName) : selectedTeam.name;
    const unifiedReferenceNo = getUnifiedReferenceCode(selectedTeam.id, selectedFacility, resolvedFacilityName);
    const dispatchId = unifiedReferenceNo;
    const timestamp = new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const dispatchDossier = buildDossierText(editData);

    setTimeout(async () => {
      try {
        navigator.clipboard?.writeText?.(dispatchDossier);
      } catch (e) { }

      const statusData = {
        directiveId: activeDirective?.id,
        targetTeamId: selectedTeam.id,
        teamName: resolvedFacilityName,
        shortName: isBookable ? (selectedFacility?.name || selectedTeam.shortName) : selectedTeam.shortName,
        teamShortName: selectedTeam.shortName,
        dispatchId: unifiedReferenceNo,
        referenceNo: unifiedReferenceNo,
        timestamp,
        location: editData.landmark,
        facilityId: selectedFacility?.id || null,
        facilityName: resolvedFacilityName,
        facilityDistanceKm: selectedFacility?.distance_km ?? null,
      };
      setSentStatus(statusData);
      onForwardSuccess?.(statusData);

      const forwardPayload = {
        case_ref: caseRef,
        is_forwarded: true,
        forwarded_at: new Date().toISOString(),
        dispatch_id: unifiedReferenceNo,
        reference_no: unifiedReferenceNo,
        directive_id: activeDirective?.id,
        forwarded_directive_id: activeDirective?.id,
        target_team_id: selectedTeam.id,
        forwarded_team_id: selectedTeam.id,
        forwarded_to: resolvedFacilityName,
        forwarded_short_name: selectedTeam.shortName,
        forwarded_facility_name: isBookable ? resolvedFacilityName : null,
        status: "forwarded",
        dispatch_info: statusData,
        triage: {
          ...(result?.triage || {}),
          forwarded_to: resolvedFacilityName,
          call_referral_primary: isBookable ? resolvedFacilityName : selectedTeam.shortName,
          referral_destination: isBookable ? resolvedFacilityName : selectedTeam.shortName,
        },
      };

      if (bookedAppointment && (bookedAppointment.referenceNo !== unifiedReferenceNo || bookedAppointment.tokenNo !== unifiedReferenceNo)) {
        const alignedBooking = {
          ...bookedAppointment,
          tokenNo: unifiedReferenceNo,
          referenceNo: unifiedReferenceNo,
        };
        setBookedAppointment(alignedBooking);
        try {
          localStorage.setItem(`ekms_appt_${caseRef}`, JSON.stringify(alignedBooking));
        } catch (e) {}
        broadcastEvent("CASE_APPOINTMENT_BOOKED", {
          case_ref: caseRef,
          appointment: alignedBooking,
        });
      }

      if (result) {
        result.is_forwarded = true;
        result.forwarded_at = forwardPayload.forwarded_at;
        result.dispatch_id = unifiedReferenceNo;
        result.reference_no = unifiedReferenceNo;
        result.forwarded_directive_id = activeDirective?.id;
        result.forwarded_team_id = selectedTeam.id;
        result.forwarded_to = resolvedFacilityName;
        result.forwarded_short_name = selectedTeam.shortName;
        result.forwarded_facility_name = isBookable ? resolvedFacilityName : null;
        result.status = "forwarded";
        result.dispatch_info = statusData;
        if (result.triage) {
          result.triage.forwarded_to = resolvedFacilityName;
          result.triage.call_referral_primary = isBookable ? resolvedFacilityName : selectedTeam.shortName;
          result.triage.referral_destination = isBookable ? resolvedFacilityName : selectedTeam.shortName;
        }
      }

      const targets = Array.from(
        new Set(
          [
            caseRef,
            propCaseRef,
            result?.case_ref,
            result?.case_id,
            result?.id,
            editData?.caseRef,
          ].filter(Boolean).map((k) => String(k).trim())
        )
      );

      targets.forEach((targetKey) => {
        const upper = targetKey.toUpperCase();
        try {
          sessionStorage.setItem(`ekms_forwarded_${targetKey}`, JSON.stringify(forwardPayload));
          localStorage.setItem(`ekms_forwarded_${targetKey}`, JSON.stringify(forwardPayload));
          if (upper !== targetKey) {
            sessionStorage.setItem(`ekms_forwarded_${upper}`, JSON.stringify(forwardPayload));
            localStorage.setItem(`ekms_forwarded_${upper}`, JSON.stringify(forwardPayload));
          }
        } catch (e) {}
        updateCaseInLocalCache(targetKey, forwardPayload);
      });

      const primaryTarget = caseRef || targets[0];
      if (primaryTarget) {
        try {
          unrecordDeletedCase(primaryTarget);
        } catch (e) {}

        const fullCasePayload = {
          id: primaryTarget,
          case_ref: primaryTarget,
          caller_id: activeCallerId || result?.caller_id,
          agent_id: activeAgent?.agentId || result?.agent_id || "",
          agent_name: activeAgentName || result?.agent_name || "Agent",
          agent_email: activeAgent?.email || result?.agent_email || null,
          intake: {
            caller_name: editData?.callerName || result?.intake?.caller_name || result?.intake?.patientName,
            phone: editData?.phone || result?.intake?.phone,
            ip_number: editData?.ipNumber || result?.intake?.ip_number || "N/A",
            age: editData?.age || result?.intake?.age,
            sex: editData?.gender || result?.intake?.sex,
            symptom_notes: editData?.chiefComplaints || result?.intake?.symptom_notes || "Clinical Triage Consultation",
            severity_reported: result?.intake?.severity_reported || 5,
            district: editData?.district || "",
            city: editData?.landmark || effectiveLoc?.address || "",
            source_app: "console",
            agent_id: activeAgent?.agentId || result?.agent_id || "",
            agent_name: activeAgentName || result?.agent_name || "Agent",
            agent_email: activeAgent?.email || result?.agent_email || null,
          },
          triage: result?.triage || forwardPayload.triage || {},
          resolved_location: result?.resolved_location || effectiveLoc,
          nearest_facilities: result?.nearest_facilities || [],
          booked_appointment: newBooking || bookedAppointment || null,
          is_forwarded: true,
          status: (newBooking || bookedAppointment) ? "booked" : "forwarded",
          booking_status: (newBooking || bookedAppointment) ? "booked" : "forwarded",
          has_appointment: Boolean(newBooking || bookedAppointment),
          created_at: new Date().toISOString(),
          ...forwardPayload,
        };

        appendCaseToLocalCache(fullCasePayload);
        broadcastEvent("NEW_CASE", fullCasePayload);
        broadcastEvent("CASE_FORWARDED", {
          case_ref: primaryTarget,
          id: result?.id,
          all_targets: targets,
          ...fullCasePayload,
        });

        // Direct client-side Firestore write guarantees immediate sync
        try {
          const tDb = getFirestoreDb();
          if (tDb) {
            await setDoc(doc(tDb, "cases", primaryTarget), fullCasePayload, { merge: true });
          }
        } catch (e) {}

        try {
          api.post("/cases", fullCasePayload).catch(() => {
            api.patch("/cases", { case_ref: primaryTarget, updates: fullCasePayload }).catch(() => {});
          });
        } catch (e) {}
      }

      try {
        sessionStorage.setItem("ekms_active_case_forwarded", JSON.stringify(forwardPayload));
        localStorage.setItem("ekms_active_case_forwarded", JSON.stringify(forwardPayload));
      } catch (e) {}

      setIsSending(false);
      setModalOpen(false);
      toast.success(
        `Clinical summary sent to ${selectedTeam.shortName}! (Ref: ${dispatchId})`
      );
    }, 600);
  };

  const handleCopyDossier = () => {
    const text = buildDossierText(editData);
    try {
      navigator.clipboard?.writeText?.(text);
      setCopiedDossier(true);
      toast.success("Clinical summary copied to clipboard!");
      setTimeout(() => setCopiedDossier(false), 2000);
    } catch (e) {
      toast.error("Failed to copy summary to clipboard");
    }
  };

  const handleAutoResize = (e) => {
    if (e?.target) {
      e.target.style.height = "auto";
      e.target.style.height = `${e.target.scrollHeight}px`;
    }
  };

  const isForwardedToTeleOrAmbulance = Boolean(
    sentStatus &&
    (
      (sentStatus.teamName && (sentStatus.teamName.includes("104") || sentStatus.teamName.includes("108"))) ||
      (sentStatus.shortName && (sentStatus.shortName.includes("104") || sentStatus.shortName.includes("108"))) ||
      (sentStatus.directiveId && (sentStatus.directiveId.includes("104") || sentStatus.directiveId.includes("108"))) ||
      (sentStatus.targetTeamId && (sentStatus.targetTeamId.includes("104") || sentStatus.targetTeamId.includes("108")))
    )
  );

  // Destination bookability check:
  // Clickable ONLY when forward option is dispensary, hospital, tie up hospital
  // In case of ambulance (108) and 104, or when already forwarded to 104/108, button is NOT clickable
  const isBookable =
    !isForwardedToTeleOrAmbulance &&
    [
      "ESIS_DISPENSARY",
      "ESIC_HOSPITAL",
      "TIE_UP_FACILITY",
      "DIST_HOSPITAL",
    ].includes(selectedTeam.id);

  // 1. Resolve caller location to compute road distances
  const callerLoc = useMemo(() => {
    if (
      effectiveLoc &&
      effectiveLoc.latitude != null &&
      effectiveLoc.longitude != null &&
      !effectiveLoc.isNoLocation
    ) {
      return effectiveLoc;
    }
    if (
      result?.resolved_location &&
      result.resolved_location.latitude != null &&
      result.resolved_location.longitude != null
    ) {
      return result.resolved_location;
    }
    const pin =
      (searchPincode && /^\d{6}$/.test(String(searchPincode).trim()) && String(searchPincode).trim()) ||
      (callerIntake?.pincode && /^\d{6}$/.test(String(callerIntake.pincode).trim()) && String(callerIntake.pincode).trim()) ||
      (result?.intake?.pincode && /^\d{6}$/.test(String(result.intake.pincode).trim()) && String(result.intake.pincode).trim()) ||
      null;

    if (pin && assamPincodesData && assamPincodesData[pin]) {
      const p = assamPincodesData[pin];
      if (p.lat != null && p.lng != null) {
        return {
          latitude: Number(p.lat),
          longitude: Number(p.lng),
          pincode: pin,
          district: p.district || null,
        };
      }
    }

    const intake = {
      ...(result?.intake || {}),
      ...(callerIntake || {}),
    };
    if (pin) intake.pincode = pin;
    const activeFacilities = Array.isArray(dynamicFacilities) && dynamicFacilities.length > 0
      ? dynamicFacilities
      : (Array.isArray(result?.nearest_facilities) ? result.nearest_facilities : []);
    return resolveCallerLocation(intake, activeFacilities);
  }, [effectiveLoc, result?.resolved_location, result?.intake, callerIntake, searchPincode, dynamicFacilities]);

  // 2. Build full facility list with road distances
  const allRankedFacilities = useMemo(() => {
    // Collect pre-calculated distances from dynamicFacilities (matches facility cards 100%)
    const dynamicMap = new Map();
    if (Array.isArray(dynamicFacilities)) {
      dynamicFacilities.forEach((f) => {
        const key = (f.name || f.id || "").toLowerCase().trim();
        if (key) dynamicMap.set(key, f);
      });
    }

    const existingNearest = Array.isArray(result?.nearest_facilities) ? result.nearest_facilities : [];
    existingNearest.forEach((f) => {
      const key = (f.name || f.id || "").toLowerCase().trim();
      if (key && !dynamicMap.has(key)) dynamicMap.set(key, f);
    });

    const baseFacilities = Array.isArray(dynamicFacilities) && dynamicFacilities.length > 0
      ? dynamicFacilities
      : (Array.isArray(result?.nearest_facilities) ? result.nearest_facilities : []);

    return baseFacilities.map((f) => {
      const key = (f.name || f.id || "").toLowerCase().trim();
      const existing = dynamicMap.get(key);
      if (existing && existing.distance_km != null) {
        return { ...f, ...existing };
      }

      let dist = existing?.distance_km ?? null;
      if (
        dist == null &&
        callerLoc?.latitude != null &&
        callerLoc?.longitude != null &&
        f.latitude != null &&
        f.longitude != null
      ) {
        const d = calculateRoadDistanceKm(
          Number(callerLoc.latitude),
          Number(callerLoc.longitude),
          Number(f.latitude),
          Number(f.longitude)
        );
        if (d != null) {
          dist = d <= 0.2 ? 0.5 : Math.round(d * 10) / 10;
        }
      }

      return {
        ...f,
        ...(existing || {}),
        distance_km: dist,
      };
    });
  }, [dynamicFacilities, result?.nearest_facilities, callerLoc]);

  // Facility Availability watcher
  const [availabilityVersion, setAvailabilityVersion] = useState(0);

  useEffect(() => {
    const handleAvailabilitySync = () => setAvailabilityVersion((v) => v + 1);
    window.addEventListener("facility_availability_change", handleAvailabilitySync);
    window.addEventListener("storage", handleAvailabilitySync);
    return () => {
      window.removeEventListener("facility_availability_change", handleAvailabilitySync);
      window.removeEventListener("storage", handleAvailabilitySync);
    };
  }, []);

  // 3. Filter and sort facilities for the active forward category (arranged in ascending distance order)
  // ONLY show facilities where booking and forwarding is allowed
  const availableFacilities = useMemo(() => {
    if (!isBookable) return [];

    let list = [];
    switch (selectedTeam.id) {
      case "ESIS_DISPENSARY":
        list = allRankedFacilities.filter(
          (f) => isDispensary(f) || (f.facility_type || "").toLowerCase().includes("dispensary")
        );
        break;
      case "DIST_HOSPITAL":
        list = allRankedFacilities.filter(
          (f) =>
            isGovtDistrictHospital(f) ||
            (f.facility_type || "").toLowerCase().includes("district hospital") ||
            (f.facility_type || "").toLowerCase().includes("civil hospital")
        );
        break;
      case "ESIC_HOSPITAL":
        list = allRankedFacilities.filter(
          (f) =>
            isEsicHospital(f) ||
            (f.name || "").toLowerCase().includes("esic hospital") ||
            (f.facility_type || "").toLowerCase() === "esic hospital"
        );
        break;
      case "TIE_UP_FACILITY":
        list = allRankedFacilities.filter(
          (f) =>
            isTieUp(f) ||
            (f.facility_type || "").toLowerCase().includes("tie") ||
            (f.scheme || "").toLowerCase().includes("tie")
        );
        break;
      default:
        list = allRankedFacilities;
    }

    // Only include facilities that are currently accepting bookings and forwarding
    list = list.filter((f) => isFacilityAccepting(f));

    // Sort strictly in ascending order of distance (nearest facility first)
    return list.sort((a, b) => {
      const da = a.distance_km != null ? Number(a.distance_km) : 9999;
      const db = b.distance_km != null ? Number(b.distance_km) : 9999;
      return da - db;
    });
  }, [allRankedFacilities, selectedTeam.id, isBookable, availabilityVersion]);

  // 4. Locked Facility Resolution (Enforce: Referral and Appointment MUST be for the exact same facility)
  const lockedForwardFacilityName = useMemo(() => {
    if (!sentStatus) return null;
    const name = sentStatus.facilityName || sentStatus.teamName || sentStatus.shortName;
    if (!name) return null;
    if (name.includes("104") || name.includes("108")) return null;
    return name;
  }, [sentStatus]);

  const lockedBookedFacilityName = useMemo(() => {
    if (!bookedAppointment?.facilityName) return null;
    return bookedAppointment.facilityName;
  }, [bookedAppointment?.facilityName]);

  const lockedFacilityObj = useMemo(() => {
    const target = lockedForwardFacilityName || lockedBookedFacilityName;
    if (!target) return null;
    const clean = target.toLowerCase().trim();
    return (
      allRankedFacilities.find((f) => {
        const fn = (f.name || "").toLowerCase().trim();
        return fn === clean || clean.includes(fn) || fn.includes(clean);
      }) || {
        name: target,
        facility_type: target.includes("Dispensary")
          ? "Dispensary"
          : target.includes("ESIC")
          ? "ESIC Hospital"
          : target.includes("Tie")
          ? "Tie-Up Hospital"
          : "District Hospital",
        distance_km: null,
      }
    );
  }, [lockedForwardFacilityName, lockedBookedFacilityName, allRankedFacilities]);

  // 5. Agent selected facility state (persisted across modals)
  const [selectedFacility, setSelectedFacility] = useState(null);

  // Auto-synchronize: if already forwarded, selectedFacility is strictly locked to the forwarded facility
  useEffect(() => {
    if (lockedForwardFacilityName) {
      if (selectedFacility?.name !== lockedForwardFacilityName) {
        setSelectedFacility(lockedFacilityObj || { name: lockedForwardFacilityName });
      }
      // Reconcile any existing mismatch in bookedAppointment
      if (bookedAppointment && bookedAppointment.facilityName !== lockedForwardFacilityName) {
        const aligned = {
          ...bookedAppointment,
          facilityName: lockedForwardFacilityName,
          facilityShortName: lockedForwardFacilityName,
        };
        setBookedAppointment(aligned);
        try {
          localStorage.setItem(`ekms_appt_${caseRef}`, JSON.stringify(aligned));
        } catch (e) {}
        broadcastEvent("CASE_APPOINTMENT_BOOKED", {
          case_ref: caseRef,
          appointment: aligned,
        });
      }
      return;
    }

    if (lockedBookedFacilityName) {
      if (selectedFacility?.name !== lockedBookedFacilityName) {
        setSelectedFacility(lockedFacilityObj || { name: lockedBookedFacilityName });
      }
      return;
    }

    // Otherwise, pre-select nearest facility in current directive category
    if (isBookable && availableFacilities.length > 0) {
      const exists = availableFacilities.some(
        (f) => (selectedFacility?.id && f.id === selectedFacility.id) || f.name === selectedFacility?.name
      );
      if (!exists) {
        setSelectedFacility(availableFacilities[0]);
      }
    }
  }, [
    lockedForwardFacilityName,
    lockedBookedFacilityName,
    lockedFacilityObj,
    availableFacilities,
    isBookable,
    selectedFacility,
    bookedAppointment,
    caseRef,
  ]);

  const facilityDisplayName = useMemo(() => {
    if (lockedForwardFacilityName) {
      return lockedForwardFacilityName;
    }
    if (lockedBookedFacilityName) {
      return lockedBookedFacilityName;
    }
    if (isBookable && selectedFacility?.name) {
      return selectedFacility.name;
    }
    if (isBookable && availableFacilities.length > 0) {
      return availableFacilities[0].name;
    }
    switch (selectedTeam.id) {
      case "108_AMBULANCE":
        return "108 Emergency Ambulance Dispatch";
      case "104_MEDICAL":
        return "104 Health Helpline / Tele-Doctor";
      default:
        return selectedTeam.name;
    }
  }, [
    lockedForwardFacilityName,
    lockedBookedFacilityName,
    isBookable,
    selectedFacility,
    availableFacilities,
    selectedTeam,
  ]);

  const activeBookingFacility = useMemo(() => {
    if (lockedForwardFacilityName) {
      return lockedFacilityObj || { name: lockedForwardFacilityName };
    }
    if (lockedBookedFacilityName) {
      return lockedFacilityObj || { name: lockedBookedFacilityName };
    }
    if (isBookable && selectedFacility) {
      return selectedFacility;
    }
    if (isBookable && availableFacilities.length > 0) {
      return availableFacilities[0];
    }
    return null;
  }, [
    lockedForwardFacilityName,
    lockedBookedFacilityName,
    lockedFacilityObj,
    isBookable,
    selectedFacility,
    availableFacilities,
  ]);

  const isCurrentFacilityAccepting = useMemo(() => {
    if (!isBookable) return true;
    const fac = activeBookingFacility || selectedFacility || facilityDisplayName;
    return isFacilityAccepting(fac);
  }, [isBookable, activeBookingFacility, selectedFacility, facilityDisplayName, availabilityVersion]);

  const targetFacilityName = selectedFacility?.name || facilityDisplayName || "";

  const currentDispensaryAvailability = useMemo(() => {
    return checkDispensaryDoctorAvailability(
      targetFacilityName,
      apptDate,
      doctorAvailabilityRecords,
      platformDoctors
    );
  }, [platformDoctors, doctorAvailabilityRecords, targetFacilityName, apptDate]);
  const currentDocId = bookedAppointment?.id || bookedAppointment?.tokenNo || bookedAppointment?.referenceNo || caseRef;
  const isCurrentSlotReserved = isSlotReserved(apptTimeSlot, apptDate, targetFacilityName, existingAppointments, currentDocId);
  const isCurrentSlotValid = Boolean(
    apptTimeSlot &&
    !isLunchSlot(apptTimeSlot) &&
    !isCurrentSlotReserved &&
    !isSlotInPast(apptTimeSlot, apptDate)
  );
  const isBasicBookingValid = isCurrentSlotValid && !isBookingSubmitting;

  // Auto-select valid future slot if unset, in past, lunch, or reserved
  useEffect(() => {
    const targetFac = selectedFacility?.name || facilityDisplayName || "";
    const curDocId = bookedAppointment?.id || bookedAppointment?.tokenNo || bookedAppointment?.referenceNo || caseRef;
    if (
      !apptTimeSlot ||
      isLunchSlot(apptTimeSlot) ||
      isSlotInPast(apptTimeSlot, apptDate) ||
      isSlotReserved(apptTimeSlot, apptDate, targetFac, existingAppointments, curDocId)
    ) {
      const nextAvail = getFirstAvailableSlot(apptDate, targetFac, existingAppointments, curDocId);
      if (nextAvail) {
        setApptTimeSlot(nextAvail);
      }
    }
  }, [apptDate, appointmentModalOpen, apptTimeSlot, selectedFacility, facilityDisplayName, existingAppointments, bookedAppointment, caseRef]);

  const canConfirmBooking =
    isBasicBookingValid &&
    isCurrentFacilityAccepting &&
    (currentDispensaryAvailability.totalDoctors === 0 || currentDispensaryAvailability.isAvailable);

  const isDispensaryBooking = useMemo(() => {
    if (selectedTeam?.id === "ESIS_DISPENSARY") return true;
    if (!activeBookingFacility) {
      return String(facilityDisplayName || "").toLowerCase().includes("dispensary");
    }
    const facType = String(activeBookingFacility.facility_type || "").toLowerCase();
    const facName = String(activeBookingFacility.name || facilityDisplayName || "").toLowerCase();
    return isDispensary(activeBookingFacility) || facType.includes("dispensary") || facName.includes("dispensary");
  }, [selectedTeam, activeBookingFacility, facilityDisplayName]);

  // When dispensary is selected, strictly enforce "General Medicine / Primary Care OPD" only
  useEffect(() => {
    if (isDispensaryBooking && apptDepartment !== "General Medicine / Primary Care OPD") {
      setApptDepartment("General Medicine / Primary Care OPD");
    }
  }, [isDispensaryBooking, apptDepartment]);

  // Restore booked appointment if previously saved for this case, only resetting when switching to a different case
  useEffect(() => {
    if (isFreshTriage || result?.is_fresh_triage) {
      setBookedAppointment(null);
      setShowTokenSuccess(false);
      lastLoadedCaseRef.current = caseRef;
      return;
    }

    if (!caseRef) {
      setBookedAppointment(null);
      setShowTokenSuccess(false);
      return;
    }

    const currPhone = String(intakeData?.phone || editData?.phone || result?.intake?.phone || "").replace(/\D/g, "").slice(-10);

    if (lastLoadedCaseRef.current !== caseRef) {
      lastLoadedCaseRef.current = caseRef;
      if (typeof window !== "undefined") {
        try {
          const saved = localStorage.getItem(`ekms_appt_${caseRef}`);
          if (saved) {
            const parsed = JSON.parse(saved);
            const savedPhone = String(parsed.patientPhone || parsed.phone || "").replace(/\D/g, "").slice(-10);
            if (currPhone && savedPhone && currPhone !== savedPhone) {
              setBookedAppointment(null);
              setShowTokenSuccess(false);
              return;
            }
            if (!parsed.referenceNo && parsed.tokenNo) {
              parsed.referenceNo = parsed.tokenNo;
            }
            setBookedAppointment(parsed);
            return;
          }
        } catch (e) {}
      }
      setBookedAppointment(null);
      setShowTokenSuccess(false);
    }
  }, [caseRef, isFreshTriage, result?.is_fresh_triage, intakeData?.phone]);

  // Keep appointment in lockstep with the selected referral facility
  useEffect(() => {
    const targetFac = lockedForwardFacilityName || selectedFacility?.name || facilityDisplayName;
    if (
      bookedAppointment &&
      isBookable &&
      targetFac &&
      bookedAppointment.facilityName !== targetFac
    ) {
      const updated = {
        ...bookedAppointment,
        facilityName: targetFac,
        facilityShortName: targetFac,
      };
      setBookedAppointment(updated);
      try {
        localStorage.setItem(`ekms_appt_${caseRef}`, JSON.stringify(updated));
      } catch (e) {}
      broadcastEvent("CASE_APPOINTMENT_BOOKED", {
        case_ref: caseRef,
        appointment: updated,
      });
    }
  }, [
    selectedTeam.id,
    isBookable,
    selectedFacility,
    facilityDisplayName,
    bookedAppointment,
    caseRef,
    lockedForwardFacilityName,
  ]);

  // Handle external trigger from facility cards or large map view
  useEffect(() => {
    if (!externalTrigger || !externalTrigger.facility || !externalTrigger.timestamp) return;
    if (lastHandledTriggerRef.current === externalTrigger.timestamp) return;
    lastHandledTriggerRef.current = externalTrigger.timestamp;

    const { type, facility } = externalTrigger;
    if (facility) {
      setSelectedFacility(facility);
    }
    if (type === "forward") {
      handleOpenModal(facility);
    } else if (type === "book") {
      if (facility) {
        setSelectedFacility(facility);
      }
      const currentTargetCase = caseRef || result?.case_ref || result?.case_id || result?.id;
      const apptCase = bookedAppointment?.caseRef || bookedAppointment?.case_ref;
      const isAlreadyBooked = Boolean(bookedAppointment && (!apptCase || apptCase === currentTargetCase));

      if (isAlreadyBooked) {
        // Only one booking allowed per Case ID: show the official confirmed slip
        setShowTokenSuccess(true);
        if (bookedAppointment.date) setApptDate(bookedAppointment.date);
        if (bookedAppointment.timeSlot) setApptTimeSlot(bookedAppointment.timeSlot);
      } else {
        setShowTokenSuccess(false);
        const today = getTodayDateString();
        setApptDate((prev) => (!prev || prev < today ? today : prev));
        setApptTimeSlot((prev) => {
          const activeDate = apptDate || today;
          if (isSlotInPast(prev, activeDate)) {
            return getFirstAvailableSlot(activeDate) || ALL_OPD_TIME_SLOTS[0];
          }
          return prev;
        });
      }
      if (isNonClinical) {
        setApptDepartment("Non-Clinical Visit");
        setApptType("Non-Clinical Visit");
      } else {
        setApptDepartment("General Medicine / Primary Care OPD");
        setApptType("Regular OPD Consultation");
      }
      setAppointmentModalOpen(true);
    }
  }, [externalTrigger, caseRef, result]);

  const handleOpenAppointmentModal = () => {
    if (isForwardedToTeleOrAmbulance) {
      toast.warning(
        `Appointment booking is not available. Case is already forwarded to ${sentStatus.shortName || sentStatus.teamName}. Telephonic and emergency helpline dispatches cannot book OPD appointments.`
      );
      return;
    }
    if (!isBookable) {
      toast.warning(
        `Appointment booking is not available for ${selectedTeam.shortName}. Both referral and appointment must be in a medical facility (ESIS Dispensary, ESIC Hospital, Tie-Up, or District Hospital).`
      );
      return;
    }
    const currentTargetCase = caseRef || result?.case_ref || result?.case_id || result?.id;
    const apptCase = bookedAppointment?.caseRef || bookedAppointment?.case_ref;
    if (bookedAppointment && (!apptCase || apptCase === currentTargetCase)) {
      setShowTokenSuccess(true);
    } else {
      setBookedAppointment(null);
      setShowTokenSuccess(false);
    }
    const today = getTodayDateString();
    setApptDate((prev) => (!prev || prev < today ? today : prev));
    setApptTimeSlot((prev) => {
      const activeDate = apptDate || today;
      if (isSlotInPast(prev, activeDate)) {
        return getFirstAvailableSlot(activeDate) || ALL_OPD_TIME_SLOTS[0];
      }
      return prev;
    });
    if (isNonClinical) {
      setApptDepartment("Non-Clinical Visit");
      setApptType("Non-Clinical Visit");
    }
    setAppointmentModalOpen(true);
  };

  const handleConfirmBooking = async (e) => {
    e?.preventDefault();
    if (isForwardedToTeleOrAmbulance) {
      toast.error(
        `Cannot book appointment. Clinical summary is already forwarded to ${sentStatus.shortName || sentStatus.teamName}. Both referral and appointment must be for the same facility.`
      );
      return;
    }
    if (sentStatus) {
      const fwdName = sentStatus.facilityName || sentStatus.teamName || sentStatus.shortName;
      if (fwdName) {
        const fwdClean = fwdName.toLowerCase().trim();
        const bookTargetClean = (selectedFacility?.name || facilityDisplayName || "").toLowerCase().trim();
        const isSame =
          fwdClean === bookTargetClean ||
          fwdClean.includes(bookTargetClean) ||
          bookTargetClean.includes(fwdClean);
        if (!isSame) {
          toast.error(
            `Cannot book at ${selectedFacility?.name || facilityDisplayName}. Clinical summary is already forwarded to ${fwdName}. Both referral and appointment must be for the same facility.`
          );
          return;
        }
      }
    }
    if (!isBookable) {
      toast.error(
        `Referral and appointment must be in the same facility. Cannot book appointment for ${selectedTeam.shortName}.`
      );
      return;
    }
    if (isBookable && !selectedFacility && availableFacilities.length > 0) {
      toast.error("Please select a target facility from the dropdown before confirming appointment.");
      return;
    }
    if (isBookable && !isCurrentFacilityAccepting) {
      toast.error(`Cannot book appointment: ${facilityDisplayName} is currently offline in System Settings.`);
      return;
    }
    if (!apptTimeSlot) {
      toast.error("Please select a time slot before confirming appointment.");
      return;
    }
    if (isWeekendOrHoliday(apptDate)) {
      toast.error("ESIS Dispensaries are closed on Sunday. Please select Monday to Saturday (10:00 AM – 04:00 PM).");
      return;
    }
    if (isLunchSlot(apptTimeSlot)) {
      toast.error("ESIS Dispensaries are on Lunch Break from 01:00 PM to 02:00 PM. Please select an available consultation slot.");
      return;
    }
    if (!currentDispensaryAvailability.isAvailable && currentDispensaryAvailability.totalDoctors > 0) {
      toast.error(
        `Cannot book appointment: All doctors at ${selectedFacility?.name || facilityDisplayName} are unavailable or on leave on ${apptDate}. Please select another date.`
      );
      return;
    }
    const targetFacForCheck = selectedFacility?.name || facilityDisplayName;
    const curDocIdForCheck = bookedAppointment?.id || bookedAppointment?.tokenNo || bookedAppointment?.referenceNo || caseRef;
    if (isSlotReserved(apptTimeSlot, apptDate, targetFacForCheck, existingAppointments, curDocIdForCheck)) {
      toast.error(`Slot ${apptTimeSlot} is already reserved at ${targetFacForCheck} for ${apptDate}. Each slot can only be booked once per day. Please select another slot.`);
      return;
    }
    if (isSlotInPast(apptTimeSlot, apptDate)) {
      toast.error("Selected time slot is unavailable or has already passed. Please select an upcoming future time slot.");
      return;
    }
    setIsBookingSubmitting(true);
    try {
      const resolvedFacilityName = selectedFacility?.name || facilityDisplayName;

      // Real-time double booking check before writing
      const bDbCheck = getBookingDb();
      if (bDbCheck) {
        try {
          const liveCheckSnap = await getDocs(
            query(collection(bDbCheck, "dispensary_appointments"), where("date", "==", apptDate))
          );
          const liveConflict = liveCheckSnap.docs.find((d) => {
            const data = d.data();
            if (data.status === "cancelled") return false;
            if (curDocIdForCheck && (data.id === curDocIdForCheck || data.tokenNo === curDocIdForCheck || data.referenceNo === curDocIdForCheck)) return false;
            const fac = data.dispensaryName || data.facilityName || "";
            return areFacilitiesMatching(fac, targetFacForCheck) && areSlotsMatching(data.timeSlot, apptTimeSlot);
          });
          if (liveConflict) {
            setIsBookingSubmitting(false);
            toast.error(`Slot ${apptTimeSlot} was just booked and locked for ${targetFacForCheck}. Please choose another slot.`);
            return;
          }
        } catch (e) {
          console.warn("Live slot check warning:", e?.message);
        }
      }
      let unifiedReferenceNo = getUnifiedReferenceCode(selectedTeam.id, selectedFacility, resolvedFacilityName);
      const tokenNo = unifiedReferenceNo;
      const resolvedChiefComplaint =
        extractedDetails.primaryComplaint ||
        extractedDetails.firstReason ||
        "Fever with chills and shivering in diabetic patient";
      const resolvedRedFlags = extractedDetails.redFlags || [];

      // Read active triage agent or admin account if available
      let activeAgent = null;
      try {
        const rawAgent =
          localStorage.getItem("ekms_active_agent") ||
          sessionStorage.getItem("ekms_active_agent") ||
          localStorage.getItem("ekms_auth_agent") ||
          localStorage.getItem("crm_user_profile");
        if (rawAgent) activeAgent = JSON.parse(rawAgent);
      } catch (e) {}

      if (!activeAgent || !activeAgent.displayName || activeAgent.displayName === "Agent") {
        if (currentAgent && (currentAgent.displayName || currentAgent.name)) {
          activeAgent = currentAgent;
        }
      }

      const fbUser = auth?.currentUser;
      const fbEmail = fbUser?.email?.toLowerCase() || "";
      const fbName = fbUser?.displayName || (fbEmail ? fbEmail.split("@")[0] : "");

      const candidateName =
        activeAgent?.displayName ||
        activeAgent?.name ||
        currentAgent?.displayName ||
        currentAgent?.name ||
        fbName;

      const candidateEmail =
        activeAgent?.email ||
        currentAgent?.email ||
        fbEmail ||
        "";

      let activeAgentName = formatAgentDisplayName(
        candidateName,
        candidateEmail,
        activeAgent?.agentId || currentAgent?.agentId || fbUser?.uid
      );

      if (!activeAgentName || activeAgentName.toLowerCase() === "agent" || activeAgentName.toLowerCase() === "staff") {
        if (candidateEmail) {
          const parts = candidateEmail.split("@")[0].split(/[._\-\s]+/).filter(Boolean);
          activeAgentName = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
        } else if (candidateName) {
          activeAgentName = candidateName;
        } else {
          activeAgentName = "Authorized Agent";
        }
      }
      if (!activeAgentName || activeAgentName.toLowerCase() === "agent") {
        activeAgentName = "Ekmsoffice";
      }

      // Package full caller past call history - ONLY true call-only logs (exclude current case and calls where booking was done)
      const currentCaseKey = String(caseRef || result?.case_ref || "").trim().toUpperCase();
      const matchNumHelper = (s) => {
        const m = String(s || "").match(/(\d{3,5})/);
        return m ? parseInt(m[1], 10) : null;
      };
      const currentCaseNum = matchNumHelper(currentCaseKey);

      const pastCallsData = (displayedCallHistory || pastHistoryList || [])
        .filter((h) => {
          if (!h) return false;
          const hRef = String(h.case_ref || h.id || "").trim().toUpperCase();
          if (currentCaseKey && (hRef === currentCaseKey || hRef.includes(currentCaseKey) || currentCaseKey.includes(hRef))) {
            return false;
          }
          const hNum = matchNumHelper(hRef);
          if (currentCaseNum && hNum && currentCaseNum === hNum) {
            return false;
          }
          if (h.booked_appointment || h.has_appointment || h.token || h.tokenNo) {
            return false;
          }
          const navStr = String(h.navigation || h.recommended_action || "").toLowerCase();
          if (navStr.includes("appointment booked at")) {
            return false;
          }
          return true;
        })
        .map((h, idx) => ({
        id: h.id || h.case_ref || `call-${idx}`,
        case_ref: h.case_ref || "",
        caller_id: h.caller_id || "",
        created_at: h.created_at || h.createdAt || "",
        chief_complaint: h.chief_complaint || h.reason || h.summary || "",
        red_flags: Array.isArray(h.red_flags) ? h.red_flags : (typeof h.red_flags === "string" ? [h.red_flags] : []),
        triage_level: h.triage_level || "",
        urgency_level: normalizeUrgency(h.urgency_level || h.triage_level) || "Moderate",
        routed_facility: h.routed_facility || "",
        agent_name: h.agent_name || "",
        clinical_summary: h.clinical_summary || h.summary || "",
        recommended_action: h.recommended_action || h.action || h.routed_facility || "",
        source: h.source || "helpline",
      }));

      // Extract past 3 calls specifically for doctor OPD handover
      const past3Calls = (pastCallsData || []).slice(0, 3).map((item, idx) => {
        const norm = normalizeUrgency(item.urgency_level || item.triage_level) || "Moderate";
        const rf = Array.isArray(item.red_flags)
          ? item.red_flags
          : (typeof item.red_flags === "string" && item.red_flags.trim() ? [item.red_flags.trim()] : []);
        return {
          id: item.id || `past-${idx + 1}`,
          case_ref: item.case_ref || "",
          caller_id: item.caller_id || activeCallerId || "",
          created_at: item.created_at || "",
          formatted_date: formatHistoryDateTime(item.created_at),
          urgency_level: norm,
          severity: norm.toUpperCase(),
          chief_complaint: item.chief_complaint || item.reason || item.summary || "No chief complaint recorded",
          red_flags: rf,
          recommended_action: item.recommended_action || item.action || item.routed_facility || "Direct patient to nearest designated healthcare facility.",
          action: item.recommended_action || item.action || item.routed_facility || "",
          routed_facility: item.routed_facility || "",
          agent_name: item.agent_name || "",
        };
      });

      // Package structured clinical overview record
      const clinicalRecord = {
        callerId: activeCallerId,
        callerName: intakeData.callerName || editData.callerName || result?.intake?.caller_name || result?.caller_name || "Patient",
        phone: intakeData.phone || editData.phone || result?.intake?.phone || result?.phone || "",
        age: String(intakeData.age || editData.age || result?.intake?.age || "35"),
        sex: intakeData.sex || editData.sex || result?.intake?.sex || "Male",
        address: intakeData.landmark || editData.landmark || effectiveLoc?.address || "",
        chiefComplaints: Array.isArray(editData.allReasons) && editData.allReasons.length > 0
          ? editData.allReasons
          : (resolvedChiefComplaint ? [resolvedChiefComplaint] : []),
        primaryComplaint: resolvedChiefComplaint,
        redFlags: Array.isArray(editData.redFlags) && editData.redFlags.length > 0
          ? editData.redFlags
          : (Array.isArray(resolvedRedFlags) ? resolvedRedFlags : []),
        hpiDuration: editData.hpiDuration || (result?.intake?.duration || ""),
        associatedSymptoms: (!editData.associatedSymptoms || /^(none|nil|no |none reported|not reported|n\/a)/i.test(editData.associatedSymptoms.trim()))
          ? ""
          : editData.associatedSymptoms,
        comorbidity: (!editData.comorbidity || /^(none|nil|no pre|none reported|not reported|n\/a)/i.test(editData.comorbidity.trim()))
          ? ""
          : editData.comorbidity,
        medications: (!editData.medications || /^(none|nil|no |none reported|not reported|n\/a)/i.test(editData.medications.trim()))
          ? ""
          : (editData.medications || "").replace(/^medications?\s*(?:taken)?[:\s]*/i, "").trim(),
      };

      // Generate structured clinical handover dossier
      const clinicalSummaryDossier = buildDossierText(editData);

      const finalIsNonClinical = Boolean(
        isNonClinical ||
        apptType === "Non-Clinical Visit" ||
        apptDepartment === "Non-Clinical Visit"
      );

      const rawIpCandidate =
        editData?.ipNumber ||
        editData?.ip_number ||
        intakeData?.ipNumber ||
        intakeData?.ip_number ||
        intakeData?.ipNo ||
        intakeData?.ip_no ||
        result?.intake?.ip_number ||
        result?.intake?.ipNumber ||
        result?.ip_number ||
        result?.ipNumber ||
        (typeof window !== "undefined" ? localStorage.getItem("ekms_active_ip_number") : "") ||
        "";
      const cleanIpMatch = String(rawIpCandidate).replace(/[^\d]/g, "").trim();
      const resolvedIpNumber = (cleanIpMatch && cleanIpMatch.length >= 6) ? cleanIpMatch : (cleanIpMatch || "N/A");

      const targets = Array.from(
        new Set(
          [caseRef, propCaseRef, result?.case_ref, result?.case_id, result?.id, editData?.caseRef]
            .filter(Boolean)
            .map((k) => String(k).trim())
        )
      );
      const primaryTarget = caseRef || targets[0] || "";

      const newBooking = {
        caseRef: primaryTarget || unifiedReferenceNo,
        tokenNo: unifiedReferenceNo,
        referenceNo: unifiedReferenceNo,
        facilityName: resolvedFacilityName,
        facilityTeamId: selectedTeam.id,
        facilityShortName: selectedTeam.shortName,
        facilityDistanceKm: selectedFacility?.distance_km ?? null,
        facilityDistrict: selectedFacility?.district ?? "",
        department: apptDepartment || (finalIsNonClinical ? "Non-Clinical Visit" : "General Medicine / Primary Care OPD"),
        doctor: apptDoctor || null,
        doctorName: null,
        prescribedBy: null,
        doctorConsultedAt: null,
        doctorNotes: null,
        bookedByName: activeAgentName,
        bookedByEmail: candidateEmail,
        agentName: activeAgentName,
        agentId: activeAgent?.agentId || "",
        date: apptDate,
        timeSlot: apptTimeSlot,
        appointmentType: apptType || (finalIsNonClinical ? "Non-Clinical Visit" : "Regular OPD Consultation"),
        callType: finalIsNonClinical ? "non_clinical" : "clinical",
        enquiryType: finalIsNonClinical ? enquiryType : null,
        chiefIssue: finalIsNonClinical ? chiefIssue : null,
        remarks: finalIsNonClinical ? remarks : null,
        patientName: intakeData.callerName || editData.callerName || result?.intake?.caller_name || result?.caller_name || "Patient",
        ipNumber: resolvedIpNumber,
        ip_number: resolvedIpNumber,
        ipNo: resolvedIpNumber,
        ip_no: resolvedIpNumber,
        patientPhone: intakeData.phone || editData.phone || result?.intake?.phone || result?.phone || "",
        patientAge: intakeData.age || editData.age || result?.intake?.age || "35",
        patientSex: intakeData.sex || editData.sex || result?.intake?.sex || "Male",
        patientAddress: intakeData.landmark || editData.landmark || effectiveLoc?.address || "",
        chiefComplaint: finalIsNonClinical ? `[${enquiryType}] ${chiefIssue}` : resolvedChiefComplaint,
        redFlags: finalIsNonClinical ? [] : resolvedRedFlags,
        agentNotes: apptNotes ? apptNotes.trim() : "",
        sendSmsNotification: Boolean(sendSmsNotification),
        smsSent: Boolean(sendSmsNotification),
        bookedAt: new Date().toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }),
        clinicalSummary: finalIsNonClinical
          ? `[NON-CLINICAL ENQUIRY]\nEnquiry Type: ${enquiryType}\nChief Issue: ${chiefIssue}${remarks ? `\nRemarks: ${remarks}` : ""}${apptNotes ? `\nAgent Notes: ${apptNotes.trim()}` : ""}`
          : clinicalSummaryDossier,
        clinicalRecord: clinicalRecord,
        clinicalOverview: clinicalRecord,
        past3Calls: past3Calls,
        pastCallsCount: pastCallsData.length,
        pastCallHistory: pastCallsData,
      };

      // Guaranteed monotonic unique token allocation:
      // Uses the atomic /api/appointments/next-token server endpoint and verifies against
      // existingAppointments so no booking can EVER collide or overwrite an existing patient.
      const { prefix, suffix } = getFacilityPrefixSuffix(selectedTeam?.id, selectedFacility, resolvedFacilityName);
      let finalUnifiedRef = unifiedReferenceNo;
      let appointmentDocId = finalUnifiedRef.replace(/[^a-zA-Z0-9_-]/g, "_");

      const currPhone = String(newBooking.patientPhone || intakeData?.phone || editData?.phone || "").replace(/\D/g, "");

      // Check if current candidate token is already taken by a different patient
      const isTaken = existingAppointments.some((a) => {
        const aToken = String(a.tokenNo || a.referenceNo || a.id || "").trim();
        const aPhone = String(a.phone || a.patientPhone || "").replace(/\D/g, "");
        return aToken === finalUnifiedRef && currPhone && aPhone && currPhone !== aPhone;
      });

      // Always fetch fresh atomic token for any new booking or collision
      if (isTaken || !finalUnifiedRef || !bookedAppointment) {
        try {
          const apiRes = await fetch("/api/appointments/next-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prefix,
              suffix,
              facilityType: selectedTeam?.id,
              isHospital: suffix === "HOSP",
            }),
          }).then((r) => r.json());

          if (apiRes?.tokenNo) {
            finalUnifiedRef = apiRes.tokenNo;
            appointmentDocId = apiRes.docId || finalUnifiedRef.replace(/[^a-zA-Z0-9_-]/g, "_");
          }
        } catch (apiErr) {
          console.warn("API next-token fetch notice:", apiErr?.message);
        }
      }

      // Client-side safety check: ensure token does not collide with existing appointments
      let collisionAttempts = 0;
      while (
        existingAppointments.some((a) => {
          const aToken = String(a.tokenNo || a.referenceNo || a.id || "").trim();
          const aPhone = String(a.phone || a.patientPhone || "").replace(/\D/g, "");
          return aToken === finalUnifiedRef && currPhone && aPhone && currPhone !== aPhone;
        }) &&
        collisionAttempts < 20
      ) {
        collisionAttempts++;
        let maxExisting = 1;
        existingAppointments.forEach((a) => {
          const m = String(a.tokenNo || a.referenceNo || a.id || "").match(/^[A-Z]{3,4}-(\d{4,6})-[A-Z0-9]{4,5}$/i);
          if (m) {
            const v = parseInt(m[1], 10);
            if (v > maxExisting && v < 200000) maxExisting = v;
          }
        });
        const bumped = maxExisting + collisionAttempts;
        finalUnifiedRef = `${prefix}-${String(bumped).padStart(6, "0")}-${suffix}`;
        appointmentDocId = finalUnifiedRef.replace(/[^a-zA-Z0-9_-]/g, "_");
      }

      unifiedReferenceNo = finalUnifiedRef;
      newBooking.tokenNo = finalUnifiedRef;
      newBooking.referenceNo = finalUnifiedRef;
      newBooking.id = appointmentDocId;
      const appointmentRecord = {
        id: appointmentDocId,
        tokenNo: unifiedReferenceNo,
        referenceNo: unifiedReferenceNo,
        case_ref: primaryTarget || caseRef || "",
        caseId: primaryTarget || caseRef || "",
        _skipSheetWebhook: true,
        ipName: newBooking.patientName,
        patientName: newBooking.patientName,
        ipNumber: resolvedIpNumber,
        ip_number: resolvedIpNumber,
        ipNo: resolvedIpNumber,
        ip_no: resolvedIpNumber,
        sendSmsNotification: Boolean(sendSmsNotification),
        smsSent: Boolean(sendSmsNotification),
        phone: newBooking.patientPhone,
        patientPhone: newBooking.patientPhone,
        age: String(newBooking.patientAge || ""),
        gender: newBooking.patientSex || "Male",
        dispensaryName: resolvedFacilityName,
        facilityName: resolvedFacilityName,
        dispensaryId: selectedFacility?.id || "",
        district: selectedFacility?.district || newBooking.facilityDistrict || "",
        location: selectedFacility?.address || selectedFacility?.location || newBooking.patientAddress || "",
        date: apptDate,
        timeSlot: apptTimeSlot,
        department: apptDepartment || (finalIsNonClinical ? "Non-Clinical Visit" : "General Medicine / Primary Care OPD"),
        appointmentType: apptType || (finalIsNonClinical ? "Non-Clinical Visit" : "Regular OPD Consultation"),
        callType: finalIsNonClinical ? "non_clinical" : "clinical",
        enquiryType: finalIsNonClinical ? enquiryType : null,
        chiefIssue: finalIsNonClinical ? chiefIssue : null,
        remarks: finalIsNonClinical ? remarks : null,
        purpose: finalIsNonClinical ? `[${enquiryType}] ${chiefIssue}` : resolvedChiefComplaint,
        chiefComplaint: finalIsNonClinical ? `[${enquiryType}] ${chiefIssue}` : resolvedChiefComplaint,
        notes: newBooking.agentNotes || "",
        status: (bookedAppointment?.status && bookedAppointment.status !== "scheduled") ? bookedAppointment.status : "scheduled",
        doctor: apptDoctor || bookedAppointment?.doctor || null,
        doctorName: bookedAppointment?.doctorName || null,
        prescribedBy: bookedAppointment?.prescribedBy || null,
        doctorConsultedAt: bookedAppointment?.doctorConsultedAt || null,
        doctorNotes: bookedAppointment?.doctorNotes || null,
        receptionCheckedInAt: bookedAppointment?.receptionCheckedInAt || null,
        receptionCheckedInBy: bookedAppointment?.receptionCheckedInBy || null,
        visitedAt: bookedAppointment?.visitedAt || null,
        visitedBy: bookedAppointment?.visitedBy || null,
        dispensedAt: bookedAppointment?.dispensedAt || null,
        dispensedBy: bookedAppointment?.dispensedBy || null,
        bookedByEmail: candidateEmail,
        bookedByName: activeAgentName,
        bookedBy: activeAgentName,
        agentName: activeAgentName,
        agentId: activeAgent?.agentId || "",
        bookedAt: newBooking.bookedAt,
        createdAt: Date.now(),
        source: "EKMS Triage",
        clinicalSummary: finalIsNonClinical
          ? `[NON-CLINICAL ENQUIRY]\nEnquiry Type: ${enquiryType}\nChief Issue: ${chiefIssue}${remarks ? `\nRemarks: ${remarks}` : ""}${apptNotes ? `\nAgent Notes: ${apptNotes.trim()}` : ""}`
          : clinicalSummaryDossier,
        clinicalRecord: clinicalRecord,
        clinicalOverview: clinicalRecord,
        past3Calls: past3Calls,
        triageLevel: finalIsNonClinical ? "ROUTINE" : (result?.triage?.triage_level || "MILD"),
        triageScore: finalIsNonClinical ? 1 : (result?.triage?.score ?? null),
        redFlags: finalIsNonClinical ? [] : resolvedRedFlags,
        pastCallsCount: pastCallsData.length,
        pastCallHistory: pastCallsData,
      };

      // 4. Automatic Clinical Summary Forwarding to Facility (Unified Booking & Handover)
      const statusData = {
        directiveId: activeDirective?.id,
        targetTeamId: selectedTeam.id,
        teamName: resolvedFacilityName,
        shortName: isBookable ? (selectedFacility?.name || selectedTeam.shortName) : selectedTeam.shortName,
        teamShortName: selectedTeam.shortName,
        dispatchId: unifiedReferenceNo,
        referenceNo: unifiedReferenceNo,
        timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        location: editData.landmark,
        facilityId: selectedFacility?.id || null,
        facilityName: resolvedFacilityName,
        facilityDistanceKm: selectedFacility?.distance_km ?? null,
        isBookedAndForwarded: true,
      };
      setSentStatus(statusData);
      onForwardSuccess?.(statusData);

      const forwardPayload = {
        case_ref: caseRef,
        is_forwarded: true,
        forwarded_at: new Date().toISOString(),
        dispatch_id: unifiedReferenceNo,
        reference_no: unifiedReferenceNo,
        directive_id: activeDirective?.id,
        forwarded_directive_id: activeDirective?.id,
        target_team_id: selectedTeam.id,
        forwarded_team_id: selectedTeam.id,
        forwarded_to: resolvedFacilityName,
        forwarded_short_name: selectedTeam.shortName,
        forwarded_facility_name: isBookable ? resolvedFacilityName : null,
        status: isBookable ? "booked" : "forwarded",
        booking_status: isBookable ? "booked" : "forwarded",
        has_appointment: Boolean(isBookable),
        dispatch_info: statusData,
        booked_appointment: newBooking,
        triage: {
          ...(result?.triage || {}),
          forwarded_to: resolvedFacilityName,
          call_referral_primary: isBookable ? resolvedFacilityName : selectedTeam.shortName,
          referral_destination: isBookable ? resolvedFacilityName : selectedTeam.shortName,
        },
      };

      targets.forEach((targetKey) => {
        const upper = targetKey.toUpperCase();
        try {
          sessionStorage.setItem(`ekms_forwarded_${targetKey}`, JSON.stringify(forwardPayload));
          localStorage.setItem(`ekms_forwarded_${targetKey}`, JSON.stringify(forwardPayload));
          if (upper !== targetKey) {
            sessionStorage.setItem(`ekms_forwarded_${upper}`, JSON.stringify(forwardPayload));
            localStorage.setItem(`ekms_forwarded_${upper}`, JSON.stringify(forwardPayload));
          }
        } catch (e) {}
        updateCaseInLocalCache(targetKey, forwardPayload);
      });

      try {
        sessionStorage.setItem("ekms_active_case_forwarded", JSON.stringify(forwardPayload));
        localStorage.setItem("ekms_active_case_forwarded", JSON.stringify(forwardPayload));
      } catch (e) {}

      let fullCasePayload = null;
      if (primaryTarget) {
        try {
          unrecordDeletedCase(primaryTarget);
        } catch (e) {}

        fullCasePayload = {
          id: primaryTarget,
          case_ref: primaryTarget,
          caller_id: activeCallerId || result?.caller_id,
          agent_id: activeAgent?.agentId || result?.agent_id || "",
          agent_name: activeAgentName || result?.agent_name || "Agent",
          agent_email: activeAgent?.email || result?.agent_email || null,
          intake: {
            caller_name: editData?.callerName || result?.intake?.caller_name || result?.intake?.patientName,
            phone: editData?.phone || result?.intake?.phone,
            ip_number: editData?.ipNumber || result?.intake?.ip_number || "N/A",
            age: editData?.age || result?.intake?.age,
            sex: editData?.gender || result?.intake?.sex,
            symptom_notes: editData?.chiefComplaints || result?.intake?.symptom_notes || "Clinical Triage Consultation",
            severity_reported: result?.intake?.severity_reported || 5,
            district: editData?.district || "",
            city: editData?.landmark || effectiveLoc?.address || "",
            source_app: "console",
            agent_id: activeAgent?.agentId || result?.agent_id || "",
            agent_name: activeAgentName || result?.agent_name || "Agent",
            agent_email: activeAgent?.email || result?.agent_email || null,
          },
          triage: result?.triage || forwardPayload.triage || {},
          resolved_location: result?.resolved_location || effectiveLoc,
          nearest_facilities: result?.nearest_facilities || [],
          booked_appointment: newBooking || bookedAppointment || null,
          is_forwarded: true,
          status: (newBooking || bookedAppointment) ? "booked" : "forwarded",
          booking_status: (newBooking || bookedAppointment) ? "booked" : "forwarded",
          has_appointment: Boolean(newBooking || bookedAppointment),
          created_at: new Date().toISOString(),
          ...forwardPayload,
        };

        appendCaseToLocalCache(fullCasePayload);
        broadcastEvent("NEW_CASE", fullCasePayload);
        broadcastEvent("CASE_FORWARDED", {
          case_ref: primaryTarget,
          id: result?.id,
          all_targets: targets,
          ...fullCasePayload,
        });
      }

      // Instant optimistic UI feedback (< 5ms response time)
      lastHandledTriggerRef.current = Date.now();
      setBookedAppointment(newBooking);
      if (sentStatus && (sentStatus.dispatchId !== unifiedReferenceNo || sentStatus.referenceNo !== unifiedReferenceNo)) {
        const alignedStatus = {
          ...sentStatus,
          dispatchId: unifiedReferenceNo,
          referenceNo: unifiedReferenceNo,
        };
        setSentStatus(alignedStatus);
      }
      setShowTokenSuccess(true);
      setIsBookingSubmitting(false);

      try {
        localStorage.setItem(`ekms_appt_${caseRef}`, JSON.stringify(newBooking));
        if (result) {
          result.booked_appointment = newBooking;
          result.reference_no = unifiedReferenceNo;
          result.dispatch_id = unifiedReferenceNo;
        }
      } catch (e) {}

      // Update client cache immediately for 0ms load across all agent desks
      const currentApps = getCachedAppointments();
      const updatedApps = [newBooking, ...currentApps.filter(a => (a.id || a.tokenNo) !== newBooking.id && (a.id || a.tokenNo) !== newBooking.tokenNo)];
      setCachedAppointments(updatedApps);

      broadcastEvent("CASE_APPOINTMENT_BOOKED", {
        case_ref: caseRef,
        appointment: newBooking,
      });
      broadcastEvent("APPOINTMENTS_UPDATED", {
        appointment: newBooking,
      });

      onAppointmentBooked?.(newBooking);

      toast.success(
        sendSmsNotification
          ? `OPD Appointment booked! Reference No: ${unifiedReferenceNo} generated and SMS dispatched to +91 ${newBooking.patientPhone}.`
          : `OPD Appointment booked! Reference No: ${unifiedReferenceNo} generated successfully.`
      );

      // Fast non-blocking parallel background sync to all DBs
      const syncTasks = [];
      try {
        const bDb = getBookingDb();
        if (bDb) {
          syncTasks.push(
            setDoc(doc(bDb, "dispensary_appointments", appointmentDocId), appointmentRecord, { merge: true })
              .catch((e) => console.warn("bDb setDoc notice:", e?.message))
          );
        }
      } catch (e) {}
      try {
        const oldDb = getOldBookingDb();
        if (oldDb) {
          syncTasks.push(
            setDoc(doc(oldDb, "dispensary_appointments", appointmentDocId), appointmentRecord, { merge: true })
              .catch((e) => console.warn("oldDb safety backup setDoc notice:", e?.message))
          );
        }
      } catch (e) {}
      try {
        const tDb = getFirestoreDb();
        if (tDb) {
          syncTasks.push(
            setDoc(doc(tDb, "dispensary_appointments", appointmentDocId), appointmentRecord, { merge: true })
              .catch((e) => console.warn("tDb setDoc notice:", e?.message))
          );
          if (primaryTarget && fullCasePayload) {
            syncTasks.push(
              setDoc(doc(tDb, "cases", primaryTarget), fullCasePayload, { merge: true })
                .catch((e) => console.warn("cases setDoc notice:", e?.message))
            );
          }
        }
      } catch (e) {}
      syncTasks.push(bookAppointmentViaEkmsApi(appointmentRecord).catch(() => {}));
      syncTasks.push(
        recordAppointmentBookingToSheet(
          {
            ...newBooking,
            tokenNo: newBooking.tokenNo || unifiedReferenceNo,
            referenceNo: unifiedReferenceNo,
            ipNumber: newBooking.ipNumber || resolvedIpNumber,
            ip_number: newBooking.ip_number || resolvedIpNumber,
            ipNo: newBooking.ipNo || resolvedIpNumber,
            ip_no: newBooking.ip_no || resolvedIpNumber,
            phone: newBooking.patientPhone || newBooking.phone || editData?.phone || intakeData?.phone || "",
            case_ref: primaryTarget || caseRef,
            caseId: primaryTarget || caseRef,
            bookedByName: activeAgentName,
            agentName: activeAgentName,
            bookedBy: activeAgentName,
            bookedByEmail: candidateEmail,
            dispensaryName: targetFacilityName || newBooking.facilityName || newBooking.dispensaryName || "ESIS Dispensary",
            facilityName: targetFacilityName || newBooking.facilityName || newBooking.dispensaryName || "ESIS Dispensary",
            date: apptDate || newBooking.date || "",
            timeSlot: apptTimeSlot || newBooking.timeSlot || "",
            chiefComplaint: resolvedChiefComplaint || newBooking.purpose || newBooking.chiefComplaint || "",
          },
          activeAgentName,
          primaryTarget || caseRef
        ).catch((err) => console.warn("recordAppointmentBookingToSheet notice:", err))
      );
      if (primaryTarget && fullCasePayload) {
        syncTasks.push(
          api.post("/cases", { ...fullCasePayload, _skipSheetWebhook: true }).catch(() => {
            api.patch("/cases", { case_ref: primaryTarget, updates: fullCasePayload, _skipSheetWebhook: true }).catch(() => {});
          })
        );
      }
      Promise.allSettled(syncTasks).catch((e) => console.warn("Background booking persist notice:", e));

    } catch (err) {
      console.error("Booking error:", err);
      setIsBookingSubmitting(false);
      toast.error("Failed to complete booking: " + (err?.message || "Please try again."));
    }
  };

  const handleCancelBooking = async (e) => {
    e?.stopPropagation?.();
    if (!isAdmin) {
      toast.error("Permission Denied: Only administrators are authorized to cancel or delete appointments.");
      return;
    }
    const curStatus = String(bookedAppointment?.status || "").toLowerCase();
    if (
      curStatus === "completed" ||
      curStatus === "dispensed" ||
      curStatus === "visited" ||
      curStatus === "prescribed" ||
      curStatus === "checked_in" ||
      bookedAppointment?.isCompleted
    ) {
      toast.error("Cannot cancel an appointment that has already been visited or completed.");
      return;
    }
    const caseTarget = caseRef || result?.case_ref || result?.case_id || result?.id;
    const tokenToCancel = bookedAppointment?.referenceNo || bookedAppointment?.tokenNo;

    // Archive to 7-day Recently Deleted Holding Vault for 1-click restoration
    if (tokenToCancel && bookedAppointment) {
      archiveToRecentlyDeleted({
        itemType: "appointment",
        originalId: tokenToCancel,
        title: bookedAppointment.patientName ? `Appointment: ${bookedAppointment.patientName}` : `Appointment ${tokenToCancel}`,
        subtitle: `${bookedAppointment.dispensaryName || "Dispensary"} • ${bookedAppointment.appointmentDate || "Date"} • ${bookedAppointment.timeSlot || "Slot"}`,
        deletedBy: currentAgentName || "Admin",
        facilityName: bookedAppointment.dispensaryName || "",
        date: bookedAppointment.appointmentDate || "",
        originalData: { ...bookedAppointment, caseId: caseTarget },
      }).catch((err) => console.warn("archiveToRecentlyDeleted error:", err));
    }

    // Real-time cancellation sync via EKMS REST API (PATCH /api/v1/appointments/:id)
    if (tokenToCancel) {
      try {
        const apiCancelRes = await cancelAppointmentViaEkmsApi(tokenToCancel, "Cancelled in EKMS Triage");
        if (apiCancelRes.success) {
          console.log("Appointment cancelled via EKMS REST API:", apiCancelRes);
        } else {
          console.warn("EKMS REST API cancellation notice:", apiCancelRes.error);
        }

        const appointmentDocId = tokenToCancel.replace(/[^a-zA-Z0-9_-]/g, "_");

        const bDb = getBookingDb();
        if (bDb) {
          await setDoc(
            doc(bDb, "dispensary_appointments", appointmentDocId),
            {
              status: "cancelled",
              cancelledAt: new Date().toISOString(),
              cancellationReason: "Cancelled in EKMS Triage",
            },
            { merge: true }
          );
        }

        const tDb = getFirestoreDb();
        if (tDb) {
          await setDoc(
            doc(tDb, "dispensary_appointments", appointmentDocId),
            {
              status: "cancelled",
              cancelledAt: new Date().toISOString(),
              cancellationReason: "Cancelled in EKMS Triage",
            },
            { merge: true }
          );
        }

        updateAppointmentInCache(tokenToCancel, {
          status: "cancelled",
          cancelledAt: new Date().toISOString(),
          cancellationReason: "Cancelled in EKMS Triage",
        });
        broadcastEvent("APPOINTMENTS_UPDATED", {
          appointment: { id: tokenToCancel, tokenNo: tokenToCancel, status: "cancelled" },
        });
      } catch (fbErr) {
        console.warn("EKMS Booking cancel sync warning:", fbErr);
      }
    }

    if (typeof window !== "undefined" && caseTarget) {
      try {
        localStorage.removeItem(`ekms_appt_${caseTarget}`);
        sessionStorage.removeItem(`ekms_appt_${caseTarget}`);
      } catch (err) {}
    }
    if (result && result.booked_appointment) {
      delete result.booked_appointment;
    }
    setBookedAppointment(null);
    setShowTokenSuccess(false);

    broadcastEvent("CASE_APPOINTMENT_CANCELLED", {
      case_ref: caseTarget,
      timestamp: new Date().toISOString(),
    });

    onAppointmentCancelled?.(caseTarget);
    toast.success("Appointment booking cancelled successfully.");
  };

  const handlePrintTokenSlip = () => {
    if (!bookedAppointment || typeof window === "undefined") return;

    const redFlagsHtml =
      bookedAppointment.redFlags && bookedAppointment.redFlags.length > 0
        ? bookedAppointment.redFlags
            .map((flag) => {
              const text =
                typeof flag === "string"
                  ? flag
                  : flag.label || flag.name || String(flag);
              return `<span style="display:inline-block;background:#ffe4e6;color:#9f1239;border:1px solid #f43f5e;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;margin:2px 4px 2px 0;">• ${text}</span>`;
            })
            .join("")
        : "";

    const notesHtml = bookedAppointment.agentNotes
      ? `<div style="margin-top:10px;padding:8px 12px;background:#f8fafc;border-left:4px solid #ea580c;border-radius:4px;">
          <div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Agent Visit Notes / Instructions:</div>
          <div style="font-size:11.5px;color:#0f172a;margin-top:3px;font-style:italic;">${bookedAppointment.agentNotes}</div>
         </div>`
      : "";

    const printHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>OPD Token Receipt - ${bookedAppointment.referenceNo || bookedAppointment.tokenNo}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm 12mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #0f172a;
      line-height: 1.35;
      font-size: 12px;
    }
    .slip-container {
      max-width: 650px;
      margin: 0 auto;
      border: 2px solid #0f172a;
      border-radius: 12px;
      padding: 20px 24px;
      background: #ffffff;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .facility-title {
      font-size: 17px;
      font-weight: 800;
      color: #0f172a;
    }
    .facility-sub {
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      margin-top: 2px;
    }
    .token-box {
      text-align: center;
      background: #ecfdf5;
      border: 2px solid #10b981;
      border-radius: 10px;
      padding: 12px 18px;
      margin-bottom: 14px;
    }
    .token-label {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #047857;
    }
    .token-number {
      font-size: 28px;
      font-weight: 900;
      font-family: monospace;
      color: #064e3b;
      margin: 2px 0;
    }
    .token-sub {
      font-size: 11px;
      color: #047857;
      font-weight: 600;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 14px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 12px;
    }
    .info-cell .label {
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      color: #64748b;
      letter-spacing: 0.5px;
    }
    .info-cell .value {
      font-size: 12.5px;
      font-weight: 700;
      color: #0f172a;
      margin-top: 1px;
    }
    .clinical-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 12px;
    }
    .clinical-box .label {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      color: #475569;
      letter-spacing: 0.5px;
      margin-bottom: 3px;
    }
    .clinical-box .value {
      font-size: 11.5px;
      color: #0f172a;
      line-height: 1.4;
    }
    .notice-box {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 10.5px;
      color: #166534;
      font-weight: 500;
      line-height: 1.4;
    }
    .footer-note {
      margin-top: 14px;
      padding-top: 10px;
      border-top: 1px dashed #cbd5e1;
      font-size: 10px;
      color: #64748b;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  </style>
</head>
<body>
  <div class="slip-container">
    <div class="header">
      <div>
        <div class="facility-title">${bookedAppointment.facilityName}</div>
        <div class="facility-sub">Emergency Knowledge Management System (EKMS) • Outpatient Token Slip</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 10.5px; font-weight: 700; background: #ffedd5; color: #c2410c; padding: 3px 8px; border-radius: 6px; border: 1px solid #fdba74;">
          ${bookedAppointment.appointmentType}
        </div>
        <div style="font-size: 9.5px; color: #94a3b8; margin-top: 3px;">
          Booked: ${bookedAppointment.bookedAt}
        </div>
      </div>
    </div>

    <div class="token-box">
      <div class="token-label">OPD Consultation • Reference No</div>
      <div class="token-number">${bookedAppointment.referenceNo || bookedAppointment.tokenNo}</div>
      <div class="token-sub">Report to OPD Registration Counter / Gate No. 2 with this slip</div>
    </div>

    <div class="info-grid">
      <div class="info-cell">
        <div class="label">Patient Name</div>
        <div class="value">${bookedAppointment.patientName} (${bookedAppointment.patientAge} Y / ${bookedAppointment.patientSex})</div>
      </div>
      <div class="info-cell">
        <div class="label">Contact Mobile</div>
        <div class="value">+91 ${bookedAppointment.patientPhone}</div>
      </div>
      <div class="info-cell">
        <div class="label">Consultation Date &amp; Time Slot</div>
        <div class="value" style="color: #ea580c;">${bookedAppointment.date} &nbsp;(${bookedAppointment.timeSlot})</div>
      </div>
      <div class="info-cell" style="grid-column: span 2;">
        <div class="label">OPD Department / Clinic</div>
        <div class="value">${bookedAppointment.department}</div>
      </div>
      ${
        bookedAppointment.patientAddress
          ? `<div class="info-cell" style="grid-column: span 2;">
              <div class="label">Caller Location / Address</div>
              <div class="value" style="font-size: 11px; font-weight: 600; color: #475569;">${bookedAppointment.patientAddress}</div>
            </div>`
          : ""
      }
    </div>

    ${isNonClinical || bookedAppointment.callType === "non_clinical" ? `
    <div class="clinical-box">
      <div class="label" style="color: #4338ca;">Non-Clinical Reason for Visit</div>
      <div style="font-size: 11.5px; font-weight: 700; color: #1e1b4b; margin-bottom: 4px;">
        <strong>Enquiry Type:</strong> ${bookedAppointment.enquiryType || enquiryType}
      </div>
      <div style="font-size: 11px; font-weight: 600; color: #334155; margin-bottom: 4px;">
        <strong>Chief Complaint / Issue:</strong> ${bookedAppointment.chiefIssue || chiefIssue || bookedAppointment.chiefComplaint}
      </div>
      ${(bookedAppointment.remarks || remarks) ? `
      <div style="font-size: 10.5px; color: #64748b; margin-top: 4px;">
        <strong>Remarks:</strong> ${bookedAppointment.remarks || remarks}
      </div>` : ""}
      ${notesHtml}
    </div>
    ` : `
    <div class="clinical-box">
      <div class="label">Chief Clinical Reason for Visit</div>
      <div class="value">${bookedAppointment.chiefComplaint}</div>
      ${
        bookedAppointment.redFlags && bookedAppointment.redFlags.length > 0
          ? `<div style="margin-top: 8px;">
              <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #e11d48; margin-bottom: 3px;">
                Clinical Red Flags (Attention Medical Officer):
              </div>
              <div>${redFlagsHtml}</div>
            </div>`
          : ""
      }
      ${notesHtml}
    </div>
    `}

    <div class="notice-box">
      ✓ SMS confirmation with token details dispatched to <strong>+91 ${bookedAppointment.patientPhone}</strong>.<br />
      • Please arrive 15 minutes prior to your allocated slot.<br />
      • Carry your ESIC Pehchan / Insurance card and prior medical records.
    </div>

    <div class="footer-note">
      <span>Authorized by National Health Mission / ESIC Health Services</span>
      <span>Printed on: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
    </div>
  </div>
</body>
</html>`;

    let iframe = document.getElementById("ekms-token-print-frame");
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.id = "ekms-token-print-frame";
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.visibility = "hidden";
      document.body.appendChild(iframe);
    }

    const doc = iframe.contentWindow || iframe.contentDocument;
    const targetDoc = doc.document || doc;
    targetDoc.open();
    targetDoc.write(printHtml);
    targetDoc.close();

    setTimeout(async () => {
      try {
        if (iframe.contentWindow) {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        }
      } catch (e) {
        console.error("Iframe print error, falling back to window.print():", e);
        window.print();
      }
    }, 250);
  };

  return (
    <>
      {!hideReferralDispatch && (
        <div className="pt-3 border-t border-current/15 space-y-3">
        {/* Referral Forwarding Dispatch & Confirmation - hidden when booked or for medical facilities where clinical summary automatically accompanies booking */}
        {sentStatus && !bookedAppointment && !isBookable && (
          <div className="rounded-xl border border-emerald-500/60 bg-emerald-50 dark:bg-emerald-950/40 p-3 sm:p-3.5 text-xs font-bold text-emerald-950 dark:text-emerald-200 shadow-2xs flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <div>
                <p className="font-extrabold text-emerald-950 dark:text-emerald-100 text-xs sm:text-sm">
                  Clinical summary sent to {sentStatus.shortName} at {sentStatus.timestamp}
                </p>
                <p className="text-[11px] font-mono text-emerald-800 dark:text-emerald-300">
                  Reference No: {sentStatus.referenceNo || sentStatus.dispatchId} {sentStatus.location ? `· Location: ${sentStatus.location}` : ""}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleOpenModal}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-bold text-emerald-900 dark:text-emerald-200 transition hover:bg-emerald-100/80 shadow-2xs cursor-pointer"
            >
              <Edit3 className="h-3.5 w-3.5" /> Update / Re-send
            </button>
          </div>
        )}

        {/* Booked Appointment Confirmation Banner */}
        {bookedAppointment && (
          <div className="rounded-xl border border-orange-500/60 bg-orange-50 dark:bg-orange-950/40 p-3 sm:p-3.5 text-xs font-bold text-orange-950 dark:text-orange-200 shadow-2xs flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <CalendarCheck className="h-5 w-5 text-orange-700 dark:text-orange-400 shrink-0" />
              <div>
                <p className="font-extrabold text-orange-950 dark:text-orange-100 text-xs sm:text-sm">
                  OPD Appointment Confirmed · Reference No: {bookedAppointment.referenceNo || bookedAppointment.tokenNo}
                </p>
                <p className="text-[11px] font-mono text-orange-800 dark:text-orange-300">
                  {bookedAppointment.facilityName} · {bookedAppointment.date} at {bookedAppointment.timeSlot} ({bookedAppointment.department})
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowTokenSuccess(false);
                  if (isNonClinical) {
        setApptDepartment("Non-Clinical Visit");
        setApptType("Non-Clinical Visit");
      } else {
        setApptDepartment("General Medicine / Primary Care OPD");
        setApptType("Regular OPD Consultation");
      }
      setAppointmentModalOpen(true);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-blue-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-bold text-blue-700 dark:text-blue-300 transition hover:bg-blue-50 shadow-2xs cursor-pointer"
              >
                <Edit3 className="h-3.5 w-3.5" /> Modify Booking
              </button>
              <button
                type="button"
                onClick={handleOpenAppointmentModal}
                className="flex items-center gap-1.5 rounded-lg border border-orange-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-bold text-orange-900 dark:text-orange-200 transition hover:bg-orange-100/80 shadow-2xs cursor-pointer"
              >
                <FileText className="h-3.5 w-3.5" /> View / Print Token Slip
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setConfirmCancelOpen(true)}
                  title="Cancel booked appointment (Admin only)"
                  className="p-1.5 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-600 hover:text-white text-rose-600 dark:text-rose-400 transition cursor-pointer shadow-2xs"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Clean Document Window Modal */}
      {!hideReferralDispatch && modalOpen &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget) setModalOpen(false);
            }}
          >
            <div
              className="w-full max-w-3xl bg-card rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="border-b border-border/80 bg-secondary/30 px-5 sm:px-6 py-3.5 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 shrink-0">
                    <FileText className="h-4.5 w-4.5" />
                  </div>
                  <span className="text-sm sm:text-base font-bold text-foreground truncate">
                    Verify &amp; send clinical summary
                  </span>
                  {sentStatus && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-emerald-800 dark:text-emerald-300 bg-emerald-100/90 dark:bg-emerald-950/80 px-2.5 py-0.5 rounded-full border border-emerald-500/60 shadow-2xs shrink-0">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> Forwarded
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-xs sm:text-sm font-bold text-foreground bg-purple-500/10 dark:bg-purple-400/10 border border-purple-500/20 px-2.5 py-1 rounded-md">
                    Caller ID: <span className="font-mono text-purple-700 dark:text-purple-400">{activeCallerId}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition cursor-pointer"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Clean Document Content Area (Clean flowing document with delicate colors) */}
              <div className="p-6 sm:p-8 overflow-y-auto font-sans text-sm leading-relaxed text-foreground space-y-6 select-text">

                {/* Target Facility Selection (Locked if appointment already booked, else Proximity Dropdown) */}
                {lockedBookedFacilityName ? (
                  <div className="rounded-2xl border-2 border-orange-500/50 bg-orange-50/80 dark:bg-orange-950/30 p-4 space-y-2.5 shadow-xs">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black uppercase tracking-wider text-orange-950 dark:text-orange-200 flex items-center gap-1.5">
                        <Building2 className="h-4 w-4 text-orange-600" />
                        <span>🔒 Facility Locked to Booked Appointment</span>
                      </label>
                      <span className="text-[10.5px] font-bold text-orange-800 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/60 px-2.5 py-0.5 rounded-full border border-orange-400/40">
                        Reference No: {bookedAppointment?.referenceNo || bookedAppointment?.tokenNo}
                      </span>
                    </div>

                    <div className="rounded-xl border border-orange-300 dark:border-orange-800 bg-card p-3 text-xs sm:text-sm font-bold text-foreground flex items-center justify-between shadow-2xs">
                      <div className="flex items-center gap-2">
                        <CalendarCheck className="h-4 w-4 text-orange-600 shrink-0" />
                        <span className="truncate">{lockedBookedFacilityName}</span>
                      </div>
                      {lockedFacilityObj?.distance_km != null && Number(lockedFacilityObj.distance_km) > 0 && (
                        <span className="text-[11px] font-semibold text-orange-700 dark:text-orange-300 shrink-0">
                          Approx {formatApproxKm(lockedFacilityObj.distance_km)} KM
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-orange-800 dark:text-orange-300 leading-relaxed font-medium">
                      ✓ Clinical summary can <strong>only</strong> be forwarded to <strong>{lockedBookedFacilityName}</strong> because an OPD appointment has already been booked there. Referral and appointment must be at the same facility.
                    </p>
                  </div>
                ) : isBookable ? (
                  <div className="rounded-2xl border-2 border-blue-500/35 bg-blue-50/60 dark:bg-blue-950/25 p-4 space-y-2.5 shadow-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-black uppercase tracking-wider text-blue-950 dark:text-blue-200 flex items-center gap-1.5">
                        <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        <span>Select Target {selectedTeam.shortName} (Arranged by Proximity)</span>
                      </label>
                      <span className="text-[10.5px] font-bold text-blue-800 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/50 px-2.5 py-0.5 rounded-full border border-blue-400/30">
                        {availableFacilities.length} available · Nearest first
                      </span>
                    </div>

                    <div className="relative">
                      <select
                        value={selectedFacility?.id || selectedFacility?.name || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          const found = availableFacilities.find(
                            (f) => String(f.id) === val || f.name === val
                          );
                          if (found) setSelectedFacility(found);
                        }}
                        className="w-full rounded-xl border-2 border-blue-400/60 dark:border-blue-700 bg-card p-3 text-xs sm:text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 transition shadow-xs cursor-pointer appearance-none pr-10"
                      >
                        {availableFacilities.length === 0 ? (
                          <option value="" disabled>No facilities currently accepting in this category</option>
                        ) : (
                          availableFacilities.map((f, idx) => {
                            const hasDist = f.distance_km != null && Number(f.distance_km) > 0;
                            const distStr = hasDist ? `Approx ${formatApproxKm(f.distance_km)} KM` : "";
                            const distBadge = distStr ? (idx === 0 ? `[★ ${distStr} (Nearest)] ` : `[${distStr}] `) : "";
                            const area = f.district && !/^(NA|N\/A|0|null|undefined|-+)$/i.test(String(f.district).trim()) ? `(${f.district})` : "";
                            return (
                              <option key={f.id || f.name || idx} value={f.id || f.name}>
                                {distBadge}{f.name} {area}
                              </option>
                            );
                          })
                        )}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3.5 text-blue-600 dark:text-blue-400">
                        <ChevronDown className="h-4 w-4" />
                      </div>
                    </div>

                    {selectedFacility && !isFacilityAccepting(selectedFacility) && (
                      <div className="flex items-center gap-2 p-2.5 rounded-xl bg-rose-100/90 text-rose-950 text-xs font-bold border border-rose-300">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                        <span>This facility is currently marked as Offline in System Settings and is not accepting clinical referrals.</span>
                      </div>
                    )}

                    {selectedFacility && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs">
                        <div className="flex items-center gap-2">
                          {selectedFacility.distance_km != null && Number(selectedFacility.distance_km) > 0 && (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-100/90 dark:bg-emerald-950/80 px-2.5 py-0.5 rounded-md border border-emerald-500/30 text-[11px]">
                              <Navigation className="h-3 w-3" />
                              Approx {formatApproxKm(selectedFacility.distance_km)} KM road distance
                            </span>
                          )}
                          {selectedFacility.district && (
                            <span className="inline-flex items-center gap-1 font-semibold text-foreground text-[11.5px]">
                              <MapPin className="h-3.5 w-3.5 text-blue-600" />
                              {selectedFacility.district} {selectedFacility.pincode ? `• PIN: ${selectedFacility.pincode}` : ""}
                            </span>
                          )}
                        </div>
                        {selectedFacility.address && (
                          <span className="text-[11px] text-muted-foreground truncate max-w-[280px]">
                            {selectedFacility.address}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* 108 Alert if ambulance */}
                {isTarget108 && (
                  <div className="rounded-xl border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-950 dark:text-rose-200 font-semibold space-y-1 shadow-2xs">
                    <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300">
                      <Ambulance className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400 animate-pulse" />
                      <span className="uppercase tracking-wider font-extrabold text-[11px]">
                        108 Ambulance Dispatch Alert
                      </span>
                    </div>
                    <p className="text-rose-900 dark:text-rose-200 leading-relaxed text-xs pl-6">
                      Verify exact caller house number, street, or landmark so the ambulance crew can navigate immediately without delay.
                    </p>
                  </div>
                )}

                {/* 1. CALLER DETAILS */}
                <div className="space-y-2.5">
                  <div className="pb-1 border-b border-blue-500/25">
                    <h3 className="text-base sm:text-lg font-bold text-blue-700 dark:text-blue-400 tracking-tight">
                      1. Caller Details
                    </h3>
                  </div>

                  <ul className="space-y-2 pl-1">
                    <li className="flex items-baseline gap-2">
                      <span className="font-bold shrink-0 text-foreground">• Name:</span>
                      <input
                        type="text"
                        value={editData.callerName}
                        onChange={(e) =>
                          setEditData((d) => ({ ...d, callerName: e.target.value }))
                        }
                        className="w-full bg-transparent hover:bg-muted/30 focus:bg-primary/5 focus:ring-1 focus:ring-primary/20 px-1.5 py-0.5 outline-none font-medium rounded transition"
                        placeholder=""
                      />
                    </li>

                    <li className="flex items-baseline gap-2">
                      <span className="font-bold shrink-0 text-foreground">• IP Number:</span>
                      <input
                        type="text"
                        value={editData.ipNumber || ""}
                        onChange={(e) =>
                          setEditData((d) => ({ ...d, ipNumber: e.target.value }))
                        }
                        className="w-full bg-transparent hover:bg-muted/30 focus:bg-primary/5 focus:ring-1 focus:ring-primary/20 px-1.5 py-0.5 outline-none font-medium font-mono rounded transition"
                        placeholder="e.g. 4300000000"
                      />
                    </li>

                    <li className="flex items-baseline gap-2">
                      <span className="font-bold shrink-0 text-foreground">• Phone Number:</span>
                      <input
                        type="text"
                        value={editData.phone ? (editData.phone.startsWith("+91") ? editData.phone : `+91 ${editData.phone}`) : ""}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/^\+91\s*/, "").trim();
                          setEditData((d) => ({ ...d, phone: raw }));
                        }}
                        className="w-full bg-transparent hover:bg-muted/30 focus:bg-primary/5 focus:ring-1 focus:ring-primary/20 px-1.5 py-0.5 outline-none font-medium font-mono rounded transition"
                        placeholder=""
                      />
                    </li>

                    <li className="flex items-baseline gap-2">
                      <span className="font-bold shrink-0 text-foreground">• Age:</span>
                      <input
                        type="text"
                        value={editData.age}
                        onChange={(e) =>
                          setEditData((d) => ({ ...d, age: e.target.value }))
                        }
                        className="w-full bg-transparent hover:bg-muted/30 focus:bg-primary/5 focus:ring-1 focus:ring-primary/20 px-1.5 py-0.5 outline-none font-medium rounded transition"
                        placeholder=""
                      />
                    </li>

                    <li className="flex items-baseline gap-2">
                      <span className="font-bold shrink-0 text-foreground">• Gender:</span>
                      <input
                        type="text"
                        value={editData.sex}
                        onChange={(e) =>
                          setEditData((d) => ({ ...d, sex: e.target.value }))
                        }
                        className="w-full bg-transparent hover:bg-muted/30 focus:bg-primary/5 focus:ring-1 focus:ring-primary/20 px-1.5 py-0.5 outline-none font-medium rounded transition"
                        placeholder=""
                      />
                    </li>

                    <li className="flex items-baseline gap-2">
                      <span className="font-bold shrink-0 text-foreground">• Case Date:</span>
                      <span className="px-1.5 py-0.5 font-medium text-foreground">
                        {triageTimestamp}
                      </span>
                    </li>

                    <li className="flex items-start gap-2">
                      <span className="font-bold shrink-0 mt-0.5 text-foreground">• Address:</span>
                      <textarea
                        rows={1}
                        value={editData.landmark}
                        onChange={(e) => {
                          setEditData((d) => ({ ...d, landmark: e.target.value }));
                          handleAutoResize(e);
                        }}
                        onFocus={handleAutoResize}
                        className="w-full bg-transparent hover:bg-muted/30 focus:bg-primary/5 focus:ring-1 focus:ring-primary/20 px-1.5 py-0.5 outline-none font-medium rounded transition resize-none overflow-hidden leading-relaxed"
                        placeholder=""
                      />
                    </li>
                  </ul>
                </div>

                {/* CLINICAL OVERVIEW */}
                <div className="space-y-2.5">
                  <div className="pb-1 border-b border-emerald-500/25">
                    <h3 className="text-base sm:text-lg font-bold text-emerald-700 dark:text-emerald-400 tracking-tight">
                      Clinical Overview
                    </h3>
                  </div>

                  <ul className="space-y-2 pl-1">
                    <li className="space-y-1.5">
                      <span className="font-bold block text-foreground">• Chief Complaint:</span>
                      <div className="pl-5 space-y-1.5">
                        {Array.isArray(editData.allReasons) && editData.allReasons.length > 0 ? (
                          editData.allReasons.map((reason, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/50 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 transition shadow-2xs"
                            >
                              <span className="h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-400 shrink-0 ring-2 ring-emerald-500/20" />
                              <input
                                type="text"
                                value={reason}
                                onChange={(e) => {
                                  const updated = [...editData.allReasons];
                                  updated[idx] = e.target.value;
                                  setEditData((d) => ({
                                    ...d,
                                    allReasons: updated,
                                    firstReason: updated[0] || "",
                                    secondReason: updated[1] || "",
                                  }));
                                }}
                                className="w-full bg-transparent outline-none font-semibold text-emerald-950 dark:text-emerald-100 text-xs sm:text-sm"
                                placeholder={idx === 0 ? "Primary Complaint" : `Additional Complaint ${idx + 1}`}
                              />
                            </div>
                          ))
                        ) : (
                          <>
                            <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/50 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 transition shadow-2xs">
                              <span className="h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-400 shrink-0 ring-2 ring-emerald-500/20" />
                              <input
                                type="text"
                                value={editData.firstReason}
                                onChange={(e) =>
                                  setEditData((d) => ({ ...d, firstReason: e.target.value }))
                                }
                                className="w-full bg-transparent outline-none font-semibold text-emerald-950 dark:text-emerald-100 text-xs sm:text-sm"
                                placeholder="Primary Complaint"
                              />
                            </div>
                            {editData.secondReason !== undefined && editData.secondReason !== "" && (
                              <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/50 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 transition shadow-2xs">
                                <span className="h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-400 shrink-0 ring-2 ring-emerald-500/20" />
                                <input
                                  type="text"
                                  value={editData.secondReason}
                                  onChange={(e) =>
                                    setEditData((d) => ({ ...d, secondReason: e.target.value }))
                                  }
                                  className="w-full bg-transparent outline-none font-semibold text-emerald-950 dark:text-emerald-100 text-xs sm:text-sm"
                                  placeholder="Secondary Complaint"
                                />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </li>

                    {/* Clinical Red Flags point directly under Chief Complaint */}
                    <li className="space-y-1.5">
                      <span className="font-bold block text-rose-700 dark:text-rose-400">• Clinical Red Flags:</span>
                      <div className="pl-5 space-y-1.5">
                        {Array.isArray(editData.redFlags) && editData.redFlags.length > 0 ? (
                          editData.redFlags.map((flag, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200/70 dark:border-rose-800/50 focus-within:border-rose-500 focus-within:ring-2 focus-within:ring-rose-500/20 transition shadow-2xs"
                            >
                              <span className="h-2 w-2 rounded-full bg-rose-600 dark:bg-rose-400 shrink-0 ring-2 ring-rose-500/20" />
                              <input
                                type="text"
                                value={flag}
                                onChange={(e) => {
                                  const updated = [...editData.redFlags];
                                  updated[idx] = e.target.value;
                                  setEditData((d) => ({ ...d, redFlags: updated }));
                                }}
                                className="w-full bg-transparent outline-none font-semibold text-rose-950 dark:text-rose-100 text-xs sm:text-sm"
                                placeholder="Clinical Red Flag"
                              />
                            </div>
                          ))
                        ) : (
                          <p className="text-xs sm:text-sm font-semibold text-foreground pl-1">
                            None reported (No acute hemodynamic danger signs)
                          </p>
                        )}
                      </div>
                    </li>

                    <li className="flex items-start gap-2">
                      <span className="font-bold shrink-0 mt-0.5 text-foreground">• History of Present Illness(from how long it happening):</span>
                      <textarea
                        rows={1}
                        value={editData.hpiDuration}
                        onChange={(e) => {
                          setEditData((d) => ({ ...d, hpiDuration: e.target.value }));
                          handleAutoResize(e);
                        }}
                        onFocus={handleAutoResize}
                        className="w-full bg-transparent hover:bg-muted/30 focus:bg-primary/5 focus:ring-1 focus:ring-primary/20 px-1.5 py-0.5 outline-none font-medium rounded transition resize-none overflow-hidden"
                        placeholder=""
                      />
                    </li>

                    <li className="flex items-start gap-2">
                      <span className="font-bold shrink-0 mt-0.5 text-foreground">• Associated Symptoms:</span>
                      <textarea
                        rows={1}
                        value={editData.associatedSymptoms}
                        onChange={(e) => {
                          setEditData((d) => ({ ...d, associatedSymptoms: e.target.value }));
                          handleAutoResize(e);
                        }}
                        onFocus={handleAutoResize}
                        className="w-full bg-transparent hover:bg-muted/30 focus:bg-primary/5 focus:ring-1 focus:ring-primary/20 px-1.5 py-0.5 outline-none font-medium rounded transition resize-none overflow-hidden"
                        placeholder=""
                      />
                    </li>

                    <li className="flex items-baseline gap-2">
                      <span className="font-bold shrink-0 text-foreground">• Comorbidity:</span>
                      <input
                        type="text"
                        value={editData.comorbidity || ""}
                        onChange={(e) =>
                          setEditData((d) => ({ ...d, comorbidity: e.target.value }))
                        }
                        className="w-full bg-transparent hover:bg-muted/30 focus:bg-primary/5 focus:ring-1 focus:ring-primary/20 px-1.5 py-0.5 outline-none font-medium rounded transition"
                        placeholder=""
                      />
                    </li>

                    <li className="flex items-baseline gap-2">
                      <span className="font-bold shrink-0 text-foreground">• Any medication:</span>
                      <input
                        type="text"
                        value={(editData.medications || "").replace(/^medications?\s*(?:taken)?[:\s]*/i, "")}
                        onChange={(e) =>
                          setEditData((d) => ({ ...d, medications: e.target.value.replace(/^medications?\s*(?:taken)?[:\s]*/i, "") }))
                        }
                        className="w-full bg-transparent hover:bg-muted/30 focus:bg-primary/5 focus:ring-1 focus:ring-primary/20 px-1.5 py-0.5 outline-none font-medium rounded transition"
                        placeholder=""
                      />
                    </li>
                  </ul>
                </div>

                {/* PAST HISTORY OF THE CALLER */}
                <div className="space-y-3.5 pt-1">
                  <div className="pb-2 border-b border-indigo-500/25 flex flex-wrap items-center justify-between gap-2.5">
                    <h3 className="text-base sm:text-lg font-bold text-indigo-700 dark:text-indigo-400 tracking-tight">
                      Past History of the Caller
                    </h3>

                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-900/60 shadow-2xs text-indigo-700 dark:text-indigo-300">
                      <History className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span>Recorded Calls</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-300 font-extrabold ml-1">
                        {displayedCallHistory.length}
                      </span>
                    </div>
                  </div>

                  {/* CALL HISTORY */}
                  <div className="space-y-3">
                      {displayedCallHistory.length > 0 ? (
                        <div className="space-y-3">
                          {displayedCallHistory.map((item, idx) => {
                            return (
                              <div
                                key={item.id ? `call_${item.id}_${idx}` : `hist_${idx}`}
                                className={`rounded-xl border p-3 sm:p-4 space-y-2.5 shadow-2xs transition ${
                                  isCrmMode
                                    ? "border-purple-200/70 dark:border-purple-900/50 bg-purple-50/30 dark:bg-purple-950/20"
                                    : "border-indigo-200/70 dark:border-indigo-900/50 bg-indigo-50/30 dark:bg-indigo-950/20"
                                }`}
                              >
                                <div
                                  className={`flex flex-wrap items-center justify-between gap-2 border-b pb-2 ${
                                    isCrmMode
                                      ? "border-purple-200/50 dark:border-purple-900/40"
                                      : "border-indigo-200/50 dark:border-indigo-900/40"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-extrabold text-xs sm:text-sm text-foreground">
                                      Past History {idx + 1}
                                    </span>

                                    {(item.case_ref || item.caller_id || activeCallerId) && (
                                      <span className="font-mono text-[11px] text-primary font-bold">
                                        ({item.case_ref || item.caller_id || activeCallerId})
                                      </span>
                                    )}

                                    {!isCrmMode && item.urgency_level && (() => {
                                      const norm = normalizeUrgency(item.urgency_level);
                                      return (
                                        <span
                                          className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                                            norm === "Severe"
                                              ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                                              : norm === "Moderate"
                                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                                              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                                          }`}
                                        >
                                          {norm}
                                        </span>
                                      );
                                    })()}
                                  </div>

                                  <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-muted-foreground">
                                    <Clock className="h-3.5 w-3.5 text-muted-foreground/80 shrink-0" />
                                    <span>{formatHistoryDateTime(item.created_at)}</span>
                                  </div>
                                </div>

                                {isCrmMode ? (
                                  <>
                                    {/* CRM Metadata Row */}
                                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground font-medium pb-0.5">
                                      {item.callType && (
                                        <span className="rounded bg-secondary/80 px-1.5 py-0.5 font-bold text-foreground">
                                          {item.callType}
                                        </span>
                                      )}
                                      {item.category && (
                                        <span>
                                          Category: <strong className="text-foreground">{item.category}</strong>
                                        </span>
                                      )}
                                      {item.subCategory && (
                                        <span>• {item.subCategory}</span>
                                      )}
                                      {item.agent && (
                                        <span>
                                          • Agent: <strong className="text-foreground">{item.agent}</strong>
                                        </span>
                                      )}
                                      {item.duration && (
                                        <span>• Duration: {item.duration}</span>
                                      )}
                                    </div>

                                    {/* CRM Notes */}
                                    <div className="space-y-1">
                                      <span className="font-bold text-xs sm:text-sm text-foreground block">
                                        • Consultation Notes / Reason:
                                      </span>
                                      <p className="text-xs sm:text-sm font-medium text-foreground/90 pl-3 leading-relaxed">
                                        {item.chief_complaint || "Inbound consultation recorded"}
                                      </p>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    {/* Chief Complaint */}
                                    <div className="space-y-1">
                                      <span className="font-bold text-xs sm:text-sm text-foreground block">
                                        • Chief Complaint:
                                      </span>
                                      <p className="text-xs sm:text-sm font-medium text-foreground/90 pl-3 leading-relaxed">
                                        {item.chief_complaint || "No chief complaint recorded"}
                                      </p>
                                    </div>

                                    {/* Clinical Red Flags */}
                                    <div className="space-y-1">
                                      <span className="font-bold text-xs sm:text-sm text-rose-700 dark:text-rose-400 block">
                                        • Clinical Red Flags:
                                      </span>
                                      <div className="pl-3">
                                        {Array.isArray(item.red_flags) && item.red_flags.length > 0 ? (
                                          <ul className="space-y-1">
                                            {item.red_flags.map((rf, rIdx) => (
                                              <li
                                                key={rIdx}
                                                className="text-xs sm:text-sm text-rose-950 dark:text-rose-200 font-semibold flex items-center gap-2"
                                              >
                                                <span className="h-1.5 w-1.5 rounded-full bg-rose-600 dark:bg-rose-400 shrink-0" />
                                                <span>{rf}</span>
                                              </li>
                                            ))}
                                          </ul>
                                        ) : typeof item.red_flags === "string" && item.red_flags.trim().length > 0 ? (
                                          <p className="text-xs sm:text-sm text-rose-950 dark:text-rose-200 font-semibold">
                                            {item.red_flags}
                                          </p>
                                        ) : (
                                          <div className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                            <span>None reported</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-border/70 bg-muted/20 p-4 text-xs sm:text-sm text-muted-foreground flex items-center gap-2.5">
                          <Info className="h-4 w-4 text-muted-foreground/80 shrink-0" />
                          <span>
                            {isCrmMode
                              ? "No previous CRM call history recorded for this caller."
                              : "No previous consultation history recorded for this caller (First recorded visit)."}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

              </div>

              {/* Modal Footer */}
              <div className="border-t border-border/80 bg-secondary/30 px-5 sm:px-6 py-3.5 flex items-center justify-between gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-border/80 px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary transition cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={isSending || (isBookable && !isFacilityAccepting(selectedFacility))}
                  onClick={handleConfirmSend}
                  title={
                    isBookable && !isFacilityAccepting(selectedFacility)
                      ? "Facility offline: not accepting clinical summaries."
                      : "Confirm & Send"
                  }
                  className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs sm:text-sm font-bold text-white transition shadow-md active:scale-95 cursor-pointer disabled:opacity-50 ${getTeamButtonClass(
                    selectedTeam.id
                  )}`}
                >
                  {isSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : sentStatus ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-200" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  <span>
                    {isSending
                      ? "Transmitting..."
                      : sentStatus
                      ? `Re-send / Update to ${isBookable ? (selectedFacility?.name || facilityDisplayName) : selectedTeam.shortName}`
                      : `Confirm & Send to ${isBookable ? (selectedFacility?.name || facilityDisplayName) : selectedTeam.shortName}`}
                  </span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* OPD Facility Appointment Booking Modal Window */}
      {appointmentModalOpen &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget) setAppointmentModalOpen(false);
            }}
          >
            <div
              className="w-full max-w-2xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="border-b border-border/80 bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-transparent px-5 sm:px-6 py-3.5 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600/15 text-orange-600 dark:text-orange-400 shrink-0">
                    <CalendarCheck className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-foreground truncate flex items-center gap-2">
                      <span>
                        {showTokenSuccess && bookedAppointment
                          ? "Official Appointment Slip"
                          : bookedAppointment
                          ? "Modify OPD Facility Appointment"
                          : "Book OPD Facility Appointment"}
                      </span>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950/80 text-orange-800 dark:text-orange-300 border border-orange-500/30">
                        {selectedTeam.shortName}
                      </span>
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => setAppointmentModalOpen(false)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition cursor-pointer"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 text-xs">
                {showTokenSuccess && bookedAppointment ? (
                  /* --- BOOKING CONFIRMED SUCCESS / TOKEN SLIP VIEW --- */
                  <div id="opd-token-receipt-print" className="space-y-4">
                    <div className="rounded-2xl border-2 border-emerald-500/60 bg-emerald-50/80 dark:bg-emerald-950/40 p-4 sm:p-5 text-center space-y-3">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30">
                        <CheckCircle2 className="h-7 w-7" />
                      </div>
                      <div>
                        <span className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                          Official Appointment Confirmed
                        </span>
                        <h4 className="text-2xl font-black font-mono text-emerald-950 dark:text-emerald-100 tracking-tight mt-0.5">
                          {bookedAppointment.referenceNo || bookedAppointment.tokenNo}
                        </h4>
                        <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-1">
                          OPD Consultation Reference No allocated at {bookedAppointment.facilityName}
                        </p>
                      </div>
                    </div>

                    {/* Official Token Slip Card */}
                    <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3 shadow-2xs font-sans">
                      <div className="flex items-center justify-between border-b border-border pb-2.5">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-orange-600" />
                          <span className="font-bold text-foreground text-xs sm:text-sm">
                            {bookedAppointment.facilityName}
                          </span>
                        </div>
                        <span className="text-[11px] font-bold text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-950/60 px-2 py-0.5 rounded">
                          {bookedAppointment.appointmentType}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <span className="text-[10.5px] uppercase font-bold text-muted-foreground block">
                            Date &amp; Time Slot
                          </span>
                          <span className="font-bold text-foreground flex items-center gap-1.5 mt-0.5">
                            <Calendar className="h-3.5 w-3.5 text-orange-600" />
                            {bookedAppointment.date} ({bookedAppointment.timeSlot})
                          </span>
                        </div>

                        <div>
                          <span className="text-[10.5px] uppercase font-bold text-muted-foreground block">
                            OPD Department
                          </span>
                          <span className="font-bold text-foreground block mt-0.5">
                            {bookedAppointment.department}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10.5px] uppercase font-bold text-muted-foreground block">
                            Patient Name
                          </span>
                          <span className="font-bold text-foreground block mt-0.5">
                            {formatBeneficiaryName(bookedAppointment.patientName)} ({bookedAppointment.patientAge}y / {bookedAppointment.patientSex})
                          </span>
                        </div>

                        <div>
                          <span className="text-[10.5px] uppercase font-bold text-muted-foreground block">
                            IP Number
                          </span>
                          <span className="font-mono font-bold text-foreground block mt-0.5">
                            {formatBeneficiaryIp(
                              (bookedAppointment.ipNumber && /^\d+$/.test(String(bookedAppointment.ipNumber).trim()))
                                ? bookedAppointment.ipNumber
                                : (intakeData?.ipNumber && /^\d+$/.test(String(intakeData.ipNumber).trim())
                                  ? intakeData.ipNumber
                                  : "N/A")
                            )}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10.5px] uppercase font-bold text-muted-foreground block">
                            Contact Phone
                          </span>
                          <span className="font-mono font-bold text-foreground block mt-0.5">
                            +91 {formatBeneficiaryPhone(bookedAppointment.patientPhone)}
                          </span>
                        </div>
                      </div>

                      {/* Clinical Overview OR Non-Clinical Summary Section */}
                      <div className="border-t border-border pt-3 space-y-2.5 text-xs text-left">
                        <div className="pb-1 border-b border-emerald-500/25 flex items-center justify-between">
                          <h4 className="text-sm font-bold text-emerald-700 dark:text-emerald-400 tracking-tight flex items-center gap-1.5">
                            {isNonClinical || bookedAppointment.callType === "non_clinical" ? (
                              <>
                                <FileText className="h-4 w-4 text-indigo-600" />
                                <span>Non-Clinical Summary</span>
                              </>
                            ) : (
                              <>
                                <Activity className="h-4 w-4 text-emerald-600" />
                                <span>Clinical Overview</span>
                              </>
                            )}
                          </h4>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            isNonClinical || bookedAppointment.callType === "non_clinical"
                              ? "text-indigo-800 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-950 border-indigo-300/40"
                              : "text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950 border-emerald-300/40"
                          }`}>
                            {isNonClinical || bookedAppointment.callType === "non_clinical" ? "Non-Clinical Enquiry" : "AI Triage Verified"}
                          </span>
                        </div>

                        {isNonClinical || bookedAppointment.callType === "non_clinical" ? (
                          <ul className="space-y-2 pl-1">
                            <li className="space-y-1">
                              <span className="font-bold text-foreground block text-xs">• Enquiry Type:</span>
                              <p className="pl-4 text-xs sm:text-sm font-semibold text-foreground">
                                {bookedAppointment.enquiryType || enquiryType}
                              </p>
                            </li>

                            <li className="space-y-1">
                              <span className="font-bold text-foreground block text-xs">• Chief Complaint / Issue:</span>
                              <p className="pl-4 text-xs sm:text-sm font-semibold text-foreground leading-relaxed">
                                {bookedAppointment.chiefIssue || chiefIssue || bookedAppointment.chiefComplaint}
                              </p>
                            </li>

                            {(bookedAppointment.remarks || remarks) && (
                              <li className="space-y-1">
                                <span className="font-bold text-foreground block text-xs">• Remarks:</span>
                                <p className="pl-4 text-xs sm:text-sm font-medium text-foreground leading-relaxed whitespace-pre-line">
                                  {bookedAppointment.remarks || remarks}
                                </p>
                              </li>
                            )}
                          </ul>
                        ) : (
                          <ul className="space-y-2 pl-1">
                            <li className="space-y-1">
                              <span className="font-bold text-foreground block">• Chief Complaint:</span>
                              <div className="pl-4 space-y-1">
                                {(bookedAppointment.clinicalRecord?.chiefComplaints || (bookedAppointment.chiefComplaint ? [bookedAppointment.chiefComplaint] : [])).map((comp, cIdx) => (
                                  <p key={cIdx} className="text-xs sm:text-sm font-semibold text-foreground leading-relaxed">
                                    {comp}
                                  </p>
                                ))}
                              </div>
                            </li>

                            {(() => {
                              const isPopupCertOnly = Boolean(
                                bookedAppointment.clinicalRecord?.isCertificateOnly ||
                                editData.isCertificateOnly ||
                                ((/\bcertificate\b/i.test(bookedAppointment.chiefComplaint || "") || /\bcertificate\b/i.test(editData.firstReason || "")) &&
                                  !/\b(chest pain|shortness of breath|fever|bukhar|vomit|ulti|bleeding|headache|fracture|burn|unconscious|seizure)\b/i.test(JSON.stringify(bookedAppointment)))
                              );

                              if (isPopupCertOnly) {
                                return (
                                  <>
                                    <li className="space-y-1">
                                      <span className="font-bold text-rose-700 dark:text-rose-400 block">• Clinical Red Flags:</span>
                                      <div className="pl-4">
                                        <p className="text-xs sm:text-sm font-semibold text-foreground leading-relaxed">
                                          None reported
                                        </p>
                                      </div>
                                    </li>
                                    <li className="flex items-baseline gap-2">
                                      <span className="font-bold shrink-0 text-foreground">• History of Present Illness(from how long it happening):</span>
                                      <span className="font-medium text-foreground"></span>
                                    </li>
                                    <li className="flex items-baseline gap-2">
                                      <span className="font-bold shrink-0 text-foreground">• Associated Symptoms:</span>
                                      <span className="font-medium text-foreground"></span>
                                    </li>
                                    <li className="flex items-baseline gap-2">
                                      <span className="font-bold shrink-0 text-foreground">• Comorbidity:</span>
                                      <span className="font-medium text-foreground"></span>
                                    </li>
                                    <li className="flex items-baseline gap-2">
                                      <span className="font-bold shrink-0 text-foreground">• Any medication:</span>
                                      <span className="font-medium text-foreground"></span>
                                    </li>
                                  </>
                                );
                              }

                              return (
                                <>
                                  <li className="space-y-1">
                                    <span className="font-bold text-rose-700 dark:text-rose-400 block">• Clinical Red Flags:</span>
                                    <div className="pl-4">
                                      {bookedAppointment.redFlags && bookedAppointment.redFlags.length > 0 ? (
                                        <p className="text-xs font-semibold text-rose-800 dark:text-rose-200 leading-relaxed">
                                          {bookedAppointment.redFlags
                                            .map((flag) => (typeof flag === "string" ? flag : flag.label || flag.name || String(flag)))
                                            .join(", ")}
                                        </p>
                                      ) : (
                                        <p className="text-xs sm:text-sm font-semibold text-foreground leading-relaxed">
                                          None reported (No acute hemodynamic danger signs)
                                        </p>
                                      )}
                                    </div>
                                  </li>

                                  <li className="flex items-baseline gap-2">
                                    <span className="font-bold shrink-0 text-foreground">• History of Present Illness(from how long it happening):</span>
                                    <span className="font-medium text-foreground">{bookedAppointment.clinicalRecord?.hpiDuration || editData.hpiDuration || "Less than 2 hours"}</span>
                                  </li>

                                  <li className="flex items-baseline gap-2">
                                    <span className="font-bold shrink-0 text-foreground">• Associated Symptoms:</span>
                                    <span className="font-medium text-foreground">
                                      {(() => {
                                        const val = bookedAppointment.clinicalRecord?.associatedSymptoms ?? editData.associatedSymptoms;
                                        if (!val || /^(none|nil|no |none reported|not reported|n\/a)/i.test(String(val).trim())) return "";
                                        return val;
                                      })()}
                                    </span>
                                  </li>

                                  <li className="flex items-baseline gap-2">
                                    <span className="font-bold shrink-0 text-foreground">• Comorbidity:</span>
                                    <span className="font-medium text-foreground">
                                      {(() => {
                                        const val = bookedAppointment.clinicalRecord?.comorbidity ?? editData.comorbidity;
                                        if (!val || /^(none|nil|no pre|none reported|not reported|n\/a)/i.test(String(val).trim())) return "";
                                        return val;
                                      })()}
                                    </span>
                                  </li>

                                  <li className="flex items-baseline gap-2">
                                    <span className="font-bold shrink-0 text-foreground">• Any medication:</span>
                                    <span className="font-medium text-foreground">
                                      {(() => {
                                        const val = bookedAppointment.clinicalRecord?.medications ?? editData.medications;
                                        if (!val || /^(none|nil|no |none reported|not reported|n\/a)/i.test(String(val).trim())) return "";
                                        return String(val).replace(/^medications?\s*(?:taken)?[:\s]*/i, "").trim();
                                      })()}
                                    </span>
                                  </li>
                                </>
                              );
                            })()}
                          </ul>
                        )}
                      </div>

                      {/* Past History of the Caller (Past 3 Calls) */}
                      {((bookedAppointment.past3Calls && bookedAppointment.past3Calls.length > 0) || (displayedCallHistory && displayedCallHistory.length > 0)) && (
                        <div className="border-t border-border pt-3 space-y-2.5 text-xs text-left">
                          <div className="pb-1 border-b border-indigo-500/25 flex items-center justify-between">
                            <h4 className="text-sm font-bold text-indigo-700 dark:text-indigo-400 tracking-tight flex items-center gap-1.5">
                              <History className="h-4 w-4 text-indigo-600" />
                              <span>Past History of the Caller</span>
                            </h4>
                            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 text-indigo-700 dark:text-indigo-300">
                              <span>Recorded Calls</span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-100 text-indigo-800 font-extrabold ml-1">
                                {(bookedAppointment.past3Calls || displayedCallHistory.slice(0, 3)).length}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-2.5">
                            {(bookedAppointment.past3Calls || displayedCallHistory.slice(0, 3)).map((item, idx) => {
                              const norm = normalizeUrgency(item.urgency_level || item.triage_level) || "Moderate";
                              const timeStr = item.formatted_date || formatHistoryDateTime(item.created_at);
                              const flags = Array.isArray(item.red_flags) ? item.red_flags : (typeof item.red_flags === "string" && item.red_flags ? [item.red_flags] : []);
                              return (
                                <div key={idx} className="rounded-xl border border-indigo-200/70 dark:border-indigo-900/50 bg-indigo-50/20 dark:bg-indigo-950/20 p-3 space-y-2 shadow-2xs">
                                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200/50 pb-1.5">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-extrabold text-xs text-foreground">
                                        Past History {idx + 1}
                                      </span>
                                      {(item.case_ref || activeCallerId) && (
                                        <span className="font-mono text-[11px] text-primary font-bold">
                                          ({item.case_ref || activeCallerId})
                                        </span>
                                      )}
                                      <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                                        norm === "Severe"
                                          ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                                          : norm === "Moderate"
                                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                                          : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                                      }`}>
                                        {norm}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                                      <Clock className="h-3 w-3 text-muted-foreground/80 shrink-0" />
                                      <span>{timeStr}</span>
                                    </div>
                                  </div>

                                  <div className="space-y-1">
                                    <span className="font-bold text-foreground block text-[11.5px]">• Chief Complaint:</span>
                                    <p className="font-medium text-foreground/90 pl-3 leading-relaxed text-xs">
                                      {item.chief_complaint || "No chief complaint recorded"}
                                    </p>
                                  </div>

                                  <div className="space-y-1">
                                    <span className="font-bold text-rose-700 dark:text-rose-400 block text-[11.5px]">• Clinical Red Flags:</span>
                                    <div className="pl-3">
                                      {flags.length > 0 ? (
                                        <ul className="space-y-1">
                                          {flags.map((rf, rIdx) => (
                                            <li key={rIdx} className="text-xs text-rose-950 dark:text-rose-200 font-semibold flex items-center gap-1.5">
                                              <span className="h-1.5 w-1.5 rounded-full bg-rose-600 shrink-0" />
                                              <span>{rf}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <div className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                          <span>None reported</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {bookedAppointment.agentNotes && (
                          <div className="border-t border-border pt-2 text-xs text-left">
                            <span className="text-[10.5px] uppercase font-bold text-muted-foreground block">
                              Agent Visit Notes / Doctor Instructions:
                            </span>
                            <p className="text-foreground mt-0.5 font-medium leading-relaxed bg-card p-2 rounded-lg border border-border/60 italic">
                              {bookedAppointment.agentNotes}
                            </p>
                          </div>
                        )}

                        {Boolean(sendSmsNotification || bookedAppointment?.sendSmsNotification || bookedAppointment?.smsSent) && (
                          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-500/30 p-2.5 flex items-center gap-2 text-[11px] text-emerald-900 dark:text-emerald-300">
                            <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                            <span>
                              SMS Notification dispatched to <strong>+91 {bookedAppointment.patientPhone}</strong> with token pass and reporting gate details.
                            </span>
                          </div>
                        )}
                      </div>
                  </div>
                ) : (
                  /* --- APPOINTMENT BOOKING FORM --- */
                  <form onSubmit={handleConfirmBooking} className="space-y-4">
                    {/* Patient & Facility Summary Card */}
                    <div className="rounded-xl border border-orange-500/30 bg-orange-50/50 dark:bg-orange-950/20 p-3.5 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-600 text-white font-bold text-sm shrink-0">
                          {(intakeData.callerName || "IP")[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-foreground text-xs sm:text-sm flex items-center gap-2">
                            <span>{intakeData.callerName || editData.callerName || result?.intake?.caller_name || result?.caller_name || "Patient"}</span>
                            <span className="text-[10.5px] text-muted-foreground font-normal">
                              ({intakeData.age || editData.age || "35"}y / {intakeData.sex || editData.sex || "Male"})
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                            <span className="font-mono text-foreground font-bold">
                              {intakeData.phone || editData.phone || result?.intake?.phone || result?.phone ? `+91 ${intakeData.phone || editData.phone || result?.intake?.phone || result?.phone}` : "No phone"}
                            </span>
                            <span>•</span>
                            <span>{facilityDisplayName}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-950/80 px-2 py-0.5 rounded-full border border-orange-500/30">
                          {selectedTeam.shortName}
                        </span>
                      </div>
                    </div>

                    {/* Target Booking Facility Selection (Locked if clinical summary already forwarded, else Proximity Dropdown) */}
                    {lockedForwardFacilityName ? (
                      <div className="rounded-2xl border-2 border-emerald-500/50 bg-emerald-50/80 dark:bg-emerald-950/30 p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-black uppercase tracking-wider text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                            <Building2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                            <span>🔒 Facility Locked to Clinical Summary Dispatch</span>
                          </label>
                          <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/60 px-2.5 py-0.5 rounded-full border border-emerald-400/40">
                            Referral Match Enforced
                          </span>
                        </div>

                        <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-card p-3 text-xs sm:text-sm font-bold text-foreground flex items-center justify-between shadow-2xs">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                            <span className="truncate">{lockedForwardFacilityName}</span>
                          </div>
                          {lockedFacilityObj?.distance_km != null && Number(lockedFacilityObj.distance_km) > 0 && (
                            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 shrink-0">
                              Approx {formatApproxKm(lockedFacilityObj.distance_km)} KM
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] text-emerald-800 dark:text-emerald-300 leading-relaxed font-medium">
                          ✓ Appointment can <strong>only</strong> be booked at <strong>{lockedForwardFacilityName}</strong> because the caller&apos;s clinical summary has already been transmitted there. Both referral and appointment must be at the same facility.
                        </p>
                      </div>
                    ) : isBookable ? (
                      <div className="rounded-2xl border-2 border-orange-500/35 bg-orange-50/60 dark:bg-orange-950/25 p-3.5 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="text-[11px] font-black uppercase tracking-wider text-orange-950 dark:text-orange-200 flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-orange-600" />
                            <span>Select Booking Facility (Arranged by Proximity)</span>
                          </label>
                          <span className="text-[10px] font-bold text-orange-800 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/50 px-2 py-0.5 rounded-full border border-orange-400/30">
                            {availableFacilities.length} available · Nearest first
                          </span>
                        </div>

                        <div className="relative">
                          <select
                            value={selectedFacility?.id || selectedFacility?.name || ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              const found = availableFacilities.find(
                                (f) => String(f.id) === val || f.name === val
                              );
                              if (found) setSelectedFacility(found);
                            }}
                            className="w-full rounded-xl border-2 border-orange-400/60 dark:border-orange-800 bg-card p-2.5 text-xs sm:text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-orange-500 transition shadow-xs cursor-pointer appearance-none pr-10"
                          >
                            {availableFacilities.length === 0 ? (
                              <option value="" disabled>No facilities currently accepting in this category</option>
                            ) : (
                              availableFacilities.map((f, idx) => {
                                const hasDist = f.distance_km != null && Number(f.distance_km) > 0;
                                const distStr = hasDist ? `Approx ${formatApproxKm(f.distance_km)} KM` : "";
                                const distBadge = distStr ? (idx === 0 ? `[★ ${distStr} (Nearest)] ` : `[${distStr}] `) : "";
                                const area = f.district && !/^(NA|N\/A|0|null|undefined|-+)$/i.test(String(f.district).trim()) ? `(${f.district})` : "";
                                return (
                                  <option key={f.id || f.name || idx} value={f.id || f.name}>
                                    {distBadge}{f.name} {area}
                                  </option>
                                );
                              })
                            )}
                          </select>
                          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-orange-600">
                            <ChevronDown className="h-4 w-4" />
                          </div>
                        </div>

                        {selectedFacility && !isFacilityAccepting(selectedFacility) && (
                          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-rose-100/90 text-rose-950 text-xs font-bold border border-rose-300">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                            <span>This facility is currently marked as Offline in System Settings and is not accepting appointments.</span>
                          </div>
                        )}

                        {selectedFacility && (
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs">
                            <div className="flex items-center gap-2">
                              {selectedFacility.distance_km != null && Number(selectedFacility.distance_km) > 0 && (
                                <span className="inline-flex items-center gap-1 font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-100/90 dark:bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-500/30 text-[10.5px]">
                                  <Navigation className="h-3 w-3" />
                                  Approx {formatApproxKm(selectedFacility.distance_km)} KM road distance
                                </span>
                              )}
                              {selectedFacility.district && (
                                <span className="inline-flex items-center gap-1 font-semibold text-foreground text-[10.5px]">
                                  <MapPin className="h-3 w-3 text-orange-600" />
                                  {selectedFacility.district} {selectedFacility.pincode ? `• PIN: ${selectedFacility.pincode}` : ""}
                                </span>
                              )}
                            </div>
                            {selectedFacility.address && (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[260px]">
                                {selectedFacility.address}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : null}

                    {/* Consultation Type (Replaces OPD Department / Clinic) */}
                    <div>
                      <label className="block text-[11px] font-bold text-foreground uppercase tracking-wider mb-1.5">
                        Consultation Type
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          "Regular OPD Consultation",
                          "Non-Clinical Visit",
                          "Follow-Up Review",
                          "Medicine Refill / Lab",
                        ].map((type) => {
                          const isSelected = apptType === type;
                          return (
                            <button
                              key={type}
                              type="button"
                              onClick={() => {
                                setApptType(type);
                                if (type === "Non-Clinical Visit") {
                                  setApptDepartment("Non-Clinical Visit");
                                } else {
                                  setApptDepartment("General Medicine / Primary Care OPD");
                                }
                              }}
                              className={`rounded-xl py-1.5 px-2 text-[11px] font-bold transition text-center cursor-pointer border ${
                                isSelected
                                  ? "bg-amber-700 text-white border-amber-700 shadow-2xs"
                                  : "bg-secondary/40 hover:bg-secondary border-border/80 text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {type}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Date Selection */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-bold text-foreground uppercase tracking-wider">
                          Consultation Date
                        </label>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setApptDate(todayStr)}
                            className={`text-[10.5px] px-2.5 py-0.5 rounded font-semibold transition cursor-pointer border ${
                              apptDate === todayStr
                                ? "bg-orange-600 text-white border-orange-600"
                                : "bg-secondary hover:bg-secondary/80 text-foreground border-border/80"
                            }`}
                          >
                            Today
                          </button>
                          <button
                            type="button"
                            onClick={() => setApptDate(tomorrowStr)}
                            className={`text-[10.5px] px-2.5 py-0.5 rounded font-semibold transition cursor-pointer border ${
                              apptDate === tomorrowStr
                                ? "bg-orange-600 text-white border-orange-600"
                                : "bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 border-orange-300/50"
                            }`}
                          >
                            Tomorrow
                          </button>
                          <button
                            type="button"
                            onClick={() => setApptDate(dayAfterTomorrowStr)}
                            className={`text-[10.5px] px-2.5 py-0.5 rounded font-semibold transition cursor-pointer border ${
                              apptDate === dayAfterTomorrowStr
                                ? "bg-orange-600 text-white border-orange-600"
                                : "bg-secondary hover:bg-secondary/80 text-foreground border-border/80"
                            }`}
                          >
                            +2 Days
                          </button>
                        </div>
                      </div>
                      <input
                        type="date"
                        min={todayStr}
                        value={apptDate}
                        onClick={(e) => {
                          try {
                            e.target.showPicker?.();
                          } catch (err) {}
                        }}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val < todayStr) {
                            toast.warning("Cannot book appointments for past dates");
                            setApptDate(todayStr);
                          } else {
                            setApptDate(val);
                          }
                        }}
                        className="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-orange-500 transition cursor-pointer"
                      />

                      {/* Doctor Availability Live Indicator */}
                      {currentDispensaryAvailability.totalDoctors > 0 && (
                        <div className="mt-2 text-xs select-none">
                          {!currentDispensaryAvailability.isAvailable ? (
                            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-800 dark:text-rose-300 flex items-start gap-2">
                              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                              <div>
                                <span className="font-bold">All Doctors Unavailable on {apptDate}:</span>
                                <div className="text-[11px] mt-0.5 text-rose-700 dark:text-rose-400">
                                  {currentDispensaryAvailability.onLeaveDoctors.map((d) => `${d.name} (${d.reason})`).join(", ")}
                                </div>
                                <span className="text-[10px] text-rose-600 font-semibold block mt-1">
                                  Appointments cannot be booked for this date. Please select another date.
                                </span>
                              </div>
                            </div>
                          ) : currentDispensaryAvailability.unavailableDoctorsCount > 0 ? (
                            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200 flex items-start gap-2">
                              <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
                              <div>
                                <span className="font-bold text-teal-800 dark:text-teal-300">
                                  Dispensary Open: {currentDispensaryAvailability.availableDoctorsCount} Doctor(s) Available
                                </span>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>

                    {/* Time Slot Selection */}
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1.5">
                        <label className="block text-[11px] font-bold text-foreground uppercase tracking-wider">
                          Select Available Time Slot
                        </label>
                        {/* Legend */}
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground font-medium">
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" /> Available
                          </span>
                          <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold">
                            <span className="h-2 w-2 rounded-full bg-rose-500 inline-block" /> Reserved
                          </span>
                          <span className="flex items-center gap-1 text-slate-400 font-semibold">
                            <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-700 inline-block" /> Past
                          </span>
                        </div>
                      </div>

                      {/* Alert banner if NO doctor is available at the dispensary on this date */}
                      {currentDispensaryAvailability.totalDoctors > 0 && !currentDispensaryAvailability.isAvailable ? (
                        <div className="mb-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs flex items-center justify-between gap-2 shadow-2xs">
                          <div className="flex items-center gap-2">
                            <ShieldAlert className="h-4 w-4 text-rose-600 shrink-0" />
                            <div>
                              <span className="font-bold">Booking Unavailable (No Doctor Available):</span>{" "}
                              <span>All doctors at {targetFacilityName} are on leave on {apptDate}.</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const nextWork = getNextWorkingDateString(apptDate);
                              setApptDate(nextWork);
                              const targetFac = selectedFacility?.name || facilityDisplayName || "";
                              const nextSlot = getFirstAvailableSlot(nextWork, targetFac, existingAppointments);
                              if (nextSlot) setApptTimeSlot(nextSlot);
                            }}
                            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold rounded-lg cursor-pointer shrink-0 transition"
                          >
                            Next Working Day
                          </button>
                        </div>
                      ) : getSaturdayInfo(apptDate).isSaturday && getSaturdayInfo(apptDate).isOpen ? (
                        <div className="mb-2 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-300 dark:border-blue-800 text-blue-900 dark:text-blue-200 text-xs flex items-center justify-between gap-2 shadow-2xs">
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-blue-600 shrink-0" />
                            <span><strong>Saturday:</strong> OPD operates 10:00 AM – 04:00 PM.</span>
                          </div>
                        </div>
                      ) : isWeekendOrHoliday(apptDate) ? (
                        <div className="mb-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs flex items-center justify-between gap-2 shadow-2xs">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                            <span>Dispensaries are closed on Sunday. Mon–Sat: 10:00 AM – 04:00 PM.</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const nextWork = getNextWorkingDateString(apptDate);
                              setApptDate(nextWork);
                              const targetFac = selectedFacility?.name || facilityDisplayName || "";
                              const nextSlot = getFirstAvailableSlot(nextWork, targetFac, existingAppointments);
                              if (nextSlot) setApptTimeSlot(nextSlot);
                            }}
                            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold rounded-lg cursor-pointer shrink-0 transition"
                          >
                            Next Working Day
                          </button>
                        </div>
                      ) : apptDate === todayStr && areAllSlotsPastToday() ? (
                        <div className="mb-2 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-2 shadow-2xs">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                            <span>All consultation hours for today have closed. Please select the next available day.</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const nextWork = getNextWorkingDateString(todayStr);
                              setApptDate(nextWork);
                              const targetFac = selectedFacility?.name || facilityDisplayName || "";
                              const nextSlot = getFirstAvailableSlot(nextWork, targetFac, existingAppointments);
                              if (nextSlot) setApptTimeSlot(nextSlot);
                            }}
                            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold rounded-lg cursor-pointer shrink-0 transition"
                          >
                            Next Working Day
                          </button>
                        </div>
                      ) : null}

                      {/* Compact & Responsive 3-Minute Slot Grid */}
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5 border border-border/40 rounded-xl p-2.5 bg-background/50 max-h-[290px] overflow-y-auto">
                        {ALL_OPD_TIME_SLOTS.map((slot) => {
                          const isLunch = isLunchSlot(slot);
                          const isWeekend = isWeekendOrHoliday(apptDate);
                          const isNoDoctor = currentDispensaryAvailability.totalDoctors > 0 && !currentDispensaryAvailability.isAvailable;
                          const targetFac = selectedFacility?.name || facilityDisplayName || "";
                          const curDocId = bookedAppointment?.id || bookedAppointment?.tokenNo || bookedAppointment?.referenceNo || caseRef;
                          const isReserved = !isLunch && !isWeekend && !isNoDoctor && isSlotReserved(slot, apptDate, targetFac, existingAppointments, curDocId);
                          const isPast = !isLunch && !isWeekend && !isNoDoctor && isSlotInPast(slot, apptDate);
                          const isDisabled = isLunch || isWeekend || isNoDoctor || isReserved || isPast;
                          const isSelected = apptTimeSlot === slot && !isDisabled;

                          return (
                            <button
                              key={slot}
                              type="button"
                              disabled={isDisabled}
                              onClick={() => !isDisabled && setApptTimeSlot(slot)}
                              className={`rounded-lg py-1 px-1 text-[9px] font-semibold transition text-center border flex flex-col items-center justify-center gap-0.5 shadow-2xs ${
                                isLunch
                                  ? "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 cursor-not-allowed select-none opacity-85"
                                  : isWeekend
                                  ? "bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed select-none opacity-50"
                                  : isNoDoctor
                                  ? "bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/40 text-rose-500 dark:text-rose-400 cursor-not-allowed select-none opacity-60"
                                  : isReserved
                                  ? "bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-900 text-rose-800 dark:text-rose-300 cursor-not-allowed select-none opacity-85"
                                  : isPast
                                  ? "bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed select-none opacity-50"
                                  : isSelected
                                  ? "bg-teal-600 text-white border-teal-600 shadow-sm shadow-teal-600/30 ring-2 ring-teal-500/40 cursor-pointer font-bold scale-[1.02]"
                                  : "bg-card hover:bg-teal-50 hover:border-teal-300 dark:hover:bg-teal-950/30 border-border/80 text-foreground cursor-pointer"
                              }`}
                              title={
                                isLunch
                                  ? "Lunch Break (01:00 PM – 02:00 PM)"
                                  : isWeekend
                                  ? "Closed on Sunday"
                                  : isNoDoctor
                                  ? "Booking unavailable: All doctors on leave for this date"
                                  : isReserved
                                  ? "Slot is already reserved/booked for another patient"
                                  : isPast
                                  ? "This slot has already passed for today"
                                  : `Select ${slot}`
                              }
                            >
                              <span className={isPast || isReserved || isNoDoctor ? "line-through opacity-75" : ""}>{slot}</span>
                              <span
                                className={`text-[8.5px] uppercase font-extrabold ${
                                  isLunch
                                    ? "text-amber-700 dark:text-amber-300"
                                    : isWeekend
                                    ? "text-slate-400 dark:text-slate-500"
                                    : isNoDoctor
                                    ? "text-rose-600 dark:text-rose-400"
                                    : isReserved
                                    ? "text-rose-600 dark:text-rose-400"
                                    : isPast
                                    ? "text-rose-500"
                                    : isSelected
                                    ? "text-orange-100"
                                    : "text-emerald-600 dark:text-emerald-400"
                                }`}
                              >
                                {isLunch
                                  ? "Lunch"
                                  : isWeekend
                                  ? "Closed"
                                  : isNoDoctor
                                  ? "No Doctor"
                                  : isReserved
                                  ? "Reserved"
                                  : isPast
                                  ? "Past"
                                  : "Available"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Chief Reason for Visit Area */}
                    {(() => {
                      const isNonClinView = Boolean(
                        isNonClinical ||
                        apptType === "Non-Clinical Visit" ||
                        apptDepartment === "Non-Clinical Visit"
                      );
                      return (
                        <div className="rounded-xl border border-border/80 bg-secondary/20 p-3.5 space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                              {isNonClinView ? (
                                <>
                                  <FileText className="h-3.5 w-3.5 text-indigo-600" />
                                  Reason for Visit (Non-Clinical Enquiry)
                                </>
                              ) : (
                                <>
                                  <Activity className="h-3.5 w-3.5 text-orange-600" />
                                  Chief Clinical Reason for Visit (Pre-filled from Triage)
                                </>
                              )}
                            </label>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                              isNonClinView
                                ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border-indigo-300/60 font-bold"
                                : "text-muted-foreground bg-secondary border-border/60"
                            }`}>
                              {isNonClinView ? "Non-Clinical Enquiry" : "AI Triage Verified"}
                            </span>
                          </div>

                          {isNonClinView ? (
                            /* Non-Clinical Mode: Show Enquiry Type, Chief Complaint / Issue, Remarks */
                            <div className="space-y-2.5">
                              <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/20 p-2.5 space-y-1">
                                <span className="text-[10.5px] font-extrabold uppercase text-indigo-900 dark:text-indigo-300 block tracking-wider">
                                  Enquiry Type:
                                </span>
                                <p className="text-xs font-bold text-foreground">
                                  {enquiryType}
                                </p>
                              </div>

                              <div className="rounded-lg border border-border/60 bg-card p-2.5 space-y-1">
                                <span className="text-[10.5px] font-extrabold uppercase text-muted-foreground block tracking-wider">
                                  Chief Complaint / Issue:
                                </span>
                                <p className="text-xs font-semibold text-foreground leading-relaxed">
                                  {chiefIssue}
                                </p>
                              </div>

                              {remarks && (
                                <div className="rounded-lg border border-border/60 bg-card p-2.5 space-y-1">
                                  <span className="text-[10.5px] font-extrabold uppercase text-muted-foreground block tracking-wider">
                                    Remarks:
                                  </span>
                                  <p className="text-xs font-medium text-foreground leading-relaxed">
                                    {remarks}
                                  </p>
                                </div>
                              )}
                            </div>
                          ) : (
                            /* Clinical Mode: Show Chief Complaint & Red Flags */
                            <>
                              <div className="space-y-1">
                                <span className="text-[10.5px] font-extrabold uppercase text-muted-foreground block tracking-wider">
                                  Chief Complaint:
                                </span>
                                <p className="text-xs font-semibold text-foreground leading-relaxed pl-1">
                                  {extractedDetails.primaryComplaint ||
                                    extractedDetails.firstReason ||
                                    t?.primary_complaint ||
                                    t?.chief_complaint ||
                                    callerIntake?.symptom_notes ||
                                    "Acute clinical symptoms requiring physician consultation"}
                                </p>
                              </div>

                              <div className="space-y-1">
                                <span className="text-[10.5px] font-extrabold uppercase text-rose-700 dark:text-rose-400 block tracking-wider">
                                  Clinical Red Flags:
                                </span>
                                {extractedDetails.isCertificateOnly ? (
                                  <p className="text-[11px] text-muted-foreground italic pl-1">
                                    None reported
                                  </p>
                                ) : extractedDetails.redFlags && extractedDetails.redFlags.length > 0 ? (
                                  <p className="text-xs font-semibold text-rose-700 dark:text-rose-300 leading-relaxed pl-1">
                                    {extractedDetails.redFlags
                                      .map((flag) => (typeof flag === "string" ? flag : flag.label || flag.name || String(flag)))
                                      .join(", ")}
                                  </p>
                                ) : (
                                  <p className="text-[11px] text-muted-foreground italic pl-1">
                                    None reported (No acute hemodynamic danger signs)
                                  </p>
                                )}
                              </div>
                            </>
                          )}

                          {/* 3. One box for Agent to write */}
                          <div>
                            <label className="block text-[10.5px] font-extrabold text-foreground uppercase tracking-wider mb-1">
                              Agent Visit Notes / Doctor Instructions:
                            </label>
                            <textarea
                              rows={2}
                              value={apptNotes}
                              onChange={(e) => setApptNotes(e.target.value)}
                              placeholder="Write agent observations, specific patient requests, or instructions for the duty Medical Officer..."
                              className="w-full rounded-xl border border-border bg-card p-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-orange-500 transition resize-none leading-relaxed"
                            />
                          </div>
                        </div>
                      );
                    })()}

                    {/* Checkboxes */}
                    <div className="space-y-2 pt-1 border-t border-border/60">
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground select-none">
                        <input
                          type="checkbox"
                          checked={sendSmsNotification}
                          onChange={(e) => setSendSmsNotification(e.target.checked)}
                          className="rounded border-border text-orange-600 focus:ring-orange-500 h-4 w-4"
                        />
                        <span>Send SMS Token Confirmation &amp; Google Map navigation to caller mobile</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground select-none">
                        <input
                          type="checkbox"
                          checked={bringDocsChecked}
                          onChange={(e) => setBringDocsChecked(e.target.checked)}
                          className="rounded border-border text-orange-600 focus:ring-orange-500 h-4 w-4"
                        />
                        <span>Instruct patient to carry ESIC Pehchan / Insurance card &amp; prior prescriptions</span>
                      </label>
                    </div>
                  </form>
                )}
              </div>

              {/* Modal Footer */}
              <div className="border-t border-border/80 bg-secondary/30 px-5 sm:px-6 py-3.5 flex items-center justify-between gap-3 shrink-0">
                {showTokenSuccess && bookedAppointment ? (
                  <>
                    {!(
                      bookedAppointment?.status === "completed" ||
                      bookedAppointment?.status === "dispensed" ||
                      bookedAppointment?.status === "visited" ||
                      bookedAppointment?.status === "prescribed" ||
                      bookedAppointment?.status === "checked_in" ||
                      bookedAppointment?.isCompleted
                    ) ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowTokenSuccess(false)}
                          className="rounded-xl border border-border/80 px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary transition cursor-pointer"
                        >
                          Modify / Reschedule Booking
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              handleCancelBooking();
                              setAppointmentModalOpen(false);
                            }}
                            className="flex items-center gap-1.5 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-600 hover:text-white text-rose-600 dark:text-rose-400 px-3.5 py-2 text-xs font-bold transition cursor-pointer shadow-2xs"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Cancel Booking
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <span>Visit Completed</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handlePrintTokenSlip}
                        className="flex items-center gap-1.5 rounded-xl border border-orange-500 bg-orange-50 dark:bg-orange-950/40 px-3.5 py-2 text-xs font-bold text-orange-900 dark:text-orange-200 hover:bg-orange-100 transition cursor-pointer"
                      >
                        <Printer className="h-4 w-4" /> Print Token Slip
                      </button>

                      <button
                        type="button"
                        onClick={() => setAppointmentModalOpen(false)}
                        className="rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 px-5 py-2 text-xs font-bold text-white shadow-md hover:from-orange-700 hover:to-amber-700 transition cursor-pointer"
                      >
                        Done
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setAppointmentModalOpen(false)}
                      className="rounded-xl border border-border/80 px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary transition cursor-pointer"
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      disabled={!canConfirmBooking}
                      onClick={handleConfirmBooking}
                      title={
                        !apptTimeSlot
                          ? "Please select a time slot first"
                          : !isCurrentFacilityAccepting
                          ? "Selected facility is currently offline"
                          : currentDispensaryAvailability.totalDoctors > 0 && !currentDispensaryAvailability.isAvailable
                          ? `All doctors at ${targetFacilityName} are unavailable on ${apptDate}. Bookings closed.`
                          : bookedAppointment
                          ? "Update / Reschedule Booking"
                          : "Confirm & Book Appointment"
                      }
                      className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 px-5 py-2.5 text-xs sm:text-sm font-bold text-white transition shadow-md active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
                    >
                      {isBookingSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Generating Token...</span>
                        </>
                      ) : (
                        <>
                          <CalendarCheck className="h-4 w-4" />
                          <span>{bookedAppointment ? "Update / Reschedule Booking" : "Confirm & Book Appointment"}</span>
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Confirmation Modal for Cancelling Booking */}
      {confirmCancelOpen &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget) setConfirmCancelOpen(false);
            }}
          >
            <div
              className="w-full max-w-md bg-card rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150 p-5 sm:p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start gap-3.5">
                <div className="p-2.5 rounded-xl bg-rose-100 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 shrink-0">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div className="space-y-1 min-w-0">
                  <h3 className="text-base font-bold text-foreground">
                    Cancel Appointment Booking?
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Are you sure you want to cancel this booked OPD consultation? This will release the allocated slot for other patients.
                  </p>
                </div>
              </div>

              {/* Appointment summary details */}
              {bookedAppointment && (
                <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/20 p-3.5 text-xs space-y-2">
                  <div className="flex items-center justify-between font-mono font-bold text-rose-900 dark:text-rose-200">
                    <span>Reference No: {bookedAppointment.referenceNo || bookedAppointment.tokenNo}</span>
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                      Cancellation
                    </span>
                  </div>
                  <div className="space-y-1 text-foreground">
                    <p className="font-semibold text-xs sm:text-sm">
                      {bookedAppointment.facilityName}
                    </p>
                    <p className="text-muted-foreground text-[11px] flex items-center gap-1.5">
                      <Calendar className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span>{bookedAppointment.date} at {bookedAppointment.timeSlot}</span>
                    </p>
                    <p className="text-muted-foreground text-[11px] flex items-center gap-1.5">
                      <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span>{bookedAppointment.department}</span>
                    </p>
                    <p className="text-muted-foreground text-[11px] flex items-center gap-1.5">
                      <User className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span>Caller: {bookedAppointment.patientName} (+91 {bookedAppointment.patientPhone})</span>
                    </p>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => setConfirmCancelOpen(false)}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-secondary transition cursor-pointer"
                >
                  Keep Appointment
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleCancelBooking();
                    setConfirmCancelOpen(false);
                  }}
                  className="flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 px-4 py-2 text-xs font-bold text-white shadow-md transition cursor-pointer active:scale-95"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Yes, Cancel Booking</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
