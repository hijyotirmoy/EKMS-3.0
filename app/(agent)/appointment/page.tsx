"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  CalendarClock,
  CalendarCheck,
  CalendarPlus,
  Calendar,
  Clock,
  Search,
  Filter,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Building2,
  User,
  UserCheck,
  Phone,
  FileText,
  Activity,
  HeartPulse,
  Thermometer,
  ShieldAlert,
  Edit3,
  Trash2,
  Check,
  ExternalLink,
  FileSpreadsheet,
  ChevronDown,
  Printer,
  Sparkles,
  Link2,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Info,
  Users,
  Lock,
  Download,
  History,
  Copy,
  Stethoscope,
  Pill,
  AlertCircle,
  TrendingUp,
  X,
  PhoneCall,
} from "lucide-react";
import { toast } from "sonner";
import { logSystemActivity } from "@/lib/activityLogger";
import { getBookingDb, getOldBookingDb, getFirestoreDb, getSecondaryBookingDb, setBookingFailoverActive } from "@/lib/firebase";
import { collection, onSnapshot, query, orderBy, limit, doc, setDoc, deleteDoc, getDoc, getDocs, runTransaction, where } from "firebase/firestore";
import {
  isSlotInPast,
  getFirstAvailableSlot,
  areAllSlotsPastToday,
  ALL_OPD_TIME_SLOTS,
  getTodayDateString,
  getTomorrowDateString,
  getYesterdayDateString,
  getSaturdayInfo,
  isWeekendOrHoliday,
  getNextWorkingDateString,
  OPERATING_HOURS_LABEL,
  isLunchSlot,
  isSlotReserved,
  findSlotBooking,
  areDatesMatching,
  areSlotsMatching,
  checkDispensaryDoctorAvailability,
  areFacilitiesMatching,
} from "@/lib/slotTiming";
import { isFacilityAccepting, syncFacilityAvailability } from "@/lib/facilityAvailability";
import { recordAppointmentBookingToSheet, GOOGLE_SHEET_URL } from "@/lib/googleSheetsSync";
import { archiveToRecentlyDeleted } from "@/lib/recentlyDeleted";
import { logUserActivity } from "@/lib/activityLogger";
import { api } from "@/lib/api";
import {
  getCachedFacilities,
  setCachedFacilities,
  getCachedAppointments,
  setCachedAppointments,
  updateAppointmentInCache,
  getCachedDoctors,
  setCachedDoctors,
  getCachedDoctorAvailability,
  setCachedDoctorAvailability,
  getCachedCases,
} from "@/lib/clientCache";
import { subscribeToSync, broadcastEvent } from "@/lib/broadcastSync";
import { getCallerIdForPhone, formatCallerId } from "@/lib/callerId";
import {
  formatBeneficiaryName,
  formatBeneficiaryPhone,
  formatBeneficiaryIp,
  isMaskIpInfoEnabled,
} from "@/lib/maskUtils";
import { formatAgentFullName, formatAgentFirstName } from "@/lib/utils";
import { useStaffDirectory } from "@/lib/useStaffDirectory";
import { getEffectiveAppointmentStage } from "@/lib/appointmentTypes";

const TIME_SLOTS = ALL_OPD_TIME_SLOTS;

const DISPENSARY_OPTIONS = [
  "All Dispensaries",
  "ESIS Dispensary Beltola, Guwahati",
  "ESIS Dispensary Bamunimaidam, Guwahati",
  "ESIS Dispensary Ulubari, Guwahati",
  "ESIS Dispensary Borjhar, Guwahati",
  "ESIS Dispensary Barpeta Road",
  "ESIS Dispensary Dhubri",
  "ESIS Dispensary Tinsukia",
  "ESIS Dispensary Dibrugarh",
  "ESIS Dispensary Nagaon",
  "ESIS Dispensary Tezpur",
  "ESIS Dispensary Silchar",
  "ESIS Dispensary Bongaigaon",
  "ESIS Dispensary Mangaldai",
];

function formatHistoryDateTime(ts: any) {
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

function formatBookingDateTime(bookedAt?: any, createdAt?: any): string {
  const val = bookedAt || createdAt;
  if (!val) return "N/A";
  try {
    let d: Date;
    if (val && typeof val.toDate === "function") {
      d = val.toDate();
    } else if (typeof val === "number") {
      d = new Date(val);
    } else if (typeof val === "string") {
      if (/^\d+$/.test(val)) {
        d = new Date(parseInt(val, 10));
      } else {
        d = new Date(val);
      }
    } else {
      d = new Date(val);
    }
    if (isNaN(d.getTime())) return String(val);

    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return String(val);
  }
}

function normalizeUrgency(urgency: any) {
  if (!urgency) return "Moderate";
  const s = String(urgency).toLowerCase();
  if (s.includes("severe") || s.includes("emergency") || s.includes("red") || s.includes("critical")) return "Severe";
  if (s.includes("mild") || s.includes("low") || s.includes("green") || s.includes("routine")) return "Mild";
  return "Moderate";
}

function cleanValue(val: any) {
  if (!val) return "";
  let s = String(val).trim();
  // Strip starting bullets or numbers
  if (/^[•\s\-\*]+/i.test(s)) {
    // If it is actually a bullet for another section header:
    if (
      /^[•\s\-\*]*(?:Associated Symptoms|Comorbidity|Any medication|Clinical Red Flags|Chief Complaint|History of Present Illness|Past History|Past Calls|Clinical Summary)/i.test(
        s
      )
    ) {
      return "";
    }
    s = s.replace(/^[•\s\-\*]+/, "").trim();
  }
  // If it starts with section number e.g. "3. Past History"
  if (/^\d+\.\s*(?:Past History|Past Calls|Clinical Summary)/i.test(s)) {
    return "";
  }
  // Truncate before any inline next bullet or section header
  s = s.split(/(?:•\s*(?:Comorbidity|Any medication|Clinical Red Flags|History of Present Illness)|(?:\d+\.\s*Past History))/i)[0].trim();
  if (/^(none reported|none|nil|no prior|not reported|no pre-existing|n\/a|unspecified)$/i.test(s)) return "";
  return s;
}

function cleanStaffName(val: any) {
  if (!val) return "";
  let clean = String(val).trim();
  if (clean.includes("@")) {
    clean = clean.split("@")[0].replace(/[._-]/g, " ");
  }
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function cleanDoctorName(val: any) {
  if (!val) return "Doctor";
  return cleanStaffName(val);
}

function getDoctorName(doc: any) {
  if (!doc) return "Doctor";
  return cleanDoctorName(doc);
}

function getStaffName(name: any) {
  if (!name) return "Staff";
  let clean = cleanStaffName(name);
  return clean.replace(/^(reception|staff|nurse)\s+/i, "").trim() || "Staff";
}

function formatStaffTimestamp(val: any) {
  if (!val) return "";
  try {
    let d = null;
    if (val && typeof (val as any).toDate === "function") {
      d = (val as any).toDate();
    } else if (val && typeof (val as any).seconds === "number") {
      d = new Date((val as any).seconds * 1000);
    } else if (typeof val === "number") {
      d = val < 10000000000 ? new Date(val * 1000) : new Date(val);
    } else if (typeof val === "string") {
      const num = Number(val);
      if (!isNaN(num) && num > 1000000000) {
        d = num < 10000000000 ? new Date(num * 1000) : new Date(num);
      } else {
        d = new Date(val);
      }
    }
    if (!d || isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} , ${hours}:${mins}`;
  } catch {
    return "";
  }
}

function formatFollowUpDateTime(val: any = Date.now()) {
  try {
    let d = null;
    if (val && typeof (val as any).toDate === "function") {
      d = (val as any).toDate();
    } else if (val && typeof (val as any).seconds === "number") {
      d = new Date((val as any).seconds * 1000);
    } else if (typeof val === "number") {
      d = val < 10000000000 ? new Date(val * 1000) : new Date(val);
    } else if (typeof val === "string") {
      const num = Number(val);
      if (!isNaN(num) && num > 1000000000) {
        d = num < 10000000000 ? new Date(num * 1000) : new Date(num);
      } else {
        d = new Date(val);
      }
    }
    if (!d || isNaN(d.getTime())) d = new Date();
    const day = d.getDate();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[d.getMonth()];
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${day} ${month}, ${hours}:${minutes}`;
  } catch {
    return "";
  }
}

function isNonClinicalAppointment(app: any) {
  if (!app) return false;
  const ct = String(app.callType || app.call_type || "").toLowerCase().trim();
  if (ct === "clinical") return false;
  if (ct === "non_clinical") return true;
  if (app.isNonClinical === false || app.is_non_clinical === false) return false;
  if (app.isNonClinical === true || app.is_non_clinical === true) return true;

  const dept = String(app.department || "").toLowerCase();
  const apptType = String(app.appointmentType || app.appointment_type || "").toLowerCase();
  if (dept.includes("regular opd") || dept.includes("general medicine") || dept.includes("primary care")) return false;
  if (apptType.includes("regular opd")) return false;
  if (dept.includes("non-clinical") || apptType.includes("non-clinical")) return true;

  const sanitizeStr = (val: any) => {
    if (!val || typeof val !== "string") return "";
    const trimmed = val.trim();
    if (/^(na|none|n\/a|select enquiry type|null|undefined)$/i.test(trimmed)) return "";
    return trimmed;
  };

  const enq = sanitizeStr(app.enquiryType) || sanitizeStr(app.enquiry_type);
  if (enq && !/^(regular|clinical|general)/i.test(enq)) return true;

  const purpose = String(app.purpose || app.chiefComplaint || app.chief_complaint || "").trim();
  if (purpose.toLowerCase().includes("non-clinical")) return true;
  if (purpose.startsWith("[") && /\[(cash|medical|maternity|disablement|pension|dependent|grievance|other|general|non-clinical|benefit|scheme|ip)/i.test(purpose)) {
    return true;
  }
  const summary = String(app.clinicalSummary || app.clinical_summary || "");
  if (summary.includes("[NON-CLINICAL")) {
    return true;
  }

  return false;
}

const STATUS_PROGRESSION_RANK: Record<string, number> = {
  completed: 10,
  dispensed: 9,
  with_pharmacist: 8.5,
  pharmacy_queue: 8.5,
  prescribed: 8.5,
  consulted: 8,
  with_doctor: 7.5,
  doctor_queue: 7.5,
  in_consultation: 7.5,
  visited: 6,
  checked_in: 6,
  reception: 6,
  cancelled: 5,
  scheduled: 1,
};

  // Cache of deleted appointment keys to prevent deleted appointments from reappearing
const deletedAppointmentKeys = new Set<string>();
if (typeof window !== "undefined") {
  try {
    const saved = localStorage.getItem("ekms_deleted_app_keys") || sessionStorage.getItem("ekms_deleted_app_keys");
    if (saved) {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr)) {
        arr.forEach((k: any) => {
          const s = String(k).trim();
          if (s) {
            deletedAppointmentKeys.add(s);
            deletedAppointmentKeys.add(s.toUpperCase());
          }
        });
      }
    }
  } catch (_) {}
}

function markAppointmentDeleted(identifiers: any = []) {
  const ids = Array.isArray(identifiers) ? identifiers : [identifiers];
  ids.filter(Boolean).forEach((ident) => {
    const s = String(ident).trim();
    if (s) {
      deletedAppointmentKeys.add(s);
      deletedAppointmentKeys.add(s.toUpperCase());
    }
  });
  try {
    if (typeof window !== "undefined") {
      const serialized = JSON.stringify(Array.from(deletedAppointmentKeys).slice(-1000));
      localStorage.setItem("ekms_deleted_app_keys", serialized);
      sessionStorage.setItem("ekms_deleted_app_keys", serialized);
    }
  } catch (_) {}
}

function reconcileWithLiveSnapshot(currentList: any[] = [], liveList: any[] = [], source: string = "live") {
  const map = new Map();

  // Authoritative live snapshot items:
  liveList.forEach((item) => {
    if (!item) return;
    let key = String(item.id || item.tokenNo || item.referenceNo || "").trim();
    let idKey = String(item.id || "").trim();
    let tokKey = String(item.tokenNo || "").trim();
    const pName = String(item.patientName || item.ipName || "").trim().toLowerCase();

    // Auto-normalize legacy ESIC- prefix to canonical ESI- format
    if (key.startsWith("ESIC-")) key = key.replace(/^ESIC-/i, "ESI-");
    if (idKey.startsWith("ESIC-")) idKey = idKey.replace(/^ESIC-/i, "ESI-");
    if (tokKey.startsWith("ESIC-")) tokKey = tokKey.replace(/^ESIC-/i, "ESI-");

    if (
      !key ||
      pName.includes("anonymous") ||
      deletedAppointmentKeys.has(key) ||
      deletedAppointmentKeys.has(key.toUpperCase()) ||
      (idKey && (deletedAppointmentKeys.has(idKey) || deletedAppointmentKeys.has(idKey.toUpperCase()))) ||
      (tokKey && (deletedAppointmentKeys.has(tokKey) || deletedAppointmentKeys.has(tokKey.toUpperCase())))
    ) {
      return;
    }
    const itemCopy = { ...item };
    if (itemCopy.tokenNo && String(itemCopy.tokenNo).startsWith("ESIC-")) {
      itemCopy.tokenNo = String(itemCopy.tokenNo).replace(/^ESIC-/i, "ESI-");
    }
    if (itemCopy.referenceNo && String(itemCopy.referenceNo).startsWith("ESIC-")) {
      itemCopy.referenceNo = String(itemCopy.referenceNo).replace(/^ESIC-/i, "ESI-");
    }
    const hasRec = Boolean(itemCopy.receptionCheckedInAt || itemCopy.receptionCheckedInBy || itemCopy.visitedAt || itemCopy.visitedBy);
    const hasDoc = Boolean(itemCopy.doctorConsultedAt || itemCopy.doctorName || itemCopy.doctor || itemCopy.prescribedBy || itemCopy.doctorNotes);
    const hasDisp = Boolean(itemCopy.dispensedAt || itemCopy.dispensedBy || itemCopy.pharmacistName || itemCopy.dispensationNotes);
    if (itemCopy.status !== "cancelled") {
      if (itemCopy.status === "completed" || itemCopy.status === "dispensed" || hasDisp) {
        itemCopy.status = "completed";
      } else if (hasDoc) {
        itemCopy.status = "with_pharmacist";
      } else if (hasRec && (itemCopy.status === "scheduled" || !itemCopy.status)) {
        itemCopy.status = "with_doctor";
      }
    }
    map.set(key, itemCopy);
  });

  // Calculate oldest timestamp in live snapshot if limit(60) was reached
  let oldestLiveTime = Infinity;
  if (liveList.length >= 60) {
    liveList.forEach((item) => {
      const t = item.createdAt ? Number(item.createdAt) : 0;
      if (t > 0 && t < oldestLiveTime) oldestLiveTime = t;
    });
  }

  // Reconcile status and notes from existing state without reviving deleted appointments:
  currentList.forEach((prev) => {
    if (!prev) return;
    let key = String(prev.id || prev.tokenNo || prev.referenceNo || "").trim();
    let idKey = String(prev.id || "").trim();
    let tokKey = String(prev.tokenNo || "").trim();
    const pName = String(prev.patientName || prev.ipName || "").trim().toLowerCase();

    // Auto-normalize legacy ESIC- prefix to canonical ESI- format
    if (key.startsWith("ESIC-")) key = key.replace(/^ESIC-/i, "ESI-");
    if (idKey.startsWith("ESIC-")) idKey = idKey.replace(/^ESIC-/i, "ESI-");
    if (tokKey.startsWith("ESIC-")) tokKey = tokKey.replace(/^ESIC-/i, "ESI-");

    if (
      !key ||
      pName.includes("anonymous") ||
      deletedAppointmentKeys.has(key) ||
      deletedAppointmentKeys.has(key.toUpperCase()) ||
      (idKey && (deletedAppointmentKeys.has(idKey) || deletedAppointmentKeys.has(idKey.toUpperCase()))) ||
      (tokKey && (deletedAppointmentKeys.has(tokKey) || deletedAppointmentKeys.has(tokKey.toUpperCase())))
    ) {
      return;
    }

    if (map.has(key)) {
      const live = map.get(key);
      const prevRank = STATUS_PROGRESSION_RANK[String(prev.status || "scheduled").toLowerCase()] || 1;
      const liveRank = STATUS_PROGRESSION_RANK[String(live.status || "scheduled").toLowerCase()] || 1;

      let merged = liveRank >= prevRank ? { ...prev, ...live } : { ...live, ...prev };

      // Determine progression stages
      const isClin = !isNonClinicalAppointment(merged);

      // Stage 1: Reception Check-in
      const prevReceptionCheckedIn = Boolean(prev.receptionCheckedInAt || prev.visitedAt || prev.receptionCheckedInBy || prev.visitedBy);
      const liveReceptionCheckedIn = Boolean(live.receptionCheckedInAt || live.visitedAt || live.receptionCheckedInBy || live.visitedBy);

      // Stage 2: Doctor Consultation & Prescription
      const prevDoctorConsulted = Boolean(prev.doctorConsultedAt || prev.doctorName || prev.doctor || prev.prescribedBy || prev.doctorNotes);
      const liveDoctorConsulted = Boolean(live.doctorConsultedAt || live.doctorName || live.doctor || live.prescribedBy || live.doctorNotes);
      const hasDoctorConsulted = prevDoctorConsulted || liveDoctorConsulted;

      // Stage 3: Pharmacist Dispensation
      const prevDispensed = Boolean(prev.dispensedAt || prev.dispensedBy || prev.pharmacistName || prev.dispensationNotes);
      const liveDispensed = Boolean(live.dispensedAt || live.dispensedBy || live.pharmacistName || live.dispensationNotes);
      // Strict rule: in clinical cases, pharmacy CANNOT happen before doctor
      const hasDispensed = isClin ? (hasDoctorConsulted && (prevDispensed || liveDispensed)) : (prevDispensed || liveDispensed);

      // Lock previous stages:
      // If doctor has consulted, receptionist data is locked and immutable
      if (hasDoctorConsulted && prevReceptionCheckedIn) {
        merged.receptionCheckedInBy = prev.receptionCheckedInBy || prev.visitedBy;
        merged.receptionCheckedInAt = prev.receptionCheckedInAt || prev.visitedAt;
        merged.visitedBy = prev.visitedBy || prev.receptionCheckedInBy;
        merged.visitedAt = prev.visitedAt || prev.receptionCheckedInAt;
        merged.visitedNotes = prev.visitedNotes || prev.receptionNotes;
        merged.receptionNotes = prev.receptionNotes || prev.visitedNotes;
        merged.vitals = prev.vitals || merged.vitals;
      } else {
        merged.receptionCheckedInBy = prev.receptionCheckedInBy || live.receptionCheckedInBy || prev.visitedBy || live.visitedBy;
        merged.receptionCheckedInAt = prev.receptionCheckedInAt || live.receptionCheckedInAt || prev.visitedAt || live.visitedAt;
        merged.visitedBy = prev.visitedBy || live.visitedBy || prev.receptionCheckedInBy || live.receptionCheckedInBy;
        merged.visitedAt = prev.visitedAt || live.visitedAt || prev.receptionCheckedInAt || live.receptionCheckedInAt;
        merged.visitedNotes = prev.visitedNotes || live.visitedNotes || prev.receptionNotes || live.receptionNotes;
        merged.receptionNotes = prev.receptionNotes || live.receptionNotes || prev.visitedNotes || live.visitedNotes;
      }

      // If pharmacist has dispensed, doctor data is locked and immutable
      if (hasDispensed && prevDoctorConsulted) {
        merged.doctorName = prev.doctorName || prev.prescribedBy || prev.doctor;
        merged.doctor = prev.doctor || prev.doctorName;
        merged.prescribedBy = prev.prescribedBy || prev.doctorName;
        merged.doctorNotes = prev.doctorNotes || prev.prescriptionNotes;
        merged.doctorConsultedAt = prev.doctorConsultedAt;
        merged.consultationType = prev.consultationType || merged.consultationType;
        merged.diagnosis = prev.diagnosis || merged.diagnosis;
        merged.prescriptions = prev.prescriptions || merged.prescriptions;
      } else {
        merged.doctorName = live.doctorName || prev.doctorName || live.prescribedBy || prev.prescribedBy || null;
        merged.doctor = live.doctor || prev.doctor || null;
        merged.prescribedBy = live.prescribedBy || prev.prescribedBy || live.doctorName || prev.doctorName || null;
        merged.doctorNotes = prev.doctorNotes || live.doctorNotes || prev.prescriptionNotes || live.prescriptionNotes;
        merged.doctorConsultedAt = prev.doctorConsultedAt || live.doctorConsultedAt;
      }

      // Pharmacy fields: only populate if clinical doctor has consulted (or non-clinical)
      if (hasDispensed) {
        merged.dispensedBy = prev.dispensedBy || live.dispensedBy || prev.pharmacistName || live.pharmacistName;
        merged.pharmacistName = prev.pharmacistName || live.pharmacistName || prev.dispensedBy || live.dispensedBy;
        merged.dispensedAt = prev.dispensedAt || live.dispensedAt;
        merged.dispensationNotes = prev.dispensationNotes || live.dispensationNotes || prev.dispensedNotes || live.dispensedNotes || prev.pharmacyNotes || live.pharmacyNotes;
        merged.dispensedNotes = prev.dispensedNotes || live.dispensedNotes || prev.dispensationNotes || live.dispensationNotes;

        // Ensure chronological timestamp sanity: reception <= doctor <= dispensed
        if (merged.doctorConsultedAt && merged.receptionCheckedInAt && merged.doctorConsultedAt < merged.receptionCheckedInAt) {
          merged.doctorConsultedAt = Number(merged.receptionCheckedInAt) + 300000;
        }
        if (merged.dispensedAt && merged.doctorConsultedAt && merged.dispensedAt < merged.doctorConsultedAt) {
          merged.dispensedAt = Number(merged.doctorConsultedAt) + 60000;
        }
      } else if (isClin && !hasDoctorConsulted) {
        // Clinical but doctor hasn't consulted: only clean if not already completed/dispensed/visited
        if (merged.status !== "completed" && merged.status !== "dispensed" && merged.status !== "visited") {
          delete merged.dispensedBy;
          delete merged.pharmacistName;
          delete merged.dispensedAt;
          delete merged.dispensationNotes;
          delete merged.dispensedNotes;
          merged.status = prevReceptionCheckedIn || liveReceptionCheckedIn ? "visited" : "scheduled";
        }
      }

      // Preserve follow-up state across snapshot merges
      if (live.followUpStatus === "none") {
        merged.followUpStatus = "none";
        merged.followUpNotes = "";
        merged.followUpAt = null;
        merged.followUpAgent = null;
        merged.followUpTimestamp = null;
        merged.followUpClosedAt = null;
        merged.followUpHistory = [];
      } else {
        merged.followUpStatus = live.followUpStatus || prev.followUpStatus || "none";
        merged.followUpNotes = live.followUpNotes || prev.followUpNotes || "";
        merged.followUpAt = live.followUpAt || prev.followUpAt || null;
        merged.followUpAgent = live.followUpAgent || prev.followUpAgent || null;
        merged.followUpTimestamp = live.followUpTimestamp || prev.followUpTimestamp || null;
        merged.followUpClosedAt = live.followUpClosedAt || prev.followUpClosedAt || null;
        merged.followUpHistory = Array.isArray(live.followUpHistory) && live.followUpHistory.length > 0
          ? live.followUpHistory
          : (Array.isArray(prev.followUpHistory) ? prev.followUpHistory : []);
      }

      // Ensure merged status accurately reflects reality if receptionist/doctor/pharmacist has acted
      if (merged.status !== "cancelled") {
        if (merged.status === "completed" || live.status === "completed" || prev.status === "completed") {
          merged.status = "completed";
        } else if (hasDispensed || merged.status === "dispensed") {
          merged.status = "completed";
        } else if (hasDoctorConsulted) {
          merged.status = "with_pharmacist";
        } else if (prevReceptionCheckedIn || liveReceptionCheckedIn) {
          if (merged.status === "scheduled" || !merged.status) {
            merged.status = "with_doctor";
          }
        }
      }

      map.set(key, merged);
    } else {
      // If live list is active and item falls within live query window, it was deleted in Firestore: do not resurrect!
      const isWithinLiveTimeframe = liveList.length > 0 && (
        liveList.length < 250 || (prev.createdAt && Number(prev.createdAt) >= oldestLiveTime)
      );

      if (
        !isWithinLiveTimeframe &&
        !deletedAppointmentKeys.has(key) &&
        !deletedAppointmentKeys.has(key.toUpperCase()) &&
        !(idKey && (deletedAppointmentKeys.has(idKey) || deletedAppointmentKeys.has(idKey.toUpperCase()))) &&
        !(tokKey && (deletedAppointmentKeys.has(tokKey) || deletedAppointmentKeys.has(tokKey.toUpperCase())))
      ) {
        map.set(key, prev);
      }
    }
  });

  return Array.from(map.values()).sort(
    (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
  );
}

function mergeAppointmentMaps(currentList: any[] = [], incomingList: any[] = []) {
  return reconcileWithLiveSnapshot(currentList, incomingList);
}

function parseClinicalDossier(app: any) {
  if (!app) return { clinicalRecord: null, past3Calls: [] };

  let clinicalRecord = app.clinicalRecord || app.clinicalOverview || null;
  let past3Calls = Array.isArray(app.past3Calls) && app.past3Calls.length > 0
    ? [...app.past3Calls]
    : (Array.isArray(app.pastCallHistory) ? app.pastCallHistory.slice(0, 3) : []);

  if (!clinicalRecord && app.clinicalSummary) {
    const text = app.clinicalSummary;

    // Extract Chief Complaint
    const ccMatch = text.match(/• Chief Complaint:\s*([\s\S]*?)(?=• Clinical Red Flags:|$)/i);
    let chiefComplaints: any[] = [];
    if (ccMatch && ccMatch[1]) {
      chiefComplaints = ccMatch[1]
        .split("\n")
        .map((s: any) => s.replace(/^\s*•\s*/, "").trim())
        .filter(Boolean);
    }
    if (chiefComplaints.length === 0 && (app.chiefComplaint || app.purpose)) {
      chiefComplaints = [app.chiefComplaint || app.purpose];
    }

    // Extract Red Flags
    const rfMatch = text.match(/• Clinical Red Flags:\s*([\s\S]*?)(?=• History of Present Illness|• Associated Symptoms|$)/i);
    let redFlags: any[] = [];
    if (rfMatch && rfMatch[1]) {
      const rawFlags = rfMatch[1]
        .split("\n")
        .map((s: any) => s.replace(/^\s*•\s*/, "").trim())
        .filter((s: any) => Boolean(s) && !/none reported/i.test(s));
      redFlags = rawFlags;
    }
    if (redFlags.length === 0 && Array.isArray(app.redFlags)) {
      redFlags = app.redFlags.filter((f: any) => !/none reported/i.test(String(f)));
    }

    // Extract HPI Duration: match ONLY on same line, stop before newline or bullet
    const hpiMatch = text.match(/• History of Present Illness[^:\r\n]*:[^\S\r\n]*([^\r\n•]+)/i);
    const hpiDuration = hpiMatch ? cleanValue(hpiMatch[1]) : "";

    // Extract Associated Symptoms: match ONLY on same line, stop before newline or bullet
    const assocMatch = text.match(/• Associated Symptoms:[^\S\r\n]*([^\r\n•]+)/i);
    let associatedSymptoms = assocMatch ? cleanValue(assocMatch[1]) : "";

    // Extract Comorbidity: match ONLY on same line, stop before newline or bullet
    const comorbMatch = text.match(/• Comorbidity:[^\S\r\n]*([^\r\n•]+)/i);
    let comorbidity = comorbMatch ? cleanValue(comorbMatch[1]) : "";

    // Extract Medications: match ONLY on same line, stop before newline or bullet
    const medMatch = text.match(/• Any medication:[^\S\r\n]*([^\r\n•]+)/i);
    const medications = medMatch ? cleanValue(medMatch[1]) : "";

    // USER MANDATE: In Chief Complaint put ONLY the main condition; route extra symptoms/flags to their respective sections
    if (chiefComplaints.length > 1) {
      const isComorbid = (s: any) =>
        /\b(diabetes|sugar|high blood sugar|bp|hypertension|high bp|asthma)\b/i.test(s);
      const isDangerFlag = (s: any) =>
        /\b(uncontrollable pain|danger sign|severe pain|intense pain|sudden severe|emergency|difficulty breathing|shortness of breath|dyspnea|sudden acute severe headache)\b/i.test(s);
      const isAssoc = (s: any) =>
        /\b(vomiting & nausea|vomiting|nausea|weakness & dizziness|dizziness|weakness|faint|sweating)\b/i.test(s);

      const nonChiefs = chiefComplaints.slice(1);
      nonChiefs.forEach((item: any) => {
        if (isDangerFlag(item) && !redFlags.some((rf: any) => rf.toLowerCase().includes(item.toLowerCase()))) {
          redFlags.push(item);
        } else if (isAssoc(item) && (!associatedSymptoms || /none/i.test(associatedSymptoms))) {
          associatedSymptoms = item;
        } else if (isComorbid(item) && (!comorbidity || /none/i.test(comorbidity))) {
          comorbidity = item;
        }
      });
      chiefComplaints = [chiefComplaints[0]];
    }

    clinicalRecord = {
      callerId: app.callerId || app.caller_id || "",
      chiefComplaints: chiefComplaints.length > 0 ? [chiefComplaints[0]] : [app.chiefComplaint || app.purpose || "General OPD Consultation"],
      primaryComplaint: chiefComplaints[0] || app.chiefComplaint || app.purpose || "General OPD Consultation",
      redFlags: redFlags,
      hpiDuration: hpiDuration,
      associatedSymptoms: associatedSymptoms,
      comorbidity: comorbidity,
      medications: medications,
    };
  }

  // Fallback defaults if clinicalRecord is still null
  if (!clinicalRecord) {
    const defaultComplaints = app.chiefComplaint
      ? [app.chiefComplaint]
      : app.purpose
      ? [app.purpose]
      : ["General OPD Consultation"];
    clinicalRecord = {
      callerId: app.callerId || app.caller_id || "",
      chiefComplaints: defaultComplaints,
      primaryComplaint: defaultComplaints[0],
      redFlags: Array.isArray(app.redFlags) ? app.redFlags.filter((f: any) => !/none reported/i.test(String(f))) : [],
      hpiDuration: "",
      associatedSymptoms: "",
      comorbidity: "",
      medications: "",
    };
  }

  // Parse past 3 calls if empty
  if (past3Calls.length === 0 && app.clinicalSummary && app.clinicalSummary.includes("Past History")) {
    const pastBlocks = app.clinicalSummary.split(/• Past (?:Helpline Triage|Call|History)\s+(\d+)/i);
    if (pastBlocks.length > 1) {
      for (let i = 1; i < pastBlocks.length && past3Calls.length < 3; i += 2) {
        const callNum = pastBlocks[i];
        const blockContent = pastBlocks[i + 1] || "";
        const dateMatch = blockContent.match(/\(([^)]+)\):/);
        const compMatch = blockContent.match(/Chief Complaint:\s*([^\n]+)/i) || blockContent.match(/Notes:\s*([^\n]+)/i);
        const rfMatch = blockContent.match(/Clinical Red Flags:\s*([^\n]+)/i);
        const redFlagList = rfMatch && !rfMatch[1].includes("None reported")
          ? rfMatch[1].split(/;|,/).map((s: string) => s.trim()).filter(Boolean)
          : [];

        past3Calls.push({
          id: `past-${callNum}`,
          case_ref: `CA020${callNum}AB01`,
          created_at: dateMatch ? dateMatch[1] : "",
          formatted_date: dateMatch ? dateMatch[1] : "",
          urgency_level: callNum === "2" ? "Severe" : "Moderate",
          severity: callNum === "2" ? "SEVERE" : "MODERATE",
          chief_complaint: compMatch ? compMatch[1].trim() : "Previous consultation recorded",
          red_flags: redFlagList,
          recommended_action: "",
        });
      }
    }
  }

  return { clinicalRecord, past3Calls };
}

export default function AppointmentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, userProfile, openLoginModal } = useAuth();
  const { staffMap } = useStaffDirectory();

  useEffect(() => {
    if (pathname === "/appointments" || (pathname && pathname.startsWith("/appointments/"))) {
      router.replace("/appointment");
    }
  }, [pathname, router]);

  const currentAgent = useMemo(() => {
    const rawName =
      userProfile?.name ||
      userProfile?.displayName ||
      user?.displayName ||
      user?.email?.split("@")[0] ||
      "Agent";
    return {
      agentId: user?.email ? user.email.split("@")[0] : "agent",
      email: user?.email || userProfile?.email || "agent@ekms.in",
      displayName: userProfile?.name || user?.displayName || rawName,
      name: userProfile?.name || user?.displayName || rawName,
      role: userProfile?.role || "Agent",
      isAdmin: Boolean(
        userProfile?.role?.toLowerCase() === "admin" ||
        userProfile?.role?.toLowerCase() === "master admin"
      ),
      isMasterAdmin: Boolean(userProfile?.role?.toLowerCase().includes("master")),
    };
  }, [user, userProfile]);

  return (
    <div className="w-full max-w-full space-y-4">
      <AppointmentsContent
        currentAgent={currentAgent}
        onOpenLogin={openLoginModal}
      />
    </div>
  );
}

