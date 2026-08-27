"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import EkmsNavbar from "@/components/layout/EkmsNavbar";
import EkmsSidebar from "@/components/layout/EkmsSidebar";
import EkmsChatbot from "@/components/layout/EkmsChatbot";
import { Lock, UserCheck, Loader2 } from "lucide-react";

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const pathname = usePathname();
  const { isLoggedIn, loading, openLoginModal } = useAuth();

  const isPublicPage = pathname === "/";

  // Trigger login modal automatically if trying to access any protected page while logged out
  useEffect(() => {
    if (!loading && !isLoggedIn && !isPublicPage) {
      openLoginModal();
    }
  }, [loading, isLoggedIn, isPublicPage, openLoginModal]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <EkmsNavbar
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      <div className="flex flex-1 pt-14">
        <EkmsSidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />

        <main
          className={`flex-1 w-full transition-all duration-300 min-h-[calc(100vh-56px)] flex flex-col ${
            isSidebarOpen ? "lg:pl-64" : "lg:pl-[72px]"
          }`}
        >
          <div className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6">
            {isPublicPage ? (
              children
            ) : loading ? (
              <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <p className="text-xs font-semibold text-slate-400">Verifying session credentials...</p>
              </div>
            ) : isLoggedIn ? (
              children
            ) : (
              <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center space-y-4 max-w-md mx-auto animate-in fade-in duration-300">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-xs border border-blue-100">
                  <Lock className="w-8 h-8" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-xl font-extrabold text-slate-900">
                    Authentication Required
                  </h2>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Please sign in with your official EKMS credentials to access this workspace and view its contents.
                  </p>
                </div>
                <button
                  onClick={openLoginModal}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all hover:scale-[1.02] flex items-center gap-2"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Sign In to Access</span>
                </button>
              </div>
            )}
          </div>
        </main>
      </div>

      <EkmsChatbot />
    </div>
  );
}
