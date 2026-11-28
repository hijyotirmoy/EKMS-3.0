"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  where,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { db, bookingDb } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { Facility } from "@/lib/types";
import { getOrFetchCollection } from "@/lib/cache";
import { logUserActivity } from "@/lib/activityLogger";
import { getCachedAppointments, setCachedAppointments } from "@/lib/clientCache";
import { syncAppointmentUpdateToSheet } from "@/lib/googleSheetsSync";
import {
  CalendarClock,
  CalendarCheck,
  Search,
  Calendar,
  Clock,
  Building2,
  Phone,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Trash2,
  X,
  FileText,
  Stethoscope,
  Activity,
  UserCheck,
  Pill,
  PackageCheck,
} from "lucide-react";
import { ClinicalSummaryModal } from "@/components/appointments/ClinicalSummaryModal";
import { CancelAppointmentModal } from "@/components/appointments/CancelAppointmentModal";
import { DoctorAvailabilityModal } from "@/components/appointments/DoctorAvailabilityModal";
import { isDoctorUser } from "@/lib/doctorAvailability";
import { useStaffDirectory } from "@/lib/useStaffDirectory";
import { extractIpNumber, isNonClinicalAppointment, formatStaffTimestamp, getEffectiveAppointmentStage } from "@/lib/appointmentTypes";
import { deleteAppointmentFromTriageApi } from "@/lib/triageSync";
import { maskDispensaryIpNumber, maskDispensaryMobile, isDispensaryStaffAccount } from "@/lib/maskUtils";

export interface AppointmentRecord {
  id: string;
  tokenNo: string;
  referenceNo: string;
  ipName: string;
  ipNumber: string;
  phone: string;
  age?: string;
  gender?: string;
  dispensaryName: string;
  dispensaryId?: string;
  location?: string;
  district?: string;
  date: string;
  timeSlot: string;
  department?: string;
  purpose: string;
  chiefComplaint?: string;
  notes?: string;
  status: "scheduled" | "visited" | "completed" | "cancelled" | "with_doctor" | "pharmacy_queue";
  bookedByEmail: string;
  bookedByName: string;
  bookedAt?: string;
  createdAt: number;
  visitedAt?: number;
  visitedBy?: string;
  visitedNotes?: string;
  receptionCheckedInAt?: number;
  receptionCheckedInBy?: string;
  doctorConsultedAt?: number;
  doctorName?: string;
  doctorEmail?: string;
  consultationType?: string;
  diagnosis?: string;
  doctorNotes?: string;
  prescriptions?: Array<{
    medicineName: string;
    dosage?: string;
    frequency?: string;
    duration?: string;
  }>;
  dispensedAt?: number | string;
  dispensedBy?: string;
  dispensationNotes?: string;
  vitals?: {
    bp?: string;
    pulse?: string;
    temp?: string;
  };
  cancellationReason?: string;
  updatedAt?: number;
  source?: string;
  clinicalSummary?: string;
  clinicalRecord?: any;
  clinicalOverview?: any;
  redFlags?: any[];
  callerId?: string;
  pastCallHistory?: any[];
  past3Calls?: any[];
  enquiryType?: string;
  chiefIssue?: string;
  callType?: string;
  isNonClinical?: boolean;
  hpiDuration?: string;
  associatedSymptoms?: string;
  comorbidity?: string;
  medications?: string;
}

