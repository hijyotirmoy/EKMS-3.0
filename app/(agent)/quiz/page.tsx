"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { doc, setDoc, updateDoc, arrayUnion, increment } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getOrFetchCollection } from "@/lib/cache";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { Quiz } from "@/lib/types";
import { logUserActivity } from "@/lib/activityLogger";
import { createNotification, notifyAdmins } from "@/lib/notificationService";
import {
  Gamepad2,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Monitor,
  Award,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Flag,
  PieChart,
  X,
  ListOrdered,
} from "lucide-react";
import ReportIssueModal from "@/components/common/ReportIssueModal";

export default function QuizPage() {
  const { user, userProfile, isLoggedIn, openLoginModal, refreshProfile } = useAuth();
  const { toast, showAlert, showConfirm } = usePopup();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);

  // Instant local user quiz state (synchronizes immediately on submit)
  const [localCompleted, setLocalCompleted] = useState<string[]>([]);
  const [localScores, setLocalScores] = useState<Record<string, number>>({});

  useEffect(() => {
    if (userProfile?.quizCompleted) setLocalCompleted(userProfile.quizCompleted);
    if (userProfile?.quizScores) setLocalScores(userProfile.quizScores);
  }, [userProfile]);

  // Active Quiz Examination State
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [userAnswers, setUserAnswers] = useState<Record<number, number>>({});
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [tabWarningOpen, setTabWarningOpen] = useState(false);
  const [warningTimer, setWarningTimer] = useState(10);
  const [examFinished, setExamFinished] = useState(false);
  const [submittedScore, setSubmittedScore] = useState<{ score: number; total: number } | null>(null);

  // Analytics View
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  // Report Modal
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; title: string }>({ id: "", title: "" });

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Fetch Quizzes with smart browser cache
  useEffect(() => {
    let isMounted = true;

    const loadQuizzes = async () => {
      try {
        const list = await getOrFetchCollection<Quiz>("quizzes");
        if (isMounted) {
          setQuizzes(list);
          setLoading(false);
        }
      } catch (err) {
        console.error("Quizzes load error:", err);
        if (isMounted) setLoading(false);
      }
    };

    loadQuizzes();

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Anti-Cheating: Tab Switch Monitor
  useEffect(() => {
    if (!activeQuiz || examFinished) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        setTabSwitchCount((prev) => {
          const nextCount = prev + 1;
          if (nextCount === 1) {
            setTabWarningOpen(true);
            setWarningTimer(10);
          } else if (nextCount >= 2) {
            // Second strike -> Auto-submit immediately
            handleFinishExam(true);
          }
          return nextCount;
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [activeQuiz, examFinished]);

  // Warning countdown timer
  useEffect(() => {
    if (!tabWarningOpen) return;
    const interval = setInterval(() => {
      setWarningTimer((t) => {
        if (t <= 1) {
          setTabWarningOpen(false);
          clearInterval(interval);
          return 10;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [tabWarningOpen]);

  // Exam Countdown Timer
  useEffect(() => {
    if (!activeQuiz || examFinished) return;

    timerRef.current = setInterval(() => {
      setTimeRemaining((t) => {
        if (t <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleFinishExam(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeQuiz, examFinished]);

  // User's Taken Quizzes and Scores Map (Combines local immediate state and profile)
  const completedMap = useMemo(() => {
    const list = localCompleted.length > 0 ? localCompleted : (userProfile?.quizCompleted || []);
    return list;
  }, [localCompleted, userProfile]);

  const scoresMap = useMemo(() => {
    return Object.keys(localScores).length > 0 ? localScores : (userProfile?.quizScores || {});
  }, [localScores, userProfile]);

  // Personal Metrics
  const personalMetrics = useMemo(() => {
    const total = quizzes.filter((q) => q.active).length;
    let taken = 0;
    let passed = 0;
    let totalPct = 0;
    const history: Array<{ quiz: Quiz; score: number; pct: number; passed: boolean }> = [];

    quizzes.forEach((q) => {
      if (completedMap.includes(q.id)) {
        taken++;
        const rawScore = scoresMap[q.id] || 0;
        const pct = q.questions > 0 ? Math.round((rawScore / q.questions) * 100) : 0;
        const isPass = pct >= 70;
        if (isPass) passed++;
        totalPct += pct;
        history.push({ quiz: q, score: rawScore, pct, passed: isPass });
      }
    });

    const avgScore = taken > 0 ? Math.round(totalPct / taken) : 0;
    const passRate = taken > 0 ? Math.round((passed / taken) * 100) : 0;

    history.sort((a, b) => b.pct - a.pct);
    const strongest = history.slice(0, 5);
    const weakest = [...history].filter((h) => h.pct < 90).sort((a, b) => a.pct - b.pct).slice(0, 5);

    return {
      total,
      taken,
      pending: Math.max(0, total - taken),
      avgScore,
      passRate,
      strongest,
      weakest,
      history,
    };
  }, [quizzes, completedMap, scoresMap]);

  // Launch Assessment
  const handleStartExam = (quiz: Quiz) => {
    if (!isLoggedIn || !user) {
      openLoginModal();
      return;
    }

    // Workstation Desktop Check
    const isMobile =
      typeof window !== "undefined" &&
      (window.innerWidth <= 800 ||
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));

    if (isMobile && quiz.mobileAllowed !== true) {
      toast.warning("This assessment requires a desktop workstation. Mobile access is restricted by policy.");
      return;
    }

    setActiveQuiz(quiz);
    setUserAnswers({});
    setTimeRemaining(quiz.time * 60);
    setTabSwitchCount(0);
    setExamFinished(false);
    setSubmittedScore(null);
  };

  // Submit Exam
  const handleFinishExam = async (forced = false) => {
    if (!activeQuiz || !user) return;
    if (timerRef.current) clearInterval(timerRef.current);

    // Grade exam
    let score = 0;
    activeQuiz.questionData.forEach((q, idx) => {
      const selected = userAnswers[idx];
      if (selected === Number(q.correct)) {
        score++;
      }
    });

    setSubmittedScore({ score, total: activeQuiz.questions });
    setExamFinished(true);

    // Update local state immediately so UI updates in real-time
    setLocalCompleted((prev) => Array.from(new Set([...prev, activeQuiz.id])));
    setLocalScores((prev) => ({ ...prev, [activeQuiz.id]: score }));
    setQuizzes((prev) =>
      prev.map((q) => (q.id === activeQuiz.id ? { ...q, attempts: (q.attempts || 0) + 1 } : q))
    );

    // Save to Firestore
    try {
      const userDocRef = doc(db, "users", user.email?.toLowerCase() || "");
      await setDoc(
        userDocRef,
        {
          quizCompleted: arrayUnion(activeQuiz.id),
          quizScores: {
            [activeQuiz.id]: score,
          },
        },
        { merge: true }
      );

      // Increment quiz attempts count
      const quizDocRef = doc(db, "quizzes", activeQuiz.id);
      await updateDoc(quizDocRef, { attempts: increment(1) });
      logUserActivity(user.email, {
        desc: `Completed quiz: "${activeQuiz.title}" (Score: ${score}/${activeQuiz.questions})`,
        type: "quiz",
      });

      const pct = Math.round((score / activeQuiz.questions) * 100);

      // 1. Notify User
      if (user.email) {
        await createNotification({
          title: `🏆 Quiz Completed: ${activeQuiz.title}`,
          message: `You completed the assessment **"${activeQuiz.title}"** with a score of **${score}/${activeQuiz.questions}** (${pct}%).`,
          type: "quiz",
          targetEmail: user.email.toLowerCase().trim(),
          link: "/quiz",
        });
      }

      // 2. Notify Admins & Master Admins
      await notifyAdmins({
        title: `🏆 Quiz Attempt: ${activeQuiz.title}`,
        message: `**${userProfile?.displayName || user.email || "Agent"}** completed the assessment **"${activeQuiz.title}"** (Score: ${score}/${activeQuiz.questions} • ${pct}%).`,
        type: "quiz",
        link: "/admin/quiz",
      });

      await refreshProfile();
    } catch (e) {
      console.error("Failed to sync score to database:", e);
    }
  };

  return (
    <div className="space-y-8">
      {/* ----------------------------------------------------
          ACTIVE QUIZ EXAMINATION TAKER VIEW
          ---------------------------------------------------- */}
      {activeQuiz ? (
        <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-200">
          {/* Sticky Timer Bar */}
          <div className="sticky top-16 z-30 bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl p-4 shadow-md flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  const confirmed = await showConfirm({
                    title: "Exit Assessment?",
                    message: "Are you sure you want to exit? Your exam progress will be lost.",
                    isDestructive: true,
                    confirmText: "Exit Assessment",
                  });
                  if (confirmed) {
                    setActiveQuiz(null);
                  }
                }}
                className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-full"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div>
                <h2 className="font-bold text-slate-900 text-sm sm:text-base leading-tight">
                  {activeQuiz.title}
                </h2>
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                  {activeQuiz.questions} Questions • {activeQuiz.time} Mins
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3.5 py-1.5 bg-rose-50 text-rose-700 font-mono font-bold text-sm rounded-xl border border-rose-200">
              <Clock className="w-4 h-4 text-rose-600" />
              <span>
                {Math.floor(timeRemaining / 60)
                  .toString()
                  .padStart(2, "0")}
                :{(timeRemaining % 60).toString().padStart(2, "0")}
              </span>
            </div>
          </div>

          {/* Results Summary if Finished */}
          {examFinished && submittedScore && (
            <div className="bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-lg space-y-4">
              <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto">
                <Award className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-extrabold text-slate-900">Assessment Complete!</h2>
              <div className="text-4xl font-extrabold text-blue-600">
                {submittedScore.score}{" "}
                <span className="text-xl text-slate-400 font-normal">/ {submittedScore.total}</span>
              </div>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Score: {Math.round((submittedScore.score / submittedScore.total) * 100)}% (
                {Math.round((submittedScore.score / submittedScore.total) * 100) >= 70
                  ? "Passed"
                  : "Needs Improvement"}
                )
              </p>
              <button
                onClick={() => setActiveQuiz(null)}
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-sm"
              >
                Return to Quizzes Feed
              </button>
            </div>
          )}

          {/* Questions List */}
          <div className="space-y-4">
            {activeQuiz.questionData.map((q, qIdx) => {
              const selectedOpt = userAnswers[qIdx];
              const isCorrect = selectedOpt === Number(q.correct);

              return (
                <div
                  key={qIdx}
                  className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-slate-900 text-sm">
                      {qIdx + 1}. {q.text}
                    </h3>
                  </div>

                  <div className="space-y-2">
                    {q.options.map((opt, optIdx) => {
                      const optNum = optIdx + 1;
                      const isSelected = selectedOpt === optNum;
                      const isOptionCorrect = Number(q.correct) === optNum;

                      let labelStyle = "border-slate-200 hover:bg-slate-50";
                      if (examFinished) {
                        if (isOptionCorrect) {
                          labelStyle = "border-emerald-500 bg-emerald-50 text-emerald-900 font-semibold";
                        } else if (isSelected && !isOptionCorrect) {
                          labelStyle = "border-rose-500 bg-rose-50 text-rose-900 line-through";
                        }
                      } else if (isSelected) {
                        labelStyle = "border-blue-600 bg-blue-50/50 ring-1 ring-blue-600 font-semibold";
                      }

                      return (
                        <label
                          key={optIdx}
                          className={`flex items-center gap-3 p-3.5 bg-white border rounded-xl text-xs cursor-pointer transition-all ${labelStyle}`}
                        >
                          <input
                            type="radio"
                            name={`exam_q_${qIdx}`}
                            value={optNum}
                            checked={isSelected}
                            disabled={examFinished}
                            onChange={() =>
                              setUserAnswers((prev) => ({
                                ...prev,
                                [qIdx]: optNum,
                              }))
                            }
                            className="w-4 h-4 text-blue-600"
                          />
                          <span className="flex-1">{opt}</span>
                          {examFinished && isOptionCorrect && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Submit Button */}
          {!examFinished && (
            <button
              onClick={() => handleFinishExam(false)}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-2xl shadow-md transition-colors"
            >
              Submit Assessment
            </button>
          )}

          {/* Anti-Cheating Warning Modal */}
          {tabWarningOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="bg-white max-w-sm w-full rounded-2xl shadow-2xl p-6 text-center space-y-4 border border-rose-200">
                <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Warning: Tab Switch Detected!</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Switching tabs or minimizing the browser is a violation of examination integrity.{" "}
                  <strong className="text-rose-600 block mt-1">
                    If you switch tabs again, your test will be auto-submitted immediately!
                  </strong>
                </p>
                <div className="text-xs font-bold text-slate-400">
                  Dismissing in {warningTimer}s...
                </div>
                <button
                  onClick={() => setTabWarningOpen(false)}
                  className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl shadow-sm"
                >
                  I Understand, Resume Test
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ----------------------------------------------------
            MAIN ASSESSMENTS FEED & ANALYTICS
            ---------------------------------------------------- */
        <div className="space-y-8">
          {/* Header with button in parallel on mobile & desktop */}
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Quizzes
              </h1>
            </div>
            <button
              onClick={() => setAnalyticsOpen(true)}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 font-semibold text-xs rounded-xl shadow-xs transition-colors shrink-0"
            >
              <PieChart className="w-4 h-4" />
              <span>My Analytics</span>
            </button>
          </div>

          {/* 4 Performance Metric Cards (2 in a row on mobile) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-blue-50/70 border border-blue-200 p-3.5 rounded-xl flex flex-col justify-between">
              <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">Total Quizzes</div>
              <div className="text-xl sm:text-2xl font-black text-blue-900 mt-1">{personalMetrics.total}</div>
            </div>

            <div className="bg-emerald-50/70 border border-emerald-200 p-3.5 rounded-xl flex flex-col justify-between">
              <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Completed / Left</div>
              <div className="text-xl sm:text-2xl font-black text-emerald-900 mt-1">
                {personalMetrics.taken} / {personalMetrics.pending}
              </div>
            </div>

            <div className="bg-amber-50/70 border border-amber-200 p-3.5 rounded-xl flex flex-col justify-between">
              <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Average Score</div>
              <div className="text-xl sm:text-2xl font-black text-amber-900 mt-1">{personalMetrics.avgScore}%</div>
            </div>

            <div className="bg-purple-50/70 border border-purple-200 p-3.5 rounded-xl flex flex-col justify-between">
              <div className="text-[10px] font-bold text-purple-800 uppercase tracking-wider">Pass Rate</div>
              <div className="text-xl sm:text-2xl font-black text-purple-900 mt-1">{personalMetrics.passRate}%</div>
            </div>
          </div>

          {/* Quizzes Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {loading ? (
              <div className="col-span-full text-center py-16 text-slate-400">
                <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm">Loading available assessments...</p>
              </div>
            ) : quizzes.length === 0 ? (
              <div className="col-span-full bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-xs">
                <Gamepad2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <h3 className="text-base font-bold text-slate-800 mb-1">No Quizzes Available</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Check back soon! New assessments will be published here.
                </p>
              </div>
            ) : (
              quizzes.map((quiz) => {
                const isTaken = completedMap.includes(quiz.id);
                const score = scoresMap[quiz.id] !== undefined ? scoresMap[quiz.id] : 0;

                return (
                  <div
                    key={quiz.id}
                    className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between space-y-4 relative group"
                  >
                    {/* Top Row: Quiz ID & Score / Report */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-extrabold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                        {quiz.id.replace("Q", "QUIZ ")}
                      </span>

                      <div className="flex items-center gap-2">
                        {isTaken && (
                          <span className="bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded text-[10px]">
                            Score: {score}/{quiz.questions}
                          </span>
                        )}
                        <button
                          onClick={() => {
                            setReportTarget({ id: quiz.id, title: quiz.title });
                            setReportModalOpen(true);
                          }}
                          className="text-slate-300 hover:text-rose-600 p-1 rounded transition-colors"
                          title="Report Issue with Quiz"
                        >
                          <Flag className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Title & Metadata */}
                    <div className="space-y-2 flex-1">
                      <h3 className="font-bold text-slate-900 text-base leading-snug line-clamp-2">
                        {quiz.title}
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-slate-400 font-medium">
                        <span className="flex items-center gap-1">
                          <ListOrdered className="w-3.5 h-3.5" /> {quiz.questions} Qs
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" /> {quiz.time} Mins
                        </span>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="pt-3 border-t border-slate-100">
                      {isTaken ? (
                        <div className="w-full py-2.5 bg-emerald-50 text-emerald-700 font-bold text-xs rounded-xl text-center flex items-center justify-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Assessment Completed</span>
                        </div>
                      ) : !quiz.active ? (
                        <div className="w-full py-2.5 bg-slate-100 text-slate-400 font-bold text-xs rounded-xl text-center">
                          Currently Inactive
                        </div>
                      ) : (
                        <button
                          onClick={() => handleStartExam(quiz)}
                          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
                        >
                          Take Assessment
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Personal Performance Analytics Modal */}
          {analyticsOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <div className="bg-white max-w-2xl w-full rounded-3xl shadow-2xl p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto border border-slate-100">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-2.5 text-purple-700 font-bold text-lg">
                    <PieChart className="w-6 h-6" />
                    <span>My Quiz Performance Analytics</span>
                  </div>
                  <button
                    onClick={() => setAnalyticsOpen(false)}
                    className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Top KPI row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="text-xl font-bold text-slate-800">{personalMetrics.taken}</div>
                    <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400">
                      Completed
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="text-xl font-bold text-slate-800">{personalMetrics.pending}</div>
                    <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400">
                      Pending
                    </div>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                    <div className="text-xl font-bold text-emerald-700">{personalMetrics.avgScore}%</div>
                    <div className="text-[9px] uppercase tracking-wider font-bold text-emerald-600">
                      Average Score
                    </div>
                  </div>
                  <div className="p-3 bg-purple-50 rounded-xl border border-purple-200">
                    <div className="text-xl font-bold text-purple-700">{personalMetrics.passRate}%</div>
                    <div className="text-[9px] uppercase tracking-wider font-bold text-purple-600">
                      Pass Rate
                    </div>
                  </div>
                </div>

                {/* Strengths and Weaknesses */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-2">
                    <div className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                      Top 5 Strongest Topics
                    </div>
                    <div className="divide-y divide-emerald-100 text-xs">
                      {personalMetrics.strongest.length > 0 ? (
                        personalMetrics.strongest.map((item, i) => (
                          <div key={i} className="py-1.5 flex justify-between">
                            <span className="truncate pr-2 font-medium text-slate-800">
                              {item.quiz.title}
                            </span>
                            <span className="font-bold text-emerald-700">{item.pct}%</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-slate-400 py-2">No quizzes taken yet.</div>
                      )}
                    </div>
                  </div>

                  <div className="p-4 bg-rose-50/60 border border-rose-200 rounded-2xl space-y-2">
                    <div className="text-xs font-bold text-rose-800 uppercase tracking-wider">
                      Areas to Improve
                    </div>
                    <div className="divide-y divide-rose-100 text-xs">
                      {personalMetrics.weakest.length > 0 ? (
                        personalMetrics.weakest.map((item, i) => (
                          <div key={i} className="py-1.5 flex justify-between">
                            <span className="truncate pr-2 font-medium text-slate-800">
                              {item.quiz.title}
                            </span>
                            <span className="font-bold text-rose-700">{item.pct}%</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-slate-400 py-2">No weak areas identified!</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Full History */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Full Attempt History
                  </h4>
                  <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 text-xs">
                    {personalMetrics.history.map((h, i) => (
                      <div key={i} className="p-3 flex items-center justify-between bg-white">
                        <span className="font-medium text-slate-800">{h.quiz.title}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-400">
                            {h.score}/{h.quiz.questions}
                          </span>
                          <span
                            className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                              h.passed ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {h.pct}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Report Modal */}
      <ReportIssueModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        targetId={reportTarget.id}
        reportType="Quiz"
        targetCodeOrName={reportTarget.title}
      />
    </div>
  );
}
