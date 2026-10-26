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
  updateDoc,
  increment,
  getDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  writeBatch,
  orderBy,
  limit,
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
  Edit3,
} from "lucide-react";

interface FlattenedBooking extends BookingRecord {
  dateKey: string;
}

export default function AgentBookingPage() {
  const { user, userProfile, isLoggedIn, openLoginModal, isMasterAdmin } = useAuth();
  const { toast, showConfirm } = usePopup();
  const [liveBookings, setLiveBookings] = useState<Record<string, DayAvailability>>({});
  const [rescheduleLogs, setRescheduleLogs] = useState<RescheduleLog[]>([]);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [maskIpInfo, setMaskIpInfo] = useState(false);

  const isAdmin =
    userProfile?.role?.toLowerCase().includes("admin") ||
    userProfile?.role?.toLowerCase().includes("master") ||
    false;

  // Views & Filters
  const [tableView, setTableView] = useState<"all" | "my">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "todays_visit" | "todays_followup" | "upcoming" | "followup" | "visited">("all");
  const [scheduleDateFilter, setScheduleDateFilter] = useState<string>("");
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

  // Edit Modal State
  const [editBookingItem, setEditBookingItem] = useState<FlattenedBooking | null>(null);
  const [editIpName, setEditIpName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editSelectedAgentEmail, setEditSelectedAgentEmail] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [userProfilesMap, setUserProfilesMap] = useState<Record<string, string>>({});

  // Copy indicator
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [rescheduledByMeCount, setRescheduledByMeCount] = useState(0);
  const [followUpDays, setFollowUpDays] = useState<number>(8);

  // 1. Realtime Bookings & Reschedule Logs Listener for instant updates
  useEffect(() => {
    let isMounted = true;
    let mainData: Record<string, DayAvailability> = {};
    let secData: Record<string, DayAvailability> = {};

    let mainLogs: RescheduleLog[] = [];
    let secLogs: RescheduleLog[] = [];

    const syncState = () => {
      if (!isMounted) return;
      setLiveBookings(mergeBookingData(mainData, secData));
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

    // Main DB listener (past bookings)
    const unsubMain = onSnapshot(
      collection(db, "bookings"),
      (snapshot) => {
        const data: Record<string, DayAvailability> = {};
        snapshot.forEach((d) => {
          data[d.id] = d.data() as DayAvailability;
        });
        mainData = data;
        syncState();
      },
      (err) => console.warn("Main bookings sync error:", err)
    );

    // Secondary DB listener (new bookings)
    const unsubSec = onSnapshot(
      collection(bookingDb, "bookings"),
      (snapshot) => {
        const data: Record<string, DayAvailability> = {};
        snapshot.forEach((d) => {
          data[d.id] = d.data() as DayAvailability;
        });
        secData = data;
        syncState();
      },
      (err) => console.warn("Secondary bookings sync error:", err)
    );

    // Reschedule Logs Main DB (Limited to 50 newest)
    const unsubLogsMain = onSnapshot(
      query(collection(db, "rescheduleLogs"), orderBy("timestamp", "desc"), limit(50)),
      (snap) => {
        const logs: RescheduleLog[] = [];
        snap.forEach((d) => logs.push({ id: d.id, ...(d.data() as Omit<RescheduleLog, "id">) }));
        mainLogs = logs;
        syncLogs();
      },
      (err) => console.warn("Main logs snapshot error:", err)
    );

    // Reschedule Logs Secondary DB (Limited to 50 newest)
    const unsubLogsSec = onSnapshot(
      query(collection(bookingDb, "rescheduleLogs"), orderBy("timestamp", "desc"), limit(50)),
      (snap) => {
        const logs: RescheduleLog[] = [];
        snap.forEach((d) => logs.push({ id: d.id, ...(d.data() as Omit<RescheduleLog, "id">) }));
        secLogs = logs;
        syncLogs();
      },
      (err) => console.warn("Secondary logs snapshot error:", err)
    );

    // System status (cached 10 mins)
    const STATUS_TTL = 10 * 60 * 1000;
    const cachedStatus = getCachedData<any>("system_status", STATUS_TTL);
    if (cachedStatus) {
      setMaskIpInfo(!!cachedStatus.maskIpInfo);
      if (cachedStatus.followUpDays && typeof cachedStatus.followUpDays === "number") {
        setFollowUpDays(cachedStatus.followUpDays);
      }
    } else {
      getDoc(doc(db, "system", "status")).then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setMaskIpInfo(!!data.maskIpInfo);
          if (data.followUpDays && typeof data.followUpDays === "number") {
            setFollowUpDays(data.followUpDays);
          }
          setCachedData("system_status", data);
        }
      }).catch(() => {});
    }

    // User profiles for Master Admin agent reassignment (cached 10 mins)
    const USER_TTL = 10 * 60 * 1000;
    const cachedUsers = getCachedData<Record<string, string>>("booking_user_profiles_map", USER_TTL);
    if (cachedUsers) {
      setUserProfilesMap(cachedUsers);
    } else {
      getDocs(collection(db, "users")).then((snap) => {
        if (!isMounted) return;
        const map: Record<string, string> = {};
        snap.forEach((d) => {
          const data = d.data();
          const email = (data.email || d.id || "").toLowerCase().trim();
          map[email] = data.displayName || data.name || email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
        });
        setUserProfilesMap(map);
        setCachedData("booking_user_profiles_map", map);
      }).catch(() => {});
    }

    return () => {
      isMounted = false;
      unsubMain();
      unsubSec();
      unsubLogsMain();
      unsubLogsSec();
    };
  }, []);

  // 2. Fetch Reschedule Logs for user (from both main and secondary)
  useEffect(() => {
    if (!user?.email) return;
    const fetchLogs = async () => {
      try {
        const qMain = query(collection(db, "rescheduleLogs"), where("actionBy", "==", user.email));
        const qSec = query(collection(bookingDb, "rescheduleLogs"), where("actionBy", "==", user.email));
        
        const [resMain, resSec] = await Promise.allSettled([
          getDocs(qMain),
          getDocs(qSec),
        ]);

        let count = 0;
        if (resMain.status === "fulfilled") count += resMain.value.size;
        if (resSec.status === "fulfilled") count += resSec.value.size;
        setRescheduledByMeCount(count);
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
    const myEmail = user?.email?.toLowerCase().trim() || "";

    const todayObj = new Date();
    const todayKey = todayObj.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const currentYear = todayObj.getFullYear();
    const currentMonth = todayObj.getMonth();
    const currentDay = todayObj.getDate();

    const latestRescheduleMap = new Map<string, RescheduleLog>();
    const initialRescheduleMap = new Map<string, RescheduleLog>();

    rescheduleLogs.forEach((l) => {
      const owner = (l.seatOwner || "").toLowerCase().trim();
      const ip = (l.ipName || "").toLowerCase().trim();
      const key = `${owner}___${ip}`;

      if (!latestRescheduleMap.has(key)) {
        latestRescheduleMap.set(key, l);
      }
      initialRescheduleMap.set(key, l);
    });

    let totalMy = 0;
    let todayMy = 0;
    let monthMy = 0;
    let visitedMy = 0;

    let todaysVisitAll = 0;
    let todayAll = 0;
    let todaysFollowupAll = 0;
    let visitedAll = 0;

    Object.keys(liveBookings).forEach((dateKey) => {
      const dayData = liveBookings[dateKey];
      if (dayData.bookedRecords && Array.isArray(dayData.bookedRecords)) {
        const [y, m] = dateKey.split("-").map(Number);

        dayData.bookedRecords.forEach((record) => {
          const emailLower = (record.agentEmail || "").toLowerCase().trim();
          const ipLower = (record.ipName || "").toLowerCase().trim();
          const key = `${emailLower}___${ipLower}`;

          const latestLog = latestRescheduleMap.get(key);
          const initialLog = initialRescheduleMap.get(key);
          const isMine = emailLower === myEmail;
          const cleanName = record.agentEmail
            ? record.agentEmail.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
            : "Agent";

          const isRescheduled = !!(record.rescheduled || record.isRescheduled || latestLog);
          const originalScheduledDate =
            record.originalScheduledDate || initialLog?.originalDate || latestLog?.originalDate || dateKey;
          const rescheduledDate = isRescheduled ? (record.rescheduledDate || dateKey) : undefined;

          const flatItem: FlattenedBooking = {
            ...record,
            dateKey,
            agentName: cleanName,
            rescheduled: isRescheduled,
            originalScheduledDate,
            rescheduledDate,
          };

          all.push(flatItem);

          const bookedTime = new Date(record.timestamp);
          const isBookedToday =
            bookedTime.getFullYear() === currentYear &&
            bookedTime.getMonth() === currentMonth &&
            bookedTime.getDate() === currentDay;

          const isBookedThisMonth =
            bookedTime.getFullYear() === currentYear &&
            bookedTime.getMonth() === currentMonth;

          const isTodaySchedule = dateKey === todayKey;
          const followUpInfo = getFollowUpInfo(dateKey, followUpDays);
          const isFollowUpToday = followUpInfo.key === todayKey;

          // Agent Personal Metrics (Mine)
          if (isMine) {
            my.push(flatItem);
            totalMy++;
            if (isBookedToday) todayMy++;
            if (isBookedThisMonth || (y === currentYear && m - 1 === currentMonth)) monthMy++;
            if (record.visited) visitedMy++;
          }

          // Overall Team Metrics (All)
          if (isTodaySchedule && !record.visited) todaysVisitAll++;
          if (isBookedToday) todayAll++;
          if (!record.visited) todaysFollowupAll++;
          if (record.visited) visitedAll++;
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
        todayMy,
        monthMy,
        visitedMy,
        todaysVisitAll,
        todayAll,
        todaysFollowupAll,
        visitedAll,
      },
    };
  }, [liveBookings, user, followUpDays]);

  // 4. Filtered Table Data
  const displayedBookings = useMemo(() => {
    let list = tableView === "all" ? allBookings : myBookings;
    const istMidnight = getISTMidnight();
    const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

    // 1. Single Scheduled Date Filter (Only applied if status is not todays_followup)
    if (scheduleDateFilter && statusFilter !== "todays_followup" && statusFilter !== "followup") {
      list = list.filter((b) => b.dateKey === scheduleDateFilter);
    }

    // 2. Status Filter (Works both standalone AND combined with scheduleDateFilter)
    if (statusFilter !== "all") {
      list = list.filter((b) => {
        if (statusFilter === "todays_visit") return b.dateKey === todayKey && !b.visited;
        if (statusFilter === "visited") return !!b.visited;
        if (statusFilter === "todays_followup" || statusFilter === "followup") {
          if (scheduleDateFilter) {
            return getFollowUpInfo(b.dateKey, followUpDays).key === scheduleDateFilter && !b.visited;
          }
          return !b.visited;
        }
        if (b.visited) return false;

        const schedDate = new Date(b.dateKey);
        schedDate.setHours(0, 0, 0, 0);

        if (statusFilter === "upcoming") return schedDate >= istMidnight;
        return true;
      });
    }

    // 3. Search Term Filter
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      list = list.filter(
        (b) =>
          b.ipName?.toLowerCase().includes(q) ||
          b.phone?.toLowerCase().includes(q) ||
          b.agentName?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [tableView, allBookings, myBookings, searchTerm, statusFilter, scheduleDateFilter, followUpDays]);

  // All Agent Options for Master Admin Reassignment
  const allAgentOptions = useMemo(() => {
    const map = new Map<string, string>();
    Object.entries(userProfilesMap).forEach(([email, name]) => {
      if (email) map.set(email.toLowerCase().trim(), name);
    });
    allBookings.forEach((b) => {
      if (b.agentEmail) {
        const email = b.agentEmail.toLowerCase().trim();
        if (!map.has(email)) {
          map.set(email, b.agentName || email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()));
        }
      }
    });
    if (editBookingItem?.agentEmail) {
      const email = editBookingItem.agentEmail.toLowerCase().trim();
      if (!map.has(email)) {
        map.set(email, editBookingItem.agentName || email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()));
      }
    }
    return Array.from(map.entries())
      .map(([email, name]) => ({ email, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [userProfilesMap, allBookings, editBookingItem]);

  const agentFilterLabel = useMemo(() => {
    let statusText = "";
    switch (statusFilter) {
      case "todays_visit":
        statusText = "Today's Visit";
        break;
      case "todays_followup":
      case "followup":
        statusText = "Follow up";
        break;
      case "upcoming":
        statusText = "Upcoming";
        break;
      case "visited":
        statusText = "Visited";
        break;
      default:
        statusText = "All";
        break;
    }

    if (scheduleDateFilter) {
      if (statusFilter === "all") {
        return `Date: ${scheduleDateFilter}`;
      }
      return `${statusText} (${scheduleDateFilter})`;
    }

    return statusText === "All" ? "All Bookings" : statusText;
  }, [statusFilter, scheduleDateFilter]);

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

    // Zero-read memory duplicate check across all loaded bookings
    const cleanPhone = ipPhone.trim();
    const cleanName = ipName.trim().toLowerCase();

    const existingMatch = allBookings.find((b) => {
      const bPhone = (b.phone || "").trim();
      const bName = (b.ipName || "").trim().toLowerCase();
      return (bPhone && bPhone === cleanPhone) || (bName && bName === cleanName);
    });

    if (existingMatch) {
      const existingDate = existingMatch.dateKey || "another date";
      const confirmed = await showConfirm({
        title: "⚠️ Duplicate Booking Warning",
        message: `A booking for "${existingMatch.ipName}" (${existingMatch.phone}) already exists in the system (Scheduled for ${existingDate}).\n\nDo you still want to book again?`,
        confirmText: "Yes, Book Again",
        cancelText: "Cancel",
        type: "warning",
      });
      if (!confirmed) return;
    }

    setBookingLoading(true);
    const docRef = doc(bookingDb, "bookings", bookModalDate);

    try {
      const existingDoc = liveBookings[bookModalDate];
      if (existingDoc && (existingDoc.seats || 0) <= 0) {
        throw new Error("Sorry, no available seats left on this date.");
      }

      const newRecord = {
        agentEmail: user.email?.toLowerCase(),
        ipName: ipName.trim(),
        phone: ipPhone.trim(),
        timestamp: Date.now(),
      };

      const initialSeats = existingDoc?.seats !== undefined ? Math.max(0, existingDoc.seats - 1) : 19;

      const writeToDb = async (firestoreInstance: any) => {
        const targetRef = doc(firestoreInstance, "bookings", bookModalDate);
        try {
          await updateDoc(targetRef, {
            seats: increment(-1),
            bookedRecords: arrayUnion(newRecord),
          });
        } catch {
          await setDoc(
            targetRef,
            {
              seats: initialSeats,
              bookedRecords: [newRecord],
            },
            { merge: true }
          );
        }
      };

      await Promise.allSettled([writeToDb(bookingDb), writeToDb(db)]);

      logUserActivity(user.email, {
        desc: `Booked verification appointment for ${ipName.trim()} on ${bookModalDate}`,
        type: "booking",
      });

      // Send customized user confirmation notification
      if (user?.email) {
        const formattedDate = new Date(bookModalDate).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });

        try {
          await createNotification({
            title: "🎉 Verification Booking Confirmed",
            message: `Your verification appointment on **${formattedDate}** has been successfully booked for **${ipName.trim()}** (Phone: **${ipPhone.trim()}**).`,
            type: "booking",
            targetEmail: user.email.toLowerCase().trim(),
            link: "/booking",
            metadata: {
              ipName: ipName.trim(),
              phone: ipPhone.trim(),
              dateKey: bookModalDate,
            },
          });

          // Notify Admins
          await notifyAdmins({
            title: "📅 New Booking Received",
            message: `**${userProfile?.displayName || user?.email || "Agent"}** booked an appointment for **${ipName.trim()}** (Phone: **${ipPhone.trim()}**) on **${formattedDate}**.`,
            type: "booking",
            link: "/admin/bookings",
            metadata: {
              ipName: ipName.trim(),
              phone: ipPhone.trim(),
              dateKey: bookModalDate,
            },
          });
        } catch (notifErr) {
          console.error("Booking notification error:", notifErr);
        }
      }

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

  // --- EDIT BOOKING HANDLER ---
  const handleSaveEditBooking = async () => {
    if (!editBookingItem) return;
    const isOwnerOrAdmin =
      (editBookingItem.agentEmail || "").toLowerCase().trim() === (user?.email || "").toLowerCase().trim() || isAdmin;

    if (!isOwnerOrAdmin) {
      toast.error("You can only edit your own booking details.");
      return;
    }

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

    const currentAgentEmail = (editBookingItem.agentEmail || "").toLowerCase().trim();
    const targetAgentEmail = (editSelectedAgentEmail || "").toLowerCase().trim();
    const isAgentChanged = isMasterAdmin && !!targetAgentEmail && targetAgentEmail !== currentAgentEmail;

    const newAgentEmail = isAgentChanged ? targetAgentEmail : (editBookingItem.agentEmail || "");
    const matchedAgent = allAgentOptions.find((a) => a.email.toLowerCase() === newAgentEmail.toLowerCase());
    const newAgentName = isAgentChanged
      ? (matchedAgent ? matchedAgent.name : newAgentEmail.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()))
      : (editBookingItem.agentName || editBookingItem.agentEmail);

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
                    (r.agentEmail || "").toLowerCase().trim() === currentAgentEmail) ||
                  ((r.agentEmail || "").toLowerCase().trim() === currentAgentEmail &&
                    (r.ipName || "").toLowerCase().trim() === (editBookingItem.ipName || "").toLowerCase().trim() &&
                    r.phone === editBookingItem.phone)
                ) {
                  updated = true;
                  return {
                    ...r,
                    ipName: trimmedName,
                    phone: trimmedPhone,
                    agentEmail: newAgentEmail,
                    agentName: newAgentName,
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
            const updates: any = {
              ipName: trimmedName,
              phone: trimmedPhone,
            };
            if (isAgentChanged) {
              updates.seatOwner = newAgentEmail;
              updates.agentName = newAgentName;
            }
            batch.update(logDoc.ref, updates);
            hasUpdates = true;
          });

          // Fallback if timestamp query didn't match
          if (logsSnap.empty && editBookingItem.ipName && currentAgentEmail) {
            const fallbackQ = query(
              collection(firestoreInstance, "rescheduleLogs"),
              where("seatOwner", "==", currentAgentEmail),
              where("ipName", "==", editBookingItem.ipName.trim())
            );
            const fallbackSnap = await getDocs(fallbackQ);
            fallbackSnap.forEach((logDoc) => {
              const updates: any = {
                ipName: trimmedName,
                phone: trimmedPhone,
              };
              if (isAgentChanged) {
                updates.seatOwner = newAgentEmail;
                updates.agentName = newAgentName;
              }
              batch.update(logDoc.ref, updates);
              hasUpdates = true;
            });
          }

          if (hasUpdates) {
            await batch.commit();
          }
        } catch (e) {
          console.warn("Could not sync reschedule logs:", e);
        }
      };

      await Promise.allSettled([updateLogsInDb(db), updateLogsInDb(bookingDb)]);

      const activityDesc = isAgentChanged
        ? `Reassigned booking for ${trimmedName} (${editBookingItem.dateKey}) from ${editBookingItem.agentName || editBookingItem.agentEmail} to ${newAgentName}`
        : `Updated booking details for ${trimmedName} (${editBookingItem.dateKey})`;

      logUserActivity(user?.email, {
        desc: activityDesc,
        type: "edit",
      });

      toast.success(
        isAgentChanged
          ? `Booking reassigned to ${newAgentName} successfully!`
          : "Booking details updated successfully!"
      );
      setEditBookingItem(null);
      setEditSelectedAgentEmail("");
    } catch (error: any) {
      console.error("Edit booking error:", error);
      toast.error(error.message || "Failed to update booking details.");
    } finally {
      setEditSaving(false);
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
    const oldSecRef = doc(bookingDb, "bookings", rescheduleData.oldDateKey);
    const oldPriRef = doc(db, "bookings", rescheduleData.oldDateKey);
    const newDocRef = doc(bookingDb, "bookings", rsSelectedDate);

    try {
      const target = rescheduleData.record;

      // 1. Remove from all old date candidate documents in BOTH databases to prevent duplicates
      const candidateOldDates = Array.from(
        new Set(
          [
            rescheduleData.oldDateKey,
            target.rescheduledDate,
            target.originalScheduledDate,
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
                  (r.timestamp === target.timestamp &&
                    (r.agentEmail || "").toLowerCase().trim() === (target.agentEmail || "").toLowerCase().trim()) ||
                  ((r.agentEmail || "").toLowerCase().trim() === (target.agentEmail || "").toLowerCase().trim() &&
                    (r.ipName || "").toLowerCase().trim() === (target.ipName || "").toLowerCase().trim() &&
                    r.phone === target.phone)
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

      const origDate = target.originalScheduledDate || rescheduleData.oldDateKey;

      const cleanNewRecord: BookingRecord = JSON.parse(JSON.stringify({
        agentEmail: target.agentEmail || "",
        ipName: target.ipName || "",
        phone: target.phone || "",
        timestamp: target.timestamp || Date.now(),
        visited: !!target.visited,
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

      // 3. Add to rescheduleLogs in BOTH databases
      const logRefId = `${Date.now()}_${target.timestamp}`;
      const logPayload = JSON.parse(JSON.stringify({
        ipName: target.ipName || "",
        seatOwner: target.agentEmail || "",
        agentName: target.agentName || target.agentEmail || "",
        phone: target.phone || "",
        originalDate: rescheduleData.oldDateKey,
        newDate: rsSelectedDate,
        actionBy: user?.email?.toLowerCase() || "agent",
        actionByName: userProfile?.displayName || user?.displayName || user?.email?.split("@")[0] || user?.email || "Agent",
        timestamp: Date.now(),
      }));

      await Promise.allSettled([
        setDoc(doc(bookingDb, "rescheduleLogs", logRefId), logPayload, { merge: true }),
        setDoc(doc(db, "rescheduleLogs", logRefId), logPayload, { merge: true }),
      ]);

      logUserActivity(user?.email, {
        desc: `Rescheduled booking for IP: ${rescheduleData.record.ipName || "Beneficiary"} from ${rescheduleData.oldDateKey} to ${rsSelectedDate}`,
        type: "booking",
      });

      // Send customized reschedule notification
      if (user?.email) {
        const oldFmt = new Date(rescheduleData.oldDateKey).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const newFmt = new Date(rsSelectedDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const targetAgent = (rescheduleData.record.agentEmail || user.email).toLowerCase().trim();

        try {
          await createNotification({
            title: "🔄 Verification Booking Rescheduled",
            message: `Your booking for **${rescheduleData.record.ipName}** has been moved from **${oldFmt}** to **${newFmt}**.`,
            type: "booking",
            targetEmail: targetAgent,
            link: "/booking",
            metadata: {
              ipName: rescheduleData.record.ipName,
              oldDate: rescheduleData.oldDateKey,
              newDate: rsSelectedDate,
            },
          });

          // Notify Admins
          await notifyAdmins({
            title: "🔄 Booking Rescheduled",
            message: `**${userProfile?.displayName || user?.email || "Agent"}** rescheduled booking for **${rescheduleData.record.ipName}** from **${oldFmt}** to **${newFmt}**.`,
            type: "booking",
            link: "/admin/bookings",
          });
        } catch (notifErr) {
          console.error("Reschedule notification error:", notifErr);
        }
      }

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

  // --- 7. CANCEL / DELETE BOOKING ---
  const handleExecuteCancel = async () => {
    if (!cancelData || !user) return;

    const myEmail = (user?.email || "").toLowerCase().trim();
    const recordOwner = (cancelData.record.agentEmail || "").toLowerCase().trim();

    // Security check: Agent can only delete their own booking
    if (!isAdmin && recordOwner !== myEmail) {
      toast.error("You are only allowed to delete your own bookings.");
      setCancelData(null);
      return;
    }

    setCancelLoading(true);
    try {
      const removedCount = await deleteBookingRecordCompletely(
        {
          timestamp: cancelData.record.timestamp,
          agentEmail: cancelData.record.agentEmail || recordOwner,
          ipName: cancelData.record.ipName,
          phone: cancelData.record.phone,
          dateKey: cancelData.dateKey,
          rescheduledDate: cancelData.record.rescheduledDate,
          originalScheduledDate: cancelData.record.originalScheduledDate,
        },
        db,
        bookingDb
      );

      if (removedCount === 0) {
        throw new Error("This booking record was not found or was already removed.");
      }

      // Send notifications ONLY after deletion succeeds
      try {
        await notifyAdmins({
          title: "🗑️ Booking Cancelled",
          message: `**${userProfile?.displayName || user?.email || "Agent"}** cancelled the appointment for **${cancelData.record.ipName}** (Phone: **${cancelData.record.phone}**) on **${cancelData.record.rescheduledDate || cancelData.dateKey}**.`,
          type: "booking",
          link: "/admin/bookings",
          metadata: {
            ipName: cancelData.record.ipName,
            phone: cancelData.record.phone,
            dateKey: cancelData.dateKey,
          },
        });

        if (recordOwner && recordOwner !== myEmail) {
          await createNotification({
            title: "🗑️ Booking Cancelled",
            message: `Your booking for **${cancelData.record.ipName}** (Phone: **${cancelData.record.phone}**) on **${cancelData.record.rescheduledDate || cancelData.dateKey}** was cancelled by **${userProfile?.displayName || user?.email || "Admin"}**.`,
            type: "booking",
            targetEmail: recordOwner,
            link: "/booking",
            metadata: {
              ipName: cancelData.record.ipName,
              phone: cancelData.record.phone,
              dateKey: cancelData.dateKey,
            },
          });
        }
      } catch (notifErr) {
        console.error("Cancel notification error:", notifErr);
      }

      logUserActivity(user?.email, {
        desc: `Deleted / Cancelled booking for IP: ${cancelData.record.ipName || "Beneficiary"} (Phone: ${cancelData.record.phone || "N/A"}) on ${cancelData.dateKey}`,
        type: "delete",
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

    const secRef = doc(bookingDb, "bookings", b.dateKey);
    const priRef = doc(db, "bookings", b.dateKey);

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

      // Send notifications for visit update
      try {
        const isNowVisited = !b.visited;
        const actionText = isNowVisited ? "marked as visited" : "unmarked and reverted to active";
        const notifTitle = isNowVisited ? "🏥 Hospital Visit Completed" : "🔄 Visit Status Reverted";

        // Notify Admins
        await notifyAdmins({
          title: notifTitle,
          message: `**${userProfile?.displayName || user?.email || "Agent"}** ${actionText} the appointment for **${b.ipName}** (Phone: **${b.phone}**) scheduled on **${b.dateKey}**.`,
          type: "booking",
          link: "/admin/bookings",
          metadata: {
            ipName: b.ipName,
            phone: b.phone,
            dateKey: b.dateKey,
          },
        });

        // Notify Agent
        if (b.agentEmail) {
          await createNotification({
            title: notifTitle,
            message: `Appointment for **${b.ipName}** (Phone: **${b.phone}**) on **${b.dateKey}** was ${actionText}.`,
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
        console.error("Visit notification error:", notifErr);
      }

      logUserActivity(user?.email, {
        desc: `${!b.visited ? "Marked as Visited" : "Unmarked Visited"} for IP: ${b.ipName || "Beneficiary"} (Phone: ${b.phone || "N/A"}) on ${b.dateKey}`,
        type: "booking",
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

      // Check if date is strictly in the past
      const targetDayMidnight = new Date(dateKey);
      targetDayMidnight.setHours(0, 0, 0, 0);
      const isPast = targetDayMidnight < getISTMidnight();

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
          disabled={!isAvailable || isPast}
          className={`h-11 sm:h-14 p-0.5 sm:p-1.5 rounded-xl border flex flex-col items-center justify-between relative transition-all text-left shadow-2xs active:scale-95 ${
            isToday ? "ring-2 ring-blue-500 ring-offset-1" : ""
          } ${
            isPast
              ? "bg-slate-50 border-slate-200 text-slate-400 opacity-60 cursor-not-allowed"
              : isAvailable
              ? "bg-emerald-50/70 border-emerald-200 hover:bg-emerald-100/80 text-emerald-900 cursor-pointer"
              : "bg-rose-50/60 border-rose-200 text-rose-700 opacity-80 cursor-not-allowed"
          }`}
        >
          <span className={`text-[9px] sm:text-[10px] font-bold self-start leading-none ${isToday ? "text-blue-600 font-extrabold" : "text-slate-600"}`}>
            {day}
          </span>
          <div className="text-center my-auto">
            <div className="text-xs sm:text-base font-black leading-none">{dbInfo.seats}</div>
          </div>
          {dbInfo.text ? (
            <span className="text-[7px] sm:text-[8px] italic text-slate-500 truncate w-full text-center leading-tight block">
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
    <div className="space-y-6 sm:space-y-8">
      {/* Top Header with date in parallel on mobile & desktop */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            Bookings
          </h1>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-slate-600 bg-white border border-slate-200 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl shadow-xs shrink-0">
          <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600" />
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

      {/* 8 Metric KPI Cards: 4 Personal (Mine) + 4 Overall (All) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 sm:gap-3 select-none">
        {/* 1. Total (Mine) */}
        <div className="bg-amber-50/70 border border-amber-200 p-3 sm:p-3.5 rounded-2xl flex flex-col justify-between shadow-2xs">
          <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wider truncate">Total (Mine)</div>
          <div className="text-lg sm:text-xl font-black text-amber-900 mt-0.5">{metrics.totalMy}</div>
        </div>

        {/* 2. Today's Bookings (Mine) */}
        <div className="bg-emerald-50/70 border border-emerald-200 p-3 sm:p-3.5 rounded-2xl flex flex-col justify-between shadow-2xs">
          <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider truncate">Today Booking (Mine)</div>
          <div className="text-lg sm:text-xl font-black text-emerald-900 mt-0.5">{metrics.todayMy}</div>
        </div>

        {/* 3. This Month (Mine) */}
        <div className="bg-blue-50/70 border border-blue-200 p-3 sm:p-3.5 rounded-2xl flex flex-col justify-between shadow-2xs">
          <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider truncate">This Month (Mine)</div>
          <div className="text-lg sm:text-xl font-black text-blue-900 mt-0.5">{metrics.monthMy}</div>
        </div>

        {/* 4. Visited (Mine) */}
        <div className="bg-teal-50/70 border border-teal-200 p-3 sm:p-3.5 rounded-2xl flex flex-col justify-between shadow-2xs">
          <div className="text-[10px] font-bold text-teal-800 uppercase tracking-wider truncate">Visited (Mine)</div>
          <div className="text-lg sm:text-xl font-black text-teal-900 mt-0.5">{metrics.visitedMy}</div>
        </div>

        {/* 5. Today's Visit (All) */}
        <div className="bg-sky-50/70 border border-sky-200 p-3 sm:p-3.5 rounded-2xl flex flex-col justify-between shadow-2xs">
          <div className="text-[10px] font-bold text-sky-800 uppercase tracking-wider truncate">Today&apos;s Visit (All)</div>
          <div className="text-lg sm:text-xl font-black text-sky-900 mt-0.5">{metrics.todaysVisitAll}</div>
        </div>

        {/* 6. Today's Bookings (All) */}
        <div className="bg-rose-50/70 border border-rose-200 p-3 sm:p-3.5 rounded-2xl flex flex-col justify-between shadow-2xs">
          <div className="text-[10px] font-bold text-rose-800 uppercase tracking-wider truncate">Today&apos;s Bookings (All)</div>
          <div className="text-lg sm:text-xl font-black text-rose-900 mt-0.5">{metrics.todayAll}</div>
        </div>

        {/* 7. Follow up (All) */}
        <div className="bg-amber-100/70 border border-amber-300 p-3 sm:p-3.5 rounded-2xl flex flex-col justify-between shadow-2xs">
          <div className="text-[10px] font-extrabold text-amber-900 uppercase tracking-wider truncate flex items-center justify-between">
            <span className="truncate">Follow up (All)</span>
            <Clock className="w-3 h-3 text-amber-700 shrink-0 ml-1" />
          </div>
          <div className="text-lg sm:text-xl font-black text-amber-950 mt-0.5">{metrics.todaysFollowupAll}</div>
        </div>

        {/* 8. Visited (All) */}
        <div className="bg-purple-50/70 border border-purple-200 p-3 sm:p-3.5 rounded-2xl flex flex-col justify-between shadow-2xs">
          <div className="text-[10px] font-bold text-purple-800 uppercase tracking-wider truncate">Visited (All)</div>
          <div className="text-lg sm:text-xl font-black text-purple-900 mt-0.5">{metrics.visitedAll}</div>
        </div>
      </div>

      {/* Dual Month Calendar View */}
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
              className="p-1.5 text-slate-600 hover:bg-slate-100 active:bg-slate-200 rounded-lg transition-colors cursor-pointer"
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
              className="p-1.5 text-slate-600 hover:bg-slate-100 active:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              title="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2 Months Grid: Single month on mobile, 2 months on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8 md:divide-x md:divide-slate-100">
          <div>{renderCalendarMonth(calendarDate)}</div>
          <div className="hidden md:block md:pl-8">{renderCalendarMonth(nextMonthDate)}</div>
        </div>
      </div>

      {/* Booking Records Table Section */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-xs space-y-4">
        {/* Table Top Bar */}
        <div className="border-b border-slate-100 pb-4 space-y-3">
          {/* Row 1: Top Bar with Title, Dynamic Counter Badge, Reset Button, All Filters & Segmented Switcher in ONE line on Desktop */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Header: Title + Dynamic Counter Pill + Reset Button */}
            <div className="flex items-center gap-2 flex-wrap">
              <Ticket className="w-5 h-5 text-blue-600 shrink-0" />
              <h2 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight whitespace-nowrap">
                Booking Records
              </h2>

              {/* Dynamic Filter Pill Badge */}
              <div className="flex items-center gap-1.5 bg-sky-50 border border-sky-200/80 text-sky-800 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs font-bold shadow-2xs whitespace-nowrap">
                <span>{agentFilterLabel}:</span>
                <span className="bg-sky-600 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full leading-tight">
                  {displayedBookings.length}
                </span>
              </div>

              {/* Reset Filters Button */}
              {(scheduleDateFilter || statusFilter !== "all" || searchTerm) && (
                <button
                  onClick={() => {
                    setScheduleDateFilter("");
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

            {/* Right side: All Filter Dropdowns + Segmented Switcher */}
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full lg:w-auto">
              {/* Single Scheduled Date Filter */}
              <label
                htmlFor="agent-filter-schedule-date"
                onClick={(e) => {
                  const input = e.currentTarget.querySelector('input') as HTMLInputElement;
                  if (input && typeof input.showPicker === 'function') {
                    try { input.showPicker(); } catch (err) {}
                  }
                }}
                className="flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100/80 active:bg-slate-200 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs cursor-pointer select-none w-full sm:w-auto"
                title="Filter by Scheduled Date"
              >
                <CalendarIcon className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="text-[10px] font-bold text-slate-400 uppercase shrink-0">Date:</span>
                <input
                  id="agent-filter-schedule-date"
                  type="date"
                  value={scheduleDateFilter}
                  onChange={(e) => {
                    setScheduleDateFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  onClick={(e) => {
                    try { (e.target as any).showPicker?.(); } catch (err) {}
                  }}
                  className="bg-transparent outline-none text-slate-800 text-xs font-bold cursor-pointer w-full min-w-0"
                />
                {scheduleDateFilter && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setScheduleDateFilter("");
                      setCurrentPage(1);
                    }}
                    className="text-slate-400 hover:text-slate-600 p-0.5 shrink-0"
                    title="Clear date filter"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </label>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as any);
                  setCurrentPage(1);
                }}
                className="px-2.5 py-1.5 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl text-blue-600 outline-none cursor-pointer focus:bg-white focus:border-blue-400 transition-all shadow-2xs w-full sm:w-auto"
              >
                <option value="all">Status: All</option>
                <option value="todays_visit">Status: Today&apos;s Visit</option>
                <option value="todays_followup">Status: Follow up</option>
                <option value="upcoming">Status: Upcoming</option>
                <option value="visited">Status: Visited</option>
              </select>

              {/* Segmented View Switcher (Desktop & Mobile) */}
              <div className="flex items-center bg-slate-100 p-1 rounded-xl col-span-2 sm:col-span-1 justify-center sm:justify-start shrink-0">
                <button
                  onClick={() => {
                    setTableView("all");
                    setCurrentPage(1);
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                    tableView === "all"
                      ? "bg-white text-blue-600 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  All ({allBookings.length})
                </button>
                <button
                  onClick={() => {
                    setTableView("my");
                    setCurrentPage(1);
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                    tableView === "my"
                      ? "bg-white text-blue-600 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  My ({myBookings.length})
                </button>
              </div>
            </div>
          </div>

          {/* Row 2: Full-width Responsive Search Bar directly below filters */}
          <div className="relative w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by IP / IW name, phone, or agent..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
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

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                {tableView === "all" && <th className="p-3.5">Booked By</th>}
                <th className="p-3.5">IP / IW Name</th>
                <th className="p-3.5">Phone Number</th>
                <th className="p-3.5">Scheduled Date</th>
                <th className="p-3.5 text-purple-700 bg-purple-50/60 font-semibold">Rescheduled Date</th>
                <th className="p-3.5">Follow up Date</th>
                <th className="p-3.5">Booked On</th>
                <th className="p-3.5 text-center">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {paginatedList.length === 0 ? (
                <tr>
                  <td
                    colSpan={tableView === "all" ? 9 : 8}
                    className="text-center py-12 text-slate-400"
                  >
                    No bookings found matching criteria.
                  </td>
                </tr>
              ) : (
                paginatedList.map((b, idx) => {
                  const istMidnight = getISTMidnight();
                  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
                  const schedDate = new Date(b.dateKey);
                  schedDate.setHours(0, 0, 0, 0);

                  const followUpInfo = getFollowUpInfo(b.dateKey, followUpDays);
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
                    <tr
                      key={`${b.dateKey}-${b.timestamp}-${idx}`}
                      className={`transition-colors ${
                        b.rescheduled
                          ? "bg-purple-50/90 hover:bg-purple-100/90 border-l-4 border-l-purple-600 text-purple-950 font-medium"
                          : "hover:bg-slate-50/70"
                      }`}
                    >
                      {tableView === "all" && (
                        <td className="p-3.5 font-bold text-blue-600">{b.agentName}</td>
                      )}
                      <td className="p-3.5">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                          <span>{maskIpInfo ? maskIpName(b.ipName) : b.ipName}</span>
                          {!maskIpInfo && (
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
                          )}
                        </div>
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-1.5 font-mono text-slate-600">
                          <span>{maskIpInfo ? maskPhone(b.phone) : b.phone}</span>
                          {!maskIpInfo && (
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
                          )}
                        </div>
                      </td>
                      <td className="p-3.5 text-slate-800 font-medium">
                        {b.rescheduled && b.originalScheduledDate && b.originalScheduledDate !== b.dateKey ? (
                          <div className="flex flex-col">
                            <span className="text-slate-800 font-bold">{b.originalScheduledDate}</span>
                            <span className="text-[10px] text-purple-600 font-semibold">Original</span>
                          </div>
                        ) : (
                          <span>{schedDateStr}</span>
                        )}
                      </td>
                      <td className="p-3.5">
                        {b.rescheduled ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300 shadow-2xs">
                            <Clock className="w-3 h-3 text-purple-600" />
                            {b.rescheduledDate || b.dateKey}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs font-normal">-</span>
                        )}
                      </td>
                      <td className="p-3.5">
                        <span className="font-semibold text-amber-800 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-lg text-[11px] whitespace-nowrap inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 text-amber-600" />
                          {followUpInfo.formatted}
                        </span>
                      </td>
                      <td className="p-3.5 text-slate-400">{bookedOnDateStr}</td>
                      <td className="p-3.5 text-center">
                        {b.visited ? (
                          <span className="bg-emerald-50 text-emerald-700 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1">
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
                          <span className="bg-amber-50 text-amber-800 border border-amber-200 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1 whitespace-nowrap">
                            <Clock className="w-3 h-3 text-amber-600" /> Follow up on {followUpInfo.formatted}
                          </span>
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

                          {/* Edit Booking Button - Only shown if owner or admin */}
                          {((b.agentEmail || "").toLowerCase().trim() === (user?.email || "").toLowerCase().trim() || isAdmin) && (
                            <>
                              <button
                                onClick={() => {
                                  setEditBookingItem(b);
                                  setEditIpName(b.ipName || "");
                                  setEditPhone(b.phone || "");
                                  setEditSelectedAgentEmail(b.agentEmail || "");
                                }}
                                className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                                title="Edit Booking Details"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setCancelData({ dateKey: b.dateKey, record: b })}
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                                title="Cancel Booking & Release Seat"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
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

        {/* Mobile List View (Clean rows divided by dotted lines) */}
        <div className="block md:hidden divide-y divide-dashed divide-slate-200">
          {paginatedList.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-xs">
              No bookings found matching criteria.
            </div>
          ) : (
            paginatedList.map((b, idx) => {
              const istMidnight = getISTMidnight();
              const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
              const schedDate = new Date(b.dateKey);
              schedDate.setHours(0, 0, 0, 0);

              const followUpInfo = getFollowUpInfo(b.dateKey, followUpDays);
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

              const isOwnerOrAdmin =
                (b.agentEmail || "").toLowerCase().trim() === (user?.email || "").toLowerCase().trim() || isAdmin;

              return (
                <div
                  key={`mobile-${b.dateKey}-${b.timestamp}-${idx}`}
                  className="py-4 first:pt-1 last:pb-1 space-y-2.5"
                >
                  {/* Header: IP Name & Status Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 font-bold text-slate-900 text-sm">
                        <span>{maskIpInfo ? maskIpName(b.ipName) : b.ipName}</span>
                        {!maskIpInfo && (
                          <button
                            onClick={() => handleCopy(b.ipName, `name-m-${idx}`)}
                            className="text-slate-400 hover:text-blue-600 p-0.5 rounded cursor-pointer"
                            title="Copy Name"
                          >
                            {copiedId === `name-m-${idx}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                      {tableView === "all" && b.agentName && (
                        <span className="text-[11px] font-semibold text-blue-600 block mt-0.5">
                          Booked by {b.agentName}
                        </span>
                      )}
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

                  {/* Scheduled Date, Follow up Date, Phone Number & Booked On Details */}
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
                            onClick={() => handleCopy(b.phone, `phone-m-${idx}`)}
                            className="text-slate-400 hover:text-blue-600 p-0.5 rounded cursor-pointer"
                            title="Copy Phone"
                          >
                            {copiedId === `phone-m-${idx}` ? (
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

                  <div className="text-[11px] text-slate-400">
                    <span>Booked: {bookedOnDateStr}</span>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => handleToggleVisitedAgent(b)}
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
                        setRescheduleData({ oldDateKey: b.dateKey, record: b });
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

                    {isOwnerOrAdmin && (
                      <>
                        <button
                          onClick={() => {
                            setEditBookingItem(b);
                            setEditIpName(b.ipName || "");
                            setEditPhone(b.phone || "");
                            setEditSelectedAgentEmail(b.agentEmail || "");
                          }}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors cursor-pointer"
                          title="Edit Booking Details"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setCancelData({ dateKey: b.dateKey, record: b })}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                          title="Cancel Booking"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
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
                Rescheduling For:{" "}
                <strong className="text-slate-900">
                  {maskIpInfo && rescheduleData.record.ipName
                    ? maskIpName(rescheduleData.record.ipName)
                    : rescheduleData.record.ipName}
                </strong>
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
                <strong className="text-slate-800">
                  {maskIpInfo && cancelData.record.ipName
                    ? maskIpName(cancelData.record.ipName)
                    : cancelData.record.ipName}
                </strong>{" "}
                on <strong>{cancelData.dateKey}</strong>? The seat will be returned immediately.
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
                Confirming visit for{" "}
                <strong className="text-slate-800">
                  {maskIpInfo && visitData.record.ipName
                    ? maskIpName(visitData.record.ipName)
                    : visitData.record.ipName}
                </strong>
                . This locks the booking permanently.
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

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-2.5">
              {isMasterAdmin ? (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700">
                      Booked By (Agent) <span className="text-rose-500">*</span>
                    </label>
                    <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-bold border border-blue-200">
                      Master Admin Control
                    </span>
                  </div>
                  <select
                    value={editSelectedAgentEmail}
                    onChange={(e) => setEditSelectedAgentEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs"
                  >
                    {allAgentOptions.map((ag) => (
                      <option key={ag.email} value={ag.email}>
                        {ag.name} ({ag.email})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  Booked By: <strong className="text-blue-600">{editBookingItem.agentName || editBookingItem.agentEmail}</strong>
                </div>
              )}
              <div className="text-slate-600 pt-0.5 border-t border-slate-200/60">
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