function normalizeDispensaryName(str?: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/^esis\s+/i, "")
    .replace(/^esic\s+/i, "")
    .replace(/\bdispensary\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
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

function isDispensaryMatch(dispA: string, dispB: string, idA?: string, idB?: string): boolean {
  if (!dispA || !dispB) return false;
  if (dispA.toLowerCase().trim() === dispB.toLowerCase().trim()) return true;
  if (idA && idB && idA.trim() === idB.trim()) return true;
  const normA = normalizeDispensaryName(dispA);
  const normB = normalizeDispensaryName(dispB);
  if (normA && normB && (normA === normB || normA.includes(normB) || normB.includes(normA))) {
    return true;
  }
  return false;
}

function formatCancellationReason(reason?: string): string {
  if (!reason) return "";
  return reason
    .replace(/cancelled in ekms triage/gi, "Cancelled in Source")
    .replace(/cancelled via triage/gi, "Cancelled in Source")
    .replace(/ekms triage/gi, "Source")
    .replace(/triage/gi, "Source");
}

const ITEMS_PER_PAGE = 30;

export default function AppointmentPage() {
  const { user, userProfile } = useAuth();
  const { toast, showConfirm } = usePopup();
  const { getStaffName, getDoctorName } = useStaffDirectory();

  const userRole = (userProfile?.role || "Agent").trim();
  const isAdmin =
    userRole === "Master Admin" ||
    userRole === "Admin" ||
    userRole === "Super Admin" ||
    Boolean(userProfile?.role?.toLowerCase().includes("admin"));

  const [appointments, setAppointments] = useState<AppointmentRecord[]>(() => {
    if (typeof window !== "undefined") {
      return getCachedAppointments() || [];
    }
    return [];
  });
  const [dispensaries, setDispensaries] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "reception" | "doctor" | "pharmacy" | "completed" | "cancelled"
  >("all");
  const [dateFilter, setDateFilter] = useState(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }); // Present date (today) by default
  const [currentPage, setCurrentPage] = useState(1);

  // Sync date filter with mini-bar icons
  useEffect(() => {
    document.title = "Dispensary Appointments";
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ekms-date-filter-change", { detail: dateFilter }));
    }
  }, [dateFilter]);

  // Details Modal
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [activeAppointment, setActiveAppointment] = useState<AppointmentRecord | null>(null);

  // Cancel Modal State
  const [cancelModalApp, setCancelModalApp] = useState<AppointmentRecord | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [doctorAvailabilityOpen, setDoctorAvailabilityOpen] = useState(false);

  const todayStr = useMemo(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, []);

  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, []);

  const isDispensaryStaff = isDispensaryStaffAccount(userProfile);

  const staffDispensaryName = (userProfile as any)?.dispensaryName || "";

  // 1. Fetch appointments & dispensaries
  useEffect(() => {
    let isMounted = true;

    const q = query(
      collection(bookingDb, "dispensary_appointments"),
      orderBy("createdAt", "desc"),
      limit(250)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        if (!isMounted) return;
        const list: AppointmentRecord[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          list.push({
            id: docSnap.id,
            tokenNo: data.tokenNo || docSnap.id,
            referenceNo: data.referenceNo || data.tokenNo || docSnap.id,
            ipName: data.ipName || data.patientName || "Beneficiary",
            ipNumber: extractIpNumber(data),
            phone: data.phone || "",
            age: data.age || "",
            gender: data.gender || "Male",
            dispensaryName: data.dispensaryName || "",
            dispensaryId: data.dispensaryId || "",
            location: data.location || "",
            district: data.district || "",
            date: data.date || "",
            timeSlot: data.timeSlot || "",
            department: data.department || "General Medicine / Primary Care OPD",
            purpose: data.purpose || "General OPD Consultation",
            chiefComplaint: data.chiefComplaint || data.purpose || "",
            notes: data.notes || "",
            status: data.status || "scheduled",
            bookedByEmail: data.bookedByEmail || "",
            bookedByName: data.bookedByName || "",
            bookedAt: data.bookedAt || "",
            createdAt: data.createdAt || 0,
            visitedAt: data.visitedAt,
            visitedBy: data.visitedBy,
            visitedNotes: data.visitedNotes,
            receptionCheckedInAt: data.receptionCheckedInAt,
            receptionCheckedInBy: data.receptionCheckedInBy,
            doctorConsultedAt: data.doctorConsultedAt,
            doctorName: data.doctorName,
            doctorEmail: data.doctorEmail,
            consultationType: data.consultationType,
            diagnosis: data.diagnosis,
            doctorNotes: data.doctorNotes,
            prescriptions: data.prescriptions || [],
            dispensedAt: data.dispensedAt,
            dispensedBy: data.dispensedBy,
            dispensationNotes: data.dispensationNotes,
            vitals: data.vitals,
            cancellationReason: data.cancellationReason,
            updatedAt: data.updatedAt,
            source: data.source,
            clinicalSummary: data.clinicalSummary,
            clinicalRecord: data.clinicalRecord,
            clinicalOverview: data.clinicalOverview,
            redFlags: Array.isArray(data.redFlags) ? data.redFlags : (Array.isArray(data.clinicalRecord?.redFlags) ? data.clinicalRecord.redFlags : []),
            callerId: data.callerId || data.caller_id || data.clinicalRecord?.callerId || "",
            pastCallHistory: data.pastCallHistory || [],
            past3Calls: data.past3Calls || [],
            enquiryType: data.enquiryType,
            chiefIssue: data.chiefIssue,
            callType: data.callType,
            isNonClinical: data.isNonClinical,
            hpiDuration: data.hpiDuration || data.clinicalRecord?.hpiDuration || "",
            associatedSymptoms: data.associatedSymptoms || data.clinicalRecord?.associatedSymptoms || "",
            comorbidity: data.comorbidity || data.clinicalRecord?.comorbidity || "",
            medications: data.medications || data.clinicalRecord?.medications || "",
          });
        });
        const map = new Map<string, AppointmentRecord>();
        list.forEach((item) => {
          map.set(item.id || item.tokenNo, item);
        });
        if (list.length >= 60) {
          const oldestTime = list.reduce((min, a) => Math.min(min, Number(a.createdAt) || Infinity), Infinity);
          getCachedAppointments().forEach((prev: any) => {
            const key = prev.id || prev.tokenNo;
            if (!map.has(key) && (Number(prev.createdAt) || 0) < oldestTime) {
              map.set(key, prev);
            }
          });
        }
        const mergedList = Array.from(map.values());
        setAppointments(mergedList);
        setCachedAppointments(mergedList);
        setLoading(false);
      },
      (err) => {
        console.warn("Dispensary appointments sync warning:", err);
        setLoading(false);
      }
    );

    const loadDispensaries = async () => {
      try {
        const allFacilities = await getOrFetchCollection<Facility>("facilities");
        const dispOnly = allFacilities.filter((f) => {
          const typeLower = (f.type || "").toLowerCase();
          const nameLower = (f.name || "").toLowerCase();
          if (typeLower.includes("hospital") || nameLower.includes("hospital")) return false;
          if (typeLower.includes("office") || nameLower.includes("office")) return false;
          return typeLower.includes("dispensary") || nameLower.includes("dispensary");
        });
        if (isMounted) {
          setDispensaries(dispOnly.slice(0, 150));
        }
      } catch (e) {
        console.warn("Dispensaries load error:", e);
      }
    };

    loadDispensaries();

    return () => {
      isMounted = false;
      unsub();
    };
  }, []);

  // Scoped Appointments: Dispensary Staff can ONLY see appointments of their assigned dispensary
  const scopedAppointments = useMemo(() => {
    if (isDispensaryStaff) {
      if (!staffDispensaryName) return [];
      const staffDispId = (userProfile?.dispensaryId || "").trim();
      return appointments.filter((app) => {
        return isDispensaryMatch(app.dispensaryName, staffDispensaryName, app.dispensaryId, staffDispId);
      });
    }
    return appointments;
  }, [appointments, isDispensaryStaff, staffDispensaryName, userProfile?.dispensaryId]);

  // Date Scoped Appointments (filtered by dateFilter, or all if empty)
  const dateScopedAppointments = useMemo(() => {
    return scopedAppointments.filter((app) => {
      const targetDate = dateFilter === "today" ? todayStr : dateFilter;
      if (targetDate && app.date !== targetDate) return false;
      return true;
    });
  }, [scopedAppointments, dateFilter, todayStr]);

  // Filtered Appointments (filtered by search and status)
  const filteredAppointments = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();

    return dateScopedAppointments.filter((app) => {
      // Search filter
      if (q) {
        const matchToken = (app.tokenNo || "").toLowerCase().includes(q);
        const matchName = (app.ipName || "").toLowerCase().includes(q);
        const matchIp = (app.ipNumber || "").toLowerCase().includes(q);
        const matchPhone = (app.phone || "").includes(q);
        const matchDisp = (app.dispensaryName || "").toLowerCase().includes(q);
        const matchBooker = (app.bookedByName || "").toLowerCase().includes(q);
        const matchComplaint = (app.chiefComplaint || app.purpose || "").toLowerCase().includes(q);

        if (!matchToken && !matchName && !matchIp && !matchPhone && !matchDisp && !matchBooker && !matchComplaint) {
          return false;
        }
      }

      // Status filter
      if (statusFilter !== "all") {
        const stage = getEffectiveAppointmentStage(app);
        if (statusFilter === "reception") {
          if (stage !== "scheduled") return false;
        } else if (statusFilter === "doctor") {
          if (stage !== "with_doctor") return false;
        } else if (statusFilter === "pharmacy") {
          if (stage !== "with_pharmacist") return false;
        } else if (statusFilter === "completed") {
          if (stage !== "completed") return false;
        } else if (statusFilter === "cancelled") {
          if (stage !== "cancelled") return false;
        }
      }
      return true;
    });
  }, [dateScopedAppointments, statusFilter, searchTerm]);

  // Reset pagination on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, dateFilter]);

  // Metrics: Strictly reflects the selected date using real lifecycle stages
  const metrics = useMemo(() => {
    const list = dateScopedAppointments;
    const total = list.length;
    let pendingReception = 0;
    let pendingDoctor = 0;
    let pendingPharmacy = 0;
    let completed = 0;
    let cancelled = 0;

    list.forEach((a) => {
      const stage = getEffectiveAppointmentStage(a);
      if (stage === "scheduled") pendingReception++;
      else if (stage === "with_doctor") pendingDoctor++;
      else if (stage === "with_pharmacist") pendingPharmacy++;
      else if (stage === "completed") completed++;
      else if (stage === "cancelled") cancelled++;
    });

    return {
      total,
      pendingReception,
      pendingDoctor,
      pendingPharmacy,
      completed,
      cancelled,
    };
  }, [dateScopedAppointments]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredAppointments.length / ITEMS_PER_PAGE) || 1;
  const paginatedAppointments = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAppointments.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAppointments, currentPage]);

  // Handle Cancellation (Strictly Administrator Only)
  const handleConfirmCancel = async (reason: string) => {
    if (!isAdmin) {
      toast.error("Permission denied: Only administrators can cancel appointment bookings.");
      setCancelModalApp(null);
      return;
    }
    if (!cancelModalApp) return;
    setCancelling(true);
    const finalReason = reason.trim() || "Cancelled by staff/beneficiary request";

    try {
      await setDoc(
        doc(bookingDb, "dispensary_appointments", cancelModalApp.id),
        { status: "cancelled", cancellationReason: finalReason },
        { merge: true }
      );
      // Automatically sync cancellation to Google Sheets
      syncAppointmentUpdateToSheet(
        cancelModalApp,
        { status: "cancelled", cancellationReason: finalReason },
        user?.displayName || "Administrator"
      ).catch((e) => console.warn("Google Sheet cancellation sync notice:", e));
      toast.info(`Appointment ${cancelModalApp.tokenNo} cancelled.`);
      logUserActivity(user?.email, {
        desc: `Cancelled appointment ${cancelModalApp.tokenNo} for ${cancelModalApp.ipName}. Reason: ${finalReason}`,
        type: "edit",
      });
      setCancelModalApp(null);
    } catch (e: any) {
      toast.error("Failed to cancel appointment.");
    } finally {
      setCancelling(false);
    }
  };

  // Helper to ensure an appointment is completely purged from all databases (EKMS + Triage)
  const deleteAppointmentFromAllDatabases = async (app: AppointmentRecord) => {
    // 0. Instantly notify Triage tab and local EKMS state with 0 ms latency
    try {
      const delPayload = {
        tokenNo: app.tokenNo,
        referenceNo: app.referenceNo,
        tokens: [app.tokenNo, app.referenceNo].filter(Boolean),
        id: app.id,
        ids: [app.id].filter(Boolean),
        timestamp: Date.now(),
      };
      localStorage.setItem("ekms_deleted_appointment", JSON.stringify(delPayload));
      if (typeof window !== "undefined" && typeof (window as any).BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("ekms_triage_sync_v1");
        channel.postMessage({ type: "APPOINTMENT_DELETED", payload: delPayload });
      }
    } catch (_) {}

    setAppointments((prev) =>
      prev.filter((a) => a.id !== app.id && (!app.tokenNo || a.tokenNo !== app.tokenNo))
    );

    const promises: Promise<any>[] = [];

    if (app.id) {
      promises.push(deleteDoc(doc(bookingDb, "dispensary_appointments", app.id)).catch(() => {}));
      promises.push(deleteDoc(doc(db, "dispensary_appointments", app.id)).catch(() => {}));
      promises.push(deleteDoc(doc(db, "appointments", app.id)).catch(() => {}));
      promises.push(deleteDoc(doc(bookingDb, "appointments", app.id)).catch(() => {}));
    }

    const identifiers = [app.tokenNo, app.referenceNo, app.id].filter(Boolean) as string[];
    for (const ident of identifiers) {
      promises.push(
        getDocs(query(collection(bookingDb, "dispensary_appointments"), where("tokenNo", "==", ident)))
          .then((snap) => Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {}))))
          .catch(() => {})
      );
      promises.push(
        getDocs(query(collection(bookingDb, "dispensary_appointments"), where("referenceNo", "==", ident)))
          .then((snap) => Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {}))))
          .catch(() => {})
      );
      promises.push(
        getDocs(query(collection(db, "dispensary_appointments"), where("tokenNo", "==", ident)))
          .then((snap) => Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {}))))
          .catch(() => {})
      );
      promises.push(
        getDocs(query(collection(db, "dispensary_appointments"), where("referenceNo", "==", ident)))
          .then((snap) => Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {}))))
          .catch(() => {})
      );
    }

    // Call Triage API to purge from Triage database
    promises.push(
      deleteAppointmentFromTriageApi({
        id: app.id,
        tokenNo: app.tokenNo,
        referenceNo: app.referenceNo,
      }).catch((e) => console.warn("Triage API appointment delete notice:", e))
    );

    await Promise.all(promises);
  };

  // Permanent Delete Single Appointment (Strictly Administrator Only)
  const handleDeleteAppointment = async (app: AppointmentRecord) => {
    if (!isAdmin) {
      toast.error("Permission denied: Only administrators can permanently delete appointment bookings.");
      return;
    }

    const confirmed = await showConfirm({
      title: `Permanently Delete ${app.tokenNo}?`,
      message: `Are you sure you want to permanently delete appointment ${app.tokenNo} for ${app.ipName}? This will remove it from both EKMS and Triage databases. This action cannot be undone.`,
      isDestructive: true,
      confirmText: "Delete Record",
    });
    if (!confirmed) return;

    try {
      await deleteAppointmentFromAllDatabases(app);
      toast.success(`Appointment ${app.tokenNo} deleted from all databases.`);
      logUserActivity(user?.email, {
        desc: `Deleted appointment record ${app.tokenNo} from all databases`,
        type: "delete",
      });
    } catch (e: any) {
      toast.error("Failed to delete appointment record.");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dispensary Appointments</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Top Search Bar */}
          <div className="relative min-w-[260px] sm:min-w-[320px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search token, IP name, IP no, phone, complaint..."
              className="w-full pl-9 pr-8 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder:text-slate-400 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 shadow-2xs"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Date Filters: All, Today, Tomorrow, Custom Picker */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl text-xs font-bold gap-1 shadow-2xs">
              <button
                type="button"
                onClick={() => setDateFilter("")}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  !dateFilter
                    ? "bg-white text-teal-700 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setDateFilter(todayStr)}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  dateFilter === todayStr
                    ? "bg-white text-teal-700 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setDateFilter(tomorrowStr)}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  dateFilter === tomorrowStr
                    ? "bg-white text-teal-700 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Tomorrow
              </button>
            </div>

            {/* Custom Date Input */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-semibold shrink-0 transition-all shadow-2xs ${
                dateFilter && dateFilter !== todayStr && dateFilter !== tomorrowStr
                  ? "bg-teal-50 border-teal-300 text-teal-900 ring-2 ring-teal-500/10"
                  : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-teal-600 shrink-0" />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="bg-transparent text-xs text-slate-700 font-bold outline-none cursor-pointer"
                title="Pick specific date"
              />
            </div>

            {/* Doctor Availability Button (Doctor & Admin Only) */}
            {(isAdmin || isDoctorUser(userProfile)) && (
              <button
                type="button"
                onClick={() => setDoctorAvailabilityOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-teal-50 border border-teal-200 text-teal-800 hover:text-teal-900 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer active:scale-95 group"
                title="Doctor Availability & Leave Schedule"
              >
                <CalendarCheck className="w-3.5 h-3.5 text-teal-600 group-hover:scale-110 transition-transform" />
                <span>Doctor Availability</span>
              </button>
            )}
          </div>

          {isDispensaryStaff && staffDispensaryName && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-50 border border-teal-200/90 text-teal-900 text-xs font-semibold shadow-2xs">
              <Building2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
              <strong className="text-slate-800 font-bold">{staffDispensaryName}</strong>
            </div>
          )}
        </div>
      </div>

      {/* 2. Top Metric Filter Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3 select-none">
        {/* Card 1: Total Bookings */}
        <button
          type="button"
          onClick={() => setStatusFilter("all")}
          className={`bg-white border rounded-2xl p-3 sm:p-3.5 shadow-2xs flex items-center justify-between text-left cursor-pointer transition-all ${
            statusFilter === "all"
              ? "border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/20 shadow-xs"
              : "border-slate-200/80 hover:border-slate-300"
          }`}
          title="Show All Bookings"
        >
          <div className="min-w-0 pr-1">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">Total Bookings</div>
            <div className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">{metrics.total}</div>
          </div>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
            <Calendar className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </button>

        {/* Card 2: Pending with Receptionist */}
        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === "reception" ? "all" : "reception")}
          className={`bg-white border rounded-2xl p-3 sm:p-3.5 shadow-2xs flex items-center justify-between text-left cursor-pointer transition-all ${
            statusFilter === "reception"
              ? "border-sky-500 ring-2 ring-sky-500/20 bg-sky-50/20 shadow-xs"
              : "border-slate-200/80 hover:border-slate-300"
          }`}
          title="Filter: Pending with Receptionist (Scheduled / Arrival Queue)"
        >
          <div className="min-w-0 pr-1">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">Pending with Receptionist</div>
            <div className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">{metrics.pendingReception}</div>
          </div>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-600 shrink-0">
            <UserCheck className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </button>

        {/* Card 3: Pending with Doctor */}
        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === "doctor" ? "all" : "doctor")}
          className={`bg-white border rounded-2xl p-3 sm:p-3.5 shadow-2xs flex items-center justify-between text-left cursor-pointer transition-all ${
            statusFilter === "doctor"
              ? "border-teal-500 ring-2 ring-teal-500/20 bg-teal-50/20 shadow-xs"
              : "border-slate-200/80 hover:border-slate-300"
          }`}
          title="Filter: Pending with Doctor (Consultation Queue)"
        >
          <div className="min-w-0 pr-1">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">Pending with Doctor</div>
            <div className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">{metrics.pendingDoctor}</div>
          </div>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600 shrink-0">
            <Stethoscope className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </button>

        {/* Card 4: Pending with Pharmacist */}
        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === "pharmacy" ? "all" : "pharmacy")}
          className={`bg-white border rounded-2xl p-3 sm:p-3.5 shadow-2xs flex items-center justify-between text-left cursor-pointer transition-all ${
            statusFilter === "pharmacy"
              ? "border-amber-500 ring-2 ring-amber-500/20 bg-amber-50/20 shadow-xs"
              : "border-slate-200/80 hover:border-slate-300"
          }`}
          title="Filter: Pending with Pharmacist (Dispensation Queue)"
        >
          <div className="min-w-0 pr-1">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">Pending with Pharmacist</div>
            <div className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">{metrics.pendingPharmacy}</div>
          </div>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
            <Pill className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </button>

        {/* Card 5: Completed Visits */}
        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === "completed" ? "all" : "completed")}
          className={`bg-white border rounded-2xl p-3 sm:p-3.5 shadow-2xs flex items-center justify-between text-left cursor-pointer transition-all ${
            statusFilter === "completed"
              ? "border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-50/20 shadow-xs"
              : "border-slate-200/80 hover:border-slate-300"
          }`}
          title="Filter: Completed Visits"
        >
          <div className="min-w-0 pr-1">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">Completed Visits</div>
            <div className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">{metrics.completed}</div>
          </div>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
            <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </button>

        {/* Card 6: Cancelled / No-Show */}
        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === "cancelled" ? "all" : "cancelled")}
          className={`bg-white border rounded-2xl p-3 sm:p-3.5 shadow-2xs flex items-center justify-between text-left cursor-pointer transition-all ${
            statusFilter === "cancelled"
              ? "border-rose-500 ring-2 ring-rose-500/20 bg-rose-50/20 shadow-xs"
              : "border-slate-200/80 hover:border-slate-300"
          }`}
          title="Filter: Cancelled / No-Show"
        >
          <div className="min-w-0 pr-1">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">Cancelled / No-Show</div>
            <div className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">{metrics.cancelled}</div>
          </div>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0">
            <XCircle className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </button>
      </div>

      {/* 3. Appointments List */}
      <div className="space-y-3">
        {loading ? (
          <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center text-slate-500 text-xs font-semibold">
            Loading appointments and OPD queues...
          </div>
        ) : filteredAppointments.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-3">
            <CalendarClock className="w-12 h-12 text-slate-300 mx-auto" />
            <div className="text-base font-bold text-slate-700">No appointments found</div>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {isDispensaryStaff
                ? "No appointments booked for your allotted dispensary matching your current filter."
                : "No appointments matching your current search or date filter."}
            </p>
          </div>
        ) : (
          paginatedAppointments.map((app) => {
            const stage = getEffectiveAppointmentStage(app);
            const isVisited = stage === "with_doctor" || stage === "with_pharmacist" || stage === "completed";
            const isCancelled = stage === "cancelled";

            return (
              <div
                key={app.id}
                className={`bg-white border rounded-2xl p-4 sm:p-5 transition-all shadow-2xs hover:shadow-xs border-l-4 ${
                  stage === "completed"
                    ? "border-slate-200 border-l-emerald-500"
                    : stage === "with_pharmacist"
                    ? "border-slate-200 border-l-purple-500"
                    : stage === "with_doctor"
                    ? "border-slate-200 border-l-blue-400"
                    : isCancelled
                    ? "border-rose-200/70 border-l-rose-400 bg-slate-50/30"
                    : "border-slate-200 border-l-amber-400"
                }`}
              >
                {/* 1. Top Header Row: Left has Clean Token, Dispensary, Booking; Right has Clinical summary, Status, Cancel (Top Alignment!) */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Clean Plain Text Token (No grey button box, no copy icon, no copy function) */}
                    <span className="font-mono font-extrabold text-xs text-slate-800 select-all">
                      {app.tokenNo}
                    </span>

                    {/* Beautiful Dispensary Name Badge */}
                    {app.dispensaryName && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-teal-50 text-teal-800 border border-teal-200/90 rounded-lg text-xs font-bold shadow-2xs">
                        <Building2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        <span>{app.dispensaryName}</span>
                      </span>
                    )}

                    {/* OPD Slot Time */}
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 bg-slate-100 border border-slate-200/80 rounded px-2 py-0.5">
                      <Calendar className="w-3 h-3 text-blue-600" />
                      <span>Slot: {app.date} • {app.timeSlot}</span>
                    </span>
                  </div>

                  {/* Top-Right Alignment: Clinical summary + Status Badge + Cancel */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveAppointment(app as any);
                        setDetailsModalOpen(true);
                      }}
                      className={`px-2.5 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95 border ${
                        isNonClinicalAppointment(app)
                          ? "text-orange-700 hover:bg-orange-50 border-orange-300 bg-white"
                          : "text-blue-700 hover:bg-blue-50 border border-blue-200 bg-blue-50/40"
                      }`}
                      title={isNonClinicalAppointment(app) ? "View Non-Clinical Summary" : "View Clinical Summary"}
                    >
                      <FileText className={`w-3.5 h-3.5 ${isNonClinicalAppointment(app) ? "text-orange-600" : "text-blue-600"}`} />
                      <span>{isNonClinicalAppointment(app) ? "Non-Clinical Summary" : "Clinical summary"}</span>
                    </button>

                    {stage === "completed" ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold uppercase bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>VISITED</span>
                      </span>
                    ) : stage === "with_pharmacist" ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold uppercase bg-purple-50 text-purple-800 border border-purple-300 shadow-2xs">
                        <Pill className="w-3.5 h-3.5 text-purple-600" />
                        <span>WITH PHARMACIST</span>
                      </span>
                    ) : stage === "with_doctor" ? (
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
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold uppercase bg-amber-50 text-amber-900 border border-amber-300 shadow-2xs">
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        <span>SCHEDULED</span>
                      </span>
                    )}

                    {/* Cancel button: Strictly Administrator Only (Dispensary staff cannot cancel bookings) */}
                    {isAdmin && !isVisited && !isCancelled && (
                      <button
                        type="button"
                        onClick={() => setCancelModalApp(app)}
                        className="px-2.5 py-1 text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold transition flex items-center gap-1 shadow-2xs cursor-pointer active:scale-95"
                        title="Cancel appointment"
                      >
                        <XCircle className="w-3.5 h-3.5 text-slate-500" />
                        <span>Cancel</span>
                      </button>
                    )}

                    {/* Delete button: Strictly Administrator Only (Dispensary staff cannot delete bookings) */}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleDeleteAppointment(app)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 rounded-xl transition cursor-pointer active:scale-95"
                        title="Permanently delete booking from both databases"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* 2. Patient Body & Clean Plain Text Audit Lines */}
                <div className="pt-2.5 space-y-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="text-base font-extrabold text-slate-900">{app.ipName}</h3>
                    {app.age && <span className="text-xs text-slate-500">({app.age} yrs, {app.gender})</span>}
                    <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-semibold">
                      IP: {isDispensaryStaff ? maskDispensaryIpNumber(app.ipNumber) : (app.ipNumber || "N/A")}
                    </span>
                    {app.phone && (
                      <span className="text-xs text-slate-600 flex items-center gap-1 font-medium">
                        <Phone className="w-3 h-3 text-slate-400" />
                        <span>{isDispensaryStaff ? maskDispensaryMobile(app.phone) : app.phone}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 font-medium pt-0.5">
                    {isNonClinicalAppointment(app) ? (
                      <>
                        <span className="text-orange-600 font-bold">↗ Enquiry Type:</span>
                        <strong className="text-slate-900 font-bold">{app.purpose || app.chiefComplaint}</strong>
                      </>
                    ) : (
                      <>
                        <Activity className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                        <span>Chief Complaint: <strong className="text-slate-900 font-bold">{app.purpose || app.chiefComplaint || "General Health Check"}</strong></span>
                      </>
                    )}
                  </div>

                  {/* Audit Lines: Clean Plain Text (No Boxes) */}
                  <div className="text-xs text-slate-700 space-y-1 pt-0.5">
                    {/* Receptionist */}
                    {(app.receptionCheckedInBy || app.visitedBy) && (
                      <div className="flex flex-wrap items-center gap-1">
                        <UserCheck className="w-3.5 h-3.5 text-blue-600 inline shrink-0" />
                        <span className="font-semibold text-slate-800">
                          Reception by {getStaffName(app.receptionCheckedInBy || app.visitedBy)}
                        </span>
                        {formatStaffTimestamp(app.receptionCheckedInAt || app.visitedAt || (app.status !== "scheduled" ? (app.updatedAt || app.createdAt) : null)) && (
                          <span className="font-normal text-slate-500">
                            , {formatStaffTimestamp(app.receptionCheckedInAt || app.visitedAt || (app.status !== "scheduled" ? (app.updatedAt || app.createdAt) : null))}
                          </span>
                        )}
                        {(app.visitedNotes || (app as any).receptionNotes) && (app.visitedNotes || (app as any).receptionNotes).trim() && (
                          <span className="text-slate-500 font-normal pl-1">
                            • Note: {(app.visitedNotes || (app as any).receptionNotes).trim()}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Doctor */}
                    {(app.doctorName || app.doctorNotes) && (
                      <div className="flex flex-wrap items-center gap-1">
                        <Stethoscope className="w-3.5 h-3.5 text-indigo-600 inline shrink-0" />
                        <span className="font-semibold text-slate-800">
                          Prescribed by {getDoctorName(app.doctorName)}
                          {app.consultationType && (
                            <span className="text-blue-700 font-bold"> ({app.consultationType})</span>
                          )}
                        </span>
                        {formatStaffTimestamp(app.doctorConsultedAt || (app.status === "pharmacy_queue" || app.status === "completed" ? app.updatedAt : null)) && (
                          <span className="font-normal text-slate-500">
                            , {formatStaffTimestamp(app.doctorConsultedAt || (app.status === "pharmacy_queue" || app.status === "completed" ? app.updatedAt : null))}
                          </span>
                        )}
                        {app.doctorNotes && app.doctorNotes.trim() && (
                          <span className="text-slate-500 font-normal pl-1">
                            • Note: {app.doctorNotes}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Pharmacist */}
                    {app.dispensedBy && (
                      <div className="flex flex-wrap items-center gap-1">
                        <PackageCheck className="w-3.5 h-3.5 text-teal-600 inline shrink-0" />
                        <span className="font-semibold text-slate-800">
                          Dispensed by {getStaffName(app.dispensedBy)}
                        </span>
                        {formatStaffTimestamp(app.dispensedAt || (app.status === "completed" ? app.updatedAt : null)) && (
                          <span className="font-normal text-slate-500">
                            , {formatStaffTimestamp(app.dispensedAt || (app.status === "completed" ? app.updatedAt : null))}
                          </span>
                        )}
                        {app.dispensationNotes && app.dispensationNotes.trim() && (
                          <span className="text-slate-500 font-normal pl-1">
                            • Note: {app.dispensationNotes}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Cancel Note/Reason Display */}
                  {isCancelled && (
                    <div className="text-xs text-rose-600 font-medium flex items-center gap-1.5 pt-0.5">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      <span>Reason for Cancellation: {formatCancellationReason(app.cancellationReason) || "Cancelled by staff/beneficiary request"}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 4. Pagination (after 30 items) */}
      {filteredAppointments.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200 text-xs">
          <div className="text-slate-500 font-medium">
            Showing <strong className="text-slate-800 font-bold">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</strong> to{" "}
            <strong className="text-slate-800 font-bold">
              {Math.min(currentPage * ITEMS_PER_PAGE, filteredAppointments.length)}
            </strong>{" "}
            of <strong className="text-slate-800 font-bold">{filteredAppointments.length}</strong> appointments
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs transition"
            >
              Previous
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
              .map((pageNum, idx, arr) => {
                const showEllipsis = idx > 0 && pageNum - arr[idx - 1] > 1;
                return (
                  <React.Fragment key={pageNum}>
                    {showEllipsis && <span className="px-1 text-slate-400">...</span>}
                    <button
                      type="button"
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-8 h-8 rounded-xl font-bold transition flex items-center justify-center cursor-pointer shadow-2xs ${
                        currentPage === pageNum
                          ? "bg-teal-600 text-white shadow-xs"
                          : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {pageNum}
                    </button>
                  </React.Fragment>
                );
              })}

            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs transition"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Details & Clinical Summary Modal */}
      <ClinicalSummaryModal
        isOpen={detailsModalOpen}
        onClose={() => {
          setDetailsModalOpen(false);
          setActiveAppointment(null);
        }}
        appointment={activeAppointment as any}
      />

      {/* Cancel Appointment Modal with optional reason */}
      <CancelAppointmentModal
        isOpen={Boolean(cancelModalApp)}
        onClose={() => setCancelModalApp(null)}
        onConfirm={handleConfirmCancel}
        tokenNo={cancelModalApp?.tokenNo || ""}
        patientName={cancelModalApp?.ipName || ""}
        loading={cancelling}
      />

      {/* Doctor Availability Management Modal */}
      <DoctorAvailabilityModal
        isOpen={doctorAvailabilityOpen}
        onClose={() => setDoctorAvailabilityOpen(false)}
      />
    </div>
  );
}
