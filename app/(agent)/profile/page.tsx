"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { usePopup } from "@/context/PopupContext";
import { getBase64Image, timeAgo } from "@/lib/utils";
import {
  User,
  Camera,
  Edit2,
  Calendar,
  Key,
  LogOut,
  Flame,
  ClipboardCheck,
  Star,
  CheckCircle2,
  HelpCircle,
  Clock,
  Cake,
  Shield,
  Crown,
  Headphones,
  Check,
  X,
} from "lucide-react";

interface TimelineItem {
  type: string;
  desc: string;
  timestamp: number;
  icon: any;
  color: string;
}

export default function ProfilePage() {
  const { user, userProfile, updateProfileData, logout, isLoggedIn, openLoginModal } = useAuth();
  const { toast, showAlert } = usePopup();
  const router = useRouter();

  // Edit Modals
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);

  const [dobModalOpen, setDobModalOpen] = useState(false);
  const [newDob, setNewDob] = useState("");
  const [dobSaving, setDobSaving] = useState(false);

  const [photoUploading, setPhotoUploading] = useState(false);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);

  // Performance Stats State
  const [doubtsResolvedCount, setDoubtsResolvedCount] = useState(0);

  // 1. Fetch Timeline & Activity
  useEffect(() => {
    if (!user?.email) return;
    const email = user.email.toLowerCase();

    const fetchActivity = async () => {
      const items: TimelineItem[] = [];

      try {
        // User created
        if (userProfile?.createdAt) {
          items.push({
            type: "Profile Created",
            desc: "Joined the ESIC KMS enterprise knowledge platform",
            timestamp: userProfile.createdAt,
            icon: User,
            color: "text-blue-600",
          });
        }

        // Quizzes taken
        if (userProfile?.quizCompleted && userProfile.quizCompleted.length > 0) {
          userProfile.quizCompleted.forEach((qId, idx) => {
            items.push({
              type: "Completed Assessment",
              desc: `Assessment ${qId.replace("Q", "Quiz ")} successfully completed`,
              timestamp: Date.now() - (idx + 1) * 3600000,
              icon: ClipboardCheck,
              color: "text-purple-600",
            });
          });
        }

        // Doubts asked
        const qAsked = query(collection(db, "doubts"), where("authorEmail", "==", email));
        const askedSnap = await getDocs(qAsked);
        askedSnap.forEach((doc) => {
          const d = doc.data();
          items.push({
            type: "Asked a Doubt",
            desc: d.question ? d.question.substring(0, 45) + "..." : "Community query",
            timestamp: d.createdAt || Date.now(),
            icon: HelpCircle,
            color: "text-amber-500",
          });
        });

        // Doubts resolved
        const qRes = query(collection(db, "doubts"), where("resolvedByEmail", "==", email));
        const resSnap = await getDocs(qRes);
        setDoubtsResolvedCount(resSnap.size);
        resSnap.forEach((doc) => {
          const d = doc.data();
          items.push({
            type: "Resolved a Doubt",
            desc: d.question ? d.question.substring(0, 45) + "..." : "Agent query resolution",
            timestamp: d.resolvedAt || d.updatedAt || Date.now(),
            icon: CheckCircle2,
            color: "text-emerald-600",
          });
        });

        items.sort((a, b) => b.timestamp - a.timestamp);
        setTimeline(items.slice(0, 20));
      } catch (e) {
        console.error("Activity timeline error:", e);
      }
    };

    fetchActivity();
  }, [user, userProfile]);

  // 2. Profile Completion Percentage
  const { completionPct, missingItems } = useMemo(() => {
    let pct = 0;
    const missing: string[] = [];

    if (userProfile?.photoURL) {
      pct += 34;
    } else {
      missing.push("Profile Photo");
    }

    const defaultName = user?.email?.split("@")[0] || "";
    if (userProfile?.displayName && userProfile.displayName !== defaultName) {
      pct += 33;
    } else {
      missing.push("Full Name");
    }

    if (userProfile?.dob) {
      pct += 33;
    } else {
      missing.push("Date of Birth");
    }

    return { completionPct: Math.min(100, pct), missingItems: missing };
  }, [userProfile, user]);

  // 3. Handlers
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhotoUploading(true);
    try {
      const dataUri = await getBase64Image(file, 600, 0.75);
      await updateProfileData({ photoURL: dataUri });

      // Silent backup to Drive script if endpoint exists
      const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL;
      if (scriptUrl) {
        fetch(scriptUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({
            name: `profile_${user?.uid}_${file.name}`,
            type: file.type,
            base64: dataUri.split(",")[1],
          }),
        }).catch((err) => console.log("Drive silent backup sent", err));
      }

      toast.success("Profile photo updated successfully!");
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to update photo.");
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setNameSaving(true);
    try {
      await updateProfileData({ displayName: newName.trim(), name: newName.trim() });
      setNameModalOpen(false);
      toast.success("Name updated successfully!");
    } catch (err) {
      toast.error("Failed to update name.");
    } finally {
      setNameSaving(false);
    }
  };

  const handleSaveDob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDob) return;
    setDobSaving(true);
    try {
      await updateProfileData({ dob: newDob });
      setDobModalOpen(false);
      toast.success("Date of birth updated successfully!");
    } catch (err) {
      toast.error("Failed to update date of birth.");
    } finally {
      setDobSaving(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!user?.email) return;
    try {
      await sendPasswordResetEmail(auth, user.email);
      showAlert({
        title: "Password Reset Sent",
        message: `A secure password reset link has been dispatched to ${user.email}. Please check your inbox or spam folder.`,
        type: "success",
      });
    } catch (err: any) {
      toast.error("Failed to send reset email: " + err.message);
    }
  };

  const handleSignOut = async () => {
    await logout();
    router.push("/");
  };

  if (!isLoggedIn || !user) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center">
          <User className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">Sign in to View Profile</h2>
        <p className="text-xs text-slate-500 max-w-sm">
          Access your personal learning streak, certifications, and operational settings.
        </p>
        <button
          onClick={openLoginModal}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm"
        >
          Sign In Now
        </button>
      </div>
    );
  }

  const role = userProfile?.role || "Agent";
  const streak = userProfile?.streak || 1;
  const quizzesTaken = userProfile?.quizCompleted?.length || 0;
  const avgScore = userProfile?.avgScore || 0;

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-200">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Agent Command Center</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* ----------------------------------------------------
            LEFT COLUMN: IDENTITY & SECURITY CARDS (5 COLS)
            ---------------------------------------------------- */}
        <div className="lg:col-span-5 space-y-6">
          {/* Identity Card */}
          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
            <div className="p-8 text-center bg-gradient-to-b from-slate-50 to-white border-b border-slate-100 space-y-4">
              {/* Photo Upload Avatar */}
              <div className="relative w-28 h-28 mx-auto group">
                <div className="w-full h-full rounded-full bg-blue-600 text-white text-3xl font-extrabold flex items-center justify-center overflow-hidden border-4 border-white shadow-md">
                  {userProfile?.photoURL ? (
                    <img src={userProfile.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    (userProfile?.displayName || user.email || "A").charAt(0).toUpperCase()
                  )}
                </div>
                <label
                  htmlFor="profilePhotoInput"
                  className="absolute bottom-0 right-0 p-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-full shadow-md cursor-pointer transition-transform hover:scale-105"
                  title="Upload New Photo"
                >
                  <Camera className="w-4 h-4 text-blue-600" />
                  <input
                    id="profilePhotoInput"
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Name & Role */}
              <div>
                <button
                  onClick={() => {
                    setNewName(userProfile?.displayName || "");
                    setNameModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-xl font-bold text-slate-900 hover:text-blue-600 transition-colors"
                >
                  <span>{userProfile?.displayName || user.email?.split("@")[0]}</span>
                  <Edit2 className="w-3.5 h-3.5 text-slate-400" />
                </button>
                <div className="text-xs text-slate-400 mt-0.5">{user.email}</div>
              </div>

              <div>
                <span
                  className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                    role === "Master Admin"
                      ? "bg-rose-50 text-rose-700 border border-rose-200"
                      : role === "Admin"
                      ? "bg-purple-50 text-purple-700 border border-purple-200"
                      : "bg-blue-50 text-blue-700 border border-blue-200"
                  }`}
                >
                  {role === "Master Admin" ? (
                    <Crown className="w-3.5 h-3.5" />
                  ) : role === "Admin" ? (
                    <Shield className="w-3.5 h-3.5" />
                  ) : (
                    <Headphones className="w-3.5 h-3.5" />
                  )}
                  <span>{role}</span>
                </span>
              </div>
            </div>

            {/* Profile Completion Bar */}
            <div className="p-6 border-b border-slate-100 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-slate-700">Profile Completion</span>
                <span className={completionPct === 100 ? "text-emerald-600" : "text-blue-600"}>
                  {completionPct}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${completionPct}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-400">
                {completionPct === 100
                  ? "Your profile is 100% complete!"
                  : `Add ${missingItems.join(", ")} to reach 100%.`}
              </p>
            </div>

            {/* Identity Details list */}
            <div className="divide-y divide-slate-100 text-xs">
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-slate-600">
                  <User className="w-4 h-4 text-blue-600" />
                  <span className="font-semibold">Agent ID</span>
                </div>
                <span className="font-mono font-bold text-slate-800">
                  {userProfile?.agentId || `#${user.uid.substring(0, 6).toUpperCase()}`}
                </span>
              </div>

              <div
                onClick={() => {
                  setNewDob(userProfile?.dob || "");
                  setDobModalOpen(true);
                }}
                className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer transition-colors group"
              >
                <div className="flex items-center gap-2.5 text-slate-600">
                  <Cake className="w-4 h-4 text-amber-500" />
                  <span className="font-semibold">Date of Birth</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-800 font-medium group-hover:text-blue-600">
                  <span>
                    {userProfile?.dob
                      ? new Date(userProfile.dob).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })
                      : "Not Set"}
                  </span>
                  <Edit2 className="w-3 h-3 text-slate-400 group-hover:text-blue-600" />
                </div>
              </div>
            </div>
          </div>

          {/* Security Card */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-600" />
              <span>Security & Account</span>
            </h3>

            <div className="space-y-2">
              <button
                onClick={handlePasswordReset}
                className="w-full flex items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100 rounded-xl text-xs font-semibold text-slate-700 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Key className="w-4 h-4 text-blue-600" />
                  <span>Send Password Reset Email</span>
                </div>
              </button>

              <button
                onClick={handleSignOut}
                className="w-full flex items-center justify-between p-3.5 bg-rose-50 hover:bg-rose-100 rounded-xl text-xs font-semibold text-rose-700 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <LogOut className="w-4 h-4 text-rose-600" />
                  <span>Sign Out of Account</span>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* ----------------------------------------------------
            RIGHT COLUMN: STREAKS, PERFORMANCE & TIMELINE (7 COLS)
            ---------------------------------------------------- */}
        <div className="lg:col-span-7 space-y-6">
          {/* Learning Streak Banner */}
          <div className="bg-gradient-to-r from-orange-500 to-amber-500 rounded-3xl p-6 sm:p-8 text-white shadow-md flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] font-extrabold uppercase tracking-widest bg-white/20 px-3 py-1 rounded-full">
                Learning Streak
              </span>
              <h2 className="text-2xl sm:text-3xl font-black flex items-center gap-2">
                <Flame className="w-7 h-7 fill-white text-white" />
                <span>{streak} Day Active Streak!</span>
              </h2>
              <p className="text-xs text-orange-100">
                You&apos;ve actively accessed training resources and portal operations daily.
              </p>
            </div>
            <div className="text-5xl font-black opacity-30 select-none hidden sm:block">🔥</div>
          </div>

          {/* 3 Performance KPI Cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs text-center">
              <ClipboardCheck className="w-6 h-6 text-emerald-600 mx-auto mb-2" />
              <div className="text-2xl font-extrabold text-slate-900">{quizzesTaken}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Quizzes Passed
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs text-center">
              <Star className="w-6 h-6 text-amber-500 mx-auto mb-2 fill-amber-400" />
              <div className="text-2xl font-extrabold text-slate-900">{avgScore}%</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Average Score
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs text-center">
              <CheckCircle2 className="w-6 h-6 text-purple-600 mx-auto mb-2" />
              <div className="text-2xl font-extrabold text-slate-900">{doubtsResolvedCount}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Doubts Resolved
              </div>
            </div>
          </div>

          {/* Recent Activity Timeline */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600" />
                <span>Recent Activity Timeline</span>
              </h3>
              <span className="text-[11px] text-slate-400 font-semibold">{timeline.length} Events</span>
            </div>

            <div className="space-y-4 max-h-[380px] overflow-y-auto pr-2">
              {timeline.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-xs">No recent activity logged.</div>
              ) : (
                timeline.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <div key={i} className="flex items-start gap-3.5 group">
                      <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:scale-110 transition-transform">
                        <Icon className={`w-4 h-4 ${item.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-slate-800">{item.type}</h4>
                          <span className="text-[10px] text-slate-400">{timeAgo(item.timestamp)}</span>
                        </div>
                        <p className="text-xs text-slate-500 leading-snug truncate mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* --- EDIT NAME MODAL --- */}
      {nameModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white max-w-sm w-full rounded-2xl shadow-2xl p-6 space-y-4 border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Change Display Name</h3>
              <button onClick={() => setNameModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveName} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Ramesh Chandra"
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNameModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={nameSaving}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  {nameSaving ? "Saving..." : "Save Name"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- EDIT DOB MODAL --- */}
      {dobModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white max-w-sm w-full rounded-2xl shadow-2xl p-6 space-y-4 border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Update Date of Birth</h3>
              <button onClick={() => setDobModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveDob} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Date of Birth
                </label>
                <input
                  type="date"
                  value={newDob}
                  onChange={(e) => setNewDob(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDobModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={dobSaving}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  {dobSaving ? "Saving..." : "Save Date of Birth"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
