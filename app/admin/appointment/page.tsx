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
import * as XLSX from "xlsx";
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
  Trash2,
  Filter,
  X,
  Copy,
  Check,
  FileText,
  Stethoscope,
  ShieldCheck,
  Download,
  RotateCcw,
  UserCheck,
  Activity,
  HeartPulse,
  Pill,
} from "lucide-react";
import { AppointmentRecord } from "@/app/(agent)/appointment/page";
import { ClinicalSummaryModal } from "@/components/appointments/ClinicalSummaryModal";

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

export default function AdminManageAppointmentPage() {
  const { user, userProfile, isAdmin, isMasterAdmin } = useAuth();
  const { toast, showConfirm } = usePopup();

  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [dispensaries, setDispensaries] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "scheduled" | "visited" | "cancelled">("all");
  const [dateFilter, setDateFilter] = useState("");
  const [dispensaryFilter, setDispensaryFilter] = useState("all");
  const [staffFilter, setStaffFilter] = useState("all");
  const [dispensaryStaffUsers, setDispensaryStaffUsers] = useState<UserProfile[]>([]);

  // Booking Modal State
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Details Modal State
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [activeAppointment, setActiveAppointment] = useState<AppointmentRecord | null>(null);

  // Selection & Bulk Actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

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

  // 1. Live Sync from ekmsbooking database with query limit for minimum Firestore reads
  useEffect(() => {
    let isMounted = true;

    const q = query(
      collection(bookingDb, "dispensary_appointments"),
      orderBy("createdAt", "desc"),
      limit(200)
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

    // Fetch Dispensary Staff directory for staff filter
    const unsubStaff = onSnapshot(collection(db, "users"), (snap) => {
      const list: UserProfile[] = [];
      snap.forEach((d) => {
        const data = d.data();
        if (data.role === "Dispensary Staff" || data.role === "Dispensary" || data.dispensaryName) {
          list.push({
            id: d.id,
            email: data.email || d.id,
            displayName: data.displayName || data.name || (data.email || d.id).split("@")[0],
            dispensaryName: data.dispensaryName || "",
            dispensaryId: data.dispensaryId || "",
            role: data.role || "Dispensary Staff",
          } as UserProfile);
        }
      });
      if (isMounted) setDispensaryStaffUsers(list);
    });

    return () => {
      isMounted = false;
      unsub();
      unsubStaff();
    };
  }, []);

  // Filtered Appointments
  const filteredAppointments = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    const todayStr = new Date().toISOString().slice(0, 10);

    return appointments.filter((app) => {
      // Dispensary filter
      if (dispensaryFilter !== "all") {
        if (!isDispensaryMatch(app.dispensaryName, dispensaryFilter, app.dispensaryId)) {
          return false;
        }
      }

      // Staff filter
      if (staffFilter !== "all") {
        const staffObj = dispensaryStaffUsers.find(
          (s) => s.email.toLowerCase() === staffFilter.toLowerCase() || (s.dispensaryName && s.dispensaryName.toLowerCase() === staffFilter.toLowerCase())
        );
        const staffDisp = (staffObj?.dispensaryName || staffFilter).trim();
        const staffEmail = (staffObj?.email || staffFilter).toLowerCase().trim();
        const staffDispId = (staffObj?.dispensaryId || "").trim();
        const matchDisp = staffDisp && isDispensaryMatch(app.dispensaryName, staffDisp, app.dispensaryId, staffDispId);
        const matchStaff = (app.visitedBy || "").toLowerCase().includes(staffEmail) || (app.bookedByEmail || "").toLowerCase() === staffEmail;
        if (!matchDisp && !matchStaff) {
          return false;
        }
      }

      if (statusFilter !== "all") {
        if (statusFilter === "scheduled") {
          // In schedule and queue: include all that are not completed (whether with recip, doc, pharma, or in any stage)
          if (app.status === "completed" || app.status === "cancelled") return false;
        } else if (statusFilter === "visited") {
          if (app.status !== "completed") return false;
        } else if (app.status !== statusFilter) {
          return false;
        }
      }

      if (dateFilter === "today") {
        if (app.date !== todayStr) return false;
      } else if (dateFilter && app.date !== dateFilter) {
        return false;
      }

      if (q) {
        const matchToken = (app.tokenNo || "").toLowerCase().includes(q);
        const matchName = (app.ipName || "").toLowerCase().includes(q);
        const matchIp = (app.ipNumber || "").toLowerCase().includes(q);
        const matchPhone = (app.phone || "").includes(q);
        const matchDisp = (app.dispensaryName || "").toLowerCase().includes(q);
        const matchBooker = (app.bookedByName || "").toLowerCase().includes(q);
        const matchComplaint = (app.chiefComplaint || app.purpose || "").toLowerCase().includes(q);
        return matchToken || matchName || matchIp || matchPhone || matchDisp || matchBooker || matchComplaint;
      }

      return true;
    });
  }, [appointments, searchTerm, statusFilter, dateFilter, dispensaryFilter, staffFilter, dispensaryStaffUsers]);

  // Metrics
  const metrics = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const total = appointments.length;
    // In schedule & queue: put all numbers that are not completed (with recip, with doc, with pharma, or in any stage)
    const scheduled = appointments.filter((a) => a.status !== "completed" && a.status !== "cancelled").length;
    const visited = appointments.filter((a) => a.status === "completed").length;
    const todayQueue = appointments.filter((a) => a.date === todayStr && a.status !== "completed" && a.status !== "cancelled").length;
    const cancelled = appointments.filter((a) => a.status === "cancelled").length;
    return { total, scheduled, visited, todayQueue, cancelled };
  }, [appointments]);

  // Open booking modal
  const handleOpenBooking = () => {
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
    if (dispensaries.length > 0 && !selectedDispensary) {
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
    const bookedByName = userProfile?.displayName || userProfile?.name || "Admin Desk";

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
      bookedByEmail: user?.email || "admin@ekms.in",
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

      logUserActivity(user?.email, {
        desc: `Admin scheduled appointment ${tokenNo} for ${ipName} at ${selectedDispensary}`,
        type: "add",
      });

      toast.success(`Appointment Confirmed! Token: ${tokenNo}`);
      setBookingModalOpen(false);
    } catch (err: any) {
      toast.error("Failed to schedule appointment.");
    } finally {
      setSubmitting(false);
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
        { status: "cancelled", cancellationReason: "Cancelled by admin" },
        { merge: true }
      );
      toast.info(`Appointment ${app.tokenNo} cancelled.`);
      logUserActivity(user?.email, {
        desc: `Admin cancelled appointment ${app.tokenNo} for ${app.ipName}`,
        type: "edit",
      });
    } catch (e: any) {
      toast.error("Failed to cancel appointment.");
    }
  };

  // Helper to ensure an appointment is completely purged from all databases
  const deleteAppointmentFromAllDatabases = async (app: AppointmentRecord) => {
    const promises: Promise<any>[] = [];

    // 1. Delete from bookingDb by ID
    if (app.id) {
      promises.push(deleteDoc(doc(bookingDb, "dispensary_appointments", app.id)).catch(() => {}));
    }

    // 2. Delete from default db by ID if exists
    if (app.id) {
      promises.push(deleteDoc(doc(db, "dispensary_appointments", app.id)).catch(() => {}));
      promises.push(deleteDoc(doc(db, "appointments", app.id)).catch(() => {}));
      promises.push(deleteDoc(doc(bookingDb, "appointments", app.id)).catch(() => {}));
    }

    // 3. Query and delete any matching records by tokenNo or referenceNo in both bookingDb & db
    const identifiers = [app.tokenNo, app.referenceNo, app.id].filter(Boolean) as string[];
    for (const ident of identifiers) {
      // bookingDb dispensary_appointments
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

      // db dispensary_appointments
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

    await Promise.all(promises);
  };

  // Delete Single Appointment (Permanent from all databases)
  const handleDeleteAppointment = async (app: AppointmentRecord) => {
    const confirmed = await showConfirm({
      title: `Permanently Delete ${app.tokenNo}?`,
      message: `Are you sure you want to permanently delete appointment record ${app.tokenNo} for ${app.ipName}? This will remove it from all databases. This action cannot be undone.`,
      isDestructive: true,
      confirmText: "Delete Record",
    });
    if (!confirmed) return;

    try {
      await deleteAppointmentFromAllDatabases(app);
      toast.success(`Appointment ${app.tokenNo} deleted from all databases.`);
      logUserActivity(user?.email, {
        desc: `Admin deleted appointment record ${app.tokenNo} from all databases`,
        type: "delete",
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(app.id);
        return next;
      });
    } catch (e: any) {
      toast.error("Failed to delete appointment record.");
    }
  };

  // Selection handlers
  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredAppointments.length && filteredAppointments.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAppointments.map((a) => a.id)));
    }
  };

  const handleToggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Bulk Delete Selected Appointments (Permanent from all databases)
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;

    const confirmed = await showConfirm({
      title: `Permanently Delete ${count} Appointment(s)?`,
      message: `Are you sure you want to permanently delete ${count} selected appointment(s)? They will be completely purged from all databases. This action cannot be undone.`,
      isDestructive: true,
      confirmText: `Delete ${count} Record(s)`,
    });
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      const appsToDelete = appointments.filter((a) => selectedIds.has(a.id));
      await Promise.all(appsToDelete.map((app) => deleteAppointmentFromAllDatabases(app)));

      toast.success(`Successfully deleted ${count} appointment(s) from all databases.`);
      logUserActivity(user?.email, {
        desc: `Admin bulk deleted ${count} appointment(s) from all databases`,
        type: "delete",
      });
      setSelectedIds(new Set());
    } catch (err: any) {
      console.error("Bulk delete error:", err);
      toast.error("Failed to delete some appointments: " + (err.message || "Unknown error"));
    } finally {
      setBulkDeleting(false);
    }
  };

  // Export to Excel
  const handleExportExcel = () => {
    if (filteredAppointments.length === 0) {
      toast.error("No appointments to export.");
      return;
    }

    const dataToExport = filteredAppointments.map((a) => ({
      "Token No": a.tokenNo,
      "Patient Name": a.ipName,
      "IP / ESIC Number": a.ipNumber,
      "Phone": a.phone,
      "Age": a.age || "N/A",
      "Gender": a.gender || "Male",
      "Dispensary": a.dispensaryName,
      "District": a.district || "N/A",
      "Date": a.date,
      "Time Slot": a.timeSlot,
      "Chief Complaint": a.purpose,
      "Status": a.status.toUpperCase(),
      "Booked By": a.bookedByName,
      "Booked At": a.bookedAt || "N/A",
      "Visited At": a.visitedAt ? new Date(a.visitedAt).toLocaleString() : "N/A",
      "Visited By": a.visitedBy || "N/A",
      "Doctor Remarks": a.visitedNotes || "N/A",
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Appointments");
    XLSX.writeFile(workbook, `ESIS_Appointments_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("Appointments exported to Excel!");
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
      {/* 1. Header with Filters & Actions */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pt-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Manage Dispensary Appointments</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Date Picker */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 shadow-2xs">
            <Calendar className="w-3.5 h-3.5 text-teal-600 shrink-0" />
            <input
              type="date"
              value={dateFilter === "today" ? new Date().toISOString().slice(0, 10) : dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-transparent outline-none cursor-pointer text-xs"
            />
            {dateFilter && (
              <button
                onClick={() => setDateFilter("")}
                className="text-[10px] font-bold text-slate-400 hover:text-slate-700 ml-1 px-1 py-0.5 rounded bg-slate-100"
                title="Show all dates"
              >
                All
              </button>
            )}
          </div>

          {/* Dispensary Filter */}
          <select
            value={dispensaryFilter}
            onChange={(e) => {
              setDispensaryFilter(e.target.value);
              if (e.target.value !== "all") setStaffFilter("all");
            }}
            className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer shadow-2xs max-w-[200px]"
          >
            <option value="all">All Dispensaries ({dispensaries.length})</option>
            {dispensaries.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name} {d.district ? `(${d.district})` : ""}
              </option>
            ))}
          </select>

          {/* Dispensary Staff Filter */}
          <select
            value={staffFilter}
            onChange={(e) => {
              setStaffFilter(e.target.value);
              if (e.target.value !== "all") setDispensaryFilter("all");
            }}
            className="px-3 py-2 bg-teal-50/60 border border-teal-200 rounded-xl text-xs font-bold text-teal-800 outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer shadow-2xs max-w-[180px]"
          >
            <option value="all">All Staff ({dispensaryStaffUsers.length})</option>
            {dispensaryStaffUsers.map((s) => (
              <option key={s.email} value={s.dispensaryName || s.email}>
                {s.displayName}
              </option>
            ))}
          </select>

          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer shadow-2xs"
            title="Export to Excel"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export</span>
          </button>

          <button
            onClick={handleOpenBooking}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Schedule Appointment</span>
          </button>
        </div>
      </div>

      {/* 2. Top Metrics (Clickable Filters) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 select-none">
        <div
          onClick={() => setStatusFilter("all")}
          className={`bg-white border rounded-2xl p-4 transition-all cursor-pointer flex items-center justify-between ${
            statusFilter === "all"
              ? "border-teal-500 ring-2 ring-teal-500 shadow-md bg-teal-50/10"
              : "border-slate-200/80 shadow-2xs hover:border-slate-300"
          }`}
          title="Filter all appointments"
        >
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Bookings</div>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{metrics.total}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
            <Calendar className="w-5 h-5" />
          </div>
        </div>

        <div
          onClick={() => setStatusFilter("scheduled")}
          className={`bg-white border rounded-2xl p-4 transition-all cursor-pointer flex items-center justify-between ${
            statusFilter === "scheduled"
              ? "border-blue-500 ring-2 ring-blue-500 shadow-md bg-blue-50/10"
              : "border-slate-200/80 shadow-2xs hover:border-slate-300"
          }`}
          title="Filter scheduled & queue"
        >
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Scheduled / Queue</div>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{metrics.scheduled}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div
          onClick={() => setStatusFilter("visited")}
          className={`bg-white border rounded-2xl p-4 transition-all cursor-pointer flex items-center justify-between ${
            statusFilter === "visited"
              ? "border-emerald-500 ring-2 ring-emerald-500 shadow-md bg-emerald-50/10"
              : "border-slate-200/80 shadow-2xs hover:border-slate-300"
          }`}
          title="Filter completed visits"
        >
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Completed Visits</div>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{metrics.visited}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div
          onClick={() => setStatusFilter("cancelled")}
          className={`bg-white border rounded-2xl p-4 transition-all cursor-pointer flex items-center justify-between ${
            statusFilter === "cancelled"
              ? "border-rose-500 ring-2 ring-rose-500 shadow-md bg-rose-50/10"
              : "border-slate-200/80 shadow-2xs hover:border-slate-300"
          }`}
          title="Filter cancelled appointments"
        >
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cancelled</div>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{metrics.cancelled}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500">
            <XCircle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 3. Search Bar */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-3 shadow-2xs">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by Token, Patient Name, Phone, IP Number, Dispensary, or Complaint..."
            className="w-full pl-10 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500 font-medium"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 3.5. Bulk Selection Action Bar */}
      {selectedIds.size > 0 && (
        <div className="bg-slate-900 text-white rounded-2xl p-3 px-4 shadow-xl flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3">
            <span className="bg-teal-500/20 text-teal-300 border border-teal-500/40 text-xs font-bold px-2.5 py-1 rounded-lg">
              {selectedIds.size} of {filteredAppointments.length} Selected
            </span>
            <button
              type="button"
              onClick={handleToggleSelectAll}
              className="text-xs text-slate-300 hover:text-white underline cursor-pointer"
            >
              {selectedIds.size === filteredAppointments.length ? "Deselect All" : "Select All"}
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              Clear Selection
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>{bulkDeleting ? "Deleting from All Databases..." : `Delete Selected (${selectedIds.size})`}</span>
            </button>
          </div>
        </div>
      )}

      {/* 4. Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-extrabold text-[10px]">
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      filteredAppointments.length > 0 &&
                      selectedIds.size === filteredAppointments.length
                    }
                    ref={(el) => {
                      if (el) {
                        el.indeterminate =
                          selectedIds.size > 0 &&
                          selectedIds.size < filteredAppointments.length;
                      }
                    }}
                    onChange={handleToggleSelectAll}
                    className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                    title="Select all"
                  />
                </th>
                <th className="py-3 px-4">Token / Ref</th>
                <th className="py-3 px-4">Patient / IP Details</th>
                <th className="py-3 px-4">Target Dispensary</th>
                <th className="py-3 px-4">Schedule</th>
                <th className="py-3 px-4">Chief Complaint</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-slate-400 font-semibold">
                    Loading appointment records...
                  </td>
                </tr>
              ) : filteredAppointments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400 font-medium">
                    No appointments found matching your search.
                  </td>
                </tr>
              ) : (
                filteredAppointments.map((app) => {
                  const isVisited = app.status === "visited" || app.status === "completed";
                  const isCancelled = app.status === "cancelled";

                  return (
                    <tr
                      key={app.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        selectedIds.has(app.id) ? "bg-teal-50/30" : ""
                      }`}
                    >
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(app.id)}
                          onChange={() => handleToggleSelectOne(app.id)}
                          className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold">
                        <span
                          onClick={() => handleCopy(app.tokenNo, app.id)}
                          className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-teal-800 rounded text-[11px] inline-flex items-center gap-1 cursor-pointer"
                          title="Click to copy"
                        >
                          <span>{app.tokenNo}</span>
                          {copiedId === app.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-slate-400" />}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-extrabold text-slate-900">{app.ipName}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>IP: <strong className="font-mono text-blue-600">{app.ipNumber}</strong></span>
                          <span>•</span>
                          <span>{app.phone}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-800 flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                          <span>{app.dispensaryName}</span>
                        </div>
                        {app.district && <div className="text-[10px] text-slate-400 mt-0.5">{app.district}</div>}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-800">{app.date}</div>
                        <div className="text-[10px] text-slate-400">{app.timeSlot}</div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="max-w-xs truncate font-medium text-slate-700" title={app.purpose}>
                          {app.purpose}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        {app.status === "completed" ? (
                          <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-full text-[10px] font-black uppercase inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Visit Completed</span>
                          </span>
                        ) : app.status === "pharmacy_queue" ? (
                          <span className="px-2.5 py-0.5 bg-purple-50 text-purple-800 border border-purple-300 rounded-full text-[10px] font-black uppercase inline-flex items-center gap-1">
                            <Pill className="w-3 h-3 text-purple-600" />
                            <span>With Pharmacist</span>
                          </span>
                        ) : app.status === "with_doctor" || app.status === "visited" ? (
                          <span className="px-2.5 py-0.5 bg-blue-50 text-blue-800 border border-blue-300 rounded-full text-[10px] font-black uppercase inline-flex items-center gap-1">
                            <Stethoscope className="w-3 h-3 text-blue-600" />
                            <span>With Doctor</span>
                          </span>
                        ) : isCancelled ? (
                          <span className="px-2.5 py-0.5 bg-rose-50 text-rose-800 border border-rose-300 rounded-full text-[10px] font-black uppercase inline-flex items-center gap-1">
                            <XCircle className="w-3 h-3 text-rose-600" />
                            <span>Cancelled</span>
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-300 rounded-full text-[10px] font-black uppercase inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-600" />
                            <span>Scheduled</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setActiveAppointment(app as any);
                              setDetailsModalOpen(true);
                            }}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-[11px] transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                            title="View Clinical Summary"
                          >
                            <FileText className="w-3 h-3 text-slate-500" />
                            <span>Clinical summary</span>
                          </button>

                          {!isVisited && !isCancelled && (
                            <button
                              onClick={() => handleCancelAppointment(app)}
                              className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold rounded-lg text-[11px] transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                              title="Cancel appointment"
                            >
                              <X className="w-3 h-3 text-rose-600" />
                              <span>Cancel</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleDeleteAppointment(app)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Delete appointment permanently"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- CLINICAL SUMMARY MODAL (MATCHING TRIAGE FORMAT) --- */}
      <ClinicalSummaryModal
        isOpen={detailsModalOpen}
        onClose={() => {
          setDetailsModalOpen(false);
          setActiveAppointment(null);
        }}
        appointment={activeAppointment as any}
      />

      {/* --- BOOK APPOINTMENT MODAL --- */}
      {bookingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in overflow-y-auto">
          <div className="bg-white max-w-xl w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-teal-800 font-extrabold text-base">
                <CalendarClock className="w-5 h-5 text-teal-600" />
                <span>Admin Schedule OPD Appointment</span>
              </div>
              <button
                onClick={() => setBookingModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAppointment} className="space-y-4">
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

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Select ESIS Dispensary <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedDispensary}
                  onChange={(e) => setSelectedDispensary(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-teal-900 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500 cursor-pointer"
                >
                  <option value="">-- Choose Target Dispensary --</option>
                  {dispensaries.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name} {d.district ? `(${d.district})` : ""}
                    </option>
                  ))}
                </select>
              </div>

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
                    Time Slot
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

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Chief Complaint
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
                  placeholder="Enter complaint / symptoms..."
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Notes / Clinical Observation
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional notes for dispensary doctor..."
                  rows={2}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500"
                />
              </div>

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
    </div>
  );
}
