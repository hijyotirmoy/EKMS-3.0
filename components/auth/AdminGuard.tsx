"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { ShieldAlert, Loader2 } from "lucide-react";

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { role, loading, openLoginModal } = useAuth();
  const router = useRouter();
  const [timedOut, setTimedOut] = React.useState(false);

  const isAdmin = role === "Admin" || role === "Master Admin";

  useEffect(() => {
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if ((!loading || timedOut) && !isAdmin) {
      router.push("/");
      openLoginModal();
    }
  }, [isAdmin, loading, timedOut, router, openLoginModal]);

  if (loading && !timedOut) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-sm font-medium text-slate-500">Verifying administrative security credentials...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mb-4">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Restricted Admin Area</h2>
        <p className="text-sm text-slate-500 max-w-sm mb-6">
          You must be signed in as an Admin or Master Admin to access this control suite.
        </p>
        <button
          onClick={openLoginModal}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
        >
          Sign In with Admin Account
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
