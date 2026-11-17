import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { collection, query, orderBy, limit, onSnapshot, getDocs } from "firebase/firestore";
import { db, logsDb, bookingDb } from "../lib/firebase";
import { Announcement, UserRole } from "../lib/types";
import {
  Calendar,
  HelpCircle,
  GraduationCap,
  Sparkles,
  TrendingUp,
  Award,
  Headphones,
  Briefcase,
  ShieldAlert,
  Flame,
  CheckCircle2,
  LogIn,
} from "lucide-react";

interface HomeViewProps {
  onNavigateTab: (tab: any) => void;
}

export default function HomeView({ onNavigateTab }: HomeViewProps) {
  const { user, userProfile, isLoggedIn, isAdmin, openLoginModal } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [stats, setStats] = useState({
    myBookings: 0,
    myDoubts: 0,
    quizzesPassed: 0,
    totalQuizzes: 0,
  });

  const displayName = userProfile?.displayName || userProfile?.name || "Field Agent";
  const userEmail = (user?.email || "").toLowerCase().trim();

  useEffect(() => {
    // 1. Listen to announcements
    const qAnn = query(collection(logsDb, "announcements"), orderBy("createdAt", "desc"), limit(5));
    const unsubAnn = onSnapshot(qAnn, (snap) => {
      const list: Announcement[] = [];
      snap.forEach((d) => {
        const data = d.data() as Announcement;
        if (data.isVisible !== false) {
          list.push({ ...data, id: d.id });
        }
      });
      setAnnouncements(list);
    });

    // 2. Fetch stats if logged in
    const fetchStats = async () => {
      if (!userEmail) return;
      try {
        let bookingsCount = 0;
        let doubtsCount = 0;

        // Doubts count
        const doubtsSnap = await getDocs(collection(db, "doubts")).catch(() => null);
        if (doubtsSnap) {
          doubtsSnap.forEach((d) => {
            const data = d.data();
            if (data.authorEmail?.toLowerCase().trim() === userEmail) {
              doubtsCount++;
            }
          });
        }

        // Bookings count from bookingDb
        const bookSnap = await getDocs(collection(bookingDb, "daily_availability")).catch(() => null);
        if (bookSnap) {
          bookSnap.forEach((docSnap) => {
            const d = docSnap.data();
            if (Array.isArray(d.bookedRecords)) {
              d.bookedRecords.forEach((b: any) => {
                if (b.agentEmail?.toLowerCase().trim() === userEmail) {
                  bookingsCount++;
                }
              });
            }
          });
        }

        const passed = userProfile?.quizzesPassed || userProfile?.quizCompleted?.length || 0;
        const total = userProfile?.totalQuizzesTaken || 0;

        setStats({
          myBookings: bookingsCount,
          myDoubts: doubtsCount,
          quizzesPassed: passed,
          totalQuizzes: total,
        });
      } catch (e) {
        console.warn("Home stats load notice:", e);
      }
    };

    fetchStats();

    return () => unsubAnn();
  }, [userEmail, userProfile]);

  return (
    <div className="p-4 space-y-5 pb-24">
      {/* Welcome & Role Banner */}
      {isLoggedIn ? (
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-700 via-indigo-700 to-slate-900 p-5 text-white shadow-xl border border-blue-500/20">
          <div className="flex items-center justify-between">
            <div>
              <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-200 border border-blue-400/30 text-[11px] font-medium mb-1.5">
                <Sparkles className="w-3 h-3 text-cyan-300" />
                {isAdmin ? "Admin Console" : "Agent Portal"}
              </div>
              <h2 className="text-xl font-bold tracking-tight">
                Hello, {displayName}!
              </h2>
              <p className="text-xs text-blue-100/80 mt-0.5">
                {userProfile?.orgBranch ? `${userProfile.orgBranch} Branch` : "Piramal Knowledge System"}
              </p>
            </div>

            <div className="flex flex-col items-center justify-center bg-white/10 backdrop-blur-md rounded-2xl px-3 py-2 border border-white/15">
              <Flame className="w-6 h-6 text-amber-400 animate-pulse" />
              <span className="text-xs font-bold text-white mt-0.5">
                {userProfile?.streak || 1} Day
              </span>
              <span className="text-[9px] text-blue-200 uppercase font-semibold">Streak</span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-white/15 flex items-center justify-between text-xs text-blue-100/90">
            <span>Role: <strong>{userProfile?.role || "Agent"}</strong></span>
            <span>{userProfile?.orgTier || "Tier 1"}</span>
          </div>
        </div>
      ) : (
        /* Guest Welcome Banner with Quick Role Selectors */
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-900 via-indigo-950 to-slate-950 p-6 text-white shadow-2xl border border-blue-500/30 space-y-4">
          <div>
            <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-400/30 text-[11px] font-medium mb-2">
              <Sparkles className="w-3 h-3 text-cyan-300" />
              Welcome to EKMS Mobile
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Enterprise Knowledge &amp; Field Portal
            </h2>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              Select your role below to sign in and access appointments, doubts, and assessments.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              onClick={() => openLoginModal("Agent")}
              className="p-3 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-blue-500/30 flex flex-col items-center text-center transition-all active:scale-95 group shadow-sm"
            >
              <div className="p-2 rounded-xl bg-blue-600/20 text-blue-400 mb-1.5 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                <Headphones className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-white">Agent</span>
              <span className="text-[9px] text-slate-400">Field Work</span>
            </button>

            <button
              onClick={() => openLoginModal("Admin")}
              className="p-3 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-emerald-500/30 flex flex-col items-center text-center transition-all active:scale-95 group shadow-sm"
            >
              <div className="p-2 rounded-xl bg-emerald-600/20 text-emerald-400 mb-1.5 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                <Briefcase className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-white">Admin</span>
              <span className="text-[9px] text-slate-400">Manager</span>
            </button>

            <button
              onClick={() => openLoginModal("Master Admin")}
              className="p-3 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-purple-500/30 flex flex-col items-center text-center transition-all active:scale-95 group shadow-sm"
            >
              <div className="p-2 rounded-xl bg-purple-600/20 text-purple-400 mb-1.5 group-hover:bg-purple-600 group-hover:text-white transition-colors">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-white truncate max-w-full">Master</span>
              <span className="text-[9px] text-slate-400">Governance</span>
            </button>
          </div>
        </div>
      )}

      {/* Announcements */}
      {announcements.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              📢 Announcements
            </span>
            <span className="text-[11px] text-blue-400 font-medium">Live Feed</span>
          </div>
          <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 shadow-sm">
            <h4 className="text-sm font-semibold text-white">
              {announcements[0].title || "Official Notice"}
            </h4>
            <p className="text-xs text-slate-300 mt-1 line-clamp-2 leading-relaxed">
              {announcements[0].message}
            </p>
            <span className="text-[10px] text-slate-500 mt-2 block">
              {announcements[0].createdAt ? new Date(announcements[0].createdAt).toLocaleDateString() : "Today"}
            </span>
          </div>
        </div>
      )}

      {/* Quick Action Cards Grid */}
      <div className="space-y-2">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
          Explore Features
        </span>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onNavigateTab("bookings")}
            className="flex flex-col items-start p-4 rounded-2xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 transition-all active:scale-98 text-left group"
          >
            <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 mb-3 group-hover:scale-110 transition-transform">
              <Calendar className="w-5 h-5" />
            </div>
            <span className="font-semibold text-sm text-white">Appointments</span>
            <span className="text-[11px] text-slate-400 mt-0.5">
              {isLoggedIn ? (isAdmin ? "Manage schedule" : `${stats.myBookings} Bookings`) : "View & schedule"}
            </span>
          </button>

          <button
            onClick={() => onNavigateTab("doubts")}
            className="flex flex-col items-start p-4 rounded-2xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 transition-all active:scale-98 text-left group"
          >
            <div className="p-2.5 rounded-xl bg-cyan-500/15 text-cyan-400 mb-3 group-hover:scale-110 transition-transform">
              <HelpCircle className="w-5 h-5" />
            </div>
            <span className="font-semibold text-sm text-white">Ask Doubts</span>
            <span className="text-[11px] text-slate-400 mt-0.5">
              {isLoggedIn ? (isAdmin ? "Answer queries" : `${stats.myDoubts} Submitted`) : "Q&A Knowledge"}
            </span>
          </button>

          <button
            onClick={() => onNavigateTab("quizzes")}
            className="flex flex-col items-start p-4 rounded-2xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 transition-all active:scale-98 text-left group"
          >
            <div className="p-2.5 rounded-xl bg-purple-500/15 text-purple-400 mb-3 group-hover:scale-110 transition-transform">
              <GraduationCap className="w-5 h-5" />
            </div>
            <span className="font-semibold text-sm text-white">Quizzes</span>
            <span className="text-[11px] text-slate-400 mt-0.5">
              {isLoggedIn ? `${stats.quizzesPassed} Completed` : "Assessments"}
            </span>
          </button>

          <button
            onClick={() => onNavigateTab("profile")}
            className="flex flex-col items-start p-4 rounded-2xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 transition-all active:scale-98 text-left group"
          >
            <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-400 mb-3 group-hover:scale-110 transition-transform">
              <Award className="w-5 h-5" />
            </div>
            <span className="font-semibold text-sm text-white">
              {isLoggedIn ? "My Profile" : "Account"}
            </span>
            <span className="text-[11px] text-slate-400 mt-0.5">
              {isLoggedIn ? `Score: ${userProfile?.avgScore || 0}%` : "Sign In / Settings"}
            </span>
          </button>
        </div>
      </div>

      {/* System Status Card */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <h4 className="text-sm font-bold text-white">Standalone Mobile Engine</h4>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" /> Online
          </span>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Connected directly to the Piramal ESIC cloud database. Changes here synchronize with the central system without altering website layout.
        </p>
      </div>
    </div>
  );
}
