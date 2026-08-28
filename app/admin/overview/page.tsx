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
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getOrFetchCollection } from "@/lib/cache";
import { DailyActivityLog } from "@/lib/types";
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
} from "lucide-react";

export default function AdminOverviewPage() {
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);
  const [activityLogs, setActivityLogs] = useState<DailyActivityLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [filterOnlineOnly, setFilterOnlineOnly] = useState(false);

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
  const [agentExtraStats, setAgentExtraStats] = useState({
    totalBookings: 0,
    doubtsCount: 0,
    coursesCompleted: 0,
    quizzesCompleted: 0,
    reportsCount: 0,
  });

  // 1. Fetch Global Counts (Single Batch on Mount)
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [qaSnap, filesSnap, facSnap, doubtSnap, missSnap, repSnap, courseSnap, quizSnap, usersSnap] =
          await Promise.all([
            getCountFromServer(collection(db, "qas")),
            getCountFromServer(collection(db, "files")),
            getCountFromServer(collection(db, "facilities")),
            getCountFromServer(collection(db, "doubts")),
            getCountFromServer(collection(db, "missing_searches")),
            getCountFromServer(query(collection(db, "reports"), where("status", "!=", "solved"))),
            getCountFromServer(collection(db, "courses")),
            getCountFromServer(collection(db, "quizzes")),
            getDocs(collection(db, "users")),
          ]);

        let agents = 0;
        let admins = 0;
        let masters = 0;

        usersSnap.forEach((d) => {
          const role = d.data().role;
          if (role === "Master Admin") masters++;
          else if (role === "Admin") admins++;
          else agents++;
        });

        setCounts({
          qa: qaSnap.data().count,
          files: filesSnap.data().count,
          facilities: facSnap.data().count,
          agents,
          admins,
          masters,
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

  // 2. Fetch Daily Activity for Date & merge with Users collection
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

          if (!loggedEmails.has(email) && u.lastLogin) {
            const loginDate = new Date(u.lastLogin);
            const localDateStr = `${loginDate.getFullYear()}-${String(loginDate.getMonth() + 1).padStart(2, "0")}-${String(loginDate.getDate()).padStart(2, "0")}`;
            const isoDateStr = loginDate.toISOString().split("T")[0];

            if (localDateStr === dateFilter || isoDateStr === dateFilter) {
              const totalSec = Math.max(0, Math.floor(((u.lastActive || u.lastLogin) - u.lastLogin) / 1000));
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

  // Displayed Logs with Online filter
  const displayedLogs = useMemo(() => {
    if (!filterOnlineOnly) return activityLogs;
    return activityLogs.filter((log) => {
      const isLoggedOut = !!log.logoutTime && (!log.lastActive || log.logoutTime >= log.lastActive);
      return !isLoggedOut && log.lastActive && Date.now() - log.lastActive < 3 * 60 * 1000;
    });
  }, [activityLogs, filterOnlineOnly]);

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
  const handleOpenDrilldown = async (email: string) => {
    setDrilldownEmail(email);
    setDrilldownLoading(true);

    try {
      const cleanEmail = email.toLowerCase().trim();
      const [userSnap, activitySnap, doubtsCountSnap, reportsCountSnap] = await Promise.all([
        getDoc(doc(db, "users", cleanEmail)),
        getDoc(doc(db, "daily_activity", `${cleanEmail}_${dateFilter}`)),
        getCountFromServer(query(collection(db, "doubts"), where("authorEmail", "==", cleanEmail))),
        getCountFromServer(query(collection(db, "reports"), where("reporterEmail", "==", cleanEmail))),
      ]);

      const profile = userSnap.exists() ? userSnap.data() : null;
      const quizDone = profile?.quizCompleted?.length || 0;
      const courseDone =
        profile?.coursesCompleted?.length ||
        (profile?.courseProgress
          ? Object.values(profile.courseProgress).filter((c: any) => c.status === "completed").length
          : 0);

      setAgentExtraStats({
        totalBookings: profile?.bookingsCount || 0,
        doubtsCount: doubtsCountSnap.data().count,
        reportsCount: reportsCountSnap.data().count,
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

                <div className="flex items-center gap-2 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-4 py-2 rounded-xl">
                  <Calendar className="w-4 h-4" />
                  <span>Date: {dateFilter}</span>
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
                    {agentExtraStats.quizzesCompleted}
                  </div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    Quizzes Completed
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
                    {agentExtraStats.reportsCount}
                  </div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    Reports Submitted
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

              {/* Page Time Distribution & Searches Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Time Spent per Page */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-500" />
                    <span>Time Spent per Page</span>
                  </h3>
                  <div className="space-y-3">
                    {drilldownData.activity?.pageVisits && Object.keys(drilldownData.activity.pageVisits).length > 0 ? (
                      Object.entries(drilldownData.activity.pageVisits).map(([page, sec]) => (
                        <div key={page} className="space-y-1 text-xs">
                          <div className="flex justify-between font-semibold text-slate-700">
                            <span>{page.replace(/[/._]/g, " ").trim().toUpperCase() || "HOME"}</span>
                            <span>{formatDuration(sec)}</span>
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
                      <div className="text-xs text-slate-400 py-6 text-center">No page time logged.</div>
                    )}
                  </div>
                </div>

                {/* Search Queries */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <SearchX className="w-4 h-4 text-blue-600" />
                    <span>Search History Today</span>
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {drilldownData.activity?.searches && drilldownData.activity.searches.length > 0 ? (
                      drilldownData.activity.searches.map((s, i) => (
                        <span
                          key={i}
                          className="bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded-full text-xs font-semibold"
                        >
                          &quot;{s}&quot;
                        </span>
                      ))
                    ) : (
                      <div className="text-xs text-slate-400 py-6 text-center w-full">
                        No searches logged on this date.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Agent Activity & Audit Trail (Last 20 Activities with Internal Scroll) */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-blue-600" />
                    <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                      Agent Activity & Audit Trail
                    </h3>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                      Last {Math.min(20, (drilldownData.activity?.timelineEvents || []).length)} Actions
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium">Auto-recorded live</span>
                </div>

                <div className="max-h-72 overflow-y-auto space-y-2.5 pr-2 scrollbar-thin scrollbar-thumb-slate-200">
                  {(!drilldownData.activity?.timelineEvents || drilldownData.activity.timelineEvents.length === 0) ? (
                    <div className="text-center py-10 text-slate-400 text-xs italic">
                      No interaction events recorded for this agent on this date.
                    </div>
                  ) : (
                    [...(drilldownData.activity.timelineEvents)]
                      .reverse()
                      .slice(0, 20)
                      .map((evt, idx) => {
                        const timeStr = formatTimeOnly(evt.time);
                        const colorStyles =
                          evt.color === "rose"
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : evt.color === "emerald"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : evt.color === "amber"
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : evt.color === "purple"
                            ? "bg-purple-50 text-purple-700 border-purple-200"
                            : evt.color === "teal"
                            ? "bg-teal-50 text-teal-700 border-teal-200"
                            : evt.color === "slate"
                            ? "bg-slate-50 text-slate-700 border-slate-200"
                            : "bg-blue-50 text-blue-700 border-blue-200";

                        return (
                          <div
                            key={idx}
                            className="flex items-start justify-between gap-3 p-3 bg-slate-50/70 border border-slate-200 rounded-xl text-xs hover:bg-slate-50 transition-colors"
                          >
                            <div className="flex items-start gap-2.5 flex-1 min-w-0">
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border shrink-0 ${colorStyles}`}
                              >
                                {evt.icon === "Trash2" ? "DELETED" : evt.color === "rose" ? "REPORT" : evt.color === "amber" ? "DOUBT" : evt.color === "purple" ? "QUIZ" : evt.color === "emerald" ? "COURSE" : "ACTIVITY"}
                              </span>
                              <p className="text-slate-800 font-medium break-words leading-relaxed flex-1">
                                {evt.desc}
                              </p>
                            </div>
                            <div className="text-[10px] font-semibold text-slate-400 shrink-0 whitespace-nowrap pt-0.5">
                              {timeStr}
                            </div>
                          </div>
                        );
                      })
                  )}
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

            <div className="overflow-x-auto rounded-2xl border border-slate-100">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                    <th className="p-4">Agent Name</th>
                    <th className="p-4">First Login</th>
                    <th className="p-4">Last Status / Logout</th>
                    <th className="p-4 text-center">Time Spent in App</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                  {loadingLogs ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-slate-400">
                        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        Loading daily logs...
                      </td>
                    </tr>
                  ) : displayedLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-slate-400">
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

                      return (
                        <tr key={log.email} className="hover:bg-slate-50/70 transition-colors">
                          <td className="p-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                                {(log.name || log.email).charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900">{log.name || "Agent"}</div>
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
    </div>
  );
}
