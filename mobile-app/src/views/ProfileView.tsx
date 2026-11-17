import React from "react";
import { useAuth } from "../context/AuthContext";
import {
  User,
  Shield,
  Award,
  Flame,
  Building,
  LogOut,
  Sparkles,
  Smartphone,
  RefreshCw,
  Database,
  CheckCircle2,
} from "lucide-react";

export default function ProfileView() {
  const { user, userProfile, isAdmin, logout } = useAuth();
  const displayName = userProfile?.displayName || userProfile?.name || "Agent";
  const userEmail = user?.email || "";

  const handleClearCache = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      window.location.reload();
    } catch (e) {}
  };

  return (
    <div className="p-4 space-y-4 pb-24 max-w-md mx-auto">
      {/* Header Profile Card */}
      <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 text-center space-y-3 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 rounded-full blur-2xl pointer-events-none" />

        {/* Avatar */}
        <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-tr from-blue-600 to-indigo-600 p-1 shadow-lg shadow-blue-500/20">
          <div className="w-full h-full rounded-[22px] bg-slate-950 flex items-center justify-center text-white text-2xl font-bold">
            {displayName.charAt(0).toUpperCase()}
          </div>
        </div>

        <div>
          <h3 className="text-xl font-bold text-white tracking-tight">{displayName}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{userEmail}</p>
        </div>

        <div className="flex items-center justify-center gap-2 pt-1">
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1 rounded-full border ${
              isAdmin
                ? "bg-purple-950/60 text-purple-300 border-purple-500/30"
                : "bg-emerald-950/60 text-emerald-300 border-emerald-500/30"
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            {userProfile?.role || "Agent"}
          </span>

          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1 rounded-full bg-blue-950/60 text-blue-300 border border-blue-500/30">
            <Building className="w-3.5 h-3.5" />
            {userProfile?.orgBranch || "Headquarters"}
          </span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-1">
          <Flame className="w-5 h-5 text-amber-400 mx-auto" />
          <span className="text-lg font-bold text-white block">
            {userProfile?.streak || 1}
          </span>
          <span className="text-[10px] text-slate-400 uppercase font-semibold">Streak Days</span>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-1">
          <Award className="w-5 h-5 text-purple-400 mx-auto" />
          <span className="text-lg font-bold text-white block">
            {userProfile?.quizzesPassed || 0}
          </span>
          <span className="text-[10px] text-slate-400 uppercase font-semibold">Passed</span>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-1">
          <Sparkles className="w-5 h-5 text-cyan-400 mx-auto" />
          <span className="text-lg font-bold text-white block">
            {userProfile?.avgScore || 0}%
          </span>
          <span className="text-[10px] text-slate-400 uppercase font-semibold">Avg Score</span>
        </div>
      </div>

      {/* App & Device Info Card */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-slate-800">
          <span className="flex items-center gap-2 text-white font-medium">
            <Smartphone className="w-4 h-4 text-blue-400" /> App Type
          </span>
          <span className="font-semibold text-blue-400">Standalone Offline Bundle</span>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-slate-800">
          <span className="flex items-center gap-2 text-white font-medium">
            <Database className="w-4 h-4 text-emerald-400" /> Database Link
          </span>
          <span className="font-semibold text-emerald-400">Piramal Firebase Live</span>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center gap-2 text-white font-medium">
            <CheckCircle2 className="w-4 h-4 text-purple-400" /> Version
          </span>
          <span className="font-semibold text-slate-300">v3.0.0 Mobile Native</span>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2 pt-2">
        <button
          onClick={handleClearCache}
          className="w-full py-3 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
        >
          <RefreshCw className="w-4 h-4 text-slate-400" />
          Clear Offline Cache &amp; Resync
        </button>

        <button
          onClick={logout}
          className="w-full py-3 px-4 rounded-2xl bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/30 text-rose-400 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out of Mobile App
        </button>
      </div>
    </div>
  );
}
