import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { UserRole } from "../lib/types";
import {
  Users,
  Headphones,
  Briefcase,
  ShieldAlert,
  Lock,
  Mail,
  X,
  ChevronRight,
  ArrowLeft,
  AlertCircle,
  ArrowRight,
} from "lucide-react";

export default function LoginModal() {
  const { showLoginModal, closeLoginModal, initialSelectedRole, loginWithRole } = useAuth();
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (showLoginModal) {
      if (initialSelectedRole) {
        setSelectedRole(initialSelectedRole);
      } else {
        setSelectedRole(null);
      }
      setErrorMsg(null);
    }
  }, [showLoginModal, initialSelectedRole]);

  if (!showLoginModal) return null;

  const handleClose = () => {
    closeLoginModal();
    setSelectedRole(null);
    setErrorMsg(null);
    setEmail("");
    setPassword("");
  };

  const handleSelectRole = (role: UserRole) => {
    setSelectedRole(role);
    setErrorMsg(null);
  };

  const handleBack = () => {
    setSelectedRole(null);
    setErrorMsg(null);
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

    const res = await loginWithRole(selectedRole, email, password);
    if (res.success) {
      handleClose();
    } else {
      setErrorMsg(res.error || "Login failed. Please verify credentials.");
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl text-white overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-slate-800/80 transition-colors"
          title="Close and return to Home"
        >
          <X className="w-4 h-4" />
        </button>

        {!selectedRole ? (
          /* STEP 1: Select Role */
          <div className="space-y-4 pt-1">
            <div className="text-center space-y-1.5">
              <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center mx-auto text-blue-400 shadow-sm">
                <Users className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-bold text-white tracking-tight">Select Role</h3>
              <p className="text-xs text-slate-400">
                Choose your portal role to sign in to EKMS
              </p>
            </div>

            <div className="space-y-2.5 pt-2">
              <button
                onClick={() => handleSelectRole("Agent")}
                className="w-full p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-blue-500 hover:bg-blue-950/20 flex items-center justify-between transition-all group active:scale-98 text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center border border-blue-500/20 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    <Headphones className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-bold text-white text-sm block">Agent</span>
                    <span className="text-[11px] text-slate-400">Field work &amp; bookings</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
              </button>

              <button
                onClick={() => handleSelectRole("Admin")}
                className="w-full p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-emerald-500 hover:bg-emerald-950/20 flex items-center justify-between transition-all group active:scale-98 text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center border border-emerald-500/20 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-bold text-white text-sm block">Admin</span>
                    <span className="text-[11px] text-slate-400">Management &amp; verification</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all" />
              </button>

              <button
                onClick={() => handleSelectRole("Master Admin")}
                className="w-full p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-purple-500 hover:bg-purple-950/20 flex items-center justify-between transition-all group active:scale-98 text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center border border-purple-500/20 group-hover:bg-purple-600 group-hover:text-white transition-colors">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-bold text-white text-sm block">Master Admin</span>
                    <span className="text-[11px] text-slate-400">Root system governance</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-purple-400 group-hover:translate-x-0.5 transition-all" />
              </button>
            </div>
          </div>
        ) : (
          /* STEP 2: Email & Password */
          <div className="space-y-4 pt-1">
            <div className="flex items-center gap-2">
              <button
                onClick={handleBack}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800"
                title="Back to roles"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-wide">
                  Signing in as
                </span>
                <h3 className="text-lg font-bold text-white">{selectedRole}</h3>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-2xl bg-rose-950/70 border border-rose-500/40 text-xs text-rose-300 flex items-start gap-2 animate-in fade-in duration-200">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300 block">
                  Official Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@piramal.com"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300 block">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 mt-2"
              >
                {submitting ? "Authenticating..." : `Sign In as ${selectedRole}`}
                {!submitting && <ArrowRight className="w-4 h-4" />}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
