import React from "react";
import { useAuth } from "../context/AuthContext";
import { Bell, Shield, LogIn } from "lucide-react";

interface MobileHeaderProps {
  onOpenNotifications: () => void;
  unreadCount: number;
}

export default function MobileHeader({ onOpenNotifications, unreadCount }: MobileHeaderProps) {
  const { userProfile, isLoggedIn, isAdmin, isMasterAdmin, openLoginModal } = useAuth();
  const displayName = userProfile?.displayName || userProfile?.name || "Guest";

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800/80 px-4 py-3 pt-safe">
      <div className="flex items-center justify-between">
        {/* Brand & Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center p-1.5 shadow-sm">
            <img src="/ekms-logo.png" alt="EKMS" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-white text-base tracking-tight">EKMS</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-600/30 text-blue-400 border border-blue-500/30">
                3.0 Mobile
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate max-w-[170px]">
              {isLoggedIn ? displayName : "Guest Portal"}
            </p>
          </div>
        </div>

        {/* Action Controls & Notifications */}
        <div className="flex items-center gap-2">
          {isLoggedIn ? (
            <>
              {/* Role Pill */}
              <div
                className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border ${
                  isMasterAdmin
                    ? "bg-rose-950/40 text-rose-300 border-rose-500/30"
                    : isAdmin
                    ? "bg-purple-950/40 text-purple-300 border-purple-500/30"
                    : "bg-emerald-950/40 text-emerald-300 border-emerald-500/30"
                }`}
              >
                <Shield className="w-3 h-3" />
                <span>{userProfile?.role || (isAdmin ? "Admin" : "Agent")}</span>
              </div>

              {/* Notification Bell */}
              <button
                onClick={onOpenNotifications}
                className="relative p-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/50 transition-colors"
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white shadow-md animate-pulse">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
            </>
          ) : (
            /* Sign In Button for Guests */
            <button
              onClick={() => openLoginModal()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-md shadow-blue-600/30 transition-all active:scale-95"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
