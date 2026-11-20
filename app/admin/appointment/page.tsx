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
  Copy,
  Check,
  FileText,
  Stethoscope,
  UserCheck,
  Pill,
  PackageCheck,
} from "lucide-react";
import { AppointmentRecord } from "@/app/(agent)/appointment/page";
import { ClinicalSummaryModal } from "@/components/appointments/ClinicalSummaryModal";
import { CancelAppointmentModal } from "@/components/appointments/CancelAppointmentModal";
import { DoctorAvailabilityModal } from "@/components/appointments/DoctorAvailabilityModal";
import { useStaffDirectory } from "@/lib/useStaffDirectory";
import { extractIpNumber, isNonClinicalAppointment, formatStaffTimestamp } from "@/lib/appointmentTypes";
import { deleteAppointmentFromTriageApi } from "@/lib/triageSync";
import { maskDispensaryIpNumber, maskDispensaryMobile, isDispensaryStaffAccount } from "@/lib/maskUtils";

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

const ITEMS_PER_PAGE = 30;

export default function AdminManageAppointmentPage() {
  const { user, userProfile } = useAuth();
  const { toast, showConfirm } = usePopup();
  const { getStaffName, getDoctorName } = useStaffDirectory();
  const isDispensaryStaff = isDispensaryStaffAccount(userProfile);

  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [dispensaries, setDispensaries] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "reception" | "doctor" | "pharmacy" | "completed" | "cancelled"
  >("all");
  const [dateFilter, setDateFilter] = useState("");
  const [dispensaryFilter, setDispensaryFilter] = useState("all");

  // Sync date filter with mini-bar icons
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ekms-date-filter-change", { detail: dateFilter }));
    }
  }, [dateFilter]);
  const [staffFilter, setStaffFilter] = useState("all");
  const [dispensaryStaffUsers, setDispensaryStaffUsers] = useState<UserProfile[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  // Details Modal State
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [activeAppointment, setActiveAppointment] = useState<AppointmentRecord | null>(null);

  // Cancel Modal State
  const [cancelModalApp, setCancelModalApp] = useState<AppointmentRecord | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [copiedPhoneId, setCopiedPhoneId] = useState<string | null>(null);
  const [doctorAvailabilityOpen, setDoctorAvailabilityOpen] = useState(false);

  const handleCopyPhone = (e: React.MouseEvent, phone: string, id: string) => {
    e.stopPropagation();
    if (!phone) return;
    navigator.clipboard.writeText(phone);
    setCopiedPhoneId(id);
    toast.success(`Copied phone: ${phone}`);
    setTimeout(() => setCopiedPhoneId(null), 2000);
  };

  // Selection & Bulk Actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // 1. Live Sync from ekmsbooking database with query limit for minimum Firestore reads
  useEffect(() => {
    let isMounted = true;

    const q = query(
      collection(bookingDb, "dispensary_appointments"),
      orderBy("createdAt", "desc"),
      limit(500)
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
            ipNumber: extractIpNumber(data),
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
          });
        });
        if (isMounted) {
          setAppointments(list);
          setLoading(false);
        }
      },
      (err) => {
        console.warn("Dispensary appointments sync warning:", err);
        if (isMounted) setLoading(false);
      }
    );

    // Fetch Dispensaries
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
        if (statusFilter === "reception") {
          if (app.status !== "scheduled") return false;
        } else if (statusFilter === "doctor") {
          if (isNonClinicalAppointment(app)) return false;
          if (app.status !== "with_doctor" && app.status !== "visited") return false;
        } else if (statusFilter === "pharmacy") {
          if (isNonClinicalAppointment(app)) return false;
          if (app.status !== "pharmacy_queue") return false;
        } else if (statusFilter === "completed") {
          if (app.status !== "completed") return false;
        } else if (statusFilter === "cancelled") {
          if (app.status !== "cancelled") return false;
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

  // Reset pagination on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, dateFilter, dispensaryFilter, staffFilter]);

  // Metrics
  const metrics = useMemo(() => {
    const total = appointments.length;
    const pendingReception = appointments.filter((a) => a.status === "scheduled").length;
    const pendingDoctor = appointments.filter((a) => !isNonClinicalAppointment(a) && (a.status === "with_doctor" || a.status === "visited")).length;
    const pendingPharmacy = appointments.filter((a) => !isNonClinicalAppointment(a) && a.status === "pharmacy_queue").length;
    const completed = appointments.filter((a) => a.status === "completed").length;
    const cancelled = appointments.filter((a) => a.status === "cancelled").length;

    return {
      total,
      pendingReception,
      pendingDoctor,
      pendingPharmacy,
      completed,
      cancelled,
    };
  }, [appointments]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredAppointments.length / ITEMS_PER_PAGE) || 1;
  const paginatedAppointments = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAppointments.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAppointments, currentPage]);

  // Cancel Appointment Confirmation Handler
  const handleConfirmCancel = async (reason: string) => {
    if (!cancelModalApp) return;
    setCancelling(true);
    const finalReason = reason.trim() || "Cancelled by staff/beneficiary request";

    try {
      await setDoc(
        doc(bookingDb, "dispensary_appointments", cancelModalApp.id),
        { status: "cancelled", cancellationReason: finalReason },
        { merge: true }
      );
      toast.info(`Appointment ${cancelModalApp.tokenNo} cancelled.`);
      logUserActivity(user?.email, {
        desc: `Admin cancelled appointment ${cancelModalApp.tokenNo} for ${cancelModalApp.ipName}. Reason: ${finalReason}`,
        type: "edit",
      });
      setCancelModalApp(null);
    } catch (e: any) {
      toast.error("Failed to cancel appointment.");
    } finally {
      setCancelling(false);
    }
  };

  // Helper to ensure an appointment is completely purged from all databases
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

    // Delete from Triage database via API
    promises.push(
      deleteAppointmentFromTriageApi({
        id: app.id,
        tokenNo: app.tokenNo,
        referenceNo: app.referenceNo,
      }).catch((e) => console.warn("Triage API appointment delete notice:", e))
    );

    await Promise.all(promises);
  };

  // Delete Single Appointment
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
    if (selectedIds.size === paginatedAppointments.length && paginatedAppointments.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedAppointments.map((a) => a.id)));
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

  // Bulk Delete Selected Appointments
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
      const tokens = appsToDelete.map((a) => a.tokenNo).filter(Boolean);
      const ids = appsToDelete.map((a) => a.id).filter(Boolean);

      try {
        const bulkPayload = {
          tokens,
          ids,
          timestamp: Date.now(),
        };
        localStorage.setItem("ekms_deleted_appointment", JSON.stringify(bulkPayload));
        if (typeof window !== "undefined" && typeof (window as any).BroadcastChannel !== "undefined") {
          const channel = new BroadcastChannel("ekms_triage_sync_v1");
          channel.postMessage({ type: "APPOINTMENT_DELETED", payload: bulkPayload });
        }
      } catch (_) {}

      // Immediately filter local state
      setAppointments((prev) => prev.filter((a) => !selectedIds.has(a.id)));

      await Promise.all(appsToDelete.map((app) => deleteAppointmentFromAllDatabases(app)));

      // Purge in bulk from Triage database via API
      await deleteAppointmentFromTriageApi({
        tokens: appsToDelete.map((a) => a.tokenNo).filter(Boolean),
        ids: appsToDelete.map((a) => a.id).filter(Boolean),
      }).catch((e) => console.warn("Triage bulk delete notice:", e));

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

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header & Filters Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Manage Dispensary Appointments</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Date Filter */}
          <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl text-xs font-bold gap-1 shadow-2xs">
            <button
              onClick={() => setDateFilter("")}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                !dateFilter ? "bg-white text-teal-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setDateFilter("today")}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                dateFilter === "today" ? "bg-white text-teal-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Today
            </button>
          </div>

          <div className="flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 shadow-2xs">
            <Calendar className="w-3.5 h-3.5 text-teal-600" />
            <input
              type="date"
              value={dateFilter === "today" ? "" : dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-transparent text-xs text-slate-700 outline-none cursor-pointer"
              title="Pick specific date"
            />
          </div>

          {/* Doctor Availability Management Button */}
          <button
            type="button"
            onClick={() => setDoctorAvailabilityOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-teal-50 border border-teal-200 text-teal-800 hover:text-teal-900 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer active:scale-95 group"
            title="Set doctor availability & leaves for all platform doctors"
          >
            <CalendarCheck className="w-3.5 h-3.5 text-teal-600 group-hover:scale-110 transition-transform" />
            <span>Doctor Availability</span>
          </button>

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
        </div>
      </div>

      {/* 2. Top Metrics (Clickable Filters) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3 select-none">
        {/* Card 1: Total Bookings */}
        <div
          onClick={() => setStatusFilter("all")}
          className={`bg-white border rounded-2xl p-3 sm:p-3.5 transition-all cursor-pointer flex items-center justify-between ${
            statusFilter === "all"
              ? "border-blue-500 ring-2 ring-blue-500 shadow-md bg-blue-50/10"
              : "border-slate-200/80 shadow-2xs hover:border-slate-300"
          }`}
          title="Filter all appointments"
        >
          <div className="min-w-0 pr-1">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">Total Bookings</div>
            <div className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">{metrics.total}</div>
          </div>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
            <Calendar className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </div>

        {/* Card 2: Pending with Receptionist */}
        <div
          onClick={() => setStatusFilter(statusFilter === "reception" ? "all" : "reception")}
          className={`bg-white border rounded-2xl p-3 sm:p-3.5 transition-all cursor-pointer flex items-center justify-between ${
            statusFilter === "reception"
              ? "border-sky-500 ring-2 ring-sky-500 shadow-md bg-sky-50/10"
              : "border-slate-200/80 shadow-2xs hover:border-slate-300"
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
        </div>

        {/* Card 3: Pending with Doctor */}
        <div
          onClick={() => setStatusFilter(statusFilter === "doctor" ? "all" : "doctor")}
          className={`bg-white border rounded-2xl p-3 sm:p-3.5 transition-all cursor-pointer flex items-center justify-between ${
            statusFilter === "doctor"
              ? "border-teal-500 ring-2 ring-teal-500 shadow-md bg-teal-50/10"
              : "border-slate-200/80 shadow-2xs hover:border-slate-300"
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
        </div>

        {/* Card 4: Pending with Pharmacist */}
        <div
          onClick={() => setStatusFilter(statusFilter === "pharmacy" ? "all" : "pharmacy")}
          className={`bg-white border rounded-2xl p-3 sm:p-3.5 transition-all cursor-pointer flex items-center justify-between ${
            statusFilter === "pharmacy"
              ? "border-amber-500 ring-2 ring-amber-500 shadow-md bg-amber-50/10"
              : "border-slate-200/80 shadow-2xs hover:border-slate-300"
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
        </div>

        {/* Card 5: Completed Visits */}
        <div
          onClick={() => setStatusFilter(statusFilter === "completed" ? "all" : "completed")}
          className={`bg-white border rounded-2xl p-3 sm:p-3.5 transition-all cursor-pointer flex items-center justify-between ${
            statusFilter === "completed"
              ? "border-emerald-500 ring-2 ring-emerald-500 shadow-md bg-emerald-50/10"
              : "border-slate-200/80 shadow-2xs hover:border-slate-300"
          }`}
          title="Filter: Completed visits"
        >
          <div className="min-w-0 pr-1">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">Completed Visits</div>
            <div className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">{metrics.completed}</div>
          </div>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
            <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </div>

        {/* Card 6: Cancelled / No-Show */}
        <div
          onClick={() => setStatusFilter(statusFilter === "cancelled" ? "all" : "cancelled")}
          className={`bg-white border rounded-2xl p-3 sm:p-3.5 transition-all cursor-pointer flex items-center justify-between ${
            statusFilter === "cancelled"
              ? "border-rose-500 ring-2 ring-rose-500 shadow-md bg-rose-50/10"
              : "border-slate-200/80 shadow-2xs hover:border-slate-300"
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
        </div>
      </div>

      {/* 3. Search Bar & Bulk Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by Token, IP Name, Phone, IP Number, Dispensary, or Complaint..."
            className="w-full pl-10 pr-8 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 shadow-2xs transition"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Bulk Selection Actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 animate-in fade-in shrink-0">
            <span className="text-xs font-bold text-teal-800 bg-teal-50 px-2.5 py-1.5 rounded-lg border border-teal-200">
              {selectedIds.size} Selected
            </span>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{bulkDeleting ? "Deleting..." : "Delete Selected"}</span>
            </button>
          </div>
        )}
      </div>

      {/* 4. Table Records */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === paginatedAppointments.length && paginatedAppointments.length > 0}
                    onChange={handleToggleSelectAll}
                    className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                    title="Select all on this page"
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
                paginatedAppointments.map((app) => {
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

                      {/* Clean Plain Text Token (No grey button box, no copy icon) */}
                      <td className="py-3.5 px-4 font-mono font-bold">
                        <span className="text-xs text-slate-800 select-all font-mono font-bold">
                          {app.tokenNo}
                        </span>
                      </td>

                      {/* 3-Row Stacked Clean Layout: 1. Name, 2. Phone, 3. IP Number */}
                      <td className="py-3.5 px-4 min-w-[200px]">
                        {/* 1. Name */}
                        <div className="font-extrabold text-slate-900 text-sm leading-snug">
                          {app.ipName}
                          {app.age && (
                            <span className="text-xs font-normal text-slate-500 ml-1.5">
                              ({app.age} yrs{app.gender ? `, ${app.gender}` : ""})
                            </span>
                          )}
                        </div>

                        {/* 2. Phone Number below Name */}
                        <div className="text-xs text-slate-700 flex items-center gap-1.5 mt-1 font-medium">
                          <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                          {app.phone ? (
                            <div className="inline-flex items-center gap-1 font-mono text-slate-800">
                              <span>{isDispensaryStaff ? maskDispensaryMobile(app.phone) : app.phone}</span>
                              <button
                                type="button"
                                onClick={(e) => handleCopyPhone(e, app.phone, app.id)}
                                className="p-0.5 hover:bg-slate-200/80 rounded text-slate-400 hover:text-teal-700 transition cursor-pointer"
                                title="Copy phone number"
                              >
                                {copiedPhoneId === app.id ? (
                                  <Check className="w-3 h-3 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400 font-normal">N/A</span>
                          )}
                        </div>

                        {/* 3. IP Number below Phone Number */}
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5 flex items-center gap-1">
                          <span className="text-slate-500 font-sans font-medium">IP:</span>
                          <strong className="font-mono text-blue-600 font-semibold">{isDispensaryStaff ? maskDispensaryIpNumber(app.ipNumber) : (app.ipNumber || "N/A")}</strong>
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
                        <div className="text-[11px] text-slate-400 mt-0.5">{app.timeSlot}</div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="max-w-xs font-bold text-slate-800" title={app.purpose}>
                          {app.purpose || app.chiefComplaint || "General Health Check"}
                        </div>

                        {/* Audit Lines: Clean Plain Text (No Boxes) */}
                        <div className="mt-1 text-[11px] text-slate-700 space-y-0.5">
                          {/* Receptionist */}
                          {(app.receptionCheckedInBy || app.visitedBy) && (
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="font-semibold text-slate-800">
                                Reception by {getStaffName(app.receptionCheckedInBy || app.visitedBy)}
                              </span>
                              {formatStaffTimestamp(app.receptionCheckedInAt || app.visitedAt || (app.status !== "scheduled" ? (app.updatedAt || app.createdAt) : null)) && (
                                <span className="font-normal text-slate-500">
                                  , {formatStaffTimestamp(app.receptionCheckedInAt || app.visitedAt || (app.status !== "scheduled" ? (app.updatedAt || app.createdAt) : null))}
                                </span>
                              )}
                              {(app.visitedNotes || (app as any).receptionNotes) && (app.visitedNotes || (app as any).receptionNotes).trim() && (
                                <span className="text-slate-500 font-normal pl-0.5">• Note: {(app.visitedNotes || (app as any).receptionNotes).trim()}</span>
                              )}
                            </div>
                          )}

                          {/* Doctor */}
                          {(app.doctorName || app.doctorNotes) && (
                            <div className="flex flex-wrap items-center gap-1">
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
                                <span className="text-slate-500 font-normal pl-0.5">• Note: {app.doctorNotes}</span>
                              )}
                            </div>
                          )}

                          {/* Pharmacist */}
                          {app.dispensedBy && (
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="font-semibold text-slate-800">
                                Dispensed by {getStaffName(app.dispensedBy)}
                              </span>
                              {formatStaffTimestamp(app.dispensedAt || (app.status === "completed" ? app.updatedAt : null)) && (
                                <span className="font-normal text-slate-500">
                                  , {formatStaffTimestamp(app.dispensedAt || (app.status === "completed" ? app.updatedAt : null))}
                                </span>
                              )}
                              {app.dispensationNotes && app.dispensationNotes.trim() && (
                                <span className="text-slate-500 font-normal pl-0.5">• Note: {app.dispensationNotes}</span>
                              )}
                            </div>
                          )}

                          {/* Cancel Reason */}
                          {isCancelled && (
                            <div className="flex items-center gap-1 text-rose-600 font-medium pt-0.5">
                              <AlertCircle className="w-3 h-3 text-rose-500 shrink-0" />
                              <span>Reason: {formatCancellationReason(app.cancellationReason) || "Cancelled by staff/beneficiary request"}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {app.status === "completed" ? (
                          <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-full text-[10px] font-black uppercase inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Visit Completed</span>
                          </span>
                        ) : app.status === "pharmacy_queue" ? (
                          <span className="px-2.5 py-0.5 bg-purple-50 text-purple-800 border border-purple-300 rounded-full text-[10px] font-black uppercase inline-flex items-center gap-1">
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
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1 shadow-2xs whitespace-nowrap border ${
                              isNonClinicalAppointment(app)
                                ? "text-orange-700 hover:bg-orange-50 border-orange-300 bg-white"
                                : "text-slate-700 bg-slate-100 hover:bg-slate-200 border-transparent"
                            }`}
                            title={isNonClinicalAppointment(app) ? "View Non-Clinical Summary" : "View Clinical Summary"}
                          >
                            <FileText className={`w-3 h-3 ${isNonClinicalAppointment(app) ? "text-orange-600" : "text-slate-500"}`} />
                            <span>{isNonClinicalAppointment(app) ? "Non-Clinical Summary" : "Clinical summary"}</span>
                          </button>

                          {!isVisited && !isCancelled && (
                            <button
                              onClick={() => setCancelModalApp(app)}
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

        {/* 5. Pagination Bar (after 30 items) */}
        {filteredAppointments.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-slate-50/70 border-t border-slate-200 text-xs">
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
                className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs transition"
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
                        className={`w-7 h-7 rounded-lg font-bold transition flex items-center justify-center cursor-pointer shadow-2xs ${
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
                className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs transition"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Clinical Summary Modal */}
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
