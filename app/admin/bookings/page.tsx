"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  getDocs,
  runTransaction,
  writeBatch,
  arrayUnion,
  arrayRemove,
  query,
  where,
  deleteDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { DayAvailability, BookingRecord, RescheduleLog } from "@/lib/types";
import { getISTMidnight } from "@/lib/utils";
import { logUserActivity } from "@/lib/activityLogger";
import { createNotification, notifyAdmins } from "@/lib/notificationService";
import * as XLSX from "xlsx";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  BarChart3,
  History,
  Settings,
  Search,
  X,
  Copy,
  Check,
  Trash2,
  Lock,
  RotateCcw,
  CheckCircle2,
  RefreshCw,
  Users,
  AlertTriangle,
  Clock,
} from "lucide-react";

interface AdminBookingRecord extends BookingRecord {
  dateKey: string;
}

export default function AdminBookingsPage() {
  const { user, userProfile } = useAuth();
  const { toast, showAlert, showConfirm } = usePopup();
  const [liveBookings, setLiveBookings] = useState<Record<string, DayAvailability>>({});
  const [userProfiles, setUserProfiles] = useState<Record<string, string>>({});
  const [rescheduleLogs, setRescheduleLogs] = useState<RescheduleLog[]>([]);
  const [calendarDate, setCalendarDate] = useState(new Date());

  // Views: 'main' | 'analytics' | 'logs'
  const [activeView, setActiveView] = useState<"main" | "analytics" | "logs">("main");

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [bookingStartDate, setBookingStartDate] = useState("");
  const [bookingEndDate, setBookingEndDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;

  // Performance Analytics State
  const [analyticsStartDate, setAnalyticsStartDate] = useState("");
  const [analyticsEndDate, setAnalyticsEndDate] = useState("");
  const [analyticsSearchTerm, setAnalyticsSearchTerm] = useState("");
  const [analyticsCurrentPage, setAnalyticsCurrentPage] = useState(1);

  // Single Day Edit Modal
  const [singleEditDate, setSingleEditDate] = useState<string | null>(null);
  const [singleSeats, setSingleSeats] = useState(0);
  const [singleText, setSingleText] = useState("");
  const [singleSaving, setSingleSaving] = useState(false);

  // Bulk Edit Modal
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkMonth, setBulkMonth] = useState(new Date().getMonth());
  const [bulkYear, setBulkYear] = useState(new Date().getFullYear());
  const [bulkMode, setBulkMode] = useState<"all" | "custom">("all");
  const [bulkSeats, setBulkSeats] = useState(10);
  const [bulkSelectedDates, setBulkSelectedDates] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);

  // Reschedule Modal
  const [rescheduleItem, setRescheduleItem] = useState<AdminBookingRecord | null>(null);
  const [rsMonthDate, setRsMonthDate] = useState(new Date());
  const [rsSelectedDate, setRsSelectedDate] = useState<string | null>(null);
  const [rsLoading, setRsLoading] = useState(false);

  // Bulk Selection for Bookings Table
  const [selectedBookingKeys, setSelectedBookingKeys] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 1. Live Bookings Listener
  useEffect(() => {
    let isMounted = true;

    const unsubBookings = onSnapshot(
      collection(db, "bookings"),
      (snap) => {
        if (!isMounted) return;
        const data: Record<string, DayAvailability> = {};
        snap.forEach((d) => {
          data[d.id] = d.data() as DayAvailability;
        });
        setLiveBookings(data);
      },
      (err) => {
        console.warn("Bookings snapshot error:", err);
      }
    );

    const unsubLogs = onSnapshot(
      collection(db, "rescheduleLogs"),
      (snap) => {
        if (!isMounted) return;
        const logs: RescheduleLog[] = [];
        snap.forEach((d) => logs.push({ id: d.id, ...(d.data() as Omit<RescheduleLog, "id">) }));
        logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setRescheduleLogs(logs);
      },
      (err) => {
        console.warn("Reschedule logs snapshot error:", err);
      }
    );

    const fetchUsers = async () => {
      try {
        const snap = await getDocs(collection(db, "users"));
        if (!isMounted) return;
        const map: Record<string, string> = {};
        snap.forEach((d) => {
          map[d.id.toLowerCase()] = d.data().displayName || d.data().name || d.id;
        });
        setUserProfiles(map);
      } catch (e) {
        console.error(e);
      }
    };
    fetchUsers();

    return () => {
      isMounted = false;
      try {
        unsubBookings();
      } catch (e) {
        // ignore unmount errors
      }
      try {
        unsubLogs();
      } catch (e) {
        // ignore unmount errors
      }
    };
  }, []);

  // 2. Flatten Bookings & Compute 13 Metrics
  const { allBookings, activeRescheduleLogs, metrics } = useMemo(() => {
    const list: AdminBookingRecord[] = [];
    const todayObj = new Date();
    const currentYear = todayObj.getFullYear();
    const currentMonth = todayObj.getMonth();
    const currentDay = todayObj.getDate();

    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

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

    let total = 0,
      month = 0,
      lastMonthCount = 0,
      nextMonthCount = 0,
      week = 0,
      todayCount = 0,
      availMonth = 0,
      availNextMonth = 0,
      visited = 0,
      nonVisited = 0,
      upcoming = 0,
      delayed = 0;

    Object.keys(liveBookings).forEach((dateKey) => {
      const dayData = liveBookings[dateKey];
      const [y, m] = dateKey.split("-").map(Number);
      const mIdx = m - 1;

      if (y === currentYear && mIdx === currentMonth) availMonth += dayData.seats || 0;
      if (y === nextMonthYear && mIdx === nextMonth) availNextMonth += dayData.seats || 0;

      if (dayData.bookedRecords && Array.isArray(dayData.bookedRecords)) {
        dayData.bookedRecords.forEach((record) => {
          total++;
          const emailLower = record.agentEmail?.toLowerCase() || "";
          const cleanName =
            userProfiles[emailLower] ||
            (record.agentEmail
              ? record.agentEmail.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
              : "Unknown Agent");

          list.push({
            ...record,
            dateKey,
            agentName: cleanName,
          });

          if (y === currentYear && mIdx === currentMonth) month++;
          if (y === lastMonthYear && mIdx === lastMonth) lastMonthCount++;
          if (y === nextMonthYear && mIdx === nextMonth) nextMonthCount++;

          const bookedTime = new Date(record.timestamp);
          if (bookedTime >= startOfWeek && bookedTime <= endOfWeek) week++;
          if (
            bookedTime.getFullYear() === currentYear &&
            bookedTime.getMonth() === currentMonth &&
            bookedTime.getDate() === currentDay
          ) {
            todayCount++;
          }

          if (record.visited) {
            visited++;
          } else {
            nonVisited++;
            const schedDate = new Date(dateKey);
            schedDate.setHours(0, 0, 0, 0);
            if (schedDate < istMidnight) delayed++;
            else upcoming++;
          }
        });
      }
    });

    list.sort((a, b) => b.timestamp - a.timestamp);

    // Active bookings lookup for reschedule logs validity
    const activeBookingSet = new Set<string>();
    list.forEach((b) => {
      if (b.agentEmail) {
        activeBookingSet.add(`${b.agentEmail.toLowerCase()}_${(b.ipName || "").toLowerCase().trim()}`);
        activeBookingSet.add(`${b.agentEmail.toLowerCase()}_${b.dateKey}`);
      }
    });

    const activeLogs: RescheduleLog[] = [];
    rescheduleLogs.forEach((l) => {
      const owner = (l.seatOwner || "").toLowerCase().trim();
      const ip = (l.ipName || "").toLowerCase().trim();
      const key1 = `${owner}_${ip}`;
      const key2 = `${owner}_${l.newDate}`;
      const key3 = `${owner}_${l.originalDate}`;

      if (activeBookingSet.has(key1) || activeBookingSet.has(key2) || activeBookingSet.has(key3)) {
        activeLogs.push(l);
      } else if (l.id) {
        deleteDoc(doc(db, "rescheduleLogs", l.id)).catch(() => {});
      }
    });

    const rescheduledCount = list.filter((b) => b.rescheduled).length || activeLogs.length;

    return {
      allBookings: list,
      activeRescheduleLogs: activeLogs,
      metrics: {
        total,
        month,
        lastMonthCount,
        nextMonthCount,
        week,
        todayCount,
        availMonth,
        availNextMonth,
        visited,
        nonVisited,
        upcoming,
        delayed,
        rescheduled: rescheduledCount,
      },
    };
  }, [liveBookings, userProfiles, rescheduleLogs]);

  // Unique Agents for filter dropdown
  const uniqueAgents = useMemo(() => {
    const set = new Set<string>();
    allBookings.forEach((b) => {
      if (b.agentName) set.add(b.agentName);
    });
    return Array.from(set).sort();
  }, [allBookings]);

  // Filtered Bookings Table
  const filteredBookings = useMemo(() => {
    let result = allBookings;
    const istMidnight = getISTMidnight();

    if (agentFilter !== "all") {
      result = result.filter((b) => b.agentName === agentFilter);
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      result = result.filter(
        (b) =>
          b.ipName?.toLowerCase().includes(q) ||
          b.phone?.toLowerCase().includes(q) ||
          b.agentName?.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== "all") {
      result = result.filter((b) => {
        if (statusFilter === "visited") return !!b.visited;
        if (b.visited) return false;

        const sched = new Date(b.dateKey);
        sched.setHours(0, 0, 0, 0);
        if (statusFilter === "followup" || statusFilter === "delayed") return sched < istMidnight;
        if (statusFilter === "upcoming") return sched >= istMidnight;
        return true;
      });
    }

    if (bookingStartDate) {
      const [sy, sm, sd] = bookingStartDate.split("-").map(Number);
      const start = new Date(sy, sm - 1, sd, 0, 0, 0, 0).getTime();
      result = result.filter((b) => (b.timestamp || 0) >= start);
    }

    if (bookingEndDate) {
      const [ey, em, ed] = bookingEndDate.split("-").map(Number);
      const end = new Date(ey, em - 1, ed, 23, 59, 59, 999).getTime();
      result = result.filter((b) => (b.timestamp || 0) <= end);
    }

    return result;
  }, [allBookings, agentFilter, searchTerm, statusFilter, bookingStartDate, bookingEndDate]);

  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / itemsPerPage));
  const paginatedBookings = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredBookings.slice(start, start + itemsPerPage);
  }, [filteredBookings, currentPage]);

  // Analytics Data & Agent Performance Calculation (Filters by Booking Creation Date/Timestamp)
  const analyticsData = useMemo(() => {
    let list = [...allBookings].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (analyticsStartDate) {
      const [sy, sm, sd] = analyticsStartDate.split("-").map(Number);
      const start = new Date(sy, sm - 1, sd, 0, 0, 0, 0).getTime();
      list = list.filter((b) => (b.timestamp || 0) >= start);
    }

    if (analyticsEndDate) {
      const [ey, em, ed] = analyticsEndDate.split("-").map(Number);
      const end = new Date(ey, em - 1, ed, 23, 59, 59, 999).getTime();
      list = list.filter((b) => (b.timestamp || 0) <= end);
    }

    // Aggregate by Agent
    const agentMap: Record<
      string,
      {
        name: string;
        email: string;
        total: number;
        rescheduled: number;
        visited: number;
        nonVisited: number;
      }
    > = {};

    list.forEach((b) => {
      const email = b.agentEmail?.toLowerCase() || "unknown@piramalswasthya.org";
      const name = b.agentName || email.split("@")[0];

      if (!agentMap[email]) {
        agentMap[email] = {
          name,
          email,
          total: 0,
          rescheduled: 0,
          visited: 0,
          nonVisited: 0,
        };
      }

      agentMap[email].total += 1;
      if (b.rescheduled) agentMap[email].rescheduled += 1;
      if (b.visited) agentMap[email].visited += 1;
      else agentMap[email].nonVisited += 1;
    });

    const agentList = Object.values(agentMap).sort((a, b) => b.total - a.total);

    // Search inside analytics records
    let filteredRecords = list;
    if (analyticsSearchTerm.trim()) {
      const q = analyticsSearchTerm.toLowerCase().trim();
      filteredRecords = filteredRecords.filter(
        (b) =>
          b.ipName?.toLowerCase().includes(q) ||
          b.phone?.toLowerCase().includes(q) ||
          b.agentName?.toLowerCase().includes(q) ||
          b.dateKey.includes(q)
      );
    }

    return {
      filteredRecords,
      totalBookings: list.length,
      agentPerformance: agentList,
    };
  }, [allBookings, analyticsStartDate, analyticsEndDate, analyticsSearchTerm]);

  const analyticsTotalPages = Math.max(
    1,
    Math.ceil(analyticsData.filteredRecords.length / itemsPerPage)
  );
  const analyticsPaginatedRecords = useMemo(() => {
    const start = (analyticsCurrentPage - 1) * itemsPerPage;
    return analyticsData.filteredRecords.slice(start, start + itemsPerPage);
  }, [analyticsData.filteredRecords, analyticsCurrentPage]);

  // Cancel Single Booking
  const handleCancelSingleBooking = async (b: AdminBookingRecord) => {
    const confirmed = await showConfirm({
      title: "Remove Booking?",
      message: `Are you sure you want to remove the booking for ${b.ipName}? The seat will be released immediately.`,
      isDestructive: true,
      confirmText: "Remove Booking",
    });
    if (!confirmed) return;

    const docRef = doc(db, "bookings", b.dateKey);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists()) return;
        const records: BookingRecord[] = snap.data().bookedRecords || [];
        const target = records.find(
          (r) => r.timestamp === b.timestamp && r.agentEmail === b.agentEmail
        );
        if (target) {
          tx.update(docRef, {
            seats: (snap.data().seats || 0) + 1,
            bookedRecords: arrayRemove(target),
          });
        }
      });

      // Automatically delete related reschedule logs for this deleted booking
      try {
        const ownerEmail = b.agentEmail?.toLowerCase();
        const ip = (b.ipName || "").toLowerCase().trim();
        if (ownerEmail) {
          const logsSnap = await getDocs(
            query(collection(db, "rescheduleLogs"), where("seatOwner", "==", ownerEmail))
          );
          logsSnap.forEach((lDoc) => {
            const l = lDoc.data();
            const logIp = (l.ipName || "").toLowerCase().trim();
            if ((ip && logIp === ip) || l.newDate === b.dateKey || l.originalDate === b.dateKey) {
              deleteDoc(doc(db, "rescheduleLogs", lDoc.id)).catch(() => {});
            }
          });
        }
      } catch (e) {
        console.warn("Could not delete rescheduleLogs:", e);
      }

      logUserActivity(user?.email, {
        desc: `Deleted verification booking for IP: ${b.ipName || "Beneficiary"} (${b.dateKey})`,
        type: "delete",
      });
      toast.success("Booking successfully removed and seat released.");
    } catch (e: any) {
      toast.error("Failed to remove booking: " + e.message);
    }
  };

  // Mark / Unmark Single Booking as Visited
  const handleToggleVisited = async (b: AdminBookingRecord) => {
    const docRef = doc(db, "bookings", b.dateKey);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists()) return;
        const records: BookingRecord[] = snap.data().bookedRecords || [];
        const index = records.findIndex(
          (r) => r.timestamp === b.timestamp && r.agentEmail === b.agentEmail
        );
        if (index !== -1) {
          const updated = [...records];
          updated[index] = { ...updated[index], visited: !b.visited };
          tx.update(docRef, { bookedRecords: updated });
        }
      });
      logUserActivity(user?.email, {
        desc: `${!b.visited ? "Marked as Visited" : "Unmarked Visited"} for IP: ${b.ipName || "Beneficiary"} (${b.dateKey})`,
        type: "booking",
      });

      // If marking as visited, notify the agent and admins
      if (!b.visited) {
        try {
          if (b.agentEmail) {
            await createNotification({
              title: "🏥 Booking Marked as Visited",
              message: `Your booking for **${b.ipName || "Beneficiary"}** on **${b.dateKey}** has been marked as **Visited** by ${userProfile?.displayName || "Admin"}.`,
              type: "booking",
              targetEmail: b.agentEmail.toLowerCase().trim(),
              link: "/booking",
            });
          }
          await notifyAdmins({
            title: "🏥 Booking Visited",
            message: `Booking for **${b.ipName || "Beneficiary"}** on **${b.dateKey}** (booked by ${b.agentName || b.agentEmail}) was marked as **Visited** by ${userProfile?.displayName || "Admin"}.`,
            type: "booking",
            link: "/admin/bookings",
          });
        } catch (notifErr) {
          console.error("Visited notification error:", notifErr);
        }
      }

      toast.success(b.visited ? "Booking marked as active." : "Booking marked as visited.");
    } catch (e: any) {
      toast.error("Failed to update status: " + e.message);
    }
  };

  // Copy text helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.info("Copied to clipboard!");
    setTimeout(() => setCopiedId(null), 1500);
  };

  // --- 3. SAVE SINGLE DAY AVAILABILITY ---
  const handleSaveSingleDay = async () => {
    if (!singleEditDate) return;
    setSingleSaving(true);
    try {
      await setDoc(
        doc(db, "bookings", singleEditDate),
        {
          seats: Number(singleSeats),
          text: singleText.trim(),
        },
        { merge: true }
      );
      logUserActivity(user?.email, {
        desc: `Updated verification booking capacity for ${singleEditDate} (${singleSeats} seats)`,
        type: "booking",
      });
      setSingleEditDate(null);
      toast.success(`Availability updated for ${singleEditDate}`);
    } catch (e: any) {
      toast.error("Failed to save single day: " + e.message);
    } finally {
      setSingleSaving(false);
    }
  };

  // --- 4. SAVE BULK AVAILABILITY ---
  const handleSaveBulkAvailability = async () => {
    setBulkSaving(true);
    try {
      const batch = writeBatch(db);
      const daysInMonth = new Date(bulkYear, bulkMonth + 1, 0).getDate();

      if (bulkMode === "all") {
        for (let d = 1; d <= daysInMonth; d++) {
          const dateKey = `${bulkYear}-${String(bulkMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          batch.set(doc(db, "bookings", dateKey), { seats: Number(bulkSeats) }, { merge: true });
        }
      } else {
        bulkSelectedDates.forEach((dateKey) => {
          batch.set(doc(db, "bookings", dateKey), { seats: Number(bulkSeats) }, { merge: true });
        });
      }

      await batch.commit();
      setBulkModalOpen(false);
      toast.success("Availability rules updated successfully!");
    } catch (e: any) {
      toast.error("Bulk save error: " + e.message);
    } finally {
      setBulkSaving(false);
    }
  };

  // --- 5. EXPORT TO EXCEL ---
  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Metrics Overview
    const wsOverview = XLSX.utils.aoa_to_sheet([
      ["Metric", "Value"],
      ["Total Bookings", metrics.total],
      ["This Month", metrics.month],
      ["Last Month", metrics.lastMonthCount],
      ["Next Month", metrics.nextMonthCount],
      ["This Week", metrics.week],
      ["Today", metrics.todayCount],
      ["Available This Month", metrics.availMonth],
      ["Available Next Month", metrics.availNextMonth],
      ["Visited", metrics.visited],
      ["Non-Visited", metrics.nonVisited],
      ["Upcoming", metrics.upcoming],
      ["Delayed", metrics.delayed],
      ["Rescheduled", metrics.rescheduled],
    ]);
    XLSX.utils.book_append_sheet(wb, wsOverview, "Overview");

    // Sheet 2: Detailed Bookings
    const wsDetailed = XLSX.utils.json_to_sheet(
      allBookings.map((b) => ({
        "Agent Name": b.agentName,
        "Agent Email": b.agentEmail,
        "IP / IW Name": b.ipName,
        "Phone Number": b.phone,
        "Scheduled Date": b.dateKey,
        "Booked On": new Date(b.timestamp).toLocaleString(),
        Status: b.visited ? "Visited" : "Pending",
        Rescheduled: b.rescheduled ? "Yes" : "No",
      }))
    );
    XLSX.utils.book_append_sheet(wb, wsDetailed, "Detailed Bookings");

    // Sheet 3: Reschedule Logs
    const wsLogs = XLSX.utils.json_to_sheet(
      activeRescheduleLogs.map((l) => ({
        "IP / IW Name": l.ipName,
        "Seat Owner": l.seatOwner,
        "Original Date": l.originalDate,
        "New Date": l.newDate,
        "Action By": l.actionBy,
        Timestamp: new Date(l.timestamp).toLocaleString(),
      }))
    );
    XLSX.utils.book_append_sheet(wb, wsLogs, "Reschedule Logs");

    const todayStr = new Date().toISOString().split("T")[0];
    XLSX.writeFile(wb, `ESIC_Booking_Report_${todayStr}.xlsx`);
  };

  // --- 6. BULK DELETE BOOKINGS ---
  const handleBulkDeleteBookings = async () => {
    if (selectedBookingKeys.size === 0) return;
    const confirmed = await showConfirm({
      title: "Remove Selected Bookings?",
      message: `Are you sure you want to remove ${selectedBookingKeys.size} selected bookings? Their seats will be released immediately.`,
      isDestructive: true,
      confirmText: "Remove Bookings",
    });
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      for (const key of Array.from(selectedBookingKeys)) {
        const [dateKey, timestampStr, email] = key.split("___");
        const docRef = doc(db, "bookings", dateKey);

        await runTransaction(db, async (tx) => {
          const snap = await tx.get(docRef);
          if (!snap.exists()) return;
          const records: BookingRecord[] = snap.data().bookedRecords || [];
          const target = records.find((r) => r.timestamp === Number(timestampStr) && r.agentEmail === email);
          if (target) {
            tx.update(docRef, {
              seats: (snap.data().seats || 0) + 1,
              bookedRecords: arrayRemove(target),
            });
          }
        });

        // Cleanup related rescheduleLogs for each bulk deleted key
        try {
          if (email) {
            const logsSnap = await getDocs(
              query(collection(db, "rescheduleLogs"), where("seatOwner", "==", email.toLowerCase()))
            );
            logsSnap.forEach((lDoc) => {
              const l = lDoc.data();
              if (l.newDate === dateKey || l.originalDate === dateKey) {
                deleteDoc(doc(db, "rescheduleLogs", lDoc.id)).catch(() => {});
              }
            });
          }
        } catch (e) {}
      }

      logUserActivity(user?.email, {
        desc: `Bulk deleted ${selectedBookingKeys.size} verification bookings`,
        type: "delete",
      });

      setSelectedBookingKeys(new Set());
      toast.success("Selected bookings removed and seats released.");
    } catch (e: any) {
      toast.error("Bulk deletion failed: " + e.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  // --- 7. ADMIN RESCHEDULE EXECUTE ---
  const handleAdminReschedule = async () => {
    if (!rescheduleItem || !rsSelectedDate || !user) return;
    if (rescheduleItem.visited) {
      toast.warning("Visited bookings cannot be rescheduled. Please unmark visit first.");
      return;
    }
    setRsLoading(true);

    const oldDocRef = doc(db, "bookings", rescheduleItem.dateKey);
    const newDocRef = doc(db, "bookings", rsSelectedDate);

    try {
      await runTransaction(db, async (tx) => {
        const oldSnap = await tx.get(oldDocRef);
        const newSnap = await tx.get(newDocRef);

        if (!newSnap.exists() || (newSnap.data().seats || 0) <= 0) {
          throw new Error("No available seats on the selected date.");
        }
        if (!oldSnap.exists()) throw new Error("Original booking not found.");

        const oldRecords: BookingRecord[] = oldSnap.data().bookedRecords || [];
        const target = oldRecords.find(
          (r) =>
            r.timestamp === rescheduleItem.timestamp &&
            r.agentEmail?.toLowerCase() === rescheduleItem.agentEmail?.toLowerCase()
        );

        if (!target) throw new Error("Original booking record was not found.");

        tx.update(oldDocRef, {
          seats: (oldSnap.data().seats || 0) + 1,
          bookedRecords: arrayRemove(target),
        });

        tx.update(newDocRef, {
          seats: (newSnap.data().seats || 0) - 1,
          bookedRecords: arrayUnion({
            ...target,
            rescheduled: true,
          }),
        });

        const logRef = doc(collection(db, "rescheduleLogs"));
        tx.set(logRef, {
          ipName: target.ipName,
          seatOwner: target.agentEmail,
          originalDate: rescheduleItem.dateKey,
          newDate: rsSelectedDate,
          actionBy: user.email?.toLowerCase(),
          timestamp: Date.now(),
        });
      });

      logUserActivity(user?.email, {
        desc: `Rescheduled booking for IP: ${rescheduleItem.ipName || "Beneficiary"} from ${rescheduleItem.dateKey} to ${rsSelectedDate}`,
        type: "booking",
      });

      // Send customized notification to seat owner agent
      if (rescheduleItem.agentEmail) {
        const oldFmt = new Date(rescheduleItem.dateKey).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const newFmt = new Date(rsSelectedDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });

        try {
          await createNotification({
            title: "🔄 Booking Rescheduled by Admin",
            message: `Your verification booking for **${rescheduleItem.ipName}** was rescheduled from **${oldFmt}** to **${newFmt}** by admin (${userProfile?.displayName || user?.email || "Admin"}).`,
            type: "booking",
            targetEmail: rescheduleItem.agentEmail.toLowerCase().trim(),
            link: "/booking",
            metadata: {
              ipName: rescheduleItem.ipName,
              oldDate: rescheduleItem.dateKey,
              newDate: rsSelectedDate,
              actionBy: user?.email,
            },
          });

          // Notify other Admins
          await notifyAdmins({
            title: "🔄 Booking Rescheduled by Admin",
            message: `**${userProfile?.displayName || user?.email}** rescheduled booking for **${rescheduleItem.ipName}** (Agent: ${rescheduleItem.agentName || rescheduleItem.agentEmail}) to **${newFmt}**.`,
            type: "booking",
            link: "/admin/bookings",
          });
        } catch (notifErr) {
          console.error("Admin reschedule notification error:", notifErr);
        }
      }

      setRescheduleItem(null);
      setRsSelectedDate(null);
      toast.success("Booking successfully rescheduled!");
    } catch (e: any) {
      toast.error("Reschedule failed: " + e.message);
    } finally {
      setRsLoading(false);
    }
  };

  // Calendar Day Rendering
  const nextMonthDate = useMemo(() => {
    const d = new Date(calendarDate);
    d.setMonth(d.getMonth() + 1);
    return d;
  }, [calendarDate]);

  const renderAdminCalendarMonth = (targetDate: Date) => {
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dayBoxes = [];

    for (let i = 0; i < firstDayIndex; i++) {
      dayBoxes.push(<div key={`empty-${i}`} className="h-14 bg-slate-50/50 rounded-lg" />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dbInfo = liveBookings[dateKey] || { seats: 0 };
      const isAvailable = dbInfo.seats > 0;

      dayBoxes.push(
        <button
          key={dateKey}
          onClick={() => {
            setSingleEditDate(dateKey);
            setSingleSeats(dbInfo.seats || 0);
            setSingleText(dbInfo.text || "");
          }}
          className={`h-14 p-1.5 rounded-lg border flex flex-col items-center justify-between transition-all hover:scale-[1.02] shadow-xs text-left ${
            isAvailable
              ? "bg-emerald-50/80 border-emerald-200 text-emerald-900"
              : "bg-rose-50/60 border-rose-200 text-rose-800"
          }`}
        >
          <span className="text-[10px] font-bold self-start">{day}</span>
          <div className="text-center my-auto">
            <div className="text-base font-extrabold leading-none">{dbInfo.seats}</div>
          </div>
          {dbInfo.text ? (
            <span className="text-[8px] italic truncate w-full text-center">{dbInfo.text}</span>
          ) : (
            <span className="h-2" />
          )}
        </button>
      );
    }

    return (
      <div className="bg-white p-4 rounded-2xl border border-slate-200 flex-1 space-y-2">
        <h3 className="text-sm font-bold text-center text-slate-800 flex items-center justify-center gap-2">
          <CalendarIcon className="w-4 h-4 text-amber-500" />
          <span>{monthNames[month]} {year}</span>
        </h3>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-400 uppercase">
          <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
        </div>
        <div className="grid grid-cols-7 gap-1.5">{dayBoxes}</div>
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Manage Bookings</h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold shadow-xs"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export Report (.xlsx)</span>
          </button>

          <button
            onClick={() => setActiveView(activeView === "analytics" ? "main" : "analytics")}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
              activeView === "analytics"
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Performance Analytics</span>
          </button>

          <button
            onClick={() => setActiveView(activeView === "logs" ? "main" : "logs")}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
              activeView === "logs"
                ? "bg-purple-600 text-white border-purple-600"
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            <History className="w-4 h-4" />
            <span>Reschedule Logs</span>
          </button>

          <button
            onClick={() => setBulkModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold shadow-xs"
          >
            <Settings className="w-4 h-4" />
            <span>Manage Availability</span>
          </button>
        </div>
      </div>

      {/* 13 Metrics Counter Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-3">
        <div className="bg-amber-50/70 border border-amber-200 p-3.5 rounded-xl">
          <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Total Bookings</div>
          <div className="text-xl font-black text-amber-900 mt-1">{metrics.total}</div>
        </div>
        <div className="bg-blue-50/70 border border-blue-200 p-3.5 rounded-xl">
          <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">This Month</div>
          <div className="text-xl font-black text-blue-900 mt-1">{metrics.month}</div>
        </div>
        <div className="bg-slate-100 border border-slate-200 p-3.5 rounded-xl">
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Last Month</div>
          <div className="text-xl font-black text-slate-800 mt-1">{metrics.lastMonthCount}</div>
        </div>
        <div className="bg-indigo-50/70 border border-indigo-200 p-3.5 rounded-xl">
          <div className="text-[10px] font-bold text-indigo-800 uppercase tracking-wider">Next Month</div>
          <div className="text-xl font-black text-indigo-900 mt-1">{metrics.nextMonthCount}</div>
        </div>
        <div className="bg-teal-50/70 border border-teal-200 p-3.5 rounded-xl">
          <div className="text-[10px] font-bold text-teal-800 uppercase tracking-wider">This Week</div>
          <div className="text-xl font-black text-teal-900 mt-1">{metrics.week}</div>
        </div>
        <div className="bg-rose-50/70 border border-rose-200 p-3.5 rounded-xl">
          <div className="text-[10px] font-bold text-rose-800 uppercase tracking-wider">Today</div>
          <div className="text-xl font-black text-rose-900 mt-1">{metrics.todayCount}</div>
        </div>
        <div className="bg-purple-50/70 border border-purple-200 p-3.5 rounded-xl">
          <div className="text-[10px] font-bold text-purple-800 uppercase tracking-wider">Avail Month</div>
          <div className="text-xl font-black text-purple-900 mt-1">{metrics.availMonth}</div>
        </div>
        <div className="bg-indigo-50/70 border border-indigo-200 p-3.5 rounded-xl">
          <div className="text-[10px] font-bold text-indigo-800 uppercase tracking-wider">Avail Next</div>
          <div className="text-xl font-black text-indigo-900 mt-1">{metrics.availNextMonth}</div>
        </div>
        <div className="bg-emerald-50/70 border border-emerald-200 p-3.5 rounded-xl">
          <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Visited</div>
          <div className="text-xl font-black text-emerald-900 mt-1">{metrics.visited}</div>
        </div>
        <div className="bg-rose-50/70 border border-rose-200 p-3.5 rounded-xl">
          <div className="text-[10px] font-bold text-rose-800 uppercase tracking-wider">Non-Visited</div>
          <div className="text-xl font-black text-rose-900 mt-1">{metrics.nonVisited}</div>
        </div>
        <div className="bg-cyan-50/70 border border-cyan-200 p-3.5 rounded-xl">
          <div className="text-[10px] font-bold text-cyan-800 uppercase tracking-wider">Upcoming</div>
          <div className="text-xl font-black text-cyan-900 mt-1">{metrics.upcoming}</div>
        </div>
        <div className="bg-amber-50/70 border border-amber-200 p-3.5 rounded-xl">
          <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Total Follow-ups</div>
          <div className="text-xl font-black text-amber-900 mt-1">{metrics.delayed}</div>
        </div>
        <div className="bg-blue-50/70 border border-blue-200 p-3.5 rounded-xl col-span-2 sm:col-span-1">
          <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">Rescheduled</div>
          <div className="text-xl font-black text-blue-900 mt-1">{metrics.rescheduled}</div>
        </div>
      </div>

      {/* 2-Month Dual Calendar */}
      {activeView === "main" && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="text-xs font-bold uppercase tracking-wider text-blue-600">
              Manage Seat Quotas & Holiday Messages
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  const d = new Date(calendarDate);
                  d.setMonth(d.getMonth() - 1);
                  setCalendarDate(d);
                }}
                className="p-1.5 hover:bg-slate-100 rounded-lg"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  const d = new Date(calendarDate);
                  d.setMonth(d.getMonth() + 1);
                  setCalendarDate(d);
                }}
                className="p-1.5 hover:bg-slate-100 rounded-lg"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {renderAdminCalendarMonth(calendarDate)}
            {renderAdminCalendarMonth(nextMonthDate)}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          VIEW 1: DETAILED BOOKINGS TABLE
          ---------------------------------------------------- */}
      {activeView === "main" && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
          {/* Table Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h3 className="font-bold text-slate-900 text-base">
              Detailed Booking Records ({filteredBookings.length})
            </h3>

            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Date Range Filters (From - To) */}
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-700">
                <span className="text-[10px] font-bold text-slate-400 uppercase">From:</span>
                <input
                  type="date"
                  value={bookingStartDate}
                  onChange={(e) => {
                    setBookingStartDate(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="bg-transparent outline-none text-slate-800 text-xs font-semibold cursor-pointer"
                />
              </div>

              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-700">
                <span className="text-[10px] font-bold text-slate-400 uppercase">To:</span>
                <input
                  type="date"
                  value={bookingEndDate}
                  onChange={(e) => {
                    setBookingEndDate(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="bg-transparent outline-none text-slate-800 text-xs font-semibold cursor-pointer"
                />
              </div>

              {(bookingStartDate || bookingEndDate) && (
                <button
                  onClick={() => {
                    setBookingStartDate("");
                    setBookingEndDate("");
                    setCurrentPage(1);
                  }}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
                  title="Reset date filter"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              )}

              <select
                value={agentFilter}
                onChange={(e) => {
                  setAgentFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-blue-600 outline-none cursor-pointer"
              >
                <option value="all">AGENT: ALL</option>
                {uniqueAgents.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-blue-600 outline-none cursor-pointer"
              >
                <option value="all">STATUS: ALL</option>
                <option value="upcoming">Upcoming</option>
                <option value="followup">Follow up</option>
                <option value="visited">Visited</option>
              </select>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search name or phone..."
                  className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:bg-white"
                />
              </div>
            </div>
          </div>

          {/* Bulk Action Bar */}
          {selectedBookingKeys.size > 0 && (
            <div className="flex items-center justify-between bg-rose-50 border border-rose-200 px-4 py-2.5 rounded-xl text-xs">
              <span className="font-bold text-rose-800">
                {selectedBookingKeys.size} bookings selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedBookingKeys(new Set())}
                  className="px-3 py-1 bg-white border border-rose-200 text-rose-700 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkDeleteBookings}
                  disabled={bulkDeleting}
                  className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{bulkDeleting ? "Deleting..." : "Delete Selected"}</span>
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                  <th className="p-4 text-center">
                    <input
                      type="checkbox"
                      checked={
                        paginatedBookings.length > 0 &&
                        paginatedBookings.every((b) =>
                          selectedBookingKeys.has(`${b.dateKey}___${b.timestamp}___${b.agentEmail}`)
                        )
                      }
                      onChange={(e) => {
                        const nextSet = new Set(selectedBookingKeys);
                        if (e.target.checked) {
                          paginatedBookings.forEach((b) =>
                            nextSet.add(`${b.dateKey}___${b.timestamp}___${b.agentEmail}`)
                          );
                        } else {
                          paginatedBookings.forEach((b) =>
                            nextSet.delete(`${b.dateKey}___${b.timestamp}___${b.agentEmail}`)
                          );
                        }
                        setSelectedBookingKeys(nextSet);
                      }}
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="p-4">Agent Name</th>
                  <th className="p-4">IP / IW Name</th>
                  <th className="p-4">Phone Number</th>
                  <th className="p-4">Scheduled Date</th>
                  <th className="p-4">Booked On</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {paginatedBookings.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-400">
                      No bookings match search or filters.
                    </td>
                  </tr>
                ) : (
                  paginatedBookings.map((b, idx) => {
                    const rowKey = `${b.dateKey}___${b.timestamp}___${b.agentEmail}`;
                    const isChecked = selectedBookingKeys.has(rowKey);

                    return (
                      <tr key={rowKey} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-4 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const nextSet = new Set(selectedBookingKeys);
                              if (e.target.checked) nextSet.add(rowKey);
                              else nextSet.delete(rowKey);
                              setSelectedBookingKeys(nextSet);
                            }}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="p-4 font-bold text-blue-600">{b.agentName}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-1.5 font-bold text-slate-900">
                            <span>{b.ipName}</span>
                            <button
                              onClick={() => handleCopy(b.ipName, `ip-${idx}`)}
                              className="text-slate-400 hover:text-blue-600"
                            >
                              {copiedId === `ip-${idx}` ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="p-4 font-mono text-slate-600">
                          <div className="flex items-center gap-1.5">
                            <span>{b.phone}</span>
                            {b.phone && (
                              <button
                                onClick={() => handleCopy(b.phone, `phone-main-${idx}`)}
                                className="text-slate-400 hover:text-blue-600 p-0.5 transition-colors"
                                title="Copy phone number"
                              >
                                {copiedId === `phone-main-${idx}` ? (
                                  <Check className="w-3 h-3 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-slate-800">{b.dateKey}</td>
                        <td className="p-4 text-slate-400">
                          {new Date(b.timestamp).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="p-4 text-center">
                          {b.visited ? (
                            <span className="bg-emerald-50 text-emerald-700 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Visited
                            </span>
                          ) : (() => {
                            const istMidnight = getISTMidnight();
                            const schedDate = new Date(b.dateKey);
                            schedDate.setHours(0, 0, 0, 0);
                            if (schedDate < istMidnight) {
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
                            }
                            return (
                              <span className="bg-blue-50 text-blue-700 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1">
                                <Clock className="w-3 h-3" /> Upcoming
                              </span>
                            );
                          })()}
                        </td>
                        <td className="p-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleToggleVisited(b)}
                              className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-colors ${
                                b.visited
                                  ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                  : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                              }`}
                              title={b.visited ? "Mark as Active" : "Mark as Visited"}
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>{b.visited ? "Mark Active" : "Mark Visited"}</span>
                            </button>
                            <button
                              onClick={() => {
                                if (b.visited) {
                                  toast.warning("Visited bookings cannot be rescheduled. Please unmark visit first.");
                                  return;
                                }
                                setRescheduleItem(b);
                                setRsSelectedDate(null);
                              }}
                              disabled={b.visited}
                              className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-colors ${
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
                            <button
                              onClick={() => handleCancelSingleBooking(b)}
                              className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors"
                              title="Delete booking"
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
      )}

      {/* ----------------------------------------------------
          VIEW 2: PERFORMANCE ANALYTICS
          ---------------------------------------------------- */}
      {activeView === "analytics" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Analytics Header */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setActiveView("main")}
                className="p-2 hover:bg-slate-100 rounded-full text-slate-500 hover:text-slate-900 transition-colors"
                title="Back to Bookings"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <div>
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-600" />
                  <span>Booking Performance Analytics</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Track agent productivity and how many bookings each agent created within the selected date range.
                </p>
              </div>
            </div>

            {/* Date Filters & Total Badge */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700">
                <span className="text-[10px] font-bold text-slate-400 uppercase">From:</span>
                <input
                  type="date"
                  value={analyticsStartDate}
                  onChange={(e) => {
                    setAnalyticsStartDate(e.target.value);
                    setAnalyticsCurrentPage(1);
                  }}
                  className="bg-transparent outline-none text-slate-800 text-xs font-semibold cursor-pointer"
                />
              </div>

              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700">
                <span className="text-[10px] font-bold text-slate-400 uppercase">To:</span>
                <input
                  type="date"
                  value={analyticsEndDate}
                  onChange={(e) => {
                    setAnalyticsEndDate(e.target.value);
                    setAnalyticsCurrentPage(1);
                  }}
                  className="bg-transparent outline-none text-slate-800 text-xs font-semibold cursor-pointer"
                />
              </div>

              {(analyticsStartDate || analyticsEndDate) && (
                <button
                  onClick={() => {
                    setAnalyticsStartDate("");
                    setAnalyticsEndDate("");
                    setAnalyticsCurrentPage(1);
                  }}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-colors flex items-center gap-1"
                  title="Reset date filters"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              )}

              <div className="px-3.5 py-2 bg-blue-50 border border-blue-200 rounded-xl text-xs font-bold text-blue-700 shadow-xs">
                {analyticsData.totalBookings} Bookings
              </div>
            </div>
          </div>

          {/* 1. AGENT PERFORMANCE SUMMARY TABLE */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <span>Agent Performance Breakdown</span>
              </h3>
              <span className="text-xs text-slate-500 font-medium">
                {analyticsData.agentPerformance.length} Active Agents
              </span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-100">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                    <th className="p-4">Agent Details</th>
                    <th className="p-4 text-center">Total Bookings</th>
                    <th className="p-4 text-center">Rescheduled</th>
                    <th className="p-4 text-center">Visited</th>
                    <th className="p-4 text-center">Non-Visited</th>
                    <th className="p-4 text-center">Success Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                  {analyticsData.agentPerformance.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-400 font-medium">
                        No agent bookings found in the selected date range.
                      </td>
                    </tr>
                  ) : (
                    analyticsData.agentPerformance.map((ag) => {
                      const successRate =
                        ag.total > 0 ? Math.round((ag.visited / ag.total) * 100) : 0;
                      return (
                        <tr key={ag.email} className="hover:bg-slate-50/70 transition-colors">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs uppercase">
                                {ag.name.charAt(0)}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900 text-sm">{ag.name}</div>
                                <div className="text-[11px] text-slate-400">{ag.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-center">
                            <span className="font-extrabold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg text-xs">
                              {ag.total}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                            <span className="font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg text-xs">
                              {ag.rescheduled}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                            <span className="font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg text-xs">
                              {ag.visited}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                            <span className="font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg text-xs">
                              {ag.nonVisited}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <span
                                className={`font-black text-xs px-2.5 py-0.5 rounded-full ${
                                  successRate >= 75
                                    ? "bg-emerald-100 text-emerald-800"
                                    : successRate >= 40
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-rose-100 text-rose-800"
                                }`}
                              >
                                {successRate}%
                              </span>
                              <div className="w-20 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${
                                    successRate >= 75
                                      ? "bg-emerald-500"
                                      : successRate >= 40
                                      ? "bg-amber-500"
                                      : "bg-rose-500"
                                  }`}
                                  style={{ width: `${successRate}%` }}
                                />
                              </div>
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
        </div>
      )}

      {/* ----------------------------------------------------
          VIEW 3: RESCHEDULE HISTORY LOGS
          ---------------------------------------------------- */}
      {activeView === "logs" && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <History className="w-5 h-5 text-purple-600" />
              <span>Reschedule Audit Trail</span>
            </h3>
            <button
              onClick={() => setActiveView("main")}
              className="px-3 py-1 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
            >
              Back to Bookings
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                  <th className="p-4">IP / IW Name</th>
                  <th className="p-4">Seat Owner (Agent)</th>
                  <th className="p-4">Original Date</th>
                  <th className="p-4">New Target Date</th>
                  <th className="p-4">Action By</th>
                  <th className="p-4 text-right">Time of Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {activeRescheduleLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-slate-400">
                      No reschedule events recorded.
                    </td>
                  </tr>
                ) : (
                  activeRescheduleLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="p-4 font-bold text-slate-900">{log.ipName}</td>
                      <td className="p-4 text-blue-600 font-semibold">{log.seatOwner}</td>
                      <td className="p-4 font-bold text-rose-600">{log.originalDate}</td>
                      <td className="p-4 font-bold text-emerald-700">{log.newDate}</td>
                      <td className="p-4 text-slate-600">{log.actionBy}</td>
                      <td className="p-4 text-right text-slate-400">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- SINGLE DAY EDIT MODAL --- */}
      {singleEditDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white max-w-sm w-full rounded-2xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              Edit Availability for {singleEditDate}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Seats Quota
                </label>
                <input
                  type="number"
                  min={0}
                  value={singleSeats}
                  onChange={(e) => setSingleSeats(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Public Note / Holiday Notice
                </label>
                <input
                  type="text"
                  value={singleText}
                  onChange={(e) => setSingleText(e.target.value)}
                  placeholder="e.g. Public Holiday"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setSingleEditDate(null)}
                className="px-3 py-1.5 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSingleDay}
                disabled={singleSaving}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm"
              >
                {singleSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- BULK AVAILABILITY EDIT MODAL --- */}
      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white max-w-lg w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Settings className="w-4 h-4 text-amber-500" />
                <span>Manage Availability & Quotas</span>
              </h3>
              <button
                onClick={() => setBulkModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target Month & Year Pickers */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Target Month
                </label>
                <select
                  value={bulkMonth}
                  onChange={(e) => {
                    setBulkMonth(Number(e.target.value));
                    setBulkSelectedDates(new Set());
                  }}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold cursor-pointer"
                >
                  {[
                    "January", "February", "March", "April", "May", "June",
                    "July", "August", "September", "October", "November", "December",
                  ].map((m, i) => (
                    <option key={m} value={i}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Target Year
                </label>
                <select
                  value={bulkYear}
                  onChange={(e) => {
                    setBulkYear(Number(e.target.value));
                    setBulkSelectedDates(new Set());
                  }}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold cursor-pointer"
                >
                  {[2025, 2026, 2027].map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Tab switch: All Days vs Custom Days */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                Apply Availability To:
              </label>
              <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                <button
                  type="button"
                  onClick={() => setBulkMode("all")}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                    bulkMode === "all"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  All Days in Month
                </button>
                <button
                  type="button"
                  onClick={() => setBulkMode("custom")}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                    bulkMode === "custom"
                      ? "bg-white text-amber-600 shadow-xs"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  Custom Days ({bulkSelectedDates.size})
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Seats Quota Per Day
              </label>
              <input
                type="number"
                min={0}
                value={bulkSeats}
                onChange={(e) => setBulkSeats(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-bold"
              />
            </div>

            {/* Custom Days Interactive Mini-Calendar */}
            {bulkMode === "custom" && (
              <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/70 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-slate-500 font-medium">
                    Click dates to add to selection
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const daysInMonth = new Date(bulkYear, bulkMonth + 1, 0).getDate();
                        const nextSet = new Set<string>();
                        for (let d = 1; d <= daysInMonth; d++) {
                          const dayOfWeek = new Date(bulkYear, bulkMonth, d).getDay();
                          if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                            const dk = `${bulkYear}-${String(bulkMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                            nextSet.add(dk);
                          }
                        }
                        setBulkSelectedDates(nextSet);
                      }}
                      className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded text-[10px] font-bold text-slate-700 shadow-xs"
                    >
                      Mon-Fri
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const daysInMonth = new Date(bulkYear, bulkMonth + 1, 0).getDate();
                        const nextSet = new Set<string>();
                        for (let d = 1; d <= daysInMonth; d++) {
                          const dk = `${bulkYear}-${String(bulkMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                          nextSet.add(dk);
                        }
                        setBulkSelectedDates(nextSet);
                      }}
                      className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded text-[10px] font-bold text-slate-700 shadow-xs"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setBulkSelectedDates(new Set())}
                      className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded text-[10px] font-bold text-rose-600 shadow-xs"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-1 text-[9px] font-bold text-center text-slate-400 uppercase">
                  <div>S</div><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div>
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {(() => {
                    const firstDay = new Date(bulkYear, bulkMonth, 1).getDay();
                    const daysInMonth = new Date(bulkYear, bulkMonth + 1, 0).getDate();
                    const boxes = [];

                    for (let i = 0; i < firstDay; i++) {
                      boxes.push(<div key={`bulk-empty-${i}`} className="h-9" />);
                    }

                    for (let d = 1; d <= daysInMonth; d++) {
                      const dateKey = `${bulkYear}-${String(bulkMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                      const isSelected = bulkSelectedDates.has(dateKey);

                      boxes.push(
                        <button
                          type="button"
                          key={`bulk-day-${dateKey}`}
                          onClick={() => {
                            const nextSet = new Set(bulkSelectedDates);
                            if (nextSet.has(dateKey)) nextSet.delete(dateKey);
                            else nextSet.add(dateKey);
                            setBulkSelectedDates(nextSet);
                          }}
                          className={`h-9 rounded-lg text-xs font-bold transition-all flex items-center justify-center ${
                            isSelected
                              ? "bg-amber-500 text-white ring-2 ring-amber-500 shadow-xs font-extrabold"
                              : "bg-white border border-slate-200 text-slate-700 hover:bg-amber-50 hover:border-amber-300"
                          }`}
                        >
                          <span>{d}</span>
                        </button>
                      );
                    }

                    return boxes;
                  })()}
                </div>

                <div className="text-[11px] font-semibold text-center text-amber-800 bg-amber-50/80 py-1.5 rounded-lg border border-amber-200">
                  {bulkSelectedDates.size} date{bulkSelectedDates.size === 1 ? "" : "s"} selected for quota update
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setBulkModalOpen(false)}
                className="px-3.5 py-2 border border-slate-200 text-xs font-semibold rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveBulkAvailability}
                disabled={bulkSaving || (bulkMode === "custom" && bulkSelectedDates.size === 0)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
              >
                {bulkSaving
                  ? "Applying..."
                  : bulkMode === "custom"
                  ? `Apply to ${bulkSelectedDates.size} Selected Days`
                  : "Apply to All Days in Month"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- ADMIN RESCHEDULE MODAL --- */}
      {rescheduleItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Reschedule Booking</h3>
              <button onClick={() => setRescheduleItem(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1">
              <div>
                IP Name: <strong className="text-slate-900">{rescheduleItem.ipName}</strong>
              </div>
              <div>
                Current Date: <strong className="text-rose-600">{rescheduleItem.dateKey}</strong>
              </div>
            </div>

            {/* Mini Calendar for Target Date Selection */}
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
                    boxes.push(<div key={`admin-rs-empty-${i}`} className="h-8" />);
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
                        key={`admin-rs-${dateKey}`}
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
              <strong className="text-blue-600">{rsSelectedDate || "Please click a green date"}</strong>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setRescheduleItem(null)}
                className="px-3 py-1.5 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAdminReschedule}
                disabled={!rsSelectedDate || rsLoading}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg shadow-sm"
              >
                {rsLoading ? "Processing..." : "Confirm Reschedule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
