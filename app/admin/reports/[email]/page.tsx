"use client";

import React, { useState, useEffect } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DailyActivityLog } from "@/lib/types";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Download,
  Gamepad2,
  HelpCircle,
  Search,
  CheckCircle2,
} from "lucide-react";

export default function IndividualAgentReportPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const emailParam = (params?.email as string) || "";
  const dateParam = searchParams.get("date") || new Date().toISOString().split("T")[0];

  const [email, setEmail] = useState(decodeURIComponent(emailParam));
  const [date, setDate] = useState(dateParam);
  const [profile, setProfile] = useState<any>(null);
  const [activity, setActivity] = useState<DailyActivityLog | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!email) return;

    const fetchReport = async () => {
      setLoading(true);
      try {
        const userSnap = await getDoc(doc(db, "users", email.toLowerCase()));
        const actSnap = await getDoc(doc(db, "daily_activity", `${email.toLowerCase()}_${date}`));

        setProfile(userSnap.exists() ? userSnap.data() : null);
        setActivity(actSnap.exists() ? (actSnap.data() as DailyActivityLog) : null);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [email, date]);

  const totalSeconds = (() => {
    let sec = 0;
    if (activity?.pageVisits) {
      Object.values(activity.pageVisits).forEach((s) => (sec += s));
    }
    return sec;
  })();

  const quizzesCompleted = profile?.quizCompleted || [];
  const quizScores = profile?.quizScores || {};

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push("/admin/overview")}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-full shadow-xs transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Overview</span>
        </button>

        <div className="flex items-center gap-2 bg-white border border-slate-200 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-700">
          <Calendar className="w-4 h-4 text-blue-600" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-transparent outline-none cursor-pointer"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-slate-400">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm">Compiling agent activity report...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-blue-600 text-white font-extrabold text-2xl flex items-center justify-center overflow-hidden shadow-md">
                {profile?.photoURL ? (
                  <img src={profile.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  (profile?.displayName || email).charAt(0).toUpperCase()
                )}
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{profile?.displayName || email.split("@")[0]}</h1>
                <div className="text-xs text-slate-400">{email}</div>
              </div>
            </div>

            <div className="text-right">
              <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-3.5 py-1.5 rounded-xl">
                Date: {date}
              </span>
            </div>
          </div>

          {/* 3 KPI Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs text-center">
              <Download className="w-6 h-6 text-blue-600 mx-auto mb-2" />
              <div className="text-2xl font-extrabold text-slate-900">
                {activity?.filesDownloaded || 0}
              </div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Files Downloaded
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs text-center">
              <Gamepad2 className="w-6 h-6 text-emerald-600 mx-auto mb-2" />
              <div className="text-2xl font-extrabold text-slate-900">{quizzesCompleted.length}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Quizzes Completed
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs text-center">
              <Clock className="w-6 h-6 text-purple-600 mx-auto mb-2" />
              <div className="text-2xl font-extrabold text-slate-900">
                {totalSeconds < 60 ? `${totalSeconds}s` : `${Math.floor(totalSeconds / 60)}m`}
              </div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Time Active Today
              </div>
            </div>
          </div>

          {/* Detailed Distribution & Scores */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Searches & Page Times */}
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Search className="w-4 h-4 text-blue-600" />
                  <span>Search History</span>
                </h3>
                <div className="space-y-2">
                  {activity?.searches && activity.searches.length > 0 ? (
                    activity.searches.map((s, i) => (
                      <div
                        key={i}
                        className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-medium"
                      >
                        &quot;{s}&quot;
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-400 py-4 text-center">No searches recorded today.</div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-500" />
                  <span>Time Spent per Page</span>
                </h3>
                <div className="space-y-3">
                  {activity?.pageVisits && Object.keys(activity.pageVisits).length > 0 ? (
                    Object.entries(activity.pageVisits).map(([p, sec]) => (
                      <div key={p} className="space-y-1 text-xs">
                        <div className="flex justify-between font-semibold text-slate-700">
                          <span>{p.replace(".html", "").toUpperCase()}</span>
                          <span>{Math.ceil(sec / 60)} mins</span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-600 rounded-full"
                            style={{ width: `${Math.min(100, Math.max(5, (sec / 600) * 100))}%` }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-400 py-4 text-center">No page time logged.</div>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Lifetime Quiz Scores */}
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Gamepad2 className="w-4 h-4 text-emerald-600" />
                <span>Lifetime Assessment Scores</span>
              </h3>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {quizzesCompleted.length === 0 ? (
                  <div className="text-xs text-slate-400 py-8 text-center">No quizzes completed yet.</div>
                ) : (
                  quizzesCompleted.map((qId: string) => {
                    const score = quizScores[qId] !== undefined ? quizScores[qId] : "N/A";
                    return (
                      <div
                        key={qId}
                        className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                      >
                        <span className="font-bold text-slate-800">{qId.replace("Q", "Quiz ")}</span>
                        <span className="bg-emerald-50 text-emerald-800 font-bold px-2.5 py-0.5 rounded-full text-xs">
                          Score: {score}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
