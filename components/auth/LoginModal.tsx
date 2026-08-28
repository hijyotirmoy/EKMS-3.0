"use client";

import React, { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { UserRole } from "@/lib/types";
import { Users, Headphones, Briefcase, ShieldAlert, Lock, X, ChevronRight, AlertCircle } from "lucide-react";

export default function LoginModal() {
  const { showLoginModal, closeLoginModal, loginWithRole } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleClose = () => {
    closeLoginModal();
    setSelectedRole(null);
    setErrorMsg(null);
    setEmail("");
    setPassword("");
    if (pathname !== "/") {
      router.push("/");
    }
  };

  const handleSelectRole = (role: UserRole) => {
    setSelectedRole(role);
    setErrorMsg(null);
  };

  const handleBack = () => {
    setSelectedRole(null);
    setErrorMsg(null);
    setEmail("");
    setPassword("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole) return;
    if (!email.trim() || !password.trim()) {
      setErrorMsg("Please enter both email and password.");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      await loginWithRole(selectedRole, email.trim(), password.trim());
      closeLoginModal();
      handleBack();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message?.replace("Firebase:", "").trim() || "Login failed. Please verify credentials.");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showLoginModal) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showLoginModal, pathname]);

  if (!showLoginModal) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
    >
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-8 border border-slate-100 relative">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-100 transition-colors"
          title="Close and return to Home"
        >
          <X className="w-5 h-5" />
        </button>

        {/* STEP 1: Select Role */}
        {!selectedRole ? (
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-1">Welcome to EKMS</h2>
            <p className="text-sm text-slate-500 mb-6">Select your portal role to sign in</p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleSelectRole("Agent")}
                className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:border-blue-500 hover:bg-blue-50/50 transition-all group text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                    <Headphones className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 text-sm">Agent</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all" />
              </button>

              <button
                onClick={() => handleSelectRole("Admin")}
                className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:border-emerald-500 hover:bg-emerald-50/50 transition-all group text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 text-sm">Admin</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-700 group-hover:translate-x-0.5 transition-all" />
              </button>

              <button
                onClick={() => handleSelectRole("Master Admin")}
                className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:border-rose-500 hover:bg-rose-50/50 transition-all group text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 text-sm">Master Admin</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-rose-600 group-hover:translate-x-0.5 transition-all" />
              </button>
            </div>
          </div>
        ) : (
          /* STEP 2: Email & Password Credentials Form */
          <div>
            <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-3">
              <Lock className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-center text-slate-800 mb-1">
              Sign In as {selectedRole}
            </h2>
            <p className="text-xs text-center text-slate-500 mb-6">Enter your registered work credentials</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@piramalswasthya.org"
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>

              {errorMsg && (
                <div
                  className={`flex items-start gap-2.5 p-3.5 rounded-xl text-xs leading-relaxed ${
                    errorMsg.includes("Account Locked")
                      ? "bg-rose-100/90 border border-rose-300 text-rose-900 font-medium shadow-xs"
                      : "bg-rose-50 border border-rose-200 text-rose-700 font-medium"
                  }`}
                >
                  {errorMsg.includes("Account Locked") ? (
                    <Lock className="w-4 h-4 text-rose-700 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  )}
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={submitting}
                  className="w-1/3 py-2.5 border border-slate-200 hover:bg-slate-100 text-slate-700 text-sm font-medium rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-2/3 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg shadow-sm transition-colors"
                >
                  {submitting ? "Signing in..." : "Sign In"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
