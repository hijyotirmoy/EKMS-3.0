"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  runTransaction,
  arrayUnion,
  arrayRemove,
  setDoc,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { DayAvailability, BookingRecord } from "@/lib/types";
import { getISTMidnight } from "@/lib/utils";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Ticket,
  CalendarDays,
  CalendarCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  Search,
  X,
  Copy,
  Check,
  Trash2,
  Lock,
} from "lucide-react";

interface FlattenedBooking extends BookingRecord {
  dateKey: string;
}

export default function AgentBookingPage() {
  const { user, isLoggedIn, openLoginModal } = useAuth();
  const { toast } = usePopup();
  const [liveBookings, setLiveBookings] = useState<Record<string, DayAvailability>>({});
  const [calendarDate, setCalendarDate] = useState(new Date());

  // Views & Filters
  const [tableView, setTableView] = useState<"all" | "my">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "upcoming" | "followup" | "visited">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // Modals
  const [bookModalDate, setBookModalDate] = useState<string | null>(null);
  const [ipName, setIpName] = useState("");
  const [ipPhone, setIpPhone] = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);

  // Reschedule Modal
  const [rescheduleData, setRescheduleData] = useState<{
    oldDateKey: string;
    record: BookingRecord;
  } | null>(null);
  const [rsMonthDate, setRsMonthDate] = useState(new Date());
  const [rsSelectedDate, setRsSelectedDate] = useState<string | null>(null);
  const [rsLoading, setRsLoading] = useState(false);

  // Cancel Modal
  const [cancelData, setCancelData] = useState<{
    dateKey: string;
    record: BookingRecord;
  } | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // Visit Modal
  const [visitData, setVisitData] = useState<{
    dateKey: string;
    record: BookingRecord;
  } | null>(null);
  const [visitLoading, setVisitLoading] = useState(false);

  // Copy indicator
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [rescheduledByMeCount, setRescheduledByMeCount] = useState(0);

  // 1. Live Snapshot Listener with cache-first instant render
  useEffect(() => {
    const cached = sessionStorage.getItem("ekms_bookings_cache");
    if (cached) {
      try {
        setLiveBookings(JSON.parse(cached));
      } catch (e) {}
    }

    const unsubscribe = onSnapshot(
      collection(db, "bookings"),
      (snapshot) => {
        const data: Record<string, DayAvailability> = {};
        snapshot.forEach((doc) => {
          data[doc.id] = doc.data() as DayAvailability;
        });
        setLiveBookings(data);

        try {
          sessionStorage.setItem("ekms_bookings_cache", JSON.stringify(data));
        } catch (e) {}
      },
      (err) => console.error("Bookings sync error:", err)
    );

    return () => unsubscribe();
  }, []);

  // 2. Fetch Reschedule Logs for user
  useEffect(() => {
    if (!user?.email) return;
    const fetchLogs = async () => {
      try {
        const q = query(collection(db, "rescheduleLogs"), where("actionBy", "==", user.email));
        const snap = await getDocs(q);
        setRescheduledByMeCount(snap.size);
      } catch (e) {
        console.error("Reschedule count error:", e);
      }
    };
    fetchLogs();
  }, [user]);

  // 3. Process Flattened Bookings & Metrics
  const { allBookings, myBookings, metrics } = useMemo(() => {
    const all: FlattenedBooking[] = [];
    const my: FlattenedBooking[] = [];
    const myEmail = user?.email?.toLowerCase() || "";

    const todayObj = new Date();
    const currentYear = todayObj.getFullYear();
    const currentMonth = todayObj.getMonth();
    const currentDay = todayObj.getDate();

    const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
    const nextMonthYear = currentMonth === 11 ? currentYear + 1 : currentYear;

    const istMidnight = getISTMidnight();

    const dayOfWeek = todayObj.getDay();
    const distToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startOfWeek = new Date(todayObj);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(todayObj.getDate() - distToMonday);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    let totalMy = 0;
    let monthMy = 0;
    let nextMonthMy = 0;
    let weekMy = 0;
    let todayMy = 0;
    let visitedMy = 0;
    let delayedMy = 0;

    Object.keys(liveBookings).forEach((dateKey) => {
      const dayData = liveBookings[dateKey];
      if (dayData.bookedRecords && Array.isArray(dayData.bookedRecords)) {
        const [y, m] = dateKey.split("-").map(Number);

        dayData.bookedRecords.forEach((record) => {
          const isMine = record.agentEmail?.toLowerCase() === myEmail;
          const cleanName = record.agentEmail
            ? record.agentEmail.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
            : "Agent";

          const flatItem: FlattenedBooking = {
            ...record,
            dateKey,
            agentName: cleanName,
          };

          all.push(flatItem);

          if (isMine) {
            my.push(flatItem);
            totalMy++;

            if (y === currentYear && m - 1 === currentMonth) monthMy++;
            if (y === nextMonthYear && m - 1 === nextMonth) nextMonthMy++;

            const bookedTime = new Date(record.timestamp);
            if (bookedTime >= startOfWeek && bookedTime <= endOfWeek) weekMy++;
            if (
              bookedTime.getFullYear() === currentYear &&
              bookedTime.getMonth() === currentMonth &&
              bookedTime.getDate() === currentDay
            ) {
              todayMy++;
            }

            if (record.visited) {
              visitedMy++;
            } else {
              const schedDate = new Date(dateKey);
              schedDate.setHours(0, 0, 0, 0);
              if (schedDate < istMidnight) delayedMy++;
            }
          }
        });
      }
    });

    all.sort((a, b) => b.timestamp - a.timestamp);
    my.sort((a, b) => b.timestamp - a.timestamp);

    return {
      allBookings: all,
      myBookings: my,
      metrics: {
        totalMy,
        monthMy,
        nextMonthMy,
        weekMy,
        todayMy,
        visitedMy,
        delayedMy,
        rescheduledByMeCount,
      },
    };
  }, [liveBookings, user, rescheduledByMeCount]);

  // 4. Filtered Table Data
  const displayedBookings = useMemo(() => {
    let list = tableView === "all" ? allBookings : myBookings;
    const istMidnight = getISTMidnight();

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      list = list.filter(
        (b) =>
          b.ipName?.toLowerCase().includes(q) ||
          b.phone?.toLowerCase().includes(q) ||
          b.agentName?.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== "all") {
      list = list.filter((b) => {
        if (statusFilter === "visited") return !!b.visited;
        if (b.visited) return false;

        const schedDate = new Date(b.dateKey);
        schedDate.setHours(0, 0, 0, 0);

        if (statusFilter === "followup") return schedDate < istMidnight;
        if (statusFilter === "upcoming") return schedDate >= istMidnight;
        return true;
      });
    }

    return list;
  }, [tableView, allBookings, myBookings, searchTerm, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(displayedBookings.length / itemsPerPage));
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return displayedBookings.slice(start, start + itemsPerPage);
  }, [displayedBookings, currentPage]);

  // Copy text helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // --- 5. BOOKING SUBMIT TRANSACTION ---
  const handleExecuteBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookModalDate || !user) return;
    if (!ipName.trim() || !ipPhone.trim() || ipPhone.trim().length < 10) {
      toast.warning("Please provide a valid IP/IW Name and at least a 10-digit Phone Number.");
      return;
    }

    setBookingLoading(true);
    const docRef = doc(db, "bookings", bookModalDate);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists()) throw new Error("Schedule date not found.");

        const currentSeats = snap.data().seats || 0;
        if (currentSeats <= 0) throw new Error("Sorry, the last seat on this date was just taken!");

        tx.update(docRef, {
          seats: currentSeats - 1,
          bookedRecords: arrayUnion({
            agentEmail: user.email?.toLowerCase(),
            ipName: ipName.trim(),
            phone: ipPhone.trim(),
            timestamp: Date.now(),
          }),
        });
      });

      setBookModalDate(null);
      setIpName("");
      setIpPhone("");
      toast.success("Seat booked successfully!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to complete booking.");
    } finally {
      setBookingLoading(false);
    }
  };

  // --- 6. RESCHEDULE TRANSACTION ---
  const handleExecuteReschedule = async () => {
    if (!rescheduleData || !rsSelectedDate || !user) return;
    if (rescheduleData.oldDateKey === rsSelectedDate) {
      toast.warning("Please select a different date than the current one.");
      return;
    }

    setRsLoading(true);
    const oldDocRef = doc(db, "bookings", rescheduleData.oldDateKey);
    const newDocRef = doc(db, "bookings", rsSelectedDate);

    try {
      await runTransaction(db, async (tx) => {
        const oldSnap = await tx.get(oldDocRef);
        const newSnap = await tx.get(newDocRef);

        if (!newSnap.exists() || (newSnap.data().seats || 0) <= 0) {
          throw new Error("No available seats on the selected date.");
        }
        if (!oldSnap.exists()) throw new Error("Original booking date not found.");

        const oldRecords: BookingRecord[] = oldSnap.data().bookedRecords || [];
        const target = oldRecords.find(
          (r) =>
            r.timestamp === rescheduleData.record.timestamp &&
            r.agentEmail?.toLowerCase() === rescheduleData.record.agentEmail?.toLowerCase()
        );

        if (!target) throw new Error("Original booking record was not found.");

        // 1. Remove from old & return seat
        tx.update(oldDocRef, {
          seats: (oldSnap.data().seats || 0) + 1,
          bookedRecords: arrayRemove(target),
        });

        // 2. Add to new & take seat
        tx.update(newDocRef, {
          seats: (newSnap.data().seats || 0) - 1,
          bookedRecords: arrayUnion({
            ...target,
            rescheduled: true,
          }),
        });

        // 3. Add to rescheduleLogs
        const logRef = doc(collection(db, "rescheduleLogs"));
        tx.set(logRef, {
          ipName: target.ipName,
          seatOwner: target.agentEmail,
          originalDate: rescheduleData.oldDateKey,
          newDate: rsSelectedDate,
          actionBy: user.email?.toLowerCase(),
          timestamp: Date.now(),
        });
      });

      setRescheduleData(null);
      setRsSelectedDate(null);
      toast.success("Booking successfully rescheduled!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Reschedule failed.");
    } finally {
      setRsLoading(false);
    }
  };

  // --- 7. CANCEL TRANSACTION ---
  const handleExecuteCancel = async () => {
    if (!cancelData || !user) return;
    setCancelLoading(true);

    const docRef = doc(db, "bookings", cancelData.dateKey);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists()) throw new Error("Schedule not found.");

        const records: BookingRecord[] = snap.data().bookedRecords || [];
        const target = records.find(
          (r) =>
            r.timestamp === cancelData.record.timestamp &&
            r.agentEmail?.toLowerCase() === cancelData.record.agentEmail?.toLowerCase()
        );

        if (target) {
          tx.update(docRef, {
            seats: (snap.data().seats || 0) + 1,
            bookedRecords: arrayRemove(target),
          });
        }
      });

      setCancelData(null);
      toast.success("Booking removed and seat released.");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to remove booking.");
    } finally {
      setCancelLoading(false);
    }
  };

  // --- 8. TOGGLE VISITED STATUS ---
  const handleToggleVisitedAgent = async (b: BookingRecord) => {
    if (!b.dateKey) return;
    const docRef = doc(db, "bookings", b.dateKey);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists()) throw new Error("Schedule not found.");

        const records: BookingRecord[] = snap.data().bookedRecords || [];
        const index = records.findIndex(
          (r) =>
            r.timestamp === b.timestamp &&
            r.agentEmail?.toLowerCase() === b.agentEmail?.toLowerCase()
        );

        if (index !== -1) {
          const updated = [...records];
          updated[index] = { ...updated[index], visited: !b.visited };
          tx.update(docRef, { bookedRecords: updated });
        }
      });

      toast.success(b.visited ? "Booking marked as active." : "Booking marked as visited.");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to update status.");
    }
  };

  // Deprecated modal runner preserved for modal compatibility
  const handleExecuteVisit = async () => {
    if (!visitData) return;
    await handleToggleVisitedAgent(visitData.record);
    setVisitData(null);
  };

  // Month navigation
  const nextMonthDate = useMemo(() => {
    const d = new Date(calendarDate);
    d.setMonth(d.getMonth() + 1);
    return d;
  }, [calendarDate]);

  // Render Calendar Grid Helper
  const renderCalendarMonth = (targetDate: Date) => {
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const istMidnight = getISTMidnight();

    const dayBoxes = [];

    // Blank padding boxes
    for (let i = 0; i < firstDayIndex; i++) {
      dayBoxes.push(<div key={`empty-${i}`} className="h-14 bg-slate-50/50 rounded-lg border border-transparent" />);
    }

    // Days
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dbInfo = liveBookings[dateKey] || { seats: 0 };
      const boxDate = new Date(year, month, day);
      const isPast = boxDate < istMidnight;
      const isAvailable = !isPast && dbInfo.seats > 0;

      dayBoxes.push(
        <button
          key={dateKey}
          onClick={() => {
            if (!isLoggedIn) {
              openLoginModal();
              return;
            }
            if (isPast) {
              toast.warning("You cannot book a seat for a past date.");
              return;
            }
            if (dbInfo.seats <= 0) {
              toast.warning("No seats available for this date.");
              return;
            }
            setBookModalDate(dateKey);
            setIpName("");
            setIpPhone("");
          }}
          disabled={!isAvailable}
          className={`h-14 p-1.5 rounded-lg border flex flex-col items-center justify-between relative transition-all text-left ${
            isPast
              ? "bg-slate-50 border-slate-200 text-slate-400 opacity-60 cursor-not-allowed"
              : isAvailable
              ? "bg-emerald-50/70 border-emerald-200 text-emerald-800 hover:bg-emerald-100/80 hover:scale-[1.02] shadow-xs cursor-pointer"
              : "bg-rose-50/60 border-rose-200 text-rose-700 opacity-80 cursor-not-allowed"
          }`}
        >
          <span className="text-[10px] font-bold self-start">{day}</span>
          <div className="text-center my-auto">
            <div className="text-base font-extrabold leading-none">{dbInfo.seats}</div>
          </div>
          {dbInfo.text && (
            <span className="text-[8px] italic text-slate-500 truncate w-full text-center">
              {dbInfo.text}
            </span>
          )}
        </button>
      );
    }

    return (
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex-1">
        <h3 className="text-sm font-bold text-center text-slate-800 mb-3 flex items-center justify-center gap-2">
          <CalendarIcon className="w-4 h-4 text-amber-500" />
          <span>{monthNames[month]} {year}</span>
        </h3>
        <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
          <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
        </div>
        <div className="grid grid-cols-7 gap-1.5">{dayBoxes}</div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Bookings
          </h1>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 px-3.5 py-2 rounded-xl shadow-xs self-start">
          <Clock className="w-4 h-4 text-blue-600" />
          <span>
            Today:{" "}
            {new Date().toLocaleDateString("en-US", {
              timeZone: "Asia/Kolkata",
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
      </div>

      {/* 8 Metric KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="bg-amber-50/70 border border-amber-200 p-3.5 rounded-xl flex flex-col justify-between">
          <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wider truncate">Total (Mine)</div>
          <div className="text-xl font-extrabold text-amber-900 mt-1">{metrics.totalMy}</div>
        </div>
        <div className="bg-blue-50/70 border border-blue-200 p-3.5 rounded-xl flex flex-col justify-between">
          <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider truncate">This Month</div>
          <div className="text-xl font-extrabold text-blue-900 mt-1">{metrics.monthMy}</div>
        </div>
        <div className="bg-teal-50/70 border border-teal-200 p-3.5 rounded-xl flex flex-col justify-between">
          <div className="text-[10px] font-bold text-teal-800 uppercase tracking-wider truncate">This Week</div>
          <div className="text-xl font-extrabold text-teal-900 mt-1">{metrics.weekMy}</div>
        </div>
        <div className="bg-emerald-50/70 border border-emerald-200 p-3.5 rounded-xl flex flex-col justify-between">
          <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider truncate">Today&apos;s Bookings</div>
          <div className="text-xl font-extrabold text-emerald-900 mt-1">{metrics.todayMy}</div>
        </div>
        <div className="bg-indigo-50/70 border border-indigo-200 p-3.5 rounded-xl flex flex-col justify-between">
          <div className="text-[10px] font-bold text-indigo-800 uppercase tracking-wider truncate">Next Month</div>
          <div className="text-xl font-extrabold text-indigo-900 mt-1">{metrics.nextMonthMy}</div>
        </div>
        <div className="bg-emerald-50/70 border border-emerald-200 p-3.5 rounded-xl flex flex-col justify-between">
          <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider truncate">Visited</div>
          <div className="text-xl font-extrabold text-emerald-900 mt-1">{metrics.visitedMy}</div>
        </div>
        <div className="bg-amber-50/70 border border-amber-200 p-3.5 rounded-xl flex flex-col justify-between">
          <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wider truncate">Total Follow-ups</div>
          <div className="text-xl font-extrabold text-amber-900 mt-1">{metrics.delayedMy}</div>
        </div>
        <div className="bg-purple-50/70 border border-purple-200 p-3.5 rounded-xl flex flex-col justify-between">
          <div className="text-[10px] font-bold text-purple-800 uppercase tracking-wider truncate">Rescheduled</div>
          <div className="text-xl font-extrabold text-purple-900 mt-1">{metrics.rescheduledByMeCount}</div>
        </div>
      </div>

      {/* Dual Month Calendar View */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="text-xs font-bold uppercase tracking-wider text-blue-600 flex items-center gap-2">
            <CalendarDays className="w-4 h-4" />
            <span>Select an available date to book</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                const d = new Date(calendarDate);
                d.setMonth(d.getMonth() - 1);
                setCalendarDate(d);
              }}
              className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                const d = new Date(calendarDate);
                d.setMonth(d.getMonth() + 1);
                setCalendarDate(d);
              }}
              className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {renderCalendarMonth(calendarDate)}
          {renderCalendarMonth(nextMonthDate)}
        </div>
      </div>

      {/* Booking Records Table Section */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        {/* Table Controls Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Table Switcher */}
          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl self-start">
            <button
              onClick={() => {
                setTableView("all");
                setCurrentPage(1);
              }}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                tableView === "all"
                  ? "bg-white text-blue-600 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All Bookings
            </button>
            <button
              onClick={() => {
                setTableView("my");
                setCurrentPage(1);
              }}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                tableView === "my"
                  ? "bg-white text-blue-600 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              My Bookings
            </button>
          </div>

          {/* Search & Status Filter */}
          <div className="flex items-center gap-3 flex-1 max-w-md justify-end">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search IP name, phone, or agent..."
                className="w-full pl-9 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as any);
                setCurrentPage(1);
              }}
              className="px-3 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-blue-600 outline-none"
            >
              <option value="all">STATUS: ALL</option>
              <option value="upcoming">Upcoming</option>
              <option value="followup">Follow up</option>
              <option value="visited">Visited</option>
            </select>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                {tableView === "all" && <th className="p-3.5">Booked By</th>}
                <th className="p-3.5">IP / IW Name</th>
                <th className="p-3.5">Phone Number</th>
                <th className="p-3.5">Scheduled Date</th>
                <th className="p-3.5">Booked On</th>
                <th className="p-3.5 text-center">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {paginatedList.length === 0 ? (
                <tr>
                  <td
                    colSpan={tableView === "all" ? 7 : 6}
                    className="text-center py-12 text-slate-400"
                  >
                    No bookings found matching criteria.
                  </td>
                </tr>
              ) : (
                paginatedList.map((b, idx) => {
                  const istMidnight = getISTMidnight();
                  const schedDate = new Date(b.dateKey);
                  schedDate.setHours(0, 0, 0, 0);

                  const isDelayed = !b.visited && schedDate < istMidnight;
                  const isUpcoming = !b.visited && schedDate >= istMidnight;

                  const bookedOnDateStr = new Date(b.timestamp).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  const schedDateStr = new Date(b.dateKey).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  });

                  return (
                    <tr key={`${b.dateKey}-${b.timestamp}-${idx}`} className="hover:bg-slate-50/70 transition-colors">
                      {tableView === "all" && (
                        <td className="p-3.5 font-bold text-blue-600">{b.agentName}</td>
                      )}
                      <td className="p-3.5">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                          <span>{b.ipName}</span>
                          <button
                            onClick={() => handleCopy(b.ipName, `name-${idx}`)}
                            className="text-slate-400 hover:text-blue-600 p-0.5 rounded"
                            title="Copy Name"
                          >
                            {copiedId === `name-${idx}` ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-1.5 font-mono text-slate-600">
                          <span>{b.phone}</span>
                          <button
                            onClick={() => handleCopy(b.phone, `phone-${idx}`)}
                            className="text-slate-400 hover:text-blue-600 p-0.5 rounded"
                            title="Copy Phone"
                          >
                            {copiedId === `phone-${idx}` ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="p-3.5 text-slate-800">{schedDateStr}</td>
                      <td className="p-3.5 text-slate-400">{bookedOnDateStr}</td>
                      <td className="p-3.5 text-center">
                        {b.visited ? (
                          <span className="bg-emerald-50 text-emerald-700 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Visited
                          </span>
                        ) : isDelayed ? (
                          (() => {
                            const [y, m, d] = b.dateKey.split("-").map(Number);
                            const foDate = new Date(y, m - 1, d);
                            foDate.setDate(foDate.getDate() + 8);
                            const foStr = foDate.toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            });
                            return (
                              <span className="bg-amber-50 text-amber-800 border border-amber-200 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1 whitespace-nowrap">
                                <Clock className="w-3 h-3 text-amber-600" /> Follow up on {foStr}
                              </span>
                            );
                          })()
                        ) : (
                          <span className="bg-blue-50 text-blue-700 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Upcoming
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Toggle Visited Button */}
                          <button
                            onClick={() => handleToggleVisitedAgent(b)}
                            className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors flex items-center gap-1 ${
                              b.visited
                                ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                            }`}
                            title={b.visited ? "Click to unmark visited" : "Mark as visited"}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            <span>{b.visited ? "Mark Active" : "Mark Visited"}</span>
                          </button>

                          {/* Reschedule Button - Disabled and locked when Visited */}
                          <button
                            onClick={() => {
                              if (b.visited) {
                                toast.warning("Visited bookings cannot be rescheduled. Please unmark visit first.");
                                return;
                              }
                              setRescheduleData({ oldDateKey: b.dateKey, record: b });
                              setRsSelectedDate(null);
                            }}
                            disabled={b.visited}
                            className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors flex items-center gap-1 ${
                              b.visited
                                ? "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                                : "bg-blue-600 hover:bg-blue-700 text-white"
                            }`}
                            title={
                              b.visited
                                ? "Visited bookings cannot be rescheduled. Unmark visit first."
                                : "Reschedule booking"
                            }
                          >
                            {b.visited && <Lock className="w-3 h-3" />}
                            <span>Reschedule</span>
                          </button>

                          {/* Cancel Button (My Bookings) */}
                          {tableView === "my" && (
                            <button
                              onClick={() => setCancelData({ dateKey: b.dateKey, record: b })}
                              className="p-1 text-rose-600 hover:bg-rose-50 rounded transition-colors"
                              title="Cancel Booking"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-3">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 bg-slate-100 disabled:opacity-40 rounded text-xs font-semibold"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 bg-slate-100 disabled:opacity-40 rounded text-xs font-semibold"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* --- BOOKING MODAL --- */}
      {bookModalDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white max-w-sm w-full rounded-2xl shadow-2xl p-6 border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 mb-1">Confirm Seat Reservation</h3>
            <p className="text-xs text-slate-500 mb-4">
              Date: <strong className="text-blue-600 font-semibold">{bookModalDate}</strong>
            </p>

            <form onSubmit={handleExecuteBooking} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  IP / IW Name *
                </label>
                <input
                  type="text"
                  value={ipName}
                  onChange={(e) => setIpName(e.target.value)}
                  placeholder="e.g. Ramesh Chandra"
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Phone Number (10+ digits) *
                </label>
                <input
                  type="tel"
                  value={ipPhone}
                  onChange={(e) => setIpPhone(e.target.value.replace(/\D/g, ""))}
                  placeholder="9876543210"
                  required
                  minLength={10}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setBookModalDate(null)}
                  className="px-3 py-2 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bookingLoading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  {bookingLoading ? "Reserving..." : "Confirm Reservation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- RESCHEDULE MODAL --- */}
      {rescheduleData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-blue-600" />
                <span>Reschedule Booking</span>
              </h3>
              <button onClick={() => setRescheduleData(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-xs space-y-1">
              <div>
                Rescheduling For: <strong className="text-slate-900">{rescheduleData.record.ipName}</strong>
              </div>
              <div>
                Current Date: <strong className="text-rose-600">{rescheduleData.oldDateKey}</strong>
              </div>
            </div>

            {/* Mini Calendar */}
            <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/50">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => {
                    const d = new Date(rsMonthDate);
                    d.setMonth(d.getMonth() - 1);
                    setRsMonthDate(d);
                  }}
                  className="p-1 hover:bg-slate-200 rounded"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <div className="text-xs font-bold text-slate-800">
                  {rsMonthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </div>
                <button
                  onClick={() => {
                    const d = new Date(rsMonthDate);
                    d.setMonth(d.getMonth() + 1);
                    setRsMonthDate(d);
                  }}
                  className="p-1 hover:bg-slate-200 rounded"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 text-[9px] font-bold text-center text-slate-400 mb-1">
                <div>S</div><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div>
              </div>

              <div className="grid grid-cols-7 gap-1">
                {(() => {
                  const y = rsMonthDate.getFullYear();
                  const m = rsMonthDate.getMonth();
                  const firstDay = new Date(y, m, 1).getDay();
                  const daysInMonth = new Date(y, m + 1, 0).getDate();
                  const istMidnight = getISTMidnight();
                  const boxes = [];

                  for (let i = 0; i < firstDay; i++) {
                    boxes.push(<div key={`rs-empty-${i}`} className="h-8" />);
                  }

                  for (let d = 1; d <= daysInMonth; d++) {
                    const dateKey = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                    const dbInfo = liveBookings[dateKey] || { seats: 0 };
                    const boxDate = new Date(y, m, d);
                    const isPast = boxDate < istMidnight;
                    const isAvailable = !isPast && dbInfo.seats > 0;
                    const isSelected = rsSelectedDate === dateKey;

                    boxes.push(
                      <button
                        key={`rs-${dateKey}`}
                        onClick={() => setRsSelectedDate(dateKey)}
                        disabled={!isAvailable}
                        className={`h-8 rounded text-[10px] font-bold transition-all flex flex-col items-center justify-center ${
                          isSelected
                            ? "bg-blue-600 text-white ring-2 ring-blue-600 shadow-xs"
                            : isAvailable
                            ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200"
                            : "bg-slate-100 text-slate-300 cursor-not-allowed"
                        }`}
                      >
                        <span>{d}</span>
                        {isAvailable && <span className="text-[7px] leading-none opacity-80">{dbInfo.seats}s</span>}
                      </button>
                    );
                  }

                  return boxes;
                })()}
              </div>
            </div>

            <div className="text-xs text-center text-slate-600">
              Selected Target Date:{" "}
              <strong className="text-blue-600">{rsSelectedDate || "Please select a green date"}</strong>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setRescheduleData(null)}
                className="px-3 py-1.5 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteReschedule}
                disabled={!rsSelectedDate || rsLoading}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg shadow-sm"
              >
                {rsLoading ? "Processing..." : "Confirm Reschedule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- CANCEL MODAL --- */}
      {cancelData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white max-w-sm w-full rounded-2xl shadow-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Remove Booking?</h3>
              <p className="text-xs text-slate-500 mt-1">
                Are you sure you want to cancel the booking for{" "}
                <strong className="text-slate-800">{cancelData.record.ipName}</strong> on{" "}
                <strong>{cancelData.dateKey}</strong>? The seat will be returned immediately.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setCancelData(null)}
                className="px-4 py-2 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
              >
                Keep Booking
              </button>
              <button
                onClick={handleExecuteCancel}
                disabled={cancelLoading}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm"
              >
                {cancelLoading ? "Removing..." : "Yes, Remove"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- VISIT CONFIRM MODAL --- */}
      {visitData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white max-w-sm w-full rounded-2xl shadow-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Mark as Visited?</h3>
              <p className="text-xs text-slate-500 mt-1">
                Confirming visit for <strong className="text-slate-800">{visitData.record.ipName}</strong>. This locks the booking permanently.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setVisitData(null)}
                className="px-4 py-2 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteVisit}
                disabled={visitLoading}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm"
              >
                {visitLoading ? "Updating..." : "Confirm Visited"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
