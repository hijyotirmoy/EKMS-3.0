"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { db, bookingDb } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { Facility, UserProfile } from "@/lib/types";
import { getOrFetchCollection } from "@/lib/cache";
import { logUserActivity } from "@/lib/activityLogger";
import { createDispensaryNotification } from "@/lib/notificationService";
import {
  CalendarClock,
  CalendarCheck,
  Plus,
  Search,
  Calendar,
  Clock,
  MapPin,
  Building2,
  Phone,
  User,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ChevronRight,
  Filter,
  X,
  Copy,
  Check,
  FileText,
  Stethoscope,
  ShieldCheck,
  Share2,
  Printer,
  Activity,
  HeartPulse,
  UserCheck,
  RotateCcw,
  Pill,
} from "lucide-react";
import { ClinicalSummaryModal } from "@/components/appointments/ClinicalSummaryModal";

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
  source?: string;
}

function formatDateTime(val: any): string {
  if (!val) return "N/A";
  try {
    const d = typeof val === "number" ? new Date(val) : new Date(String(val));
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

const COMMON_CHIEF_COMPLAINTS = [
  "Fever & Chills",
  "Cough, Cold & Flu",
  "Diabetes Regular Follow-Up",
  "Hypertension / Blood Pressure Check",
  "Joint & Body Pain",
  "Routine OPD Consultation",
  "Medication Refill",
  "Skin Rash / Allergy",
];

const OPD_TIME_SLOTS = [
  "10:00 AM - 11:00 AM (Morning OPD)",
  "11:00 AM - 12:00 PM (Morning OPD)",
  "12:00 PM - 01:00 PM (Mid-day OPD)",
  "02:00 PM - 03:00 PM (Afternoon OPD)",
  "03:00 PM - 04:00 PM (Evening OPD)",
];

function normalizeDispensaryName(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/\besis\b/g, "")
    .replace(/\besic\b/g, "")
    .replace(/\bdispensary\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function isDispensaryMatch(dispA: string, dispB: string, idA?: string, idB?: string): boolean {
  if (idA && idB && idA === idB) return true;
  if (!dispA || !dispB) return false;
  const cleanA = dispA.toLowerCase().trim();
  const cleanB = dispB.toLowerCase().trim();
  if (cleanA === cleanB || cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;
  const normA = normalizeDispensaryName(dispA);
  const normB = normalizeDispensaryName(dispB);
  if (normA && normB && (normA === normB || normA.includes(normB) || normB.includes(normA))) return true;
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

export default function AppointmentPage() {
  const { user, userProfile, isLoggedIn, openLoginModal } = useAuth();
  const { toast, showConfirm } = usePopup();

  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [dispensaries, setDispensaries] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "scheduled" | "visited" | "cancelled">("all");
  const [dateFilter, setDateFilter] = useState(""); // Default to show all dates in Dispensary Appointments
  const [dispensaryFilter, setDispensaryFilter] = useState("all");

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

  // Booking Modal State
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Mark Visited Modal State
  const [visitModalOpen, setVisitModalOpen] = useState(false);
  const [activeAppointment, setActiveAppointment] = useState<AppointmentRecord | null>(null);
  const [visitNotes, setVisitNotes] = useState("");
  const [vitalBp, setVitalBp] = useState("");
  const [vitalPulse, setVitalPulse] = useState("");
  const [vitalTemp, setVitalTemp] = useState("");
  const [markingVisited, setMarkingVisited] = useState(false);

  // Details Modal
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);

  // Booking Form Fields
  const [ipName, setIpName] = useState("");
  const [ipNumber, setIpNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("Male");
  const [selectedDispensary, setSelectedDispensary] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [timeSlot, setTimeSlot] = useState(OPD_TIME_SLOTS[0]);
  const [purpose, setPurpose] = useState("Fever & Chills");
  const [notes, setNotes] = useState("");

  const userRole = (userProfile?.role || "Agent").trim();
  const isDispensaryStaff =
    userRole === "Dispensary Staff" ||
    userRole === "Dispensary" ||
    (userProfile as any)?.dispensaryName ||
    (userProfile as any)?.dispensaryId;

  const staffDispensaryName = (userProfile as any)?.dispensaryName || "";

  // 1. Fetch appointments & dispensaries
  useEffect(() => {
    let isMounted = true;

    // Live sync from ekmsbooking database with query limit for minimum Firestore reads
    const q = query(
      collection(bookingDb, "dispensary_appointments"),
      orderBy("createdAt", "desc"),
      limit(150)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: AppointmentRecord[] = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({
            ...data,
            id: d.id,
            tokenNo: data.tokenNo || d.id,
            referenceNo: data.referenceNo || data.tokenNo || d.id,
            ipName: data.ipName || data.patientName || "Insured Person",
            ipNumber: data.ipNumber || data.esicNumber || "N/A",
            phone: data.phone || data.patientPhone || "",
            age: data.age || data.patientAge || "",
            gender: data.gender || data.patientSex || "Male",
            dispensaryName: data.dispensaryName || data.facilityName || "ESIS Dispensary",
            dispensaryId: data.dispensaryId || "",
            location: data.location || data.patientAddress || "",
            district: data.district || data.facilityDistrict || "",
            date: data.date || "",
            timeSlot: data.timeSlot || "10:00 AM - 11:00 AM",
            department: data.department || "General Medicine / Primary Care OPD",
            purpose: data.purpose || data.chiefComplaint || "General Health Check",
            chiefComplaint: data.chiefComplaint || data.purpose || "",
            notes: data.notes || data.agentNotes || "",
            status: data.status || "scheduled",
            bookedByEmail: data.bookedByEmail || "",
            bookedByName: data.bookedByName || "Staff",
            bookedAt: data.bookedAt || "",
            createdAt: data.createdAt || Date.now(),
            visitedAt: data.visitedAt,
            visitedBy: data.visitedBy,
            visitedNotes: data.visitedNotes || data.doctorNotes,
            vitals: data.vitals,
            cancellationReason: data.cancellationReason,
          } as any);
        });

        list.sort((a, b) => b.createdAt - a.createdAt);

        if (isMounted) {
          setAppointments(list);
          setLoading(false);
        }
      },
      (err) => {
        console.warn("Appointments live sync error:", err);
        if (isMounted) setLoading(false);
      }
    );

    // Load facility dispensaries
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
      if (dateFilter && app.date !== dateFilter) return false;
      return true;
    });
  }, [scopedAppointments, dateFilter]);

  // Filtered Appointments (filtered by status from the top 4 clickable cards)
  const filteredAppointments = useMemo(() => {
    return dateScopedAppointments.filter((app) => {
      // Status filter
      if (statusFilter !== "all") {
        if (statusFilter === "scheduled") {
          // In schedule & queue: include all that are not completed (whether with recip, doc, pharma, or in any stage)
          if (app.status === "completed" || app.status === "cancelled") return false;
        } else if (statusFilter === "visited") {
          // Completed visits
          if (app.status !== "completed") return false;
        } else if (statusFilter === "cancelled") {
          if (app.status !== "cancelled") return false;
        }
      }
      return true;
    });
  }, [dateScopedAppointments, statusFilter]);

  // Metrics: Strictly reflects the selected date (Clickable filter counts)
  const metrics = useMemo(() => {
    const list = dateScopedAppointments;
    const total = list.length;
    // In schedule and queue put all numbers which are not completed!
    const scheduled = list.filter((a) => a.status !== "completed" && a.status !== "cancelled").length;
    const visited = list.filter((a) => a.status === "completed").length;
    const cancelled = list.filter((a) => a.status === "cancelled").length;
    return { total, scheduled, visited, cancelled };
  }, [dateScopedAppointments]);

  // Open booking modal
  const handleOpenBooking = () => {
    if (!isLoggedIn) {
      openLoginModal();
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    setAppointmentDate(today);
    setIpName("");
    setIpNumber("");
    setPhone("");
    setAge("");
    setGender("Male");
    setNotes("");
    setPurpose("Fever & Chills");
    setTimeSlot(OPD_TIME_SLOTS[0]);

    if (staffDispensaryName) {
      setSelectedDispensary(staffDispensaryName);
    } else if (dispensaries.length > 0 && !selectedDispensary) {
      setSelectedDispensary(dispensaries[0].name);
    }
    setBookingModalOpen(true);
  };

  // Submit appointment booking
  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ipName.trim() || !phone.trim() || !selectedDispensary || !appointmentDate) {
      toast.error("Please fill in patient name, phone, dispensary, and appointment date.");
      return;
    }

    setSubmitting(true);

    // Generate token in exact EKMS Triage format: ESIC-XXXXX-DISP (or HOSP for hospital)
    const isHospital = (selectedDispensary || "").toLowerCase().includes("hospital");
    const prefix = "ESIC";
    const suffix = isHospital ? "HOSP" : "DISP";

    let maxSeq = 0;
    const tokenRegex = /^[A-Z]{4}-(\d{5})-[A-Z0-9]{4,5}$/i;
    appointments.forEach((a) => {
      const raw = a.tokenNo || a.referenceNo || "";
      const match = raw.match(tokenRegex);
      if (match && match[1]) {
        const n = parseInt(match[1], 10);
        if (!isNaN(n) && n > maxSeq && n < 99999) maxSeq = n;
      } else {
        const anyDigits = raw.match(/\b(\d{3,5})\b/);
        if (anyDigits && anyDigits[1]) {
          const n = parseInt(anyDigits[1], 10);
          if (!isNaN(n) && n > maxSeq && n < 99999) maxSeq = n;
        }
      }
    });

    const nextSeq = maxSeq > 0 ? maxSeq + 1 : 336;
    const seqPadded = String(nextSeq).padStart(5, "0");
    const tokenNo = `${prefix}-${seqPadded}-${suffix}`;
    const newId = tokenNo.replace(/[^a-zA-Z0-9_-]/g, "_");
    const bookedByName = userProfile?.displayName || userProfile?.name || user?.email?.split("@")[0] || "Agent";

    const targetDispObj = dispensaries.find((d) => d.name === selectedDispensary);

    const payload: Omit<AppointmentRecord, "id"> = {
      tokenNo,
      referenceNo: tokenNo,
      ipName: ipName.trim(),
      ipNumber: ipNumber.trim() || "N/A",
      phone: phone.trim(),
      age: age.trim() || "N/A",
      gender,
      dispensaryName: selectedDispensary,
      dispensaryId: targetDispObj?.id || "",
      district: targetDispObj?.district || targetDispObj?.city || "",
      location: targetDispObj?.address || targetDispObj?.location || "",
      date: appointmentDate,
      timeSlot,
      department: "General Medicine / Primary Care OPD",
      purpose,
      chiefComplaint: purpose,
      notes: notes.trim(),
      status: "scheduled",
      bookedByEmail: user?.email || "anonymous",
      bookedByName,
      bookedAt: new Date().toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
      createdAt: Date.now(),
    };

    try {
      await setDoc(doc(bookingDb, "dispensary_appointments", newId), payload);
      try {
        await setDoc(doc(db, "dispensary_appointments", newId), payload, { merge: true });
      } catch (e) {}

      // Real-time notification delivered to the Receptionist of that dispensary
      createDispensaryNotification({
        targetDispensary: selectedDispensary,
        targetDispensaryRole: "Receptionist",
        title: "New OPD Appointment Booked",
        message: `Patient ${ipName.trim()} (${tokenNo}) booked for ${appointmentDate} at ${selectedDispensary}.`,
        link: "/dispensary/reception",
        tokenNo,
      }).catch((e) => console.warn("Dispensary notification dispatch warning:", e));

      logUserActivity(user?.email, {
        desc: `Booked OPD appointment ${tokenNo} for ${ipName.trim()} at ${selectedDispensary}`,
        type: "add",
      });

      toast.success(`Appointment Confirmed! Token: ${tokenNo}`);
      setBookingModalOpen(false);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to schedule appointment.");
    } finally {
      setSubmitting(false);
    }
  };

  // Open Mark Visited Modal
  const handleOpenMarkVisited = (app: AppointmentRecord) => {
    setActiveAppointment(app);
    setVisitNotes("");
    setVitalBp("120/80");
    setVitalPulse("74");
    setVitalTemp("98.6°F");
    setVisitModalOpen(true);
  };

  // Confirm Patient Visit
  const handleConfirmVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAppointment) return;

    setMarkingVisited(true);
    const verifierName = userProfile?.displayName || userProfile?.name || user?.email?.split("@")[0] || "Dispensary Staff";

    const updatePayload = {
      status: "visited",
      visitedAt: Date.now(),
      visitedBy: verifierName,
      visitedNotes: visitNotes.trim() || "Consultation completed. Medicines dispensed.",
      vitals: {
        bp: vitalBp.trim() || "120/80",
        pulse: vitalPulse.trim() || "72 bpm",
        temp: vitalTemp.trim() || "98.6°F",
      },
    };

    try {
      await setDoc(doc(bookingDb, "dispensary_appointments", activeAppointment.id), updatePayload, { merge: true });

      logUserActivity(user?.email, {
        desc: `Verified patient visit for token ${activeAppointment.tokenNo} (${activeAppointment.ipName}) at ${activeAppointment.dispensaryName}`,
        type: "edit",
      });

      toast.success(`Patient Visit Verified & Recorded for Token ${activeAppointment.tokenNo}!`);
      setVisitModalOpen(false);
      setActiveAppointment(null);
    } catch (err: any) {
      toast.error("Failed to mark patient visit.");
    } finally {
      setMarkingVisited(false);
    }
  };

  // Cancel Appointment
  const handleCancelAppointment = async (app: AppointmentRecord) => {
    const confirmed = await showConfirm({
      title: `Cancel Appointment ${app.tokenNo}?`,
      message: `Are you sure you want to cancel the scheduled appointment for ${app.ipName}?`,
      isDestructive: true,
      confirmText: "Yes, Cancel Appointment",
    });
    if (!confirmed) return;

    try {
      await setDoc(
        doc(bookingDb, "dispensary_appointments", app.id),
        { status: "cancelled", cancellationReason: "Cancelled by staff/beneficiary request" },
        { merge: true }
      );
      toast.info(`Appointment ${app.tokenNo} cancelled.`);
      logUserActivity(user?.email, {
        desc: `Cancelled appointment ${app.tokenNo} for ${app.ipName}`,
        type: "edit",
      });
    } catch (e: any) {
      toast.error("Failed to cancel appointment.");
    }
  };

  // Copy helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success(`Copied "${text}"`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header (Clean without box) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dispensary Appointments</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:self-center">
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
          </div>

          {isDispensaryStaff && staffDispensaryName && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-50 border border-teal-200/90 text-teal-900 text-xs font-semibold shadow-2xs">
              <Building2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
              <span>Dispensary: <strong className="text-slate-800 font-bold">{staffDispensaryName}</strong></span>
            </div>
          )}

          <button
            onClick={handleOpenBooking}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Book Appointment</span>
          </button>
        </div>
      </div>

      {/* 2. Top 4 Clickable Metric Filter Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 select-none">
        <button
          onClick={() => setStatusFilter("all")}
          className={`bg-white border rounded-2xl p-4 shadow-2xs flex items-center justify-between text-left cursor-pointer transition-all ${
            statusFilter === "all"
              ? "border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/20"
              : "border-slate-200/80 hover:border-slate-300"
          }`}
        >
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Bookings</div>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{metrics.total}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
            <Calendar className="w-5 h-5" />
          </div>
        </button>

        <button
          onClick={() => setStatusFilter(statusFilter === "scheduled" ? "all" : "scheduled")}
          className={`bg-white border rounded-2xl p-4 shadow-2xs flex items-center justify-between text-left cursor-pointer transition-all ${
            statusFilter === "scheduled"
              ? "border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-50/20"
              : "border-slate-200/80 hover:border-slate-300"
          }`}
        >
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Scheduled & In-Queue</div>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{metrics.scheduled}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
            <Clock className="w-5 h-5" />
          </div>
        </button>

        <button
          onClick={() => setStatusFilter(statusFilter === "visited" ? "all" : "visited")}
          className={`bg-white border rounded-2xl p-4 shadow-2xs flex items-center justify-between text-left cursor-pointer transition-all ${
            statusFilter === "visited"
              ? "border-teal-500 ring-2 ring-teal-500/20 bg-teal-50/20"
              : "border-slate-200/80 hover:border-slate-300"
          }`}
        >
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Completed Visits</div>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{metrics.visited}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </button>

        <button
          onClick={() => setStatusFilter(statusFilter === "cancelled" ? "all" : "cancelled")}
          className={`bg-white border rounded-2xl p-4 shadow-2xs flex items-center justify-between text-left cursor-pointer transition-all ${
            statusFilter === "cancelled"
              ? "border-rose-500 ring-2 ring-rose-500/20 bg-rose-50/20"
              : "border-slate-200/80 hover:border-slate-300"
          }`}
        >
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cancelled / No-Show</div>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{metrics.cancelled}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500">
            <XCircle className="w-5 h-5" />
          </div>
        </button>
      </div>

      {/* 4. Appointments List */}
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
                : "No appointments matching your current search or date filter. Book a new OPD appointment to add to the queue."}
            </p>
            {!isDispensaryStaff && (
              <button
                onClick={handleOpenBooking}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl shadow-xs"
              >
                Book New Appointment
              </button>
            )}
          </div>
        ) : (
          filteredAppointments.map((app) => {
            const isVisited = app.status === "visited" || app.status === "completed";
            const isCancelled = app.status === "cancelled";

            return (
              <div
                key={app.id}
                className={`bg-white border rounded-2xl p-4 sm:p-5 transition-all shadow-2xs hover:shadow-xs border-l-4 ${
                  app.status === "completed"
                    ? "border-slate-200 border-l-emerald-500"
                    : app.status === "pharmacy_queue"
                    ? "border-slate-200 border-l-purple-500"
                    : app.status === "with_doctor" || app.status === "visited"
                    ? "border-slate-200 border-l-blue-400"
                    : isCancelled
                    ? "border-rose-200/70 border-l-rose-400 bg-slate-50/30"
                    : "border-slate-200 border-l-amber-400"
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left: Token & Patient Info */}
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Token Badge */}
                      <span
                        onClick={() => handleCopy(app.tokenNo, app.id)}
                        className="px-2.5 py-1 bg-teal-50/70 hover:bg-teal-100 text-teal-800 border border-teal-200 rounded-lg text-xs font-mono font-extrabold flex items-center gap-1.5 cursor-pointer transition-colors"
                        title="Click to copy token"
                      >
                        <span>Token: {app.tokenNo}</span>
                        {copiedId === app.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-teal-500" />}
                      </span>

                      {/* Beautiful Dispensary Name Badge */}
                      {app.dispensaryName && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-teal-50 text-teal-800 border border-teal-200/90 rounded-lg text-xs font-bold shadow-2xs">
                          <Building2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                          <span>{app.dispensaryName}</span>
                        </span>
                      )}

                      <span className="text-[11px] text-slate-400 font-mono">
                        Booked: {app.date} • {app.timeSlot}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="text-base font-extrabold text-slate-900">{app.ipName}</h3>
                      {app.age && <span className="text-xs text-slate-500">({app.age} yrs, {app.gender})</span>}
                      <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                        IP: {app.ipNumber || "N/A"}
                      </span>
                      <span className="text-xs text-slate-600 flex items-center gap-1 font-medium">
                        <Phone className="w-3 h-3 text-slate-400" />
                        <span>{app.phone}</span>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 font-medium pt-0.5">
                      <Activity className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                      <span>Chief Complaint: <strong className="text-slate-900 font-bold">{app.purpose || app.chiefComplaint || "General Health Check"}</strong></span>
                    </div>

                    {isCancelled && app.cancellationReason && (
                      <div className="text-xs text-rose-600 font-medium flex items-center gap-1.5 pt-0.5">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        <span>Reason for Cancellation: {formatCancellationReason(app.cancellationReason)}</span>
                      </div>
                    )}
                  </div>

                  {/* Right: Status on top of Actions */}
                  <div className="flex flex-col sm:items-end justify-between gap-2.5 shrink-0 pt-2 lg:pt-0 self-start sm:self-center">
                    {/* Status Badge */}
                    <div className="flex items-center gap-2">
                      {app.status === "completed" ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold uppercase bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>VISIT COMPLETED</span>
                        </span>
                      ) : app.status === "pharmacy_queue" ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold uppercase bg-purple-50 text-purple-800 border border-purple-300 shadow-2xs">
                          <Pill className="w-3.5 h-3.5 text-purple-600" />
                          <span>WITH PHARMACIST</span>
                        </span>
                      ) : app.status === "with_doctor" || app.status === "visited" ? (
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
                    </div>

                    {/* Actions Row directly under status: Clinical summary, Cancel appointment (Triage Design) */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveAppointment(app as any);
                          setDetailsModalOpen(true);
                        }}
                        className="px-3 py-1.5 text-blue-700 hover:bg-blue-50 border border-blue-200 bg-blue-50/40 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95"
                        title="View Clinical Summary"
                      >
                        <FileText className="w-3.5 h-3.5 text-blue-600" />
                        <span>Clinical summary</span>
                      </button>

                      {!isVisited && !isCancelled && (
                        <button
                          type="button"
                          onClick={() => handleCancelAppointment(app)}
                          className="px-3 py-1.5 text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95"
                          title="Cancel appointment"
                        >
                          <XCircle className="w-3.5 h-3.5 text-slate-500" />
                          <span>Cancel</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>



      {/* --- BOOK APPOINTMENT MODAL --- */}
      {bookingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in overflow-y-auto">
          <div className="bg-white max-w-xl w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-teal-800 font-extrabold text-base">
                <CalendarClock className="w-5 h-5 text-teal-600" />
                <span>Book Insured Person (IP) OPD Appointment</span>
              </div>
              <button
                onClick={() => setBookingModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAppointment} className="space-y-4">
              {/* Patient Name & ESIC / IP Number */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Patient / IP Full Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={ipName}
                    onChange={(e) => setIpName(e.target.value)}
                    placeholder="e.g. Ramesh Kalita"
                    required
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    IP / ESIC Insurance Number
                  </label>
                  <input
                    type="text"
                    value={ipNumber}
                    onChange={(e) => setIpNumber(e.target.value)}
                    placeholder="e.g. 1312345678"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-blue-600 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              {/* Contact Phone & Age / Gender */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Phone / Mobile <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    required
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Age
                  </label>
                  <input
                    type="number"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="e.g. 38"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Gender
                  </label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500 cursor-pointer"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              {/* Select ESIS Dispensary */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Select ESIS Dispensary <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedDispensary}
                  onChange={(e) => setSelectedDispensary(e.target.value)}
                  disabled={isDispensaryStaff && Boolean(staffDispensaryName)}
                  required
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-teal-900 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500 cursor-pointer disabled:opacity-80 disabled:cursor-not-allowed"
                >
                  <option value="">-- Choose Target Dispensary --</option>
                  {dispensaries.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name} {d.district ? `(${d.district})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date & Time Slot */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Appointment Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={appointmentDate}
                    onChange={(e) => setAppointmentDate(e.target.value)}
                    required
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Consultation Time Slot
                  </label>
                  <select
                    value={timeSlot}
                    onChange={(e) => setTimeSlot(e.target.value)}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500 cursor-pointer"
                  >
                    {OPD_TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Purpose / Chief Complaint */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Primary Chief Complaint / Reason for Visit
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {COMMON_CHIEF_COMPLAINTS.map((comp) => (
                    <button
                      key={comp}
                      type="button"
                      onClick={() => setPurpose(comp)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                        purpose === comp
                          ? "bg-teal-700 text-white shadow-2xs"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {comp}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="Or enter custom symptoms/complaint..."
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Agent Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Agent Special Notes (Optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Patient is diabetic and needs fasting blood glucose check."
                  rows={2}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setBookingModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-xs font-semibold rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 cursor-pointer"
                >
                  <CalendarCheck className="w-4 h-4" />
                  <span>{submitting ? "Booking Token..." : "Confirm & Issue OPD Token"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- CLINICAL SUMMARY MODAL (MATCHING TRIAGE FORMAT) --- */}
      <ClinicalSummaryModal
        isOpen={detailsModalOpen}
        onClose={() => {
          setDetailsModalOpen(false);
          setActiveAppointment(null);
        }}
        appointment={activeAppointment as any}
      />
    </div>
  );
}
