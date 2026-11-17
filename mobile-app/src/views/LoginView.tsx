import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Lock, Mail, ArrowRight, ShieldCheck, AlertCircle } from "lucide-react";

export default function LoginView() {
  const { loginWithRole } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;

    setLoading(true);
    setErrorMsg("");

    const res = await loginWithRole("Agent", email, password);
    if (!res.success) {
      setErrorMsg(res.error || "Failed to sign in. Please verify your credentials.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center px-6 py-12 pt-safe pb-safe">
      <div className="w-full max-w-sm mx-auto space-y-8">
        {/* App Branding Header */}
        <div className="text-center space-y-3">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-tr from-blue-600 to-indigo-600 p-1 shadow-2xl shadow-blue-500/30 flex items-center justify-center">
            <div className="w-full h-full rounded-[22px] bg-slate-950 flex items-center justify-center p-3">
              <img src="/ekms-logo.png" alt="EKMS Logo" className="w-full h-full object-contain" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">EKMS Mobile</h1>
            <p className="text-xs text-slate-400 mt-1">
              Enterprise Knowledge Management &amp; Field Booking
            </p>
          </div>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="p-3.5 rounded-2xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-300 flex items-start gap-2.5 animate-in fade-in duration-200">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
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
                placeholder="agent@piramal.com"
                className="w-full pl-10 pr-4 py-3 rounded-2xl bg-slate-900 border border-slate-800 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
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
                className="w-full pl-10 pr-4 py-3 rounded-2xl bg-slate-900 border border-slate-800 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-xl shadow-blue-600/30 flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 mt-2"
          >
            {loading ? "Signing In..." : "Sign In to Portal"}
            {!loading && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

        <div className="text-center pt-4">
          <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
            Connected directly to Piramal ESIC Firebase Auth
          </p>
        </div>
      </div>
    </div>
  );
}
