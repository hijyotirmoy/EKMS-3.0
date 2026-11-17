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
import { AppointmentRecord, isDispensaryMatch, AppointmentVitals } from "@/lib/appointmentTypes";
import { logUserActivity } from "@/lib/activityLogger";
import { createDispensaryNotification } from "@/lib/notificationService";
import {
  UserCheck,
  Search,
  Clock,
  Phone,
  User,
  HeartPulse,
  Activity,
  CheckCircle2,
  AlertCircle,
  X,
  Stethoscope,
  ChevronRight,
  Building2,
  Calendar,
  Copy,
  Check,
  Edit3,
  FileText,
  Thermometer,
  Pill,
} from "lucide-react";
import Link from "next/link";
import { ClinicalSummaryModal } from "@/components/appointments/ClinicalSummaryModal";

export default function ReceptionDeskPage() {
  const { user, userProfile, isAdmin } = useAuth();
  const { toast } = usePopup();

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
  const [activeTab, setActiveTab] = useState<"queue" | "checked_in">("queue");

  // Check-In Modal State
  const [checkInModalOpen, setCheckInModalOpen] = useState(false);
  const [activePatient, setActivePatient] = useState<AppointmentRecord | null>(null);
  const [receptionNotes, setReceptionNotes] = useState("");
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

  // Listen to live dispensary appointments
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
          list.push({ id: d.id, ...d.data() } as AppointmentRecord);
        });
        setAppointments(list);
        setLoading(false);
      },
      (err) => {
        console.warn("Reception live sync warning:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // Scoped to staff's allotted dispensary
  const scopedList = useMemo(() => {
    return appointments.filter((app) => {
      if (isDispensaryStaff && staffDispensary) {
        if (!isDispensaryMatch(app.dispensaryName, staffDispensary, app.dispensaryId, userProfile?.dispensaryId)) {
          return false;
        }
      }
      if (selectedDate && app.date !== selectedDate) return false;
      return true;
    });
  }, [appointments, isDispensaryStaff, staffDispensary, userProfile?.dispensaryId, selectedDate]);

  // Filtered by search & queue tab
  // For Admin account: put all appointments that are not completed (with recip, with doc, with pharma, or in any stage!)
  const queuePatients = useMemo(() => {
    if (isAdmin) {
      return scopedList.filter((a) => a.status !== "completed" && a.status !== "cancelled");
    }
    return scopedList.filter((a) => a.status === "scheduled");
  }, [scopedList, isAdmin]);

  const checkedInPatients = useMemo(() => {
    if (isAdmin) {
      return scopedList.filter((a) => a.status === "completed");
    }
    return scopedList.filter(
      (a) => a.status === "with_doctor" || a.status === "visited" || a.status === "pharmacy_queue" || a.status === "completed"
    );
  }, [scopedList, isAdmin]);

  const currentList = activeTab === "queue" ? queuePatients : checkedInPatients;

  const displayList = useMemo(() => {
    if (!searchTerm.trim()) return currentList;
    const q = searchTerm.toLowerCase().trim();
    return currentList.filter(
      (a) =>
        (a.tokenNo || "").toLowerCase().includes(q) ||
        (a.ipName || "").toLowerCase().includes(q) ||
        (a.phone || "").includes(q) ||
        (a.purpose || "").toLowerCase().includes(q)
    );
  }, [currentList, searchTerm]);

  // Open check-in modal
  const handleOpenCheckIn = (patient: AppointmentRecord) => {
    if (patient.status === "completed") {
      toast.info("This visit has already been completed and finalized. Reception records cannot be edited.");
      return;
    }
    setActivePatient(patient);
    setReceptionNotes(patient.visitedNotes || "");
    setCheckInModalOpen(true);
  };

  // Submit check-in -> Send to Doctor Desk
  const handleConfirmCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePatient) return;
    if (activePatient.status === "completed") {
      toast.error("This visit is completed and locked. Remarks cannot be modified.");
      setCheckInModalOpen(false);
      return;
    }
    setSubmitting(true);

    try {
      const docRef = doc(bookingDb, "dispensary_appointments", activePatient.id);
      await updateDoc(docRef, {
        status: "with_doctor",
        visitedAt: Date.now(),
        visitedBy: userProfile?.displayName || userProfile?.name || user?.email || "Receptionist",
        visitedNotes: receptionNotes.trim(),
        receptionCheckedInAt: Date.now(),
        receptionCheckedInBy: userProfile?.displayName || userProfile?.name || user?.email || "Receptionist",
        updatedAt: Date.now(),
      });

      // Real-time notification delivered to the Doctor of that dispensary
      createDispensaryNotification({
        targetDispensary: activePatient.dispensaryName || staffDispensary,
        targetDispensaryRole: "Doctor",
        title: "Patient Ready for Consultation",
        message: `${activePatient.ipName} (${activePatient.tokenNo}) has checked in at Reception and is waiting for clinical consultation.`,
        link: "/dispensary/doctor",
        tokenNo: activePatient.tokenNo,
      }).catch((e) => console.warn("Doctor notification dispatch warning:", e));

      logUserActivity(user?.email, {
        desc: `Reception Check-in: ${activePatient.ipName} (Token ${activePatient.tokenNo}) sent to Doctor queue`,
        type: "edit",
      });

      toast.success(`Patient Checked In! Forwarded to Doctor consultation queue.`);
      setCheckInModalOpen(false);
      setActivePatient(null);
    } catch (err: any) {
      toast.error("Check-in failed: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header (Clean without box) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dispensary Reception Desk</h1>
        </div>

        {staffDispensary && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-50 border border-teal-200/90 text-teal-900 text-xs font-semibold shadow-2xs self-start sm:self-auto">
            <Building2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
            <span>Dispensary: <strong className="text-slate-800 font-bold">{staffDispensary}</strong></span>
          </div>
        )}
      </div>

      {/* 2. Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 select-none">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              {isAdmin ? "Active OPD Queue" : "Awaiting Check-In"}
            </div>
            <div className="text-2xl font-black text-amber-600 mt-0.5">{queuePatients.length}</div>
            <div className="text-[11px] text-slate-400 mt-1">
              {isAdmin ? "Uncompleted in all desks" : "Pending arrival at reception"}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              {isAdmin ? "Completed Visits" : "Checked In / With Doctor"}
            </div>
            <div className="text-2xl font-black text-blue-600 mt-0.5">{checkedInPatients.length}</div>
            <div className="text-[11px] text-slate-400 mt-1">
              {isAdmin ? "Consultations & medicines dispensed" : "Vitals recorded & queued"}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
            <Stethoscope className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs col-span-2 sm:col-span-1 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              {selectedDate === todayStr
                ? "Total Scheduled Today"
                : selectedDate === tomorrowStr
                ? "Total Scheduled Tomorrow"
                : !selectedDate
                ? "Total Scheduled (All Dates)"
                : `Total Scheduled (${selectedDate})`}
            </div>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{scopedList.length}</div>
            <div className="text-[11px] text-slate-400 mt-1">Registered for OPD</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600 shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 3. Filter & Tabs Bar */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-3 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab("queue")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === "queue"
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {isAdmin ? `Active Queue (${queuePatients.length})` : `Arrival Queue (${queuePatients.length})`}
          </button>
          <button
            onClick={() => setActiveTab("checked_in")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === "checked_in"
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {isAdmin ? `Completed Visits (${checkedInPatients.length})` : `Checked-In (${checkedInPatients.length})`}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:w-60 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by patient, token, phone..."
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

      {/* 4. Patients Queue List */}
      {loading ? (
        <div className="text-center py-16 text-slate-400 text-xs">Loading dispensary arrival queue...</div>
      ) : displayList.length === 0 ? (
        <div className="p-12 text-center bg-white border border-slate-200/80 rounded-2xl space-y-2">
          <UserCheck className="w-8 h-8 text-slate-300 mx-auto" />
          <div className="text-sm font-bold text-slate-700">
            {activeTab === "queue" ? "No patients waiting in arrival queue" : "No checked-in patients for this date"}
          </div>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Appointments booked from EKMS Triage or the portal will automatically appear here for reception check-in.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
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

                  {/* Beautiful Status Badge (Top-Right) */}
                  <div className="shrink-0">
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
                        <span>WITH DOCTOR</span>
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

                {/* 2. Body: Patient info, Complaint, Vitals, Action button */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pt-3">
                  <div className="space-y-2 flex-1 min-w-0">
                    {/* Patient Identification Line */}
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="text-base font-extrabold text-slate-900">{app.ipName}</h3>
                      {app.age && (
                        <span className="text-xs text-slate-500">
                          ({app.age} yrs, {app.gender || "Male"})
                        </span>
                      )}
                      <span className="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded font-semibold">
                        IP: {app.ipNumber || "N/A"}
                      </span>
                      {app.phone && (
                        <span className="text-xs text-slate-600 flex items-center gap-1 font-medium">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span>{app.phone}</span>
                        </span>
                      )}
                    </div>

                    {/* Clinical Context: Chief Complaint (No Dispensary Name) */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 font-medium">
                      <Activity className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                      <span>Chief Complaint: <strong className="text-slate-900 font-bold">{app.chiefComplaint || app.purpose || "General OPD"}</strong></span>
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

                  {/* 3. Action Area on Right */}
                  <div className="shrink-0 self-start sm:self-center pt-1 sm:pt-0 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSummaryApp(app);
                        setSummaryModalOpen(true);
                      }}
                      className="px-3 py-1.5 text-blue-700 hover:bg-blue-50 border border-blue-200 bg-blue-50/40 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95"
                      title="View Clinical Summary"
                    >
                      <FileText className="w-3.5 h-3.5 text-blue-600" />
                      <span>Clinical summary</span>
                    </button>

                    {!isCompleted && (
                      app.status === "scheduled" ? (
                        <button
                          onClick={() => handleOpenCheckIn(app)}
                          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer active:scale-95"
                        >
                          <UserCheck className="w-4 h-4" />
                          <span>Check In Patient</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleOpenCheckIn(app)}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-100 hover:bg-blue-50/70 text-slate-700 hover:text-blue-700 font-bold text-xs rounded-xl border border-slate-200 transition-colors cursor-pointer shadow-2xs"
                          title="Edit reception remarks & vitals"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                          <span>Edit Remarks</span>
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. Check-In Modal */}
      {checkInModalOpen && activePatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xl max-w-lg w-full p-6 space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Reception Check-In</h4>
                  <p className="text-[11px] text-slate-500">Verify arriving patient and queue for Doctor.</p>
                </div>
              </div>
              <button
                onClick={() => setCheckInModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Patient Header Summary */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs">
              <div>
                <div className="font-bold text-slate-900">{activePatient.ipName}</div>
                <div className="text-slate-500 font-mono text-[11px]">
                  Token: {activePatient.tokenNo} • Phone: {activePatient.phone}
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-blue-600">{activePatient.timeSlot}</div>
                <div className="text-slate-400 text-[11px]">{activePatient.date}</div>
              </div>
            </div>

            <form onSubmit={handleConfirmCheckIn} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Reception Notes / Remarks
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Patient arrived on time with previous ESIC card."
                  value={receptionNotes}
                  onChange={(e) => setReceptionNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 font-medium resize-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCheckInModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>{submitting ? "Checking In..." : "Check In & Send to Doctor"}</span>
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
