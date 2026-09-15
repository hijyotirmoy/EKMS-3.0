"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  increment,
  getDoc,
  getDocs,
  runTransaction,
  writeBatch,
  arrayUnion,
  arrayRemove,
  query,
  where,
  deleteDoc,
} from "firebase/firestore";
import { db, bookingDb } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { DayAvailability, BookingRecord, RescheduleLog } from "@/lib/types";
import { getISTMidnight, getFollowUpInfo, mergeBookingData, deleteBookingRecordCompletely } from "@/lib/utils";
import { getCachedData, setCachedData, clearCachedData } from "@/lib/firestoreCache";
import { maskIpName, maskPhone } from "@/lib/maskUtils";
import { logUserActivity } from "@/lib/activityLogger";
import { createNotification, notifyAdmins } from "@/lib/notificationService";
import * as XLSX from "xlsx";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Ticket,
  CalendarDays,
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
  EyeOff,
  Edit3,
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
  const [maskIpInfo, setMaskIpInfo] = useState(false);

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

  // Edit Booking Modal State
  const [editBookingItem, setEditBookingItem] = useState<AdminBookingRecord | null>(null);
  const [editIpName, setEditIpName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Bulk Selection for Bookings Table
  const [selectedBookingKeys, setSelectedBookingKeys] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [followUpDays, setFollowUpDays] = useState<number>(8);
  const [modalFollowUpDays, setModalFollowUpDays] = useState<number>(8);
  const [syncingDb, setSyncingDb] = useState(false);

  // 1. Live Snapshot Listeners for instant real-time sync (Combining Main & Secondary DBs)
  useEffect(() => {
    let isMounted = true;
    let mainBookings: Record<string, DayAvailability> = {};
    let secBookings: Record<string, DayAvailability> = {};

    let mainLogs: RescheduleLog[] = [];
    let secLogs: RescheduleLog[] = [];

    const syncBookings = () => {
      if (!isMounted) return;
      setLiveBookings(mergeBookingData(mainBookings, secBookings));
    };

    const syncLogs = () => {
      if (!isMounted) return;
      const combinedMap = new Map<string, RescheduleLog>();
      mainLogs.forEach((l) => combinedMap.set(l.id || `${l.timestamp}_${l.ipName}`, l));
      secLogs.forEach((l) => combinedMap.set(l.id || `${l.timestamp}_${l.ipName}`, l));
      const logs = Array.from(combinedMap.values());
      logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setRescheduleLogs(logs);
    };

    // Main Bookings
    const unsubBookingsMain = onSnapshot(
      collection(db, "bookings"),
      (snap) => {
        const data: Record<string, DayAvailability> = {};
        snap.forEach((d) => {
          data[d.id] = d.data() as DayAvailability;
        });
        mainBookings = data;
        syncBookings();
      },
      (err) => console.warn("Main bookings snapshot error:", err)
    );

    // Secondary Bookings
    const unsubBookingsSec = onSnapshot(
      collection(bookingDb, "bookings"),
      (snap) => {
        const data: Record<string, DayAvailability> = {};
        snap.forEach((d) => {
          data[d.id] = d.data() as DayAvailability;
        });
        secBookings = data;
        syncBookings();
      },
      (err) => console.warn("Secondary bookings snapshot error:", err)
    );

    // Main Logs
    const unsubLogsMain = onSnapshot(
      collection(db, "rescheduleLogs"),
      (snap) => {
        const logs: RescheduleLog[] = [];
        snap.forEach((d) => logs.push({ id: d.id, ...(d.data() as Omit<RescheduleLog, "id">) }));
        mainLogs = logs;
        syncLogs();
      },
      (err) => console.warn("Main logs snapshot error:", err)
    );

    // Secondary Logs
    const unsubLogsSec = onSnapshot(
      collection(bookingDb, "rescheduleLogs"),
      (snap) => {
        const logs: RescheduleLog[] = [];
        snap.forEach((d) => logs.push({ id: d.id, ...(d.data() as Omit<RescheduleLog, "id">) }));
        secLogs = logs;
        syncLogs();
      },
      (err) => console.warn("Secondary logs snapshot error:", err)
    );

    const unsubStatus = onSnapshot(
      doc(db, "system", "status"),
      (snap) => {
        if (!isMounted) return;
        if (snap.exists()) {
          const data = snap.data();
          setMaskIpInfo(!!data.maskIpInfo);
          if (data.followUpDays && typeof data.followUpDays === "number") {
            setFollowUpDays(data.followUpDays);
            setModalFollowUpDays(data.followUpDays);
          }
        }
      },
      (err) => console.warn("Status snapshot error:", err)
    );

    // Fetch user profiles (cached 10 mins)
    const USER_TTL = 10 * 60 * 1000;
    const cachedUsers = getCachedData<Record<string, string>>("admin_user_profiles_map", USER_TTL);
    if (cachedUsers) {
      setUserProfiles(cachedUsers);
    } else {
      getDocs(collection(db, "users")).then((snap) => {
        if (!isMounted) return;
        const map: Record<string, string> = {};
        snap.forEach((d) => {
          map[d.id.toLowerCase()] = d.data().displayName || d.data().name || d.id;
        });
        setUserProfiles(map);
        setCachedData("admin_user_profiles_map", map);
      }).catch(() => {});
    }

    return () => {
      isMounted = false;
      unsubBookingsMain();
      unsubBookingsSec();
      unsubLogsMain();
      unsubLogsSec();
      unsubStatus();
    };
  }, []);

  // 2. Flatten Bookings & Compute 13 Metrics
  const { allBookings, activeRescheduleLogs, rescheduleCountMap, metrics } = useMemo(() => {
    const list: AdminBookingRecord[] = [];
    const todayObj = new Date();
    const todayKey = todayObj.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const currentYear = todayObj.getFullYear();
    const currentMonth = todayObj.getMonth();
    const currentDay = todayObj.getDate();

    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
    const nextMonthYear = currentMonth === 11 ? currentYear + 1 : currentYear;

    const istMidnight = getISTMidnight();

    // Map reschedule logs: find latest reschedule event and initial original date per (seatOwner, ipName)
    const latestRescheduleMap = new Map<string, RescheduleLog>();
    const initialRescheduleMap = new Map<string, RescheduleLog>();
    const rescheduleCountMap = new Map<string, number>();

    rescheduleLogs.forEach((l) => {
      const owner = (l.seatOwner || "").toLowerCase().trim();
      const ip = (l.ipName || "").toLowerCase().trim();
      const key = `${owner}___${ip}`;

      rescheduleCountMap.set(key, (rescheduleCountMap.get(key) || 0) + 1);

      if (!latestRescheduleMap.has(key)) {
        latestRescheduleMap.set(key, l);
      }
      initialRescheduleMap.set(key, l);
    });

    let total = 0,
      month = 0,
      lastMonthCount = 0,
      nextMonthCount = 0,
      todaysVisit = 0,
      todaysFollowup = 0,
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
          const emailLower = (record.agentEmail || "").toLowerCase().trim();
          const ipLower = (record.ipName || "").toLowerCase().trim();
          const key = `${emailLower}___${ipLower}`;

          const latestLog = latestRescheduleMap.get(key);
          const initialLog = initialRescheduleMap.get(key);

          total++;
          const cleanName =
            userProfiles[emailLower] ||
            (record.agentEmail
              ? record.agentEmail.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
              : "Unknown Agent");

          const isRescheduled = !!(record.rescheduled || record.isRescheduled || latestLog);
          const originalScheduledDate =
            record.originalScheduledDate || initialLog?.originalDate || latestLog?.originalDate || dateKey;
          const rescheduledDate = isRescheduled ? (record.rescheduledDate || dateKey) : undefined;

          list.push({
            ...record,
            dateKey,
            agentName: cleanName,
            rescheduled: isRescheduled,
            originalScheduledDate,
            rescheduledDate,
          });

          const bookedTime = new Date(record.timestamp);
          const isBookedThisMonth =
            bookedTime.getFullYear() === currentYear &&
            bookedTime.getMonth() === currentMonth;

          if ((y === currentYear && mIdx === currentMonth) || isBookedThisMonth) month++;
          if (y === lastMonthYear && mIdx === lastMonth) lastMonthCount++;
          if (y === nextMonthYear && mIdx === nextMonth) nextMonthCount++;
          if (dateKey === todayKey && !record.visited) todaysVisit++;

          const followUpInfo = getFollowUpInfo(dateKey, followUpDays);
          if (!record.visited) {
            todaysFollowup++;
          }

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
        deleteDoc(doc(bookingDb, "rescheduleLogs", l.id)).catch(() => {});
      }
    });

    const rescheduledCount = list.filter((b) => b.rescheduled).length || activeLogs.length;

    return {
      allBookings: list,
      activeRescheduleLogs: activeLogs,
      rescheduleCountMap,
      metrics: {
        total,
        month,
        lastMonthCount,
        nextMonthCount,
        todaysVisit,
        todaysFollowup,
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
  }, [liveBookings, userProfiles, rescheduleLogs, followUpDays]);

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
    const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

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
        if (statusFilter === "todays_visit") return b.dateKey === todayKey && !b.visited;
        if (statusFilter === "visited") return !!b.visited;
        if (statusFilter === "todays_followup" || statusFilter === "followup" || statusFilter === "delayed") {
          return !b.visited;
        }
        if (b.visited) return false;

        const sched = new Date(b.dateKey);
        sched.setHours(0, 0, 0, 0);
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
  }, [allBookings, agentFilter, searchTerm, statusFilter, bookingStartDate, bookingEndDate, followUpDays]);

  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / itemsPerPage));
  const paginatedBookings = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredBookings.slice(start, start + itemsPerPage);
  }, [filteredBookings, currentPage]);

  const adminFilterLabel = useMemo(() => {
    switch (statusFilter) {
      case "todays_visit":
        return "Today's Visit";
      case "todays_followup":
      case "followup":
      case "delayed":
        return "Follow up";
      case "upcoming":
        return "Upcoming";
      case "visited":
        return "Visited";
      default:
        return "All Bookings";
    }
  }, [statusFilter]);

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
    const displayName = maskIpInfo && b.ipName ? maskIpName(b.ipName) : (b.ipName || "this booking");
    const confirmed = await showConfirm({
      title: "Remove Booking?",
      message: `Are you sure you want to remove the booking for ${displayName}? The seat will be released immediately.`,
      isDestructive: true,
      confirmText: "Remove Booking",
    });
    if (!confirmed) return;

    try {
      const removedCount = await deleteBookingRecordCompletely(
        {
          timestamp: b.timestamp,
          agentEmail: b.agentEmail,
          ipName: b.ipName,
          phone: b.phone,
          dateKey: b.dateKey,
          rescheduledDate: b.rescheduledDate,
          originalScheduledDate: b.originalScheduledDate,
        },
        db,
        bookingDb
      );

      if (removedCount === 0) {
        throw new Error("This booking record was not found or was already removed.");
      }

      // Send notifications for cancellation
      try {
        await notifyAdmins({
          title: "🗑️ Booking Cancelled / Removed",
          message: `**${userProfile?.displayName || user?.email}** removed the booking for **${b.ipName || "Beneficiary"}** (Phone: **${b.phone || "N/A"}**) on **${b.rescheduledDate || b.dateKey}**.`,
          type: "booking",
          link: "/admin/bookings",
          metadata: {
            ipName: b.ipName,
            phone: b.phone,
            dateKey: b.dateKey,
          },
        });

        if (b.agentEmail) {
          await createNotification({
            title: "🗑️ Booking Cancelled",
            message: `Your booking for **${b.ipName || "Beneficiary"}** (Phone: **${b.phone || "N/A"}**) on **${b.rescheduledDate || b.dateKey}** was removed by admin.`,
            type: "booking",
            targetEmail: b.agentEmail.toLowerCase().trim(),
            link: "/booking",
            metadata: {
              ipName: b.ipName,
              phone: b.phone,
              dateKey: b.dateKey,
            },
          });
        }
      } catch (notifErr) {
        console.error("Cancel notification error:", notifErr);
      }

      logUserActivity(user?.email, {
        desc: `Deleted verification booking for IP: ${b.ipName || "Beneficiary"} (Phone: ${b.phone || "N/A"}) on ${b.dateKey}`,
        type: "delete",
      });
      toast.success("Booking successfully removed and seat released.");
    } catch (e: any) {
      toast.error("Failed to remove booking: " + e.message);
    }
  };

  // Edit Booking Handler
  const handleSaveEditBooking = async () => {
    if (!editBookingItem) return;
    const trimmedName = editIpName.trim();
    const trimmedPhone = editPhone.trim();

    if (!trimmedName) {
      toast.error("Please enter IP / IW Name.");
      return;
    }
    if (!trimmedPhone) {
      toast.error("Please enter Phone Number.");
      return;
    }

    setEditSaving(true);
    try {
      const candidateDates = Array.from(
        new Set(
          [
            editBookingItem.dateKey,
            editBookingItem.rescheduledDate,
            editBookingItem.originalScheduledDate,
          ].filter(Boolean) as string[]
        )
      );

      for (const dateStr of candidateDates) {
        const updateRecordsInDb = async (firestoreInstance: any) => {
          try {
            const docRef = doc(firestoreInstance, "bookings", dateStr);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
              const currentRecords: BookingRecord[] = snap.data()?.bookedRecords || [];
              let updated = false;
              const updatedRecords = currentRecords.map((r) => {
                if (
                  (r.timestamp === editBookingItem.timestamp &&
                    (r.agentEmail || "").toLowerCase().trim() === (editBookingItem.agentEmail || "").toLowerCase().trim()) ||
                  ((r.agentEmail || "").toLowerCase().trim() === (editBookingItem.agentEmail || "").toLowerCase().trim() &&
                    (r.ipName || "").toLowerCase().trim() === (editBookingItem.ipName || "").toLowerCase().trim() &&
                    r.phone === editBookingItem.phone)
                ) {
                  updated = true;
                  return {
                    ...r,
                    ipName: trimmedName,
                    phone: trimmedPhone,
                  };
                }
                return r;
              });
              if (updated) {
                await updateDoc(docRef, { bookedRecords: updatedRecords });
              }
            }
          } catch (e) {
            console.warn("Edit update error in DB:", e);
          }
        };

        await Promise.allSettled([updateRecordsInDb(bookingDb), updateRecordsInDb(db)]);
      }

        // Update matching reschedule logs as well for consistency
        const updateLogsInDb = async (firestoreInstance: any) => {
          try {
            const q = query(
              collection(firestoreInstance, "rescheduleLogs"),
              where("timestamp", "==", editBookingItem.timestamp)
            );
            const logsSnap = await getDocs(q);
            const batch = writeBatch(firestoreInstance);
            let hasUpdates = false;
            logsSnap.forEach((logDoc) => {
              batch.update(logDoc.ref, {
                ipName: trimmedName,
                phone: trimmedPhone,
              });
              hasUpdates = true;
            });
            if (hasUpdates) {
              await batch.commit();
            }
          } catch (e) {
            console.warn("Could not sync reschedule logs:", e);
          }
        };

        await Promise.allSettled([updateLogsInDb(db), updateLogsInDb(bookingDb)]);

        logUserActivity(user?.email, {
          desc: `Updated booking details for ${trimmedName} (${editBookingItem.dateKey})`,
          type: "edit",
        });

        toast.success("Booking details updated successfully!");
        setEditBookingItem(null);
    } catch (error: any) {
      console.error("Edit booking error:", error);
      toast.error(error.message || "Failed to update booking details.");
    } finally {
      setEditSaving(false);
    }
  };

  // Mark / Unmark Single Booking as Visited
  const handleToggleVisited = async (b: AdminBookingRecord) => {
    const rawIp = b.ipName || "this IP";
    const ipName = maskIpInfo && b.ipName ? maskIpName(b.ipName) : rawIp;
    const isCurrentlyVisited = !!b.visited;

    const confirmed = await showConfirm({
      title: isCurrentlyVisited ? "Unmark Visit?" : "Confirm Hospital Visit?",
      message: isCurrentlyVisited
        ? `Are you sure you want to unmark the visit for ${ipName} and revert the status to active?`
        : `Are you sure this IP (${ipName}) visited the hospital for their scheduled health check-up?`,
      confirmText: isCurrentlyVisited ? "Yes, Unmark" : "Yes, Mark Visited",
      cancelText: "Cancel",
      isDestructive: false,
    });

    if (!confirmed) return;

    const candidateDates = Array.from(
      new Set(
        [b.dateKey, b.rescheduledDate, b.originalScheduledDate].filter(Boolean) as string[]
      )
    );

    try {
      for (const dateStr of candidateDates) {
        const updateVisitedInDb = async (firestoreInstance: any) => {
          try {
            const targetRef = doc(firestoreInstance, "bookings", dateStr);
            const snap = await getDoc(targetRef);
            if (snap.exists()) {
              const records: BookingRecord[] = snap.data()?.bookedRecords || [];
              let updated = false;
              const updatedRecords = records.map((r) => {
                if (
                  (r.timestamp === b.timestamp &&
                    (r.agentEmail || "").toLowerCase().trim() === (b.agentEmail || "").toLowerCase().trim()) ||
                  ((r.agentEmail || "").toLowerCase().trim() === (b.agentEmail || "").toLowerCase().trim() &&
                    (r.ipName || "").toLowerCase().trim() === (b.ipName || "").toLowerCase().trim() &&
                    r.phone === b.phone)
                ) {
                  updated = true;
                  return { ...r, visited: !b.visited };
                }
                return r;
              });
              if (updated) {
                await updateDoc(targetRef, { bookedRecords: updatedRecords });
              }
            }
          } catch (e) {
            console.warn("Visited update error:", e);
          }
        };

        await Promise.allSettled([updateVisitedInDb(bookingDb), updateVisitedInDb(db)]);
      }

      // Send notifications for visit status update
      try {
        const isNowVisited = !b.visited;
        const actionText = isNowVisited ? "marked as Visited" : "unmarked and reverted to active";
        const notifTitle = isNowVisited ? "🏥 Booking Marked as Visited" : "🔄 Visit Status Reverted";

        if (b.agentEmail) {
          await createNotification({
            title: notifTitle,
            message: `Your booking for **${b.ipName || "Beneficiary"}** (Phone: **${b.phone || "N/A"}**) on **${b.dateKey}** has been ${actionText} by ${userProfile?.displayName || "Admin"}.`,
            type: "booking",
            targetEmail: b.agentEmail.toLowerCase().trim(),
            link: "/booking",
            metadata: {
              ipName: b.ipName,
              phone: b.phone,
              dateKey: b.dateKey,
            },
          });
        }
        await notifyAdmins({
          title: notifTitle,
          message: `Booking for **${b.ipName || "Beneficiary"}** (Phone: **${b.phone || "N/A"}**) on **${b.dateKey}** (booked by ${b.agentName || b.agentEmail}) was ${actionText} by ${userProfile?.displayName || "Admin"}.`,
          type: "booking",
          link: "/admin/bookings",
          metadata: {
            ipName: b.ipName,
            phone: b.phone,
            dateKey: b.dateKey,
          },
        });
      } catch (notifErr) {
        console.error("Visited notification error:", notifErr);
      }

      logUserActivity(user?.email, {
        desc: `${!b.visited ? "Marked as Visited" : "Unmarked Visited"} for IP: ${b.ipName || "Beneficiary"} (Phone: ${b.phone || "N/A"}) on ${b.dateKey}`,
        type: "booking",
      });

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
      const saveCapacityInDb = async (firestoreInstance: any) => {
        await setDoc(
          doc(firestoreInstance, "bookings", singleEditDate),
          {
            seats: Number(singleSeats),
            text: singleText.trim(),
          },
          { merge: true }
        );
      };

      await Promise.allSettled([saveCapacityInDb(bookingDb), saveCapacityInDb(db)]);
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
      const batch = writeBatch(bookingDb);
      const daysInMonth = new Date(bulkYear, bulkMonth + 1, 0).getDate();

      if (bulkMode === "all") {
        for (let d = 1; d <= daysInMonth; d++) {
          const dateKey = `${bulkYear}-${String(bulkMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          batch.set(doc(bookingDb, "bookings", dateKey), { seats: Number(bulkSeats) }, { merge: true });
        }
      } else {
        bulkSelectedDates.forEach((dateKey) => {
          batch.set(doc(bookingDb, "bookings", dateKey), { seats: Number(bulkSeats) }, { merge: true });
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
      ["Today's Visit", metrics.todaysVisit],
      ["Today's Bookings", metrics.todayCount],
      ["Visited", metrics.visited],
      ["Non-Visited", metrics.nonVisited],
      ["Upcoming", metrics.upcoming],
      ["Follow-ups", metrics.delayed],
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
        "Action By": l.actionByName || userProfiles[l.actionBy?.toLowerCase()] || (l.actionBy && l.actionBy.includes("@") ? l.actionBy.split("@")[0].replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : l.actionBy || "-"),
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
        const found = allBookings.find(
          (b) =>
            b.dateKey === dateKey &&
            b.timestamp === Number(timestampStr) &&
            (b.agentEmail || "").toLowerCase().trim() === (email || "").toLowerCase().trim()
        );

        await deleteBookingRecordCompletely(
          {
            timestamp: Number(timestampStr),
            agentEmail: email,
            ipName: found?.ipName,
            phone: found?.phone,
            dateKey: dateKey,
            rescheduledDate: found?.rescheduledDate,
            originalScheduledDate: found?.originalScheduledDate,
          },
          db,
          bookingDb
        );
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

  // --- 6B. FULL BI-DIRECTIONAL DEDUPLICATING DATABASE SYNCHRONIZER ---
  const handleSyncDatabases = async () => {
    setSyncingDb(true);
    try {
      const [mainSnap, secSnap] = await Promise.all([
        getDocs(collection(db, "bookings")),
        getDocs(collection(bookingDb, "bookings")),
      ]);

      const dateDocsMap = new Map<string, { mainData?: any; secData?: any }>();

      mainSnap.forEach((d) => {
        if (!dateDocsMap.has(d.id)) dateDocsMap.set(d.id, {});
        dateDocsMap.get(d.id)!.mainData = d.data();
      });

      secSnap.forEach((d) => {
        if (!dateDocsMap.has(d.id)) dateDocsMap.set(d.id, {});
        dateDocsMap.get(d.id)!.secData = d.data();
      });

      interface RecordLoc {
        record: BookingRecord;
        dateKey: string;
      }
      const recordLocationsMap = new Map<string, RecordLoc[]>();

      dateDocsMap.forEach((val, dateKey) => {
        const combinedRaw: BookingRecord[] = [
          ...(val.mainData?.bookedRecords || []),
          ...(val.secData?.bookedRecords || []),
        ];

        const uniqueInDate = new Map<string, BookingRecord>();
        combinedRaw.forEach((r) => {
          const key = `${r.timestamp}_${(r.agentEmail || "").toLowerCase().trim()}`;
          if (!uniqueInDate.has(key) || r.rescheduledDate) {
            uniqueInDate.set(key, r);
          }
        });

        uniqueInDate.forEach((r) => {
          const key = `${r.timestamp}_${(r.agentEmail || "").toLowerCase().trim()}`;
          if (!recordLocationsMap.has(key)) recordLocationsMap.set(key, []);
          recordLocationsMap.get(key)!.push({ record: r, dateKey });
        });
      });

      const finalDateRecordsMap = new Map<string, BookingRecord[]>();
      let duplicatesRemoved = 0;

      recordLocationsMap.forEach((locations) => {
        let bestLoc = locations[0];
        if (locations.length > 1) {
          duplicatesRemoved += locations.length - 1;
          const targetDateLoc = locations.find((l) => l.record.rescheduledDate && l.record.rescheduledDate === l.dateKey);
          if (targetDateLoc) {
            bestLoc = targetDateLoc;
          } else {
            bestLoc = locations.reduce((prev, curr) =>
              curr.record.rescheduledDate === curr.dateKey ? curr : prev
            );
          }
        }

        const targetDate = bestLoc.record.rescheduledDate || bestLoc.dateKey;
        if (!finalDateRecordsMap.has(targetDate)) finalDateRecordsMap.set(targetDate, []);

        const rawCleanRec: BookingRecord = {
          agentEmail: bestLoc.record.agentEmail || "",
          ipName: bestLoc.record.ipName || "",
          phone: bestLoc.record.phone || "",
          timestamp: bestLoc.record.timestamp || Date.now(),
          visited: !!bestLoc.record.visited,
          rescheduled: !!bestLoc.record.rescheduled,
          originalScheduledDate: bestLoc.record.originalScheduledDate,
          rescheduledDate: bestLoc.record.rescheduledDate,
        };

        const cleanRec: BookingRecord = JSON.parse(JSON.stringify(rawCleanRec));

        const existingInTarget = finalDateRecordsMap.get(targetDate)!;
        if (!existingInTarget.some((e) => e.timestamp === cleanRec.timestamp && (e.agentEmail || "").toLowerCase() === (cleanRec.agentEmail || "").toLowerCase())) {
          existingInTarget.push(cleanRec);
        }
      });

      const allDateKeys = Array.from(new Set([...Array.from(dateDocsMap.keys()), ...Array.from(finalDateRecordsMap.keys())]));

      for (const dateKey of allDateKeys) {
        const finalRecords = finalDateRecordsMap.get(dateKey) || [];
        const baseDoc = dateDocsMap.get(dateKey)?.mainData || dateDocsMap.get(dateKey)?.secData || {};
        const maxSeats = baseDoc.seats !== undefined && finalRecords.length === 0 ? baseDoc.seats : Math.max(0, 20 - finalRecords.length);
        const publicText = baseDoc.publicText || "";

        const rawPayload = {
          seats: maxSeats,
          bookedRecords: finalRecords,
          ...(publicText ? { publicText } : {}),
        };

        const payload = JSON.parse(JSON.stringify(rawPayload));

        const refMain = doc(db, "bookings", dateKey);
        const refSec = doc(bookingDb, "bookings", dateKey);

        await Promise.allSettled([
          setDoc(refMain, payload, { merge: true }),
          setDoc(refSec, payload, { merge: true }),
        ]);
      }

      // Sync rescheduleLogs between both databases
      const [mainLogsSnap, secLogsSnap] = await Promise.all([
        getDocs(collection(db, "rescheduleLogs")),
        getDocs(collection(bookingDb, "rescheduleLogs")),
      ]);

      const logsMap = new Map<string, any>();
      mainLogsSnap.forEach((l) => logsMap.set(l.id, l.data()));
      secLogsSnap.forEach((l) => logsMap.set(l.id, l.data()));

      for (const [logId, logData] of Array.from(logsMap.entries())) {
        const cleanLog = JSON.parse(JSON.stringify(logData));
        await Promise.allSettled([
          setDoc(doc(db, "rescheduleLogs", logId), cleanLog, { merge: true }),
          setDoc(doc(bookingDb, "rescheduleLogs", logId), cleanLog, { merge: true }),
        ]);
      }

      toast.success(
        `Database Sync Complete! Reconciled ${allDateKeys.length} dates across both Firebase accounts, cleaned ${duplicatesRemoved} duplicate entries, and synchronized all logs.`
      );
    } catch (e: any) {
      console.error("Full DB Sync Error:", e);
      toast.error("Database sync failed: " + e.message);
    } finally {
      setSyncingDb(false);
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

    try {
      // 1. Remove from all old date candidate documents in BOTH databases to prevent duplicates
      const candidateOldDates = Array.from(
        new Set(
          [
            rescheduleItem.dateKey,
            rescheduleItem.rescheduledDate,
            rescheduleItem.originalScheduledDate,
          ].filter(Boolean) as string[]
        )
      );

      for (const dateStr of candidateOldDates) {
        for (const firestoreInstance of [bookingDb, db]) {
          try {
            const oldRef = doc(firestoreInstance, "bookings", dateStr);
            const snap = await getDoc(oldRef);
            if (snap.exists()) {
              const rawRecords: BookingRecord[] = snap.data().bookedRecords || [];
              const matchIdx = rawRecords.findIndex(
                (r) =>
                  (r.timestamp === rescheduleItem.timestamp &&
                    (r.agentEmail || "").toLowerCase().trim() === (rescheduleItem.agentEmail || "").toLowerCase().trim()) ||
                  ((r.agentEmail || "").toLowerCase().trim() === (rescheduleItem.agentEmail || "").toLowerCase().trim() &&
                    (r.ipName || "").toLowerCase().trim() === (rescheduleItem.ipName || "").toLowerCase().trim() &&
                    r.phone === rescheduleItem.phone)
              );

              if (matchIdx !== -1) {
                const updatedRecords = [...rawRecords];
                updatedRecords.splice(matchIdx, 1);
                const currentSeats = snap.data().seats !== undefined ? snap.data().seats : 20;
                await updateDoc(oldRef, {
                  seats: Math.min(20, currentSeats + 1),
                  bookedRecords: updatedRecords,
                });
              }
            }
          } catch (e) {
            console.warn("Error removing old record:", e);
          }
        }
      }

      const origDate = rescheduleItem.originalScheduledDate || rescheduleItem.dateKey;

      const cleanNewRecord: BookingRecord = JSON.parse(JSON.stringify({
        agentEmail: rescheduleItem.agentEmail || "",
        ipName: rescheduleItem.ipName || "",
        phone: rescheduleItem.phone || "",
        timestamp: rescheduleItem.timestamp || Date.now(),
        visited: !!rescheduleItem.visited,
        rescheduled: true,
        originalScheduledDate: origDate,
        rescheduledDate: rsSelectedDate,
      }));

      // 2. Add to new date in BOTH databases
      const addNewRecord = async (firestoreInstance: any) => {
        const newRef = doc(firestoreInstance, "bookings", rsSelectedDate);
        try {
          await updateDoc(newRef, {
            seats: increment(-1),
            bookedRecords: arrayUnion(cleanNewRecord),
          });
        } catch {
          await setDoc(
            newRef,
            {
              seats: 19,
              bookedRecords: [cleanNewRecord],
            },
            { merge: true }
          );
        }
      };

      await Promise.allSettled([addNewRecord(bookingDb), addNewRecord(db)]);

      // 3. Log to rescheduleLogs in BOTH databases
      const logRefId = `${Date.now()}_${rescheduleItem.timestamp}`;
      const logPayload = JSON.parse(JSON.stringify({
        ipName: rescheduleItem.ipName || "",
        seatOwner: rescheduleItem.agentEmail || "",
        agentName: rescheduleItem.agentName || rescheduleItem.agentEmail || "",
        phone: rescheduleItem.phone || "",
        originalDate: rescheduleItem.dateKey,
        newDate: rsSelectedDate,
        actionBy: user.email?.toLowerCase() || "",
        actionByName: userProfile?.displayName || user?.displayName || user.email?.split("@")[0] || user.email || "Admin",
        timestamp: Date.now(),
      }));

      await Promise.allSettled([
        setDoc(doc(bookingDb, "rescheduleLogs", logRefId), logPayload, { merge: true }),
        setDoc(doc(db, "rescheduleLogs", logRefId), logPayload, { merge: true }),
      ]);

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
      dayBoxes.push(<div key={`empty-${i}`} className="h-11 sm:h-14 bg-slate-50/40 rounded-xl" />);
    }

    const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dbInfo = liveBookings[dateKey] || { seats: 0 };
      const isAvailable = dbInfo.seats > 0;
      const isToday = dateKey === todayIST;

      dayBoxes.push(
        <button
          key={dateKey}
          onClick={() => {
            setSingleEditDate(dateKey);
            setSingleSeats(dbInfo.seats || 0);
            setSingleText(dbInfo.text || "");
          }}
          className={`h-11 sm:h-14 p-0.5 sm:p-1.5 rounded-xl border flex flex-col items-center justify-between transition-all active:scale-95 shadow-2xs text-left cursor-pointer relative ${
            isToday ? "ring-2 ring-blue-500 ring-offset-1" : ""
          } ${
            isAvailable
              ? "bg-emerald-50/80 border-emerald-200 hover:bg-emerald-100 text-emerald-950"
              : "bg-rose-50/60 border-rose-200 hover:bg-rose-100/80 text-rose-900"
          }`}
        >
          <span className={`text-[9px] sm:text-[10px] font-bold self-start leading-none ${isToday ? "text-blue-600 font-extrabold" : "text-slate-600"}`}>
            {day}
          </span>
          <div className="text-center my-auto">
            <div className="text-xs sm:text-base font-black leading-none">{dbInfo.seats}</div>
          </div>
          {dbInfo.text ? (
            <span className="text-[7px] sm:text-[8px] italic truncate w-full text-center text-slate-500 leading-tight block">
              {dbInfo.text}
            </span>
          ) : (
            <span className="h-1" />
          )}
        </button>
      );
    }

    return (
      <div className="flex-1 space-y-2.5 sm:space-y-3">
        <h3 className="text-sm sm:text-base font-extrabold text-center text-slate-800 flex items-center justify-center gap-1.5 sm:gap-2">
          <CalendarIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-500" />
          <span>{monthNames[month]} {year}</span>
        </h3>
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1 text-center text-[9px] sm:text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">
          <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-1.5">{dayBoxes}</div>
      </div>
    );
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Manage Bookings</h1>
        </div>

        {/* Action Buttons: 2x2 grid on mobile, inline flex on desktop */}
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
          <button
            onClick={handleSyncDatabases}
            disabled={syncingDb}
            className="flex items-center justify-center gap-1.5 py-2 px-3 bg-white border border-slate-200 text-slate-700 hover:bg-sky-50 hover:text-sky-700 hover:border-sky-300 disabled:opacity-50 rounded-xl text-xs font-bold shadow-2xs transition-all cursor-pointer"
            title="Sync all historical bookings from old DB to new DB"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-sky-600 ${syncingDb ? "animate-spin" : ""}`} />
            <span className="truncate">{syncingDb ? "Syncing..." : "Sync DBs"}</span>
          </button>

          <button
            onClick={handleExportExcel}
            className="flex items-center justify-center gap-1.5 py-2 px-3 bg-white border border-slate-200 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 active:bg-emerald-600 active:text-white rounded-xl text-xs font-bold shadow-2xs transition-all cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span className="truncate">Export (.xlsx)</span>
          </button>

          <button
            onClick={() => setActiveView(activeView === "analytics" ? "main" : "analytics")}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
              activeView === "analytics"
                ? "bg-blue-600 text-white border-blue-600 shadow-2xs"
                : "bg-white border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300"
            }`}
          >
            <BarChart3 className={`w-3.5 h-3.5 ${activeView === "analytics" ? "text-white" : "text-blue-600"}`} />
            <span className="truncate">Analytics</span>
          </button>

          <button
            onClick={() => setActiveView(activeView === "logs" ? "main" : "logs")}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
              activeView === "logs"
                ? "bg-purple-600 text-white border-purple-600 shadow-2xs"
                : "bg-white border-slate-200 text-slate-700 hover:bg-purple-50 hover:text-purple-700 hover:border-purple-300"
            }`}
          >
            <History className={`w-3.5 h-3.5 ${activeView === "logs" ? "text-white" : "text-purple-600"}`} />
            <span className="truncate">Reschedule Logs</span>
          </button>

          <button
            onClick={() => {
              setModalFollowUpDays(followUpDays);
              setBulkModalOpen(true);
            }}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
              bulkModalOpen
                ? "bg-amber-500 text-white border-amber-500 shadow-2xs"
                : "bg-white border-slate-200 text-slate-700 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-300"
            }`}
          >
            <Settings className={`w-3.5 h-3.5 ${bulkModalOpen ? "text-white" : "text-amber-600"}`} />
            <span className="truncate">Availability</span>
          </button>
        </div>
      </div>

      {/* Metrics Counter Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-3 select-none">
        <div className="bg-amber-50/70 border border-amber-200 p-3 sm:p-3.5 rounded-2xl shadow-2xs">
          <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Total Bookings</div>
          <div className="text-lg sm:text-xl font-black text-amber-900 mt-0.5">{metrics.total}</div>
        </div>
        <div className="bg-blue-50/70 border border-blue-200 p-3 sm:p-3.5 rounded-2xl shadow-2xs">
          <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">This Month</div>
          <div className="text-lg sm:text-xl font-black text-blue-900 mt-0.5">{metrics.month}</div>
        </div>
        <div className="bg-slate-100 border border-slate-200 p-3 sm:p-3.5 rounded-2xl shadow-2xs">
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Last Month</div>
          <div className="text-lg sm:text-xl font-black text-slate-800 mt-0.5">{metrics.lastMonthCount}</div>
        </div>
        <div className="bg-indigo-50/70 border border-indigo-200 p-3 sm:p-3.5 rounded-2xl shadow-2xs">
          <div className="text-[10px] font-bold text-indigo-800 uppercase tracking-wider">Next Month</div>
          <div className="text-lg sm:text-xl font-black text-indigo-900 mt-0.5">{metrics.nextMonthCount}</div>
        </div>
        <div className="bg-sky-50/70 border border-sky-200 p-3 sm:p-3.5 rounded-2xl shadow-2xs">
          <div className="text-[10px] font-bold text-sky-800 uppercase tracking-wider">Today&apos;s Visit</div>
          <div className="text-lg sm:text-xl font-black text-sky-900 mt-0.5">{metrics.todaysVisit}</div>
        </div>

        {/* Follow up Box after Today's Visit */}
        <div className="bg-amber-100/70 border border-amber-300 p-3 sm:p-3.5 rounded-2xl shadow-2xs">
          <div className="text-[10px] font-black text-amber-900 uppercase tracking-wider flex items-center justify-between">
            <span>Follow up</span>
            <Clock className="w-3 h-3 text-amber-700" />
          </div>
          <div className="text-lg sm:text-xl font-black text-amber-950 mt-0.5">{metrics.todaysFollowup}</div>
        </div>

        <div className="bg-rose-50/70 border border-rose-200 p-3 sm:p-3.5 rounded-2xl shadow-2xs">
          <div className="text-[10px] font-bold text-rose-800 uppercase tracking-wider">Today&apos;s Bookings</div>
          <div className="text-lg sm:text-xl font-black text-rose-900 mt-0.5">{metrics.todayCount}</div>
        </div>
        <div className="bg-emerald-50/70 border border-emerald-200 p-3 sm:p-3.5 rounded-2xl shadow-2xs">
          <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Visited</div>
          <div className="text-lg sm:text-xl font-black text-emerald-900 mt-0.5">{metrics.visited}</div>
        </div>
        <div className="bg-rose-50/70 border border-rose-200 p-3 sm:p-3.5 rounded-2xl shadow-2xs">
          <div className="text-[10px] font-bold text-rose-800 uppercase tracking-wider">Non-Visited</div>
          <div className="text-lg sm:text-xl font-black text-rose-900 mt-0.5">{metrics.nonVisited}</div>
        </div>
        <div className="bg-cyan-50/70 border border-cyan-200 p-3 sm:p-3.5 rounded-2xl shadow-2xs">
          <div className="text-[10px] font-bold text-cyan-800 uppercase tracking-wider">Upcoming</div>
          <div className="text-lg sm:text-xl font-black text-cyan-900 mt-0.5">{metrics.upcoming}</div>
        </div>
        <div className="bg-blue-50/70 border border-blue-200 p-3 sm:p-3.5 rounded-2xl shadow-2xs col-span-2 sm:col-span-1">
          <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">Rescheduled</div>
          <div className="text-lg sm:text-xl font-black text-blue-900 mt-0.5">{metrics.rescheduled}</div>
        </div>
      </div>

      {/* 2-Month Dual Calendar */}
      {activeView === "main" && (
        <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="text-xs font-bold uppercase tracking-wider text-blue-600 flex items-center gap-2">
              <CalendarDays className="w-4 h-4" />
              <span>Booking Calendar</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  const d = new Date(calendarDate);
                  d.setMonth(d.getMonth() - 1);
                  setCalendarDate(d);
                }}
                className="p-1.5 hover:bg-slate-100 active:bg-slate-200 rounded-lg cursor-pointer transition-colors"
                title="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  const d = new Date(calendarDate);
                  d.setMonth(d.getMonth() + 1);
                  setCalendarDate(d);
                }}
                className="p-1.5 hover:bg-slate-100 active:bg-slate-200 rounded-lg cursor-pointer transition-colors"
                title="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 2 Months Grid: Single on mobile, 2 on desktop */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8 md:divide-x md:divide-slate-100">
            <div>{renderAdminCalendarMonth(calendarDate)}</div>
            <div className="hidden md:block md:pl-8">{renderAdminCalendarMonth(nextMonthDate)}</div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          VIEW 1: BOOKINGS TABLE
          ---------------------------------------------------- */}
      {activeView === "main" && (
        <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-xs space-y-4">
          {/* Table Top Bar */}
          <div className="border-b border-slate-100 pb-4 space-y-3">
            {/* Row 1: Header (Title, Dynamic Counter Pill, Reset Button) + All Filters in ONE line on Desktop */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              {/* Header: Title + Dynamic Counter Pill + Reset Button */}
              <div className="flex items-center gap-2 flex-wrap">
                <Ticket className="w-5 h-5 text-blue-600 shrink-0" />
                <h3 className="font-bold text-slate-900 text-sm sm:text-base tracking-tight whitespace-nowrap">
                  Booking Records
                </h3>

                {/* Dynamic Filter Pill Badge */}
                <div className="flex items-center gap-1.5 bg-sky-50 border border-sky-200/80 text-sky-800 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs font-bold shadow-2xs whitespace-nowrap">
                  <span>{adminFilterLabel}:</span>
                  <span className="bg-sky-600 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full leading-tight">
                    {filteredBookings.length}
                  </span>
                </div>

                {(bookingStartDate || bookingEndDate || agentFilter !== "all" || statusFilter !== "all" || searchTerm) && (
                  <button
                    onClick={() => {
                      setBookingStartDate("");
                      setBookingEndDate("");
                      setAgentFilter("all");
                      setStatusFilter("all");
                      setSearchTerm("");
                      setCurrentPage(1);
                    }}
                    className="px-2.5 py-1 sm:px-3 sm:py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap"
                    title="Reset all filters"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                )}
              </div>

              {/* Right side: All Filter Dropdowns in ONE line on Desktop, Clean 2x2 Grid on Mobile */}
              <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full lg:w-auto">
                <label
                  htmlFor="admin-filter-from-date"
                  onClick={(e) => {
                    const input = e.currentTarget.querySelector('input') as HTMLInputElement;
                    if (input && typeof input.showPicker === 'function') {
                      try { input.showPicker(); } catch (err) {}
                    }
                  }}
                  className="flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100/80 active:bg-slate-200 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs w-full sm:w-auto cursor-pointer select-none"
                >
                  <span className="text-[10px] font-bold text-slate-400 uppercase shrink-0">From:</span>
                  <input
                    id="admin-filter-from-date"
                    type="date"
                    value={bookingStartDate}
                    onChange={(e) => {
                      setBookingStartDate(e.target.value);
                      setCurrentPage(1);
                    }}
                    onClick={(e) => {
                      try { (e.target as any).showPicker?.(); } catch (err) {}
                    }}
                    className="bg-transparent outline-none text-slate-800 text-xs font-bold cursor-pointer w-full min-w-0"
                  />
                </label>

                <label
                  htmlFor="admin-filter-to-date"
                  onClick={(e) => {
                    const input = e.currentTarget.querySelector('input') as HTMLInputElement;
                    if (input && typeof input.showPicker === 'function') {
                      try { input.showPicker(); } catch (err) {}
                    }
                  }}
                  className="flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100/80 active:bg-slate-200 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs w-full sm:w-auto cursor-pointer select-none"
                >
                  <span className="text-[10px] font-bold text-slate-400 uppercase shrink-0">To:</span>
                  <input
                    id="admin-filter-to-date"
                    type="date"
                    value={bookingEndDate}
                    onChange={(e) => {
                      setBookingEndDate(e.target.value);
                      setCurrentPage(1);
                    }}
                    onClick={(e) => {
                      try { (e.target as any).showPicker?.(); } catch (err) {}
                    }}
                    className="bg-transparent outline-none text-slate-800 text-xs font-bold cursor-pointer w-full min-w-0"
                  />
                </label>

                <select
                  value={agentFilter}
                  onChange={(e) => {
                    setAgentFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-blue-600 outline-none cursor-pointer shadow-2xs w-full sm:w-auto"
                >
                  <option value="all">Agent: All</option>
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
                  className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-blue-600 outline-none cursor-pointer shadow-2xs w-full sm:w-auto"
                >
                  <option value="all">Status: All</option>
                  <option value="todays_visit">Status: Today&apos;s Visit</option>
                  <option value="todays_followup">Status: Follow up</option>
                  <option value="upcoming">Status: Upcoming</option>
                  <option value="visited">Status: Visited</option>
                </select>
              </div>
            </div>

            {/* Row 2: Full-width Responsive Search Bar directly below filters */}
            <div className="relative w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search by IP / IW name, phone, or agent..."
                className="w-full pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:bg-white focus:border-blue-400 transition-all shadow-2xs"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
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

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-100">
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
                  <th className="p-4 text-purple-700 bg-purple-50/60 font-semibold">Rescheduled Date</th>
                  <th className="p-4">Follow up Date</th>
                  <th className="p-4">Booked On</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {paginatedBookings.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-12 text-slate-400">
                      No bookings match search or filters.
                    </td>
                  </tr>
                ) : (
                  paginatedBookings.map((b, idx) => {
                    const rowKey = `${b.dateKey}___${b.timestamp}___${b.agentEmail}`;
                    const isChecked = selectedBookingKeys.has(rowKey);
                    const followUpInfo = getFollowUpInfo(b.dateKey, followUpDays);

                    return (
                      <tr
                        key={rowKey}
                        className={`transition-colors ${
                          b.rescheduled
                            ? "bg-purple-50/90 hover:bg-purple-100/90 border-l-4 border-l-purple-600 text-purple-950 font-medium"
                            : "hover:bg-slate-50/70"
                        }`}
                      >
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
                            <span>{maskIpInfo ? maskIpName(b.ipName) : b.ipName}</span>
                            {!maskIpInfo && (
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
                            )}
                          </div>
                        </td>
                        <td className="p-4 font-mono text-slate-600">
                          <div className="flex items-center gap-1.5">
                            <span>{maskIpInfo ? maskPhone(b.phone) : b.phone}</span>
                            {b.phone && !maskIpInfo && (
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
                        <td className="p-4 text-slate-800 font-medium">
                          {b.rescheduled && b.originalScheduledDate && b.originalScheduledDate !== b.dateKey ? (
                            <div className="flex flex-col">
                              <span className="text-slate-800 font-bold">{b.originalScheduledDate}</span>
                              <span className="text-[10px] text-purple-600 font-semibold">Original</span>
                            </div>
                          ) : (
                            <span>{b.dateKey}</span>
                          )}
                        </td>
                        <td className="p-4">
                          {b.rescheduled ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300 shadow-2xs">
                              <Clock className="w-3 h-3 text-purple-600" />
                              {b.rescheduledDate || b.dateKey}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs font-normal">-</span>
                          )}
                        </td>
                        <td className="p-4">
                          <span className="font-semibold text-amber-800 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-lg text-[11px] whitespace-nowrap inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-600" />
                            {followUpInfo.formatted}
                          </span>
                        </td>
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
                            const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
                            if (b.dateKey === todayKey) {
                              return (
                                <span className="bg-sky-50 text-sky-800 border border-sky-200 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-sky-600" /> Today&apos;s Visit
                                </span>
                              );
                            }
                            if (followUpInfo.key === todayKey) {
                              return (
                                <span className="bg-amber-100 text-amber-900 border border-amber-300 font-black px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1 whitespace-nowrap animate-pulse">
                                  <Clock className="w-3 h-3 text-amber-700" /> Today&apos;s Follow up
                                </span>
                              );
                            }
                            const schedDate = new Date(b.dateKey);
                            schedDate.setHours(0, 0, 0, 0);
                            if (schedDate < istMidnight) {
                              return (
                                <span className="bg-amber-50 text-amber-800 border border-amber-200 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1 whitespace-nowrap">
                                  <Clock className="w-3 h-3 text-amber-600" /> Follow up on {followUpInfo.formatted}
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
                              onClick={() => {
                                setEditBookingItem(b);
                                setEditIpName(b.ipName || "");
                                setEditPhone(b.phone || "");
                              }}
                              className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-blue-600 rounded-lg transition-colors cursor-pointer"
                              title="Edit booking details"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
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

          {/* Mobile List View (Clean rows divided by dotted lines) */}
          <div className="block md:hidden divide-y divide-dashed divide-slate-200">
            {paginatedBookings.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-xs">
                No bookings match search or filters.
              </div>
            ) : (
              paginatedBookings.map((b, idx) => {
                const rowKey = `${b.dateKey}___${b.timestamp}___${b.agentEmail}`;
                const isChecked = selectedBookingKeys.has(rowKey);
                const istMidnight = getISTMidnight();
                const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
                const schedDate = new Date(b.dateKey);
                schedDate.setHours(0, 0, 0, 0);

                const followUpInfo = getFollowUpInfo(b.dateKey, followUpDays);
                const isDelayed = !b.visited && schedDate < istMidnight;

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
                  <div
                    key={`mobile-admin-${rowKey}`}
                    className="py-4 first:pt-1 last:pb-1 space-y-2.5"
                  >
                    {/* Header: Checkbox + IP Name + Status Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const nextSet = new Set(selectedBookingKeys);
                            if (e.target.checked) nextSet.add(rowKey);
                            else nextSet.delete(rowKey);
                            setSelectedBookingKeys(nextSet);
                          }}
                          className="mt-1 cursor-pointer"
                        />
                        <div>
                          <div className="flex items-center gap-1.5 font-bold text-slate-900 text-sm">
                            <span>{maskIpInfo ? maskIpName(b.ipName) : b.ipName}</span>
                            {!maskIpInfo && (
                              <button
                                onClick={() => handleCopy(b.ipName, `ip-m-${idx}`)}
                                className="text-slate-400 hover:text-blue-600 p-0.5 rounded cursor-pointer"
                                title="Copy Name"
                              >
                                {copiedId === `ip-m-${idx}` ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                          <span className="text-[11px] font-semibold text-blue-600 block mt-0.5">
                            Agent: {b.agentName}
                          </span>
                        </div>
                      </div>

                      {/* Status Badge */}
                      <div className="shrink-0">
                        {b.visited ? (
                          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Visited
                          </span>
                        ) : b.dateKey === todayKey ? (
                          <span className="bg-sky-50 text-sky-800 border border-sky-200 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-sky-600" /> Today&apos;s Visit
                          </span>
                        ) : followUpInfo.key === todayKey ? (
                          <span className="bg-amber-100 text-amber-900 border border-amber-300 font-black px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1 whitespace-nowrap animate-pulse">
                            <Clock className="w-3 h-3 text-amber-700" /> Today&apos;s Follow up
                          </span>
                        ) : isDelayed ? (
                          <span className="bg-amber-50 text-amber-800 border border-amber-200 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-600" /> Follow up ({followUpInfo.formatted})
                          </span>
                        ) : (
                          <span className="bg-blue-50 text-blue-700 border border-blue-200 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Upcoming
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Details in clean 3 columns without nested box */}
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                          Scheduled Date
                        </span>
                        <span className={`font-bold ${b.dateKey === todayKey ? "text-sky-700 font-extrabold" : "text-slate-800"}`}>
                          {schedDateStr}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                          Follow up Date
                        </span>
                        <span className="font-bold text-amber-800 inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 text-amber-600" />
                          {followUpInfo.formatted}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                          Phone Number
                        </span>
                        <div className="flex items-center gap-1 font-mono text-slate-700 font-semibold">
                          <a href={maskIpInfo ? undefined : `tel:${b.phone}`} className={maskIpInfo ? "" : "hover:underline text-blue-600"}>
                            {maskIpInfo ? maskPhone(b.phone) : b.phone}
                          </a>
                          {!maskIpInfo && (
                            <button
                              onClick={() => handleCopy(b.phone, `phone-main-m-${idx}`)}
                              className="text-slate-400 hover:text-blue-600 p-0.5 rounded cursor-pointer"
                              title="Copy Phone"
                            >
                              {copiedId === `phone-main-m-${idx}` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                          Booked On
                        </span>
                        <span className="text-slate-500 font-medium">
                          {bookedOnDateStr}
                        </span>
                      </div>
                    </div>

                    {/* Actions Bar */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => handleToggleVisited(b)}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer ${
                          b.visited
                            ? "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                            : "bg-emerald-600 hover:bg-emerald-700 text-white"
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
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
                        className={`py-2 px-3.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                          b.visited
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                            : "bg-blue-600 hover:bg-blue-700 text-white shadow-2xs"
                        }`}
                      >
                        {b.visited && <Lock className="w-3 h-3" />}
                        <span>Reschedule</span>
                      </button>

                      <button
                        onClick={() => {
                          setEditBookingItem(b);
                          setEditIpName(b.ipName || "");
                          setEditPhone(b.phone || "");
                        }}
                        className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors cursor-pointer"
                        title="Edit Booking"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleCancelSingleBooking(b)}
                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                        title="Delete Booking"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
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
                className="p-2 hover:bg-slate-100 rounded-full text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
                title="Back to Bookings"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  Analytics
                </h2>
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
              <span>Reschedule Logs</span>
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
                <tr className="bg-purple-50/70 text-purple-900 border-b border-purple-200 uppercase tracking-wider font-semibold">
                  <th className="p-4">Agent Name</th>
                  <th className="p-4">IP / IW Name</th>
                  <th className="p-4 text-center">Reschedule Count</th>
                  <th className="p-4">Scheduled Date</th>
                  <th className="p-4 text-purple-700 font-bold">Rescheduled Date</th>
                  <th className="p-4">Action By</th>
                  <th className="p-4 text-right">Time of Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purple-100/60 text-slate-700 font-medium">
                {activeRescheduleLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-400">
                      No reschedule events recorded.
                    </td>
                  </tr>
                ) : (
                  activeRescheduleLogs.map((log) => {
                    const agentClean = log.agentName || (userProfiles[log.seatOwner?.toLowerCase()] || log.seatOwner);
                    const actionByClean =
                      log.actionByName ||
                      userProfiles[log.actionBy?.toLowerCase()] ||
                      (log.actionBy && log.actionBy.includes("@")
                        ? log.actionBy.split("@")[0].replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
                        : log.actionBy || "-");

                    const ownerKey = (log.seatOwner || "").toLowerCase().trim();
                    const ipKey = (log.ipName || "").toLowerCase().trim();
                    const key = `${ownerKey}___${ipKey}`;
                    const count = rescheduleCountMap.get(key) || 1;

                    return (
                      <tr key={log.id} className="hover:bg-purple-50/50 transition-colors">
                        <td className="p-4 font-bold text-blue-600">{agentClean}</td>
                        <td className="p-4 font-bold text-slate-900">{maskIpInfo ? maskIpName(log.ipName) : log.ipName}</td>
                        <td className="p-4 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            count > 1
                              ? "bg-purple-100 text-purple-900 border border-purple-300 shadow-2xs"
                              : "bg-slate-100 text-slate-700 border border-slate-200"
                          }`}>
                            <RotateCcw className="w-3 h-3 text-purple-600" />
                            {count} {count === 1 ? "Time" : "Times"}
                          </span>
                        </td>
                        <td className="p-4 font-bold text-slate-800">{log.originalDate}</td>
                        <td className="p-4">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">
                            <Clock className="w-3 h-3 text-purple-600" />
                            {log.newDate}
                          </span>
                        </td>
                        <td className="p-4 font-semibold text-slate-800">{actionByClean}</td>
                        <td className="p-4 text-right text-slate-400">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })
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
                IP Name:{" "}
                <strong className="text-slate-900">
                  {maskIpInfo && rescheduleItem.ipName
                    ? maskIpName(rescheduleItem.ipName)
                    : rescheduleItem.ipName}
                </strong>
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

      {/* --- EDIT BOOKING MODAL --- */}
      {editBookingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-slate-900 font-bold">
                <Edit3 className="w-5 h-5 text-blue-600" />
                <h3 className="text-base">Edit Booking Details</h3>
              </div>
              <button
                onClick={() => setEditBookingItem(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1">
              <div>
                Agent Name: <strong className="text-blue-600">{editBookingItem.agentName}</strong>
              </div>
              <div>
                Scheduled Date: <strong className="text-slate-800">{editBookingItem.dateKey}</strong>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  IP / IW Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={editIpName}
                  onChange={(e) => setEditIpName(e.target.value)}
                  placeholder="Enter IP / IW Name"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Phone Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="Enter Phone Number"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditBookingItem(null)}
                className="px-4 py-2 border border-slate-200 text-xs font-semibold rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEditBooking}
                disabled={editSaving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {editSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save Changes</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
