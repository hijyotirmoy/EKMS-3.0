"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isPageRestricted } from "@/lib/pageAccess";
import { ShieldAlert, Lock, ArrowLeft, Home, UserX } from "lucide-react";

export default function PageAccessGuard({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { userProfile, isMasterAdmin, isAdmin, isLoggedIn, loading } = useAuth();
  const [isRestricted, setIsRestricted] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (loading || !isLoggedIn) {
      setIsRestricted(false);
      return;
    }

    const roleStr = (userProfile?.role || "").toLowerCase().trim();
    const isDispensary = roleStr === "dispensary staff" || roleStr === "dispensary";

    // Auto-redirect Dispensary Staff from / to their appointment dashboard
    if (isDispensary && (pathname === "/" || pathname === "")) {
      router.replace("/appointment");
      return;
    }

    if (isMasterAdmin) {
      setIsRestricted(false);
      return;
    }

    const restricted = isPageRestricted(pathname, userProfile);
    setIsRestricted(restricted);
  }, [pathname, userProfile, isMasterAdmin, isLoggedIn, loading, router]);

  const roleStr = (userProfile?.role || "").toLowerCase().trim();
  const isDispensary = roleStr === "dispensary staff" || roleStr === "dispensary";
  const homeTarget = isAdmin ? "/admin/overview" : isDispensary ? "/appointment" : "/";

  if (!mounted || !isRestricted) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 animate-in fade-in duration-200">
      <div className="bg-white border border-rose-100 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-6 text-center animate-in zoom-in-95 duration-200">
        {/* Animated Lock Icon */}
          <div className="w-16 h-16 bg-rose-50 border-2 border-rose-200 text-rose-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner relative">
            <Lock className="w-8 h-8 text-rose-600" />
            <div className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white rounded-full p-1 shadow-xs">
              <ShieldAlert className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 bg-rose-100/80 text-rose-800 text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full">
              <ShieldAlert className="w-3 h-3" />
              <span>Security Restriction</span>
            </div>
            <h3 className="text-xl font-black text-slate-900 tracking-tight">
              Access Restricted
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed max-w-sm mx-auto">
              You do not have access permission to view this page. Please contact your system administrator to request access.
            </p>
          </div>

          {/* Route path badge */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-left flex items-center justify-between">
            <div className="text-[11px] font-medium text-slate-500">
              <span className="text-[10px] font-bold text-slate-400 uppercase block mb-0.5">
                Restricted Location
              </span>
              <span className="font-mono text-slate-800 font-semibold break-all">
                {pathname}
              </span>
            </div>
            <span className="bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-extrabold px-2 py-0.5 rounded-md">
              LOCKED
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-1">
            <button
              onClick={() => router.back()}
              className="w-full sm:flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Go Back</span>
            </button>
            <button
              onClick={() => router.push(homeTarget)}
              className="w-full sm:flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
            >
              <Home className="w-4 h-4" />
              <span>{isDispensary ? "Return to Dashboard" : "Return to Home"}</span>
            </button>
          </div>
        </div>
      </div>
  );
}
