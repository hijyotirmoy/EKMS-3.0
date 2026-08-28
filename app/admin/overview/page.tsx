"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  collection,
  getCountFromServer,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getOrFetchCollection } from "@/lib/cache";
import { DailyActivityLog } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { logUserActivity } from "@/lib/activityLogger";
import {
  HelpCircle,
  Folder,
  Building2,
  Headphones,
  Shield,
  Crown,
  Gamepad2,
  MessageSquare,
  SearchX,
  Flag,
  GraduationCap,
  Calendar,
  Clock,
  ArrowLeft,
  User,
  CheckCircle2,
  Eye,
  FileDown,
  Activity,
  Download,
  CalendarCheck,
  Search,
  Lock,
  Unlock,
  ShieldCheck,
  AlertTriangle,
  X,
} from "lucide-react";

export default function AdminOverviewPage() {
  const { user } = useAuth();
  const { toast, showConfirm } = usePopup();
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);
  const [activityLogs, setActivityLogs] = useState<DailyActivityLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [filterOnlineOnly, setFilterOnlineOnly] = useState(false);

  // Quick Unlock Modal State
  const [quickUnlockModalOpen, setQuickUnlockModalOpen] = useState(false);
  const [quickUnlockEmail, setQuickUnlockEmail] = useState("");
  const [quickUnlockLoading, setQuickUnlockLoading] = useState(false);

  // Real-time security lock status map
  const [userLockMap, setUserLockMap] = useState<
    Record<
      string,
      {
        isLocked: boolean;
        failedAttempts: number;
        lockedUntil?: number;
        lockReason?: string;
        name?: string;
      }
    >
  >({});

  // Counters
  const [counts, setCounts] = useState({
    qa: 0,
    files: 0,
    facilities: 0,
    agents: 0,
    admins: 0,
    masters: 0,
    quizzes: 0,
    doubts: 0,
    missing: 0,
    reports: 0,
    courses: 0,
  });

  // Selected agent for drilldown report
  const [drilldownEmail, setDrilldownEmail] = useState<string | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownData, setDrilldownData] = useState<{
    profile: any;
    activity: DailyActivityLog | null;
  } | null>(null);
  const [agentReports, setAgentReports] = useState<any[]>([]);
  const [agentExtraStats, setAgentExtraStats] = useState({
    totalBookings: 0,
    doubtsCount: 0,
    coursesCompleted: 0,
    quizzesCompleted: 0,
    reportsCount: 0,
    dailyReportsCount: 0,
  });

  // 1. Fetch Counts for Cards
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [
          qaSnap,
          fileSnap,
          facSnap,
          userSnap,
          quizSnap,
          doubtSnap,
          missSnap,
          repSnap,
          courseSnap,
        ] = await Promise.all([
          getCountFromServer(collection(db, "qas")),
          getCountFromServer(collection(db, "files")),
          getCountFromServer(collection(db, "facilities")),
          getDocs(collection(db, "users")),
          getCountFromServer(collection(db, "quizzes")),
          getCountFromServer(collection(db, "doubts")),
          getCountFromServer(collection(db, "missing_searches")),
          getCountFromServer(collection(db, "reports")),
          getCountFromServer(collection(db, "onboardings")),
        ]);

        let agCount = 0;
        let adCount = 0;
        let maCount = 0;

        userSnap.forEach((d) => {
          const role = d.data().role;
          if (role === "Master Admin") maCount++;
          else if (role === "Admin") adCount++;
          else agCount++;
        });

        setCounts({
          qa: qaSnap.data().count,
          files: fileSnap.data().count,
          facilities: facSnap.data().count,
          agents: agCount,
          admins: adCount,
          masters: maCount,
          quizzes: quizSnap.data().count,
          doubts: doubtSnap.data().count,
          missing: missSnap.data().count,
          reports: repSnap.data().count,
          courses: courseSnap.data().count,
        });
      } catch (err) {
        console.error("Failed to load overview counts:", err);
      }
    };

    fetchCounts();
  }, []);

  // 2. Real-time Security Locks & Users Subscription & LocalStorage Scanner
  useEffect(() => {
    // Scan all local locks on this browser and sync to Firestore & userLockMap
    if (typeof window !== "undefined") {
      const localMap: Record<string, any> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith("ekms_lock_") || key.startsWith("ekms_sec_lock_"))) {
          const email = key.replace("ekms_lock_", "").replace("ekms_sec_lock_", "").toLowerCase();
          try {
            const raw = localStorage.getItem(key);
            if (raw) {
              const parsed = JSON.parse(raw);
              const now = Date.now();
              if (parsed.isLocked && (!parsed.lockedUntil || now < parsed.lockedUntil)) {
                localMap[email] = {
                  isLocked: true,
                  failedAttempts: parsed.failedAttempts || 5,
                  lockedUntil: parsed.lockedUntil,
                  lockReason: parsed.lockReason,
                  name: email.split("@")[0],
                };
                setDoc(doc(db, "security_locks", email), parsed, { merge: true }).catch(() => {});
                fetch("/api/auth/security-lock", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(parsed),
                }).catch(() => {});
              }
            }
          } catch (e) {}
        }
      }
      if (Object.keys(localMap).length > 0) {
        setUserLockMap((prev) => ({ ...prev, ...localMap }));
      }
    }

    const unsubLocks = onSnapshot(collection(db, "security_locks"), (snap) => {
      const lockMap: Record<
        string,
        {
          isLocked: boolean;
          failedAttempts: number;
          lockedUntil?: number;
          lockReason?: string;
          name?: string;
        }
      > = {};

      snap.forEach((dDoc) => {
        const d = dDoc.data();
        const email = (d.email || dDoc.id || "").toLowerCase();
        if (email) {
          const now = Date.now();
          const isActuallyLocked = !!d.isLocked && (!d.lockedUntil || now < d.lockedUntil);
          lockMap[email] = {
            isLocked: isActuallyLocked,
            failedAttempts: d.failedAttempts || 0,
            lockedUntil: d.lockedUntil,
            lockReason: d.lockReason,
            name: d.name || email.split("@")[0],
          };
        }
      });

      setUserLockMap((prev) => ({
        ...prev,
        ...lockMap,
      }));
    });

    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      const userLocks: Record<
        string,
        {
          isLocked: boolean;
          failedAttempts: number;
          lockedUntil?: number;
          lockReason?: string;
          name?: string;
        }
      > = {};

      snap.forEach((uDoc) => {
        const u = uDoc.data();
        const email = (u.email || uDoc.id || "").toLowerCase();
        if (email) {
          const now = Date.now();
          const isActuallyLocked = !!u.isLocked && (!u.lockedUntil || now < u.lockedUntil);
          userLocks[email] = {
            isLocked: isActuallyLocked,
            failedAttempts: u.failedAttempts || 0,
            lockedUntil: u.lockedUntil,
            lockReason: u.lockReason,
            name: u.displayName || u.name || email.split("@")[0],
          };
        }
      });

      setUserLockMap((prev) => {
        const merged = { ...prev };
        Object.entries(userLocks).forEach(([email, data]) => {
          if (!merged[email] || data.isLocked) {
            merged[email] = data;
          } else {
            merged[email] = {
              ...merged[email],
              name: data.name || merged[email].name,
            };
          }
        });
        return merged;
      });
    });

    return () => {
      unsubLocks();
      unsubUsers();
    };
  }, []);

  // 3. Instant Admin Unlock Account Action
  const handleUnlockAccount = async (targetEmail: string) => {
    const cleanEmail = targetEmail.toLowerCase();
    const confirmed = await showConfirm({
      title: "Unlock Agent Account?",
      message: `Are you sure you want to unlock the account for ${cleanEmail}? This will immediately reset failed attempts to 0 and allow the agent to log in.`,
      confirmText: "Unlock Account",
    });
    if (!confirmed) return;

    try {
      // 1. Call server API to unlock
      fetch("/api/auth/security-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, action: "unlock" }),
      }).catch(() => {});

      // 2. Direct Firestore unlock
      const unlockPayload = {
        isLocked: false,
        failedAttempts: 0,
        lockedUntil: null,
        lockReason: null,
      };

      await Promise.allSettled([
        setDoc(doc(db, "security_locks", cleanEmail), unlockPayload, { merge: true }),
        setDoc(doc(db, "users", cleanEmail), unlockPayload, { merge: true }),
      ]);

      if (typeof window !== "undefined") {
        localStorage.removeItem(`ekms_lock_${cleanEmail}`);
      }

      setUserLockMap((prev) => ({
        ...prev,
        [cleanEmail]: {
          ...prev[cleanEmail],
          isLocked: false,
          failedAttempts: 0,
          lockedUntil: undefined,
        },
      }));

      logUserActivity(user?.email || "admin", {
        desc: `Admin unlocked login access for agent: ${cleanEmail}`,
        type: "settings",
      });

      toast.success(`Account for ${cleanEmail} was unlocked successfully!`);
    } catch (e: any) {
      toast.error("Failed to unlock account: " + e.message);
    }
  };

  // 3b. Instant Admin Lock Account Action
  const handleLockAccount = async (targetEmail: string) => {
    const cleanEmail = targetEmail.toLowerCase();
    const confirmed = await showConfirm({
      title: "Lock Agent Account?",
      message: `Are you sure you want to lock the account for ${cleanEmail}? This user will not be able to log in to the application until unlocked by an administrator.`,
      isDestructive: true,
      confirmText: "Lock Account",
    });
    if (!confirmed) return;

    try {
      const lockExpiry = Date.now() + 365 * 24 * 3600 * 1000;
      const lockPayload = {
        email: cleanEmail,
        isLocked: true,
        failedAttempts: 5,
        lockedAt: Date.now(),
        lockedUntil: lockExpiry,
        lockReason: "Account locked by Administrator",
      };

      // 1. Call server API to lock
      fetch("/api/auth/security-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lockPayload),
      }).catch(() => {});

      // 2. Direct Firestore lock
      await Promise.allSettled([
        setDoc(doc(db, "security_locks", cleanEmail), lockPayload, { merge: true }),
        setDoc(doc(db, "users", cleanEmail), lockPayload, { merge: true }),
      ]);

      if (typeof window !== "undefined") {
        localStorage.setItem(`ekms_lock_${cleanEmail}`, JSON.stringify(lockPayload));
      }

      setUserLockMap((prev) => ({
        ...prev,
        [cleanEmail]: {
          ...prev[cleanEmail],
          isLocked: true,
          failedAttempts: 5,
          lockedUntil: lockExpiry,
          lockReason: "Account locked by Administrator",
        },
      }));

      logUserActivity(user?.email || "admin", {
        desc: `Admin locked login access for agent: ${cleanEmail}`,
        type: "settings",
      });

      toast.success(`Account for ${cleanEmail} has been locked.`);
    } catch (e: any) {
      toast.error("Failed to lock account: " + e.message);
    }
  };

  // 4. Fetch Daily Activity for Date & merge with Users collection
  useEffect(() => {
    setLoadingLogs(true);
    const q = query(collection(db, "daily_activity"), where("date", "==", dateFilter));

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const list: DailyActivityLog[] = [];
      const loggedEmails = new Set<string>();

      snapshot.forEach((d) => {
        const data = d.data() as Omit<DailyActivityLog, "id">;
        list.push({ id: d.id, ...data });
        if (data.email) loggedEmails.add(data.email.toLowerCase());
      });

      try {
        const usersSnap = await getDocs(collection(db, "users"));
        usersSnap.forEach((uDoc) => {
          const u = uDoc.data();
          const email = (u.email || uDoc.id || "").toLowerCase();
          if (!email) return;

          const isActuallyLocked =
            !!u.isLocked && (!u.lockedUntil || Date.now() < u.lockedUntil);

          if (!loggedEmails.has(email) && (u.lastLogin || isActuallyLocked)) {
            const loginDate = u.lastLogin ? new Date(u.lastLogin) : null;
            const localDateStr = loginDate
              ? `${loginDate.getFullYear()}-${String(loginDate.getMonth() + 1).padStart(2, "0")}-${String(loginDate.getDate()).padStart(2, "0")}`
              : null;
            const isoDateStr = loginDate ? loginDate.toISOString().split("T")[0] : null;

            if (localDateStr === dateFilter || isoDateStr === dateFilter || isActuallyLocked) {
              const totalSec = u.lastLogin
                ? Math.max(0, Math.floor(((u.lastActive || u.lastLogin) - u.lastLogin) / 1000))
                : 0;
              list.push({
                id: `${email}_${dateFilter}`,
                email,
                name: u.displayName || u.name || email.split("@")[0],
                date: dateFilter,
                loginTime: u.lastLogin,
                firstLogin: u.lastLogin,
                lastActive: u.lastActive || u.lastLogin,
                logoutTime: u.lastLogout,
                totalSeconds: totalSec,
              });
              loggedEmails.add(email);
            }
          }
        });
      } catch (err) {
        console.error("Error reading users for overview activity:", err);
      }

      list.sort((a, b) => (b.lastActive || b.loginTime || 0) - (a.lastActive || a.loginTime || 0));
      setActivityLogs(list);
      setLoadingLogs(false);
    });

    return () => unsubscribe();
  }, [dateFilter]);

  // Online agents count
  const onlineAgentsCount = useMemo(() => {
    return activityLogs.filter((log) => {
      const isLoggedOut = !!log.logoutTime && (!log.lastActive || log.logoutTime >= log.lastActive);
      return !isLoggedOut && log.lastActive && Date.now() - log.lastActive < 3 * 60 * 1000;
    }).length;
  }, [activityLogs]);

  // Displayed Logs with Online filter & Locked accounts included
  const displayedLogs = useMemo(() => {
    let list = [...activityLogs];
    const presentEmails = new Set(list.map((item) => item.email.toLowerCase()));

    // Merge any locked account from userLockMap that isn't in activityLogs yet
    Object.entries(userLockMap).forEach(([email, lockInfo]) => {
      if (lockInfo.isLocked && !presentEmails.has(email)) {
        list.push({
          id: `${email}_${dateFilter}`,
          email,
          name: lockInfo.name || email.split("@")[0],
          date: dateFilter,
          loginTime: undefined,
          firstLogin: undefined,
          lastActive: undefined,
          totalSeconds: 0,
        });
        presentEmails.add(email);
      }
    });

    if (filterOnlineOnly) {
      list = list.filter((log) => {
        const isLoggedOut = !!log.logoutTime && (!log.lastActive || log.logoutTime >= log.lastActive);
        return !isLoggedOut && log.lastActive && Date.now() - log.lastActive < 3 * 60 * 1000;
      });
    }

    // Sort locked accounts first, then by last active / login time
    list.sort((a, b) => {
      const aLocked = !!userLockMap[a.email.toLowerCase()]?.isLocked;
      const bLocked = !!userLockMap[b.email.toLowerCase()]?.isLocked;
      if (aLocked && !bLocked) return -1;
      if (!aLocked && bLocked) return 1;
      return (b.lastActive || b.loginTime || 0) - (a.lastActive || a.loginTime || 0);
    });

    return list;
  }, [activityLogs, userLockMap, filterOnlineOnly, dateFilter]);

  // Format active duration
  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return "0s";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  // Format time of day
  const formatTimeOnly = (timestamp?: number) => {
    if (!timestamp) return "-";
    try {
      return new Date(timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return "-";
    }
  };

  // 3. Drilldown report fetch with low Firestore reads (using getCountFromServer)
  const handleOpenDrilldown = async (email: string, targetDate?: string) => {
    const activeDate = targetDate || dateFilter;
    setDrilldownEmail(email);
    setDrilldownLoading(true);

    try {
      const cleanEmail = email.toLowerCase().trim();
      const [userSnap, activitySnap, doubtsCountSnap, reportsSnap] = await Promise.all([
        getDoc(doc(db, "users", cleanEmail)),
        getDoc(doc(db, "daily_activity", `${cleanEmail}_${activeDate}`)),
        getCountFromServer(query(collection(db, "doubts"), where("authorEmail", "==", cleanEmail))),
        getDocs(query(collection(db, "reports"), where("reporterEmail", "==", cleanEmail))),
      ]);

      const profile = userSnap.exists() ? userSnap.data() : null;
      const quizDone = profile?.quizCompleted?.length || 0;
      const courseDone =
        profile?.coursesCompleted?.length ||
        (profile?.courseProgress
          ? Object.values(profile.courseProgress).filter((c: any) => c.status === "completed").length
          : 0);

      const allUserReports: any[] = [];
      reportsSnap.forEach((r) => allUserReports.push({ id: r.id, ...r.data() }));
      allUserReports.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setAgentReports(allUserReports);

      const dailyReportsCount = allUserReports.filter((r) => {
        if (!r.createdAt) return false;
        const d = new Date(r.createdAt);
        const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return dStr === activeDate;
      }).length;

      setAgentExtraStats({
        totalBookings: profile?.bookingsCount || 0,
        doubtsCount: doubtsCountSnap.data().count,
        reportsCount: allUserReports.length,
        dailyReportsCount,
        coursesCompleted: courseDone,
        quizzesCompleted: quizDone,
      });

      setDrilldownData({
        profile: profile,
        activity: activitySnap.exists() ? (activitySnap.data() as DailyActivityLog) : null,
      });
    } catch (e) {
      console.error("Drilldown fetch error:", e);
    } finally {
      setDrilldownLoading(false);
    }
  };

  const statCards = [
    { label: "Total Q&A", value: counts.qa, href: "/admin/qa", icon: HelpCircle, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Total Files", value: counts.files, href: "/admin/files", icon: Folder, color: "text-emerald-700", bg: "bg-emerald-50" },
    { label: "Facilities", value: counts.facilities, href: "/admin/facilities", icon: Building2, color: "text-amber-600", bg: "bg-amber-50" },
    { label: "Agents", value: counts.agents, href: "/admin/teams", icon: Headphones, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Admins", value: counts.admins, href: "/admin/teams", icon: Shield, color: "text-purple-600", bg: "bg-purple-50" },
    { label: "Master Admins", value: counts.masters, href: "/admin/teams", icon: Crown, color: "text-rose-600", bg: "bg-rose-50" },
    { label: "Quizzes", value: counts.quizzes, href: "/admin/quiz", icon: Gamepad2, color: "text-purple-600", bg: "bg-purple-50" },
    { label: "Doubts", value: counts.doubts, href: "/admin/doubts", icon: MessageSquare, color: "text-teal-600", bg: "bg-teal-50" },
    { label: "Missing Content", value: counts.missing, href: "/admin/missing-content", icon: SearchX, color: "text-rose-600", bg: "bg-rose-50" },
    { label: "Pending Reports", value: counts.reports, href: "/reports", icon: Flag, color: "text-rose-600", bg: "bg-rose-50" },
    { label: "Courses", value: counts.courses, href: "/admin/onboarding", icon: GraduationCap, color: "text-indigo-600", bg: "bg-indigo-50" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {drilldownEmail ? (
        <div className="space-y-6">
          <button
            onClick={() => {
              setDrilldownEmail(null);
              setDrilldownData(null);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-full shadow-xs transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to System Overview</span>
          </button>

          {drilldownLoading || !drilldownData ? (
            <div className="text-center py-20 text-slate-400">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm">Compiling detailed daily activity report...</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-blue-600 text-white font-extrabold text-2xl flex items-center justify-center overflow-hidden shadow-md">
                    {drilldownData.profile?.photoURL ? (
                      <img src={drilldownData.profile.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      (drilldownData.profile?.displayName || drilldownEmail).charAt(0).toUpperCase()
                    )}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">
                      {drilldownData.profile?.displayName || drilldownEmail.split("@")[0]}
                    </h2>
                    <div className="text-xs text-slate-400">{drilldownEmail}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 bg-blue-50 border border-blue-200 px-4 py-2.5 rounded-2xl text-xs font-bold text-blue-700 shadow-2xs hover:bg-blue-100/70 transition-all">
                  <Calendar className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="text-[11px] font-bold text-blue-950">Change Date:</span>
                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => {
                      const newDate = e.target.value;
                      setDateFilter(newDate);
                      if (drilldownEmail) {
                        handleOpenDrilldown(drilldownEmail, newDate);
                      }
                    }}
                    className="bg-transparent text-xs font-bold text-blue-900 outline-none cursor-pointer"
                  />
                </div>
              </div>

              {/* 8 Major Activity Metrics Boxes */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 sm:gap-4">
                <div className="bg-white border border-slate-200 p-4 rounded-2xl text-center shadow-xs flex flex-col justify-between">
                  <Clock className="w-5 h-5 text-blue-600 mx-auto mb-1.5" />
                  <div className="text-lg font-black text-slate-900">
                    {(() => {
                      let sec = drilldownData.activity?.totalSeconds || 0;
                      if (!sec && drilldownData.activity?.pageVisits) {
                        Object.values(drilldownData.activity.pageVisits).forEach((s) => (sec += s));
                      }
                      return formatDuration(sec);
                    })()}
                  </div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    Screen Time Active
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-4 rounded-2xl text-center shadow-xs flex flex-col justify-between">
                  <User className="w-5 h-5 text-purple-600 mx-auto mb-1.5" />
                  <div className="text-lg font-black text-slate-900">
                    {drilldownData.activity?.loginCount || 1}
                  </div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    Sessions Today
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-4 rounded-2xl text-center shadow-xs flex flex-col justify-between">
                  <Gamepad2 className="w-5 h-5 text-indigo-600 mx-auto mb-1.5" />
                  <div className="text-lg font-black text-slate-900">
                    {(() => {
                      const countFromEvents = (drilldownData.activity?.timelineEvents || []).filter(
                        (e) => e.type === "quiz" || e.desc.toLowerCase().includes("completed quiz")
                      ).length;
                      const dailyQuiz = countFromEvents || drilldownData.activity?.quizzesCompletedCount || 0;
                      return (
                        <>
                          {dailyQuiz} <span className="text-[10px] text-slate-400 font-normal">({agentExtraStats.quizzesCompleted})</span>
                        </>
                      );
                    })()}
                  </div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    Quizzes (Today)
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-4 rounded-2xl text-center shadow-xs flex flex-col justify-between">
                  <GraduationCap className="w-5 h-5 text-emerald-600 mx-auto mb-1.5" />
                  <div className="text-lg font-black text-slate-900">
                    {agentExtraStats.coursesCompleted}
                  </div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    Courses Completed
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-4 rounded-2xl text-center shadow-xs flex flex-col justify-between">
                  <MessageSquare className="w-5 h-5 text-amber-600 mx-auto mb-1.5" />
                  <div className="text-lg font-black text-slate-900">
                    {agentExtraStats.doubtsCount}
                  </div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    Doubts Posted
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-4 rounded-2xl text-center shadow-xs flex flex-col justify-between">
                  <Flag className="w-5 h-5 text-rose-600 mx-auto mb-1.5" />
                  <div className="text-lg font-black text-slate-900">
                    {agentExtraStats.dailyReportsCount} <span className="text-[10px] text-slate-400 font-normal">({agentExtraStats.reportsCount})</span>
                  </div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    Reports (Today)
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-4 rounded-2xl text-center shadow-xs flex flex-col justify-between">
                  <Download className="w-5 h-5 text-teal-600 mx-auto mb-1.5" />
                  <div className="text-lg font-black text-slate-900">
                    {drilldownData.activity?.filesDownloaded || 0}
                  </div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    Files Downloaded
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-4 rounded-2xl text-center shadow-xs flex flex-col justify-between">
                  <Search className="w-5 h-5 text-slate-600 mx-auto mb-1.5" />
                  <div className="text-lg font-black text-slate-900">
                    {drilldownData.activity?.searches?.length || 0}
                  </div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    Searches Executed
                  </div>
                </div>
              </div>

              {/* 2-Column Grid: Left: Time Spent per Page | Right: Agent Daily Activity & Audit Trail */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                {/* Time Spent per Page */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-7 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                      <Clock className="w-5 h-5 text-amber-500" />
                      <span>Time Spent per Page</span>
                    </h3>
                    <span className="text-[11px] font-semibold text-slate-400">{dateFilter}</span>
                  </div>
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-200">
                    {drilldownData.activity?.pageVisits && Object.keys(drilldownData.activity.pageVisits).length > 0 ? (
                      Object.entries(drilldownData.activity.pageVisits).map(([page, sec]) => (
                        <div key={page} className="space-y-1.5 text-xs">
                          <div className="flex justify-between font-semibold text-slate-700">
                            <span>{page.replace(/[/._]/g, " ").trim().toUpperCase() || "HOME"}</span>
                            <span className="text-slate-500 font-bold">{formatDuration(sec)}</span>
                          </div>
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-600 rounded-full"
                              style={{ width: `${Math.min(100, Math.max(5, (sec / 600) * 100))}%` }}
                            />
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-400 py-12 text-center">No page time logged for {dateFilter}.</div>
                    )}
                  </div>
                </div>

                {/* Right: Agent Daily Activity & Audit Trail */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-7 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Activity className="w-5 h-5 text-blue-600" />
                      <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                        Daily Activity & Audit Trail
                      </h3>
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                        {(drilldownData.activity?.timelineEvents || []).length} Actions
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-medium">{dateFilter}</span>
                  </div>

                  <div className="max-h-96 overflow-y-auto space-y-2.5 pr-2 scrollbar-thin scrollbar-thumb-slate-200">
                    {(!drilldownData.activity?.timelineEvents || drilldownData.activity.timelineEvents.length === 0) ? (
                      <div className="text-center py-12 text-slate-400 text-xs italic">
                        No activity events recorded for {dateFilter}.
                      </div>
                    ) : (
                      [...(drilldownData.activity.timelineEvents)]
                        .reverse()
                        .map((evt, idx) => {
                          const timeStr = formatTimeOnly(evt.time);
                          const typeTag =
                            evt.type === "delete" || evt.icon === "Trash2"
                              ? "DELETED"
                              : evt.type === "add" || evt.icon === "PlusCircle"
                              ? "ADDED"
                              : evt.type === "edit" || evt.icon === "Edit"
                              ? "EDITED"
                              : evt.type === "report" || evt.color === "rose"
                              ? "REPORT"
                              : evt.type === "doubt" || evt.color === "amber"
                              ? "DOUBT"
                              : evt.type === "quiz" || evt.color === "purple"
                              ? "QUIZ"
                              : evt.type === "course" || evt.color === "emerald"
                              ? "COURSE"
                              : evt.type === "booking" || evt.color === "teal"
                              ? "BOOKING"
                              : evt.type === "facility"
                              ? "FACILITY"
                              : evt.type === "download"
                              ? "DOWNLOAD"
                              : evt.type === "profile"
                              ? "PROFILE"
                              : evt.type === "settings"
                              ? "SETTINGS"
                              : "ACTIVITY";

                          const colorStyles =
                            typeTag === "DELETED"
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : typeTag === "ADDED"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : typeTag === "EDITED"
                              ? "bg-blue-50 text-blue-700 border-blue-200"
                              : typeTag === "REPORT"
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : typeTag === "DOUBT"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : typeTag === "QUIZ"
                              ? "bg-purple-50 text-purple-700 border-purple-200"
                              : typeTag === "COURSE"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : typeTag === "BOOKING"
                              ? "bg-teal-50 text-teal-700 border-teal-200"
                              : typeTag === "FACILITY"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : typeTag === "DOWNLOAD"
                              ? "bg-teal-50 text-teal-700 border-teal-200"
                              : typeTag === "PROFILE"
                              ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                              : typeTag === "SETTINGS"
                              ? "bg-slate-100 text-slate-700 border-slate-300"
                              : "bg-slate-50 text-slate-700 border-slate-200";

                          return (
                            <div
                              key={idx}
                              className="flex items-start justify-between gap-3 p-3 bg-slate-50/70 border border-slate-200 rounded-2xl text-xs hover:bg-slate-50 transition-colors"
                            >
                              <div className="flex items-start gap-2.5 flex-1 min-w-0">
                                <span
                                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border shrink-0 ${colorStyles}`}
                                >
                                  {typeTag}
                                </span>
                                <p className="text-slate-800 font-medium break-words leading-relaxed flex-1 pt-0.5">
                                  {evt.desc}
                                </p>
                              </div>
                              <div className="text-[10px] font-semibold text-slate-400 shrink-0 whitespace-nowrap pt-1">
                                {timeStr}
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">System Overview</h1>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-4">
            {statCards.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.label}
                  href={card.href}
                  className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 shadow-xs hover:shadow-md hover:scale-[1.02] transition-all flex flex-col justify-between group"
                >
                  <div className="flex items-center justify-between">
                    <div
                      className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl ${card.bg} ${card.color} flex items-center justify-center`}
                    >
                      <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                    </div>
                  </div>
                  <div className="mt-3 sm:mt-4">
                    <div className="text-xl sm:text-2xl font-black text-slate-900 leading-none">{card.value}</div>
                    <div className="text-[10px] sm:text-[11px] font-semibold text-slate-500 mt-1 truncate">
                      {card.label}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-600" />
                  <span>Daily Agent Engagement Log</span>
                </h2>

                <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-semibold">
                  <button
                    onClick={() => setFilterOnlineOnly(false)}
                    className={`px-3 py-1 rounded-lg transition-all ${
                      !filterOnlineOnly
                        ? "bg-white text-slate-900 shadow-2xs font-bold"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    All ({activityLogs.length})
                  </button>
                  <button
                    onClick={() => setFilterOnlineOnly(true)}
                    className={`px-3 py-1 rounded-lg flex items-center gap-1.5 transition-all ${
                      filterOnlineOnly
                        ? "bg-emerald-600 text-white shadow-2xs font-bold"
                        : "text-emerald-700 hover:text-emerald-800"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${filterOnlineOnly ? "bg-white" : "bg-emerald-500"} animate-pulse`} />
                    Active Online ({onlineAgentsCount})
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setQuickUnlockModalOpen(true)}
                  className="flex items-center gap-2 bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-900 hover:to-black text-white px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-xs hover:shadow-md transition-all active:scale-95 cursor-pointer"
                >
                  <Lock className="w-4 h-4 text-amber-400" />
                  <span>Lock / Unlock User</span>
                </button>

                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-700">
                  <Calendar className="w-4 h-4 text-blue-600" />
                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="bg-transparent outline-none cursor-pointer"
                  />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-100">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                    <th className="p-4">Agent Name</th>
                    <th className="p-4">First Login</th>
                    <th className="p-4">Last Status / Logout</th>
                    <th className="p-4">Account / Lock Status</th>
                    <th className="p-4 text-center">Time Spent in App</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                  {loadingLogs ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-400">
                        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        Loading daily logs...
                      </td>
                    </tr>
                  ) : displayedLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-400">
                        {filterOnlineOnly
                          ? "No agents are currently active online right now."
                          : `No agent activity recorded for ${dateFilter}.`}
                      </td>
                    </tr>
                  ) : (
                    displayedLogs.map((log) => {
                      let totalSeconds = log.totalSeconds || 0;
                      if (!totalSeconds && log.pageVisits) {
                        Object.values(log.pageVisits).forEach((s) => (totalSeconds += s));
                      }
                      if (!totalSeconds && log.lastActive && log.loginTime) {
                        totalSeconds = Math.max(0, Math.floor((log.lastActive - log.loginTime) / 1000));
                      }

                      const timeStr = formatDuration(totalSeconds);
                      const loginStr = formatTimeOnly(log.firstLogin || log.loginTime);

                      const isLoggedOut = !!log.logoutTime && (!log.lastActive || log.logoutTime >= log.lastActive);
                      const isRecentlyActive = !isLoggedOut && log.lastActive && Date.now() - log.lastActive < 3 * 60 * 1000;

                      const lockInfo = userLockMap[log.email.toLowerCase()];
                      const isAccountLocked = !!lockInfo?.isLocked;
                      const failedCount = lockInfo?.failedAttempts || 0;

                      return (
                        <tr key={log.email} className={`hover:bg-slate-50/70 transition-colors ${isAccountLocked ? "bg-rose-50/30" : ""}`}>
                          <td className="p-4">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-8 h-8 rounded-full font-bold text-xs flex items-center justify-center shrink-0 ${isAccountLocked ? "bg-rose-600 text-white" : "bg-blue-600 text-white"}`}>
                                {(log.name || log.email).charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                  <span>{log.name || "Agent"}</span>
                                  {isAccountLocked && (
                                    <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-rose-100 text-rose-700">
                                      Locked
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-400">{log.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-slate-700 font-semibold">{loginStr}</td>
                          <td className="p-4">
                            {isRecentlyActive ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                Active Now
                              </span>
                            ) : isLoggedOut ? (
                              <span className="text-slate-600 text-xs font-medium">
                                Logged out at {formatTimeOnly(log.logoutTime)}
                              </span>
                            ) : log.lastActive ? (
                              <span className="text-slate-600 text-xs font-medium">
                                Last active at {formatTimeOnly(log.lastActive)}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">-</span>
                            )}
                          </td>

                          {/* Account Security & Lock Status Column */}
                          <td className="p-4">
                            {isAccountLocked ? (
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300 shadow-2xs animate-pulse">
                                  <Lock className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                  <span>Locked</span>
                                </span>
                                <button
                                  onClick={() => handleUnlockAccount(log.email)}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold shadow-xs transition-all flex items-center gap-1 hover:scale-105 active:scale-95 shrink-0 cursor-pointer"
                                  title="Unlock User Account"
                                >
                                  <Unlock className="w-3.5 h-3.5" />
                                  <span>Unlock</span>
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-medium bg-slate-50 text-slate-600 border border-slate-200">
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  <span>Normal</span>
                                </span>
                                <button
                                  onClick={() => handleLockAccount(log.email)}
                                  className="px-2.5 py-1 bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 hover:border-rose-600 rounded-lg text-[11px] font-bold shadow-2xs transition-all flex items-center gap-1 hover:scale-105 active:scale-95 shrink-0 cursor-pointer"
                                  title="Lock User Account"
                                >
                                  <Lock className="w-3.5 h-3.5" />
                                  <span>Lock</span>
                                </button>
                              </div>
                            )}
                          </td>

                          <td className="p-4 text-center">
                            <span className="bg-blue-50 border border-blue-100 text-blue-700 font-bold px-3 py-1 rounded-full text-xs shadow-2xs">
                              {timeStr}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <button
                              onClick={() => handleOpenDrilldown(log.email)}
                              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
                            >
                              View Report
                            </button>
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

      {/* Quick Lock / Unlock User Account Modal */}
      {quickUnlockModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-200 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Manage Account Access</h3>
                  <p className="text-xs text-slate-500">Instantly lock or unlock login access for any agent</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setQuickUnlockModalOpen(false);
                  setQuickUnlockEmail("");
                }}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Currently Detected Locked Accounts */}
              {Object.entries(userLockMap).some(([_, info]) => info.isLocked) && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl space-y-2.5">
                  <div className="text-xs font-bold text-rose-800 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-rose-600" />
                    <span>Currently Locked Accounts:</span>
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {Object.entries(userLockMap)
                      .filter(([_, info]) => info.isLocked)
                      .map(([email]) => (
                        <div
                          key={email}
                          className="flex items-center justify-between gap-2 p-2 bg-white rounded-xl border border-rose-200 text-xs"
                        >
                          <span className="font-semibold text-slate-800 truncate">{email}</span>
                          <button
                            onClick={async () => {
                              await handleUnlockAccount(email);
                            }}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold shadow-xs transition-all flex items-center gap-1 shrink-0 cursor-pointer"
                          >
                            <Unlock className="w-3 h-3" />
                            <span>Unlock</span>
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
                  Enter Agent Email Address
                </label>
                <input
                  type="email"
                  placeholder="e.g. agent@piramalswasthya.org"
                  value={quickUnlockEmail}
                  onChange={(e) => setQuickUnlockEmail(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setQuickUnlockModalOpen(false);
                  setQuickUnlockEmail("");
                }}
                className="px-3.5 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!quickUnlockEmail.trim() || quickUnlockLoading}
                  onClick={async () => {
                    if (!quickUnlockEmail.trim()) return;
                    setQuickUnlockLoading(true);
                    try {
                      await handleLockAccount(quickUnlockEmail.trim());
                      setQuickUnlockModalOpen(false);
                      setQuickUnlockEmail("");
                    } finally {
                      setQuickUnlockLoading(false);
                    }
                  }}
                  className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Lock User</span>
                </button>

                <button
                  type="button"
                  disabled={!quickUnlockEmail.trim() || quickUnlockLoading}
                  onClick={async () => {
                    if (!quickUnlockEmail.trim()) return;
                    setQuickUnlockLoading(true);
                    try {
                      await handleUnlockAccount(quickUnlockEmail.trim());
                      setQuickUnlockModalOpen(false);
                      setQuickUnlockEmail("");
                    } finally {
                      setQuickUnlockLoading(false);
                    }
                  }}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Unlock User</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
