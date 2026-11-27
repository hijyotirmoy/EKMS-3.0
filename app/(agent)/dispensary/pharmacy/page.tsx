"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  query,
  orderBy,
  limit,
  where,
  getDocs,
} from "firebase/firestore";
import { db, bookingDb } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { AppointmentRecord, isDispensaryMatch, isNonClinicalAppointment, formatStaffTimestamp } from "@/lib/appointmentTypes";
import { logUserActivity } from "@/lib/activityLogger";
import { syncAppointmentUpdateToSheet } from "@/lib/googleSheetsSync";
import {
  Pill,
  Search,
  Clock,
  Phone,
  User,
  CheckCircle2,
  AlertCircle,
  X,
  Stethoscope,
  Calendar,
  Building2,
  FileText,
  CheckSquare,
  Square,
  PackageCheck,
  Copy,
  Check,
  Activity,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { ClinicalSummaryModal } from "@/components/appointments/ClinicalSummaryModal";
import { useStaffDirectory } from "@/lib/useStaffDirectory";
import { extractIpNumber } from "@/lib/appointmentTypes";
import { maskDispensaryIpNumber, maskDispensaryMobile, isDispensaryStaffAccount } from "@/lib/maskUtils";

export default function PharmacyDeskPage() {
  const { user, userProfile } = useAuth();
  const { toast } = usePopup();
  const { getStaffName, getDoctorName } = useStaffDirectory();
  const isStaff = isDispensaryStaffAccount(userProfile) || (userProfile?.role !== "Admin" && userProfile?.role !== "Master Admin");

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

  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });

  // Sync date filter with mini-bar icons
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ekms-date-filter-change", { detail: selectedDate }));
    }
  }, [selectedDate]);
  const [activeTab, setActiveTab] = useState<"pending_dispensation" | "completed">("pending_dispensation");

  // Dispense Modal State
  const [dispenseModalOpen, setDispenseModalOpen] = useState(false);
  const [activePatient, setActivePatient] = useState<AppointmentRecord | null>(null);
  const [dispensedItems, setDispensedItems] = useState<{ [index: number]: boolean }>({});
  const [dispensationNotes, setDispensationNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Clinical Summary Modal State
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [selectedSummaryApp, setSelectedSummaryApp] = useState<AppointmentRecord | null>(null);

  const handleCopy = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success(`Copied Token: ${text}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const staffDispensary = (userProfile as any)?.dispensaryName || "";
  const isDispensaryStaff = Boolean(staffDispensary);

  // Live query from bookingDb
  useEffect(() => {
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
            id: d.id,
            ...data,
            ipNumber: extractIpNumber(data),
            ipName: data.ipName || data.patientName || "Beneficiary",
          } as AppointmentRecord);
        });
        setAppointments(list);
        setLoading(false);
      },
      (err) => {
        console.warn("Pharmacy desk live sync warning:", err);
        setLoading(false);
      }
    );

    return () => {
      try {
        if (typeof unsub === "function") unsub();
      } catch (_) {}
    };
  }, []);

  // Filter by dispensary and date
  const scopedList = useMemo(() => {
    return appointments.filter((apt) => {
      // Non-clinical bookings are handled solely at Reception and never routed to Pharmacy
      if (isNonClinicalAppointment(apt)) return false;

      if (isDispensaryStaff && !isDispensaryMatch(apt.dispensaryName, staffDispensary)) {
        return false;
      }
      return true;
    });
  }, [appointments, isDispensaryStaff, staffDispensary]);

  const filteredList = useMemo(() => {
    return scopedList.filter((apt) => {
      // Tab filter
      if (activeTab === "pending_dispensation" && apt.status !== "pharmacy_queue") {
        return false;
      }
      if (activeTab === "completed" && apt.status !== "completed") {
        return false;
      }

      // Date filter
      const aptDate = apt.date || apt.appointmentDate || "";
      if (selectedDate && aptDate !== selectedDate) {
        return false;
      }

      // Search term
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const tNo = apt.tokenNo || apt.token || "";
        const pName = apt.ipName || apt.patientName || "";
        const pPhone = apt.phone || apt.patientPhone || "";
        const matchToken = tNo.toLowerCase().includes(q);
        const matchName = pName.toLowerCase().includes(q);
        const matchPhone = pPhone.toLowerCase().includes(q);
        const matchIp = apt.ipNumber?.toLowerCase().includes(q);
        const matchDiag = apt.diagnosis?.toLowerCase().includes(q);
        if (!matchToken && !matchName && !matchPhone && !matchIp && !matchDiag) {
          return false;
        }
      }

      return true;
    });
  }, [scopedList, activeTab, selectedDate, searchTerm]);

  // Counts
  const counts = useMemo(() => {
    let pending = 0;
    let completed = 0;
    scopedList.forEach((apt) => {
      const aptDate = apt.date || apt.appointmentDate || "";
      const isDate = !selectedDate || aptDate === selectedDate;
      if (!isDate) return;
      if (apt.status === "pharmacy_queue") pending++;
      if (apt.status === "completed") completed++;
    });
    return { pending, completed };
  }, [scopedList, selectedDate]);

  const openDispenseModal = (patient: AppointmentRecord) => {
    if (patient.status === "completed") {
      toast.info("This visit has already been completed and finalized. Records cannot be edited.");
      return;
    }
    setActivePatient(patient);
    // Initialize all medicines as checked
    const initialChecked: { [index: number]: boolean } = {};
    if (patient.prescriptions && patient.prescriptions.length > 0) {
      patient.prescriptions.forEach((_, idx) => {
        initialChecked[idx] = true;
      });
    }
    setDispensedItems(initialChecked);
    setDispensationNotes("");
    setDispenseModalOpen(true);
  };

  const toggleItemChecked = (idx: number) => {
    setDispensedItems((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const handleCompleteDispensation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePatient) return;
    if (activePatient.status === "completed") {
      toast.error("This visit has already been finalized and locked.");
      setDispenseModalOpen(false);
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const pharmacistName =
        userProfile?.displayName?.trim() ||
        userProfile?.name?.trim() ||
        (userProfile as any)?.fullName?.trim() ||
        user?.displayName?.trim() ||
        "Pharmacist";

      const updatedPrescriptions = (activePatient.prescriptions || []).map((rx) => ({
        ...rx,
        dispensed: true,
      }));

      const docRef = doc(bookingDb, "dispensary_appointments", activePatient.id);
      await updateDoc(docRef, {
        status: "completed",
        prescriptions: updatedPrescriptions,
        dispensedAt: now,
        dispensedBy: pharmacistName,
        dispensedByEmail: user?.email || "",
        dispensationNotes: dispensationNotes.trim(),
        updatedAt: now,
      });

      // Synchronize to main db and any duplicate token entries across all databases
      const tIdentifier = activePatient.tokenNo || activePatient.referenceNo;
      if (tIdentifier) {
        try {
          const qB = query(collection(bookingDb, "dispensary_appointments"), where("tokenNo", "==", tIdentifier));
          const snapB = await getDocs(qB);
          snapB.forEach(async (d) => {
            if (d.id !== activePatient.id) {
              await updateDoc(d.ref, {
                status: "completed",
                prescriptions: updatedPrescriptions,
                dispensedAt: now,
                dispensedBy: pharmacistName,
                dispensationNotes: dispensationNotes.trim(),
                updatedAt: now,
              }).catch(() => {});
            }
          });
        } catch (e) {}

        try {
          const docRefDb = doc(db, "dispensary_appointments", activePatient.id);
          await updateDoc(docRefDb, {
            status: "completed",
            prescriptions: updatedPrescriptions,
            dispensedAt: now,
            dispensedBy: pharmacistName,
            dispensationNotes: dispensationNotes.trim(),
            updatedAt: now,
          }).catch(() => {});
        } catch (e) {}
      }

      // Automatically sync completed dispensation to Google Sheets
      syncAppointmentUpdateToSheet(
        activePatient,
        {
          status: "completed",
          dispensedBy: pharmacistName,
          dispensedAt: now,
          dispensationNotes: dispensationNotes.trim(),
        },
        pharmacistName
      ).catch((e) => console.warn("Google Sheet pharmacy sync notice:", e));

      const pName = activePatient.ipName || activePatient.patientName || "Patient";
      const tNo = activePatient.tokenNo || activePatient.token || "N/A";

      logUserActivity(user?.email, {
        desc: `Pharmacy Dispensed Medicines: ${pName} (Token ${tNo}), visit completed`,
        type: "edit",
      });

      toast.success(`Visit completed for token ${tNo}. Marked as dispensed successfully.`);

      setDispenseModalOpen(false);
      setActivePatient(null);
    } catch (err: any) {
      console.error("Dispense completion error:", err);
      toast.error(err.message || "Failed to update pharmacy record");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header (Clean without box) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dispensary Pharmacy Desk</h1>
        </div>

        {staffDispensary && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-50 border border-teal-200/90 text-teal-900 text-xs font-semibold shadow-2xs self-start sm:self-auto">
            <Building2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
            <span>Dispensary: <strong className="text-slate-800 font-bold">{staffDispensary}</strong></span>
          </div>
        )}
      </div>

      {/* 2. Top Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 select-none">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Awaiting Dispensation</div>
            <div className="text-2xl font-black text-amber-600 mt-0.5">{counts.pending}</div>
            <div className="text-[11px] text-slate-400 mt-1">Doctor consulted, awaiting Rx</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
            <Pill className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Completed / Dispensed</div>
            <div className="text-2xl font-black text-emerald-600 mt-0.5">{counts.completed}</div>
            <div className="text-[11px] text-slate-400 mt-1">Medicines handed over</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs col-span-2 sm:col-span-1 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              {selectedDate === todayStr
                ? "Total Patients Today"
                : selectedDate === tomorrowStr
                ? "Total Patients Tomorrow"
                : !selectedDate
                ? "Total Patients (All Dates)"
                : `Total Patients (${selectedDate})`}
            </div>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{scopedList.length}</div>
            <div className="text-[11px] text-slate-400 mt-1">Registered for OPD</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600 shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 3. Filter Bar */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-3 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab("pending_dispensation")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === "pending_dispensation"
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Awaiting Dispensation ({counts.pending})
          </button>
          <button
            onClick={() => setActiveTab("completed")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === "completed"
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Completed / Dispensed ({counts.completed})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:w-60 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search patient, complaint, token..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-teal-500 font-medium"
            />
          </div>

          {/* Quick Date Filters: Today, Tomorrow, All, Custom Picker */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl text-xs font-bold gap-1 shadow-2xs">
              <button
                type="button"
                onClick={() => setSelectedDate(todayStr)}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  selectedDate === todayStr
                    ? "bg-white text-teal-700 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(tomorrowStr)}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  selectedDate === tomorrowStr
                    ? "bg-white text-teal-700 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Tomorrow
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate("")}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  !selectedDate
                    ? "bg-white text-teal-700 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                All
              </button>
            </div>

            {/* Custom Date Input */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-semibold shrink-0 transition-all shadow-2xs ${
                selectedDate && selectedDate !== todayStr && selectedDate !== tomorrowStr
                  ? "bg-teal-50 border-teal-300 text-teal-900 ring-2 ring-teal-500/10"
                  : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-teal-600 shrink-0" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent outline-none cursor-pointer text-xs"
                title="Pick specific date"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 4. Patients Queue List */}
      {loading ? (
        <div className="text-center py-16 text-slate-400 text-xs">Loading pharmacy queue...</div>
      ) : filteredList.length === 0 ? (
        <div className="p-12 text-center bg-white border border-slate-200/80 rounded-2xl space-y-2">
          <Pill className="w-8 h-8 text-slate-300 mx-auto" />
          <div className="text-sm font-bold text-slate-700">
            {activeTab === "pending_dispensation"
              ? "No patients waiting for medicine dispensation"
              : "No completed dispensary visits found for this date"}
          </div>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {activeTab === "pending_dispensation"
              ? "Once a doctor completes consultation and prescribes medications, the patient will appear in this queue immediately."
              : "Completed visits with dispensed prescriptions will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredList.map((apt) => {
            const isCompleted = apt.status === "completed";
            const isInPharmacy = apt.status === "pharmacy_queue";
            const tNo = apt.tokenNo || apt.token || "N/A";

            return (
              <div
                key={apt.id}
                className={`bg-white border rounded-2xl p-4 sm:p-5 transition-all shadow-2xs hover:shadow-xs border-l-4 ${
                  isCompleted
                    ? "border-slate-200 border-l-emerald-500"
                    : isInPharmacy
                    ? "border-slate-200 border-l-purple-500"
                    : "border-slate-200 border-l-amber-400"
                }`}
              >
                {/* 1. Header Row: Token & Time on Left, Status Badge on Right */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      onClick={() => handleCopy(tNo, apt.id)}
                      className="px-2.5 py-1 bg-teal-50/70 hover:bg-teal-100 text-teal-800 border border-teal-200 rounded-lg text-xs font-mono font-extrabold flex items-center gap-1.5 cursor-pointer transition-colors"
                      title="Click to copy token"
                    >
                      <span>Token: {tNo}</span>
                      {copiedId === apt.id ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3 text-teal-500" />
                      )}
                    </span>

                    {/* Beautiful Dispensary Name Badge */}
                    {apt.dispensaryName && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-teal-50 text-teal-800 border border-teal-200/90 rounded-lg text-xs font-bold shadow-2xs">
                        <Building2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        <span>{apt.dispensaryName}</span>
                      </span>
                    )}

                    <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>Slot: {apt.date || apt.appointmentDate} • {apt.timeSlot}</span>
                    </span>
                  </div>

                  {/* Beautiful Clinical summary & Status Badge (Top-Right) */}
                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSummaryApp(apt);
                        setSummaryModalOpen(true);
                      }}
                      className="px-2.5 py-1 text-blue-700 hover:bg-blue-50 border border-blue-200 bg-blue-50/40 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95"
                      title={isNonClinicalAppointment(apt) ? "View Non-Clinical Summary" : "View Clinical Summary"}
                    >
                      <FileText className="w-3.5 h-3.5 text-blue-600" />
                      <span>{isNonClinicalAppointment(apt) ? "Non-Clinical summary" : "Clinical summary"}</span>
                    </button>

                    {isCompleted ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-full text-xs font-black uppercase tracking-wider shadow-2xs">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>VISIT COMPLETED</span>
                      </span>
                    ) : isInPharmacy ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-50 text-purple-800 border border-purple-300 rounded-full text-xs font-black uppercase tracking-wider shadow-2xs">
                        <Pill className="w-3.5 h-3.5 text-purple-600" />
                        <span>WITH PHARMACIST</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-800 border border-amber-300 rounded-full text-xs font-black uppercase tracking-wider shadow-2xs">
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        <span>SCHEDULED</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* 2. Body: Header Row with Demographics on Left, Actions on Right */}
                <div className="pt-3 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1.5 flex-1 min-w-0">
                      {/* Patient Identification Line */}
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="text-base font-extrabold text-slate-900">{apt.ipName || apt.patientName}</h3>
                        {(apt.age || apt.patientAge) && (
                          <span className="text-xs text-slate-500">
                            ({apt.age || apt.patientAge} yrs, {apt.gender || apt.patientGender || "Male"})
                          </span>
                        )}
                        <span className="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded font-semibold">
                          IP: {isStaff ? maskDispensaryIpNumber(apt.ipNumber) : (apt.ipNumber || "N/A")}
                        </span>
                        {(apt.phone || apt.patientPhone) && (
                          <span className="text-xs text-slate-600 flex items-center gap-1 font-medium">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span>{isStaff ? maskDispensaryMobile(apt.phone || apt.patientPhone) : (apt.phone || apt.patientPhone)}</span>
                          </span>
                        )}
                      </div>

                      {/* Clinical Context: Chief Complaint */}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 font-medium">
                        <span className="flex items-center gap-1">
                          <Activity className="w-3.5 h-3.5 text-blue-500" />
                          <span>Chief Complaint: <strong className="text-slate-900 font-bold">{apt.chiefComplaint || apt.purpose || "General Health Check"}</strong></span>
                        </span>
                      </div>

                      {/* Audit Lines: Clean Plain Text (No Boxes) */}
                      <div className="text-xs text-slate-700 space-y-1 pt-0.5">
                        {/* Receptionist Audit Line */}
                        {(apt.receptionCheckedInBy || apt.visitedBy) && (
                          <div className="flex flex-wrap items-center gap-1">
                            <UserCheck className="w-3.5 h-3.5 text-blue-600 inline shrink-0" />
                            <span className="font-semibold text-slate-800">
                              Reception by {getStaffName(apt.receptionCheckedInBy || apt.visitedBy)}
                            </span>
                            {formatStaffTimestamp(apt.receptionCheckedInAt || apt.visitedAt || (apt.status !== "scheduled" ? (apt.updatedAt || (apt as any).createdAt) : null)) && (
                              <span className="font-normal text-slate-500">
                                , {formatStaffTimestamp(apt.receptionCheckedInAt || apt.visitedAt || (apt.status !== "scheduled" ? (apt.updatedAt || (apt as any).createdAt) : null))}
                              </span>
                            )}
                            {(apt.visitedNotes || (apt as any).receptionNotes) && (apt.visitedNotes || (apt as any).receptionNotes).trim() && (
                              <span className="text-slate-500 font-normal pl-1">
                                • Note: {(apt.visitedNotes || (apt as any).receptionNotes).trim()}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Doctor Audit Line */}
                        {(apt.doctorName || apt.doctorNotes) && (
                          <div className="flex flex-wrap items-center gap-1">
                            <Stethoscope className="w-3.5 h-3.5 text-indigo-600 inline shrink-0" />
                            <span className="font-semibold text-slate-800">
                              Prescribed by {getDoctorName(apt.doctorName)}
                              {apt.consultationType && (
                                <span className="text-blue-700 font-bold"> ({apt.consultationType})</span>
                              )}
                            </span>
                            {formatStaffTimestamp(apt.doctorConsultedAt || (apt.status === "pharmacy_queue" || apt.status === "completed" ? apt.updatedAt : null)) && (
                              <span className="font-normal text-slate-500">
                                , {formatStaffTimestamp(apt.doctorConsultedAt || (apt.status === "pharmacy_queue" || apt.status === "completed" ? apt.updatedAt : null))}
                              </span>
                            )}
                            {apt.doctorNotes && apt.doctorNotes.trim() && (
                              <span className="text-slate-500 font-normal pl-1">
                                • Note: {apt.doctorNotes}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Pharmacist Audit Line */}
                        {apt.dispensedBy && (
                          <div className="flex flex-wrap items-center gap-1">
                            <PackageCheck className="w-3.5 h-3.5 text-teal-600 inline shrink-0" />
                            <span className="font-semibold text-slate-800">
                              Dispensed by {getStaffName(apt.dispensedBy)}
                            </span>
                            {formatStaffTimestamp(apt.dispensedAt || (apt.status === "completed" ? apt.updatedAt : null)) && (
                              <span className="font-normal text-slate-500">
                                , {formatStaffTimestamp(apt.dispensedAt || (apt.status === "completed" ? apt.updatedAt : null))}
                              </span>
                            )}
                            {apt.dispensationNotes && apt.dispensationNotes.trim() && (
                              <span className="text-slate-500 font-normal pl-1">
                                • Note: {apt.dispensationNotes}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Button on Right (Below top status row) */}
                    <div className="shrink-0 self-start sm:self-center pt-1 sm:pt-0">
                      {!isCompleted && isInPharmacy && (
                        <button
                          onClick={() => openDispenseModal(apt)}
                          className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer active:scale-95"
                        >
                          <PackageCheck className="w-4 h-4" />
                          <span>Mark as Dispensed</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dispense Modal */}
      {dispenseModalOpen && activePatient && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-800">
                  Verify & Dispense Medicines
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Token: <span className="font-mono font-bold text-slate-700">{activePatient.tokenNo || activePatient.token}</span> &bull; {activePatient.ipName || activePatient.patientName} ({activePatient.age || activePatient.patientAge || "-"}y, {activePatient.gender || activePatient.patientGender || "-"})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSummaryApp(activePatient);
                    setSummaryModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-blue-700 hover:bg-blue-50 border border-blue-200 bg-blue-50/50 rounded-lg text-xs font-bold transition shadow-2xs cursor-pointer active:scale-95"
                  title={isNonClinicalAppointment(activePatient) ? "View Triage Non-Clinical Summary" : "View Triage Clinical Summary"}
                >
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  <span>{isNonClinicalAppointment(activePatient) ? "Non-Clinical summary" : "Clinical summary"}</span>
                </button>
                <button
                  onClick={() => setDispenseModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleCompleteDispensation} className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Doctor's Consultation Summary */}
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span className="flex items-center gap-1.5">
                    <Stethoscope className="w-4 h-4 text-teal-600" />
                    Doctor Consultation Summary
                  </span>
                  {activePatient.doctorName && (
                    <span className="text-[11px] text-slate-500">
                      Prescribed by {getDoctorName(activePatient.doctorName)}
                      {activePatient.consultationType && (
                        <span className="text-blue-700 font-bold"> ({activePatient.consultationType})</span>
                      )}
                      {formatStaffTimestamp(activePatient.doctorConsultedAt) ? ` , ${formatStaffTimestamp(activePatient.doctorConsultedAt)}` : ""}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-800">
                  <span className="text-slate-500">Chief Complaint:</span>{" "}
                  <span className="font-medium">{activePatient.chiefComplaint || activePatient.purpose || "General Health Check"}</span>
                </div>
                {activePatient.doctorNotes && (
                  <div className="text-xs text-slate-600">
                    <span className="text-slate-500">Doctor Advice:</span> {activePatient.doctorNotes}
                  </div>
                )}
              </div>

              {/* Pharmacist Remarks */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Pharmacist Remarks / Patient Instructions (Optional)
                </label>
                <textarea
                  rows={2}
                  value={dispensationNotes}
                  onChange={(e) => setDispensationNotes(e.target.value)}
                  placeholder="e.g. Advised to take Paracetamol after food. Warned against abrupt stoppage of BP medication."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500 text-slate-800 placeholder-slate-400"
                />
              </div>

              {/* Modal Footer */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDispenseModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-700 text-white shadow-xs transition-colors disabled:opacity-50"
                >
                  <PackageCheck className="w-4 h-4" />
                  <span>{submitting ? "Completing..." : "Mark as Dispensed"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- CLINICAL SUMMARY MODAL (MATCHING TRIAGE FORMAT) --- */}
      <ClinicalSummaryModal
        isOpen={summaryModalOpen}
        onClose={() => {
          setSummaryModalOpen(false);
          setSelectedSummaryApp(null);
        }}
        appointment={selectedSummaryApp}
      />
    </div>
  );
}
