"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  doc,
  setDoc,
  updateDoc,
  arrayUnion,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getOrFetchCollection } from "@/lib/cache";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { Course, CourseUserProgress, MCQQuestion } from "@/lib/types";
import {
  recalculateCourseProgress,
  createSlug,
} from "@/lib/utils";
import {
  GraduationCap,
  Award,
  CheckCircle2,
  Lock,
  ChevronRight,
  BookOpen,
  HelpCircle,
  Clock,
  RotateCcw,
  Sparkles,
  Search,
  Flag,
  Lightbulb,
  ArrowLeft,
  ArrowRight,
  Star,
  PlayCircle,
  FileText,
  Download,
  Paperclip,
  AlertTriangle,
  XCircle,
  Edit3,
  Trash2,
} from "lucide-react";
import ReportIssueModal from "@/components/common/ReportIssueModal";

export default function OnboardingPage() {
  const { user, userProfile, isLoggedIn, openLoginModal, refreshProfile } = useAuth();
  const { toast } = usePopup();

  // State
  const [courses, setCourses] = useState<Course[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCourse, setActiveCourse] = useState<Course | null>(null);
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  // Local progress state for immediate real-time synchronization
  const [localProgress, setLocalProgress] = useState<Record<string, CourseUserProgress>>({});

  useEffect(() => {
    setLocalProgress(userProfile?.courseProgress || {});
  }, [userProfile?.courseProgress]);

  // Checkpoint Quiz form states
  const [checkpointAnswers, setCheckpointAnswers] = useState<Record<number, number>>({});
  const [submittingQuiz, setSubmittingQuiz] = useState(false);

  // 5-Star Rating form states
  const [ratingVal, setRatingVal] = useState(5);
  const [feedbackText, setFeedbackText] = useState("");
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [isEditingRating, setIsEditingRating] = useState(false);

  // Report Modal
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; title: string }>({ id: "", title: "" });

  // 1. Fetch Data with smart browser cache
  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      try {
        const [cList, uList] = await Promise.all([
          getOrFetchCollection<Course>("onboardings", { metaKey: "onboarding" }),
          getOrFetchCollection<any>("users"),
        ]);

        if (isMounted) {
          const activeList = cList.filter((c) => c.active);
          setCourses(activeList);
          setAllUsers(uList);
          setLoading(false);
        }
      } catch (err) {
        console.error("Onboarding data load error:", err);
        if (isMounted) setLoading(false);
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  // User's Course Progress Map
  const progressMap: Record<string, CourseUserProgress> = useMemo(() => {
    const map: Record<string, CourseUserProgress> = {};
    courses.forEach((c) => {
      const rawProg = localProgress[c.id] || userProfile?.courseProgress?.[c.id];
      map[c.id] = recalculateCourseProgress(c, rawProg);
    });
    return map;
  }, [courses, localProgress, userProfile]);

  // Overall Metrics
  const metrics = useMemo(() => {
    const total = courses.length;
    let completed = 0;
    let inProgress = 0;
    let sumScore = 0;
    let scoredCount = 0;

    courses.forEach((c) => {
      const p = progressMap[c.id];
      if (p) {
        if (p.status === "completed") completed++;
        else if (p.status === "in-progress") inProgress++;

        if (p.chapterScores) {
          Object.values(p.chapterScores).forEach((sc) => {
            if (typeof sc === "number" && !isNaN(sc)) {
              sumScore += sc;
              scoredCount++;
            }
          });
        }
        if (typeof p.finalScore === "number" && !isNaN(p.finalScore)) {
          sumScore += p.finalScore;
          scoredCount++;
        }
      }
    });

    const avgScore = scoredCount > 0 ? Math.round(sumScore / scoredCount) : 0;
    return { total, completed, inProgress, avgScore };
  }, [courses, progressMap]);

  // Resume course candidate
  const resumeCourse = useMemo(() => {
    return courses.find((c) => progressMap[c.id]?.status === "in-progress");
  }, [courses, progressMap]);

  // Phase grouping & anti-relock calculation
  const { phases, absoluteUnlockedPhase } = useMemo(() => {
    const grouped: Record<number, Course[]> = {};
    courses.forEach((c) => {
      const p = c.phase || 1;
      if (!grouped[p]) grouped[p] = [];
      grouped[p].push(c);
    });

    const sortedPhaseKeys = Object.keys(grouped)
      .map(Number)
      .sort((a, b) => a - b);

    let highestAccessed = 1;
    courses.forEach((c) => {
      const p = progressMap[c.id];
      if (p && (p.status === "completed" || p.status === "in-progress" || p.unlockedIndex > 0)) {
        if ((c.phase || 1) > highestAccessed) highestAccessed = c.phase || 1;
      }
    });

    let sequential = sortedPhaseKeys[0] || 1;
    for (let i = 0; i < sortedPhaseKeys.length; i++) {
      const pNum = sortedPhaseKeys[i];
      let pComplete = true;
      (grouped[pNum] || []).forEach((c) => {
        if (progressMap[c.id]?.status !== "completed") pComplete = false;
      });
      if (pComplete) {
        sequential = sortedPhaseKeys[i + 1] || pNum;
      } else {
        break;
      }
    }

    return {
      phases: grouped,
      absoluteUnlockedPhase: Math.max(highestAccessed, sequential),
    };
  }, [courses, progressMap]);

  // Save Progress to Firestore
  const saveProgressToDb = async (courseId: string, newProg: CourseUserProgress) => {
    // 1. Instantly update local state in React (0 Firebase reads)
    setLocalProgress((prev) => ({
      ...prev,
      [courseId]: newProg,
    }));

    if (!user || !user.email) return;

    // 2. Persist to Firestore asynchronously
    try {
      const userDocRef = doc(db, "users", user.email.toLowerCase());
      await setDoc(
        userDocRef,
        {
          courseProgress: {
            [courseId]: newProg,
          },
        },
        { merge: true }
      );
    } catch (err) {
      console.error("Failed to save progress to DB:", err);
    }
  };

  // Launch Course Viewer
  const handleStartCourse = (course: Course) => {
    if (!isLoggedIn || !user) {
      openLoginModal();
      return;
    }

    const currentProg = progressMap[course.id] || {
      status: "in-progress",
      unlockedIndex: 0,
      chapterScores: {},
      chapterAnswers: {},
      finalScore: null,
    };

    setActiveCourse(course);
    setActiveTabIndex(Math.min(currentProg.unlockedIndex, (course.chapters?.length || 1) - 1));
    setCheckpointAnswers(currentProg.chapterAnswers?.[currentProg.unlockedIndex] || {});
  };

  // Pass chapter without quiz
  const handlePassChapterWithoutQuiz = async () => {
    if (!activeCourse) return;
    const oldProg = progressMap[activeCourse.id] || { status: "in-progress", unlockedIndex: 0 };
    const updatedProg: CourseUserProgress = {
      ...oldProg,
      unlockedIndex: Math.max(oldProg.unlockedIndex, activeTabIndex + 1),
    };

    const finalProg = recalculateCourseProgress(activeCourse, updatedProg);
    await saveProgressToDb(activeCourse.id, finalProg);
    setActiveTabIndex((prev) => prev + 1);
  };

  // Submit Checkpoint / Final Quiz
  const handleSubmitCheckpointQuiz = async (tabKey: number | "final") => {
    if (!activeCourse) return;
    const questions = tabKey === "final" ? activeCourse.finalQuiz || [] : activeCourse.chapters[tabKey]?.questions || [];

    if (Object.keys(checkpointAnswers).length < questions.length) {
      toast.warning("Please answer all questions before submitting.");
      return;
    }

    setSubmittingQuiz(true);
    const oldProg = progressMap[activeCourse.id] || { status: "in-progress", unlockedIndex: 0 };
    const updatedAnswers = {
      ...(oldProg.chapterAnswers || {}),
      [tabKey]: checkpointAnswers,
    };

    // Explicitly compute score on submission
    let correctCount = 0;
    questions.forEach((q, idx) => {
      if (checkpointAnswers[idx] === Number(q.correct)) correctCount++;
    });
    const pct = Math.round((correctCount / questions.length) * 100);

    const updatedScores = {
      ...(oldProg.chapterScores || {}),
      ...(tabKey !== "final" ? { [tabKey]: pct } : {}),
    };

    const updatedProg: CourseUserProgress = {
      ...oldProg,
      chapterAnswers: updatedAnswers,
      chapterScores: updatedScores,
      ...(tabKey === "final" ? { finalScore: pct } : {}),
    };

    const finalProg = recalculateCourseProgress(activeCourse, updatedProg);
    await saveProgressToDb(activeCourse.id, finalProg);
    setSubmittingQuiz(false);

    if (pct >= 90) {
      toast.success(`Congratulations! You passed with ${pct}%!`);
    } else {
      toast.warning(`You scored ${pct}%. Score 90%+ is required. Click Retake Quiz to try again!`);
    }
  };

  // Retake Checkpoint / Final Quiz
  const handleRetakeQuiz = async (tabKey: number | "final") => {
    if (!activeCourse) return;

    const questions =
      tabKey === "final"
        ? activeCourse.finalQuiz || []
        : activeCourse.chapters[tabKey]?.questions || [];

    const oldProg = progressMap[activeCourse.id] || { status: "in-progress", unlockedIndex: 0 };
    const currentAnswers = oldProg.chapterAnswers?.[tabKey] || checkpointAnswers || {};

    // Preserve only the answers that were correct
    const preservedAnswers: Record<number, number> = {};
    questions.forEach((q, qIdx) => {
      const ans = currentAnswers[qIdx];
      if (ans !== undefined && ans === Number(q.correct)) {
        preservedAnswers[qIdx] = ans;
      }
    });

    setCheckpointAnswers(preservedAnswers);

    const updatedAnswers = { ...(oldProg.chapterAnswers || {}) };
    updatedAnswers[tabKey] = preservedAnswers;

    const updatedScores = { ...(oldProg.chapterScores || {}) };
    delete updatedScores[tabKey];

    const updatedProg: CourseUserProgress = {
      ...oldProg,
      chapterAnswers: updatedAnswers,
      chapterScores: updatedScores,
      ...(tabKey === "final" ? { finalScore: null } : {}),
    };

    await saveProgressToDb(activeCourse.id, updatedProg);
    toast.info("Retake active: Correct answers are saved. Please select your new answers for the remaining questions!");
  };

  // Submit / Update 5-Star Feedback (1 per user)
  const handleSubmitFeedback = async () => {
    if (!activeCourse || !user) return;
    setRatingSubmitting(true);

    const userEmail = user.email?.toLowerCase() || "";
    const newRating = {
      email: userEmail,
      name: userProfile?.displayName || userProfile?.name || user.email?.split("@")[0] || "Agent",
      rating: ratingVal,
      feedback: feedbackText.trim(),
      date: Date.now(),
    };

    try {
      // Deduplicate so every agent has at most 1 review per course
      const existingRatings = (activeCourse.ratings || []).filter(
        (r) => r.email?.toLowerCase() !== userEmail
      );
      const updatedRatings = [...existingRatings, newRating];

      const courseDocRef = doc(db, "onboardings", activeCourse.id);
      await updateDoc(courseDocRef, {
        ratings: updatedRatings,
      });

      setActiveCourse((prev) =>
        prev
          ? {
              ...prev,
              ratings: updatedRatings,
            }
          : null
      );

      setCourses((prev) =>
        prev.map((c) => (c.id === activeCourse.id ? { ...c, ratings: updatedRatings } : c))
      );

      setIsEditingRating(false);
      setFeedbackText("");
      toast.success(isEditingRating ? "Your feedback has been updated!" : "Thank you for your rating & feedback!");
    } catch (e: any) {
      console.error("Rating submit error:", e);
      toast.error("Failed to submit feedback.");
    } finally {
      setRatingSubmitting(false);
    }
  };

  // Delete 5-Star Feedback
  const handleDeleteFeedback = async () => {
    if (!activeCourse || !user) return;

    setRatingSubmitting(true);
    const userEmail = user.email?.toLowerCase() || "";

    try {
      const updatedRatings = (activeCourse.ratings || []).filter(
        (r) => r.email?.toLowerCase() !== userEmail
      );

      const courseDocRef = doc(db, "onboardings", activeCourse.id);
      await updateDoc(courseDocRef, {
        ratings: updatedRatings,
      });

      setActiveCourse((prev) =>
        prev
          ? {
              ...prev,
              ratings: updatedRatings,
            }
          : null
      );

      setCourses((prev) =>
        prev.map((c) => (c.id === activeCourse.id ? { ...c, ratings: updatedRatings } : c))
      );

      setIsEditingRating(false);
      setRatingVal(5);
      setFeedbackText("");
      toast.success("Your feedback has been deleted.");
    } catch (e: any) {
      console.error("Delete rating error:", e);
      toast.error("Failed to delete feedback.");
    } finally {
      setRatingSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* ----------------------------------------------------
          VIEW 1: ACTIVE COURSE VIEWER
          ---------------------------------------------------- */}
      {activeCourse ? (
        <div className="space-y-6 animate-in fade-in duration-200">
          <button
            onClick={() => setActiveCourse(null)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-full shadow-xs transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to All Courses</span>
          </button>

          {/* Hero Banner */}
          <div className="relative rounded-3xl overflow-hidden bg-slate-900 text-white p-8 md:p-12 shadow-lg">
            <div
              className="absolute inset-0 bg-cover bg-center opacity-30"
              style={{
                backgroundImage: `url(${
                  activeCourse.coverImage ||
                  "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80"
                })`,
              }}
            />
            <div className="relative z-10 max-w-2xl space-y-3">
              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest bg-emerald-950/60 px-3 py-1 rounded-full border border-emerald-500/30">
                {activeCourse.category || "General"} • Phase {activeCourse.phase || 1}
              </span>
              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight leading-tight">
                {activeCourse.title}
              </h1>
              <div className="flex items-center gap-4 text-xs text-slate-300 font-medium pt-2">
                <span className="flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4 text-blue-400" />
                  {activeCourse.chapters?.length || 0} Chapters
                </span>
                <span className="flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-purple-400" />
                  {progressMap[activeCourse.id]?.status === "completed"
                    ? "Completed"
                    : `${progressMap[activeCourse.id]?.unlockedIndex || 0} / ${activeCourse.chapters?.length || 0} Completed`}
                </span>
              </div>
            </div>
          </div>

          {/* Chapter Pill Navigation */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none select-none">
            {activeCourse.chapters?.map((ch, idx) => {
              const prog = progressMap[activeCourse.id];
              const isLocked = idx > (prog?.unlockedIndex || 0);
              const isActive = activeTabIndex === idx;

              return (
                <button
                  key={idx}
                  onClick={() => {
                    if (!isLocked) {
                      setActiveTabIndex(idx);
                      setCheckpointAnswers(prog?.chapterAnswers?.[idx] || {});
                    }
                  }}
                  disabled={isLocked}
                  className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-all ${
                    isActive
                      ? "bg-blue-600 text-white shadow-sm"
                      : isLocked
                      ? "bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed"
                      : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {isLocked && <Lock className="w-3.5 h-3.5 text-slate-400" />}
                  <span>Chapter {idx + 1}</span>
                </button>
              );
            })}

            {activeCourse.finalQuiz && activeCourse.finalQuiz.length > 0 && (
              (() => {
                const finalIdx = activeCourse.chapters?.length || 0;
                const prog = progressMap[activeCourse.id];
                const isLocked = finalIdx > (prog?.unlockedIndex || 0);
                const isActive = activeTabIndex === finalIdx;

                return (
                  <button
                    onClick={() => {
                      if (!isLocked) {
                        setActiveTabIndex(finalIdx);
                        setCheckpointAnswers(prog?.chapterAnswers?.["final"] || {});
                      }
                    }}
                    disabled={isLocked}
                    className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-all ${
                      isActive
                        ? "bg-purple-600 text-white shadow-sm"
                        : isLocked
                        ? "bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed"
                        : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <Award className="w-3.5 h-3.5" />
                    <span>Final Assessment</span>
                  </button>
                );
              })()
            )}
          </div>

          {/* Active Tab Body Content */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 shadow-xs space-y-8">
            {activeTabIndex < (activeCourse.chapters?.length || 0) ? (
              /* Chapter View */
              (() => {
                const chapter = activeCourse.chapters[activeTabIndex];
                const prog = progressMap[activeCourse.id];
                const savedScore = prog?.chapterScores?.[activeTabIndex];
                const isPassed = typeof savedScore === "number" && savedScore >= 90;

                return (
                  <div className="space-y-6">
                    <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">
                      {chapter.title || `Chapter ${activeTabIndex + 1}`}
                    </h2>

                    {/* Chapter Video */}
                    {chapter.videoUrl && (
                      <div className="aspect-video w-full rounded-2xl overflow-hidden shadow-md">
                        <iframe
                          src={chapter.videoUrl.replace("watch?v=", "embed/")}
                          title={chapter.title}
                          className="w-full h-full border-0"
                          allowFullScreen
                        />
                      </div>
                    )}

                    {/* Chapter Content */}
                    <div
                      className="text-slate-800 leading-relaxed rich-text-content space-y-4 text-sm sm:text-base"
                      dangerouslySetInnerHTML={{ __html: chapter.content || "" }}
                    />

                    {/* Attached Resources */}
                    {chapter.attachedFiles && chapter.attachedFiles.length > 0 && (
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                        <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                          <Paperclip className="w-4 h-4 text-blue-600" />
                          <span>Attached Resources</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {chapter.attachedFiles.map((file) => (
                            <a
                              key={file.id}
                              href={file.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl text-xs hover:border-blue-500 hover:shadow-xs transition-all"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <FileText className="w-4 h-4 text-rose-600 flex-shrink-0" />
                                <span className="font-semibold text-slate-800 truncate">{file.name}</span>
                              </div>
                              <Download className="w-4 h-4 text-slate-400 flex-shrink-0" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Checkpoint Questions or Mark Completed */}
                    {chapter.questions && chapter.questions.length > 0 ? (
                      <div className="pt-6 border-t border-slate-200 space-y-6">
                        <div className="flex items-center justify-between">
                          <div className="text-base font-bold text-slate-900 flex items-center gap-2">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                            <span>Chapter Checkpoint (Score 90%+ to Unlock Next)</span>
                          </div>
                          {typeof savedScore === "number" && (
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-bold ${
                                isPassed ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                              }`}
                            >
                              Score: {savedScore}%
                            </span>
                          )}
                        </div>

                        {/* Question Cards */}
                        <div className="space-y-4">
                          {chapter.questions.map((q, qIdx) => {
                            const isSubmitted = typeof savedScore === "number";
                            const submittedAns = prog?.chapterAnswers?.[activeTabIndex]?.[qIdx];
                            const currentAns = checkpointAnswers[qIdx];
                            const correctAns = Number(q.correct);
                            const isConfirmedCorrect =
                              isSubmitted && submittedAns !== undefined && submittedAns === correctAns;

                            return (
                              <div
                                key={qIdx}
                                className={`p-4 rounded-xl space-y-3 border transition-colors ${
                                  isSubmitted
                                    ? isConfirmedCorrect
                                      ? "bg-emerald-50/40 border-emerald-200"
                                      : "bg-rose-50/30 border-rose-200"
                                    : "bg-slate-50 border-slate-200"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="text-xs font-bold text-slate-900 leading-snug">
                                    {qIdx + 1}. {q.text}
                                  </div>
                                  {isSubmitted && (
                                    isConfirmedCorrect ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100/80 px-2.5 py-0.5 rounded-full shrink-0">
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                        <span>Correct (Locked)</span>
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-100/80 px-2.5 py-0.5 rounded-full shrink-0">
                                        <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                        <span>Incorrect (Re-attempt)</span>
                                      </span>
                                    )
                                  )}
                                </div>

                                <div className="space-y-2">
                                  {q.options.map((opt, optIdx) => {
                                    const optNum = optIdx + 1;
                                    const isSelected = currentAns === optNum;

                                    // If question was correctly answered and submitted -> LOCKED IN GREEN
                                    if (isConfirmedCorrect) {
                                      if (optNum === correctAns) {
                                        return (
                                          <div
                                            key={optIdx}
                                            className="flex items-center justify-between p-3 rounded-lg text-xs border border-emerald-500 ring-1 ring-emerald-500 bg-emerald-50 text-emerald-900 font-semibold cursor-not-allowed"
                                          >
                                            <div className="flex items-center gap-3">
                                              <span className="w-4 h-4 rounded-full border border-emerald-600 bg-emerald-600 text-white flex items-center justify-center text-[9px] font-bold shrink-0">
                                                {String.fromCharCode(65 + optIdx)}
                                              </span>
                                              <span>{opt}</span>
                                            </div>
                                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                          </div>
                                        );
                                      }
                                      return (
                                        <div
                                          key={optIdx}
                                          className="flex items-center gap-3 p-3 rounded-lg text-xs border border-slate-200 bg-slate-50/50 text-slate-400 opacity-60 cursor-not-allowed"
                                        >
                                          <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[9px] font-bold shrink-0">
                                            {String.fromCharCode(65 + optIdx)}
                                          </span>
                                          <span>{opt}</span>
                                        </div>
                                      );
                                    }

                                    // If not submitted yet OR if question was incorrect -> AGENT CAN SELECT / RE-ANSWER
                                    const isPreviousWrongChoice =
                                      isSubmitted &&
                                      submittedAns !== undefined &&
                                      submittedAns !== correctAns &&
                                      submittedAns === optNum &&
                                      isSelected;

                                    return (
                                      <label
                                        key={optIdx}
                                        className={`flex items-center gap-3 p-3 rounded-lg text-xs cursor-pointer transition-all border ${
                                          isSelected
                                            ? isPreviousWrongChoice
                                              ? "border-rose-400 ring-1 ring-rose-400 bg-rose-50 text-rose-900 font-semibold"
                                              : "border-blue-600 ring-1 ring-blue-600 bg-blue-50/50 text-blue-950 font-semibold"
                                            : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                                        }`}
                                      >
                                        <input
                                          type="radio"
                                          name={`ch_${activeTabIndex}_q_${qIdx}`}
                                          value={optNum}
                                          checked={isSelected}
                                          onChange={() =>
                                            setCheckpointAnswers((prev) => ({
                                              ...prev,
                                              [qIdx]: optNum,
                                            }))
                                          }
                                          className="w-4 h-4 text-blue-600"
                                        />
                                        <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[9px] font-bold shrink-0">
                                          {String.fromCharCode(65 + optIdx)}
                                        </span>
                                        <span className="flex-1">{opt}</span>
                                        {isPreviousWrongChoice && (
                                          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                                        )}
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Submit / Retry / Next Button */}
                        <div className="pt-2">
                          {isPassed ? (
                            <button
                              onClick={() => {
                                const nextIdx = activeTabIndex + 1;
                                setActiveTabIndex(nextIdx);
                                const prog = progressMap[activeCourse.id];
                                setCheckpointAnswers(prog?.chapterAnswers?.[nextIdx] || {});
                              }}
                              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm flex items-center justify-center gap-2"
                            >
                              <span>Proceed to Next Chapter</span>
                              <ArrowRight className="w-4 h-4" />
                            </button>
                          ) : (
                            <div className="space-y-3">
                              {typeof savedScore === "number" && (
                                <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                                    <AlertTriangle className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <div className="font-bold text-xs text-rose-900">
                                      Score: {savedScore}% — Passing Requirement: 90%+
                                    </div>
                                    <div className="text-[11px] text-rose-700 mt-0.5">
                                      Correct answers are locked in green. Please select your new answers for the incorrect questions above and re-submit!
                                    </div>
                                  </div>
                                </div>
                              )}
                              <button
                                onClick={() => handleSubmitCheckpointQuiz(activeTabIndex)}
                                disabled={submittingQuiz}
                                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
                              >
                                {submittingQuiz
                                  ? "Submitting..."
                                  : typeof savedScore === "number"
                                  ? "Submit Updated Answers"
                                  : "Submit Checkpoint Answers"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* No questions in chapter -> Mark Complete */
                      <div className="pt-6 border-t border-slate-200">
                        {activeTabIndex < (prog?.unlockedIndex || 0) ? (
                          <div className="p-4 bg-emerald-50 text-emerald-800 text-xs font-bold rounded-xl text-center flex items-center justify-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            <span>Chapter Completed</span>
                          </div>
                        ) : (
                          <button
                            onClick={handlePassChapterWithoutQuiz}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm flex items-center justify-center gap-2"
                          >
                            <span>Mark Chapter Complete</span>
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              /* Final Assessment View */
              (() => {
                const prog = progressMap[activeCourse.id];
                const savedScore = prog?.finalScore;
                const isPassed = typeof savedScore === "number" && savedScore >= 90;

                return (
                  <div className="space-y-6">
                    <div className="text-center max-w-md mx-auto space-y-2">
                      <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-full flex items-center justify-center mx-auto">
                        <Award className="w-6 h-6" />
                      </div>
                      <h2 className="text-2xl font-extrabold text-slate-900">Final Course Assessment</h2>
                      <p className="text-xs text-slate-500">
                        Answer all questions correctly. Score 90%+ to officially complete this course and unlock future phases!
                      </p>
                    </div>

                    {/* Questions */}
                    <div className="space-y-4">
                      {activeCourse.finalQuiz?.map((q, qIdx) => {
                        const isSubmitted = typeof savedScore === "number";
                        const submittedAns = prog?.chapterAnswers?.["final"]?.[qIdx];
                        const currentAns = checkpointAnswers[qIdx];
                        const correctAns = Number(q.correct);
                        const isConfirmedCorrect =
                          isSubmitted && submittedAns !== undefined && submittedAns === correctAns;

                        return (
                          <div
                            key={qIdx}
                            className={`p-4 rounded-xl space-y-3 border transition-colors ${
                              isSubmitted
                                ? isConfirmedCorrect
                                ? "bg-emerald-50/40 border-emerald-200"
                                : "bg-rose-50/30 border-rose-200"
                                : "bg-slate-50 border-slate-200"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-xs font-bold text-slate-900 leading-snug">
                                {qIdx + 1}. {q.text}
                              </div>
                              {isSubmitted && (
                                isConfirmedCorrect ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100/80 px-2.5 py-0.5 rounded-full shrink-0">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                    <span>Correct (Locked)</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-100/80 px-2.5 py-0.5 rounded-full shrink-0">
                                    <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                    <span>Incorrect (Re-attempt)</span>
                                  </span>
                                )
                              )}
                            </div>

                            <div className="space-y-2">
                              {q.options.map((opt, optIdx) => {
                                const optNum = optIdx + 1;
                                const isSelected = currentAns === optNum;

                                // If question was correctly answered and submitted -> LOCKED IN GREEN
                                if (isConfirmedCorrect) {
                                  if (optNum === correctAns) {
                                    return (
                                      <div
                                        key={optIdx}
                                        className="flex items-center justify-between p-3 rounded-lg text-xs border border-emerald-500 ring-1 ring-emerald-500 bg-emerald-50 text-emerald-900 font-semibold cursor-not-allowed"
                                      >
                                        <div className="flex items-center gap-3">
                                          <span className="w-4 h-4 rounded-full border border-emerald-600 bg-emerald-600 text-white flex items-center justify-center text-[9px] font-bold shrink-0">
                                            {String.fromCharCode(65 + optIdx)}
                                          </span>
                                          <span>{opt}</span>
                                        </div>
                                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                      </div>
                                    );
                                  }
                                  return (
                                    <div
                                      key={optIdx}
                                      className="flex items-center gap-3 p-3 rounded-lg text-xs border border-slate-200 bg-slate-50/50 text-slate-400 opacity-60 cursor-not-allowed"
                                    >
                                      <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[9px] font-bold shrink-0">
                                        {String.fromCharCode(65 + optIdx)}
                                      </span>
                                      <span>{opt}</span>
                                    </div>
                                  );
                                }

                                // If not submitted yet OR if question was incorrect -> AGENT CAN SELECT / RE-ANSWER
                                const isPreviousWrongChoice =
                                  isSubmitted &&
                                  submittedAns !== undefined &&
                                  submittedAns !== correctAns &&
                                  submittedAns === optNum &&
                                  isSelected;

                                return (
                                  <label
                                    key={optIdx}
                                    className={`flex items-center gap-3 p-3 rounded-lg text-xs cursor-pointer transition-all border ${
                                      isSelected
                                        ? isPreviousWrongChoice
                                          ? "border-rose-400 ring-1 ring-rose-400 bg-rose-50 text-rose-900 font-semibold"
                                          : "border-purple-600 ring-1 ring-purple-600 bg-purple-50/50 text-purple-950 font-semibold"
                                        : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name={`final_q_${qIdx}`}
                                      value={optNum}
                                      checked={isSelected}
                                      onChange={() =>
                                        setCheckpointAnswers((prev) => ({
                                          ...prev,
                                          [qIdx]: optNum,
                                        }))
                                      }
                                      className="w-4 h-4 text-purple-600"
                                    />
                                    <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[9px] font-bold shrink-0">
                                      {String.fromCharCode(65 + optIdx)}
                                    </span>
                                    <span className="flex-1">{opt}</span>
                                    {isPreviousWrongChoice && (
                                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Submit / Retry Button */}
                    <div className="pt-2">
                      {isPassed ? (
                        <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-2">
                          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                          <h3 className="text-base font-bold text-emerald-900">
                            Course Completed Successfully ({savedScore}%)!
                          </h3>
                          <p className="text-xs text-emerald-700">
                            You have unlocked subsequent course phases in your curriculum.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {typeof savedScore === "number" && (
                            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                                <AlertTriangle className="w-5 h-5" />
                              </div>
                              <div>
                                <div className="font-bold text-xs text-rose-900">
                                  Final Score: {savedScore}% — Passing Requirement: 90%+
                                </div>
                                <div className="text-[11px] text-rose-700 mt-0.5">
                                  Correct answers are locked in green. Please select your new answers for the incorrect questions above and re-submit!
                                </div>
                              </div>
                            </div>
                          )}
                          <button
                            onClick={() => handleSubmitCheckpointQuiz("final")}
                            disabled={submittingQuiz}
                            className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
                          >
                            {submittingQuiz
                              ? "Submitting Final..."
                              : typeof savedScore === "number"
                              ? "Submit Updated Final Assessment"
                              : "Submit Final Assessment"}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 5-Star Rating & Reviews Section */}
                    {isPassed && (
                      (() => {
                        const userEmail = user?.email?.toLowerCase() || "";
                        const myRating = (activeCourse.ratings || []).find(
                          (r) => r.email?.toLowerCase() === userEmail
                        );
                        // Filter unique reviews: user's review first, then others
                        const seenEmails = new Set<string>();
                        const allUniqueReviews = (activeCourse.ratings || []).filter((r) => {
                          const em = r.email?.toLowerCase() || r.name;
                          if (seenEmails.has(em)) return false;
                          seenEmails.add(em);
                          return true;
                        });

                        return (
                          <div className="pt-8 border-t border-slate-200 space-y-6">
                            {/* Rating / Edit Form (only shown if user hasn't submitted yet OR is currently editing) */}
                            {(!myRating || isEditingRating) && (
                              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center space-y-4">
                                <div className="flex items-center justify-between">
                                  <div className="text-left">
                                    <h3 className="text-sm font-bold text-slate-800">
                                      {isEditingRating ? "Edit Your Feedback" : "Rate this Course"}
                                    </h3>
                                    <p className="text-xs text-slate-500">
                                      Help fellow agents by sharing your honest feedback and rating.
                                    </p>
                                  </div>
                                  {isEditingRating && (
                                    <button
                                      onClick={() => {
                                        setIsEditingRating(false);
                                        setFeedbackText("");
                                      }}
                                      className="text-xs text-slate-500 hover:text-slate-700 font-semibold px-2.5 py-1 rounded-md border border-slate-200 bg-white"
                                    >
                                      Cancel
                                    </button>
                                  )}
                                </div>

                                <div className="flex items-center justify-center gap-1.5">
                                  {[1, 2, 3, 4, 5].map((star) => (
                                    <button
                                      key={star}
                                      type="button"
                                      onClick={() => setRatingVal(star)}
                                      className="p-1 text-2xl transition-transform hover:scale-110"
                                    >
                                      <Star
                                        className={`w-7 h-7 ${
                                          star <= ratingVal
                                            ? "text-amber-400 fill-amber-400"
                                            : "text-slate-300"
                                        }`}
                                      />
                                    </button>
                                  ))}
                                </div>

                                <textarea
                                  value={feedbackText}
                                  onChange={(e) => setFeedbackText(e.target.value)}
                                  rows={3}
                                  placeholder="Write your feedback here (optional)..."
                                  className="w-full p-3 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-800"
                                />

                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    onClick={handleSubmitFeedback}
                                    disabled={ratingSubmitting}
                                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
                                  >
                                    {ratingSubmitting
                                      ? "Saving..."
                                      : isEditingRating
                                      ? "Update Feedback"
                                      : "Submit Feedback"}
                                  </button>
                                  {isEditingRating && (
                                    <button
                                      onClick={() => {
                                        setIsEditingRating(false);
                                        setFeedbackText("");
                                      }}
                                      className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl transition-colors"
                                    >
                                      Cancel
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Unified Reviews List */}
                            {allUniqueReviews.length > 0 && (
                              <div className="space-y-3">
                                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                                  Agent Reviews ({allUniqueReviews.length})
                                </h4>
                                <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                                  {allUniqueReviews.map((r, i) => {
                                    const isMine = r.email?.toLowerCase() === userEmail;

                                    return (
                                      <div
                                        key={i}
                                        className={`py-3.5 space-y-1.5 transition-colors ${
                                          isMine
                                            ? "bg-blue-50/50 px-4 py-3 rounded-xl border border-blue-100 my-1"
                                            : ""
                                        }`}
                                      >
                                        <div className="flex items-center justify-between text-xs gap-2">
                                          <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-800">{r.name}</span>
                                            {isMine && (
                                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
                                                You
                                              </span>
                                            )}
                                          </div>

                                          <div className="flex items-center gap-3">
                                            <div className="flex items-center text-amber-400">
                                              {Array.from({ length: 5 }).map((_, s) => (
                                                <Star
                                                  key={s}
                                                  className={`w-3.5 h-3.5 ${
                                                    s < r.rating
                                                      ? "fill-amber-400 text-amber-400"
                                                      : "text-slate-200"
                                                  }`}
                                                />
                                              ))}
                                            </div>

                                            {/* Edit & Delete Action Buttons for the User's Feedback */}
                                            {isMine && (
                                              <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
                                                <button
                                                  onClick={() => {
                                                    setRatingVal(r.rating);
                                                    setFeedbackText(r.feedback || "");
                                                    setIsEditingRating(true);
                                                  }}
                                                  title="Edit Feedback"
                                                  className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-100/80 rounded-md transition-colors flex items-center gap-1 text-[11px] font-semibold"
                                                >
                                                  <Edit3 className="w-3.5 h-3.5" />
                                                  <span>Edit</span>
                                                </button>
                                                <button
                                                  onClick={handleDeleteFeedback}
                                                  disabled={ratingSubmitting}
                                                  title="Delete Feedback"
                                                  className="p-1 text-slate-500 hover:text-rose-600 hover:bg-rose-100/80 rounded-md transition-colors flex items-center gap-1 text-[11px] font-semibold"
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                  <span>Delete</span>
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        </div>

                                        {r.feedback && (
                                          <p className="text-xs text-slate-600 leading-relaxed text-left">
                                            {r.feedback}
                                          </p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()
                    )}
                  </div>
                );
              })()
            )}
          </div>
        </div>
      ) : (
        /* ----------------------------------------------------
            VIEW 2: MAIN COURSES DASHBOARD
            ---------------------------------------------------- */
        <div className="space-y-8">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Agent Training Curriculum</h1>
          </div>

          {/* 4 KPI Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs text-center">
              <div className="text-2xl font-extrabold text-slate-900">{metrics.total}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Total Courses
              </div>
            </div>
            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs text-center">
              <div className="text-2xl font-extrabold text-emerald-600">{metrics.completed}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Completed
              </div>
            </div>
            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs text-center">
              <div className="text-2xl font-extrabold text-amber-500">{metrics.inProgress}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                In Progress
              </div>
            </div>
            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs text-center">
              <div className="text-2xl font-extrabold text-blue-600">{metrics.avgScore}%</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Average Score
              </div>
            </div>
          </div>

          {/* "Continue Where You Left Off" Resume Card */}
          {resumeCourse && (
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl p-6 sm:p-8 text-white shadow-md flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-widest bg-white/20 px-3 py-1 rounded-full">
                  Resume Learning
                </span>
                <h3 className="text-xl font-bold">{resumeCourse.title}</h3>
                <p className="text-xs text-blue-100">
                  You are currently progressing through Phase {resumeCourse.phase || 1}.
                </p>
              </div>
              <button
                onClick={() => handleStartCourse(resumeCourse)}
                className="px-6 py-3 bg-white text-blue-700 font-bold text-xs rounded-xl shadow-sm hover:bg-blue-50 transition-colors whitespace-nowrap flex items-center gap-2"
              >
                <PlayCircle className="w-4 h-4" />
                <span>Resume Course</span>
              </button>
            </div>
          )}

          {/* Phase-Grouped Course Cards */}
          <div className="space-y-10">
            {Object.keys(phases)
              .map(Number)
              .sort((a, b) => a - b)
              .map((phaseNum) => {
                const phaseCourses = phases[phaseNum] || [];
                const isPhaseLocked = !isLoggedIn ? false : phaseNum > absoluteUnlockedPhase;

                return (
                  <section key={phaseNum} className="space-y-4">
                    {/* Phase Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                      <div className="flex items-center gap-2 font-bold text-lg text-slate-900">
                        {isPhaseLocked ? (
                          <Lock className="w-5 h-5 text-slate-400" />
                        ) : (
                          <GraduationCap className="w-5 h-5 text-blue-600" />
                        )}
                        <span>Phase {phaseNum}</span>
                        {isPhaseLocked && (
                          <span className="text-xs text-slate-400 font-normal">
                            (Complete previous phases to unlock)
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                        {phaseCourses.length} {phaseCourses.length === 1 ? "Course" : "Courses"}
                      </span>
                    </div>

                    {/* Course Cards Grid */}
                    <div
                      className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 ${
                        isPhaseLocked ? "opacity-60 grayscale pointer-events-none" : ""
                      }`}
                    >
                      {phaseCourses.map((course) => {
                        const prog = progressMap[course.id];
                        const isCompleted = prog?.status === "completed";
                        const isInProgress = prog?.status === "in-progress";

                        const ratingsList = course.ratings || [];
                        const avgRating =
                          ratingsList.length > 0
                            ? (ratingsList.reduce((acc, r) => acc + r.rating, 0) / ratingsList.length).toFixed(1)
                            : null;

                        return (
                          <div
                            key={course.id}
                            className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                          >
                            {/* Card Image */}
                            <div
                              className="h-44 bg-cover bg-center relative"
                              style={{
                                backgroundImage: `url(${
                                  course.coverImage ||
                                  "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=600&q=80"
                                })`,
                              }}
                            >
                              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                              <div className="absolute top-3 left-3 flex items-center gap-2">
                                <span className="bg-white/90 backdrop-blur-sm text-slate-800 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
                                  {course.category || "General"}
                                </span>
                              </div>

                              <button
                                onClick={() => {
                                  setReportTarget({ id: course.id, title: course.title });
                                  setReportModalOpen(true);
                                }}
                                className="absolute top-3 right-3 text-white/80 hover:text-white p-1 rounded transition-colors"
                                title="Report Issue"
                              >
                                <Flag className="w-4 h-4 text-rose-400" />
                              </button>

                              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-white text-xs font-semibold">
                                <span>{course.chapters?.length || 0} Chapters</span>
                                {avgRating && (
                                  <span className="flex items-center gap-1 text-amber-300">
                                    <Star className="w-3.5 h-3.5 fill-amber-300" />
                                    {avgRating} ({ratingsList.length})
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Card Content */}
                            <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                              <div>
                                <h3 className="font-bold text-slate-900 text-base leading-snug line-clamp-2">
                                  {course.title}
                                </h3>
                              </div>

                              <div className="pt-3 border-t border-slate-100">
                                {isCompleted ? (
                                  <button
                                    onClick={() => handleStartCourse(course)}
                                    className="w-full py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5"
                                  >
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span>Completed (Review Course)</span>
                                  </button>
                                ) : isInProgress ? (
                                  <button
                                    onClick={() => handleStartCourse(course)}
                                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5"
                                  >
                                    <PlayCircle className="w-4 h-4" />
                                    <span>Resume Course</span>
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleStartCourse(course)}
                                    className="w-full py-2.5 bg-slate-900 hover:bg-blue-600 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
                                  >
                                    Take Course
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
          </div>
        </div>
      )}

      {/* Report Issue Modal */}
      <ReportIssueModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        targetId={reportTarget.id}
        reportType="Course"
        targetCodeOrName={reportTarget.title}
      />
    </div>
  );
}
