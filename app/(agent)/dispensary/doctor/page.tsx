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
} from "firebase/firestore";
import { bookingDb } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { AppointmentRecord, isDispensaryMatch, PrescriptionItem, isNonClinicalAppointment, formatStaffTimestamp } from "@/lib/appointmentTypes";
import { logUserActivity } from "@/lib/activityLogger";
import { createDispensaryNotification } from "@/lib/notificationService";
import {
  Stethoscope,
  Search,
  Clock,
  Phone,
  User,
  HeartPulse,
  Activity,
  CheckCircle2,
  AlertCircle,
  X,
  Pill,
  Plus,
  Trash2,
  Calendar,
  Building2,
  CalendarCheck,
  Lock,
  Send,
  Copy,
  Check,
  Thermometer,
  Edit3,
  FileText,
  UserCheck,
  PackageCheck,
} from "lucide-react";
import Link from "next/link";
import { ClinicalSummaryModal } from "@/components/appointments/ClinicalSummaryModal";
import { DoctorAvailabilityModal } from "@/components/appointments/DoctorAvailabilityModal";
import { useStaffDirectory } from "@/lib/useStaffDirectory";
import { extractIpNumber } from "@/lib/appointmentTypes";
import { maskDispensaryIpNumber, maskDispensaryMobile, isDispensaryStaffAccount } from "@/lib/maskUtils";

const COMMON_MEDICINES = [
  { name: "Tab Paracetamol 650mg", defaultDosage: "1 Tab", defaultFreq: "1-0-1 (After food)", defaultDur: "3 Days" },
  { name: "Tab Amoxicillin 500mg", defaultDosage: "1 Cap", defaultFreq: "1-0-1 (After food)", defaultDur: "5 Days" },
  { name: "Tab Pantoprazole 40mg", defaultDosage: "1 Tab", defaultFreq: "1-0-0 (Before food)", defaultDur: "7 Days" },
  { name: "Tab Cetirizine 10mg", defaultDosage: "1 Tab", defaultFreq: "0-0-1 (Night)", defaultDur: "5 Days" },
  { name: "Tab Metformin 500mg", defaultDosage: "1 Tab", defaultFreq: "1-0-1 (With meals)", defaultDur: "30 Days" },
  { name: "Tab Amlodipine 5mg", defaultDosage: "1 Tab", defaultFreq: "1-0-0 (Morning)", defaultDur: "30 Days" },
  { name: "Syp Cough Expectorant", defaultDosage: "10 ml", defaultFreq: "1-1-1 (TID)", defaultDur: "5 Days" },
  { name: "Tab B-Complex with Zinc", defaultDosage: "1 Tab", defaultFreq: "1-0-0 (After breakfast)", defaultDur: "15 Days" },
];

