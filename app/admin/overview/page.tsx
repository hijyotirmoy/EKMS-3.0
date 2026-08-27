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
} from "lucide-react";

export default function AdminOverviewPage() {
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);
  const [activityLogs, setActivityLogs] = useState<DailyActivityLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

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
  const [drilldownData, setDrilldownData] = useState<{
    profile: any;
    activity: DailyActivityLog | null;
  } | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  // 1. Optimized Aggregate Counters (Uses Firestore Count Aggregation for 99% Read Reduction)
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [
          qaCount,
          filesCount,
          facCount,
          quizCount,
          doubtsCount,
          missingCount,
          courseCount,
          reportsCount,
          usersList,
        ] = await Promise.all([
          getCountFromServer(collection(db, "qna")),
          getCountFromServer(collection(db, "files")),
          getCountFromServer(collection(db, "facilities")),
          getCountFromServer(collection(db, "quizzes")),
          getCountFromServer(collection(db, "doubts")),
          getCountFromServer(collection(db, "missing_searches")),
          getCountFromServer(collection(db, "onboardings")),
          getCountFromServer(query(collection(db, "reports"), where("status", "==", "pending"))),
          getOrFetchCollection<any>("users"),
        ]);

        let agents = 0;
        let admins = 0;
        let masters = 0;

        usersList.forEach((d: any) => {
          const r = d.role;
          if (r === "Master Admin") masters++;
          else if (r === "Admin") admins++;
          else agents++;
        });

        setCounts({
          qa: qaCount.data().count,
          files: filesCount.data().count,
          facilities: facCount.data().count,
          quizzes: quizCount.data().count,
          doubts: doubtsCount.data().count,
          missing: missingCount.data().count,
          courses: courseCount.data().count,
          reports: reportsCount.data().count,
          agents,
          admins,
          masters,
        });
      } catch (err) {
        console.error("Overview counts load error:", err);
      }
    };

    fetchCounts();
  }, []);

  // 2. Fetch Daily Activity for Date
  useEffect(() => {
    setLoadingLogs(true);
    const q = query(collection(db, "daily_activity"), where("date", "==", dateFilter));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: DailyActivityLog[] = [];
      snapshot.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<DailyActivityLog, "id">) }));
      setActivityLogs(list);
      setLoadingLogs(false);
    });

    return () => unsubscribe();
  }, [dateFilter]);

  // 3. Drilldown report fetch
  const handleOpenDrilldown = async (email: string) => {
    setDrilldownEmail(email);
    setDrilldownLoading(true);

    try {
      const userSnap = await getDoc(doc(db, "users", email));
      const activitySnap = await getDoc(doc(db, "daily_activity", `${email}_${dateFilter}`));

      setDrilldownData({
        profile: userSnap.exists() ? userSnap.data() : null,
        activity: activitySnap.exists() ? (activitySnap.data() as DailyActivityLog) : null,
      });
    } catch (e) {
      console.error(e);
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
      {/* ----------------------------------------------------
          DRILLDOWN AGENT DAILY ACTIVITY REPORT
          ---------------------------------------------------- */}
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
              {/* Header card */}
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

              {/* Stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 p-4 rounded-2xl text-center shadow-xs">
                  <div className="text-xl font-extrabold text-blue-600">
                    {(() => {
                      let sec = 0;
                      if (drilldownData.activity?.pageVisits) {
                        Object.values(drilldownData.activity.pageVisits).forEach((s) => (sec += s));
                      }
                      return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m`;
                    })()}
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    Screen Time Active
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-4 rounded-2xl text-center shadow-xs">
                  <div className="text-xl font-extrabold text-purple-600">
                    {drilldownData.activity?.loginCount || 1}
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    Sessions Today
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-4 rounded-2xl text-center shadow-xs">
                  <div className="text-xl font-extrabold text-emerald-600">
                    {drilldownData.activity?.filesDownloaded || 0}
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    Files Downloaded
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-4 rounded-2xl text-center shadow-xs">
                  <div className="text-xl font-extrabold text-amber-600">
                    {drilldownData.activity?.searches?.length || 0}
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
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
                            <span>{page.replace(".html", "").toUpperCase()}</span>
                            <span>{Math.ceil(sec / 60)} mins</span>
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
            </div>
          )}
        </div>
      ) : (
        /* ----------------------------------------------------
            MAIN OVERVIEW DASHBOARD & 12 KPI CARDS
            ---------------------------------------------------- */
        <div className="space-y-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">System Master Overview</h1>
          </div>

          {/* 12 Metric Counter Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {statCards.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.label}
                  href={card.href}
                  className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs hover:shadow-md hover:scale-[1.02] transition-all flex flex-col justify-between group"
                >
                  <div className="flex items-center justify-between">
                    <div
                      className={`w-10 h-10 rounded-xl ${card.bg} ${card.color} flex items-center justify-center`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="text-2xl font-black text-slate-900 leading-none">{card.value}</div>
                    <div className="text-[11px] font-semibold text-slate-500 mt-1 truncate">
                      {card.label}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Daily Agent Activity Monitoring Table */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-600" />
                  <span>Daily Agent Engagement Log</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Inspect login sessions, active terminal times, and drill down into individual activity.
                </p>
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

            {/* Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-100">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                    <th className="p-4">Agent Name</th>
                    <th className="p-4">First Login</th>
                    <th className="p-4">Last Active</th>
                    <th className="p-4 text-center">Total Time Active</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                  {loadingLogs ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-slate-400">
                        Loading daily logs...
                      </td>
                    </tr>
                  ) : activityLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-slate-400">
                        No activity recorded for {dateFilter}.
                      </td>
                    </tr>
                  ) : (
                    activityLogs.map((log) => {
                      let totalSeconds = 0;
                      if (log.pageVisits) {
                        Object.values(log.pageVisits).forEach((s) => (totalSeconds += s));
                      }
                      const timeStr =
                        totalSeconds < 60
                          ? `${totalSeconds}s`
                          : `${Math.floor(totalSeconds / 60)}m`;

                      const loginStr = log.loginTime
                        ? new Date(log.loginTime).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "-";

                      const lastActiveStr = log.lastActive
                        ? new Date(log.lastActive).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "-";

                      return (
                        <tr key={log.email} className="hover:bg-slate-50/70 transition-colors">
                          <td className="p-4">
                            <div className="font-bold text-slate-900">{log.name}</div>
                            <div className="text-[11px] text-slate-400">{log.email}</div>
                          </td>
                          <td className="p-4 text-slate-600">{loginStr}</td>
                          <td className="p-4 text-slate-600">{lastActiveStr}</td>
                          <td className="p-4 text-center">
                            <span className="bg-blue-50 text-blue-700 font-bold px-2.5 py-1 rounded-full text-xs">
                              {timeStr}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <button
                              onClick={() => handleOpenDrilldown(log.email)}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
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
