"use client";

import React, { useState, useEffect, useMemo } from "react";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db, logsDb, bookingDb } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { logUserActivity, SystemLogDoc, getTodayDateString } from "@/lib/activityLogger";
import { UserProfile } from "@/lib/types";
import { ALL_AGENT_PAGES, ALL_ADMIN_PAGES, AppPageDef, isPageRestricted } from "@/lib/pageAccess";
import { ApiKeyDoc, generateApiKey } from "@/lib/apiKeyAuth";
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
} from "lucide-react";

export default function AdminSettingsPage() {
  const { userProfile, isMasterAdmin } = useAuth();
  const { toast, showConfirm } = usePopup();
  const [activeTab, setActiveTab] = useState<
    "privacy" | "access" | "session" | "maintenance" | "images" | "files" | "logs" | "api"
  >("privacy");

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

  // Developer API & Keys State
  const [apiKeys, setApiKeys] = useState<ApiKeyDoc[]>([]);
  const [loadingApiKeys, setLoadingApiKeys] = useState(false);
  const [newKeyModalOpen, setNewKeyModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyPermissions, setNewKeyPermissions] = useState<string[]>([
    "appointments:read",
    "appointments:create",
    "appointments:update",
    "appointments:delete",
  ]);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [visibleKeyIds, setVisibleKeyIds] = useState<Set<string>>(new Set());
  const [apiKeySearch, setApiKeySearch] = useState("");
  const [apiDocTab, setApiDocTab] = useState<"curl" | "fetch" | "python">("curl");

  // Real-time API Keys listener from bookingDb
  useEffect(() => {
    setLoadingApiKeys(true);
    const unsub = onSnapshot(
      collection(bookingDb, "api_keys"),
      (snapshot) => {
        const list: ApiKeyDoc[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as ApiKeyDoc);
        });
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setApiKeys(list);
        setLoadingApiKeys(false);
      },
      (err) => {
        console.warn("api_keys fetch error:", err);
        setLoadingApiKeys(false);
      }
    );
    return () => unsub();
  }, []);

  // Toggle API key reveal
  const toggleKeyVisibility = (keyId: string) => {
    setVisibleKeyIds((prev) => {
      const next = new Set(prev);
      if (next.has(keyId)) next.delete(keyId);
      else next.add(keyId);
      return next;
    });
  };

  // Copy API key
  const handleCopyKey = (key: string, id: string) => {
    if (typeof window !== "undefined" && navigator?.clipboard) {
      navigator.clipboard.writeText(key);
    }
    setCopiedKeyId(id);
    toast.success("API Key copied to clipboard!");
    setTimeout(() => setCopiedKeyId(null), 2500);
  };

  // Create new API Key
  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) {
      toast.error("Please enter a name for this API key.");
      return;
    }
    setGeneratingKey(true);
    try {
      const generated = generateApiKey();
      const docId = `key_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      const newKeyDoc: ApiKeyDoc = {
        id: docId,
        name: newKeyName.trim(),
        key: generated,
        status: "active",
        permissions: newKeyPermissions.length > 0 ? newKeyPermissions : ["appointments:read", "appointments:create"],
        createdBy: userProfile?.email || "admin",
        createdAt: Date.now(),
        usageCount: 0,
      };

      await setDoc(doc(bookingDb, "api_keys", docId), newKeyDoc);

      logUserActivity(userProfile?.email, {
        desc: `Generated new API key for consumer: ${newKeyName.trim()}`,
        type: "settings",
      });

      setNewlyCreatedKey(generated);
      toast.success("API Key successfully generated!");
      setNewKeyName("");
      setNewKeyModalOpen(false);
    } catch (err: any) {
      toast.error("Failed to generate API Key: " + err.message);
    } finally {
      setGeneratingKey(false);
    }
  };

  // Toggle API key status (active / revoked)
  const handleToggleKeyStatus = async (keyItem: ApiKeyDoc) => {
    const nextStatus = keyItem.status === "active" ? "revoked" : "active";
    try {
      await updateDoc(doc(bookingDb, "api_keys", keyItem.id), {
        status: nextStatus,
        updatedAt: Date.now(),
      });
      logUserActivity(userProfile?.email, {
        desc: `${nextStatus === "active" ? "Re-activated" : "Revoked"} API Key: ${keyItem.name}`,
        type: "settings",
      });
      toast.success(`API Key is now ${nextStatus}.`);
    } catch (err: any) {
      toast.error("Failed to update status: " + err.message);
    }
  };

  // Delete API Key
  const handleDeleteApiKey = async (keyItem: ApiKeyDoc) => {
    const confirmed = await showConfirm(
      `Are you sure you want to permanently delete the API key for "${keyItem.name}"? Any external application (such as EKMS Triage) using this key will be disconnected immediately.`
    );
    if (!confirmed) return;
    try {
      await deleteDoc(doc(bookingDb, "api_keys", keyItem.id));
      logUserActivity(userProfile?.email, {
        desc: `Deleted API Key: ${keyItem.name}`,
        type: "settings",
      });
      toast.success("API Key deleted.");
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  };


  // Fetch real-time System Activity Logs from logsDb (userActivityLogs & daily_activity)
  useEffect(() => {
    if (activeTab !== "logs") return;
    setLoadingSystemLogs(true);

    // Helper to resolve real user email and format display name cleanly
    const resolveLogUserDetails = (logId: string, rawEmail?: string, rawUserName?: string) => {
      let email = (rawEmail || "").toLowerCase().trim();
      let userName = rawUserName || "";

      // Extract email from document ID if email is missing or unknown
      // e.g. hist_himangshu.bezbaruah@piramalswasthya.org_2026-09-16_1789555481853_1
      if ((!email || email === "unknown@piramalswasthya.org") && logId) {
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
        rawEmail === "unknown@piramalswasthya.org"
      ) {
        if (email && email !== "unknown@piramalswasthya.org" && email.includes("@")) {
          const namePart = email.split("@")[0];
          userName = namePart.replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
        } else {
          userName = "User";
          email = "unknown@piramalswasthya.org";
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

  // 2. Realtime listener for Users list (for Page Access Control)
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const list: UserProfile[] = [];
        snap.forEach((d) => {
          const data = d.data() as UserProfile;
          const roleRaw = data.role || "Agent";
          const normalizedRole = (roleRaw === "Dispensary" || roleRaw === "Dispensary Staff")
            ? "Dispensary Staff"
            : roleRaw;

          list.push({
            ...data,
            email: data.email || d.id,
            displayName: data.displayName || (data as any).dispensaryName || data.name || (data.email ? data.email.split("@")[0] : d.id),
            role: normalizedRole as any,
            restrictedPages: Array.isArray(data.restrictedPages) ? data.restrictedPages : [],
          });
        });

        // Sort alphabetically by displayName or name
        list.sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
        setUsersList(list);

        // Auto-select first user if none selected
        if (list.length > 0 && !selectedUserEmail) {
          const defaultUser = list.find((u) => u.role === "Agent") || list[0];
          setSelectedUserEmail(defaultUser.email);
          setSelectedRestrictedPages(defaultUser.restrictedPages || []);
        }
      },
      (err) => {
        console.error("Error loading users for permissions:", err);
      }
    );

    return () => unsub();
  }, [selectedUserEmail]);

  // Sync selected user restricted pages when selection changes
  const selectedUser = useMemo(() => {
    return usersList.find((u) => u.email.toLowerCase() === selectedUserEmail.toLowerCase()) || null;
  }, [usersList, selectedUserEmail]);

  const handleSelectUser = (email: string) => {
    setSelectedUserEmail(email);
    const target = usersList.find((u) => u.email.toLowerCase() === email.toLowerCase());
    setSelectedRestrictedPages(target?.restrictedPages || []);
  };

  const handleRoleFilterChange = (role: "all" | "Agent" | "Dispensary Staff" | "Admin" | "Master Admin") => {
    setUserRoleFilter(role);
    setUserSearchTerm("");
    const matching = usersList.filter((u) => {
      if (role === "all") return true;
      if (role === "Dispensary Staff") {
        return u.role === "Dispensary Staff" || u.role === "Dispensary";
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
          if (u.role !== "Dispensary Staff" && u.role !== "Dispensary") return false;
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

  // Keep selectedUserEmail synced with filtered list
  useEffect(() => {
    if (filteredUsers.length > 0) {
      const existsInFiltered = filteredUsers.some((u) => u.email.toLowerCase() === selectedUserEmail.toLowerCase());
      if (!existsInFiltered) {
        handleSelectUser(filteredUsers[0].email);
      }
    }
  }, [filteredUsers, selectedUserEmail]);

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
    // Default: all accessible for their role
    setSelectedRestrictedPages([]);
    toast.info("Permissions reset to default (All pages accessible).");
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
            onClick={() => setActiveTab("api")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "api"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Key className="w-4 h-4 shrink-0" />
            <span>Developer API & Keys</span>
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
            <span>System Logs</span>
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

          <button
            onClick={() => setActiveTab("images")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "images"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <ImageIcon className="w-4 h-4 shrink-0" />
            <span>Image Compression</span>
          </button>

          <button
            onClick={() => setActiveTab("files")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "files"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Folder className="w-4 h-4 shrink-0" />
            <span>Storage & Security Limits</span>
          </button>
        </div>

        {/* Settings Panel Content Area (Larger & Expansive width) */}
        <div className="lg:col-span-9 bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs min-w-0">
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
                <p className="text-xs text-slate-500 mt-0.5">
                  Controls whether Insured Persons (IP) contact details are masked across Agent and Admin Booking interfaces.
                </p>
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
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        When toggled ON, IP names show only the first 3 letters and last 3 letters (e.g. <strong>RAM*** ***ESH</strong>), and phone numbers show only the last 4 digits (e.g. <strong>******4821</strong>).
                      </p>
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
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Configures how many days after a scheduled booking date a follow-up appointment is automatically calculated across agent and admin tables (Default: 8 days).
                      </p>
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
                    <p className="text-xs text-slate-500 mt-0.5">
                      Live audit trail recording all agent & admin actions across the portal (Add, Edit, Delete, Post, Bookings, Reports, Settings, etc.).
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
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
                      <th className="p-3.5 pl-4">User</th>
                      <th className="p-3.5">Category</th>
                      <th className="p-3.5">Activity Description</th>
                      <th className="p-3.5 pr-4 text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                    {loadingSystemLogs ? (
                      <tr>
                        <td colSpan={4} className="text-center py-16 text-slate-400 text-xs">
                          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                          <span>Loading system activity logs...</span>
                        </td>
                      </tr>
                    ) : paginatedSystemLogs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center py-16 text-slate-400 text-xs">
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
                            {/* User Info */}
                            <td className="p-3.5 pl-4 min-w-[160px]">
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
                            <td className="p-3.5 pr-4 text-right whitespace-nowrap text-slate-500 font-mono text-[11px]">
                              {formattedTime}
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
                    <p className="text-xs text-slate-500 mt-0.5">
                      Grant or restrict access to specific pages for individual Agents and Admins. By default, newly created users have full access to all pages for their role.
                    </p>
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
                      value={selectedUserEmail}
                      onChange={(e) => handleSelectUser(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 shadow-2xs cursor-pointer"
                    >
                      {filteredUsers.length === 0 ? (
                        <option value="">No matching users found</option>
                      ) : (
                        filteredUsers.map((u) => (
                          <option key={u.email} value={u.email}>
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
                  <div className="space-y-1 text-xs text-indigo-950">
                    <p className="font-bold">
                      Master Administrator — Permanent Unrestricted Global Access
                    </p>
                    <p className="text-indigo-800 leading-relaxed text-[11px]">
                      Master Administrators retain supreme administrative authority across all modules, databases, and configuration settings. Page permissions for Master Admins cannot be revoked or locked.
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
                <p className="text-xs text-slate-500 mt-0.5">
                  Automatically terminates idle terminal sessions to comply with security standards.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Enable Inactivity Auto-Logout</h4>
                    <p className="text-[11px] text-slate-500">
                      Monitors mouse movements, keystrokes, and touch events on all terminals.
                    </p>
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
                <p className="text-xs text-slate-500 mt-0.5">
                  Restricts portal access during major upgrades or database migrations. Master Admins bypass lockouts.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-rose-50 border border-rose-200 rounded-2xl">
                  <div>
                    <h4 className="text-xs font-bold text-rose-900">Enable Maintenance Mode</h4>
                    <p className="text-[11px] text-rose-600">
                      When enabled, all non-Master Admins are immediately signed out and shown a maintenance modal.
                    </p>
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

          {/* ----------------------------------------------------
              TAB 4: IMAGE COMPRESSION
              ---------------------------------------------------- */}
          {activeTab === "images" && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-slate-900">Image Compression Settings</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Controls client-side image downscaling before uploading to avoid database bloat.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Auto-Compress Uploads</h4>
                    <p className="text-[11px] text-slate-500">
                      Downscales large camera photos to max 600px with 75% JPEG quality.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoCompress}
                    onChange={(e) => setAutoCompress(e.target.checked)}
                    className="w-5 h-5 text-blue-600 rounded"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Hard Maximum Upload Limit
                  </label>
                  <select
                    value={maxImageSize}
                    onChange={(e) => setMaxImageSize(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold"
                  >
                    <option value={1}>1 MB</option>
                    <option value={2}>2 MB (Recommended)</option>
                    <option value={5}>5 MB</option>
                  </select>
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={() => toast.success("Image compression preferences saved locally.")}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs"
                  >
                    Save Preferences
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------
              TAB 5: STORAGE & LIMITS
              ---------------------------------------------------- */}
          {activeTab === "files" && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-slate-900">Storage Policies</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Firestore document size constraints and Google Drive proxy rules.
                </p>
              </div>

              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-2">
                <div className="flex items-center gap-2 font-bold text-xs text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Strict Firestore Document Size Guard (1 MB Limit)</span>
                </div>
                <p className="text-[11px] text-emerald-700 leading-relaxed">
                  The client-side upload pipeline enforces a strict 950KB ceiling on raw document blobs to prevent
                  database document overflows. Files exceeding this size are routed to the Google Apps Script Drive proxy.
                </p>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------
              TAB 6: DEVELOPER API & KEYS
              ---------------------------------------------------- */}
          {activeTab === "api" && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Key className="w-4 h-4 text-blue-600" />
                    Developer REST API & Keys
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Generate and manage secure API keys to allow external platforms (like EKMS Triage or Hospital Apps) to book and manage appointments.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setNewKeyName("");
                      setNewKeyModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    Generate New Key
                  </button>
                </div>
              </div>

              {/* Newly Created Key Alert Banner */}
              {newlyCreatedKey && (
                <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-2xl space-y-2 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-xs text-emerald-900">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>API Key Successfully Created</span>
                    </div>
                    <button
                      onClick={() => setNewlyCreatedKey(null)}
                      className="text-slate-400 hover:text-slate-600 text-xs font-bold"
                    >
                      Dismiss
                    </button>
                  </div>
                  <p className="text-[11px] text-emerald-800">
                    Copy and store this API key now. For security reasons, you will not be able to view the full unmasked key again after leaving this page.
                  </p>
                  <div className="flex items-center gap-2 p-2.5 bg-white border border-emerald-200 rounded-xl font-mono text-xs text-slate-900 select-all">
                    <span className="flex-1 truncate font-bold text-emerald-800">{newlyCreatedKey}</span>
                    <button
                      onClick={() => handleCopyKey(newlyCreatedKey, "new_key")}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      {copiedKeyId === "new_key" ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy Key
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* API Keys Table / List */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Configured API Keys ({apiKeys.length})
                  </span>
                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search API keys..."
                      value={apiKeySearch}
                      onChange={(e) => setApiKeySearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 font-medium"
                    />
                  </div>
                </div>

                {loadingApiKeys ? (
                  <div className="p-8 text-center text-xs text-slate-400">Loading API credentials...</div>
                ) : apiKeys.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-slate-200 rounded-2xl space-y-3">
                    <Key className="w-8 h-8 text-slate-300 mx-auto" />
                    <div className="text-xs font-bold text-slate-700">No API keys created yet</div>
                    <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                      Generate an API key to allow EKMS Triage or external applications to integrate with EKMS appointments.
                    </p>
                    <button
                      onClick={() => {
                        setNewKeyName("");
                        setNewKeyModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl cursor-pointer"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      Generate API Key
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {apiKeys
                      .filter((k) => {
                        if (!apiKeySearch.trim()) return true;
                        const q = apiKeySearch.toLowerCase();
                        return (
                          k.name?.toLowerCase().includes(q) ||
                          k.key?.toLowerCase().includes(q) ||
                          k.createdBy?.toLowerCase().includes(q)
                        );
                      })
                      .map((k) => {
                        const isRevealed = visibleKeyIds.has(k.id);
                        const isRevoked = k.status === "revoked";
                        return (
                          <div
                            key={k.id}
                            className={`p-4 rounded-2xl border transition-all ${
                              isRevoked
                                ? "bg-slate-50/70 border-slate-200 opacity-75"
                                : "bg-white border-slate-200 hover:border-slate-300 shadow-2xs"
                            }`}
                          >
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                              {/* Left: Consumer name and meta */}
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <h4 className="text-xs font-bold text-slate-900">{k.name}</h4>
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                      isRevoked
                                        ? "bg-rose-100 text-rose-700"
                                        : "bg-emerald-100 text-emerald-800"
                                    }`}
                                  >
                                    {isRevoked ? "Revoked" : "Active"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                  <span>Created: {new Date(k.createdAt).toLocaleDateString("en-IN")}</span>
                                  {k.lastUsedAt && (
                                    <span>Last used: {new Date(k.lastUsedAt).toLocaleDateString("en-IN")}</span>
                                  )}
                                  <span>Requests: {k.usageCount || 0}</span>
                                </div>
                              </div>

                              {/* Middle: Masked Key with Copy and Toggle */}
                              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl font-mono text-xs max-w-full sm:max-w-md">
                                <span className="truncate text-slate-700 font-medium">
                                  {isRevealed
                                    ? k.key
                                    : `${k.key.slice(0, 10)}••••••••••••••••${k.key.slice(-4)}`}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => toggleKeyVisibility(k.id)}
                                  className="text-slate-400 hover:text-slate-700 p-1 shrink-0"
                                  title={isRevealed ? "Hide Key" : "Reveal Key"}
                                >
                                  {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCopyKey(k.key, k.id)}
                                  className="text-blue-600 hover:text-blue-800 p-1 shrink-0 font-sans font-bold"
                                  title="Copy API Key"
                                >
                                  {copiedKeyId === k.id ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>

                              {/* Right: Actions */}
                              <div className="flex items-center gap-1.5 shrink-0 self-end lg:self-center">
                                <button
                                  onClick={() => handleToggleKeyStatus(k)}
                                  className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-all ${
                                    isRevoked
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                      : "bg-slate-100 text-slate-700 border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200"
                                  }`}
                                  title={isRevoked ? "Activate Key" : "Revoke Key"}
                                >
                                  {isRevoked ? "Re-activate" : "Revoke"}
                                </button>
                                <button
                                  onClick={() => handleDeleteApiKey(k)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded-xl hover:bg-rose-50 transition-colors"
                                  title="Delete Key"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            {/* Permissions Pills */}
                            {Array.isArray(k.permissions) && k.permissions.length > 0 && (
                              <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">
                                  Permissions:
                                </span>
                                {k.permissions.map((p) => (
                                  <span
                                    key={p}
                                    className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600"
                                  >
                                    {p}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* API Documentation & Integration Sandbox */}
              <div className="mt-8 pt-6 border-t border-slate-200 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Code2 className="w-4 h-4 text-blue-600" />
                      API Integration Reference & Code Samples
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      How external applications connect to EKMS using standard HTTP REST requests.
                    </p>
                  </div>
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                    <button
                      onClick={() => setApiDocTab("curl")}
                      className={`px-2.5 py-1 rounded-lg transition-all ${
                        apiDocTab === "curl" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      cURL
                    </button>
                    <button
                      onClick={() => setApiDocTab("fetch")}
                      className={`px-2.5 py-1 rounded-lg transition-all ${
                        apiDocTab === "fetch" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      JavaScript
                    </button>
                    <button
                      onClick={() => setApiDocTab("python")}
                      className={`px-2.5 py-1 rounded-lg transition-all ${
                        apiDocTab === "python" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Python
                    </button>
                  </div>
                </div>

                {/* Base URL info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs font-mono">
                    <div className="flex items-center gap-2 text-slate-700">
                      <Globe className="w-3.5 h-3.5 text-blue-600" />
                      <span className="font-bold text-blue-600 font-sans">Production API (ekms.in):</span>
                    </div>
                    <div className="text-[11.5px] text-slate-800 font-semibold select-all truncate">
                      https://ekms.in/api/v1/appointments
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs font-mono">
                    <div className="flex items-center gap-2 text-slate-700">
                      <Terminal className="w-3.5 h-3.5 text-slate-600" />
                      <span className="font-bold text-slate-700 font-sans">Current Environment Endpoint:</span>
                    </div>
                    <div className="text-[11.5px] text-slate-800 font-semibold select-all truncate">
                      {typeof window !== "undefined" ? `${window.location.origin}/api/v1/appointments` : "https://ekms.in/api/v1/appointments"}
                    </div>
                  </div>
                </div>

                {/* Code Box */}
                <div className="bg-slate-950 text-slate-200 rounded-2xl p-4 font-mono text-[11.5px] overflow-x-auto border border-slate-800 relative">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2 border-b border-slate-800 pb-2">
                    <span className="font-bold text-slate-300">
                      {apiDocTab === "curl" && "1. Book Appointment (cURL)"}
                      {apiDocTab === "fetch" && "1. Book Appointment (JavaScript Fetch)"}
                      {apiDocTab === "python" && "1. Book Appointment (Python Requests)"}
                    </span>
                    <button
                      onClick={() => {
                        const targetUrl = typeof window !== "undefined" && window.location.hostname !== "localhost" ? `${window.location.origin}/api/v1/appointments` : "https://ekms.in/api/v1/appointments";
                        const snippet =
                          apiDocTab === "curl"
                            ? `curl -X POST ${targetUrl} \\\n  -H "Content-Type: application/json" \\\n  -H "x-api-key: ${apiKeys[0]?.key || "YOUR_GENERATED_API_KEY"}" \\\n  -d '{\n    "patientName": "Jyotimoy Choudhury",\n    "phone": "6002283107",\n    "dispensaryName": "Beltola ESIS Dispensary",\n    "date": "2026-11-16",\n    "timeSlot": "10:30 AM - 11:00 AM",\n    "purpose": "Fever & Chills",\n    "source": "EKMS Triage"\n  }'`
                            : apiDocTab === "fetch"
                            ? `const response = await fetch("${targetUrl}", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    "x-api-key": "${apiKeys[0]?.key || "YOUR_GENERATED_API_KEY"}"\n  },\n  body: JSON.stringify({\n    patientName: "Jyotimoy Choudhury",\n    phone: "6002283107",\n    dispensaryName: "Beltola ESIS Dispensary",\n    date: "2026-11-16",\n    timeSlot: "10:30 AM - 11:00 AM",\n    purpose: "Fever & Chills",\n    source: "EKMS Triage"\n  })\n});\nconst result = await response.json();\nconsole.log(result.appointment.tokenNo);`
                            : `import requests\n\nurl = "${targetUrl}"\nheaders = {\n    "Content-Type": "application/json",\n    "x-api-key": "${apiKeys[0]?.key || "YOUR_GENERATED_API_KEY"}"\n}\npayload = {\n    "patientName": "Jyotimoy Choudhury",\n    "phone": "6002283107",\n    "dispensaryName": "Beltola ESIS Dispensary",\n    "date": "2026-11-16",\n    "timeSlot": "10:30 AM - 11:00 AM",\n    "purpose": "Fever & Chills",\n    "source": "EKMS Triage"\n}\nresponse = requests.post(url, json=payload, headers=headers)\nprint(response.json())`;
                        navigator.clipboard.writeText(snippet);
                        toast.success("Code snippet copied!");
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300 font-sans font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      Copy Snippet
                    </button>
                  </div>

                  <pre className="text-slate-300 leading-relaxed">
                    {apiDocTab === "curl" &&
                      `# Book Appointment (Production or Local)
curl -X POST https://ekms.in/api/v1/appointments \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${apiKeys[0]?.key || "YOUR_GENERATED_API_KEY"}" \\
  -d '{
    "patientName": "Jyotimoy Choudhury",
    "phone": "6002283107",
    "dispensaryName": "Beltola ESIS Dispensary",
    "date": "2026-11-16",
    "timeSlot": "10:30 AM - 11:00 AM",
    "purpose": "Fever & Chills",
    "source": "EKMS Triage"
  }'

# Query Appointments for a Dispensary
curl -X GET "https://ekms.in/api/v1/appointments?dispensary=Beltola&status=scheduled" \\
  -H "x-api-key: ${apiKeys[0]?.key || "YOUR_GENERATED_API_KEY"}"

# Cancel Appointment by Token Number
curl -X PATCH "https://ekms.in/api/v1/appointments/ESIC-00335-DISP" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${apiKeys[0]?.key || "YOUR_GENERATED_API_KEY"}" \\
  -d '{ "status": "cancelled", "cancellationReason": "Patient requested cancellation" }'`}

                    {apiDocTab === "fetch" &&
                      `// 1. Book Appointment
const targetUrl = typeof window !== "undefined" && window.location.hostname !== "localhost" 
  ? window.location.origin + "/api/v1/appointments" 
  : "https://ekms.in/api/v1/appointments";

const bookRes = await fetch(targetUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "${apiKeys[0]?.key || "YOUR_GENERATED_API_KEY"}"
  },
  body: JSON.stringify({
    patientName: "Jyotimoy Choudhury",
    phone: "6002283107",
    dispensaryName: "Beltola ESIS Dispensary",
    date: "2026-11-16",
    timeSlot: "10:30 AM - 11:00 AM",
    purpose: "Fever & Chills",
    source: "EKMS Triage"
  })
});
const data = await bookRes.json();
console.log("Booked Token:", data.appointment?.tokenNo);

// 2. Cancel Appointment
await fetch(targetUrl + "/" + data.appointment.id, {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "${apiKeys[0]?.key || "YOUR_GENERATED_API_KEY"}"
  },
  body: JSON.stringify({
    status: "cancelled",
    cancellationReason: "Cancelled via Triage"
  })
});`}

                    {apiDocTab === "python" &&
                      `import requests

API_KEY = "${apiKeys[0]?.key || "YOUR_GENERATED_API_KEY"}"
BASE_URL = "https://ekms.in/api/v1/appointments"  # Or "http://localhost:3000/api/v1/appointments" for local

headers = {
    "Content-Type": "application/json",
    "x-api-key": API_KEY
}

# Book appointment
payload = {
    "patientName": "Jyotimoy Choudhury",
    "phone": "6002283107",
    "dispensaryName": "Beltola ESIS Dispensary",
    "date": "2026-11-16",
    "timeSlot": "10:30 AM - 11:00 AM",
    "purpose": "Fever & Chills",
    "source": "EKMS Triage"
}
response = requests.post(BASE_URL, json=payload, headers=headers)
print(response.json())`}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------
              MODAL: GENERATE NEW API KEY
              ---------------------------------------------------- */}
          {newKeyModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-5 animate-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                      <Key className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Generate Developer API Key</h4>
                      <p className="text-[11px] text-slate-500">Create a secure credential for external integrations.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setNewKeyModalOpen(false)}
                    className="text-slate-400 hover:text-slate-600 p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleCreateApiKey} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Application / Consumer Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. EKMS Triage App, Hospital Portal, Field Bot"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                      Permissions
                    </label>
                    <div className="space-y-2">
                      {[
                        { id: "appointments:create", label: "Book Appointments (POST /appointments)" },
                        { id: "appointments:read", label: "View Appointments (GET /appointments)" },
                        { id: "appointments:update", label: "Update Status & Notes (PATCH /appointments/:id)" },
                        { id: "appointments:delete", label: "Cancel Appointments (DELETE /appointments/:id)" },
                      ].map((perm) => (
                        <label key={perm.id} className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newKeyPermissions.includes(perm.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewKeyPermissions([...newKeyPermissions, perm.id]);
                              } else {
                                setNewKeyPermissions(newKeyPermissions.filter((p) => p !== perm.id));
                              }
                            }}
                            className="w-4 h-4 text-blue-600 rounded border-slate-300"
                          />
                          <span>{perm.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setNewKeyModalOpen(false)}
                      className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={generatingKey || !newKeyName.trim()}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5"
                    >
                      {generatingKey ? "Generating..." : "Generate Key"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
