"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Calendar,
  CalendarCheck,
  CalendarX,
  Clock,
  Building2,
  Stethoscope,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Search,
  Check,
} from "lucide-react";
import { collection, onSnapshot, getDocs } from "firebase/firestore";
import { db, bookingDb } from "@/lib/firebase";
import { getCachedData, setCachedData } from "@/lib/firestoreCache";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import {
  DoctorAvailabilityRecord,
  DoctorProfile,
  isDoctorUser,
  saveDoctorAvailability,
  removeDoctorAvailability,
  checkDispensaryAvailabilityForDate,
  syncDoctorsToTriageAndBookingDb,
} from "@/lib/doctorAvailability";
import { isDispensaryMatch } from "@/lib/appointmentTypes";
import { getTriageBaseUrl } from "@/lib/triageSync";

interface DoctorAvailabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetDoctor?: DoctorProfile | null;
  initialDate?: string;
}

/**
 * Bulletproof local YYYY-MM-DD formatter avoiding UTC off-by-one shifts in IST (+5:30)
 */
function getLocalDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DoctorAvailabilityModal({
  isOpen,
  onClose,
  targetDoctor = null,
  initialDate,
}: DoctorAvailabilityModalProps) {
  const { user, userProfile, isAdmin, isMasterAdmin } = useAuth();
  const { toast } = usePopup();

  const [allDoctors, setAllDoctors] = useState<DoctorProfile[]>([]);
  const [availabilityRecords, setAvailabilityRecords] = useState<DoctorAvailabilityRecord[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>("");
  const [dispensaryFilter, setDispensaryFilter] = useState<string>("all");
  const [doctorSearch, setDoctorSearch] = useState<string>("");

  // Admin View Mode: "schedule" (individual doctor calendar) vs "roster" (14-day dispensary availability overview)
  const [activeTab, setActiveTab] = useState<"schedule" | "roster">("schedule");
  const [selectedRosterDate, setSelectedRosterDate] = useState<string>(() => {
    return initialDate || getLocalDateString();
  });

  const [daysWindowStart, setDaysWindowStart] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  // Staged local state for doctor leave toggles: dateStr -> boolean (true = on leave, false = available)
  const [pendingLeaves, setPendingLeaves] = useState<Record<string, boolean>>({});

  const isAdminMode = isAdmin || isMasterAdmin;

  // 1. Fetch all doctors from users collection (cached in-memory/session for 10 mins)
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const DOCTOR_CACHE_TTL = 10 * 60 * 1000;

    const processDoctorDocs = (docsList: DoctorProfile[]) => {
      if (!isMounted) return;
      // Ensure logged-in doctor is in list
      if (!isAdminMode && userProfile && isDoctorUser(userProfile)) {
        const myEmail = (userProfile.email || user?.email || userProfile.id || "").toLowerCase();
        if (!docsList.some((doc) => doc.email === myEmail)) {
          docsList.unshift({
            id: userProfile.id || myEmail,
            email: myEmail,
            displayName: userProfile.displayName || userProfile.name || "Doctor",
            name: userProfile.name,
            role: userProfile.role || "Dispensary Staff",
            dispensaryRole: userProfile.dispensaryRole || "Doctor",
            dispensaryName: userProfile.dispensaryName || "",
            dispensaryId: userProfile.dispensaryId || "",
            phone: userProfile.phone || "",
          });
        }
      }

      setAllDoctors(docsList);
      syncDoctorsToTriageAndBookingDb(docsList);

      if (targetDoctor) {
        setSelectedDoctorId((targetDoctor.email || targetDoctor.id).toLowerCase());
      } else if (!isAdminMode && userProfile) {
        setSelectedDoctorId((userProfile.email || user?.email || userProfile.id || "").toLowerCase());
      } else if (docsList.length > 0 && !selectedDoctorId) {
        setSelectedDoctorId(docsList[0].email);
      }
    };

    const cachedDocs = getCachedData<DoctorProfile[]>("modal_doctor_profiles", DOCTOR_CACHE_TTL);
    if (cachedDocs && cachedDocs.length > 0) {
      processDoctorDocs(cachedDocs);
    } else {
      getDocs(collection(db, "users"))
        .then((snap) => {
          if (!isMounted) return;
          const docs: DoctorProfile[] = [];
          snap.forEach((d) => {
            const data = d.data();
            if (isDoctorUser(data)) {
              docs.push({
                id: d.id,
                email: (data.email || d.id).toLowerCase(),
                displayName: data.displayName || data.name || (data.email || d.id).split("@")[0],
                name: data.name,
                role: data.role || "Dispensary Staff",
                dispensaryRole: data.dispensaryRole || "Doctor",
                dispensaryName: data.dispensaryName || "",
                dispensaryId: data.dispensaryId || "",
                phone: data.phone || data.mobile || "",
              });
            }
          });
          setCachedData("modal_doctor_profiles", docs);
          processDoctorDocs(docs);
        })
        .catch((err) => console.warn("Fetch doctors error:", err));
    }

    // 2. Real-time availability records listener (stays 100% live sync!)
    const activeDb = bookingDb || db;
    const unsubAvail = onSnapshot(
      collection(activeDb, "doctor_availability"),
      (snap) => {
        const records: DoctorAvailabilityRecord[] = [];
        snap.forEach((d) => {
          records.push({ id: d.id, ...(d.data() as any) });
        });
        if (isMounted) setAvailabilityRecords(records);
      },
      (err) => {
        console.warn("doctor_availability live listener notice:", err);
      }
    );

    return () => {
      isMounted = false;
      unsubAvail();
    };
  }, [isOpen, targetDoctor, userProfile, isAdminMode, user?.email]);

  useEffect(() => {
    if (allDoctors.length > 0 && !selectedDoctorId) {
      if (!isAdminMode && userProfile) {
        const myEmail = (userProfile.email || user?.email || "").toLowerCase();
        const found = allDoctors.find((d) => d.email === myEmail);
        setSelectedDoctorId(found ? found.email : allDoctors[0].email);
      } else {
        setSelectedDoctorId(allDoctors[0].email);
      }
    }
  }, [allDoctors, selectedDoctorId, isAdminMode, userProfile, user?.email]);

  const currentDoctor = useMemo(() => {
    if (!selectedDoctorId) return null;
    return (
      allDoctors.find(
        (d) =>
          d.email.toLowerCase() === selectedDoctorId.toLowerCase() ||
          d.id.toLowerCase() === selectedDoctorId.toLowerCase()
      ) || null
    );
  }, [allDoctors, selectedDoctorId]);

  // Current doctor's committed records from database
  const currentDoctorRecords = useMemo(() => {
    if (!currentDoctor) return [];
    const docEmail = currentDoctor.email.toLowerCase();
    const docId = currentDoctor.id.toLowerCase();
    return availabilityRecords
      .filter(
        (r) =>
          r.doctorEmail?.toLowerCase() === docEmail ||
          r.doctorId?.toLowerCase() === docId ||
          r.doctorId?.toLowerCase() === docEmail
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [availabilityRecords, currentDoctor]);

  // Sync initial pending state whenever selected doctor changes or records are refreshed
  useEffect(() => {
    if (!currentDoctor) {
      setPendingLeaves({});
      return;
    }
    const map: Record<string, boolean> = {};
    currentDoctorRecords.forEach((r) => {
      if (r.date) {
        map[r.date] = r.isAvailable === false;
      }
    });
    setPendingLeaves(map);
  }, [currentDoctor?.email, currentDoctorRecords]);

  const uniqueDispensaries = useMemo(() => {
    const set = new Set<string>();
    allDoctors.forEach((d) => {
      if (d.dispensaryName) set.add(d.dispensaryName);
    });
    return Array.from(set).sort();
  }, [allDoctors]);

  const filteredDoctors = useMemo(() => {
    return allDoctors.filter((d) => {
      if (dispensaryFilter !== "all" && !isDispensaryMatch(d.dispensaryName, dispensaryFilter, d.dispensaryId)) {
        return false;
      }
      if (doctorSearch.trim()) {
        const q = doctorSearch.toLowerCase().trim();
        const matchName = (d.displayName || d.name || "").toLowerCase().includes(q);
        const matchEmail = d.email.toLowerCase().includes(q);
        const matchDisp = (d.dispensaryName || "").toLowerCase().includes(q);
        return matchName || matchEmail || matchDisp;
      }
      return true;
    });
  }, [allDoctors, dispensaryFilter, doctorSearch]);

  // 14-Day Calendar Dates (Accurate local day calculation using noon base to prevent UTC shifts)
  const upcomingDays = useMemo(() => {
    const list: { dateStr: string; dayName: string; formatted: string; isPast: boolean }[] = [];
    const base = new Date();
    base.setHours(12, 0, 0, 0);

    for (let i = daysWindowStart; i < daysWindowStart + 14; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const dateStr = getLocalDateString(d);
      const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
      const formatted = d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
      list.push({
        dateStr,
        dayName,
        formatted,
        isPast: i < 0,
      });
    }
    return list;
  }, [daysWindowStart]);

  // Handle clicking a doctor card in Schedule tab: toggles locally without saving yet
  const handleBoxClick = (dateStr: string) => {
    setPendingLeaves((prev) => {
      const currentlyOnLeave = Boolean(prev[dateStr]);
      return {
        ...prev,
        [dateStr]: !currentlyOnLeave,
      };
    });
  };

  // Check if any date has uncommitted changes compared to DB
  const hasChanges = useMemo(() => {
    if (!currentDoctor) return false;
    const dbLeaveSet = new Set(
      currentDoctorRecords.filter((r) => r.isAvailable === false).map((r) => r.date)
    );

    for (const [date, isLeave] of Object.entries(pendingLeaves)) {
      const inDb = dbLeaveSet.has(date);
      if (isLeave !== inDb) return true;
    }
    for (const date of Array.from(dbLeaveSet)) {
      if (!pendingLeaves[date]) return true;
    }
    return false;
  }, [pendingLeaves, currentDoctorRecords, currentDoctor]);

  // Click DONE: Commit all changes in batch, notify user, and close
  const handleDone = async () => {
    if (!currentDoctor || !hasChanges) {
      onClose();
      return;
    }

    setSaving(true);
    const dbLeaveSet = new Set(
      currentDoctorRecords.filter((r) => r.isAvailable === false).map((r) => r.date)
    );

    const promises: Promise<any>[] = [];
    let addedLeavesCount = 0;
    let removedLeavesCount = 0;

    for (const [date, isLeave] of Object.entries(pendingLeaves)) {
      const wasInDb = dbLeaveSet.has(date);
      if (isLeave && !wasInDb) {
        addedLeavesCount++;
        promises.push(
          saveDoctorAvailability({
            doctorId: currentDoctor.id || currentDoctor.email,
            doctorName: currentDoctor.displayName || currentDoctor.name || "Doctor",
            doctorEmail: currentDoctor.email,
            dispensaryName: currentDoctor.dispensaryName,
            dispensaryId: currentDoctor.dispensaryId,
            date,
            isAvailable: false,
            reason: "On Leave",
            updatedBy: user?.email || "doctor",
          })
        );
      } else if (!isLeave && wasInDb) {
        removedLeavesCount++;
        promises.push(removeDoctorAvailability(currentDoctor.email, date));
      }
    }

    try {
      await Promise.all(promises);

      // Also broadcast batch update to Triage API
      try {
        const triageUrl = `${getTriageBaseUrl()}/api/doctor-availability`;

        fetch(triageUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            doctors: allDoctors,
            records: Object.entries(pendingLeaves).map(([date, isLeave]) => ({
              doctorId: currentDoctor.id || currentDoctor.email,
              doctorName: currentDoctor.displayName || currentDoctor.name || "Doctor",
              doctorEmail: currentDoctor.email,
              dispensaryName: currentDoctor.dispensaryName,
              dispensaryId: currentDoctor.dispensaryId,
              date,
              isAvailable: !isLeave,
              reason: isLeave ? "On Leave" : "Available",
            })),
          }),
        }).catch(() => {});
      } catch (_) {}

      const changesText = [
        addedLeavesCount > 0 ? `${addedLeavesCount} date(s) marked On Leave` : "",
        removedLeavesCount > 0 ? `${removedLeavesCount} date(s) marked Available` : "",
      ]
        .filter(Boolean)
        .join(", ");

      toast.success(
        changesText
          ? `${currentDoctor.displayName}: ${changesText}`
          : "Availability updated successfully!"
      );
      onClose();
    } catch (err: any) {
      console.error("Batch availability commit error:", err);
      toast.error("Failed to save changes: " + (err.message || "Unknown error"));
    } finally {
      setSaving(false);
    }
  };

  // --- 14-DAYS ROSTER AGGREGATION BASED ON DISPENSARY FILTER ---
  // Calculates for each of the 14 days: total doctors, available doctors, on-leave doctors
  const roster14DaysData = useMemo(() => {
    // Filter doctors based on current dispensary filter (scoped to doctor's own dispensary in doctor mode)
    const effectiveDispensary = isAdminMode
      ? dispensaryFilter
      : (currentDoctor?.dispensaryName || userProfile?.dispensaryName || "all");

    const targetDoctors = allDoctors.filter((doc) => {
      if (effectiveDispensary === "all") return true;
      return isDispensaryMatch(doc.dispensaryName, effectiveDispensary, doc.dispensaryId);
    });

    const daysMap = upcomingDays.map((day) => {
      const dateStr = day.dateStr;
      let availableCount = 0;
      let onLeaveCount = 0;

      targetDoctors.forEach((doc) => {
        const docId = (doc.email || doc.id).toLowerCase();
        const docName = (doc.displayName || doc.name || docId).toLowerCase();

        const rec = availabilityRecords.find((r) => {
          const matchDoc =
            (r.doctorId || "").toLowerCase() === docId ||
            (r.doctorEmail || "").toLowerCase() === docId ||
            (r.doctorName || "").toLowerCase() === docName;
          return matchDoc && r.date === dateStr;
        });

        if (rec && rec.isAvailable === false) {
          onLeaveCount++;
        } else {
          availableCount++;
        }
      });

      return {
        ...day,
        totalDoctors: targetDoctors.length,
        availableCount,
        onLeaveCount,
      };
    });

    return {
      targetDoctors,
      daysMap,
    };
  }, [upcomingDays, allDoctors, availabilityRecords, dispensaryFilter, isAdminMode, currentDoctor?.dispensaryName, userProfile?.dispensaryName]);

  // Breakdown for the currently selected roster date
  const selectedDateBreakdown = useMemo(() => {
    const targetDate = selectedRosterDate;
    const effectiveDispensary = isAdminMode
      ? dispensaryFilter
      : (currentDoctor?.dispensaryName || userProfile?.dispensaryName || "all");

    const targetDispensaries =
      effectiveDispensary === "all"
        ? uniqueDispensaries
        : uniqueDispensaries.filter((d) => isDispensaryMatch(d, effectiveDispensary));

    return targetDispensaries.map((dispName) => {
      const status = checkDispensaryAvailabilityForDate(
        dispName,
        targetDate,
        allDoctors,
        availabilityRecords
      );

      const doctorsAtDisp = allDoctors.filter((d) =>
        isDispensaryMatch(d.dispensaryName, dispName, d.dispensaryId)
      );

      const doctorStatuses = doctorsAtDisp.map((doc) => {
        const docId = (doc.email || doc.id).toLowerCase();
        const docName = (doc.displayName || doc.name || docId).toLowerCase();
        const rec = availabilityRecords.find((r) => {
          const matchDoc =
            (r.doctorId || "").toLowerCase() === docId ||
            (r.doctorEmail || "").toLowerCase() === docId ||
            (r.doctorName || "").toLowerCase() === docName;
          return matchDoc && r.date === targetDate;
        });
        const isLeave = rec && rec.isAvailable === false;
        return {
          doc,
          isAvailable: !isLeave,
          reason: isLeave ? rec?.reason || "On Leave" : "Available",
        };
      });

      const noDoctorOnLeave = status.totalDoctors > 0 && status.unavailableDoctorsCount === 0;

      return {
        dispensaryName: dispName,
        status,
        noDoctorOnLeave,
        doctorStatuses,
      };
    });
  }, [selectedRosterDate, dispensaryFilter, uniqueDispensaries, allDoctors, availabilityRecords, isAdminMode, currentDoctor?.dispensaryName, userProfile?.dispensaryName]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200 select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/90 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header with Navigation & Tab Switcher (Admin) */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center border border-teal-100 shadow-2xs">
              <CalendarCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                Doctor Availability
              </h2>
            </div>

            {/* Tab Switcher (Doctor Calendar & 14-Day Roster View) */}
            <div className="ml-2 inline-flex items-center p-0.5 bg-slate-100 rounded-lg text-xs font-bold">
              <button
                type="button"
                onClick={() => setActiveTab("schedule")}
                className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                  activeTab === "schedule"
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Doctor Calendar
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("roster")}
                className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                  activeTab === "roster"
                    ? "bg-white text-teal-700 shadow-2xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                14-Day Roster View
              </button>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* TAB 1: INDIVIDUAL DOCTOR CALENDAR (Click Box to Toggle -> Done) */}
          {activeTab === "schedule" && (
            <>
              {/* Admin Doctor Switcher */}
              {isAdminMode && (
                <div className="p-3 bg-slate-50/80 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Stethoscope className="w-3.5 h-3.5 text-teal-600" />
                      Select Doctor
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={doctorSearch}
                          onChange={(e) => setDoctorSearch(e.target.value)}
                          placeholder="Search doctor..."
                          className="pl-7 pr-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-800 outline-none focus:border-teal-500 w-32 sm:w-40"
                        />
                      </div>
                      <select
                        value={dispensaryFilter}
                        onChange={(e) => setDispensaryFilter(e.target.value)}
                        className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 outline-none cursor-pointer max-w-[160px]"
                      >
                        <option value="all">All Dispensaries</option>
                        {uniqueDispensaries.map((disp) => (
                          <option key={disp} value={disp}>
                            {disp}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-0.5">
                    {filteredDoctors.map((doc) => {
                      const isSelected = selectedDoctorId.toLowerCase() === doc.email.toLowerCase();
                      return (
                        <button
                          key={doc.id || doc.email}
                          type="button"
                          onClick={() => setSelectedDoctorId(doc.email.toLowerCase())}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer border ${
                            isSelected
                              ? "bg-teal-600 text-white border-teal-700 shadow-2xs"
                              : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          {doc.displayName || doc.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Current Doctor Summary Bar */}
              {currentDoctor && (
                <div className="p-3 bg-teal-50/50 border border-teal-100 rounded-xl flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                      {currentDoctor.displayName.replace(/^dr\.?\s*/i, "").slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{currentDoctor.displayName}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-teal-100 text-teal-800">
                          Doctor
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 font-medium flex items-center gap-1.5 mt-0.5">
                        <Building2 className="w-3 h-3 text-teal-600 shrink-0" />
                        <span>{currentDoctor.dispensaryName}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right text-xs">
                    <span className="text-slate-500">Click any date box to toggle </span>
                    <span className="font-bold text-teal-700">Available</span> /{" "}
                    <span className="font-bold text-rose-700">On Leave</span>
                  </div>
                </div>
              )}

              {/* Next 14 Days Interactive Calendar Grid (Click Box to Toggle) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-teal-600" />
                    Next 14 Days
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setDaysWindowStart((prev) => Math.max(-14, prev - 7))}
                      className="p-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-600 transition cursor-pointer"
                      title="Previous 7 days"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDaysWindowStart(0)}
                      className="px-2 py-0.5 text-[10px] font-bold rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 transition cursor-pointer"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => setDaysWindowStart((prev) => prev + 7)}
                      className="p-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-600 transition cursor-pointer"
                      title="Next 7 days"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                  {upcomingDays.map((day) => {
                    const isOnLeave = Boolean(pendingLeaves[day.dateStr]);

                    return (
                      <button
                        key={day.dateStr}
                        type="button"
                        onClick={() => handleBoxClick(day.dateStr)}
                        disabled={saving}
                        className={`p-3 rounded-xl border text-center transition flex flex-col items-center justify-between gap-1.5 cursor-pointer select-none active:scale-95 shadow-2xs ${
                          isOnLeave
                            ? "bg-rose-50 hover:bg-rose-100/80 border-rose-300 text-rose-950 ring-2 ring-rose-400/30"
                            : "bg-white hover:bg-emerald-50/50 border-slate-200 hover:border-emerald-300 text-slate-800"
                        }`}
                      >
                        <div className="text-[10px] font-bold text-slate-400 uppercase">{day.dayName}</div>
                        <div className="text-sm font-black text-slate-900">{day.formatted}</div>

                        {isOnLeave ? (
                          <span className="text-[10px] font-extrabold text-rose-700 bg-rose-100 border border-rose-300 rounded-md px-2 py-0.5">
                            On Leave
                          </span>
                        ) : (
                          <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-0.5">
                            Available
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* TAB 2: 14-DAYS ROSTER VIEW BASED ON DISPENSARY FILTER */}
          {activeTab === "roster" && (
            <div className="space-y-4">
              {/* Dispensary Filter Header */}
              <div className="p-3 bg-slate-50/80 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-2.5">
                {isAdminMode ? (
                  <div className="flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-teal-600 shrink-0" />
                    <span className="text-xs font-bold text-slate-700">Filter Dispensary:</span>
                    <select
                      value={dispensaryFilter}
                      onChange={(e) => setDispensaryFilter(e.target.value)}
                      className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none cursor-pointer"
                    >
                      <option value="all">All Dispensaries ({uniqueDispensaries.length})</option>
                      {uniqueDispensaries.map((disp) => (
                        <option key={disp} value={disp}>
                          {disp}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-teal-600 shrink-0" />
                    <span className="text-xs font-bold text-slate-700">Dispensary Roster:</span>
                    <span className="text-xs font-extrabold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-lg">
                      {currentDoctor?.dispensaryName || userProfile?.dispensaryName || "My Dispensary"}
                    </span>
                  </div>
                )}

                <div className="text-xs text-slate-500 font-medium">
                  Click any date card below to inspect doctors
                </div>
              </div>

              {/* 14-Days Roster Grid (Matching the Doctor Calendar!) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-teal-600" />
                    14-Day Roster Availability Grid
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setDaysWindowStart((prev) => Math.max(-14, prev - 7))}
                      className="p-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-600 transition cursor-pointer"
                      title="Previous 7 days"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDaysWindowStart(0)}
                      className="px-2 py-0.5 text-[10px] font-bold rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 transition cursor-pointer"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => setDaysWindowStart((prev) => prev + 7)}
                      className="p-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-600 transition cursor-pointer"
                      title="Next 7 days"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                  {roster14DaysData.daysMap.map((day) => {
                    const isSelected = selectedRosterDate === day.dateStr;
                    const isZeroAvailable = day.availableCount === 0;

                    return (
                      <button
                        key={day.dateStr}
                        type="button"
                        onClick={() => setSelectedRosterDate(day.dateStr)}
                        className={`p-3 rounded-xl border text-center transition flex flex-col items-center justify-between gap-1.5 cursor-pointer select-none active:scale-95 shadow-2xs ${
                          isSelected ? "ring-2 ring-teal-600 shadow-md" : ""
                        } ${
                          isZeroAvailable
                            ? "bg-rose-50 hover:bg-rose-100/90 border-rose-300 text-rose-950"
                            : day.onLeaveCount > 0
                            ? "bg-amber-50/60 hover:bg-amber-100/70 border-amber-300 text-amber-950"
                            : "bg-white hover:bg-emerald-50/50 border-slate-200 hover:border-emerald-300 text-slate-800"
                        }`}
                      >
                        <div className="text-[10px] font-bold text-slate-400 uppercase">{day.dayName}</div>
                        <div className="text-sm font-black text-slate-900">{day.formatted}</div>

                        {/* Available Doctors Count Pill */}
                        {isZeroAvailable ? (
                          <span className="text-[10px] font-extrabold text-rose-700 bg-rose-100/90 border border-rose-300 rounded-md px-1.5 py-0.5">
                            0 Available
                          </span>
                        ) : (
                          <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-1.5 py-0.5">
                            {day.availableCount} Available
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Detailed Breakdown for the Selected Date */}
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    Doctor Status for {selectedRosterDate}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Selected from 14-day grid above
                  </span>
                </div>

                <div className="space-y-2.5 max-h-[38vh] overflow-y-auto pr-1">
                  {selectedDateBreakdown.map((item) => (
                    <div
                      key={item.dispensaryName}
                      className="p-3 bg-white border border-slate-200 rounded-xl space-y-2 shadow-2xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                          <span className="font-extrabold text-xs text-slate-900">
                            {item.dispensaryName}
                          </span>
                        </div>

                        {/* Status Pill */}
                        {item.noDoctorOnLeave ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span>No Doctor on Leave (Full Staff)</span>
                          </span>
                        ) : item.status.isAvailable ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-amber-600" />
                            <span>
                              Open ({item.status.availableDoctorsCount} on duty,{" "}
                              {item.status.unavailableDoctorsCount} on leave)
                            </span>
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-800 border border-rose-200 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 text-rose-600" />
                            <span>Dispensary Closed (0 Available)</span>
                          </span>
                        )}
                      </div>

                      {/* Doctors list at this dispensary */}
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        {item.doctorStatuses.map(({ doc, isAvailable, reason }) => (
                          <div
                            key={doc.id || doc.email}
                            className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs ${
                              isAvailable
                                ? "bg-emerald-50/50 border-emerald-200 text-emerald-950 font-medium"
                                : "bg-rose-50 border-rose-200 text-rose-950 font-semibold"
                            }`}
                          >
                            <div
                              className={`w-2 h-2 rounded-full ${
                                isAvailable ? "bg-emerald-500" : "bg-rose-500"
                              }`}
                            />
                            <span>{doc.displayName || doc.name}</span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                                isAvailable
                                  ? "bg-white text-emerald-700 border border-emerald-200"
                                  : "bg-rose-100 text-rose-800 border border-rose-200"
                              }`}
                            >
                              {isAvailable ? "Available" : "On Leave"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer: Done Button */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {activeTab === "schedule" && hasChanges && (
              <span className="font-semibold text-teal-700">
                You have unsaved changes. Click Done to save.
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleDone}
            disabled={saving}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-2xs cursor-pointer active:scale-95"
          >
            {saving ? "Saving..." : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
