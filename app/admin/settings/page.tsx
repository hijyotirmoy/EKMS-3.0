"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db, logsDb, bookingDb } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import {
  logUserActivity,
  SystemLogDoc,
  getTodayDateString,
  deleteSystemAuditLog,
  deleteBulkSystemAuditLogs,
  clearAllSystemAuditLogs,
} from "@/lib/activityLogger";
import {
  getFacilityAvailabilityMap,
  saveAllFacilityAvailability,
  isFacilityAccepting,
  normalizeFacilityKey,
} from "@/lib/facilityAvailability";
import { getCachedFacilities, setCachedFacilities } from "@/lib/clientCache";
import {
  getRecentlyDeletedList,
  restoreRecentlyDeletedItem,
  permanentlyDeleteRecentlyDeletedItem,
  emptyAllRecentlyDeleted,
  getLocalRecentlyDeleted,
  archiveToRecentlyDeleted,
  getExpiryRemainingText,
  formatISTTime,
} from "@/lib/recentlyDeleted";
import { UserProfile } from "@/lib/types";
import { ALL_AGENT_PAGES, ALL_ADMIN_PAGES, AppPageDef, isPageRestricted } from "@/lib/pageAccess";
import {
  Settings,
  Image as ImageIcon,
  Folder,
  Clock,
  Wrench,
  Shield,
  Save,
  CheckCircle2,
  AlertTriangle,
  EyeOff,
  Eye,
  KeyRound,
  ShieldCheck,
  Lock,
  Unlock,
  Users,
  Search,
  Check,
  X,
  UserCheck,
  ShieldAlert,
  RotateCcw,
  CheckCheck,
  Home,
  HelpCircle,
  Building2,
  GraduationCap,
  Gamepad2,
  CalendarCheck,
  Database,
  Flag,
  User,
  PieChart,
  Edit,
  FileSpreadsheet,
  Users2,
  Bell,
  ClipboardCheck,
  Activity,
  History,
  ListFilter,
  PlusCircle,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Code2,
  Terminal,
  Key,
  RefreshCw,
  Power,
  Globe,
  ExternalLink,
  Stethoscope,
  Pill,
  CalendarClock,
  ArchiveRestore,
  Ban,
  Loader2,
} from "lucide-react";

