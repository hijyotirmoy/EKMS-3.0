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
  GraduationCap,
  MessageSquare,
  Flag,
  User,
  Activity,
  SearchX,
} from "lucide-react";
import { getCountFromServer, query, collection, where } from "firebase/firestore";

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
  const [extraStats, setExtraStats] = useState({
    doubtsCount: 0,
    reportsCount: 0,
    coursesCompleted: 0,
    quizzesCompleted: 0,
  });

  useEffect(() => {
    if (!email) return;

    const fetchReport = async () => {
      setLoading(true);
      try {
        const cleanEmail = email.toLowerCase().trim();
        const [userSnap, actSnap, doubtsSnap, reportsSnap] = await Promise.all([
          getDoc(doc(db, "users", cleanEmail)),
          getDoc(doc(db, "daily_activity", `${cleanEmail}_${date}`)),
          getCountFromServer(query(collection(db, "doubts"), where("authorEmail", "==", cleanEmail))),
          getCountFromServer(query(collection(db, "reports"), where("reporterEmail", "==", cleanEmail))),
        ]);

        const prof = userSnap.exists() ? userSnap.data() : null;
        const quizDone = prof?.quizCompleted?.length || 0;
        const courseDone =
          prof?.coursesCompleted?.length ||
          (prof?.courseProgress
            ? Object.values(prof.courseProgress).filter((c: any) => c.status === "completed").length
            : 0);

        setExtraStats({
          doubtsCount: doubtsSnap.data().count,
          reportsCount: reportsSnap.data().count,
          coursesCompleted: courseDone,
          quizzesCompleted: quizDone,
        });

        setProfile(prof);
        setActivity(actSnap.exists() ? (actSnap.data() as DailyActivityLog) : null);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [email, date]);

  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return "0s";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const formatTimeOnly = (timestamp?: number) => {
    if (!timestamp) return "-";
    try {
      return new Date(timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return "-";
    }
  };

  const totalSeconds = (() => {
    let sec = activity?.totalSeconds || 0;
    if (!sec && activity?.pageVisits) {
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
          <span>Back to System Overview</span>
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
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
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

          {/* 8 KPI Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 sm:gap-4">
            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs text-center flex flex-col justify-between">
              <Clock className="w-5 h-5 text-blue-600 mx-auto mb-1.5" />
              <div className="text-lg font-black text-slate-900">{formatDuration(totalSeconds)}</div>
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Screen Time Active
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs text-center flex flex-col justify-between">
              <User className="w-5 h-5 text-purple-600 mx-auto mb-1.5" />
              <div className="text-lg font-black text-slate-900">{activity?.loginCount || 1}</div>
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Sessions Today
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs text-center flex flex-col justify-between">
              <Gamepad2 className="w-5 h-5 text-indigo-600 mx-auto mb-1.5" />
              <div className="text-lg font-black text-slate-900">
                {(() => {
                  const countFromEvents = (activity?.timelineEvents || []).filter(
                    (e) => e.type === "quiz" || e.desc.toLowerCase().includes("completed quiz")
                  ).length;
                  const dailyQuiz = countFromEvents || activity?.quizzesCompletedCount || 0;
                  return (
                    <>
                      {dailyQuiz} <span className="text-[10px] text-slate-400 font-normal">({extraStats.quizzesCompleted})</span>
                    </>
                  );
                })()}
              </div>
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Quizzes (Today)
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs text-center flex flex-col justify-between">
              <GraduationCap className="w-5 h-5 text-emerald-600 mx-auto mb-1.5" />
              <div className="text-lg font-black text-slate-900">{extraStats.coursesCompleted}</div>
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Courses Completed
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs text-center flex flex-col justify-between">
              <MessageSquare className="w-5 h-5 text-amber-600 mx-auto mb-1.5" />
              <div className="text-lg font-black text-slate-900">{extraStats.doubtsCount}</div>
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Doubts Posted
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs text-center flex flex-col justify-between">
              <Flag className="w-5 h-5 text-rose-600 mx-auto mb-1.5" />
              <div className="text-lg font-black text-slate-900">{extraStats.reportsCount}</div>
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Reports Submitted
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs text-center flex flex-col justify-between">
              <Download className="w-5 h-5 text-teal-600 mx-auto mb-1.5" />
              <div className="text-lg font-black text-slate-900">{activity?.filesDownloaded || 0}</div>
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Files Downloaded
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs text-center flex flex-col justify-between">
              <Search className="w-5 h-5 text-slate-600 mx-auto mb-1.5" />
              <div className="text-lg font-black text-slate-900">{activity?.searches?.length || 0}</div>
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Searches Executed
              </div>
            </div>
          </div>

          {/* 2-Column Grid: Left: Time Spent per Page | Right: Agent Daily Activity & Audit Trail */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Left: Time Spent per Page & Lifetime Quiz Scores */}
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-7 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                    <Clock className="w-5 h-5 text-amber-500" />
                    <span>Time Spent per Page</span>
                  </h3>
                  <span className="text-[11px] font-semibold text-slate-400">{date}</span>
                </div>
                <div className="space-y-3 max-h-64 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-200">
                  {activity?.pageVisits && Object.keys(activity.pageVisits).length > 0 ? (
                    Object.entries(activity.pageVisits).map(([p, sec]) => (
                      <div key={p} className="space-y-1.5 text-xs">
                        <div className="flex justify-between font-semibold text-slate-700">
                          <span>{p.replace(/[/._]/g, " ").trim().toUpperCase() || "HOME"}</span>
                          <span className="text-slate-500 font-bold">{formatDuration(sec)}</span>
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
                    <div className="text-xs text-slate-400 py-10 text-center">No page time logged for {date}.</div>
                  )}
                </div>
              </div>

              {/* Lifetime Quiz Scores */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-7 shadow-xs space-y-4">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 border-b border-slate-100 pb-3">
                  <Gamepad2 className="w-4 h-4 text-emerald-600" />
                  <span>Lifetime Assessment Scores</span>
                </h3>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {quizzesCompleted.length === 0 ? (
                    <div className="text-xs text-slate-400 py-6 text-center">No quizzes completed yet.</div>
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

            {/* Right: Agent Daily Activity & Audit Trail */}
            <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-7 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-600" />
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                    Daily Activity & Audit Trail
                  </h3>
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                    {(activity?.timelineEvents || []).length} Actions
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 font-medium">{date}</span>
              </div>

              <div className="max-h-[500px] overflow-y-auto space-y-2.5 pr-2 scrollbar-thin scrollbar-thumb-slate-200">
                {(!activity?.timelineEvents || activity.timelineEvents.length === 0) ? (
                  <div className="text-center py-16 text-slate-400 text-xs italic">
                    No activity events recorded for this agent on {date}.
                  </div>
                ) : (
                  [...(activity.timelineEvents)]
                    .reverse()
                    .map((evt, idx) => {
                      const timeStr = formatTimeOnly(evt.time);
                      const typeTag =
                        evt.type === "delete" || evt.icon === "Trash2"
                          ? "DELETED"
                          : evt.type === "add" || evt.icon === "PlusCircle"
                          ? "ADDED"
                          : evt.type === "edit" || evt.icon === "Edit"
                          ? "EDITED"
                          : evt.type === "report" || evt.color === "rose"
                          ? "REPORT"
                          : evt.type === "doubt" || evt.color === "amber"
                          ? "DOUBT"
                          : evt.type === "quiz" || evt.color === "purple"
                          ? "QUIZ"
                          : evt.type === "course" || evt.color === "emerald"
                          ? "COURSE"
                          : evt.type === "booking" || evt.color === "teal"
                          ? "BOOKING"
                          : evt.type === "facility"
                          ? "FACILITY"
                          : evt.type === "download"
                          ? "DOWNLOAD"
                          : evt.type === "profile"
                          ? "PROFILE"
                          : evt.type === "settings"
                          ? "SETTINGS"
                          : "ACTIVITY";

                      const colorStyles =
                        typeTag === "DELETED"
                          ? "bg-rose-50 text-rose-700 border-rose-200"
                          : typeTag === "ADDED"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : typeTag === "EDITED"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : typeTag === "REPORT"
                          ? "bg-rose-50 text-rose-700 border-rose-200"
                          : typeTag === "DOUBT"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : typeTag === "QUIZ"
                          ? "bg-purple-50 text-purple-700 border-purple-200"
                          : typeTag === "COURSE"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : typeTag === "BOOKING"
                          ? "bg-teal-50 text-teal-700 border-teal-200"
                          : typeTag === "FACILITY"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : typeTag === "DOWNLOAD"
                          ? "bg-teal-50 text-teal-700 border-teal-200"
                          : typeTag === "PROFILE"
                          ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                          : typeTag === "SETTINGS"
                          ? "bg-slate-100 text-slate-700 border-slate-300"
                          : "bg-slate-50 text-slate-700 border-slate-200";

                      return (
                        <div
                          key={idx}
                          className="flex items-start justify-between gap-3 p-3 bg-slate-50/70 border border-slate-200 rounded-2xl text-xs hover:bg-slate-50 transition-colors"
                        >
                          <div className="flex items-start gap-2.5 flex-1 min-w-0">
                            <span
                              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border shrink-0 ${colorStyles}`}
                            >
                              {typeTag}
                            </span>
                            <p className="text-slate-800 font-medium break-words leading-relaxed flex-1 pt-0.5">
                              {evt.desc}
                            </p>
                          </div>
                          <div className="text-[10px] font-semibold text-slate-400 shrink-0 whitespace-nowrap pt-1">
                            {timeStr}
                          </div>
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