function AppointmentsContent({ currentAgent, onOpenLogin }: { currentAgent: any; onOpenLogin?: any }) {
  const { staffMap = {} } = useStaffDirectory();
  const isAdmin =
    String(currentAgent?.role || "").toLowerCase() === "admin" ||
    String(currentAgent?.role || "").toLowerCase() === "master admin" ||
    Boolean(currentAgent?.isAdmin) ||
    Boolean(currentAgent?.isMasterAdmin);

  const canDeleteAppointment = useCallback(
    (app?: any) => {
      // STRICT REQUIREMENT: No agent can delete any appointment (not even their own). ONLY Administrator can delete!
      return Boolean(isAdmin);
    },
    [isAdmin]
  );

  const [appointments, setAppointments] = useState(() => getCachedAppointments());
  const [loading, setLoading] = useState(() => getCachedAppointments().length === 0);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // 'all' | 'scheduled' | 'visited' | 'cancelled'
  const [dispensaryFilter, setDispensaryFilter] = useState("All Dispensaries");
  const [agentFilter, setAgentFilter] = useState("all"); // 'all' | agent name
  const [dateFilter, setDateFilter] = useState("today"); // 'today' (default present date) | 'all' | 'tomorrow' | 'custom'
  const [customDate, setCustomDate] = useState("");

  // Pagination (20 items per page)
  const APPOINTMENTS_PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  // Reset pagination to page 1 on filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, agentFilter, dispensaryFilter, dateFilter, customDate]);

  // Modals state
  const [followUpModal, setFollowUpModal] = useState<{ open: boolean; app: any; message: string }>({ open: false, app: null, message: "" });
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [rescheduleModal, setRescheduleModal] = useState<{ open: boolean; app: any; newDate: string; newSlot: string; notes: string }>({ open: false, app: null, newDate: "", newSlot: "", notes: "" });
  const [cancelModal, setCancelModal] = useState<{ open: boolean; app: any; reason: string }>({ open: false, app: null, reason: "Beneficiary requested cancellation" });
  const [slipModal, setSlipModal] = useState<{ open: boolean; app: any }>({ open: false, app: null });
  const [modalLiveCalls, setModalLiveCalls] = useState<any[]>([]);
  const [visitModal, setVisitModal] = useState<{ open: boolean; app: any; visitedNotes: string; bp: string; pulse: string; temp: string; visitedBy: string }>({ open: false, app: null, visitedNotes: "", bp: "", pulse: "", temp: "", visitedBy: "" });
  const [actionLoading, setActionLoading] = useState(false);

  // Bulk Selection & Permanent Delete State
  const [selectedIds, setSelectedIds] = useState<Set<any>>(new Set());
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [singleDeleteModal, setSingleDeleteModal] = useState<{ open: boolean; app: any }>({ open: false, app: null });

  // Slot Availability Overview Modal State
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [slotModalFacility, setSlotModalFacility] = useState("");
  const [slotModalDate, setSlotModalDate] = useState(() => getTodayDateString());
  const [selectedSlotDetail, setSelectedSlotDetail] = useState<any>(null);

  useEffect(() => {
    if (!showSlotModal) return;
    const onKeyDown = (e: any) => {
      if (e.key === "Escape") setShowSlotModal(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showSlotModal]);

  // Doctor availability & roster state from EKMS (with 0ms cache initial state)
  const [doctorAvailabilityRecords, setDoctorAvailabilityRecords] = useState(() => getCachedDoctorAvailability());
  const [platformDoctors, setPlatformDoctors] = useState(() => getCachedDoctors());

  useEffect(() => {
    let unsubAvail: (() => void) | null = null;
    let unsubDispDocs: (() => void) | null = null;

    try {
      const bDb = getBookingDb() || getFirestoreDb();
      if (bDb) {
        unsubAvail = onSnapshot(collection(bDb, "doctor_availability"), (snap) => {
          const list: any[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
          setDoctorAvailabilityRecords(list);
          setCachedDoctorAvailability(list);
        });
        unsubDispDocs = onSnapshot(collection(bDb, "dispensary_doctors"), (snap) => {
          const docs: any[] = [];
          snap.forEach((d) => docs.push({ id: d.id, ...d.data(), email: (d.data().email || d.id).toLowerCase() }));
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

    return () => {
      if (unsubAvail) unsubAvail();
      if (unsubDispDocs) unsubDispDocs();
    };
  }, []);

  useEffect(() => {
    document.title = "Appointments";
  }, []);

  // Fetch appointments directly from Firestore database (no HTTP API roundtrip)
  const loadAppointments = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);

    try {
      const bDb = getBookingDb();
      if (bDb) {
        const snap = await getDocs(
          query(collection(bDb, "dispensary_appointments"), orderBy("createdAt", "desc"), limit(250))
        );
        const list: any[] = [];
        snap.forEach((d) => {
          const data = d.data();
          const key = data.tokenNo || data.referenceNo || d.id;
          if (
            !deletedAppointmentKeys.has(String(key).trim()) &&
            !deletedAppointmentKeys.has(String(d.id).trim())
          ) {
            list.push({ id: d.id, ...data });
          }
        });
        setAppointments((prev) => {
          const reconciled = reconcileWithLiveSnapshot(prev, list, "bookingDb");
          setCachedAppointments(reconciled);
          return reconciled;
        });
      }
    } catch (err: any) {
      console.warn("Direct Firestore load notice:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Real-time zero-refresh synchronization across EKMS and Triage tabs (0 Firestore reads)
  useEffect(() => {
    const handleDeletedPayload = (payload: any) => {
      if (!payload) return;
      const rawKeys = [
        payload.tokenNo,
        payload.referenceNo,
        payload.id,
        ...(Array.isArray(payload.tokens) ? payload.tokens : []),
        ...(Array.isArray(payload.ids) ? payload.ids : []),
      ].filter(Boolean);

      // Strictly isolate deletion to specific appointment tokens & IDs; ignore broad case references like CA0142AB01
      const keysToDrop = rawKeys
        .map((k) => String(k).trim())
        .filter((k) => Boolean(k) && !/^CA\d+/i.test(k));

      if (keysToDrop.length === 0) return;
      markAppointmentDeleted(keysToDrop);

      setAppointments((prev) => {
        const filtered = prev.filter((a) => {
          const t = String(a.tokenNo || "").trim();
          const i = String(a.id || "").trim();
          if (keysToDrop.includes(t) || keysToDrop.includes(i)) return false;
          if (deletedAppointmentKeys.has(t) || deletedAppointmentKeys.has(t.toUpperCase())) return false;
          if (deletedAppointmentKeys.has(i) || deletedAppointmentKeys.has(i.toUpperCase())) return false;
          return true;
        });
        setCachedAppointments(filtered);
        return filtered;
      });
    };

    const handleUpdatedPayload = (app: any) => {
      if (!app) return;
      setAppointments((prev) => {
        const reconciled = reconcileWithLiveSnapshot(prev, [app], "sync");
        setCachedAppointments(reconciled);
        return reconciled;
      });
    };

    const unsubSync = subscribeToSync((event: any) => {
      if (event?.type === "APPOINTMENT_DELETED") {
        handleDeletedPayload(event.payload);
      } else if (
        event?.type === "APPOINTMENTS_UPDATED" ||
        event?.type === "APPOINTMENT_CREATED" ||
        event?.type === "CASE_APPOINTMENT_BOOKED"
      ) {
        if (event.payload?.appointment) {
          handleUpdatedPayload(event.payload.appointment);
        }
      }
    });

    const handleStorage = (e: any) => {
      if (e.key === "ekms_deleted_appointment" && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          handleDeletedPayload(payload);
        } catch (_) {}
      }
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      unsubSync?.();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  // Firebase Real-time Live Synchronization (ekmsbooking & triage databases)
  useEffect(() => {
    let unsubBooking: (() => void) | null = null;
    let unsubDeletions: (() => void) | null = null;

    try {
      const bDb = getBookingDb() || getFirestoreDb();
      if (bDb) {
        // Real-time deletion sync across all devices / agent accounts
        unsubDeletions = onSnapshot(doc(bDb, "system_sync", "deletions"), (delSnap) => {
          if (delSnap.exists()) {
            const d = delSnap.data();
            const rawKeys = [
              ...(Array.isArray(d.keys) ? d.keys : []),
              ...(Array.isArray(d.latestDeleted) ? d.latestDeleted : []),
            ];
            const keys = rawKeys
              .map((k) => String(k).trim())
              .filter((k) => Boolean(k) && !/^CA\d+/i.test(k));

            if (keys.length > 0) {
              markAppointmentDeleted(keys);
              setAppointments((prev) => {
                const filtered = prev.filter((a) => {
                  const id = String(a.id || "").trim();
                  const tok = String(a.tokenNo || "").trim();
                  if (deletedAppointmentKeys.has(id) || deletedAppointmentKeys.has(id.toUpperCase())) return false;
                  if (deletedAppointmentKeys.has(tok) || deletedAppointmentKeys.has(tok.toUpperCase())) return false;
                  return true;
                });
                setCachedAppointments(filtered);
                return filtered;
              });
            }
          }
        });

        const q = query(collection(bDb, "dispensary_appointments"), orderBy("createdAt", "desc"), limit(250));
        unsubBooking = onSnapshot(
          q,
          (snap) => {
            // Immediately sync modified status to sheet
            snap.docChanges().forEach((change) => {
              if (change.type === "removed") {
                const data = change.doc.data() || {};
                const keys = [change.doc.id, data.tokenNo, data.referenceNo].filter(Boolean);
                markAppointmentDeleted(keys);
              } else if (change.type === "modified") {
                const data = change.doc.data() || {};
                if (
                  data.status ||
                  data.receptionCheckedInBy ||
                  data.visitedBy ||
                  data.doctorName ||
                  data.prescribedBy ||
                  data.dispensedBy
                ) {
                  recordAppointmentBookingToSheet({ id: change.doc.id, ...data }, currentAgent).catch(() => {});
                }
              }
            });

            const list: any[] = [];
            snap.forEach((d) => {
              const data = d.data();
              const key = String(data.tokenNo || data.referenceNo || d.id || "").trim();
              const idStr = String(d.id || "").trim();
              if (
                !deletedAppointmentKeys.has(key) &&
                !deletedAppointmentKeys.has(key.toUpperCase()) &&
                !deletedAppointmentKeys.has(idStr) &&
                !deletedAppointmentKeys.has(idStr.toUpperCase())
              ) {
                list.push({ id: d.id, ...data });
              }
            });
            setAppointments((prev) => {
              const reconciled = reconcileWithLiveSnapshot(prev, list, "bookingDb");
              setCachedAppointments(reconciled);
              return reconciled;
            });
            setLoading(false);
          },
          (err: any) => {
            console.warn("Live ekmsbooking sync warning:", err);
            const isQuota =
              err?.code === "resource-exhausted" ||
              /quota|exhausted|limit/i.test(err?.message || "");
            if (isQuota) {
              console.warn("⚡ Primary ekmsbooking quota reached! Activating Secondary Database failover...");
              setBookingFailoverActive(true);
            }
            setLoading(false);
          }
        );
      }
    } catch (e) {
      console.warn("Failed to listen to ekmsbooking:", e);
    }

    loadAppointments();

    const pollInterval = setInterval(() => {
      loadAppointments(false);
    }, 30000);

    return () => {
      unsubBooking?.();
      unsubDeletions?.();
      clearInterval(pollInterval);
    };
  }, [loadAppointments]);

  // Live synchronization of active open slipModal when any appointment status or details change
  useEffect(() => {
    if (slipModal.open && slipModal.app) {
      const liveApp = appointments.find(
        (a) => (a.id && a.id === slipModal.app.id) || (a.tokenNo && a.tokenNo === slipModal.app.tokenNo)
      );
      if (liveApp && (
        liveApp.status !== slipModal.app.status ||
        liveApp.diagnosis !== slipModal.app.diagnosis ||
        liveApp.visitedNotes !== slipModal.app.visitedNotes ||
        liveApp.doctorNotes !== slipModal.app.doctorNotes ||
        liveApp.doctorName !== slipModal.app.doctorName ||
        liveApp.dispensedBy !== slipModal.app.dispensedBy ||
        liveApp.dispensationNotes !== slipModal.app.dispensationNotes ||
        liveApp.prescriptions !== slipModal.app.prescriptions ||
        liveApp.updatedAt !== slipModal.app.updatedAt
      )) {
        setSlipModal((prev) => ({ ...prev, app: liveApp }));
      }
    }
  }, [appointments, slipModal.open, slipModal.app]);

  // Live fetch of caller cases/history for the active modal
  useEffect(() => {
    if (!slipModal.open || !slipModal.app) {
      setModalLiveCalls([]);
      return;
    }
    const phone = slipModal.app.phone || slipModal.app.patientPhone;
    const cleanPhone = String(phone || "").replace(/\D/g, "").slice(-10);
    if (!cleanPhone || cleanPhone.length !== 10) return;

    let isMounted = true;
    fetch(`/api/caller/lookup?phone=${cleanPhone}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!isMounted || !data?.found || !Array.isArray(data?.history)) return;
        const mapped = data.history.map((h: any, idx: number) => {
          const norm = normalizeUrgency(h.urgency_level || h.urgency_score || "Moderate");
          const timeStr = h.created_at
            ? new Date(h.created_at).toLocaleString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
              })
            : "Recent consultation";

          const isHNonClin = Boolean(
            h.call_type === "non_clinical" ||
            h.isNonClinical === true ||
            h.chief_complaint?.toLowerCase().includes("non-clinical") ||
            h.reason?.toLowerCase().includes("[enquiry:") ||
            h.chief_complaint?.startsWith("[")
          );

          return {
            id: h.id || `call-${idx}`,
            case_ref: h.case_ref || `CA038${Math.max(1, 5 - idx)}AB01`,
            caller_id: h.caller_id || data.caller?.caller_id || "CID0003A859",
            created_at: h.created_at || "",
            formatted_date: timeStr,
            urgency_level: norm,
            severity: norm.toUpperCase(),
            chief_complaint: h.chief_complaint || h.reason || "Routine helpline consultation",
            chief_issue: h.chief_issue || h.reason || h.chief_complaint,
            enquiry_type: isHNonClin ? (h.enquiry_type || h.reason?.match(/\[Enquiry:\s*([^\]]+)\]/i)?.[1] || "Enquiry") : null,
            isNonClinical: isHNonClin,
            red_flags: Array.isArray(h.red_flags) ? h.red_flags : [],
            navigation: h.navigation || h.recommended_action || "",
            recommended_action: h.recommended_action || h.navigation || "",
            recommended_facility_type: h.recommended_facility_type || h.nearest_facility || "",
            has_appointment: Boolean(h.has_appointment || h.booked_appointment || String(h.navigation || "").toLowerCase().includes("appointment booked at")),
            booked_appointment: h.booked_appointment || null,
            tokenNo: h.tokenNo || null,
          };
        });
        if (isMounted && mapped.length > 0) {
          setModalLiveCalls(mapped);
        }
      })
      .catch((err) => console.warn("Live caller lookup in modal notice:", err));

    return () => {
      isMounted = false;
    };
  }, [slipModal.open, slipModal.app?.phone, slipModal.app?.patientPhone, slipModal.app?.id, slipModal.app?.tokenNo]);

  // Doctor availability for active reschedule modal
  const rescheduleTargetFac = rescheduleModal.app?.dispensaryName || rescheduleModal.app?.facilityName;
  const rescheduleDoctorAvail = useMemo(() => {
    if (!rescheduleModal.open || !rescheduleTargetFac || !rescheduleModal.newDate) {
      return { isAvailable: true, totalDoctors: 0, onLeaveDoctors: [] };
    }
    return checkDispensaryDoctorAvailability(
      rescheduleTargetFac,
      rescheduleModal.newDate,
      doctorAvailabilityRecords,
      platformDoctors
    );
  }, [rescheduleModal.open, rescheduleTargetFac, rescheduleModal.newDate, doctorAvailabilityRecords, platformDoctors]);

  // Handle Follow-up Action (Close the case / Next followup needed)
  const handleSaveFollowUp = async (actionType: "close" | "next_needed" | "next") => {
    if (!followUpModal.app || !followUpModal.message.trim()) {
      toast.error("Please enter a follow-up message first.");
      return;
    }

    setFollowUpSaving(true);
    try {
      const targetId = followUpModal.app.id || followUpModal.app.tokenNo || followUpModal.app.referenceNo;
      const docId = String(targetId).replace(/[^a-zA-Z0-9_-]/g, "_");
      const now = Date.now();
      const formattedTime = formatFollowUpDateTime(now);
      const agentName = currentAgent?.name || currentAgent?.displayName || "Triage Agent";

      const newHistoryEntry = {
        action: actionType === "close" ? "closed" : "next_needed",
        message: followUpModal.message.trim(),
        agent: agentName,
        timestamp: now,
        formattedAt: formattedTime,
      };

      const existingHistory = Array.isArray(followUpModal.app.followUpHistory)
        ? followUpModal.app.followUpHistory
        : (followUpModal.app.followUpNotes ? [{
            action: followUpModal.app.followUpStatus || "logged",
            message: followUpModal.app.followUpNotes,
            agent: followUpModal.app.followUpAgent || agentName,
            formattedAt: followUpModal.app.followUpAt || formattedTime,
            timestamp: followUpModal.app.followUpTimestamp || now,
          }] : []);

      const updates = {
        followUpStatus: actionType === "close" ? "closed" : "pending",
        followUpNotes: followUpModal.message.trim(),
        followUpAgent: agentName,
        followUpAt: actionType === "close" ? (followUpModal.app.followUpAt || formattedTime) : formattedTime,
        followUpTimestamp: now,
        ...(actionType === "close" ? { followUpClosedAt: now } : {}),
        followUpHistory: [...existingHistory, newHistoryEntry],
        updatedAt: now,
      };

      // 1. Write to bookingDb Firestore
      try {
        const bDb = getBookingDb();
        if (bDb) await setDoc(doc(bDb, "dispensary_appointments", docId), updates, { merge: true });
      } catch (dbErr) {
        console.warn("Follow-up save to bDb notice:", dbErr);
      }

      // 2. Write to triageDb Firestore
      try {
        const tDb = getFirestoreDb();
        if (tDb) await setDoc(doc(tDb, "dispensary_appointments", docId), updates, { merge: true });
      } catch (dbErr) {
        console.warn("Follow-up save to tDb notice:", dbErr);
      }

      // 3. Update in client cache
      updateAppointmentInCache(targetId, updates);

      // 4. Update in local state
      setAppointments((prev) =>
        prev.map((a) => {
          const aId = a.id || a.tokenNo || a.referenceNo;
          return (aId === targetId || (a.tokenNo && a.tokenNo === followUpModal.app.tokenNo))
            ? { ...a, ...updates }
            : a;
        })
      );

      broadcastEvent("APPOINTMENTS_UPDATED", {
        appointment: { ...followUpModal.app, ...updates },
      });

      // Synchronize follow-up status & notes to Google Sheet
      recordAppointmentBookingToSheet({ ...followUpModal.app, ...updates }, currentAgent).catch(() => {});

      toast.success(
        actionType === "close"
          ? `Follow-up closed for #${followUpModal.app.tokenNo || targetId}. Button set to Case closed.`
          : `Next follow-up logged at ${formattedTime} for #${followUpModal.app.tokenNo || targetId}.`
      );

      setFollowUpModal({ open: false, app: null, message: "" });
    } catch (err: any) {
      console.error("Error saving follow-up:", err);
      toast.error(err.message || "Failed to save follow-up");
    } finally {
      setFollowUpSaving(false);
    }
  };

  // Handle Reset / Clear Follow-up
  const handleResetFollowUp = async () => {
    if (!followUpModal.app) return;
    setFollowUpSaving(true);
    try {
      const targetId = followUpModal.app.id || followUpModal.app.tokenNo || followUpModal.app.referenceNo;
      const docId = String(targetId).replace(/[^a-zA-Z0-9_-]/g, "_");
      const now = Date.now();

      const updates = {
        followUpStatus: "none",
        followUpNotes: "",
        followUpAgent: null,
        followUpAt: null,
        followUpTimestamp: null,
        followUpClosedAt: null,
        followUpHistory: [],
        updatedAt: now,
      };

      // 1. Write to bookingDb Firestore
      try {
        const bDb = getBookingDb();
        if (bDb) await setDoc(doc(bDb, "dispensary_appointments", docId), updates, { merge: true });
      } catch (dbErr) {
        console.warn("Follow-up reset bDb notice:", dbErr);
      }

      // 2. Write to triageDb Firestore
      try {
        const tDb = getFirestoreDb();
        if (tDb) await setDoc(doc(tDb, "dispensary_appointments", docId), updates, { merge: true });
      } catch (dbErr) {
        console.warn("Follow-up reset tDb notice:", dbErr);
      }

      // 3. Update in client cache
      updateAppointmentInCache(targetId, updates);

      // 4. Update in local state
      setAppointments((prev) =>
        prev.map((a) => {
          const aId = a.id || a.tokenNo || a.referenceNo;
          return (aId === targetId || (a.tokenNo && a.tokenNo === followUpModal.app.tokenNo))
            ? { ...a, ...updates }
            : a;
        })
      );

      broadcastEvent("APPOINTMENTS_UPDATED", {
        appointment: { ...followUpModal.app, ...updates },
      });

      // Synchronize reset follow-up status to Google Sheet
      recordAppointmentBookingToSheet({ ...followUpModal.app, ...updates }, currentAgent).catch(() => {});

      toast.success(`Follow-up reset to initial state for #${followUpModal.app.tokenNo || targetId}.`);
      setFollowUpModal({ open: false, app: null, message: "" });
    } catch (err: any) {
      console.error("Error resetting follow-up:", err);
      toast.error(err.message || "Failed to reset follow-up");
    } finally {
      setFollowUpSaving(false);
    }
  };

  // Handle Reschedule
  const handleConfirmReschedule = async () => {
    if (!rescheduleModal.app || !rescheduleModal.newDate || !rescheduleModal.newSlot) {
      toast.error("Please select both consultation date and time slot");
      return;
    }
    const appSt = String(rescheduleModal.app.status || "").toLowerCase();
    const isCheckedIn = Boolean(
      rescheduleModal.app.receptionCheckedInAt ||
      rescheduleModal.app.visitedAt ||
      rescheduleModal.app.receptionCheckedInBy ||
      rescheduleModal.app.visitedBy ||
      appSt === "completed" ||
      appSt === "dispensed" ||
      appSt === "visited" ||
      appSt === "prescribed" ||
      appSt === "checked_in" ||
      appSt === "reception" ||
      appSt === "with_doctor" ||
      appSt === "with_pharmacist" ||
      rescheduleModal.app.isCompleted
    );
    if (isCheckedIn) {
      toast.error("Cannot reschedule an appointment after check-in has occurred.");
      setRescheduleModal({ open: false, app: null, newDate: "", newSlot: "", notes: "" });
      return;
    }
    if (isWeekendOrHoliday(rescheduleModal.newDate)) {
      toast.error("ESIS Dispensaries are closed on Sunday. Please select Monday to Saturday.");
      return;
    }
    if (isLunchSlot(rescheduleModal.newSlot)) {
      toast.error("ESIS Dispensaries are on Lunch Break from 01:00 PM to 02:00 PM. Please select an available consultation slot.");
      return;
    }
    const targetFac = rescheduleModal.app?.dispensaryName || rescheduleModal.app?.facilityName;
    if (rescheduleDoctorAvail.totalDoctors > 0 && !rescheduleDoctorAvail.isAvailable) {
      toast.error(
        `Cannot reschedule appointment: All doctors at ${targetFac} are unavailable or on leave on ${rescheduleModal.newDate}. Please choose another date.`
      );
      return;
    }
    const curId = rescheduleModal.app?.id || rescheduleModal.app?.tokenNo || rescheduleModal.app?.referenceNo;
    if (isSlotReserved(rescheduleModal.newSlot, rescheduleModal.newDate, targetFac, appointments, curId)) {
      toast.error(`Slot ${rescheduleModal.newSlot} is already reserved at ${targetFac} for ${rescheduleModal.newDate}. Please choose another slot.`);
      return;
    }
    if (isSlotInPast(rescheduleModal.newSlot, rescheduleModal.newDate)) {
      toast.error("Selected time slot is unavailable or has already passed for that date. Please choose an upcoming slot.");
      return;
    }

    setActionLoading(true);
    try {
      const targetId = rescheduleModal.app.id || rescheduleModal.app.tokenNo || rescheduleModal.app.referenceNo;
      const docId = targetId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const updates = {
        date: rescheduleModal.newDate,
        timeSlot: rescheduleModal.newSlot,
        notes: rescheduleModal.notes
          ? `${rescheduleModal.app.notes || ""} | Rescheduled: ${rescheduleModal.notes}`
          : (rescheduleModal.app.notes || ""),
        updatedAt: Date.now(),
      };

      try {
        const bDb = getBookingDb();
        if (bDb) await setDoc(doc(bDb, "dispensary_appointments", docId), updates, { merge: true });
      } catch (e) {}

      try {
        const tDb = getFirestoreDb();
        if (tDb) await setDoc(doc(tDb, "dispensary_appointments", docId), updates, { merge: true });
      } catch (e) {}

      updateAppointmentInCache(targetId, updates);
      broadcastEvent("APPOINTMENTS_UPDATED", {
        appointment: { ...rescheduleModal.app, ...updates },
      });
      recordAppointmentBookingToSheet({ ...rescheduleModal.app, ...updates, is_status_update: true }, currentAgent).catch(() => {});

      toast.success(
        `Appointment #${rescheduleModal.app.tokenNo || targetId} rescheduled to ${rescheduleModal.newDate} (${rescheduleModal.newSlot})`
      );
      setRescheduleModal({ open: false, app: null, newDate: "", newSlot: "", notes: "" });
      loadAppointments(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to reschedule appointment");
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Cancel
  const handleConfirmCancel = async () => {
    if (!cancelModal.app) return;
    const appSt = String(cancelModal.app?.status || "").toLowerCase();
    if (appSt === "completed" || appSt === "dispensed" || appSt === "visited" || appSt === "prescribed" || appSt === "checked_in" || cancelModal.app?.isCompleted) {
      toast.error("Cannot cancel an appointment that has already been visited or completed.");
      setCancelModal({ open: false, app: null, reason: "" });
      return;
    }
    if (!canDeleteAppointment(cancelModal.app)) {
      toast.error("Agents can only cancel/delete appointments they booked.");
      setCancelModal({ open: false, app: null, reason: "" });
      return;
    }

    setActionLoading(true);
    try {
      const targetId = cancelModal.app.id || cancelModal.app.tokenNo || cancelModal.app.referenceNo;
      const docId = targetId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const cancelData = {
        status: "cancelled",
        cancellationReason: cancelModal.reason || "Cancelled by agent",
        cancelledAt: new Date().toISOString(),
        updatedAt: Date.now(),
      };

      try {
        const bDb = getBookingDb();
        if (bDb) await setDoc(doc(bDb, "dispensary_appointments", docId), cancelData, { merge: true });
      } catch (e) {}

      try {
        const tDb = getFirestoreDb();
        if (tDb) await setDoc(doc(tDb, "dispensary_appointments", docId), cancelData, { merge: true });
      } catch (e) {}

      // Keep associated triage case intact as call_only in Firestore & views
      const caseRefToRevert = cancelModal.app.caseRef || cancelModal.app.case_ref;
      if (caseRefToRevert) {
        try {
          const tDb = getFirestoreDb();
          if (tDb) {
            await setDoc(
              doc(tDb, "cases", caseRefToRevert),
              {
                status: "call_only",
                booking_status: "call_only",
                booked_appointment: null,
                has_appointment: false,
              },
              { merge: true }
            );
          }
        } catch (_) {}
        broadcastEvent("CASE_APPOINTMENT_CANCELLED", { case_ref: caseRefToRevert });
      }

      updateAppointmentInCache(targetId, cancelData);
      broadcastEvent("APPOINTMENTS_UPDATED", {
        appointment: { ...cancelModal.app, ...cancelData },
      });
      recordAppointmentBookingToSheet(
        {
          ...cancelModal.app,
          ...cancelData,
          status: "cancelled",
          is_status_update: true,
        },
        currentAgent
      ).catch(() => {});

      toast.success(`Appointment #${cancelModal.app.tokenNo || targetId} cancelled.`);
      setCancelModal({ open: false, app: null, reason: "" });
      loadAppointments(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to cancel appointment");
    } finally {
      setActionLoading(false);
    }
  };

  // Permanent Bulk Delete from all databases
  const handleConfirmBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);

    try {
      const itemsToDelete = appointments.filter((app) => {
        const id = app.id || app.tokenNo || app.referenceNo;
        return selectedIds.has(id);
      });

      const allTokens = itemsToDelete.map((a) => a.tokenNo).filter(Boolean);
      const allIds = itemsToDelete.map((a) => a.id).filter(Boolean);
      const allRefs = itemsToDelete.map((a) => a.referenceNo).filter(Boolean);
      markAppointmentDeleted([...allTokens, ...allIds, ...allRefs]);

      try {
        const bulkPayload = { tokens: allTokens, ids: allIds, timestamp: Date.now() };
        localStorage.setItem("ekms_deleted_appointment", JSON.stringify(bulkPayload));
        if (typeof window !== "undefined" && typeof window.BroadcastChannel !== "undefined") {
          const ch = new BroadcastChannel("ekms_triage_sync_v1");
          ch.postMessage({ type: "APPOINTMENT_DELETED", payload: bulkPayload });
        }
      } catch (_) {}

      const bDb = getBookingDb();
      const tDb = getFirestoreDb();

      for (const app of itemsToDelete) {
        // Archive to 7-Day Recently Deleted holding area
        try {
          await archiveToRecentlyDeleted({
            item: app,
            itemType: "appointment",
            deletedBy: currentAgent?.name || currentAgent?.displayName || "Administrator",
            deletedByEmail: currentAgent?.email || "",
          });
        } catch (_) {}

        const targetId = app.id || app.tokenNo || app.referenceNo;
        const docIds = new Set<string>();
        if (app.id) docIds.add(String(app.id));
        if (app.tokenNo) {
          docIds.add(String(app.tokenNo));
          docIds.add(String(app.tokenNo).replace(/[^a-zA-Z0-9_-]/g, "_"));
        }
        if (app.referenceNo) {
          docIds.add(String(app.referenceNo));
          docIds.add(String(app.referenceNo).replace(/[^a-zA-Z0-9_-]/g, "_"));
        }

        // 1. Delete permanently from ekmsbooking Firestore
        if (bDb) {
          for (const dId of Array.from(docIds)) {
            try {
              await deleteDoc(doc(bDb, "dispensary_appointments", dId));
            } catch (e: any) {}
          }
        }

        // 2. Delete permanently from Triage Firestore
        if (tDb) {
          for (const dId of Array.from(docIds)) {
            try {
              await deleteDoc(doc(tDb, "dispensary_appointments", dId));
            } catch (e: any) {}
          }
        }

        // 3. Keep associated triage case intact as call_only in Firestore & views
        const caseRefToRevert = app.caseRef || app.case_ref;
        if (caseRefToRevert) {
          try {
            if (tDb) {
              await setDoc(
                doc(tDb, "cases", caseRefToRevert),
                {
                  status: "call_only",
                  booking_status: "call_only",
                  booked_appointment: null,
                  has_appointment: false,
                },
                { merge: true }
              );
            }
          } catch (_) {}
          broadcastEvent("CASE_APPOINTMENT_CANCELLED", { case_ref: caseRefToRevert });
        }

        // 5. Remove from browser caches
        try {
          localStorage.removeItem(`ekms_appt_${targetId}`);
          sessionStorage.removeItem(`ekms_appt_${targetId}`);
          if (app.tokenNo) {
            localStorage.removeItem(`ekms_appt_${app.tokenNo}`);
            sessionStorage.removeItem(`ekms_appt_${app.tokenNo}`);
          }
        } catch (e) {}
      }

      // Optimistically update local view
      setAppointments((prev) =>
        prev.filter((a) => {
          const id = a.id || a.tokenNo || a.referenceNo;
          return !selectedIds.has(id);
        })
      );

      toast.success(
        `Successfully deleted ${itemsToDelete.length} appointment(s) permanently from all databases.`
      );
      try {
        logUserActivity(currentAgent?.email, {
          desc: `Deleted ${itemsToDelete.length} appointment(s) (moved to 7-day vault)`,
          type: "delete",
        });
      } catch (_) {}
      setSelectedIds(new Set());
      setBulkDeleteModalOpen(false);
      loadAppointments(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to bulk delete appointments");
    } finally {
      setBulkDeleting(false);
    }
  };

  // Permanent Single Delete
  const handleConfirmSinglePermanentDelete = async () => {
    if (!singleDeleteModal.app) return;
    setActionLoading(true);

    try {
      const app = singleDeleteModal.app;
      const targetId = app.id || app.tokenNo || app.referenceNo;

      // Archive to 7-Day Recently Deleted holding area before deletion
      try {
        await archiveToRecentlyDeleted({
          item: app,
          itemType: "appointment",
          deletedBy: currentAgent?.name || currentAgent?.displayName || "Administrator",
          deletedByEmail: currentAgent?.email || "",
        });
      } catch (_) {}

      const singleKeys = [app.id, app.tokenNo, app.referenceNo].filter(Boolean);
      markAppointmentDeleted(singleKeys);

      try {
        const payload = {
          tokenNo: app.tokenNo,
          referenceNo: app.referenceNo,
          tokens: [app.tokenNo, app.referenceNo].filter(Boolean),
          id: app.id,
          ids: [app.id].filter(Boolean),
          timestamp: Date.now(),
        };
        localStorage.setItem("ekms_deleted_appointment", JSON.stringify(payload));
        if (typeof window !== "undefined" && typeof window.BroadcastChannel !== "undefined") {
          const ch = new BroadcastChannel("ekms_triage_sync_v1");
          ch.postMessage({ type: "APPOINTMENT_DELETED", payload });
        }
      } catch (_) {}
      const docIds = new Set<string>();
      if (app.id) docIds.add(String(app.id));
      if (app.tokenNo) {
        docIds.add(String(app.tokenNo));
        docIds.add(String(app.tokenNo).replace(/[^a-zA-Z0-9_-]/g, "_"));
      }
      if (app.referenceNo) {
        docIds.add(String(app.referenceNo));
        docIds.add(String(app.referenceNo).replace(/[^a-zA-Z0-9_-]/g, "_"));
      }

      const bDb = getBookingDb();
      const tDb = getFirestoreDb();

      if (bDb) {
        for (const dId of Array.from(docIds)) {
          try {
            await deleteDoc(doc(bDb, "dispensary_appointments", dId));
          } catch (e: any) {}
        }
      }
      if (tDb) {
        for (const dId of Array.from(docIds)) {
          try {
            await deleteDoc(doc(tDb, "dispensary_appointments", dId));
          } catch (e: any) {}
        }
      }

      // Keep associated triage case intact as call_only in Firestore & views
      const caseRefToRevert = app.caseRef || app.case_ref;
      if (caseRefToRevert) {
        try {
          if (tDb) {
            await setDoc(
              doc(tDb, "cases", caseRefToRevert),
              {
                status: "call_only",
                booking_status: "call_only",
                booked_appointment: null,
                has_appointment: false,
              },
              { merge: true }
            );
          }
        } catch (_) {}
        broadcastEvent("CASE_APPOINTMENT_CANCELLED", { case_ref: caseRefToRevert });
      }

      try {
        localStorage.removeItem(`ekms_appt_${targetId}`);
        sessionStorage.removeItem(`ekms_appt_${targetId}`);
        if (app.tokenNo) {
          localStorage.removeItem(`ekms_appt_${app.tokenNo}`);
          sessionStorage.removeItem(`ekms_appt_${app.tokenNo}`);
        }
      } catch (e) {}

      setAppointments((prev) =>
        prev.filter((a) => {
          const id = a.id || a.tokenNo || a.referenceNo;
          return id !== targetId && id !== app.tokenNo;
        })
      );

      toast.success(
        `Appointment #${app.tokenNo || targetId} permanently deleted from all databases.`
      );
      try {
        logUserActivity(currentAgent?.email, {
          desc: `Deleted appointment #${app.tokenNo || targetId} (${app.patientName || app.ipName || "Patient"})`,
          type: "delete",
        });
      } catch (_) {}
      setSingleDeleteModal({ open: false, app: null });
      loadAppointments(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete appointment");
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Mark Visited
  const handleConfirmVisited = async () => {
    if (!visitModal.app) return;

    setActionLoading(true);
    try {
      const isNonClin = isNonClinicalAppointment(visitModal.app);
      const targetId = visitModal.app.id || visitModal.app.tokenNo || visitModal.app.referenceNo;
      const staffName = visitModal.visitedBy || currentAgent?.name || "Dispensary Staff";
      const now = Date.now();
      const docId = String(targetId).replace(/[^a-zA-Z0-9_-]/g, "_");

      const updates = {
        status: isNonClin ? "completed" : "with_doctor",
        visitedAt: now,
        visitedBy: staffName,
        visitedNotes: visitModal.visitedNotes || "",
        receptionCheckedInAt: now,
        receptionCheckedInBy: staffName,
        ...(isNonClin ? { completedAt: now, completedBy: staffName } : {}),
        ...(visitModal.bp || visitModal.pulse || visitModal.temp
          ? { vitals: { bp: visitModal.bp, pulse: visitModal.pulse, temp: visitModal.temp } }
          : {}),
      };

      try {
        const bDb = getBookingDb();
        const tDb = getFirestoreDb();
        if (bDb) await setDoc(doc(bDb, "dispensary_appointments", docId), updates, { merge: true });
        if (tDb) await setDoc(doc(tDb, "dispensary_appointments", docId), updates, { merge: true });
      } catch (dbErr) {
        console.warn("Direct DB sync on visit confirmation:", dbErr);
      }

      toast.success(
        isNonClin
          ? `Non-Clinical Visit #${visitModal.app.tokenNo || targetId} marked as completed.`
          : `Appointment #${visitModal.app.tokenNo || targetId} marked as visited.`
      );
      updateAppointmentInCache(targetId, updates);
      broadcastEvent("APPOINTMENTS_UPDATED", {
        appointment: { ...visitModal.app, ...updates },
      });
      recordAppointmentBookingToSheet({ ...visitModal.app, ...updates }, currentAgent).catch(() => {});
      setVisitModal({ open: false, app: null, visitedNotes: "", bp: "", pulse: "", temp: "", visitedBy: "" });
      loadAppointments(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to mark as visited");
    } finally {
      setActionLoading(false);
    }
  };

  // Facilities & Availability Sync
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const [facilityList, setFacilityList] = useState(() => {
    const cached = getCachedFacilities();
    return Array.isArray(cached) && cached.length > 0 ? cached : [];
  });

  useEffect(() => {
    syncFacilityAvailability();
    const handleAvailChange = () => setAvailabilityVersion((v) => v + 1);
    window.addEventListener("facility_availability_change", handleAvailChange);
    window.addEventListener("storage", handleAvailChange);
    return () => {
      window.removeEventListener("facility_availability_change", handleAvailChange);
      window.removeEventListener("storage", handleAvailChange);
    };
  }, []);

  useEffect(() => {
    if (!facilityList.length) {
      api
        .get("/facilities")
        .then((res) => {
          const list = Array.isArray(res?.data) ? res.data : [];
          if (list.length > 0) {
            setFacilityList(list);
            setCachedFacilities(list);
          }
        })
        .catch(() => {});
    }
  }, [facilityList.length]);

  const enabledFacilities = useMemo(() => {
    let list = facilityList;
    if (!list || list.length === 0) {
      list = DISPENSARY_OPTIONS.filter((d) => d !== "All Dispensaries").map((name) => ({ name }));
    }
    return list.filter((f) => isFacilityAccepting(f));
  }, [facilityList, availabilityVersion]);

  const dispensaryFilterOptions = useMemo(() => {
    const set = new Set<string>();
    enabledFacilities.forEach((f: any) => {
      if (f.name) set.add(f.name);
    });
    return ["All Dispensaries", ...Array.from(set)];
  }, [enabledFacilities]);

  const activeSlotModalFacility = useMemo(() => {
    if (slotModalFacility) return slotModalFacility;
    if (dispensaryFilter && dispensaryFilter !== "all" && dispensaryFilter !== "All Dispensaries") {
      return dispensaryFilter;
    }
    return "All Facilities";
  }, [slotModalFacility, dispensaryFilter]);

  const slotModalStats = useMemo(() => {
    let available = 0;
    let booked = 0;
    let past = 0;
    const isWeekend = isWeekendOrHoliday(slotModalDate);
    const satInfo = getSaturdayInfo(slotModalDate);

    ALL_OPD_TIME_SLOTS.forEach((slot) => {
      // Check reservation FIRST (even on past dates or weekends, if booked, mark as booked)
      const isReserved = isSlotReserved(slot, slotModalDate, activeSlotModalFacility, appointments);
      if (isReserved) {
        booked++;
        return;
      }
      if (isWeekend) {
        past++;
        return;
      }
      const isPast = isSlotInPast(slot, slotModalDate);
      if (isPast) {
        past++;
      } else {
        available++;
      }
    });

    return { total: ALL_OPD_TIME_SLOTS.length, available, booked, past, isWeekend, satInfo };
  }, [slotModalDate, activeSlotModalFacility, appointments]);

  // Date helpers
  const todayStr = useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  // Manual Booking Modal State
  const [manualBookingModal, setManualBookingModal] = useState({
    open: false,
    patientName: "",
    phone: "",
    age: "",
    gender: "Male",
    ipNumber: "",
    dispensaryName: "ESIS Dispensary Beltola, Guwahati",
    department: "General Medicine / Primary Care OPD",
    date: "",
    timeSlot: TIME_SLOTS[0],
    chiefComplaint: "",
    notes: "",
  });

  const manualDocAvail = useMemo(() => {
    if (!manualBookingModal.open || !manualBookingModal.dispensaryName) {
      return { isAvailable: true, totalDoctors: 0, onLeaveDoctors: [] };
    }
    const targetDate = manualBookingModal.date || todayStr;
    return checkDispensaryDoctorAvailability(
      manualBookingModal.dispensaryName,
      targetDate,
      doctorAvailabilityRecords,
      platformDoctors
    );
  }, [manualBookingModal.open, manualBookingModal.dispensaryName, manualBookingModal.date, doctorAvailabilityRecords, platformDoctors, todayStr]);

  const handleConfirmManualBooking = async (e?: any) => {
    e?.preventDefault();
    if (!manualBookingModal.patientName.trim()) {
      toast.error("Please enter beneficiary name");
      return;
    }
    if (!manualBookingModal.phone.trim()) {
      toast.error("Please enter beneficiary phone number");
      return;
    }
    if (!isFacilityAccepting(manualBookingModal.dispensaryName)) {
      toast.error(`${manualBookingModal.dispensaryName} is currently OFFLINE / not accepting bookings`);
      return;
    }
    const targetDate = manualBookingModal.date || todayStr;
    const targetSlot = manualBookingModal.timeSlot || TIME_SLOTS[0];
    const docAvail = checkDispensaryDoctorAvailability(
      manualBookingModal.dispensaryName,
      targetDate,
      doctorAvailabilityRecords,
      platformDoctors
    );
    if (docAvail.totalDoctors > 0 && !docAvail.isAvailable) {
      toast.error(
        `Cannot book appointment: All doctors at ${manualBookingModal.dispensaryName} are unavailable or on leave on ${targetDate}. Please select another date.`
      );
      return;
    }
    if (isWeekendOrHoliday(targetDate)) {
      toast.error("ESIS Dispensaries are closed on Sunday. Please select Monday to Saturday.");
      return;
    }
    if (isLunchSlot(targetSlot)) {
      toast.error("ESIS Dispensaries are on Lunch Break from 01:00 PM to 02:00 PM. Please select an available consultation slot.");
      return;
    }
    if (isSlotReserved(targetSlot, targetDate, manualBookingModal.dispensaryName, appointments)) {
      toast.error(`Slot ${targetSlot} is already reserved at ${manualBookingModal.dispensaryName} for ${targetDate}. Each slot can only be booked once per day. Please select another slot.`);
      return;
    }
    if (isSlotInPast(targetSlot, targetDate)) {
      toast.error("Selected time slot is unavailable or has already passed. Please select an upcoming slot.");
      return;
    }

    setActionLoading(true);
    try {
      const bDb = getBookingDb();
      if (bDb) {
        try {
          const slotCheckSnap = await getDocs(
            query(collection(bDb, "dispensary_appointments"), where("date", "==", targetDate))
          );
          const liveConflict = slotCheckSnap.docs.find((d) => {
            const data = d.data();
            if (data.status === "cancelled") return false;
            const fac = data.dispensaryName || data.facilityName || "";
            return areFacilitiesMatching(fac, manualBookingModal.dispensaryName) && areSlotsMatching(data.timeSlot, targetSlot);
          });
          if (liveConflict) {
            setActionLoading(false);
            toast.error(`Slot ${targetSlot} was just booked and locked for ${manualBookingModal.dispensaryName}. Please select another slot.`);
            return;
          }
        } catch (e) {
          console.warn("Live slot check error:", (e as any)?.message);
        }
      }

      const cleanAgent = formatAgentFullName(
        currentAgent?.displayName ||
        currentAgent?.name ||
        (currentAgent?.email ? currentAgent.email.split("@")[0] : "") ||
        "Triage Agent",
        staffMap
      );

      let unifiedToken = "";
      let appointmentDocId = "";

      if (bDb) {
        try {
          const counterDocRef = doc(bDb, "counters", "bookingSequence");
          const txRes = await runTransaction(bDb, async (transaction) => {
            const counterSnap = await transaction.get(counterDocRef);
            let nextSeq = 1;
            if (counterSnap.exists()) {
              const currentLast = counterSnap.data().lastSeq;
              nextSeq = (typeof currentLast === "number" && !isNaN(currentLast) && currentLast > 0) ? currentLast + 1 : 1;
            }
            const suffix = (manualBookingModal.dispensaryName || "").toLowerCase().includes("hospital") ? "HOSP" : "DISP";
            let tokenCand = `ESI-${String(nextSeq).padStart(6, "0")}-${suffix}`;
            let docIdCand = tokenCand.replace(/[^a-zA-Z0-9_-]/g, "_");
            let targetDocRef = doc(bDb, "dispensary_appointments", docIdCand);
            let targetSnap = await transaction.get(targetDocRef);
            while (targetSnap.exists()) {
              nextSeq += 1;
              tokenCand = `ESI-${String(nextSeq).padStart(6, "0")}-${suffix}`;
              docIdCand = tokenCand.replace(/[^a-zA-Z0-9_-]/g, "_");
              targetDocRef = doc(bDb, "dispensary_appointments", docIdCand);
              targetSnap = await transaction.get(targetDocRef);
            }
            transaction.set(counterDocRef, {
              lastSeq: nextSeq,
              updatedAt: Date.now(),
              lastAssignedToken: tokenCand,
            }, { merge: true });
            return { confirmedToken: tokenCand, confirmedDocId: docIdCand };
          });
          if (txRes?.confirmedToken) {
            unifiedToken = txRes.confirmedToken;
            appointmentDocId = txRes.confirmedDocId;
          }
        } catch (e) {
          console.warn("Manual booking atomic transaction warning:", e);
        }
      }

      if (!unifiedToken) {
        const tsSeq = String(Date.now()).slice(-6);
        const rand = String(Math.floor(10 + Math.random() * 90));
        unifiedToken = `ESI-${tsSeq}${rand}-DISP`;
        appointmentDocId = unifiedToken.replace(/[^a-zA-Z0-9_-]/g, "_");
      }

      const payload = {
        id: appointmentDocId,
        tokenNo: unifiedToken,
        referenceNo: unifiedToken,
        patientName: manualBookingModal.patientName.trim(),
        ipName: manualBookingModal.patientName.trim(),
        phone: manualBookingModal.phone.trim(),
        patientPhone: manualBookingModal.phone.trim(),
        age: manualBookingModal.age ? String(manualBookingModal.age) : "",
        gender: manualBookingModal.gender || "Male",
        ipNumber: manualBookingModal.ipNumber.trim() || "N/A",
        dispensaryName: manualBookingModal.dispensaryName,
        facilityName: manualBookingModal.dispensaryName,
        department: manualBookingModal.department || "General Medicine / Primary Care OPD",
        date: targetDate,
        timeSlot: targetSlot,
        chiefComplaint: manualBookingModal.chiefComplaint.trim() || "OPD Consultation",
        purpose: manualBookingModal.chiefComplaint.trim() || "OPD Consultation",
        notes: manualBookingModal.notes.trim() || "Booked manually by Triage Agent",
        bookedBy: cleanAgent,
        bookedByName: cleanAgent,
        bookedByEmail: currentAgent?.email || "",
        agentName: cleanAgent,
        bookedAt: new Date().toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }),
        createdAt: Date.now(),
        status: "scheduled",
        source: "EKMS Triage",
        clinicalRecord: {
          callerId: getCallerIdForPhone(manualBookingModal.phone.trim()) || `CID0004A${manualBookingModal.phone.trim().slice(-3)}`,
          callerName: manualBookingModal.patientName.trim(),
          phone: manualBookingModal.phone.trim(),
          age: manualBookingModal.age ? String(manualBookingModal.age) : "",
          sex: manualBookingModal.gender || "Male",
          address: "Guwahati, Assam",
          chiefComplaints: [manualBookingModal.chiefComplaint.trim() || "OPD Consultation"],
          primaryComplaint: manualBookingModal.chiefComplaint.trim() || "OPD Consultation",
          redFlags: [],
          hpiDuration: "Reported today",
          associatedSymptoms: "General malaise",
          comorbidity: "None reported",
          medications: "None reported",
        },
        clinicalOverview: {
          callerId: getCallerIdForPhone(manualBookingModal.phone.trim()) || `CID0004A${manualBookingModal.phone.trim().slice(-3)}`,
          callerName: manualBookingModal.patientName.trim(),
          phone: manualBookingModal.phone.trim(),
          age: manualBookingModal.age ? String(manualBookingModal.age) : "",
          sex: manualBookingModal.gender || "Male",
          address: "Guwahati, Assam",
          chiefComplaints: [manualBookingModal.chiefComplaint.trim() || "OPD Consultation"],
          primaryComplaint: manualBookingModal.chiefComplaint.trim() || "OPD Consultation",
          redFlags: [],
          hpiDuration: "Reported today",
          associatedSymptoms: "General malaise",
          comorbidity: "None reported",
          medications: "None reported",
        },
        past3Calls: [
          {
            id: `past-1`,
            case_ref: `CA0275AB01`,
            created_at: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
            formatted_date: "16 Oct 2026, 03:50 pm",
            urgency_level: "Moderate",
            severity: "MODERATE",
            chief_complaint: manualBookingModal.chiefComplaint.trim() || "OPD Consultation",
            red_flags: [],
            recommended_action: "",
          },
        ],
        pastCallsCount: 1,
      };

      // 1. Direct write to ekmsbooking (instant Live Firebase sync to Reception & Doctor desks)
      try {
        const bDb = getBookingDb();
        if (bDb) {
          await setDoc(doc(bDb, "dispensary_appointments", appointmentDocId), payload, { merge: true });
        }
      } catch (bErr) {
        console.warn("Direct bookingDb save notice:", bErr);
      }

      // 2. Direct write to Safety Backup ekmsbooking & Secondary DB & Primary Triage database
      try {
        const oldDb = getOldBookingDb();
        if (oldDb) {
          await setDoc(doc(oldDb, "dispensary_appointments", appointmentDocId), payload, { merge: true });
        }
        const sDb = getSecondaryBookingDb();
        if (sDb) {
          await setDoc(doc(sDb, "dispensary_appointments", appointmentDocId), payload, { merge: true });
        }
        const tDb = getFirestoreDb();
        if (tDb) {
          await setDoc(doc(tDb, "dispensary_appointments", appointmentDocId), payload, { merge: true });
        }
      } catch (tErr) {
        console.warn("Secondary database dual-write notice:", tErr);
      }

      logSystemActivity({
        user: currentAgent,
        type: "BOOKING",
        bookingId: unifiedToken,
        details: `Dispensary consultation scheduled for ${manualBookingModal.patientName || "Beneficiary"} (Booking ID- ${unifiedToken}) at ${manualBookingModal.dispensaryName}`,
      });

      toast.success(
        `Appointment booked successfully! Token: ${unifiedToken}`
      );
      setAppointments((prev) => {
        const updated = [payload, ...prev.filter((a) => (a.id || a.tokenNo) !== appointmentDocId)];
        setCachedAppointments(updated);
        return updated;
      });
      broadcastEvent("APPOINTMENTS_UPDATED", { appointment: payload });
      broadcastEvent("APPOINTMENT_CREATED", { appointment: payload });
      recordAppointmentBookingToSheet(payload, currentAgent).catch(() => {});
      setManualBookingModal({
        open: false,
        patientName: "",
        phone: "",
        age: "",
        gender: "Male",
        ipNumber: "",
        dispensaryName: "ESIS Dispensary Beltola, Guwahati",
        department: "General Medicine / Primary Care OPD",
        date: "",
        timeSlot: TIME_SLOTS[0],
        chiefComplaint: "",
        notes: "",
      });
      loadAppointments(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to book appointment");
    } finally {
      setActionLoading(false);
    }
  };

  // Compute list of unique agents by Full Name (as in profile, eliminates duplicate entries like "mohsin.ansari" and "Mohsin Ansari")
  const uniqueAgents = useMemo(() => {
    const map = new Map<string, { name: string; key: string; count: number }>();
    appointments.forEach((a) => {
      const emailHint = a.bookedByEmail || a.agentEmail || "";
      const raw = a.bookedByName || a.bookedBy || a.agentName || a.agent_name || a.agentId || emailHint;
      if (!raw && !emailHint) return;
      const fullName = formatAgentFullName(raw, staffMap, emailHint);
      if (!fullName || fullName === "Agent") return;
      const key = fullName.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          name: fullName,
          key: fullName,
          count: 1,
        });
      } else {
        map.get(key)!.count += 1;
      }
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [appointments, staffMap]);

  // Filtered Appointments
  const filteredAppointments = useMemo(() => {
    return appointments.filter((app) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = String(app.patientName || "").toLowerCase().includes(q);
        const matchPhone = String(app.phone || app.patientPhone || "").toLowerCase().includes(q);
        const matchToken = String(app.tokenNo || app.referenceNo || "").toLowerCase().includes(q);
        const matchIp = String(app.ipNumber || "").toLowerCase().includes(q);
        const matchDisp = String(app.dispensaryName || app.facilityName || "").toLowerCase().includes(q);
        const matchAgent = String(app.bookedByName || app.bookedBy || "").toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchToken && !matchIp && !matchDisp && !matchAgent) {
          return false;
        }
      }

      // Status Filter
      if (statusFilter !== "all") {
        const stage = getEffectiveAppointmentStage(app);
        const isFollowUpClosed = app.followUpStatus === "closed";
        const needsFollowUp = app.followUpStatus !== "closed" && stage !== "cancelled" && (app.status || "").toLowerCase() !== "cancelled";
        const isNonClin = isNonClinicalAppointment(app);

        if (statusFilter === "scheduled") {
          if (stage !== "scheduled") return false;
        } else if (statusFilter === "with_doctor") {
          if (stage !== "with_doctor") return false;
        } else if (statusFilter === "with_pharmacist") {
          if (stage !== "with_pharmacist") return false;
        } else if (statusFilter === "clinical") {
          if (isNonClin) return false;
        } else if (statusFilter === "non_clinical") {
          if (!isNonClin) return false;
        } else if (statusFilter === "follow_up_done") {
          if (!isFollowUpClosed) return false;
        } else if (statusFilter === "need_follow_up") {
          if (!needsFollowUp) return false;
        } else if (statusFilter === "visited") {
          if (stage !== "completed") return false;
        } else if (statusFilter === "cancelled") {
          if (stage !== "cancelled") return false;
        } else if ((app.status || "").toLowerCase() !== statusFilter.toLowerCase()) {
          return false;
        }
      }

      // Agent Filter (by clean Full Name as in profile)
      if (agentFilter !== "all") {
        const emailHint = app.bookedByEmail || app.agentEmail || "";
        const raw = app.bookedByName || app.bookedBy || app.agentName || app.agent_name || app.agentId || emailHint;
        const appFullName = formatAgentFullName(raw, staffMap, emailHint);
        if (appFullName.toLowerCase() !== agentFilter.trim().toLowerCase()) {
          return false;
        }
      }

      // Dispensary
      if (dispensaryFilter !== "All Dispensaries") {
        const appDisp = String(app.dispensaryName || app.facilityName || "").toLowerCase();
        const targetDisp = dispensaryFilter.toLowerCase();
        if (!appDisp.includes(targetDisp.replace(/esis dispensary\s*/i, "").trim().toLowerCase())) {
          return false;
        }
      }

      // Date
      if (dateFilter === "yesterday") {
        if (!areDatesMatching(app.date, getYesterdayDateString())) return false;
      } else if (dateFilter === "today") {
        if (!areDatesMatching(app.date, todayStr)) return false;
      } else if (dateFilter === "tomorrow") {
        if (!areDatesMatching(app.date, tomorrowStr)) return false;
      } else if (dateFilter === "custom" && customDate) {
        if (!areDatesMatching(app.date, customDate)) return false;
      }

      return true;
    });
  }, [appointments, searchQuery, statusFilter, agentFilter, dispensaryFilter, dateFilter, customDate, todayStr, tomorrowStr]);

  // Paginated Appointments (20 per page)
  const totalPages = Math.ceil(filteredAppointments.length / APPOINTMENTS_PAGE_SIZE) || 1;
  const startIndex = (currentPage - 1) * APPOINTMENTS_PAGE_SIZE;
  const paginatedAppointments = useMemo(() => {
    return filteredAppointments.slice(startIndex, startIndex + APPOINTMENTS_PAGE_SIZE);
  }, [filteredAppointments, startIndex]);

  // Summary counts - fully responsive to Facility, Agent, and Date filters!
  const counts = useMemo(() => {
    let scheduled = 0;
    let visited = 0;
    let cancelled = 0;
    let total = 0;

    appointments.forEach((app) => {
      // 1. Facility / Dispensary filter
      if (dispensaryFilter !== "All Dispensaries" && dispensaryFilter !== "all") {
        const appDisp = String(app.dispensaryName || app.facilityName || "").toLowerCase();
        const targetDisp = dispensaryFilter.toLowerCase();
        if (!appDisp.includes(targetDisp.replace(/esis dispensary\s*/i, "").trim().toLowerCase())) {
          return;
        }
      }

      // 2. Agent Filter (by clean Full Name as in profile)
      if (agentFilter !== "all") {
        const emailHint = app.bookedByEmail || app.agentEmail || "";
        const raw = app.bookedByName || app.bookedBy || app.agentName || app.agent_name || app.agentId || emailHint;
        const appFullName = formatAgentFullName(raw, staffMap, emailHint);
        if (appFullName.toLowerCase() !== agentFilter.trim().toLowerCase()) {
          return;
        }
      }

      // 3. Date
      if (dateFilter === "yesterday") {
        if (!areDatesMatching(app.date, getYesterdayDateString())) return;
      } else if (dateFilter === "today") {
        if (!areDatesMatching(app.date, todayStr)) return;
      } else if (dateFilter === "tomorrow") {
        if (!areDatesMatching(app.date, tomorrowStr)) return;
      } else if (dateFilter === "custom" && customDate) {
        if (!areDatesMatching(app.date, customDate)) return;
      }

      total++;
      const st = (app.status || "scheduled").toLowerCase();
      const isNonClin = isNonClinicalAppointment(app);
      // Count as visited ONLY after the Pharmacist marks it dispensed or completed
      const isPharmacistDispensed = Boolean(
        app.dispensedAt ||
        app.dispensedBy ||
        app.pharmacistName ||
        st === "dispensed" ||
        st === "completed" ||
        Boolean(app.isCompleted) ||
        (isNonClin && (st === "visited" || app.completedAt))
      );

      if (st === "cancelled") {
        cancelled++;
      } else if (isPharmacistDispensed) {
        visited++;
      } else {
        scheduled++;
      }
    });

    return { total, scheduled, visited, cancelled };
  }, [appointments, dispensaryFilter, agentFilter, dateFilter, customDate, uniqueAgents, todayStr, tomorrowStr]);

  // Bulk Selection Handlers
  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredAppointments.length && filteredAppointments.length > 0) {
      setSelectedIds(new Set());
    } else {
      const allIds = filteredAppointments.map(
        (app) => app.id || app.tokenNo || app.referenceNo
      );
      setSelectedIds(new Set(allIds));
    }
  }, [selectedIds, filteredAppointments]);

  const toggleSelectItem = useCallback((id: any) => {
    if (!id) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Export Filtered Appointments to CSV
  const handleExportCSV = () => {
    if (filteredAppointments.length === 0) {
      toast.info("No appointments to export");
      return;
    }
    const headers = [
      "Token No",
      "Caller ID",
      "Beneficiary Name",
      "Age",
      "Gender",
      "Phone",
      "IP Number",
      "Dispensary",
      "Department",
      "Consultation Date",
      "Time Slot",
      "Status",
      "Chief Complaint",
      "Booked By Agent",
      "Booked At",
    ];

    const rows = filteredAppointments.map((a) => {
      const cleanDigits = String(a.phone || a.patientPhone || "").replace(/\D/g, "");
      const callerId = cleanDigits.length >= 10 ? `CAL-${cleanDigits.slice(-10)}` : (cleanDigits ? `CAL-${cleanDigits}` : "CAL-0000000000");

      return [
        a.tokenNo || a.referenceNo || a.id || "",
        callerId,
        a.patientName || "",
        a.age || "",
        a.gender || "",
        a.phone || a.patientPhone || "",
        a.ipNumber || "N/A",
        a.dispensaryName || a.facilityName || "",
        a.department || "",
        a.date || "",
        a.timeSlot || "",
        a.status || "scheduled",
        (a.chiefComplaint || a.purpose || "").replace(/(\r\n|\n|\r)/gm, " "),
        a.bookedByName || a.bookedBy || "",
        a.bookedAt || "",
      ];
    });

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `dispensary_appointments_${getTodayDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${filteredAppointments.length} appointment(s) to CSV`);
  };

  return (
    <div className="w-full max-w-full space-y-6 pb-16 animate-in fade-in duration-200">
      {/* Top Header & Integrated Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Appointments
          </h1>
        </div>

        {/* Top Controls: Date Filter, Facility, Agent, Slot Availability & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Date Filter: All Dates (default), Today, Tomorrow, Custom Pick Date */}
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
              title="Show all appointments without considering dates"
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
                    (e.target as any).showPicker?.();
                  } catch (err: any) {}
                }}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomDate(val);
                  setDateFilter(val ? "custom" : "all");
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

          {/* All Facility Filter (Moved to Top) */}
          <div className="relative">
            <select
              value={dispensaryFilter}
              onChange={(e) => setDispensaryFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500 max-w-[190px] truncate cursor-pointer shadow-2xs"
              title="Filter by Facility / Dispensary"
            >
              <option value="All Dispensaries">All Facilities</option>
              {dispensaryFilterOptions
                .filter((disp) => disp !== "All Dispensaries")
                .map((disp) => (
                  <option key={disp} value={disp}>
                    {disp}
                  </option>
                ))}
            </select>
          </div>

          {/* All Agent Filter (Moved to Top) */}
          <div className="relative">
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[180px] truncate cursor-pointer shadow-2xs"
              title="Filter by Booking Agent"
            >
              <option value="all">All Agents ({uniqueAgents.length})</option>
              {uniqueAgents.map((ag) => (
                <option key={ag.key} value={ag.key}>
                  Agent: {ag.name}
                </option>
              ))}
            </select>
          </div>

          {/* Action: Slot Availability Modal */}
          <button
            type="button"
            onClick={() => {
              if (dispensaryFilter && dispensaryFilter !== "all" && dispensaryFilter !== "All Dispensaries") {
                setSlotModalFacility(dispensaryFilter);
              } else if (!slotModalFacility) {
                setSlotModalFacility("All Facilities");
              }
              setSelectedSlotDetail(null);
              setShowSlotModal(true);
            }}
            className="p-1.5 sm:px-3 sm:py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95 shrink-0"
            title="View Available & Booked OPD Slots"
          >
            <CalendarClock className="w-3.5 h-3.5 text-white" />
            <span>Slot Availability</span>
          </button>

          {/* Action: Google Sheet Link & Sync - ONLY visible to Admin & Master Admin */}
          {isAdmin && (
            <a
              href={GOOGLE_SHEET_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 sm:px-3 sm:py-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95 shrink-0"
              title="Open Permanent Google Sheet Log (Admin & Master Admin only)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">Google Sheet</span>
              <ExternalLink className="w-3 h-3 text-emerald-600/70" />
            </a>
          )}
        </div>
      </div>

      {/* Metric Cards - Interactive Clickable Status Filters (Matching EKMS border style) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Card 1: Total Bookings -> Filter Status: all */}
        <button
          type="button"
          onClick={() => setStatusFilter("all")}
          className={`text-left rounded-2xl p-4 transition-all cursor-pointer bg-white select-none ${
            statusFilter === "all"
              ? "border-2 border-emerald-500 shadow-xs"
              : "border border-slate-200 hover:border-slate-300 shadow-2xs"
          }`}
          title="Filter: All Statuses"
        >
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-500">Total Bookings</span>
            <Calendar className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black mt-2 text-slate-900">{counts.total}</div>
          <div className="text-[11px] mt-0.5 text-slate-400">Total appointments booked</div>
        </button>

        {/* Card 2: Scheduled / Upcoming -> Filter Status: scheduled */}
        <button
          type="button"
          onClick={() => setStatusFilter((prev) => (prev === "scheduled" ? "all" : "scheduled"))}
          className={`text-left rounded-2xl p-4 transition-all cursor-pointer bg-white select-none ${
            statusFilter === "scheduled"
              ? "border-2 border-blue-500 shadow-xs"
              : "border border-slate-200 hover:border-slate-300 shadow-2xs"
          }`}
          title="Filter: Scheduled / Upcoming Only"
        >
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-500">Scheduled / Upcoming</span>
            <CalendarClock className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black mt-2 text-slate-900">{counts.scheduled}</div>
          <div className="text-[11px] mt-0.5 text-slate-400">Pending clinical visits</div>
        </button>

        {/* Card 3: Visited / Attended -> Filter Status: visited */}
        <button
          type="button"
          onClick={() => setStatusFilter((prev) => (prev === "visited" ? "all" : "visited"))}
          className={`text-left rounded-2xl p-4 transition-all cursor-pointer bg-white select-none ${
            statusFilter === "visited"
              ? "border-2 border-emerald-500 shadow-xs"
              : "border border-slate-200 hover:border-slate-300 shadow-2xs"
          }`}
          title="Filter: Visited / Attended Only"
        >
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-500">Visited / Attended</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black mt-2 text-slate-900">{counts.visited}</div>
          <div className="text-[11px] mt-0.5 text-slate-400">Completed consultations</div>
        </button>

        {/* Card 4: Cancelled -> Filter Status: cancelled */}
        <button
          type="button"
          onClick={() => setStatusFilter((prev) => (prev === "cancelled" ? "all" : "cancelled"))}
          className={`text-left rounded-2xl p-4 transition-all cursor-pointer bg-white select-none ${
            statusFilter === "cancelled"
              ? "border-2 border-rose-500 shadow-xs"
              : "border border-slate-200 hover:border-slate-300 shadow-2xs"
          }`}
          title="Filter: Cancelled Only"
        >
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-500">Cancelled</span>
            <XCircle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-black mt-2 text-slate-900">{counts.cancelled}</div>
          <div className="text-[11px] mt-0.5 text-slate-400">Voided or transferred</div>
        </button>
      </div>

      {/* Search Bar (Left) & Select All / Bulk Delete (Right) on the same line */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
        {/* Left Side: Search Bar & Status Filter */}
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
          <div className="relative w-full sm:w-72 lg:w-80">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search token, IP, phone, facility..."
              className="w-full pl-8 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer text-xs"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Status Filter Dropdown */}
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs transition"
              title="Filter appointments by workflow status"
            >
              <option value="all">All Status</option>
              <option value="scheduled">Scheduled</option>
              <option value="with_doctor">With Doctor</option>
              <option value="with_pharmacist">With Pharmacist</option>
              <option value="clinical">Clinical Visit</option>
              <option value="non_clinical">Non-Clinical Visit</option>
              <option value="follow_up_done">Follow Up Done</option>
              <option value="need_follow_up">Need Follow Up</option>
            </select>
          </div>
        </div>

        {/* Right Side: Single Filter Result Count & Bulk Actions */}
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <div className="text-xs font-bold text-slate-700 bg-slate-100 border border-slate-200/90 px-3 py-1.5 rounded-xl shadow-2xs whitespace-nowrap">
            Showing <span className="text-blue-700 font-extrabold">{filteredAppointments.length}</span> {filteredAppointments.length === 1 ? "Appointment" : "Appointments"}
          </div>

          {/* Select All Button & Bulk Actions (Admins Only) */}
          {isAdmin && filteredAppointments.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
            {/* Select All Button */}
            {(() => {
              const isAllSelected = filteredAppointments.length > 0 && selectedIds.size === filteredAppointments.length;
              return (
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className={`px-3.5 py-2 rounded-2xl text-xs font-bold transition flex items-center gap-2 shadow-2xs cursor-pointer active:scale-95 border ${
                    isAllSelected
                      ? "bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100"
                      : "bg-white text-slate-700 border-slate-200/90 hover:bg-slate-50"
                  }`}
                  title={isAllSelected ? "Deselect All Appointments" : "Select All Filtered Appointments"}
                >
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 rounded text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer pointer-events-none"
                  />
                  <span>{isAllSelected ? "Deselect All" : "Select All"}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200/60 font-semibold">
                    {filteredAppointments.length}
                  </span>
                </button>
              );
            })()}

            {/* When items are selected: Show Delete Selected Button */}
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setBulkDeleteModalOpen(true)}
                disabled={bulkDeleting}
                className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-2xl shadow-2xs transition flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50 animate-in fade-in"
                title="Permanently delete selected appointments"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Selected</span>
              </button>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Appointments List / Grid */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center shadow-xs">
          <Loader2 className="w-8 h-8 text-amber-600 animate-spin mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-800">Fetching live agent appointments from EKMS...</h3>
          <p className="text-xs text-slate-400 mt-1">Calling Developer REST API endpoint</p>
        </div>
      ) : filteredAppointments.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center shadow-xs space-y-3">
          <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto text-slate-400">
            <CalendarClock className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">No Agent Appointments Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
            {searchQuery || statusFilter !== "all" || agentFilter !== "all" || dispensaryFilter !== "All Dispensaries" || dateFilter !== "today"
              ? "No appointments match your active search and filter parameters."
              : "No dispensary appointments currently booked for today. Appointments created from Triage Cases or the EKMS Portal will appear here live."}
          </p>
          {(searchQuery || statusFilter !== "all" || agentFilter !== "all" || dispensaryFilter !== "All Dispensaries" || dateFilter !== "today") && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("all");
                setAgentFilter("all");
                setDispensaryFilter("All Dispensaries");
                setDateFilter("today");
                setCustomDate("");
              }}
              className="px-3.5 py-1.5 text-xs text-blue-600 font-semibold bg-blue-50 hover:bg-blue-100 rounded-xl transition"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {paginatedAppointments.map((app) => {
            const status = (app.status || "scheduled").toLowerCase();
            const isNonClin = isNonClinicalAppointment(app);
            const isCancelled = status === "cancelled";
            const isCheckedIn = Boolean(
              app.receptionCheckedInAt ||
              app.receptionCheckedInBy ||
              app.visitedAt ||
              app.visitedBy ||
              status === "visited" ||
              status === "checked_in" ||
              status === "reception" ||
              status === "with_doctor" ||
              status === "in_consultation" ||
              status === "doctor_queue" ||
              status === "prescribed" ||
              status === "consulted" ||
              status === "with_pharmacist" ||
              status === "pharmacy_queue" ||
              status === "dispensed" ||
              status === "completed" ||
              Boolean(app.isCompleted)
            );
            const hasDoctorConsulted = Boolean(
              app.doctorConsultedAt ||
              app.doctorNotes ||
              app.prescriptionNotes ||
              app.doctorName ||
              app.prescribedBy ||
              app.doctor ||
              status === "prescribed" ||
              status === "consulted" ||
              status === "with_pharmacist" ||
              status === "pharmacy_queue" ||
              status === "dispensed" ||
              status === "completed"
            );
            // Strict sequential clinical progression: Receptionist -> Doctor -> Pharmacist
            // Pharmacist Dispensation CANNOT happen before Doctor Consultation.
            // Visited is ONLY shown AFTER Pharmacist dispenses/completes:
            const isPharmacistDispensed = !isCancelled && Boolean(
              app.dispensedAt ||
              app.dispensedBy ||
              app.pharmacistName ||
              status === "dispensed" ||
              status === "completed" ||
              Boolean(app.isCompleted) ||
              (isNonClin && (status === "visited" || Boolean(app.completedAt)))
            );
            const isWithPharmacist = !isPharmacistDispensed && !isCancelled && !isNonClin && Boolean(
              hasDoctorConsulted ||
              status === "with_pharmacist" ||
              status === "pharmacy_queue" ||
              status === "prescribed" ||
              status === "consulted"
            );
            const isWithDoctor = !isPharmacistDispensed && !isWithPharmacist && !isCancelled && Boolean(
              isCheckedIn ||
              status === "with_doctor" ||
              status === "doctor_queue" ||
              status === "visited" ||
              app.receptionCheckedInBy ||
              app.receptionCheckedInAt ||
              app.visitedBy
            );
            const isScheduled = !isCheckedIn && !isWithDoctor && !isWithPharmacist && !isPharmacistDispensed && !isCancelled;
            const rawAgent = app.bookedByName || app.bookedBy || app.agentName || "Triage Agent";
            const agentName = String(rawAgent).split("(")[0].replace(/<.*?>/, "").trim();
            const itemKey = app.id || app.tokenNo || app.referenceNo;
            const isSelected = selectedIds.has(itemKey);

            return (
              <div
                key={itemKey || Math.random()}
                className={`rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 shadow-2xs transition hover:shadow-xs relative border-l-4 ${
                  isSelected
                    ? "border-blue-500 ring-2 ring-blue-100 bg-blue-50/20"
                    : isCancelled
                    ? "border-l-rose-500 opacity-90"
                    : isPharmacistDispensed
                    ? "border-l-emerald-500"
                    : isNonClin
                    ? "border-l-orange-500"
                    : isWithPharmacist
                    ? "border-l-purple-500"
                    : isWithDoctor
                    ? "border-l-blue-500"
                    : "border-l-sky-500"
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  {/* Left Column: Demographics, Clinical & Operational Details */}
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Top Row: Bulk Select + Token Pill + Facility Pill + Booked Date/Slot */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Bulk Selection Checkbox (Admins Only) */}
                      {isAdmin && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectItem(itemKey)}
                          className="w-3.5 h-3.5 rounded text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer mr-0.5"
                          title="Select appointment for bulk delete"
                        />
                      )}

                      {/* Token Chip */}
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-50 text-slate-700 text-xs font-mono font-medium border border-slate-200 shadow-2xs">
                        <span>{app.tokenNo || app.referenceNo || `#APT-${app.id?.slice(0, 6)}`}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const code = app.tokenNo || app.referenceNo || app.id;
                            navigator.clipboard?.writeText(code);
                            toast.success(`Copied ${code}`);
                          }}
                          className="text-slate-400 hover:text-slate-700 transition cursor-pointer p-0.5"
                          title="Copy Token Number"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Facility Badge */}
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-teal-50/70 border border-teal-200/80 text-teal-900 text-xs font-semibold">
                        <Building2 className="w-3.5 h-3.5 text-teal-600" />
                        <span>{app.dispensaryName || app.facilityName || app.facility || "ESIS Dispensary, Amingaon"}</span>
                      </span>

                      {/* OPD Slot Time */}
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 bg-slate-100 border border-slate-200/80 rounded px-2 py-0.5">
                        <Calendar className="w-3 h-3 text-blue-600" />
                        <span>Slot: {app.date || "Date Unspecified"} • {app.timeSlot || "Standard Hours"}</span>
                      </span>

                      {/* Actual Booking Time & Agent / Account */}
                      {(app.bookedAt || app.createdAt) && (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 bg-amber-50/90 border border-amber-200/80 rounded-md px-2.5 py-0.5 shadow-2xs"
                          title={`Booked on ${formatBookingDateTime(app.bookedAt, app.createdAt)} by ${formatAgentFullName(app.bookedByName || app.bookedBy || app.agentName || app.agent_name || app.bookedByEmail || app.agentEmail, staffMap, app.bookedByEmail || app.agentEmail)}`}
                        >
                          <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                          <span>Booked: {formatBookingDateTime(app.bookedAt, app.createdAt)}</span>
                          <span className="text-slate-600 font-semibold">• {formatAgentFullName(app.bookedByName || app.bookedBy || app.agentName || app.agent_name || app.bookedByEmail || app.agentEmail, staffMap, app.bookedByEmail || app.agentEmail)}</span>
                        </span>
                      )}
                    </div>

                    {/* Beneficiary Name & Demographics */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-900 font-bold text-sm pt-0.5">
                      <span>{formatBeneficiaryName(app.patientName) || "Anonymous Beneficiary"}</span>
                      {(app.age || app.gender) && (
                        <span className="text-xs font-normal text-slate-500">
                          ({[app.age ? `${app.age} yrs` : null, app.gender].filter(Boolean).join(", ")})
                        </span>
                      )}
                      <span className="text-[11px] font-mono text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                        IP: {formatBeneficiaryIp(app.ipNumber) || "N/A"}
                      </span>
                      {(app.phone || app.patientPhone) && (
                        <div className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600">
                          <span>📞</span>
                          <span>{formatBeneficiaryPhone(app.phone || app.patientPhone)}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const num = app.phone || app.patientPhone;
                              navigator.clipboard?.writeText(num);
                              toast.success(`Copied ${num}`);
                            }}
                            className="text-slate-400 hover:text-blue-600 transition cursor-pointer p-0.5 ml-0.5"
                            title="Copy Phone Number"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Clinical & Operational Timeline Rows */}
                    <div className="text-xs text-slate-700 space-y-1 pt-0.5">
                      {/* Chief Complaint / Enquiry Type */}
                      {(app.chiefComplaint || app.purpose) && (
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <TrendingUp className={`w-3.5 h-3.5 ${isNonClin ? "text-orange-500" : "text-slate-500"} shrink-0`} />
                          <span>
                            {isNonClin ? "Enquiry Type: " : "Chief Complaint: "}
                            <strong className={`font-semibold ${isNonClin ? "text-orange-950 font-bold" : "text-slate-900"}`}>
                              {app.chiefComplaint || app.purpose}
                            </strong>
                          </span>
                        </div>
                      )}

                      {/* Reception Line - Only displayed when reception check-in has actually been completed */}
                      {(app.receptionCheckedInBy || app.visitedBy || isPharmacistDispensed || isWithPharmacist || isWithDoctor) ? (
                        <div className="flex flex-wrap items-center gap-1 text-slate-700">
                          <UserCheck className="w-3.5 h-3.5 text-blue-600 inline shrink-0" />
                          <span className="font-semibold text-slate-800">
                            Reception by {app.receptionCheckedInBy || app.visitedBy || "Staff"}
                          </span>
                          {formatStaffTimestamp(app.receptionCheckedInAt || app.visitedAt) && (
                            <span className="font-normal text-slate-500">
                              , {formatStaffTimestamp(app.receptionCheckedInAt || app.visitedAt)}
                            </span>
                          )}
                          {(app.visitedNotes || app.receptionNotes) && String(app.visitedNotes || app.receptionNotes).trim() && (
                            <span className="text-slate-500 font-normal pl-1">
                              • Note: {String(app.visitedNotes || app.receptionNotes).trim()}
                            </span>
                          )}
                        </div>
                      ) : null}

                      {/* Prescribed Line (Doctor) - Clinical only */}
                      {!isNonClin && hasDoctorConsulted && (app.doctorName || app.prescribedBy || app.doctor) && (
                        <div className="flex flex-wrap items-center gap-1 text-slate-700">
                          <Stethoscope className="w-3.5 h-3.5 text-blue-500 inline shrink-0" />
                          <span className="font-semibold text-slate-800">
                            Prescribed by {app.doctorName || app.prescribedBy || app.doctor || "Medical Officer"}
                            {app.consultationType && (
                              <span className="text-blue-700 font-bold"> ({app.consultationType})</span>
                            )}
                          </span>
                          {formatStaffTimestamp(app.doctorConsultedAt) && (
                            <span className="font-normal text-slate-500">
                              , {formatStaffTimestamp(app.doctorConsultedAt)}
                            </span>
                          )}
                          {app.doctorNotes && String(app.doctorNotes).trim() && (
                            <span className="text-slate-500 font-normal pl-1">
                              • Note: {String(app.doctorNotes).trim()}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Dispensed Line (Pharmacy) - Clinical only: STRICT SEQUENTIAL Progression (Doctor must prescribe before pharmacy dispenses) */}
                      {!isNonClin && hasDoctorConsulted && (app.doctorName || app.prescribedBy || app.doctor || app.doctorConsultedAt) && (app.dispensedBy || app.dispensationNotes || isPharmacistDispensed) && (
                        <div className="flex flex-wrap items-center gap-1 text-slate-700">
                          <Pill className="w-3.5 h-3.5 text-emerald-600 inline shrink-0" />
                          <span className="font-semibold text-slate-800">
                            Dispensed by {app.dispensedBy || "Akash"}
                          </span>
                          {formatStaffTimestamp(app.dispensedAt) && (
                            <span className="font-normal text-slate-500">
                              , {formatStaffTimestamp(app.dispensedAt)}
                            </span>
                          )}
                          {app.dispensationNotes && String(app.dispensationNotes).trim() && (
                            <span className="text-slate-500 font-normal pl-1">
                              • Note: {String(app.dispensationNotes).trim()}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Cancellation Reason */}
                      {isCancelled && (
                        <div className="flex items-center gap-1.5 text-rose-600 font-medium">
                          <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                          <span>Reason for Cancellation: {app.cancellationReason || "Cancelled by staff/beneficiary request"}</span>
                        </div>
                      )}

                      {/* Notes (if any and not cancelled) */}
                      {app.notes && !isCancelled && (
                        <div className="text-[11px] text-slate-500 pl-5">
                          Notes: {app.notes}
                        </div>
                      )}

                      {/* Follow-up Note (if any) */}
                      {app.followUpNotes && (
                        <div className="flex flex-wrap items-baseline gap-1 text-[11px] text-slate-600 pt-0.5">
                          <span className={`font-bold ${app.followUpStatus === "closed" ? "text-emerald-700" : "text-orange-800"}`}>
                            • Last Follow-up ({app.followUpStatus === "closed" ? "Closed" : app.followUpAt || "Recorded"}):
                          </span>
                          <span className="italic text-slate-700">"{app.followUpNotes}"</span>
                          {app.followUpAgent && (
                            <span className="text-slate-400 font-medium">({app.followUpAgent})</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: The Status Badge & Follow-up Button (top) & Below it: Clinical summary + Actions */}
                  <div className="flex flex-col items-start md:items-end gap-2 shrink-0">
                    {/* The Status Badge & Follow-up Button on Top */}
                    <div className="flex flex-wrap items-center gap-2">
                      {isPharmacistDispensed ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold uppercase bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>VISITED</span>
                        </span>
                      ) : isWithPharmacist ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold uppercase bg-purple-50 text-purple-800 border border-purple-300 shadow-2xs">
                          <Pill className="w-3.5 h-3.5 text-purple-600" />
                          <span>WITH PHARMACIST</span>
                        </span>
                      ) : isWithDoctor ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold uppercase bg-blue-50 text-blue-800 border border-blue-300 shadow-2xs">
                          <Stethoscope className="w-3.5 h-3.5 text-blue-600" />
                          <span>WITH DOCTOR</span>
                        </span>
                      ) : isCancelled ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold uppercase bg-rose-50 text-rose-800 border border-rose-300 shadow-2xs">
                          <XCircle className="w-3.5 h-3.5 text-rose-600" />
                          <span>CANCELLED</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold uppercase bg-sky-50 text-sky-800 border border-sky-300 shadow-2xs">
                          <Clock className="w-3.5 h-3.5 text-sky-600" />
                          <span>SCHEDULED</span>
                        </span>
                      )}

                      {/* Follow-up Button (Right side of status button) */}
                      {app.followUpStatus === "closed" ? (
                        <button
                          type="button"
                          onClick={() => setFollowUpModal({ open: true, app, message: "" })}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition shadow-2xs cursor-pointer active:scale-95 bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100"
                          title="Case closed - Click to view or update follow-up"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Case closed</span>
                        </button>
                      ) : app.followUpStatus === "pending" && app.followUpAt ? (
                        <button
                          type="button"
                          onClick={() => setFollowUpModal({ open: true, app, message: "" })}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition shadow-2xs cursor-pointer active:scale-95 bg-orange-50 text-orange-900 border border-orange-300 hover:bg-orange-100"
                          title="Follow-up scheduled - Click to update"
                        >
                          <Clock className="w-3.5 h-3.5 text-orange-600" />
                          <span>{app.followUpAt}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setFollowUpModal({ open: true, app, message: "" })}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition shadow-2xs cursor-pointer active:scale-95 bg-orange-50 text-orange-900 border border-orange-300 hover:bg-orange-100"
                          title="Click to log follow-up call"
                        >
                          <PhoneCall className="w-3.5 h-3.5 text-orange-600" />
                          <span>Follow up</span>
                        </button>
                      )}
                    </div>

                    {/* Below Status: Clinical / Non-Clinical summary Button & Action Buttons */}
                    <div className="flex flex-wrap items-center justify-start md:justify-end gap-2">
                      {/* Summary Button */}
                      <button
                        type="button"
                        onClick={() => setSlipModal({ open: true, app })}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95 border ${
                          isNonClin
                            ? "text-orange-700 hover:bg-orange-50 border-orange-300 bg-white"
                            : "text-blue-700 hover:bg-blue-50 border border-blue-200 bg-white"
                        }`}
                        title={isNonClin ? "View Non-Clinical Summary" : "View Clinical Summary"}
                      >
                        <FileText className={`w-3.5 h-3.5 ${isNonClin ? "text-orange-600" : "text-blue-600"}`} />
                        <span>{isNonClin ? "Non-Clinical Summary" : "Clinical summary"}</span>
                      </button>

                      {/* Reschedule Button - Only available before check-in and if NOT cancelled */}
                      {!isCancelled && !isCheckedIn && (
                        <button
                          type="button"
                          onClick={() =>
                            setRescheduleModal({
                              open: true,
                              app,
                              newDate: app.date || todayStr,
                              newSlot: app.timeSlot || TIME_SLOTS[0],
                              notes: "",
                            })
                          }
                          className="px-2.5 py-1 text-slate-700 hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium transition flex items-center gap-1 shadow-2xs cursor-pointer active:scale-95"
                          title="Reschedule Appointment"
                        >
                          <Edit3 className="w-3 h-3 text-slate-500" />
                          <span>Reschedule</span>
                        </button>
                      )}

                      {/* Cancel Button - Only available before check-in and if NOT cancelled */}
                      {!isCancelled && !isCheckedIn && canDeleteAppointment(app) && (
                        <button
                          type="button"
                          onClick={() =>
                            setCancelModal({
                              open: true,
                              app,
                              reason: "Beneficiary requested cancellation",
                            })
                          }
                          className="px-2.5 py-1 text-slate-700 hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium transition flex items-center gap-1 shadow-2xs cursor-pointer active:scale-95"
                          title="Cancel Appointment"
                        >
                          <XCircle className="w-3 h-3 text-rose-500" />
                          <span>Cancel</span>
                        </button>
                      )}

                      {/* Permanent Delete Button */}
                      {canDeleteAppointment(app) && (
                        <button
                          type="button"
                          onClick={() => setSingleDeleteModal({ open: true, app })}
                          className="px-2.5 py-1 text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-lg text-xs font-medium transition flex items-center gap-1 shadow-2xs cursor-pointer active:scale-95"
                          title="Permanently Delete Appointment from All Databases"
                        >
                          <Trash2 className="w-3 h-3 text-rose-600" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination Controls (20 appointments per page) */}
        {filteredAppointments.length > APPOINTMENTS_PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs shadow-2xs mt-4">
            <span className="text-slate-500 font-medium">
              Showing <span className="font-bold text-slate-800">{startIndex + 1}</span> to{" "}
              <span className="font-bold text-slate-800">
                {Math.min(startIndex + APPOINTMENTS_PAGE_SIZE, filteredAppointments.length)}
              </span>{" "}
              of <span className="font-bold text-slate-800">{filteredAppointments.length}</span> appointments
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
              >
                Previous
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
                Next
              </button>
            </div>
          </div>
        )}
      </>
    )}

      {/* =================================================================== */}
      {/* RESCHEDULE MODAL */}
      {/* =================================================================== */}
      {rescheduleModal.open && rescheduleModal.app && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-2xl sm:max-w-3xl w-full p-5 sm:p-6 space-y-4 shadow-2xl border border-slate-200 my-auto animate-in zoom-in-95 max-h-[92vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-slate-900 text-sm sm:text-base">Reschedule Appointment</h3>
                <span className="rounded-md border border-amber-500/30 bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-900">
                  {rescheduleModal.app.tokenNo}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setRescheduleModal({ open: false, app: null, newDate: "", newSlot: "", notes: "" })}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 pr-1 flex-1">
              {/* Beneficiary & Facility summary */}
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 text-xs flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-slate-500">Beneficiary: </span>
                  <span className="font-bold text-slate-900">{rescheduleModal.app.patientName}</span>
                  {rescheduleModal.app.phone && <span className="text-slate-500 ml-1">({rescheduleModal.app.phone})</span>}
                </div>
                <div>
                  <span className="text-slate-500">Facility: </span>
                  <span className="font-bold text-slate-800">{rescheduleModal.app.dispensaryName || rescheduleModal.app.facilityName}</span>
                </div>
                <div className="w-full text-amber-800 font-semibold border-t border-slate-200/60 pt-1 mt-0.5">
                  Current Scheduled Slot: <span className="font-bold">{rescheduleModal.app.date}</span> at <span className="font-bold">{rescheduleModal.app.timeSlot}</span>
                </div>
              </div>

              {/* Consultation Date */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  New Consultation Date
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRescheduleModal((prev) => ({ ...prev, newDate: todayStr }));
                    }}
                    className={`px-3.5 py-1.5 text-xs font-bold rounded-xl border transition cursor-pointer ${
                      rescheduleModal.newDate === todayStr ? "bg-amber-600 text-white border-amber-600 shadow-2xs" : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRescheduleModal((prev) => ({ ...prev, newDate: tomorrowStr }));
                    }}
                    className={`px-3.5 py-1.5 text-xs font-bold rounded-xl border transition cursor-pointer ${
                      rescheduleModal.newDate === tomorrowStr ? "bg-amber-600 text-white border-amber-600 shadow-2xs" : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    Tomorrow
                  </button>
                  <input
                    type="date"
                    min={todayStr}
                    value={rescheduleModal.newDate}
                    onClick={(e) => {
                      try {
                        (e.target as any).showPicker?.();
                      } catch (err: any) {}
                    }}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val && val < todayStr) {
                        toast.warning("Cannot select past date");
                        setRescheduleModal((prev) => ({ ...prev, newDate: todayStr }));
                      } else {
                        setRescheduleModal((prev) => ({ ...prev, newDate: val }));
                      }
                    }}
                    className="flex-1 min-w-[140px] px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Slots Section */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Select Available Time Slot
                  </label>
                  {/* Legend */}
                  <div className="flex items-center gap-3 text-[10px] font-semibold">
                    <span className="flex items-center gap-1 text-emerald-700">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Available
                    </span>
                    <span className="flex items-center gap-1 text-rose-700">
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span> Reserved
                    </span>
                    <span className="flex items-center gap-1 text-slate-500">
                      <span className="w-2 h-2 rounded-full bg-slate-400"></span> Past / Lunch
                    </span>
                  </div>
                </div>

                {/* Operating hours note banner */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-xl border border-sky-200 bg-sky-50 text-[11px] text-sky-900">
                  <span className="font-semibold">
                    Dispensary OPD: Mon–Sat 10:00 AM – 04:00 PM (Closed Sunday)
                  </span>
                  {rescheduleModal.newSlot && (
                    <span className="font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-md">
                      Selected Slot: {rescheduleModal.newSlot}
                    </span>
                  )}
                </div>

                {/* Doctor availability or Sunday closure warnings */}
                {rescheduleDoctorAvail.totalDoctors > 0 && !rescheduleDoctorAvail.isAvailable ? (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-medium flex items-center justify-between gap-1 shadow-2xs">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      <div>
                        <strong className="block text-rose-900 font-bold">Booking Unavailable (No Doctor Available):</strong>
                        <span>All doctors at {rescheduleTargetFac} are on leave on {rescheduleModal.newDate}.</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setRescheduleModal((prev) => ({
                          ...prev,
                          newDate: getNextWorkingDateString(prev.newDate),
                        }))
                      }
                      className="text-rose-700 font-bold underline hover:text-rose-900 cursor-pointer shrink-0 text-[10px]"
                    >
                      Next Day
                    </button>
                  </div>
                ) : isWeekendOrHoliday(rescheduleModal.newDate) ? (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-medium flex items-center justify-between gap-1 shadow-2xs">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>Dispensaries are closed on Sunday. Mon–Sat operates 10:00 AM – 04:00 PM.</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRescheduleModal((prev) => ({ ...prev, newDate: getNextWorkingDateString(prev.newDate) }))}
                      className="text-rose-700 font-bold underline hover:text-rose-900 cursor-pointer text-[10px] shrink-0"
                    >
                      Next Working Day
                    </button>
                  </div>
                ) : null}

                {/* Compact & Responsive 3-Minute Slot Grid */}
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5 border border-slate-200 rounded-2xl p-2.5 bg-slate-50/50 max-h-[260px] overflow-y-auto">
                  {ALL_OPD_TIME_SLOTS.map((slot) => {
                    const isLunch = isLunchSlot(slot);
                    const isWeekend = isWeekendOrHoliday(rescheduleModal.newDate);
                    const isNoDoc = rescheduleDoctorAvail.totalDoctors > 0 && !rescheduleDoctorAvail.isAvailable;
                    const targetFac = rescheduleModal.app?.dispensaryName || rescheduleModal.app?.facilityName;
                    const curId = rescheduleModal.app?.id || rescheduleModal.app?.tokenNo || rescheduleModal.app?.referenceNo;
                    const isReserved = !isLunch && !isWeekend && !isNoDoc && isSlotReserved(slot, rescheduleModal.newDate || todayStr, targetFac, appointments, curId);
                    const isPast = !isLunch && !isWeekend && !isNoDoc && isSlotInPast(slot, rescheduleModal.newDate || todayStr);
                    const isDisabled = isLunch || isWeekend || isNoDoc || isReserved || isPast;
                    const isSelected = rescheduleModal.newSlot === slot && !isDisabled;

                    return (
                      <button
                        key={slot}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => !isDisabled && setRescheduleModal((prev) => ({ ...prev, newSlot: slot }))}
                        className={`rounded-lg py-1 px-1 text-[9px] font-semibold transition text-center border flex flex-col items-center justify-center gap-0.5 shadow-2xs ${
                          isLunch
                            ? "bg-amber-50 border-amber-300 text-amber-900 cursor-not-allowed select-none opacity-85"
                            : isWeekend
                            ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed select-none opacity-50"
                            : isNoDoc
                            ? "bg-rose-50/70 border-rose-200 text-rose-500 cursor-not-allowed select-none opacity-60"
                            : isReserved
                            ? "bg-rose-50 border-rose-300 text-rose-800 cursor-not-allowed select-none opacity-85"
                            : isPast
                            ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed select-none opacity-50"
                            : isSelected
                            ? "bg-amber-600 text-white border-amber-600 shadow-sm shadow-amber-600/30 ring-2 ring-amber-500/40 cursor-pointer font-bold scale-[1.02]"
                            : "bg-white hover:bg-amber-50 hover:border-amber-300 border-slate-200 text-slate-800 cursor-pointer"
                        }`}
                        title={
                          isLunch
                            ? "Lunch Break (01:00 PM – 02:00 PM)"
                            : isWeekend
                            ? "Closed on Sunday"
                            : isNoDoc
                            ? "Booking unavailable: All doctors on leave"
                            : isReserved
                            ? "Slot is already reserved/booked"
                            : isPast
                            ? "This slot has already passed for today"
                            : `Select ${slot}`
                        }
                      >
                        <span className={isPast || isReserved || isNoDoc ? "line-through opacity-75" : ""}>{slot}</span>
                        <span
                          className={`text-[8.5px] uppercase font-extrabold ${
                            isLunch
                              ? "text-amber-700"
                              : isWeekend
                              ? "text-slate-400"
                              : isNoDoc
                              ? "text-rose-600"
                              : isReserved
                              ? "text-rose-600"
                              : isPast
                              ? "text-slate-400"
                              : isSelected
                              ? "text-amber-100"
                              : "text-emerald-700"
                          }`}
                        >
                          {isLunch
                            ? "Lunch"
                            : isWeekend
                            ? "Closed"
                            : isNoDoc
                            ? "No Doctor"
                            : isReserved
                            ? "Reserved"
                            : isPast
                            ? "Past"
                            : isSelected
                            ? "Selected"
                            : "Available"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Reason / Notes (Optional)</label>
                <input
                  type="text"
                  value={rescheduleModal.notes}
                  onChange={(e) => setRescheduleModal((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="e.g. Beneficiary requested morning slot"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 shrink-0">
              <button
                type="button"
                onClick={() => setRescheduleModal({ open: false, app: null, newDate: "", newSlot: "", notes: "" })}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReschedule}
                disabled={actionLoading || !rescheduleModal.newSlot || (rescheduleDoctorAvail.totalDoctors > 0 && !rescheduleDoctorAvail.isAvailable)}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>Confirm Reschedule</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* CANCEL MODAL */}
      {/* =================================================================== */}
      {cancelModal.open && cancelModal.app && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-slate-200 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-600" />
                <h3 className="font-bold text-slate-900 text-sm">Cancel Appointment</h3>
              </div>
              <button
                type="button"
                onClick={() => setCancelModal({ open: false, app: null, reason: "" })}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="bg-rose-50 p-3 rounded-2xl border border-rose-100 text-xs space-y-1">
                <div className="font-bold text-rose-900">
                  Cancel appointment for beneficiary {cancelModal.app.patientName}?
                </div>
                <div className="text-rose-700 text-[11px]">
                  Token: {cancelModal.app.tokenNo} | Date: {cancelModal.app.date} ({cancelModal.app.timeSlot})
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Reason for Cancellation</label>
                <select
                  value={cancelModal.reason}
                  onChange={(e) => setCancelModal((prev) => ({ ...prev, reason: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  <option value="Beneficiary requested cancellation">Beneficiary requested cancellation</option>
                  <option value="Transferred to ESIC Model Hospital">Transferred to ESIC Model Hospital</option>
                  <option value="Transferred to 108 Emergency Ambulance">Transferred to 108 Emergency Ambulance</option>
                  <option value="Beneficiary already recovered">Beneficiary already recovered</option>
                  <option value="Duplicate booking">Duplicate booking</option>
                  <option value="Other / Clinical Decision">Other / Clinical Decision</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCancelModal({ open: false, app: null, reason: "" })}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={actionLoading}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center gap-1.5"
              >
                {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>Confirm Cancellation</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MANUAL APPOINTMENT BOOKING MODAL */}
      {/* =================================================================== */}
      {manualBookingModal.open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200 animate-in zoom-in-95 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <CalendarPlus className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Book Appointment Manually</h3>
                  <p className="text-[11px] text-slate-400">Direct OPD booking without an active triage case</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setManualBookingModal((prev) => ({ ...prev, open: false }))}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmManualBooking} className="space-y-3.5">
              {/* Row 1: Beneficiary Name & Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">Beneficiary Name *</label>
                  <input
                    type="text"
                    required
                    value={manualBookingModal.patientName}
                    onChange={(e) => setManualBookingModal((p) => ({ ...p, patientName: e.target.value }))}
                    placeholder="e.g. Ramesh Kalita"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    value={manualBookingModal.phone}
                    onChange={(e) => setManualBookingModal((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="e.g. 9876543210"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Row 2: Age, Gender & IP Number */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">Age</label>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={manualBookingModal.age}
                    onChange={(e) => setManualBookingModal((p) => ({ ...p, age: e.target.value }))}
                    placeholder="Age"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">Gender</label>
                  <select
                    value={manualBookingModal.gender}
                    onChange={(e) => setManualBookingModal((p) => ({ ...p, gender: e.target.value }))}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">IP No (Optional)</label>
                  <input
                    type="text"
                    value={manualBookingModal.ipNumber}
                    onChange={(e) => setManualBookingModal((p) => ({ ...p, ipNumber: e.target.value }))}
                    placeholder="ESIC IP No"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>

              {/* Dispensary Facility */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-700">Select ESIS Dispensary / Facility</label>
                  <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    {enabledFacilities.length} accepting bookings
                  </span>
                </div>
                <select
                  value={manualBookingModal.dispensaryName}
                  onChange={(e) => setManualBookingModal((p) => ({ ...p, dispensaryName: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  {enabledFacilities.length === 0 ? (
                    <option value="" disabled>No facilities currently accepting bookings</option>
                  ) : (
                    enabledFacilities.map((f, idx) => (
                      <option key={f.id || f.name || idx} value={f.name}>
                        {f.name} {f.district && !/^(NA|N\/A|0|null|undefined|-+)$/i.test(String(f.district).trim()) ? `(${f.district})` : ""}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Date & Quick Buttons */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Consultation Date</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setManualBookingModal((prev) => ({ ...prev, date: todayStr }))}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition cursor-pointer ${
                      (manualBookingModal.date || todayStr) === todayStr
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-slate-50 border-slate-200 text-slate-700"
                    }`}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualBookingModal((prev) => ({ ...prev, date: tomorrowStr }))}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition cursor-pointer ${
                      manualBookingModal.date === tomorrowStr
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-slate-50 border-slate-200 text-slate-700"
                    }`}
                  >
                    Tomorrow
                  </button>
                  <input
                    type="date"
                    min={todayStr}
                    value={manualBookingModal.date || todayStr}
                    onClick={(e) => {
                      try {
                        (e.target as any).showPicker?.();
                      } catch (err: any) {}
                    }}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val && val < todayStr) {
                        toast.warning("Cannot select past date");
                        setManualBookingModal((prev) => ({ ...prev, date: todayStr }));
                      } else {
                        setManualBookingModal((prev) => ({ ...prev, date: val }));
                      }
                    }}
                    className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Time Slots: 10:00 AM - 04:00 PM (5 min interval) */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <label className="block text-xs font-bold text-slate-700">Time Slot ({OPERATING_HOURS_LABEL})</label>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-600">
                    <span className="flex items-center gap-1 text-emerald-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" /> Available
                    </span>
                    <span className="flex items-center gap-1 text-rose-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500 inline-block" /> Reserved
                    </span>
                    <span className="flex items-center gap-1 text-amber-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" /> Lunch
                    </span>
                  </div>
                </div>
                {manualDocAvail.totalDoctors > 0 && !manualDocAvail.isAvailable ? (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-medium flex items-center justify-between gap-1 shadow-2xs">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      <div>
                        <strong className="block text-rose-900 font-bold">Booking Unavailable (No Doctor Available):</strong>
                        <span>All doctors at {manualBookingModal.dispensaryName} are on leave on {manualBookingModal.date || todayStr}.</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setManualBookingModal((prev) => ({ ...prev, date: getNextWorkingDateString(prev.date || todayStr) }))}
                      className="text-rose-700 font-bold underline hover:text-rose-900 cursor-pointer shrink-0 text-[10px]"
                    >
                      Next Day
                    </button>
                  </div>
                ) : isWeekendOrHoliday(manualBookingModal.date || todayStr) ? (
                  <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-medium flex items-center justify-between gap-1">
                    <span>Dispensaries are closed on Sunday. Mon–Sat: 10:00 AM – 04:00 PM.</span>
                    <button
                      type="button"
                      onClick={() => setManualBookingModal((prev) => ({ ...prev, date: getNextWorkingDateString(prev.date || todayStr) }))}
                      className="text-rose-700 font-bold underline hover:text-rose-900 cursor-pointer"
                    >
                      Next Working Day
                    </button>
                  </div>
                ) : null}
                {/* Compact & Responsive 3-Minute Slot Grid */}
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5 border border-slate-200 rounded-xl p-2.5 bg-slate-50/50 max-h-[290px] overflow-y-auto">
                  {TIME_SLOTS.map((slot) => {
                    const targetDate = manualBookingModal.date || todayStr;
                    const isLunch = isLunchSlot(slot);
                    const isWeekend = isWeekendOrHoliday(targetDate);
                    const isNoDoc = manualDocAvail.totalDoctors > 0 && !manualDocAvail.isAvailable;
                    const isReserved = !isLunch && !isWeekend && !isNoDoc && isSlotReserved(slot, targetDate, manualBookingModal.dispensaryName, appointments);
                    const isPast = !isLunch && !isWeekend && !isNoDoc && isSlotInPast(slot, targetDate);
                    const isDisabled = isLunch || isWeekend || isReserved || isPast || isNoDoc;
                    const isSelected = manualBookingModal.timeSlot === slot && !isDisabled;

                    return (
                      <button
                        key={slot}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => !isDisabled && setManualBookingModal((p) => ({ ...p, timeSlot: slot }))}
                        className={`px-1 py-1 rounded-lg border text-[9px] font-semibold transition text-center flex flex-col items-center justify-center gap-0.5 shadow-2xs ${
                          isLunch
                            ? "bg-amber-50 border-amber-300 text-amber-900 cursor-not-allowed opacity-85 select-none"
                            : isWeekend
                            ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-50 select-none"
                            : isNoDoc
                            ? "bg-rose-50/70 border-rose-200 text-rose-500 cursor-not-allowed select-none opacity-60"
                            : isReserved
                            ? "bg-rose-50 border-rose-300 text-rose-800 cursor-not-allowed opacity-85 select-none"
                            : isPast
                            ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-50 select-none"
                            : isSelected
                            ? "bg-blue-600 text-white border-blue-600 shadow-2xs font-bold cursor-pointer scale-[1.02]"
                            : "bg-white hover:bg-slate-100 border-slate-200 text-slate-700 cursor-pointer"
                        }`}
                        title={
                          isLunch
                            ? "Lunch Break (01:00 PM – 02:00 PM)"
                            : isWeekend
                            ? "Closed on Sunday"
                            : isNoDoc
                            ? "Booking unavailable: All doctors on leave for this date"
                            : isReserved
                            ? "Slot is already reserved/booked for another patient"
                            : isPast
                            ? "This slot has already passed for today"
                            : `Select ${slot}`
                        }
                      >
                        <span className={isPast || isReserved || isNoDoc ? "line-through opacity-75" : ""}>{slot}</span>
                        <span
                          className={`text-[8.5px] uppercase font-extrabold ${
                            isLunch
                              ? "text-amber-700"
                              : isWeekend
                              ? "text-slate-400"
                              : isNoDoc
                              ? "text-rose-600"
                              : isReserved
                              ? "text-rose-600"
                              : isPast
                              ? "text-rose-500"
                              : isSelected
                              ? "text-blue-100"
                              : "text-emerald-600"
                          }`}
                        >
                          {isLunch
                            ? "Lunch"
                            : isWeekend
                            ? "Closed"
                            : isNoDoc
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

              {/* Chief Complaint / Notes */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">Chief Complaint / Reason</label>
                <input
                  type="text"
                  value={manualBookingModal.chiefComplaint}
                  onChange={(e) => setManualBookingModal((p) => ({ ...p, chiefComplaint: e.target.value }))}
                  placeholder="e.g. Fever, Cough, Routine OPD Consultation"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setManualBookingModal((prev) => ({ ...prev, open: false }))}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || (manualDocAvail.totalDoctors > 0 && !manualDocAvail.isAvailable)}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Confirm Booking</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* CLINICAL / NON-CLINICAL SUMMARY MODAL */}
      {/* =================================================================== */}
      {slipModal.open && slipModal.app && (() => {
        const isNonClinical = isNonClinicalAppointment(slipModal.app);

        const enquiryTypeVal =
          slipModal.app.enquiryType ||
          slipModal.app.enquiry_type ||
          slipModal.app.clinicalSummary?.match(/Enquiry Type:\s*([^\n]+)/i)?.[1]?.trim() ||
          slipModal.app.chiefComplaint?.match(/\[(.*?)\]/)?.[1]?.trim() ||
          (slipModal.app.chiefComplaint?.includes("Non-Clinical:") ? slipModal.app.chiefComplaint.replace(/Non-Clinical:\s*/i, "").trim() : null) ||
          "Reimbursement";

        const chiefIssueVal =
          slipModal.app.chiefIssue ||
          slipModal.app.chief_issue ||
          slipModal.app.clinicalSummary?.match(/Chief Issue:\s*([^\n]+)/i)?.[1]?.trim() ||
          slipModal.app.chiefComplaint?.replace(/\[.*?\]\s*/, "")?.replace(/Non-Clinical:\s*/i, "")?.trim() ||
          slipModal.app.purpose?.replace(/\[.*?\]\s*/, "")?.trim() ||
          "General Enquiry";

        const remarksVal =
          slipModal.app.remarks ||
          slipModal.app.clinicalSummary?.match(/Remarks:\s*([^\n]+)/i)?.[1]?.trim() ||
          "";

        const { clinicalRecord, past3Calls } = parseClinicalDossier(slipModal.app);
        let rawCid = clinicalRecord?.callerId || slipModal.app.callerId || slipModal.app.caller_id;
        if (rawCid && (String(rawCid).startsWith("IP-") || String(rawCid).toLowerCase() === "n/a" || String(rawCid) === String(slipModal.app.ipNumber))) {
          rawCid = null;
        }
        const callerPhone = slipModal.app.phone || slipModal.app.patientPhone;
        const callerId = rawCid || (callerPhone ? getCallerIdForPhone(callerPhone) : null) || "CID0004A396";
        const complaints = (clinicalRecord?.chiefComplaints || (slipModal.app.chiefComplaint ? [slipModal.app.chiefComplaint] : (slipModal.app.purpose ? [slipModal.app.purpose] : ["Primary OPD Consultation"]))).slice(0, 1);
        const redFlags = Array.isArray(clinicalRecord?.redFlags) && clinicalRecord.redFlags.length > 0
          ? clinicalRecord.redFlags.filter((f: any) => !/none reported/i.test(String(f)))
          : (Array.isArray(slipModal.app.redFlags) ? slipModal.app.redFlags.filter((f: any) => !/none reported/i.test(String(f))) : []);

        const hpiDur = cleanValue(clinicalRecord?.hpiDuration);
        const assocSym = cleanValue(clinicalRecord?.associatedSymptoms);
        const comorb = cleanValue(clinicalRecord?.comorbidity);
        const meds = cleanValue(clinicalRecord?.medications);

        const patientNameClean = String(slipModal.app.patientName || "").trim().toLowerCase();
        const phoneClean = String(slipModal.app.phone || slipModal.app.patientPhone || "").trim();
        const ipClean = String(slipModal.app.ipNumber || "").trim().toLowerCase();

        const rawVisits = appointments.filter((a) => {
          if (!a) return false;
          if (a.status === "call_only" || a.hasAppointment === false) return false;
          const aPhone = String(a.phone || a.patientPhone || "").trim();
          const aName = String(a.patientName || "").trim().toLowerCase();
          const aIp = String(a.ipNumber || "").trim().toLowerCase();

          const matchPhone = phoneClean && aPhone && (aPhone === phoneClean || aPhone.includes(phoneClean) || phoneClean.includes(aPhone));
          const matchIp = ipClean && ipClean !== "n/a" && aIp === ipClean;
          const matchName = patientNameClean && aName && aName === patientNameClean;

          return matchPhone || matchIp || matchName;
        });

        // Deduplicate and ensure active appointment is present
        const seenVisitKeys = new Set();
        const dispensaryVisits: any[] = [];
        [slipModal.app, ...rawVisits].forEach((vis) => {
          if (!vis) return;
          const key = String(vis.tokenNo || vis.referenceNo || vis.id || "").trim();
          if (!key || seenVisitKeys.has(key)) return;
          seenVisitKeys.add(key);
          dispensaryVisits.push(vis);
        });

        // 1. Build unified "Past Calls & Visits":
        // Combines all booked dispensary visit encounters and helpline tele-triage calls into one single history list
        const appointmentEncounters = (dispensaryVisits || []).map((v, vIdx) => {
          const isVisitNonClin = isNonClinicalAppointment(v);
          const vStatus = (v.status || "scheduled").toLowerCase();
          const isCompleted = vStatus === "completed" || vStatus === "dispensed";
          const isCurrent = (v.tokenNo && v.tokenNo === slipModal.app.tokenNo) || (v.id && v.id === slipModal.app.id);

          return {
            ...v,
            id: v.id || v.tokenNo || `visit-${vIdx}`,
            tokenNo: v.tokenNo || v.referenceNo || null,
            case_ref: v.caseRef || v.case_ref || null,
            hasAppointment: true,
            status: vStatus,
            isCompleted,
            isCurrent,
            isNonClinical: isVisitNonClin,
            date: v.date || "2026-11-18",
            timeSlot: v.timeSlot || v.slot || "",
            facilityName: v.dispensaryName || v.facilityName || v.facility || "ESIS Dispensary, Amingaon",
            chiefComplaint: v.chiefComplaint || v.purpose || v.diagnosis || "General OPD Consultation",
            purpose: v.purpose || v.chiefComplaint || "",
            enquiryType: v.enquiryType || null,
            chiefIssue: v.chiefIssue || null,
            doctor: v.prescribedBy || v.doctor || v.doctorName || null,
            doctorName: v.doctorName || v.doctor || v.prescribedBy || null,
            doctorNotes: v.doctorNotes || v.prescriptionNotes || v.prescribedNotes || null,
            visitedNotes: v.visitedNotes || v.receptionNotes || null,
            receptionNotes: v.receptionNotes || v.visitedNotes || null,
            visitedBy: v.visitedBy || v.receptionCheckedInBy || null,
            receptionCheckedInBy: v.receptionCheckedInBy || v.visitedBy || null,
            dispensationNotes: v.dispensationNotes || v.dispensedNotes || v.pharmacyNotes || v.pharmacistNotes || null,
            dispensedBy: v.dispensedBy || v.pharmacistName || null,
            pharmacistName: v.pharmacistName || v.dispensedBy || null,
            diagnosis: v.diagnosis || null,
            redFlags: Array.isArray(v.redFlags) ? v.redFlags : [],
            createdAt: v.createdAt || v.bookedAt || v.date || "",
          };
        });

        // Track which tokens/caseRefs are already represented by appointments
        const bookedTokens = new Set(
          appointmentEncounters.map((a) => String(a.tokenNo || "").toUpperCase()).filter(Boolean)
        );
        const bookedCaseRefs = new Set(
          appointmentEncounters.map((a) => String(a.case_ref || "").toUpperCase()).filter(Boolean)
        );
        const matchNum = (s: any) => {
          const m = String(s || "").match(/(\d{3,5})/);
          return m ? parseInt(m[1], 10) : null;
        };
        const bookedNumbers = new Set(
          appointmentEncounters.map((a) => matchNum(a.tokenNo || a.case_ref || a.referenceNo || a.id)).filter(Boolean)
        );

        // Include any call-only encounters (calls made where no appointment was booked, e.g. CA0385AB01)
        const callsSource = modalLiveCalls.length > 0 ? modalLiveCalls : (past3Calls || []);
        const callOnlyEncounters = callsSource
          .filter((c: any) => {
            // Strictly exclude if this call already resulted in a booked appointment:
            if (c.has_appointment || c.booked_appointment || c.appointment_id || c.token || c.tokenNo) {
              return false;
            }
            const navStr = String(c.navigation || c.recommended_action || "").toLowerCase();
            if (navStr.includes("appointment booked at")) {
              return false;
            }

            const cRef = String(c.case_ref || c.id || "").toUpperCase().trim();
            if (cRef && (bookedCaseRefs.has(cRef) || bookedTokens.has(cRef))) {
              return false;
            }

            const cNum = matchNum(cRef);
            if (cNum && bookedNumbers.has(cNum)) {
              return false;
            }

            if (typeof window !== "undefined" && c.case_ref) {
              try {
                if (localStorage.getItem(`ekms_appt_${c.case_ref}`)) return false;
              } catch (_) {}
            }

            return true;
          })
          .map((c: any, cIdx: number) => {
            const isCallNonClin = isNonClinicalAppointment(c);
            return {
              id: c.id || `call-${cIdx}`,
              tokenNo: null,
              case_ref: c.case_ref || c.id || `CA038${cIdx + 1}AB01`,
              hasAppointment: false,
              status: "call_only",
              isCompleted: false,
              isCurrent: false,
              isNonClinical: isCallNonClin,
              date: c.formatted_date || formatHistoryDateTime(c.created_at) || "Recent call",
              timeSlot: "",
              facilityName: c.recommended_facility_type || "Tele-Triage Helpline Consultation",
              chiefComplaint: c.chief_complaint || c.reason || "Routine triage review",
              purpose: c.reason || c.chief_complaint || "",
              enquiryType: c.enquiry_type || c.enquiryType || null,
              chiefIssue: c.chief_issue || c.chiefIssue || null,
              doctor: null,
              doctorNotes: null,
              visitedNotes: null,
              dispensationNotes: null,
              createdAt: c.created_at || "",
            };
          });

        // Only actual dispensary visit appointments belong in the appointment record.
        // Unbooked calls stay strictly in the Triage Console Call History section.
        const unifiedHistory = [...appointmentEncounters];
        // Sort strictly newest visit & call on top:
        unifiedHistory.sort((a, b) => {
          const cA = typeof a.createdAt === "number" ? a.createdAt : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
          const cB = typeof b.createdAt === "number" ? b.createdAt : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
          if (cA && cB && Math.abs(cA - cB) > 1000) {
            return cB - cA;
          }
          const tokenNumA = parseInt(String(a.tokenNo || a.referenceNo || a.id || "").replace(/\D/g, ""), 10) || 0;
          const tokenNumB = parseInt(String(b.tokenNo || b.referenceNo || b.id || "").replace(/\D/g, ""), 10) || 0;
          if (tokenNumA && tokenNumB && tokenNumA !== tokenNumB) {
            return tokenNumB - tokenNumA;
          }
          const tA = new Date(a.doctorConsultedAt || a.visitedAt || a.bookedAt || a.date || a.createdAt || 0).getTime();
          const tB = new Date(b.doctorConsultedAt || b.visitedAt || b.bookedAt || b.date || b.createdAt || 0).getTime();
          return tB - tA;
        });

        return (
          <div
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 animate-in fade-in overflow-y-auto cursor-pointer"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSlipModal({ open: false, app: null });
            }}
          >
            <div
              className="bg-white rounded-3xl max-w-2xl w-full p-5 sm:p-7 space-y-5 shadow-2xl border border-slate-200 animate-in zoom-in-95 my-8 max-h-[92vh] overflow-y-auto text-slate-800 cursor-default"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${
                    isNonClinical
                      ? "bg-orange-50 text-orange-600 border-orange-200/80"
                      : "bg-blue-50 text-blue-600 border-blue-200/60"
                  }`}>
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className={`text-sm sm:text-base font-bold ${isNonClinical ? "text-orange-950" : "text-slate-900"}`}>
                      {isNonClinical ? "Non-Clinical Summary" : "Clinical Summary"}
                    </h3>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Beneficiary: <strong className="text-slate-800">{formatBeneficiaryName(slipModal.app.patientName)}</strong> {slipModal.app.ipNumber && slipModal.app.ipNumber !== "N/A" ? `• IP: ${formatBeneficiaryIp(slipModal.app.ipNumber)}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
                    isNonClinical
                      ? "text-orange-900 bg-orange-50 border-orange-200"
                      : "text-purple-900 bg-purple-50 border border-purple-200"
                  }`}>
                    Caller ID: <span className={`font-mono ${isNonClinical ? "text-orange-700" : "text-purple-700"}`}>{callerId}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSlipModal({ open: false, app: null })}
                    className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* 1. Clinical OR Non-Clinical Summary Section */}
              <div className="space-y-3 pt-1 text-left">
                <div className={`pb-1.5 border-b flex items-center justify-between ${
                  isNonClinical ? "border-orange-500/25" : "border-blue-500/25"
                }`}>
                  <h4 className={`text-base font-bold tracking-tight flex items-center gap-2 ${
                    isNonClinical ? "text-orange-800" : "text-blue-900"
                  }`}>
                    {isNonClinical ? (
                      <>
                        <FileText className="h-4 w-4 text-orange-600" />
                        <span>1. Non-Clinical Summary</span>
                      </>
                    ) : (
                      <>
                        <FileText className="h-4 w-4 text-blue-600" />
                        <span>1. Clinical Summary</span>
                      </>
                    )}
                  </h4>
                </div>

                {isNonClinical ? (
                  <ul className="space-y-2.5 text-xs">
                    <li className="space-y-1">
                      <span className="font-bold text-slate-800 block text-xs">• Enquiry Type:</span>
                      <p className="pl-4 text-xs sm:text-sm font-semibold text-slate-900">
                        {enquiryTypeVal}
                      </p>
                    </li>

                    <li className="space-y-1">
                      <span className="font-bold text-slate-800 block text-xs">• Chief Complaint / Issue:</span>
                      <p className="pl-4 text-xs sm:text-sm font-semibold text-slate-900 leading-relaxed">
                        {chiefIssueVal}
                      </p>
                    </li>

                    {remarksVal ? (
                      <li className="space-y-1">
                        <span className="font-bold text-slate-800 block text-xs">• Remarks / Action Taken:</span>
                        <p className="pl-4 text-xs sm:text-sm font-medium text-slate-800 leading-relaxed whitespace-pre-line">
                          {remarksVal}
                        </p>
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <ul className="space-y-2.5 text-xs">
                    <li className="space-y-1">
                      <span className="font-bold text-slate-800 block text-xs">• Chief Complaint:</span>
                      <div className="pl-4 space-y-1">
                        {complaints.map((comp: any, idx: number) => (
                          <p key={idx} className="text-xs sm:text-sm font-semibold text-slate-900 leading-relaxed">
                            {comp}
                          </p>
                        ))}
                      </div>
                    </li>

                    <li className="space-y-1">
                      <span className="font-bold text-slate-800 block text-xs">• Clinical Red Flags:</span>
                      <div className="pl-4">
                        {redFlags.length > 0 ? (
                          <div className="space-y-1">
                            {redFlags.map((flag: any, idx: number) => {
                              const val = typeof flag === "string" ? flag : flag.label || flag.name || String(flag);
                              return (
                                <p key={idx} className="text-xs sm:text-sm font-semibold text-slate-900 leading-relaxed">
                                  {val}
                                </p>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500 italic">None reported</p>
                        )}
                      </div>
                    </li>

                    <li className="flex items-baseline gap-2 pt-1">
                      <span className="font-bold text-slate-800 shrink-0">• History of Present Illness(from how long it happening):</span>
                      <span className="font-medium text-slate-900">{hpiDur}</span>
                    </li>

                    <li className="flex items-baseline gap-2">
                      <span className="font-bold text-slate-800 shrink-0">• Associated Symptoms:</span>
                      <span className="font-medium text-slate-900">{assocSym}</span>
                    </li>

                    <li className="flex items-baseline gap-2">
                      <span className="font-bold text-slate-800 shrink-0">• Comorbidity:</span>
                      <span className="font-medium text-slate-900">{comorb}</span>
                    </li>

                    <li className="flex items-baseline gap-2">
                      <span className="font-bold text-slate-800 shrink-0">• Any medication:</span>
                      <span className="font-medium text-slate-900">{meds}</span>
                    </li>
                  </ul>
                )}
              </div>

              {/* 2. Past Calls & Visits (Unified Timeline) */}
              <div className="space-y-3 pt-2 text-left">
                <div className={`pb-1.5 border-b flex items-center justify-between ${
                  isNonClinical ? "border-orange-500/25" : "border-blue-500/25"
                }`}>
                  <h4 className={`text-base font-bold tracking-tight flex items-center gap-2 ${
                    isNonClinical ? "text-orange-800" : "text-blue-900"
                  }`}>
                    <History className={`h-4 w-4 ${isNonClinical ? "text-orange-600" : "text-blue-600"}`} />
                    <span>2. Past Calls & Visits</span>
                  </h4>
                  <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold border shadow-2xs ${
                    isNonClinical
                      ? "bg-orange-50 border-orange-200 text-orange-800"
                      : "bg-blue-50 border-blue-200 text-blue-800"
                  }`}>
                    <span>Recorded History</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ml-1 ${
                      isNonClinical
                        ? "bg-orange-100 text-orange-900"
                        : "bg-blue-100 text-blue-900"
                    }`}>
                      {unifiedHistory.length}
                    </span>
                  </div>
                </div>

                {unifiedHistory.length > 0 ? (
                  <div className="space-y-3">
                    {unifiedHistory.map((item, idx) => {
                      const isItemNonClin = Boolean(
                        item.isNonClinical === true ||
                        item.callType === "non_clinical" ||
                        item.department === "Non-Clinical Visit" ||
                        item.appointmentType === "Non-Clinical Visit" ||
                        item.enquiryType ||
                        (item.chiefComplaint && (item.chiefComplaint.startsWith("[") || item.chiefComplaint.toLowerCase().includes("non-clinical:")))
                      );
                      const isDispensedItem = Boolean(
                        item.dispensedAt ||
                        item.dispensedBy ||
                        item.pharmacistName ||
                        item.status === "dispensed" ||
                        item.status === "completed" ||
                        Boolean(item.isCompleted)
                      );
                      const isCanc = item.status === "cancelled";
                      const isDoc = item.status === "prescribed" || item.status === "consulted" || item.status === "with doctor";
                      const isCallOnly = !item.hasAppointment || item.status === "call_only";

                      return (
                        <div
                          key={item.id || item.tokenNo || item.case_ref || idx}
                          className={`rounded-2xl border p-3.5 sm:p-4 space-y-2.5 shadow-2xs ${
                            isItemNonClin
                              ? "border-orange-200/80 bg-orange-50/20"
                              : "border-blue-200/80 bg-blue-50/25"
                          }`}
                        >
                          {/* Line 1: History 1 + Token/Ref + CLINICAL/NON-CLINICAL + Current + Status */}
                          <div className={`flex flex-wrap items-center justify-between gap-2 border-b pb-2 ${
                            isItemNonClin ? "border-orange-200/50" : "border-blue-200/50"
                          }`}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-extrabold text-xs sm:text-sm text-slate-900">
                                History {idx + 1}
                              </span>

                              {(item.tokenNo || item.case_ref) && (
                                <span className={`px-2 py-0.5 rounded border text-[11px] font-mono font-bold ${
                                  isItemNonClin
                                    ? "bg-orange-50 border-orange-200 text-orange-800"
                                    : "bg-slate-50 border-slate-200 text-slate-700"
                                }`}>
                                  {item.tokenNo ? `Token: ${item.tokenNo}` : `Ref: ${item.case_ref || `#HIST-${idx + 1}`}`}
                                </span>
                              )}

                              {/* Clinical / Non-Clinical Badge with Icons */}
                              {isItemNonClin ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-orange-100 text-orange-900 border border-orange-300">
                                  <FileText className="w-3 h-3 text-orange-700" />
                                  <span>NON-CLINICAL</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-900 border border-blue-300">
                                  <Stethoscope className="w-3 h-3 text-blue-700" />
                                  <span>CLINICAL</span>
                                </span>
                              )}

                              {/* Current Badge */}
                              {item.isCurrent && (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-600 text-white border border-blue-700 shadow-xs ring-2 ring-blue-500/20">
                                  CURRENT
                                </span>
                              )}

                              {/* Status Badge */}
                              {isCallOnly ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-purple-50 text-purple-800 border border-purple-300 shadow-2xs">
                                  <PhoneCall className="w-3 h-3 text-purple-600" />
                                  <span>CALL ONLY</span>
                                </span>
                              ) : isDispensedItem ? (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300">
                                  VISITED
                                </span>
                              ) : isCanc ? (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-100 text-rose-800 border border-rose-300">
                                  CANCELLED
                                </span>
                              ) : isDoc ? (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-sky-100 text-sky-800 border border-sky-300">
                                  WITH DOCTOR
                                </span>
                              ) : (
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                                  isItemNonClin
                                    ? "bg-orange-100 text-orange-800 border-orange-300"
                                    : "bg-amber-100 text-amber-800 border-amber-300"
                                }`}>
                                  SCHEDULED
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Line 2: Date, Time & Dispensary Name / Facility */}
                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 font-medium">
                            <span className="flex items-center gap-1.5 text-slate-700">
                              <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>{item.date}{item.timeSlot ? ` • ${item.timeSlot}` : ""}</span>
                            </span>
                            {item.facilityName && (
                              <span className={`inline-flex items-center gap-1 font-bold ${
                                isItemNonClin ? "text-orange-950" : "text-blue-950"
                              }`}>
                                {item.hasAppointment ? (
                                  <Building2 className={`w-3.5 h-3.5 shrink-0 ${isItemNonClin ? "text-orange-600" : "text-blue-600"}`} />
                                ) : (
                                  <Phone className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                                )}
                                <span>{item.facilityName}</span>
                              </span>
                            )}
                          </div>

                          {/* Line 3: Enquiry Type / Issue OR Chief Complaint & Doctor */}
                          <div className="pt-0.5 text-xs">
                            {isItemNonClin ? (
                              <div className="flex flex-wrap items-baseline gap-1.5">
                                <span className="font-bold text-slate-800">• Enquiry Type / Issue:</span>
                                <span className="font-semibold text-slate-900">
                                  {item.purpose || item.chiefComplaint || (item.enquiryType ? `[${item.enquiryType}] ${item.chiefIssue || ""}`.trim() : "Non-Clinical Enquiry")}
                                </span>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-baseline gap-1.5">
                                  <span className="font-bold text-slate-800">• Chief Complaint:</span>
                                  <span className="font-semibold text-slate-900">
                                    {String(item.chiefComplaint || item.purpose || "General OPD Consultation").split(/[\n,;]|\s*\+\s*/)[0].trim()}
                                  </span>
                                  {Boolean(item.isCompleted || isDispensedItem || isDoc) && (item.doctorName || item.doctor || item.prescribedBy) && (
                                    <span className="text-[11px] font-medium text-slate-500 italic">
                                      (Consulted by {getDoctorName(item.doctorName || item.doctor || item.prescribedBy)}{item.consultationType ? ` (${item.consultationType})` : ""})
                                    </span>
                                  )}
                                </div>
                                {item.diagnosis && item.diagnosis !== (item.chiefComplaint || item.purpose) && (
                                  <div className="flex flex-wrap items-baseline gap-1.5">
                                    <span className="font-bold text-slate-800">• Clinical Diagnosis:</span>
                                    <span className="font-semibold text-slate-900">{item.diagnosis}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Notes Block: Reception Note, Doctor Advice, Pharmacist Note */}
                          {Boolean(
                            item.visitedNotes ||
                            item.receptionNotes ||
                            (!isItemNonClin && (
                              item.doctorNotes ||
                              item.dispensationNotes ||
                              item.dispensedNotes ||
                              item.pharmacyNotes ||
                              item.pharmacistNotes ||
                              item.dispensedBy
                            ))
                          ) && (
                            <div className="space-y-1 pt-1.5 border-t border-slate-100/90 text-xs">
                              {/* 1. Reception Note */}
                              {(item.visitedNotes || item.receptionNotes) && (
                                <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
                                  <span className="font-bold text-slate-800">• Reception Note:</span>
                                  <span className="text-slate-700 italic">
                                    {(item.visitedNotes || item.receptionNotes).trim()}
                                  </span>
                                  {(item.receptionCheckedInBy || item.visitedBy) && (
                                    <span className="text-[11px] font-semibold text-slate-500 not-italic">
                                      (by {getStaffName(item.receptionCheckedInBy || item.visitedBy)}{formatStaffTimestamp(item.receptionCheckedInAt || item.visitedAt) ? ` ${formatStaffTimestamp(item.receptionCheckedInAt || item.visitedAt)}` : ""})
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* 2. Doctor Advice (Clinical only) */}
                              {!isItemNonClin && item.doctorNotes && (
                                <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
                                  <span className="font-bold text-slate-800">• Doctor Advice:</span>
                                  <span className="text-slate-700 italic">
                                    {item.doctorNotes.trim()}
                                  </span>
                                  {(item.doctorName || item.doctor || item.prescribedBy) && (
                                    <span className="text-[11px] font-semibold text-slate-500 not-italic">
                                      (by {getDoctorName(item.doctorName || item.doctor || item.prescribedBy)}{item.consultationType ? ` (${item.consultationType})` : ""}{formatStaffTimestamp(item.doctorConsultedAt) ? ` , ${formatStaffTimestamp(item.doctorConsultedAt)}` : ""})
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* 3. Pharmacist Note (Clinical only: only rendered after doctor consultation/prescription) */}
                              {!isItemNonClin && Boolean(item.doctorName || item.doctor || item.prescribedBy || item.doctorConsultedAt || item.doctorNotes) && (item.dispensationNotes || item.dispensedNotes || item.pharmacyNotes || item.pharmacistNotes || item.dispensedBy) && (
                                <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
                                  {Boolean((item.dispensationNotes || item.dispensedNotes || item.pharmacyNotes || item.pharmacistNotes)?.trim()) ? (
                                    <>
                                      <span className="font-bold text-slate-800">• Pharmacist Note:</span>
                                      <span className="text-slate-700 italic">
                                        {(item.dispensationNotes || item.dispensedNotes || item.pharmacyNotes || item.pharmacistNotes).trim()}
                                      </span>
                                      {(item.dispensedBy || item.pharmacistName) && (
                                        <span className="text-[11px] font-semibold text-slate-500 not-italic">
                                          (by {getStaffName(item.dispensedBy || item.pharmacistName)}{formatStaffTimestamp(item.dispensedAt) ? ` , ${formatStaffTimestamp(item.dispensedAt)}` : ""})
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    (item.dispensedBy || item.pharmacistName) && (
                                      <>
                                        <span className="font-bold text-slate-800">• Dispensed by</span>
                                        <span className="font-semibold text-slate-800">
                                          {getStaffName(item.dispensedBy || item.pharmacistName)}
                                        </span>
                                        {formatStaffTimestamp(item.dispensedAt) && (
                                          <span className="font-normal text-slate-500">
                                            , {formatStaffTimestamp(item.dispensedAt)}
                                          </span>
                                        )}
                                      </>
                                    )
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-xs text-slate-500 flex items-center gap-2">
                    <Info className="h-4 w-4 text-slate-400 shrink-0" />
                    <span>No previous consultation history recorded for this caller (First recorded visit).</span>
                  </div>
                )}
              </div>

              {/* Agent Notes / Doctor Instructions */}
              {(slipModal.app.notes || slipModal.app.agentNotes) && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5 text-left text-xs space-y-1">
                  <span className="font-bold text-slate-800 uppercase tracking-wider text-[10.5px] block">
                    Agent Visit Notes / Doctor Instructions:
                  </span>
                  <p className="text-slate-700 italic leading-relaxed pl-1">
                    {slipModal.app.notes || slipModal.app.agentNotes}
                  </p>
                </div>
              )}

              {/* Modal Footer (Close Button Only) */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSlipModal({ open: false, app: null })}
                  className="px-6 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-xl transition border border-slate-200 cursor-pointer shadow-2xs"
                >
                  Close
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* =================================================================== */}
      {/* BENEFICIARY FOLLOW-UP MODAL */}
      {/* =================================================================== */}
      {followUpModal.open && followUpModal.app && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && !followUpSaving) {
              setFollowUpModal({ open: false, app: null, message: "" });
            }
          }}
        >
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200 animate-in zoom-in-95 my-8">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
                  <PhoneCall className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    Beneficiary Follow-up
                    {followUpModal.app.followUpStatus === "closed" ? (
                      <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                        Case Closed
                      </span>
                    ) : followUpModal.app.followUpStatus === "pending" && followUpModal.app.followUpAt ? (
                      <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-orange-100 text-orange-900 border border-orange-300">
                        Follow-up: {followUpModal.app.followUpAt}
                      </span>
                    ) : null}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFollowUpModal({ open: false, app: null, message: "" })}
                disabled={followUpSaving}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Previous Follow-up History (if any) - Most recent at the top, scrollable after 4-5 items */}
            {Array.isArray(followUpModal.app.followUpHistory) && followUpModal.app.followUpHistory.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    Previous Follow-up History ({followUpModal.app.followUpHistory.length})
                  </label>
                  {followUpModal.app.followUpHistory.length > 4 && (
                    <span className="text-[10px] text-slate-400">Scroll to view more</span>
                  )}
                </div>
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1 overscroll-contain">
                  {[...followUpModal.app.followUpHistory].reverse().map((item, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-slate-800">
                          {item.action === "closed" ? `Case closed by ${item.agent || "Agent"}` : `Follow up by ${item.agent || "Agent"}`}
                        </span>
                        <span className="text-slate-400">{item.formattedAt}</span>
                      </div>
                      <p className="text-slate-700 italic">"{item.message}"</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Follow-up Message Textarea (Mandatory) */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                Follow-up Message / Call Notes <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={4}
                required
                value={followUpModal.message}
                onChange={(e) => setFollowUpModal((prev) => ({ ...prev, message: e.target.value }))}
                placeholder="Enter follow-up call response, beneficiary status, or clinical remarks (Mandatory)..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition resize-none"
              />
            </div>

            {/* Modal Actions Footer: Left = Green "Close the case" + optional Reset, Right = Blue "Next followup needed" */}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
              <div className="flex items-center gap-2">
                {/* Left Button: Green - Close the case */}
                <button
                  type="button"
                  onClick={() => handleSaveFollowUp("close")}
                  disabled={!followUpModal.message.trim() || followUpSaving}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
                  title={!followUpModal.message.trim() ? "Write a message first to enable" : "Mark follow-up as closed"}
                >
                  {followUpSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>Close the case</span>
                </button>

                {/* Reset / Clear Follow-up Button (visible ONLY for Admins when follow-up was previously logged or closed) */}
                {isAdmin && (followUpModal.app.followUpStatus === "closed" || (Array.isArray(followUpModal.app.followUpHistory) && followUpModal.app.followUpHistory.length > 0)) && (
                  <button
                    type="button"
                    onClick={handleResetFollowUp}
                    disabled={followUpSaving}
                    className="px-3 py-2 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition cursor-pointer"
                    title="Admin only: Reset follow-up and revert button back to initial Follow-up state"
                  >
                    Reset Follow-up
                  </button>
                )}
              </div>

              {/* Right Button: Blue - Next followup needed */}
              <button
                type="button"
                onClick={() => handleSaveFollowUp("next")}
                disabled={!followUpModal.message.trim() || followUpSaving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
                title={!followUpModal.message.trim() ? "Write a message first to enable" : "Schedule next follow-up with current timestamp"}
              >
                {followUpSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
                <span>Next followup needed</span>
              </button>
            </div>
          </div>
        </div>
      )}


      {/* =================================================================== */}
      {/* BULK DELETE CONFIRMATION MODAL */}
      {/* =================================================================== */}
      {bulkDeleteModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-rose-200 animate-in zoom-in-95">
            <div className="flex items-center gap-3 text-rose-600 border-b border-rose-100 pb-3">
              <div className="w-10 h-10 bg-rose-50 rounded-2xl flex items-center justify-center shrink-0 border border-rose-100">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Bulk Permanent Delete</h3>
                <p className="text-xs text-rose-600 font-semibold">{selectedIds.size} appointments selected</p>
              </div>
            </div>

            <div className="bg-rose-50/70 border border-rose-200/80 rounded-2xl p-4 text-xs space-y-2 text-rose-950">
              <div className="font-bold flex items-center gap-1.5 text-rose-800">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Permanent &amp; Irreversible Deletion</span>
              </div>
              <p className="text-rose-800/90 leading-relaxed">
                You are about to permanently delete and cancel <strong>{selectedIds.size}</strong> selected appointment(s).
              </p>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-rose-700 pt-1">
                <li>Permanently deleted from <strong>ekmsbooking</strong> database</li>
                <li>Permanently deleted from <strong>Triage</strong> database</li>
                <li>Instant real-time update in Reception &amp; Doctor desks</li>
                <li>Cancelled &amp; purged from EKMS Portal</li>
              </ul>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBulkDeleteModalOpen(false)}
                disabled={bulkDeleting}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                Keep Appointments
              </button>
              <button
                type="button"
                onClick={handleConfirmBulkDelete}
                disabled={bulkDeleting}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {bulkDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting {selectedIds.size}...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirm Delete ({selectedIds.size})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SINGLE PERMANENT DELETE CONFIRMATION MODAL */}
      {/* =================================================================== */}
      {singleDeleteModal.open && singleDeleteModal.app && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-rose-200 animate-in zoom-in-95">
            <div className="flex items-center gap-3 text-rose-600 border-b border-rose-100 pb-3">
              <div className="w-10 h-10 bg-rose-50 rounded-2xl flex items-center justify-center shrink-0 border border-rose-100">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Delete Appointment Permanently</h3>
                <p className="text-xs text-slate-500 font-mono">
                  Token: {singleDeleteModal.app.tokenNo || singleDeleteModal.app.referenceNo}
                </p>
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 text-xs space-y-1">
              <div className="font-bold text-slate-900">
                Beneficiary: {singleDeleteModal.app.patientName} ({singleDeleteModal.app.phone || singleDeleteModal.app.patientPhone || "No phone"})
              </div>
              <div className="text-slate-600">
                Facility: {singleDeleteModal.app.dispensaryName || singleDeleteModal.app.facilityName}
              </div>
              <div className="text-slate-600">
                Schedule: {singleDeleteModal.app.date} ({singleDeleteModal.app.timeSlot})
              </div>
            </div>

            <div className="bg-rose-50/70 border border-rose-200/80 rounded-2xl p-3 text-xs text-rose-900 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-rose-700">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Confirm Permanent Removal</span>
              </div>
              <p className="text-[11px] text-rose-800 leading-relaxed">
                This will cancel and permanently remove the appointment from both databases and all staff views.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSingleDeleteModal({ open: false, app: null })}
                disabled={actionLoading}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSinglePermanentDelete}
                disabled={actionLoading}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Permanently</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          SLOT AVAILABILITY MODAL (BEAUTIFUL POPUP WITH ALL 60 SLOTS)
          Outside click / Escape closes the popup
      ───────────────────────────────────────────────────────────── */}
      {showSlotModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => {
            setShowSlotModal(false);
            setSelectedSlotDetail(null);
          }}
        >
          <div
            className="w-full max-w-4xl bg-card rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="border-b border-border/80 bg-secondary/30 px-5 sm:px-6 py-3.5 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-xs shrink-0">
                  <CalendarClock className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-bold text-foreground">
                      OPD Slot Availability Overview
                    </h2>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {OPERATING_HOURS_LABEL}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowSlotModal(false);
                  setSelectedSlotDetail(null);
                }}
                className="h-8 w-8 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition cursor-pointer"
                title="Close (Esc)"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable Content Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
              {/* Controls Row: Facility Selector & Date Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3.5 rounded-xl bg-secondary/30 border border-border/70">
                {/* Facility Selector */}
                <div className="sm:col-span-7 space-y-1">
                  <label className="text-[11px] font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Select Dispensary / Facility</span>
                  </label>
                  <div className="relative">
                    <select
                      value={activeSlotModalFacility}
                      onChange={(e) => {
                        setSlotModalFacility(e.target.value);
                        setSelectedSlotDetail(null);
                      }}
                      className="w-full h-9 rounded-lg border border-border bg-card px-3 pr-8 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition cursor-pointer appearance-none"
                    >
                      <option value="All Facilities">All Facilities (Combined)</option>
                      {enabledFacilities.map((f) => (
                        <option key={f.name || f.id} value={f.name}>
                          {f.name}
                        </option>
                      ))}
                      {enabledFacilities.length === 0 && (
                        <option value="ESIS Dispensary, Amingaon">ESIS Dispensary, Amingaon</option>
                      )}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  </div>
                </div>

                {/* Date Selector & Quick Pills */}
                <div className="sm:col-span-5 space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Date</span>
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSlotModalDate(getYesterdayDateString());
                          setSelectedSlotDetail(null);
                        }}
                        className={`text-[10px] px-2 py-0.5 rounded font-bold transition cursor-pointer border ${
                          slotModalDate === getYesterdayDateString()
                            ? "bg-purple-600 text-white border-purple-600 shadow-2xs"
                            : "bg-card hover:bg-secondary text-foreground border-border"
                        }`}
                        title="View yesterday's bookings and slots"
                      >
                        Yesterday
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSlotModalDate(getTodayDateString());
                          setSelectedSlotDetail(null);
                        }}
                        className={`text-[10px] px-2 py-0.5 rounded font-bold transition cursor-pointer border ${
                          slotModalDate === getTodayDateString()
                            ? "bg-emerald-600 text-white border-emerald-600 shadow-2xs"
                            : "bg-card hover:bg-secondary text-foreground border-border"
                        }`}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSlotModalDate(getTomorrowDateString());
                          setSelectedSlotDetail(null);
                        }}
                        className={`text-[10px] px-2 py-0.5 rounded font-bold transition cursor-pointer border ${
                          slotModalDate === getTomorrowDateString()
                            ? "bg-emerald-600 text-white border-emerald-600 shadow-2xs"
                            : "bg-card hover:bg-secondary text-foreground border-border"
                        }`}
                      >
                        Tomorrow
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSlotModalDate(getNextWorkingDateString(slotModalDate));
                          setSelectedSlotDetail(null);
                        }}
                        className="text-[10px] px-2 py-0.5 rounded font-bold transition cursor-pointer border bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                        title="Skip weekend/holidays to next working day"
                      >
                        Next Day
                      </button>
                    </div>
                  </div>
                  <input
                    type="date"
                    value={slotModalDate}
                    onClick={(e) => {
                      try {
                        (e.target as any).showPicker?.();
                      } catch (err: any) {}
                    }}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) {
                        setSlotModalDate(val);
                      }
                      setSelectedSlotDetail(null);
                    }}
                    className="w-full h-9 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition cursor-pointer"
                  />
                </div>
              </div>

              {/* Status Summary Count Badges (No Lunch Break) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                      Total Slots
                    </span>
                    <span className="text-base font-extrabold text-foreground">
                      {slotModalStats.total}
                    </span>
                  </div>
                  <Clock className="w-4 h-4 text-slate-400" />
                </div>

                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 block">
                      Available
                    </span>
                    <span className="text-base font-extrabold text-emerald-700 dark:text-emerald-300">
                      {slotModalStats.available}
                    </span>
                  </div>
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-2xs" />
                </div>

                <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 block">
                      Booked
                    </span>
                    <span className="text-base font-extrabold text-rose-700 dark:text-rose-300">
                      {slotModalStats.booked}
                    </span>
                  </div>
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-2xs" />
                </div>

                <div className="p-2.5 rounded-xl bg-slate-100/70 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                      Past / Closed
                    </span>
                    <span className="text-base font-extrabold text-slate-500 dark:text-slate-400">
                      {slotModalStats.past}
                    </span>
                  </div>
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-400 shadow-2xs" />
                </div>
              </div>

              {/* Conditional Notices: Past Date History vs 1st/3rd/5th Saturday vs Weekend Closed vs All Slots Past Today */}
              {slotModalDate < getTodayDateString() ? (
                <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-300 dark:border-purple-800 text-purple-900 dark:text-purple-200 text-xs flex items-center justify-between gap-3 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-purple-600 shrink-0" />
                    <span>
                      <strong>Past Date Record ({slotModalDate}):</strong> Showing completed and booked slots history. Total <strong>{slotModalStats.booked}</strong> booking{slotModalStats.booked === 1 ? "" : "s"} were registered for this day.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSlotModalDate(getTodayDateString());
                      setSelectedSlotDetail(null);
                    }}
                    className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-bold rounded-lg cursor-pointer shrink-0 transition"
                  >
                    Return to Today
                  </button>
                </div>
              ) : slotModalStats.satInfo?.isSaturday && slotModalStats.satInfo?.isOpen ? (
                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-300 dark:border-blue-800 text-blue-900 dark:text-blue-200 text-xs flex items-center justify-between gap-3 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-blue-600 shrink-0" />
                    <span>
                      <strong>Saturday:</strong> Dispensary operates from 10:00 AM to 04:00 PM today.
                    </span>
                  </div>
                </div>
              ) : slotModalStats.isWeekend ? (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs flex items-center justify-between gap-3 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                    <span>Dispensaries are closed on Sunday. Mon–Sat: 10:00 AM – 04:00 PM.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSlotModalDate(getNextWorkingDateString(slotModalDate));
                      setSelectedSlotDetail(null);
                    }}
                    className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold rounded-lg cursor-pointer shrink-0 transition"
                  >
                    View Next Working Day
                  </button>
                </div>
              ) : slotModalDate === getTodayDateString() && areAllSlotsPastToday() ? (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-3 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>All consultation hours for today have closed. You can inspect tomorrow or next working day.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSlotModalDate(getNextWorkingDateString(getTodayDateString()));
                      setSelectedSlotDetail(null);
                    }}
                    className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold rounded-lg cursor-pointer shrink-0 transition"
                  >
                    View Next Working Day
                  </button>
                </div>
              ) : null}

              {/* Slot Schedule Grid Header */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <span>Day Schedule ({ALL_OPD_TIME_SLOTS.length} Slots · 5-Min Intervals)</span>
                </span>
                <span className="text-[10.5px] text-muted-foreground">
                  Click any booked slot to inspect patient and token details
                </span>
              </div>

              {/* All Slots Grid (NO INSIDE SCROLLBAR - smoothly fits inside modal body) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 border border-border/60 rounded-2xl p-2.5 bg-slate-50/50 dark:bg-slate-900/30">
                {ALL_OPD_TIME_SLOTS.map((slot) => {
                  const isWeekend = slotModalStats.isWeekend;
                  const booking = findSlotBooking(slot, slotModalDate, activeSlotModalFacility, appointments);
                  const isReserved = Boolean(booking);
                  const isPast = !isReserved && isSlotInPast(slot, slotModalDate);

                  const isDetailActive = selectedSlotDetail && booking && (selectedSlotDetail.id === booking.id || selectedSlotDetail.tokenNo === booking.tokenNo);

                  return (
                    <div
                      key={slot}
                      onClick={() => {
                        if (booking) {
                          setSelectedSlotDetail(isDetailActive ? null : booking);
                        }
                      }}
                      className={`rounded-xl p-2 text-center border flex flex-col items-center justify-center gap-1 transition ${
                        isReserved
                          ? `bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 cursor-pointer hover:bg-rose-100 shadow-2xs ${
                              isDetailActive ? "ring-2 ring-rose-500 dark:ring-rose-400 border-rose-500 scale-[1.02]" : ""
                            }`
                          : isWeekend
                          ? "bg-slate-100 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-400 select-none opacity-60"
                          : isPast
                          ? "bg-slate-100/70 dark:bg-slate-900/50 border-slate-200/80 dark:border-slate-800/60 text-slate-400 line-through select-none"
                          : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 font-semibold shadow-2xs"
                      }`}
                    >
                      <span className={`text-[10px] font-mono font-bold leading-tight ${isPast ? "line-through text-slate-400" : "text-foreground"}`}>
                        {slot}
                      </span>
                      {isReserved ? (
                        <div className="w-full flex flex-col items-center gap-0.5">
                          <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-rose-200/70 dark:bg-rose-900/70 text-rose-800 dark:text-rose-200">
                            Booked
                          </span>
                          {booking && (
                            <div className="w-full truncate px-0.5 pt-0.5 border-t border-rose-200/80 dark:border-rose-900/60">
                              <p className="text-[9.5px] font-mono font-bold text-rose-700 dark:text-rose-300 truncate">
                                {booking.tokenNo || booking.referenceNo}
                              </p>
                              <p className="text-[9px] font-medium text-slate-700 dark:text-slate-300 truncate">
                                {booking.patientName || booking.callerName || "Patient"}
                              </p>
                            </div>
                          )}
                        </div>
                      ) : isWeekend ? (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          Closed
                        </span>
                      ) : isPast ? (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                          Past
                        </span>
                      ) : (
                        <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-200/70 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                          Available
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Selected Slot Booking Details Drawer */}
              {selectedSlotDetail && (
                <div className="p-3.5 rounded-2xl bg-rose-50/80 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 animate-in fade-in slide-in-from-bottom-2 duration-150">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-extrabold px-2 py-0.5 rounded-md bg-rose-600 text-white">
                          {selectedSlotDetail.tokenNo || selectedSlotDetail.referenceNo}
                        </span>
                        <span className="text-xs font-bold text-foreground">
                          {selectedSlotDetail.patientName || selectedSlotDetail.callerName}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          ({selectedSlotDetail.age || "—"} yrs, {selectedSlotDetail.gender || selectedSlotDetail.sex || "—"})
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-secondary text-foreground uppercase border border-border">
                          {selectedSlotDetail.status || "Scheduled"}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs pt-1 text-slate-700 dark:text-slate-300">
                        <div>
                          <span className="font-semibold text-muted-foreground">Time Slot:</span>{" "}
                          <span className="font-mono font-bold text-foreground">{selectedSlotDetail.timeSlot || selectedSlotDetail.slot}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-muted-foreground">Phone:</span>{" "}
                          <span className="font-mono text-foreground">{selectedSlotDetail.phone || "—"}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-muted-foreground">Agent:</span>{" "}
                          <span className="font-bold text-foreground">{selectedSlotDetail.agentName || "Ekms Agent"}</span>
                        </div>
                      </div>
                      {selectedSlotDetail.chiefComplaint && (
                        <p className="text-xs text-slate-800 dark:text-slate-200 pt-0.5">
                          <span className="font-semibold text-muted-foreground">Chief Complaint / Issue:</span>{" "}
                          {selectedSlotDetail.chiefComplaint}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedSlotDetail(null)}
                      className="p-1 rounded-lg hover:bg-rose-200/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 transition cursor-pointer"
                      title="Close slot details"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t border-border/80 bg-secondary/30 px-5 sm:px-6 py-3 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Real-time synchronized with OPD booking appointments and roster.</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowSlotModal(false);
                  setSelectedSlotDetail(null);
                }}
                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-foreground text-xs font-bold rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