export default function AdminSettingsPage() {
  const { userProfile, isMasterAdmin } = useAuth();
  const { toast, showConfirm } = usePopup();
  const [activeTab, setActiveTab] = useState<
    "facility" | "privacy" | "access" | "logs" | "deleted" | "session" | "maintenance"
  >("facility");

  // Facility Availability State (Matches Triage & Screenshot 1 - Ultra Low Reads/Writes)
  const [facilities, setFacilities] = useState<any[]>(() => getCachedFacilities() || []);
  const [availabilityMap, setAvailabilityMap] = useState<Record<string, boolean>>(() => getFacilityAvailabilityMap());
  const [facilitySearch, setFacilitySearch] = useState("");
  const [facilityTypeFilter, setFacilityTypeFilter] = useState("all");
  const [facilityStatusFilter, setFacilityStatusFilter] = useState("all");
  const [savingFacilities, setSavingFacilities] = useState(false);

  useEffect(() => {
    fetch("/api/facilities/availability")
      .then((res) => res.json())
      .then((data) => {
        if (data?.availability) {
          setAvailabilityMap(data.availability);
          saveAllFacilityAvailability(data.availability);
        }
      })
      .catch(() => {});

    // Ensure all 316 facilities from Firestore & cache are loaded
    const cached = getCachedFacilities();
    if (cached && cached.length > 0) {
      setFacilities(cached);
    }
    import("firebase/firestore").then(({ collection, getDocs }) => {
      import("@/lib/firebase").then(({ db }) => {
        if (db) {
          getDocs(collection(db, "facilities")).then((snap) => {
            if (!snap.empty) {
              const list: any[] = [];
              snap.forEach((d) => {
                const data = d.data();
                list.push({ id: d.id, ...data, facility_type: data.type || data.facility_type || "Facility" });
              });
              list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
              setFacilities(list);
              setCachedFacilities(list);
            }
          }).catch(() => {});
        }
      });
    });
  }, []);

  // System Logs State (Initial load from localStorage for 0-read instant render)
  const [systemLogs, setSystemLogs] = useState<SystemLogDoc[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem("ekms_cached_sys_logs_v1");
        return cached ? JSON.parse(cached) : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  });
  const [loadingSystemLogs, setLoadingSystemLogs] = useState(false);
  const [systemLogsSearch, setSystemLogsSearch] = useState("");
  const [systemLogsTypeFilter, setSystemLogsTypeFilter] = useState<string>("all");
  const [selectedLogIds, setSelectedLogIds] = useState<Set<string>>(new Set());
  const [isDeletingLogs, setIsDeletingLogs] = useState(false);

  // Recently Deleted (7-Day Holding Vault) State
  const [deletedItems, setDeletedItems] = useState<any[]>(() => getLocalRecentlyDeleted() || []);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [deletedSearch, setDeletedSearch] = useState("");
  const [deletedTypeFilter, setDeletedTypeFilter] = useState("all");
  const [deletedPage, setDeletedPage] = useState(1);
  const DELETED_PER_PAGE = 8;
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [purgingId, setPurgingId] = useState<string | null>(null);

  const loadDeletedItems = async () => {
    setDeletedLoading(true);
    try {
      const list = await getRecentlyDeletedList();
      setDeletedItems(list);
    } catch (e) {
      console.warn("loadDeletedItems notice:", e);
    } finally {
      setDeletedLoading(false);
    }
  };

  useEffect(() => {
    loadDeletedItems();
  }, []);

  useEffect(() => {
    if (activeTab === "deleted") {
      loadDeletedItems();
    }
  }, [activeTab]);

  // System Logs Pagination (50 logs at a time)
  const [logsCurrentPage, setLogsCurrentPage] = useState(1);
  const logsPerPage = 50;

  // Mask IP Info Policy
  const [maskIpInfo, setMaskIpInfo] = useState(false);
  const [followUpDays, setFollowUpDays] = useState<number>(8);
  const [savingMaskIp, setSavingMaskIp] = useState(false);
  const [savingFollowUp, setSavingFollowUp] = useState(false);

  // Page Access Control State
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string>("");
  const [selectedRestrictedPages, setSelectedRestrictedPages] = useState<string[]>([]);
  const [userSearchTerm, setUserSearchTerm] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<"all" | "Agent" | "Dispensary Staff" | "Admin" | "Master Admin">("all");
  const [savingAccess, setSavingAccess] = useState(false);

  // Session Policy
  const [sessionTimeoutEnabled, setSessionTimeoutEnabled] = useState(true);
  const [sessionTimeoutDuration, setSessionTimeoutDuration] = useState(30);
  const [savingSession, setSavingSession] = useState(false);

  // Maintenance Policy
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState(
    "The system is currently undergoing scheduled maintenance. Please check back soon."
  );
  const [savingMaintenance, setSavingMaintenance] = useState(false);

  // Image Settings
  const [autoCompress, setAutoCompress] = useState(true);
  const [maxImageSize, setMaxImageSize] = useState(2);


  // Fetch real-time System Activity Logs from logsDb (userActivityLogs & daily_activity)
  useEffect(() => {
    if (activeTab !== "logs") return;
    setLoadingSystemLogs(true);

    // Helper to resolve real user email and format display name cleanly
    const resolveLogUserDetails = (logId: string, rawEmail?: string, rawUserName?: string) => {
      let email = (rawEmail || "").toLowerCase().trim();
      let userName = rawUserName || "";

      // Extract email from document ID if email is missing or unknown
      if ((!email || email.includes("unknown@")) && logId) {
        const cleanId = logId.replace("hist_", "");
        const parts = cleanId.split("_");
        if (parts[0] && parts[0].includes("@")) {
          email = parts[0].toLowerCase().trim();
        }
      }

      if (
        !userName ||
        userName === "User" ||
        userName === "Unknown" ||
        !rawEmail ||
        rawEmail.includes("unknown@")
      ) {
        if (email && !email.includes("unknown@") && email.includes("@")) {
          const namePart = email.split("@")[0];
          userName = namePart.replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
        } else {
          userName = "User";
          email = "";
        }
      }

      return { email, userName };
    };

    // Automatic seamless in-app transfer & repair of historical logs & notifications from db -> logsDb using logged-in admin session
    const syncHistoricalLogsToNewAccount = async () => {
      try {
        const syncKey = "ekms_logs_migrated_v2";
        if (typeof window !== "undefined" && sessionStorage.getItem(syncKey)) return;

        const [dailySnap, notifSnap, annSnap] = await Promise.all([
          getDocs(collection(db, "daily_activity")),
          getDocs(collection(db, "notifications")),
          getDocs(collection(db, "announcements")),
        ]);

        for (const dSnap of dailySnap.docs) {
          const data = dSnap.data();
          const docId = dSnap.id;
          let emailKey = (data.email || "").toLowerCase().trim();

          // Extract email from docId if missing (e.g. himangshu.bezbaruah@piramalswasthya.org_2026-09-16)
          if (!emailKey || emailKey === "unknown@piramalswasthya.org") {
            if (docId.includes("_")) {
              const potentialEmail = docId.substring(0, docId.lastIndexOf("_"));
              if (potentialEmail.includes("@")) {
                emailKey = potentialEmail.toLowerCase().trim();
              }
            }
          }

          if (!emailKey) emailKey = "unknown@piramalswasthya.org";
          const userName =
            emailKey !== "unknown@piramalswasthya.org"
              ? emailKey.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
              : "User";

          await setDoc(doc(logsDb, "daily_activity", docId), { ...data, email: emailKey }, { merge: true });

          if (Array.isArray(data.timelineEvents)) {
            for (let idx = 0; idx < data.timelineEvents.length; idx++) {
              const ev = data.timelineEvents[idx];
              const timestamp = ev.time || ev.timestamp || Date.now();
              const logId = `hist_${docId}_${timestamp}_${idx}`;
              await setDoc(
                doc(logsDb, "userActivityLogs", logId),
                {
                  id: logId,
                  email: emailKey,
                  userName,
                  desc: ev.desc || "User activity recorded",
                  type: ev.type || "general",
                  color: ev.color || "blue",
                  icon: ev.icon || "Activity",
                  timestamp,
                  date: data.date || docId.split("_")[1] || getTodayDateString(),
                },
                { merge: true }
              );
            }
          }
        }

        for (const nSnap of notifSnap.docs) {
          await setDoc(doc(logsDb, "notifications", nSnap.id), nSnap.data(), { merge: true });
        }
        for (const aSnap of annSnap.docs) {
          await setDoc(doc(logsDb, "announcements", aSnap.id), aSnap.data(), { merge: true });
        }

        if (typeof window !== "undefined") {
          sessionStorage.setItem(syncKey, "true");
        }
      } catch (e) {
        console.warn("Auto-sync historical logs notice:", e);
      }
    };
    syncHistoricalLogsToNewAccount();

    let sysLogsFromDb: SystemLogDoc[] = [];
    let timelineLogsFromDb: SystemLogDoc[] = [];

    const syncLogs = () => {
      const logMap = new Map<string, SystemLogDoc>();
      sysLogsFromDb.forEach((l) => logMap.set(l.id, l));
      timelineLogsFromDb.forEach((l) => {
        if (!logMap.has(l.id)) logMap.set(l.id, l);
      });
      const list = Array.from(logMap.values());
      list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setSystemLogs(list);
      setLoadingSystemLogs(false);

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("ekms_cached_sys_logs_v1", JSON.stringify(list.slice(0, 300)));
        } catch (e) {}
      }
    };

    // A. Listen to userActivityLogs collection in logsDb (Fetch up to 1000 newest logs)
    const unsubSysLogs = onSnapshot(
      query(collection(logsDb, "userActivityLogs"), orderBy("timestamp", "desc"), limit(1000)),
      (snap) => {
        const list: SystemLogDoc[] = [];
        snap.forEach((dDoc) => {
          const raw = dDoc.data() as SystemLogDoc;
          const logId = dDoc.id;
          const { email, userName } = resolveLogUserDetails(logId, raw.email, raw.userName);

          // If local resolution fixed unknown values, push fix to logsDb asynchronously
          if (raw.userName === "User" && userName !== "User") {
            setDoc(doc(logsDb, "userActivityLogs", logId), { email, userName }, { merge: true }).catch(() => {});
          }

          list.push({
            ...raw,
            id: logId,
            email,
            userName,
          });
        });
        sysLogsFromDb = list;
        syncLogs();
      },
      (err) => console.warn("userActivityLogs notice:", err)
    );

    // B. Fallback: Listen to daily_activity collection timelineEvents in logsDb
    const unsubDailyLogs = onSnapshot(
      query(collection(logsDb, "daily_activity"), limit(100)),
      (snap) => {
        const list: SystemLogDoc[] = [];
        snap.forEach((dDoc) => {
          const data = dDoc.data();
          const logId = dDoc.id;
          const { email, userName } = resolveLogUserDetails(logId, data.email, undefined);

          if (Array.isArray(data.timelineEvents)) {
            data.timelineEvents.forEach((ev: any, idx: number) => {
              const time = ev.time || ev.timestamp || Date.now();
              const subLogId = `${logId}_${time}_${idx}`;
              list.push({
                id: subLogId,
                email,
                userName,
                desc: ev.desc || "User activity recorded",
                type: ev.type || "general",
                color: ev.color || "blue",
                icon: ev.icon || "Activity",
                timestamp: time,
                date: data.date || getTodayDateString(),
              });
            });
          }
        });
        timelineLogsFromDb = list;
        syncLogs();
      },
      (err) => console.warn("daily_activity fallback notice:", err)
    );

    return () => {
      try { unsubSysLogs(); } catch (e) {}
      try { unsubDailyLogs(); } catch (e) {}
    };
  }, [activeTab]);

  // Reset page to 1 when filters or search change
  useEffect(() => {
    setLogsCurrentPage(1);
  }, [systemLogsSearch, systemLogsTypeFilter]);

  // Filtered System Logs
  const filteredSystemLogs = useMemo(() => {
    let list = systemLogs;
    if (systemLogsTypeFilter !== "all") {
      list = list.filter((l) => l.type === systemLogsTypeFilter);
    }
    if (systemLogsSearch.trim()) {
      const q = systemLogsSearch.toLowerCase().trim();
      list = list.filter(
        (l) =>
          l.userName?.toLowerCase().includes(q) ||
          l.email?.toLowerCase().includes(q) ||
          l.desc?.toLowerCase().includes(q) ||
          l.type?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [systemLogs, systemLogsTypeFilter, systemLogsSearch]);

  // Paginated System Logs (50 logs at a time)
  const logsTotalPages = Math.max(1, Math.ceil(filteredSystemLogs.length / logsPerPage));
  const paginatedSystemLogs = useMemo(() => {
    const start = (logsCurrentPage - 1) * logsPerPage;
    return filteredSystemLogs.slice(start, start + logsPerPage);
  }, [filteredSystemLogs, logsCurrentPage, logsPerPage]);

  // Helper for System Log category badge colors
  const getLogTypeBadge = (type?: string) => {
    switch (type) {
      case "add":
        return { bg: "bg-emerald-50 text-emerald-800 border-emerald-200", label: "ADD" };
      case "edit":
        return { bg: "bg-blue-50 text-blue-800 border-blue-200", label: "EDIT" };
      case "delete":
        return { bg: "bg-rose-50 text-rose-800 border-rose-200", label: "DELETE" };
      case "report":
        return { bg: "bg-rose-50 text-rose-800 border-rose-200", label: "REPORT" };
      case "booking":
        return { bg: "bg-teal-50 text-teal-800 border-teal-200", label: "BOOKING" };
      case "auth":
        return { bg: "bg-indigo-50 text-indigo-800 border-indigo-200", label: "LOGIN / AUTH" };
      case "quiz":
      case "course":
        return { bg: "bg-purple-50 text-purple-800 border-purple-200", label: type.toUpperCase() };
      case "settings":
        return { bg: "bg-slate-100 text-slate-800 border-slate-300", label: "SETTINGS" };
      default:
        return { bg: "bg-slate-50 text-slate-700 border-slate-200", label: (type || "ACTIVITY").toUpperCase() };
    }
  };

  // Facility Availability Counts & Filters
  const facilityCounts = useMemo(() => {
    let accepting = 0;
    let offline = 0;
    facilities.forEach((f) => {
      if (isFacilityAccepting(f, availabilityMap)) {
        accepting++;
      } else {
        offline++;
      }
    });
    return { total: facilities.length, accepting, offline };
  }, [facilities, availabilityMap]);

  const filteredFacilities = useMemo(() => {
    return facilities.filter((f) => {
      if (facilityTypeFilter !== "all") {
        const typeStr = (f.facility_type || f.type || "").toLowerCase();
        if (facilityTypeFilter === "dispensary" && !typeStr.includes("dispensary")) return false;
        if (facilityTypeFilter === "esic_hospital" && !typeStr.includes("esic") && !typeStr.includes("hospital")) return false;
        if (facilityTypeFilter === "tie_up" && !typeStr.includes("tie-up") && !typeStr.includes("tie_up")) return false;
        if (facilityTypeFilter === "govt" && !typeStr.includes("district") && !typeStr.includes("govt") && !typeStr.includes("civil")) return false;
      }
      if (facilityStatusFilter !== "all") {
        const accepting = isFacilityAccepting(f, availabilityMap);
        if (facilityStatusFilter === "accepting" && !accepting) return false;
        if (facilityStatusFilter === "offline" && accepting) return false;
      }
      if (facilitySearch.trim()) {
        const q = facilitySearch.toLowerCase().trim();
        const name = (f.name || "").toLowerCase();
        const district = (f.district || "").toLowerCase();
        const pincode = (f.pincode || "").toLowerCase();
        const address = (f.address || "").toLowerCase();
        if (!name.includes(q) && !district.includes(q) && !pincode.includes(q) && !address.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [facilities, availabilityMap, facilityTypeFilter, facilityStatusFilter, facilitySearch]);

  const handleToggleFacility = (facility: any) => {
    const current = isFacilityAccepting(facility, availabilityMap);
    const next = !current;
    const newMap = { ...availabilityMap };
    const key = normalizeFacilityKey(facility);
    newMap[key] = next;
    if (facility.name) {
      newMap[facility.name.toLowerCase().trim()] = next;
      newMap[facility.name] = next;
    }
    setAvailabilityMap(newMap);
    saveAllFacilityAvailability(newMap);
  };

  const handleBulkSetAvailability = (enableAll: boolean) => {
    const newMap = { ...availabilityMap };
    filteredFacilities.forEach((f) => {
      const key = normalizeFacilityKey(f);
      newMap[key] = enableAll;
      if (f.name) {
        newMap[f.name.toLowerCase().trim()] = enableAll;
        newMap[f.name] = enableAll;
      }
    });
    setAvailabilityMap(newMap);
    saveAllFacilityAvailability(newMap);
    toast.success(enableAll ? "All filtered facilities enabled" : "All filtered facilities disabled");
  };

  const handleSaveFacilityAvailability = async () => {
    setSavingFacilities(true);
    try {
      saveAllFacilityAvailability(availabilityMap);
      const res = await fetch("/api/facilities/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace: true, availability: availabilityMap }),
      });
      if (res.ok) {
        toast.success("Facility operational status saved successfully!");
        logUserActivity(userProfile?.email, {
          desc: `Admin updated facility operational availability (${facilityCounts.accepting} accepting, ${facilityCounts.offline} offline)`,
          type: "facility",
        });
      } else {
        toast.info("Saved locally and broadcasted to active sessions.");
      }
    } catch (err: any) {
      toast.info("Saved locally and broadcasted to active sessions.");
    } finally {
      setSavingFacilities(false);
    }
  };

  // Recently Deleted Computed & Handlers
  const deletedCounts = useMemo(() => {
    const counts = { total: deletedItems.length, appointment: 0, case: 0, user: 0, log: 0 };
    deletedItems.forEach((x) => {
      if (counts[x.itemType as keyof typeof counts] !== undefined) {
        (counts[x.itemType as keyof typeof counts] as number)++;
      }
    });
    return counts;
  }, [deletedItems]);

  const filteredDeletedItems = useMemo(() => {
    return deletedItems.filter((item) => {
      if (deletedTypeFilter !== "all" && item.itemType !== deletedTypeFilter) return false;
      if (deletedSearch.trim()) {
        const q = deletedSearch.toLowerCase().trim();
        const matchTitle = String(item.title || "").toLowerCase().includes(q);
        const matchSubtitle = String(item.subtitle || "").toLowerCase().includes(q);
        const matchId = String(item.originalId || "").toLowerCase().includes(q);
        const matchDeletedBy = String(item.deletedBy || "").toLowerCase().includes(q);
        if (!matchTitle && !matchSubtitle && !matchId && !matchDeletedBy) return false;
      }
      return true;
    });
  }, [deletedItems, deletedTypeFilter, deletedSearch]);

  const totalDeletedPages = Math.max(1, Math.ceil(filteredDeletedItems.length / DELETED_PER_PAGE));
  const paginatedDeletedItems = useMemo(() => {
    const start = (deletedPage - 1) * DELETED_PER_PAGE;
    return filteredDeletedItems.slice(start, start + DELETED_PER_PAGE);
  }, [filteredDeletedItems, deletedPage]);

  const handleRestoreItem = async (item: any) => {
    setRestoringId(item.id);
    try {
      const res = await restoreRecentlyDeletedItem(item.id, userProfile as any);
      if (res.success) {
        toast.success(`${item.title || "Record"} successfully restored!`);
        setDeletedItems((prev) => prev.filter((x) => x.id !== item.id));
        logUserActivity(userProfile?.email, {
          desc: `Restored deleted item: ${item.title || item.originalId} (${item.itemType})`,
          type: "add",
        });
      } else {
        toast.error("Failed to restore: " + (res.error || "Unknown error"));
      }
    } catch (err: any) {
      toast.error("Failed to restore: " + err.message);
    } finally {
      setRestoringId(null);
    }
  };

  const handlePermanentDelete = async (item: any) => {
    const confirmed = await showConfirm(`Permanently delete "${item.title || item.originalId}"? This record cannot be restored.`);
    if (!confirmed) return;
    setPurgingId(item.id);
    try {
      await permanentlyDeleteRecentlyDeletedItem(item.id);
      toast.success(`${item.title || "Record"} permanently deleted.`);
      setDeletedItems((prev) => prev.filter((x) => x.id !== item.id));
      logUserActivity(userProfile?.email, {
        desc: `Permanently deleted record from vault: ${item.title || item.originalId}`,
        type: "delete",
      });
    } catch (err: any) {
      toast.error("Failed to delete: " + err.message);
    } finally {
      setPurgingId(null);
    }
  };

  const handleEmptyBin = async () => {
    const confirmed = await showConfirm("Empty all items from Recently Deleted vault permanently?");
    if (!confirmed) return;
    try {
      await emptyAllRecentlyDeleted();
      toast.success("Recycle bin emptied.");
      setDeletedItems([]);
      logUserActivity(userProfile?.email, {
        desc: `Admin emptied the 7-day Recently Deleted holding vault`,
        type: "delete",
      });
    } catch (err: any) {
      toast.error("Failed to empty recycle bin: " + err.message);
    }
  };

  // Log Selection & Deletion Handlers
  const handleToggleSelectLog = (id: string) => {
    setSelectedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAllLogs = () => {
    if (selectedLogIds.size === paginatedSystemLogs.length && paginatedSystemLogs.length > 0) {
      setSelectedLogIds(new Set());
    } else {
      setSelectedLogIds(new Set(paginatedSystemLogs.map((l) => l.id)));
    }
  };

  const handleDeleteSingleLog = async (logItem: SystemLogDoc) => {
    const confirmed = await showConfirm("Delete this activity log? It will be held in Recently Deleted for 7 days.");
    if (!confirmed) return;
    setIsDeletingLogs(true);
    try {
      try {
        await archiveToRecentlyDeleted({
          item: logItem,
          itemType: "log",
          deletedBy: userProfile?.name || userProfile?.email || "Administrator",
          deletedByEmail: userProfile?.email || "",
        });
      } catch (_) {}

      await deleteSystemAuditLog(logItem.id);
      setSystemLogs((prev) => prev.filter((l) => l.id !== logItem.id));
      setSelectedLogIds((prev) => {
        const next = new Set(prev);
        next.delete(logItem.id);
        return next;
      });
      loadDeletedItems();
      toast.success("Activity log moved to 7-day Recently Deleted vault.");
    } catch (e) {
      toast.error("Failed to delete log");
    } finally {
      setIsDeletingLogs(false);
    }
  };

  const handleDeleteBulkLogs = async () => {
    if (selectedLogIds.size === 0) return;
    const count = selectedLogIds.size;
    const confirmed = await showConfirm(`Are you sure you want to delete ${count} selected activity log(s)? They will be held in Recently Deleted for 7 days.`);
    if (!confirmed) return;
    setIsDeletingLogs(true);
    try {
      const idsArray = Array.from(selectedLogIds);
      const logsToDelete = systemLogs.filter((l) => selectedLogIds.has(l.id));

      for (const item of logsToDelete) {
        try {
          await archiveToRecentlyDeleted({
            item,
            itemType: "log",
            deletedBy: userProfile?.name || userProfile?.email || "Administrator",
            deletedByEmail: userProfile?.email || "",
          });
        } catch (_) {}
      }

      await deleteBulkSystemAuditLogs(idsArray);
      setSystemLogs((prev) => prev.filter((l) => !selectedLogIds.has(l.id)));
      setSelectedLogIds(new Set());
      loadDeletedItems();
      toast.success(`Moved ${idsArray.length} activity logs to Recently Deleted vault.`);
    } catch (e) {
      toast.error("Failed to delete selected logs");
    } finally {
      setIsDeletingLogs(false);
    }
  };

  // 1. Fetch System Settings from Firestore
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const docSnap = await getDoc(doc(db, "system", "status"));
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.maskIpInfo !== undefined) {
            setMaskIpInfo(!!data.maskIpInfo);
          }
          if (data.followUpDays !== undefined) {
            setFollowUpDays(Number(data.followUpDays));
          }
          if (data.sessionTimeoutEnabled !== undefined) {
            setSessionTimeoutEnabled(!!data.sessionTimeoutEnabled);
          }
          if (data.sessionTimeoutDuration !== undefined) {
            setSessionTimeoutDuration(Number(data.sessionTimeoutDuration));
          }
          if (data.maintenanceMode !== undefined) {
            setMaintenanceMode(
              data.maintenanceMode === true || String(data.maintenanceMode).toLowerCase() === "true"
            );
          }
          if (data.maintenanceMessage) {
            setMaintenanceMessage(data.maintenanceMessage);
          }
        }
      } catch (e) {
        console.error("Settings load error:", e);
      }
    };
    fetchSettings();
  }, []);

  // Allowed pages for Dispensary Staff by default (all other pages default to OFF / LOCKED)
  const DISPENSARY_DEFAULT_ALLOWED_PATHS = useMemo(
    () => [
      "/dispensary/appointment",
      "/dispensary/reception",
      "/dispensary/doctor",
      "/dispensary/pharmacy",
      "/profile",
      "/reports",
    ],
    []
  );

  const getDefaultRestrictedPagesForRole = useCallback(
    (role: string): string[] => {
      const r = (role || "").toLowerCase().trim();
      if (r.includes("dispensary")) {
        return ALL_AGENT_PAGES.map((p) => p.path).filter(
          (path) => !DISPENSARY_DEFAULT_ALLOWED_PATHS.includes(path)
        );
      }
      return [];
    },
    [DISPENSARY_DEFAULT_ALLOWED_PATHS]
  );

  // 2. Realtime listener for Users list (for Page Access Control)
  useEffect(() => {
    let isMounted = true;
    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const list: UserProfile[] = [];
        snap.forEach((d) => {
          const data = d.data() as UserProfile;
          const roleRaw = (data.role || "").trim();
          const isDisp =
            roleRaw === "Dispensary" ||
            roleRaw === "Dispensary Staff" ||
            roleRaw.toLowerCase().includes("dispensary") ||
            Boolean(data.dispensaryName) ||
            Boolean((data as any).dispensaryRole);
          const normalizedRole = isDisp ? "Dispensary Staff" : (roleRaw || "Agent");
          const normEmail = (data.email || d.id || "").toLowerCase().trim();

          list.push({
            ...data,
            id: d.id,
            email: normEmail,
            displayName:
              data.displayName ||
              (data as any).dispensaryName ||
              data.name ||
              (normEmail ? normEmail.split("@")[0] : d.id),
            role: normalizedRole as any,
            restrictedPages: Array.isArray(data.restrictedPages) ? data.restrictedPages : [],
          });
        });

        // Deduplicate by email
        const seenEmails = new Set<string>();
        const uniqueList: UserProfile[] = [];
        for (const u of list) {
          if (!u.email || seenEmails.has(u.email)) continue;
          seenEmails.add(u.email);
          uniqueList.push(u);
        }

        uniqueList.sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));

        if (isMounted) {
          setUsersList(uniqueList);

          // Auto-select first user if none selected
          setSelectedUserEmail((curr) => {
            const normCurr = (curr || "").toLowerCase().trim();
            if (normCurr && uniqueList.some((u) => u.email === normCurr)) {
              return normCurr;
            }
            const defaultUser = uniqueList.find((u) => u.role === "Agent") || uniqueList[0];
            if (defaultUser) {
              const isDisp = (defaultUser.role || "").toLowerCase().includes("dispensary");
              if (isDisp && (!defaultUser.restrictedPages || defaultUser.restrictedPages.length === 0)) {
                setSelectedRestrictedPages(getDefaultRestrictedPagesForRole("Dispensary Staff"));
              } else {
                setSelectedRestrictedPages(defaultUser.restrictedPages || []);
              }
              return defaultUser.email;
            }
            return "";
          });
        }
      },
      (err) => {
        console.error("Error loading users for permissions:", err);
      }
    );

    return () => {
      isMounted = false;
      unsub();
    };
  }, [getDefaultRestrictedPagesForRole]);

  // Sync selected user restricted pages when selection changes
  const selectedUser = useMemo(() => {
    return usersList.find((u) => u.email.toLowerCase() === selectedUserEmail.toLowerCase()) || null;
  }, [usersList, selectedUserEmail]);

  const handleSelectUser = (email: string) => {
    const norm = (email || "").toLowerCase().trim();
    setSelectedUserEmail(norm);
    const target = usersList.find((u) => u.email.toLowerCase().trim() === norm);
    if (!target) return;
    const isDisp = (target.role || "").toLowerCase().includes("dispensary");
    if (isDisp) {
      if (Array.isArray(target.restrictedPages) && target.restrictedPages.length > 0) {
        setSelectedRestrictedPages(target.restrictedPages);
      } else {
        // By default, non-allowed pages are toggled OFF (restricted)
        setSelectedRestrictedPages(getDefaultRestrictedPagesForRole("Dispensary Staff"));
      }
    } else {
      setSelectedRestrictedPages(target.restrictedPages || []);
    }
  };

  const handleRoleFilterChange = (role: "all" | "Agent" | "Dispensary Staff" | "Admin" | "Master Admin") => {
    setUserRoleFilter(role);
    setUserSearchTerm("");
    const matching = usersList.filter((u) => {
      if (role === "all") return true;
      if (role === "Dispensary Staff") {
        return (
          u.role === "Dispensary Staff" ||
          u.role === "Dispensary" ||
          (u.role || "").toLowerCase().includes("dispensary")
        );
      }
      return u.role === role;
    });
    if (matching.length > 0) {
      const isCurrentInList = matching.some((u) => u.email.toLowerCase() === selectedUserEmail.toLowerCase());
      if (!isCurrentInList) {
        handleSelectUser(matching[0].email);
      }
    }
  };

  // Filtered users for dropdown/search
  const filteredUsers = useMemo(() => {
    return usersList.filter((u) => {
      if (userRoleFilter !== "all") {
        if (userRoleFilter === "Dispensary Staff") {
          if (
            u.role !== "Dispensary Staff" &&
            u.role !== "Dispensary" &&
            !(u.role || "").toLowerCase().includes("dispensary")
          ) {
            return false;
          }
        } else if (u.role !== userRoleFilter) {
          return false;
        }
      }
      if (userSearchTerm.trim()) {
        const q = userSearchTerm.toLowerCase().trim();
        const name = (u.displayName || u.name || "").toLowerCase();
        const email = (u.email || "").toLowerCase();
        const agentId = (u.agentId || (u as any).dispensaryId || "").toLowerCase();
        return name.includes(q) || email.includes(q) || agentId.includes(q);
      }
      return true;
    });
  }, [usersList, userRoleFilter, userSearchTerm]);

  // Is selected user Master Admin?
  const isSelectedMasterAdmin = useMemo(() => {
    const r = (selectedUser?.role || "").toLowerCase().trim();
    return r.includes("master");
  }, [selectedUser]);

  // Applicable pages list for selected user
  const applicablePages: AppPageDef[] = useMemo(() => {
    if (!selectedUser) return ALL_AGENT_PAGES;
    const roleStr = (selectedUser.role || "").toLowerCase().trim();
    if (roleStr.includes("admin") || roleStr.includes("master")) {
      return ALL_ADMIN_PAGES;
    }
    return ALL_AGENT_PAGES;
  }, [selectedUser]);

  // Toggle single page permission
  const handleTogglePagePermission = (pagePath: string) => {
    if (isSelectedMasterAdmin) return;

    setSelectedRestrictedPages((prev) => {
      const isCurrentlyRestricted = prev.includes(pagePath);
      if (isCurrentlyRestricted) {
        // Remove from restricted -> ALLOW page
        return prev.filter((p) => p !== pagePath);
      } else {
        // Add to restricted -> LOCK page
        return [...prev, pagePath];
      }
    });
  };

  // Bulk permission actions
  const handleAllowAllPages = () => {
    setSelectedRestrictedPages([]);
    toast.info("All pages set to ALLOWED for this user.");
  };

  const handleRestrictAllPages = () => {
    if (isSelectedMasterAdmin) return;
    const allPaths = applicablePages.map((p) => p.path);
    setSelectedRestrictedPages(allPaths);
    toast.warning("All pages set to RESTRICTED for this user.");
  };

  const handleResetToDefault = () => {
    if (!selectedUser) return;
    const isDisp = (selectedUser.role || "").toLowerCase().includes("dispensary");
    if (isDisp) {
      setSelectedRestrictedPages(getDefaultRestrictedPagesForRole("Dispensary Staff"));
      toast.info("Permissions reset to Dispensary default (Only Dispensary desks & Profile allowed).");
    } else {
      setSelectedRestrictedPages([]);
      toast.info("Permissions reset to default (All pages accessible).");
    }
  };

  // Save Page Access Permissions to Firestore
  const handleSavePageAccess = async () => {
    if (!selectedUser || !selectedUser.email) return;
    if (isSelectedMasterAdmin) {
      toast.info("Master Administrators always retain full, unrestricted access.");
      return;
    }

    setSavingAccess(true);
    try {
      const email = selectedUser.email.toLowerCase();
      await setDoc(
        doc(db, "users", email),
        {
          restrictedPages: selectedRestrictedPages,
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      logUserActivity(userProfile?.email, {
        desc: `Updated Page Access Permissions for ${selectedUser.displayName || email} (${selectedUser.role}): ${
          selectedRestrictedPages.length === 0
            ? "Full Access (All Allowed)"
            : `${selectedRestrictedPages.length} pages restricted`
        }`,
        type: "settings",
      });

      toast.success(
        `Page permissions updated for ${selectedUser.displayName || email}! ${
          selectedRestrictedPages.length === 0
            ? "All pages are now allowed."
            : `${selectedRestrictedPages.length} pages locked.`
        }`
      );
    } catch (err: any) {
      console.error("Save permissions error:", err);
      toast.error("Failed to save permissions: " + err.message);
    } finally {
      setSavingAccess(false);
    }
  };

  // Save Mask IP Info Policy
  const handleSaveMaskIp = async () => {
    setSavingMaskIp(true);
    try {
      await setDoc(
        doc(db, "system", "status"),
        {
          maskIpInfo,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      logUserActivity(userProfile?.email, {
        desc: `Updated IP Privacy Policy: Masking ${maskIpInfo ? "ENABLED" : "DISABLED"}`,
        type: "settings",
      });
      toast.success(
        maskIpInfo
          ? "Mask IP Info enabled! IP names and phone numbers are now masked across all booking interfaces."
          : "Mask IP Info disabled. Full IP names and numbers are now visible."
      );
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSavingMaskIp(false);
    }
  };

  // Save Follow-Up Schedule Policy
  const handleSaveFollowUp = async () => {
    setSavingFollowUp(true);
    try {
      const validFollowUpDays = Number(followUpDays) > 0 ? Number(followUpDays) : 8;
      await setDoc(
        doc(db, "system", "status"),
        {
          followUpDays: validFollowUpDays,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      logUserActivity(userProfile?.email, {
        desc: `Updated Follow-Up Schedule Offset: ${validFollowUpDays} days`,
        type: "settings",
      });
      toast.success(`Follow-Up schedule offset updated to ${validFollowUpDays} days!`);
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSavingFollowUp(false);
    }
  };

  // Save Session Policy
  const handleSaveSession = async () => {
    setSavingSession(true);
    try {
      await setDoc(
        doc(db, "system", "status"),
        {
          sessionTimeoutEnabled,
          sessionTimeoutDuration: Number(sessionTimeoutDuration),
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      logUserActivity(userProfile?.email, {
        desc: `Updated session policy: timeout ${sessionTimeoutDuration} mins (${sessionTimeoutEnabled ? "Enabled" : "Disabled"})`,
        type: "settings",
      });
      toast.success("Session security policy updated across all terminals!");
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSavingSession(false);
    }
  };

  // Save Maintenance Policy
  const handleSaveMaintenance = async () => {
    if (!isMasterAdmin) {
      toast.error("Only Master Admins have authorization to toggle global maintenance.");
      return;
    }

    setSavingMaintenance(true);
    try {
      await setDoc(
        doc(db, "system", "status"),
        {
          maintenanceMode,
          maintenanceMessage: maintenanceMessage.trim(),
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      logUserActivity(userProfile?.email, {
        desc: `Toggled Global Maintenance Mode: ${maintenanceMode ? "ENABLED" : "DISABLED"}`,
        type: "settings",
      });
      if (maintenanceMode) {
        toast.warning("Global maintenance enabled! All standard agents have been signed out.");
      } else {
        toast.success("Maintenance mode disabled. System open for all agents.");
      }
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSavingMaintenance(false);
    }
  };

  // Helper to map icon name to component
  const getPageIcon = (iconName: string) => {
    switch (iconName) {
      case "Home":
        return Home;
      case "Folder":
        return Folder;
      case "HelpCircle":
        return HelpCircle;
      case "Building2":
        return Building2;
      case "GraduationCap":
        return GraduationCap;
      case "Gamepad2":
        return Gamepad2;
      case "Users":
        return Users;
      case "CalendarCheck":
        return CalendarCheck;
      case "CalendarClock":
        return CalendarClock;
      case "UserCheck":
        return UserCheck;
      case "Stethoscope":
        return Stethoscope;
      case "Pill":
        return Pill;
      case "Database":
        return Database;
      case "Flag":
        return Flag;
      case "User":
        return User;
      case "PieChart":
        return PieChart;
      case "Edit":
        return Edit;
      case "FileSpreadsheet":
        return FileSpreadsheet;
      case "Users2":
        return Users2;
      case "Bell":
        return Bell;
      case "ClipboardCheck":
        return ClipboardCheck;
      case "Settings":
        return Settings;
      default:
        return KeyRound;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">System Settings</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Settings Navigation Sidebar (Narrower width for larger right panel) */}
        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-3xl p-3 sm:p-4 shadow-xs space-y-1 select-none">
          <button
            onClick={() => setActiveTab("facility")}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "facility"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-3">
              <Building2 className="w-4 h-4 shrink-0" />
              <span>Facility Availability</span>
            </div>
            {facilityCounts.offline > 0 && (
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                  activeTab === "facility" ? "bg-white/20 text-white" : "bg-rose-100 text-rose-700"
                }`}
              >
                {facilityCounts.offline} off
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("privacy")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "privacy"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <EyeOff className="w-4 h-4 shrink-0" />
            <span>Mask IP Info</span>
          </button>

          <button
            onClick={() => setActiveTab("access")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "access"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Page Access Control</span>
          </button>

          <button
            onClick={() => setActiveTab("logs")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "logs"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <History className="w-4 h-4 shrink-0" />
            <span>System Logs & Audit</span>
          </button>

          <button
            onClick={() => setActiveTab("deleted")}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "deleted"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-3">
              <ArchiveRestore className="w-4 h-4 shrink-0" />
              <span>Recently Deleted</span>
            </div>
            {deletedCounts.total > 0 && (
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                  activeTab === "deleted" ? "bg-white/20 text-white" : "bg-rose-100 text-rose-700"
                }`}
              >
                {deletedCounts.total}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("session")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "session"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Clock className="w-4 h-4 shrink-0" />
            <span>Session Timeout Policy</span>
          </button>

          <button
            onClick={() => setActiveTab("maintenance")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "maintenance"
                ? "bg-rose-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Wrench className="w-4 h-4 shrink-0" />
            <span>Global Maintenance Mode</span>
          </button>
        </div>

        {/* Settings Panel Content Area (Larger & Expansive width) */}
        <div className="lg:col-span-9 bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs min-w-0">
          {/* ----------------------------------------------------
              TAB: FACILITY AVAILABILITY & FORWARDING CONTROL
              ---------------------------------------------------- */}
          {activeTab === "facility" && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-blue-600" />
                    <span>Facility Booking & Forwarding Availability</span>
                  </h2>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleSaveFacilityAvailability}
                    disabled={savingFacilities}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {savingFacilities ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>Save Facility Status</span>
                  </button>
                </div>
              </div>

              {/* Quick Status Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-slate-500 font-semibold block">Total Registered</span>
                    <span className="text-lg font-black text-slate-900">{facilityCounts.total} Facilities</span>
                  </div>
                  <Building2 className="w-5 h-5 text-slate-400" />
                </div>

                <div className="p-3.5 rounded-2xl bg-emerald-50/60 border border-emerald-100 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-emerald-700 font-semibold block">Accepting Now</span>
                    <span className="text-lg font-black text-emerald-700">{facilityCounts.accepting} Active</span>
                  </div>
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                </div>

                <div className="p-3.5 rounded-2xl bg-rose-50/60 border border-rose-100 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-rose-700 font-semibold block">Suspended / Offline</span>
                    <span className="text-lg font-black text-rose-700">{facilityCounts.offline} Disabled</span>
                  </div>
                  <Ban className="w-5 h-5 text-rose-500" />
                </div>
              </div>

              {/* Filter and Search Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <div className="relative flex-1 w-full">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={facilitySearch}
                    onChange={(e) => setFacilitySearch(e.target.value)}
                    placeholder="Search facility by name, district, or PIN code..."
                    className="w-full pl-9 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                  {facilitySearch && (
                    <button
                      onClick={() => setFacilitySearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <select
                    value={facilityTypeFilter}
                    onChange={(e) => setFacilityTypeFilter(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  >
                    <option value="all">All Types</option>
                    <option value="dispensary">ESIS Dispensaries</option>
                    <option value="esic_hospital">ESIC Hospitals</option>
                    <option value="tie_up">Tie-Up Hospitals</option>
                    <option value="govt">Govt District Hospitals</option>
                  </select>

                  <select
                    value={facilityStatusFilter}
                    onChange={(e) => setFacilityStatusFilter(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  >
                    <option value="all">All Status</option>
                    <option value="accepting">Accepting Only</option>
                    <option value="offline">Offline Only</option>
                  </select>
                </div>
              </div>

              {/* Bulk Action Buttons */}
              <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                <span>Showing {filteredFacilities.length} facilities</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleBulkSetAvailability(true)}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                  >
                    Enable All
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => handleBulkSetAvailability(false)}
                    className="text-[11px] font-semibold text-rose-600 hover:text-rose-800 hover:underline cursor-pointer"
                  >
                    Disable All
                  </button>
                </div>
              </div>

              {/* Facility Cards List */}
              <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto pr-1">
                {filteredFacilities.map((facility) => {
                  const isAccepting = isFacilityAccepting(facility, availabilityMap);

                  return (
                    <div
                      key={facility.id || facility.name}
                      className="py-3.5 flex items-center justify-between gap-4 transition hover:bg-slate-50/50 rounded-xl px-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-xs text-slate-900 truncate">
                            {facility.name}
                          </span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                            {facility.facility_type || facility.type || "Dispensary"}
                          </span>
                          {isAccepting ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                              ACCEPTING
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                              OFFLINE / SUSPENDED
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`text-[11px] font-semibold ${isAccepting ? "text-emerald-600" : "text-rose-600"}`}>
                          {isAccepting ? "Accepting" : "Not Accepting"}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleToggleFacility(facility)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            isAccepting ? "bg-blue-600" : "bg-slate-200"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                              isAccepting ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ----------------------------------------------------
              TAB 0: MASK IP INFO (PRIVACY)
              ---------------------------------------------------- */}
          {activeTab === "privacy" && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <EyeOff className="w-5 h-5 text-blue-600" />
                  <span>Mask IP Info (Privacy & Data Protection)</span>
                </h3>
              </div>

              <div className="space-y-5">
                {/* 1. Mask IP Info Toggle Card & Save Button */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1 max-w-lg">
                      <h4 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-2">
                        <span>Enable IP Info Masking</span>
                        {maskIpInfo ? (
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                            ACTIVE
                          </span>
                        ) : (
                          <span className="bg-slate-200 text-slate-600 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                            DISABLED
                          </span>
                        )}
                      </h4>
                    </div>

                    <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                      <input
                        type="checkbox"
                        checked={maskIpInfo}
                        onChange={(e) => setMaskIpInfo(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-12 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  <div className="pt-3 border-t border-slate-200/60 flex justify-end">
                    <button
                      onClick={handleSaveMaskIp}
                      disabled={savingMaskIp}
                      className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
                    >
                      <Save className="w-4 h-4" />
                      <span>{savingMaskIp ? "Saving Mask IP Policy..." : "Save Mask IP Policy"}</span>
                    </button>
                  </div>
                </div>

                {/* 2. Follow-Up Days Card & Save Button */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1 max-w-lg">
                      <h4 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-500" />
                        <span>Follow-Up Schedule Offset</span>
                        <span className="bg-amber-100 text-amber-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                          {followUpDays} DAYS
                        </span>
                      </h4>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={followUpDays}
                        onChange={(e) => setFollowUpDays(Math.max(1, Number(e.target.value)))}
                        className="w-24 px-3 py-2 text-xs border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-bold bg-white text-slate-900"
                      />
                      <span className="text-xs text-slate-600 font-semibold">days</span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-200/60 flex justify-end">
                    <button
                      onClick={handleSaveFollowUp}
                      disabled={savingFollowUp}
                      className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
                    >
                      <Save className="w-4 h-4" />
                      <span>{savingFollowUp ? "Saving Schedule..." : "Save Follow-Up Schedule"}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* ----------------------------------------------------
              TAB: SYSTEM LOGS (AUDIT TRAIL)
              ---------------------------------------------------- */}
          {activeTab === "logs" && (
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Header */}
              <div className="border-b border-slate-100 pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <History className="w-5 h-5 text-blue-600" />
                      <span>System Activity & Audit Logs</span>
                    </h3>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {selectedLogIds.size > 0 && (
                      <button
                        type="button"
                        onClick={handleDeleteBulkLogs}
                        disabled={isDeletingLogs}
                        className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                      >
                        {isDeletingLogs ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>Delete Selected ({selectedLogIds.size})</span>
                      </button>
                    )}
                    <span className="px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full font-bold text-xs flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                      <span>Live Sync (3rd Account DB)</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Filters & Search Toolbar */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  {/* Search Input */}
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={systemLogsSearch}
                      onChange={(e) => setSystemLogsSearch(e.target.value)}
                      placeholder="Search logs by user, email, action or description..."
                      className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs font-medium"
                    />
                    {systemLogsSearch && (
                      <button
                        onClick={() => setSystemLogsSearch("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Log Type Filter Pills */}
                  <div className="flex items-center gap-1 overflow-x-auto no-scrollbar shrink-0">
                    {[
                      { id: "all", label: "All Actions" },
                      { id: "add", label: "➕ Add" },
                      { id: "edit", label: "✏️ Edit" },
                      { id: "delete", label: "🗑️ Delete" },
                      { id: "booking", label: "📅 Booking" },
                      { id: "report", label: "🚩 Report" },
                      { id: "settings", label: "⚙️ Settings" },
                      { id: "auth", label: "🔐 Login" },
                    ].map((pill) => (
                      <button
                        key={pill.id}
                        onClick={() => setSystemLogsTypeFilter(pill.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap cursor-pointer ${
                          systemLogsTypeFilter === pill.id
                            ? "bg-slate-900 text-white shadow-xs"
                            : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {pill.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Logs Count & Live Indicator */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
                <span className="text-xs text-slate-500 font-medium">
                  Showing{" "}
                  <strong className="text-slate-800">
                    {filteredSystemLogs.length === 0
                      ? 0
                      : `${(logsCurrentPage - 1) * logsPerPage + 1} - ${Math.min(
                          logsCurrentPage * logsPerPage,
                          filteredSystemLogs.length
                        )}`}
                  </strong>{" "}
                  of <strong className="text-slate-800">{filteredSystemLogs.length}</strong> activity logs
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  IndexedDB Local Cache • Ultra-Low Reads (50 per page)
                </span>
              </div>

              {/* System Activity Logs Table */}
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                      <th className="p-3.5 pl-4 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={selectedLogIds.size === paginatedSystemLogs.length && paginatedSystemLogs.length > 0}
                          onChange={handleToggleSelectAllLogs}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          title="Select All on page"
                        />
                      </th>
                      <th className="p-3.5">User</th>
                      <th className="p-3.5">Category</th>
                      <th className="p-3.5">Activity Description</th>
                      <th className="p-3.5 text-right">Timestamp</th>
                      <th className="p-3.5 pr-4 text-center w-14">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                    {loadingSystemLogs ? (
                      <tr>
                        <td colSpan={6} className="text-center py-16 text-slate-400 text-xs">
                          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                          <span>Loading system activity logs...</span>
                        </td>
                      </tr>
                    ) : paginatedSystemLogs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-16 text-slate-400 text-xs">
                          <History className="w-8 h-8 opacity-30 mx-auto mb-2" />
                          <span>No system activity recorded matching your filters.</span>
                        </td>
                      </tr>
                    ) : (
                      paginatedSystemLogs.map((log) => {
                        const badge = getLogTypeBadge(log.type);
                        const formattedTime = log.timestamp
                          ? new Date(log.timestamp).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })
                          : log.date || "—";

                        return (
                          <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                            {/* Checkbox */}
                            <td className="p-3.5 pl-4 text-center">
                              <input
                                type="checkbox"
                                checked={selectedLogIds.has(log.id)}
                                onChange={() => handleToggleSelectLog(log.id)}
                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                              />
                            </td>

                            {/* User Info */}
                            <td className="p-3.5 min-w-[160px]">
                              <div className="font-bold text-slate-900 leading-tight">
                                {log.userName || log.email.split("@")[0]}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono truncate max-w-[150px]">
                                {log.email}
                              </div>
                            </td>

                            {/* Category Badge */}
                            <td className="p-3.5 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[10px] font-extrabold border ${badge.bg}`}
                              >
                                {badge.label}
                              </span>
                            </td>

                            {/* Description */}
                            <td className="p-3.5 max-w-md">
                              <div className="text-slate-800 font-medium leading-relaxed">
                                {log.desc}
                              </div>
                            </td>

                            {/* Timestamp */}
                            <td className="p-3.5 text-right whitespace-nowrap text-slate-500 font-mono text-[11px]">
                              {formattedTime}
                            </td>

                            {/* Action */}
                            <td className="p-3.5 pr-4 text-center">
                              <button
                                type="button"
                                onClick={() => handleDeleteSingleLog(log)}
                                disabled={isDeletingLogs}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                                title="Delete log"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {filteredSystemLogs.length > logsPerPage && (
                <div className="flex items-center justify-between pt-2 px-1">
                  <button
                    onClick={() => setLogsCurrentPage((prev) => Math.max(prev - 1, 1))}
                    disabled={logsCurrentPage === 1}
                    className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white text-slate-700 font-bold text-xs rounded-xl shadow-2xs transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Previous</span>
                  </button>

                  <span className="text-xs font-semibold text-slate-600">
                    Page <strong className="text-slate-900">{logsCurrentPage}</strong> of{" "}
                    <strong className="text-slate-900">{logsTotalPages}</strong>
                  </span>

                  <button
                    onClick={() => setLogsCurrentPage((prev) => Math.min(prev + 1, logsTotalPages))}
                    disabled={logsCurrentPage >= logsTotalPages}
                    className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white text-slate-700 font-bold text-xs rounded-xl shadow-2xs transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ----------------------------------------------------
              TAB: RECENTLY DELETED (7-DAY HOLDING VAULT)
              ---------------------------------------------------- */}
          {activeTab === "deleted" && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                    <ArchiveRestore className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span>Recently Deleted Holding Vault</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200/60">
                        7-Day Auto Purge
                      </span>
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                  <button
                    type="button"
                    onClick={loadDeletedItems}
                    disabled={deletedLoading}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title="Refresh Recently Deleted"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${deletedLoading ? "animate-spin" : ""}`} />
                    <span>Refresh</span>
                  </button>

                  {deletedItems.length > 0 && (
                    <button
                      type="button"
                      onClick={handleEmptyBin}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer active:scale-95"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Empty Bin</span>
                    </button>
                  )}
                </div>
              </div>

              {/* KPI Summary Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <button
                  type="button"
                  onClick={() => setDeletedTypeFilter("all")}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    deletedTypeFilter === "all"
                      ? "bg-blue-50/70 border-blue-200 text-blue-900 shadow-2xs"
                      : "bg-slate-50/50 border-slate-200/70 text-slate-700 hover:bg-slate-100/60"
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">All Items</div>
                  <div className="text-xl font-extrabold mt-0.5">{deletedCounts.total}</div>
                </button>

                <button
                  type="button"
                  onClick={() => setDeletedTypeFilter("appointment")}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    deletedTypeFilter === "appointment"
                      ? "bg-emerald-50/70 border-emerald-200 text-emerald-900 shadow-2xs"
                      : "bg-slate-50/50 border-slate-200/70 text-slate-700 hover:bg-slate-100/60"
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Appointments</div>
                  <div className="text-xl font-extrabold mt-0.5 text-emerald-700">{deletedCounts.appointment}</div>
                </button>

                <button
                  type="button"
                  onClick={() => setDeletedTypeFilter("case")}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    deletedTypeFilter === "case"
                      ? "bg-indigo-50/70 border-indigo-200 text-indigo-900 shadow-2xs"
                      : "bg-slate-50/50 border-slate-200/70 text-slate-700 hover:bg-slate-100/60"
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cases</div>
                  <div className="text-xl font-extrabold mt-0.5 text-indigo-700">{deletedCounts.case}</div>
                </button>

                <button
                  type="button"
                  onClick={() => setDeletedTypeFilter("user")}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    deletedTypeFilter === "user"
                      ? "bg-purple-50/70 border-purple-200 text-purple-900 shadow-2xs"
                      : "bg-slate-50/50 border-slate-200/70 text-slate-700 hover:bg-slate-100/60"
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Users & Team</div>
                  <div className="text-xl font-extrabold mt-0.5 text-purple-700">{deletedCounts.user}</div>
                </button>

                <button
                  type="button"
                  onClick={() => setDeletedTypeFilter("log")}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    deletedTypeFilter === "log"
                      ? "bg-amber-50/70 border-amber-200 text-amber-900 shadow-2xs"
                      : "bg-slate-50/50 border-slate-200/70 text-slate-700 hover:bg-slate-100/60"
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Audit Logs</div>
                  <div className="text-xl font-extrabold mt-0.5 text-amber-700">{deletedCounts.log}</div>
                </button>
              </div>

              {/* Filter & Search Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={deletedSearch}
                    onChange={(e) => setDeletedSearch(e.target.value)}
                    placeholder="Search by patient, phone, ID, facility, or agent..."
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  />
                  {deletedSearch && (
                    <button
                      type="button"
                      onClick={() => setDeletedSearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={deletedTypeFilter}
                    onChange={(e) => setDeletedTypeFilter(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  >
                    <option value="all">All Types</option>
                    <option value="appointment">Appointments only</option>
                    <option value="case">Cases only</option>
                    <option value="user">Users only</option>
                    <option value="log">Audit Logs only</option>
                  </select>
                </div>
              </div>

              {/* Deleted Items List */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
                {deletedLoading ? (
                  <div className="py-16 text-center text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
                    <span className="text-xs">Loading deleted items...</span>
                  </div>
                ) : paginatedDeletedItems.length === 0 ? (
                  <div className="py-16 text-center space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                      <ArchiveRestore className="w-6 h-6" />
                    </div>
                    <div className="text-sm font-bold text-slate-700">No recently deleted items</div>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto">
                      {deletedSearch || deletedTypeFilter !== "all"
                        ? "No deleted items match your search or filter."
                        : "Any appointments, cases, users, or audit logs deleted by administrators will appear here for 7 days before permanent auto-purge."}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {paginatedDeletedItems.map((item) => {
                      const isExpired = Date.now() > Number(item.expiresAt || 0);
                      const expiryText = getExpiryRemainingText(item.expiresAt);

                      return (
                        <div
                          key={item.id}
                          className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 transition"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs text-slate-900">{item.title || item.originalId}</span>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                  item.itemType === "appointment"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : item.itemType === "case"
                                    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                                    : item.itemType === "user"
                                    ? "bg-purple-50 text-purple-700 border-purple-200"
                                    : "bg-amber-50 text-amber-700 border-amber-200"
                                }`}
                              >
                                {item.itemType?.toUpperCase()}
                              </span>
                              {item.originalId && (
                                <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                  {item.originalId}
                                </span>
                              )}
                            </div>

                            {item.subtitle && (
                              <p className="text-xs text-slate-600 truncate">{item.subtitle}</p>
                            )}

                            <div className="flex items-center gap-3 text-[11px] text-slate-400 flex-wrap">
                              <span>Deleted by: <strong className="text-slate-600">{item.deletedBy || "Administrator"}</strong></span>
                              <span>•</span>
                              <span>Deleted at: {formatISTTime(item.deletedTimestamp)}</span>
                              <span>•</span>
                              <span className={`font-semibold ${isExpired ? "text-rose-600 font-bold" : "text-amber-600"}`}>
                                {expiryText}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleRestoreItem(item)}
                              disabled={restoringId === item.id || isExpired}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
                              title="Restore to original position"
                            >
                              {restoringId === item.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3.5 h-3.5" />
                              )}
                              <span>Restore</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handlePermanentDelete(item)}
                              disabled={purgingId === item.id}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer"
                              title="Delete permanently"
                            >
                              {purgingId === item.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Pagination */}
              {!deletedLoading && filteredDeletedItems.length > DELETED_PER_PAGE && (
                <div className="flex items-center justify-between pt-2 px-1">
                  <button
                    onClick={() => setDeletedPage((p) => Math.max(1, p - 1))}
                    disabled={deletedPage === 1}
                    className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-slate-700 font-bold text-xs rounded-xl shadow-2xs transition cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Previous</span>
                  </button>
                  <span className="text-xs font-semibold text-slate-600">
                    Page <strong className="text-slate-900">{deletedPage}</strong> of{" "}
                    <strong className="text-slate-900">{totalDeletedPages}</strong>
                  </span>
                  <button
                    onClick={() => setDeletedPage((p) => Math.min(totalDeletedPages, p + 1))}
                    disabled={deletedPage >= totalDeletedPages}
                    className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-slate-700 font-bold text-xs rounded-xl shadow-2xs transition cursor-pointer"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ----------------------------------------------------
              TAB 1: PAGE ACCESS CONTROL (NEW FEATURE!)
              ---------------------------------------------------- */}
          {activeTab === "access" && (
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Header */}
              <div className="border-b border-slate-100 pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-blue-600" />
                      <span>User Page Access Permissions</span>
                    </h3>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    <span className="bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Shield className="w-3 h-3 text-indigo-600" />
                      <span>Master Admin = Always Unrestricted</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* User Selector & Search Filter Bar */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-blue-600" />
                    <span>Select User to Configure Permissions:</span>
                  </div>

                  {/* Role filter pills */}
                  <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-2xs">
                    {(["all", "Agent", "Dispensary Staff", "Admin", "Master Admin"] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => handleRoleFilterChange(r)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                          userRoleFilter === r
                            ? "bg-blue-600 text-white shadow-xs"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {r === "all" ? "All Users" : r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dropdown Selector + Search */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  <div className="md:col-span-7">
                    <select
                      value={selectedUserEmail.toLowerCase()}
                      onChange={(e) => handleSelectUser(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 shadow-2xs cursor-pointer"
                    >
                      {filteredUsers.length === 0 ? (
                        <option value="">No matching users found</option>
                      ) : (
                        filteredUsers.map((u) => (
                          <option key={u.email} value={u.email.toLowerCase()}>
                            {u.displayName || u.name || u.email} ({u.role}) — {u.email}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="md:col-span-5 relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={userSearchTerm}
                      onChange={(e) => setUserSearchTerm(e.target.value)}
                      placeholder="Search user by name or email..."
                      className="w-full pl-8 pr-7 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:border-blue-500 shadow-2xs"
                    />
                    {userSearchTerm && (
                      <button
                        onClick={() => setUserSearchTerm("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Selected User Profile Summary Banner */}
              {selectedUser && (
                <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-sm text-white shadow-xs ${
                        isSelectedMasterAdmin
                          ? "bg-gradient-to-br from-indigo-500 to-purple-600"
                          : selectedUser.role === "Admin"
                          ? "bg-gradient-to-br from-blue-500 to-sky-600"
                          : selectedUser.role === "Dispensary Staff" || selectedUser.role === "Dispensary"
                          ? "bg-gradient-to-br from-teal-500 to-emerald-600"
                          : "bg-gradient-to-br from-emerald-500 to-teal-600"
                      }`}
                    >
                      {(selectedUser.displayName || selectedUser.email || "U")
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-extrabold text-slate-900 text-sm">
                          {selectedUser.displayName || selectedUser.name || selectedUser.email}
                        </h4>
                        <span
                          className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                            isSelectedMasterAdmin
                              ? "bg-indigo-100 text-indigo-800 border border-indigo-300"
                              : selectedUser.role === "Admin"
                              ? "bg-blue-100 text-blue-800 border border-blue-300"
                              : selectedUser.role === "Dispensary Staff" || selectedUser.role === "Dispensary"
                              ? "bg-teal-100 text-teal-800 border border-teal-300"
                              : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          }`}
                        >
                          {selectedUser.role === "Dispensary" ? "Dispensary Staff" : selectedUser.role}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">
                        {selectedUser.email}
                      </p>
                    </div>
                  </div>

                  {/* Summary Access Stats */}
                  <div className="flex items-center gap-2">
                    {isSelectedMasterAdmin ? (
                      <span className="bg-indigo-50 text-indigo-800 border border-indigo-200 text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-indigo-600" />
                        <span>All Pages Allowed (Unrestricted)</span>
                      </span>
                    ) : selectedRestrictedPages.length === 0 ? (
                      <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>All {applicablePages.length} Pages Allowed</span>
                      </span>
                    ) : (
                      <span className="bg-rose-50 text-rose-800 border border-rose-200 text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-rose-600" />
                        <span>
                          {selectedRestrictedPages.length} of {applicablePages.length} Pages Restricted
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Master Admin Notice Banner if selected */}
              {isSelectedMasterAdmin && (
                <div className="bg-indigo-50 border border-indigo-200/80 rounded-2xl p-4 flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-indigo-950">
                    <p className="font-bold">
                      Master Administrator — Permanent Unrestricted Global Access
                    </p>
                  </div>
                </div>
              )}

              {/* Quick Actions Toolbar */}
              {!isSelectedMasterAdmin && (
                <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleAllowAllPages}
                      className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      <span>Allow All</span>
                    </button>
                    <button
                      onClick={handleRestrictAllPages}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Restrict All</span>
                    </button>
                    <button
                      onClick={handleResetToDefault}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset to Default</span>
                    </button>
                  </div>

                  <span className="text-[11px] text-slate-400 font-medium">
                    Toggle switch ON to allow access, OFF to lock page.
                  </span>
                </div>
              )}

              {/* Page Permissions Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {applicablePages.map((page) => {
                  const PageIcon = getPageIcon(page.iconName);
                  const isRestricted = selectedRestrictedPages.includes(page.path);
                  const isAllowed = isSelectedMasterAdmin || !isRestricted;

                  return (
                    <div
                      key={page.path}
                      onClick={() => !isSelectedMasterAdmin && handleTogglePagePermission(page.path)}
                      className={`p-4 rounded-2xl border transition-all select-none flex items-start justify-between gap-3.5 ${
                        isSelectedMasterAdmin
                          ? "bg-slate-50/70 border-slate-200 opacity-90 cursor-default"
                          : isAllowed
                          ? "bg-white border-slate-200/90 hover:border-blue-300 hover:shadow-2xs cursor-pointer"
                          : "bg-rose-50/40 border-rose-200/90 hover:border-rose-300 cursor-pointer"
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                            isAllowed
                              ? "bg-blue-50 text-blue-600 border border-blue-100"
                              : "bg-rose-100 text-rose-600 border border-rose-200"
                          }`}
                        >
                          <PageIcon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h4
                              className={`font-bold text-xs truncate ${
                                isAllowed ? "text-slate-900" : "text-rose-950 font-extrabold"
                              }`}
                            >
                              {page.label}
                            </h4>
                          </div>
                          <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5 leading-tight">
                            {page.description}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span className="font-mono text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded">
                              {page.path}
                            </span>
                            {isAllowed ? (
                              <span className="bg-emerald-50 text-emerald-700 text-[10px] font-black px-1.5 py-0.2 rounded border border-emerald-200 inline-flex items-center gap-1">
                                <Unlock className="w-2.5 h-2.5" />
                                <span>ALLOWED</span>
                              </span>
                            ) : (
                              <span className="bg-rose-100 text-rose-800 text-[10px] font-black px-1.5 py-0.2 rounded border border-rose-300 inline-flex items-center gap-1">
                                <Lock className="w-2.5 h-2.5" />
                                <span>LOCKED</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* iOS Style Permission Toggle */}
                      <div className="shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isAllowed}
                            disabled={isSelectedMasterAdmin}
                            onChange={() => handleTogglePagePermission(page.path)}
                            className="sr-only peer"
                          />
                          <div
                            className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all ${
                              isSelectedMasterAdmin
                                ? "peer-checked:bg-indigo-600 opacity-60 cursor-not-allowed"
                                : "peer-checked:bg-emerald-600"
                            }`}
                          ></div>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bottom Save Action Bar */}
              <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-xs text-slate-500 font-medium">
                  {selectedUser && (
                    <span>
                      Modifying permissions for:{" "}
                      <strong className="text-slate-800">
                        {selectedUser.displayName || selectedUser.email}
                      </strong>
                    </span>
                  )}
                </div>

                <button
                  onClick={handleSavePageAccess}
                  disabled={savingAccess || isSelectedMasterAdmin}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>
                    {savingAccess ? "Saving Permissions..." : "Save Page Permissions"}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------
              TAB 2: SESSION TIMEOUT
              ---------------------------------------------------- */}
          {activeTab === "session" && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-slate-900">Inactivity Timeout Policy</h3>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Enable Inactivity Auto-Logout</h4>
                  </div>
                  <input
                    type="checkbox"
                    checked={sessionTimeoutEnabled}
                    onChange={(e) => setSessionTimeoutEnabled(e.target.checked)}
                    className="w-5 h-5 text-blue-600 rounded"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Timeout Inactivity Interval
                  </label>
                  <select
                    value={sessionTimeoutDuration}
                    disabled={!sessionTimeoutEnabled}
                    onChange={(e) => setSessionTimeoutDuration(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-800 disabled:opacity-50"
                  >
                    <option value={1}>1 Minute (Testing Mode)</option>
                    <option value={15}>15 Minutes</option>
                    <option value={30}>30 Minutes (Recommended)</option>
                    <option value={60}>1 Hour</option>
                    <option value={240}>4 Hours</option>
                  </select>
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={handleSaveSession}
                    disabled={savingSession}
                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    <span>{savingSession ? "Saving Policy..." : "Update Session Policy"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------
              TAB 3: MAINTENANCE MODE
              ---------------------------------------------------- */}
          {activeTab === "maintenance" && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-rose-700 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  <span>Global Maintenance Mode</span>
                </h3>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-rose-50 border border-rose-200 rounded-2xl">
                  <div>
                    <h4 className="text-xs font-bold text-rose-900">Enable Maintenance Mode</h4>
                  </div>
                  <input
                    type="checkbox"
                    checked={maintenanceMode}
                    onChange={(e) => setMaintenanceMode(e.target.checked)}
                    className="w-5 h-5 text-rose-600 rounded"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Custom Maintenance Announcement
                  </label>
                  <textarea
                    value={maintenanceMessage}
                    onChange={(e) => setMaintenanceMessage(e.target.value)}
                    rows={4}
                    placeholder="e.g. Scheduled database maintenance in progress..."
                    className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-rose-500 leading-relaxed font-sans"
                  />
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={handleSaveMaintenance}
                    disabled={savingMaintenance}
                    className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    <span>{savingMaintenance ? "Applying Rules..." : "Apply Maintenance Rules"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