export default function DoctorDeskPage() {
  const { user, userProfile, isAdmin } = useAuth();
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
  const [activeTab, setActiveTab] = useState<"pending_consultation" | "consulted">("pending_consultation");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [doctorAvailabilityOpen, setDoctorAvailabilityOpen] = useState(false);

  const handleCopy = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success(`Copied Token: ${text}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Consultation Modal State
  const [consultModalOpen, setConsultModalOpen] = useState(false);
  const [activePatient, setActivePatient] = useState<AppointmentRecord | null>(null);
  const [diagnosis, setDiagnosis] = useState("");
  const [doctorNotes, setDoctorNotes] = useState("");
  const [prescriptions, setPrescriptions] = useState<PrescriptionItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Clinical Summary Modal State
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [selectedSummaryApp, setSelectedSummaryApp] = useState<AppointmentRecord | null>(null);

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
        console.warn("Doctor desk live sync warning:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // Filter by dispensary and date
  const scopedList = useMemo(() => {
    return appointments.filter((app) => {
      // Non-clinical bookings are handled solely at Reception and never routed to Doctor
      if (isNonClinicalAppointment(app)) return false;

      if (isDispensaryStaff && staffDispensary) {
        if (!isDispensaryMatch(app.dispensaryName, staffDispensary, app.dispensaryId, userProfile?.dispensaryId)) {
          return false;
        }
      }
      if (selectedDate && app.date !== selectedDate) return false;
      return true;
    });
  }, [appointments, isDispensaryStaff, staffDispensary, userProfile?.dispensaryId, selectedDate]);

  // Split into Waiting for Doctor vs Already Consulted
  const waitingPatients = useMemo(() => {
    return scopedList.filter((a) => a.status === "with_doctor" || a.status === "visited");
  }, [scopedList]);

  const consultedPatients = useMemo(() => {
    return scopedList.filter((a) => a.status === "pharmacy_queue" || a.status === "completed");
  }, [scopedList]);

  const currentList = activeTab === "pending_consultation" ? waitingPatients : consultedPatients;

  const displayList = useMemo(() => {
    if (!searchTerm.trim()) return currentList;
    const q = searchTerm.toLowerCase().trim();
    return currentList.filter(
      (a) =>
        (a.tokenNo || "").toLowerCase().includes(q) ||
        (a.ipName || "").toLowerCase().includes(q) ||
        (a.phone || "").includes(q) ||
        (a.purpose || "").toLowerCase().includes(q) ||
        (a.diagnosis || "").toLowerCase().includes(q)
    );
  }, [currentList, searchTerm]);

  const currentStaffEmail = (user?.email || "").toLowerCase().trim();
  const currentStaffName = (
    userProfile?.displayName ||
    userProfile?.name ||
    (userProfile as any)?.fullName ||
    user?.displayName ||
    ""
  ).toLowerCase().trim();

  // Helper: Check if this consultation was conducted by another doctor (blocks other doctors from editing)
  const isOtherDoctorConsultation = (patient: AppointmentRecord): boolean => {
    if (isAdmin) return false;
    const docEmail = (patient.doctorEmail || (patient as any).prescribedByEmail || "").toLowerCase().trim();
    const docName = (patient.doctorName || (patient as any).prescribedBy || "").toLowerCase().trim();
    if (!docEmail && !docName) return false;

    if (docEmail && currentStaffEmail) {
      return docEmail !== currentStaffEmail;
    }
    if (docName && currentStaffName) {
      return !docName.includes(currentStaffName) && !currentStaffName.includes(docName);
    }
    return false;
  };

  // Open consultation modal
  const handleOpenConsultation = (patient: AppointmentRecord) => {
    if (patient.status === "completed") {
      toast.info("This visit has already been completed and finalized. Records are permanently locked.");
      return;
    }
    if (isOtherDoctorConsultation(patient)) {
      toast.warning(
        `Locked: This consultation was conducted by Dr. ${patient.doctorName || "another doctor"}. Only the consulting doctor can edit this record.`
      );
      return;
    }
    setActivePatient(patient);
    setDiagnosis(patient.diagnosis || patient.chiefComplaint || patient.purpose || "");
    setDoctorNotes(patient.doctorNotes || "");
    if (patient.prescriptions && patient.prescriptions.length > 0) {
      setPrescriptions(patient.prescriptions);
    } else {
      setPrescriptions([]);
    }
    setConsultModalOpen(true);
  };

  // Add medicine row
  const handleAddMedicine = () => {
    setPrescriptions((prev) => [
      ...prev,
      { medicineName: "", dosage: "1 Tab", frequency: "1-0-1 (After food)", duration: "5 Days" },
    ]);
  };

  // Remove medicine row
  const handleRemoveMedicine = (idx: number) => {
    setPrescriptions((prev) => prev.filter((_, i) => i !== idx));
  };

  // Update medicine field
  const handleUpdateMedicine = (idx: number, field: keyof PrescriptionItem, val: string) => {
    setPrescriptions((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  };

  // Quick select common medicine
  const handleSelectCommonMedicine = (idx: number, medName: string) => {
    const template = COMMON_MEDICINES.find((m) => m.name === medName);
    if (!template) return;
    setPrescriptions((prev) => {
      const next = [...prev];
      next[idx] = {
        medicineName: template.name,
        dosage: template.defaultDosage,
        frequency: template.defaultFreq,
        duration: template.defaultDur,
      };
      return next;
    });
  };

  // Submit consultation -> Send to Pharmacy
  const handleConfirmConsultation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePatient) return;
    if (activePatient.status === "completed") {
      toast.error("This visit has already been completed and locked. Clinical records cannot be modified.");
      setConsultModalOpen(false);
      return;
    }
    if (isOtherDoctorConsultation(activePatient)) {
      toast.error(
        `Permission denied: Consultation was conducted by Dr. ${activePatient.doctorName || "another doctor"}. Only that doctor can edit this record.`
      );
      setConsultModalOpen(false);
      return;
    }

    const cleanPrescriptions = prescriptions.filter((p) => p.medicineName.trim().length > 0);

    setSubmitting(true);
    try {
      const docRef = doc(bookingDb, "dispensary_appointments", activePatient.id);
      await updateDoc(docRef, {
        status: "pharmacy_queue",
        doctorConsultedAt: Date.now(),
        doctorName:
          userProfile?.displayName?.trim() ||
          userProfile?.name?.trim() ||
          (userProfile as any)?.fullName?.trim() ||
          user?.displayName?.trim() ||
          "Medical Officer",
        doctorEmail: user?.email || "doctor@esic.gov.in",
        diagnosis: "",
        prescriptions: cleanPrescriptions,
        doctorNotes: doctorNotes.trim(),
        updatedAt: Date.now(),
      });

      // Real-time notification delivered to the Pharmacist of that dispensary
      const docDoctorName = userProfile?.displayName || userProfile?.name || "Medical Officer";
      createDispensaryNotification({
        targetDispensary: activePatient.dispensaryName || staffDispensary,
        targetDispensaryRole: "Pharmacist",
        title: "Prescription Sent to Pharmacy",
        message: `${docDoctorName} completed consultation for ${activePatient.ipName} (${activePatient.tokenNo}) with ${cleanPrescriptions.length} prescribed item(s). Ready for dispensation.`,
        link: "/dispensary/pharmacy",
        tokenNo: activePatient.tokenNo,
      }).catch((e) => console.warn("Pharmacist notification dispatch warning:", e));

      logUserActivity(user?.email, {
        desc: `Doctor Consultation Completed: ${activePatient.ipName} (Token ${activePatient.tokenNo}), sent to Pharmacy queue`,
        type: "edit",
      });

      toast.success(`Consultation recorded and forwarded to Pharmacy.`);
      setConsultModalOpen(false);
      setActivePatient(null);
    } catch (err: any) {
      toast.error("Failed to complete consultation: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header (Clean without box) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dispensary Doctor Desk</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {staffDispensary && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-50 border border-teal-200/90 text-teal-900 text-xs font-semibold shadow-2xs self-start sm:self-auto">
              <Building2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
              <span>Dispensary: <strong className="text-slate-800 font-bold">{staffDispensary}</strong></span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setDoctorAvailabilityOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-teal-50 border border-teal-200 text-teal-700 text-xs font-bold shadow-2xs transition active:scale-95 cursor-pointer"
            title="Set My Availability & Leaves"
          >
            <CalendarCheck className="w-3.5 h-3.5 text-teal-600" />
            <span>Set My Availability</span>
          </button>
        </div>
      </div>

      {/* 2. Top Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 select-none">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Awaiting Consultation</div>
            <div className="text-2xl font-black text-blue-600 mt-0.5">{waitingPatients.length}</div>
            <div className="text-[11px] text-slate-400 mt-1">Checked in by Reception</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
            <Stethoscope className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Consultations Done</div>
            <div className="text-2xl font-black text-emerald-600 mt-0.5">{consultedPatients.length}</div>
            <div className="text-[11px] text-slate-400 mt-1">Prescriptions sent to pharmacy</div>
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
            onClick={() => setActiveTab("pending_consultation")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === "pending_consultation"
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Waiting for Doctor ({waitingPatients.length})
          </button>
          <button
            onClick={() => setActiveTab("consulted")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === "consulted"
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Consulted & Rx Sent ({consultedPatients.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:w-60 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search patient, complaint, token..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 font-medium"
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
                    ? "bg-white text-blue-600 shadow-2xs"
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
                    ? "bg-white text-blue-600 shadow-2xs"
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
                    ? "bg-white text-blue-600 shadow-2xs"
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
                  ? "bg-blue-50 border-blue-300 text-blue-800 ring-2 ring-blue-500/10"
                  : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-blue-600 shrink-0" />
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

      {/* 4. Patients List */}
      {loading ? (
        <div className="text-center py-16 text-slate-400 text-xs">Loading doctor consultation queue...</div>
      ) : displayList.length === 0 ? (
        <div className="p-12 text-center bg-white border border-slate-200/80 rounded-2xl space-y-2">
          <Stethoscope className="w-8 h-8 text-slate-300 mx-auto" />
          <div className="text-sm font-bold text-slate-700">
            {activeTab === "pending_consultation"
              ? "No patients waiting for consultation"
              : "No completed consultations recorded for this date"}
          </div>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Once patients are checked in at the Reception Desk, they will immediately appear in this consultation queue.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayList.map((app) => {
            const isCompleted = app.status === "completed";
            const isInPharmacy = app.status === "pharmacy_queue";
            const isWithDoctor = app.status === "with_doctor" || app.status === "visited";
            const isCancelled = app.status === "cancelled";
            const tNo = app.tokenNo || app.referenceNo || "N/A";

            return (
              <div
                key={app.id}
                className={`bg-white border rounded-2xl p-4 sm:p-5 transition-all shadow-2xs hover:shadow-xs border-l-4 ${
                  isCompleted
                    ? "border-slate-200 border-l-emerald-500"
                    : isInPharmacy
                    ? "border-slate-200 border-l-purple-500"
                    : isWithDoctor
                    ? "border-slate-200 border-l-blue-500"
                    : isCancelled
                    ? "border-rose-200/70 border-l-rose-400 bg-slate-50/30"
                    : "border-slate-200 border-l-amber-400"
                }`}
              >
                {/* 1. Header Row: Token & Time on Left, Status Badge on Right */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      onClick={() => handleCopy(tNo, app.id)}
                      className="px-2.5 py-1 bg-teal-50/70 hover:bg-teal-100 text-teal-800 border border-teal-200 rounded-lg text-xs font-mono font-extrabold flex items-center gap-1.5 cursor-pointer transition-colors"
                      title="Click to copy token"
                    >
                      <span>Token: {tNo}</span>
                      {copiedId === app.id ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3 text-teal-500" />
                      )}
                    </span>

                    {/* Beautiful Dispensary Name Badge */}
                    {app.dispensaryName && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-teal-50 text-teal-800 border border-teal-200/90 rounded-lg text-xs font-bold shadow-2xs">
                        <Building2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        <span>{app.dispensaryName}</span>
                      </span>
                    )}

                    <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>Booked: {app.date} • {app.timeSlot}</span>
                    </span>
                  </div>

                  {/* Beautiful Clinical summary & Status Badge (Top-Right) */}
                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSummaryApp(app);
                        setSummaryModalOpen(true);
                      }}
                      className="px-2.5 py-1 text-blue-700 hover:bg-blue-50 border border-blue-200 bg-blue-50/40 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95"
                      title={isNonClinicalAppointment(app) ? "View Non-Clinical Summary" : "View Clinical Summary"}
                    >
                      <FileText className="w-3.5 h-3.5 text-blue-600" />
                      <span>{isNonClinicalAppointment(app) ? "Non-Clinical summary" : "Clinical summary"}</span>
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
                    ) : isWithDoctor ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-800 border border-blue-300 rounded-full text-xs font-black uppercase tracking-wider shadow-2xs">
                        <Stethoscope className="w-3.5 h-3.5 text-blue-600" />
                        <span>WAITING FOR DOCTOR</span>
                      </span>
                    ) : isCancelled ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-50 text-rose-800 border border-rose-300 rounded-full text-xs font-black uppercase tracking-wider shadow-2xs">
                        <X className="w-3.5 h-3.5 text-rose-600" />
                        <span>CANCELLED</span>
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
                        <h3 className="text-base font-extrabold text-slate-900">{app.ipName}</h3>
                        {app.age && (
                          <span className="text-xs text-slate-500">
                            ({app.age} yrs, {app.gender || "Male"})
                          </span>
                        )}
                        <span className="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded font-semibold">
                          IP: {isStaff ? maskDispensaryIpNumber(app.ipNumber) : (app.ipNumber || "N/A")}
                        </span>
                        {app.phone && (
                          <span className="text-xs text-slate-600 flex items-center gap-1 font-medium">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span>{isStaff ? maskDispensaryMobile(app.phone) : app.phone}</span>
                          </span>
                        )}
                      </div>

                      {/* Clinical Context: Chief Complaint */}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 font-medium">
                        <Activity className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                        <span>Chief Complaint: <strong className="text-slate-900 font-bold">{app.chiefComplaint || app.purpose}</strong></span>
                      </div>

                      {/* Audit Lines: Clean Plain Text (No Boxes) */}
                      <div className="text-xs text-slate-700 space-y-1 pt-0.5">
                        {/* Receptionist Audit Line */}
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

                        {/* Doctor Audit Line */}
                        {(app.doctorName || app.doctorNotes) && (
                          <div className="flex flex-wrap items-center gap-1">
                            <Stethoscope className="w-3.5 h-3.5 text-indigo-600 inline shrink-0" />
                            <span className="font-semibold text-slate-800">
                              Prescribed by {getDoctorName(app.doctorName)}
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

                        {/* Pharmacist Audit Line */}
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
                    </div>

                    {/* Action Button on Right (Directly below top status row) */}
                    <div className="shrink-0 self-start sm:self-center pt-1 sm:pt-0">
                      {!isCompleted && (
                        isOtherDoctorConsultation(app) ? (
                          <div
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-500 font-bold text-xs rounded-xl border border-slate-200 select-none shadow-2xs"
                            title={`Consultation conducted by Dr. ${app.doctorName || "another doctor"}. Only that doctor can edit.`}
                          >
                            <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>Consulted by {app.doctorName || "Doctor"}</span>
                          </div>
                        ) : isWithDoctor ? (
                          <button
                            onClick={() => handleOpenConsultation(app)}
                            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer active:scale-95"
                          >
                            <Stethoscope className="w-4 h-4" />
                            <span>Consult & Prescribe</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleOpenConsultation(app)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-100 hover:bg-blue-50/70 text-slate-700 hover:text-blue-700 font-bold text-xs rounded-xl border border-slate-200 transition-colors cursor-pointer shadow-2xs"
                            title="Edit diagnosis & clinical advice"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                            <span>Edit Consultation</span>
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Vitals Ribbon */}
                  {app.vitals && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Vitals:</span>
                      {app.vitals.bp && (
                        <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 font-bold px-2 py-0.5 rounded-lg border border-blue-200/80 text-xs shadow-2xs">
                          <Activity className="w-3 h-3 text-blue-600" />
                          <span>BP: {app.vitals.bp}</span>
                        </span>
                      )}
                      {app.vitals.pulse && (
                        <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-800 font-bold px-2 py-0.5 rounded-lg border border-rose-200/80 text-xs shadow-2xs">
                          <HeartPulse className="w-3 h-3 text-rose-600" />
                          <span>Pulse: {app.vitals.pulse} bpm</span>
                        </span>
                      )}
                      {app.vitals.temp && (
                        <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 font-bold px-2 py-0.5 rounded-lg border border-amber-200/80 text-xs shadow-2xs">
                          <Thermometer className="w-3 h-3 text-amber-600" />
                          <span>Temp: {app.vitals.temp}</span>
                        </span>
                      )}
                      {app.vitals.weight && (
                        <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-800 font-bold px-2 py-0.5 rounded-lg border border-emerald-200/80 text-xs shadow-2xs">
                          <span>Wt: {app.vitals.weight} kg</span>
                        </span>
                      )}
                      {app.vitals.spo2 && (
                        <span className="inline-flex items-center gap-1 bg-teal-50 text-teal-800 font-bold px-2 py-0.5 rounded-lg border border-teal-200/80 text-xs shadow-2xs">
                          <span>SpO2: {app.vitals.spo2}%</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. Consultation & Prescription Modal */}
      {consultModalOpen && activePatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xl max-w-2xl w-full p-6 space-y-5 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Stethoscope className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Clinical Consultation</h4>
                  <p className="text-[11px] text-slate-500">Record clinical diagnosis and patient advice.</p>
                </div>
              </div>
              <button
                onClick={() => setConsultModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Patient & Vitals Summary */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-900 text-sm">{activePatient.ipName}</span>
                  <span className="ml-2 text-slate-500 font-mono text-[11px]">
                    Token: {activePatient.tokenNo} • IP: {isStaff ? maskDispensaryIpNumber(activePatient.ipNumber) : (activePatient.ipNumber || "N/A")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSummaryApp(activePatient);
                      setSummaryModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-blue-700 hover:bg-blue-50 border border-blue-200 bg-blue-50/50 rounded-lg text-xs font-bold transition shadow-2xs cursor-pointer active:scale-95"
                    title={isNonClinicalAppointment(activePatient) ? "Review Triage Non-Clinical Summary" : "Review Triage Clinical Summary"}
                  >
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    <span>{isNonClinicalAppointment(activePatient) ? "Non-Clinical summary" : "Clinical summary"}</span>
                  </button>
                  <span className="text-slate-500 font-medium">
                    {activePatient.age ? `${activePatient.age} yrs` : ""} {activePatient.gender}
                  </span>
                </div>
              </div>

              {/* Triage Clinical Findings for Doctor */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
                <div className="font-bold text-slate-800 flex items-center justify-between pb-1 border-b border-slate-100">
                  <span className="flex items-center gap-1.5 text-blue-900 font-bold">
                    <HeartPulse className="w-3.5 h-3.5 text-blue-600" />
                    Triage Clinical Findings
                  </span>
                  <span className="text-[11px] font-semibold text-slate-500">
                    Duration: {activePatient.clinicalRecord?.hpiDuration || (activePatient as any).hpiDuration || "Reported today"}
                  </span>
                </div>

                <div className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-bold text-slate-700">• Chief Complaint:</span>
                  <span className="font-semibold text-slate-900">
                    {activePatient.chiefComplaint || activePatient.purpose}
                  </span>
                </div>

                <div className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-bold text-slate-700">• Clinical Red Flags:</span>
                  {Array.isArray(activePatient.redFlags) && activePatient.redFlags.length > 0 && !/none reported/i.test(String(activePatient.redFlags[0])) ? (
                    <span className="font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                      {activePatient.redFlags.map((f: any) => typeof f === 'string' ? f : f?.name || f?.label).join(', ')}
                    </span>
                  ) : (
                    <span className="text-slate-500 italic">None reported</span>
                  )}
                </div>

                {(activePatient.clinicalRecord?.associatedSymptoms || (activePatient as any).associatedSymptoms) && (
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-bold text-slate-700">• Associated Symptoms:</span>
                    <span className="text-slate-800">{activePatient.clinicalRecord?.associatedSymptoms || (activePatient as any).associatedSymptoms}</span>
                  </div>
                )}

                {(activePatient.clinicalRecord?.comorbidity || (activePatient as any).comorbidity) && (
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-bold text-slate-700">• Comorbidity:</span>
                    <span className="text-slate-800">{activePatient.clinicalRecord?.comorbidity || (activePatient as any).comorbidity}</span>
                  </div>
                )}

                {(activePatient.clinicalRecord?.medications || (activePatient as any).medications) && (
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-bold text-slate-700">• Any Medication:</span>
                    <span className="text-slate-800">{activePatient.clinicalRecord?.medications || (activePatient as any).medications}</span>
                  </div>
                )}
              </div>

              {(activePatient.receptionCheckedInBy || activePatient.visitedBy || activePatient.visitedNotes) && (
                <div className="text-slate-600 bg-white p-2.5 rounded-xl border border-slate-200 text-xs flex items-center gap-2">
                  <UserCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <div>
                    <span className="font-bold text-slate-800">
                      Reception by {getStaffName(activePatient.receptionCheckedInBy || activePatient.visitedBy || "Receptionist")}
                    </span>
                    {formatStaffTimestamp(activePatient.receptionCheckedInAt || activePatient.visitedAt) && (
                      <span className="font-normal text-slate-500">
                        , {formatStaffTimestamp(activePatient.receptionCheckedInAt || activePatient.visitedAt)}
                      </span>
                    )}
                    {(activePatient.visitedNotes || (activePatient as any).receptionNotes) && (activePatient.visitedNotes || (activePatient as any).receptionNotes).trim() && (
                      <span className="text-slate-500 font-normal"> • {(activePatient.visitedNotes || (activePatient as any).receptionNotes).trim()}</span>
                    )}
                  </div>
                </div>
              )}

              {activePatient.vitals && (activePatient.vitals.bp || activePatient.vitals.pulse) && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Vitals:</span>
                  {activePatient.vitals.bp && <span className="bg-white px-2 py-0.5 rounded border border-slate-200">BP: {activePatient.vitals.bp}</span>}
                  {activePatient.vitals.pulse && <span className="bg-white px-2 py-0.5 rounded border border-slate-200">Pulse: {activePatient.vitals.pulse}</span>}
                  {activePatient.vitals.temp && <span className="bg-white px-2 py-0.5 rounded border border-slate-200">Temp: {activePatient.vitals.temp}</span>}
                  {activePatient.vitals.weight && <span className="bg-white px-2 py-0.5 rounded border border-slate-200">Wt: {activePatient.vitals.weight}</span>}
                  {activePatient.vitals.spo2 && <span className="bg-white px-2 py-0.5 rounded border border-slate-200">SpO2: {activePatient.vitals.spo2}</span>}
                </div>
              )}
            </div>

            <form onSubmit={handleConfirmConsultation} className="space-y-4">
              {/* Doctor Clinical Advice / Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Doctor Clinical Advice & Dietary Instructions
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Adequate rest, drink warm water, review after 3 days if fever persists."
                  value={doctorNotes}
                  onChange={(e) => setDoctorNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 font-medium resize-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConsultModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submitting ? "Sending..." : "Complete Consultation & Send to Pharmacy"}</span>
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

      {/* Doctor Availability Management Modal */}
      <DoctorAvailabilityModal
        isOpen={doctorAvailabilityOpen}
        onClose={() => setDoctorAvailabilityOpen(false)}
      />
    </div>
  );
}
