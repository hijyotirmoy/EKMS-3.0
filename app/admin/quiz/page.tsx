"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { touchMetadata } from "@/lib/cache";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { Quiz, MCQQuestion } from "@/lib/types";
import * as XLSX from "xlsx";
import {
  Gamepad2,
  Plus,
  FileSpreadsheet,
  Download,
  Upload,
  BarChart3,
  Trash2,
  Edit2,
  Clock,
  CheckCircle2,
  AlertCircle,
  X,
  Smartphone,
  Eye,
  ArrowLeft,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  Users,
  Award,
  Search,
  ChevronLeft,
  ChevronRight,
  User,
} from "lucide-react";

export default function AdminQuizPage() {
  const { user } = useAuth();
  const { toast, showConfirm } = usePopup();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Bulk Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Mode: 'table' | 'editor' | 'global-analytics'
  const [viewMode, setViewMode] = useState<"table" | "editor" | "global-analytics">("table");

  // Editor Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [quizTitle, setQuizTitle] = useState("");
  const [quizTime, setQuizTime] = useState(15);
  const [mobileAllowed, setMobileAllowed] = useState(false);
  const [questions, setQuestions] = useState<MCQQuestion[]>([
    { text: "", options: ["", "", "", ""], correct: 1 },
  ]);
  const [savingQuiz, setSavingQuiz] = useState(false);

  // Detailed Individual Agent Modal State & Pagination
  const [selectedAgentForAnalytics, setSelectedAgentForAnalytics] = useState<any | null>(null);
  const [agentHistoryPage, setAgentHistoryPage] = useState(1);
  const historyPerPage = 10;

  // 1. Fetch Quizzes & Users in Real-Time
  useEffect(() => {
    let isMounted = true;

    const unsubQuizzes = onSnapshot(
      collection(db, "quizzes"),
      (snapshot) => {
        const list: Quiz[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...(d.data() as Omit<Quiz, "id">) });
        });
        if (isMounted) {
          setQuizzes(list);
          setLoading(false);
        }
      },
      (err) => console.error("Quizzes sync error:", err)
    );

    const unsubUsers = onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        const uList: any[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          uList.push({
            id: d.id,
            email: (data.email || d.id || "").toLowerCase(),
            displayName: data.displayName || data.name || (data.email || d.id || "").split("@")[0],
            ...data,
          });
        });
        if (isMounted) {
          setUsers(uList);
        }
      },
      (err) => console.error("Users sync error in quiz:", err)
    );

    return () => {
      isMounted = false;
      unsubQuizzes();
      unsubUsers();
    };
  }, []);

  // Helper to extract numeric score and raw info from user's quiz record
  const extractQuizAttempt = (rawScore: any, quizQuestionsCount: number) => {
    if (rawScore === undefined || rawScore === null) return null;
    let scoreNum = 0;
    let totalNum = quizQuestionsCount || 10;

    if (typeof rawScore === "number") {
      scoreNum = rawScore;
      if (scoreNum > totalNum && scoreNum <= 100) {
        const pct = Math.min(100, Math.round(scoreNum));
        return { score: Math.round((pct / 100) * totalNum), total: totalNum, pct, passed: pct >= 70 };
      }
      const pct = totalNum > 0 ? Math.round((scoreNum / totalNum) * 100) : 0;
      return { score: scoreNum, total: totalNum, pct, passed: pct >= 70 };
    }

    if (typeof rawScore === "object") {
      if (typeof rawScore.score === "number") scoreNum = rawScore.score;
      if (typeof rawScore.total === "number" && rawScore.total > 0) totalNum = rawScore.total;
      let pct = totalNum > 0 ? Math.round((scoreNum / totalNum) * 100) : 0;
      if (typeof rawScore.percentage === "number") pct = Math.round(rawScore.percentage);
      return { score: scoreNum, total: totalNum, pct, passed: pct >= 70 };
    }

    return null;
  };

  // 2. Metrics & Analytics Calculations
  const {
    activeCount,
    inactiveCount,
    totalAttempts,
    avgPlatformScore,
    totalAgentsTracked,
    topQuizzes,
    bottomQuizzes,
    agentBreakdown,
  } = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let attempts = 0;
    let sumAllPct = 0;
    let countAllPct = 0;

    // Track per-quiz stats across all agents
    const quizStatsMap: Record<string, { title: string; totalScore: number; attempts: number }> = {};
    quizzes.forEach((q) => {
      if (q.active) active++;
      else inactive++;
      attempts += q.attempts || 0;
      quizStatsMap[q.id] = { title: q.title, totalScore: 0, attempts: 0 };
    });

    // Compute agent breakdown
    const rawBreakdown = users.map((u) => {
      let quizzesTaken = 0;
      let userSumPct = 0;
      let passedCount = 0;
      let highestQuizPct = -1;
      let lowestQuizPct = 101;
      let strongestTitle = "—";
      let weakestTitle = "—";

      // Data Recovery: Normalize both nested and flat score formats
      let normalizedScores: Record<string, any> = {};
      if (u.quizScores && typeof u.quizScores === "object") {
        normalizedScores = { ...u.quizScores };
      }
      for (const key in u) {
        if (key.startsWith("quizScores.")) {
          normalizedScores[key.split(".")[1]] = u[key];
        }
      }

      const userHistoryList: any[] = [];
      const processedQuizIds = new Set<string>();

      // Iterate through user's quiz scores
      for (const [scoreKey, rawVal] of Object.entries(normalizedScores)) {
        const q = quizzes.find(
          (quiz) =>
            quiz.id === scoreKey ||
            quiz.id === ("Q" + scoreKey) ||
            scoreKey === ("Q" + quiz.id) ||
            quiz.id.replace(/\\D/g, "") === scoreKey.replace(/\\D/g, "")
        );
        const resolvedQuizId = q?.id || scoreKey;
        if (processedQuizIds.has(resolvedQuizId)) continue;
        processedQuizIds.add(resolvedQuizId);

        const questionsCount = q?.questions || q?.questionData?.length || 10;
        const quizTitle = q?.title || ("Assessment #" + scoreKey);
        const attempt = extractQuizAttempt(rawVal, questionsCount);

        if (attempt) {
          quizzesTaken++;
          userSumPct += attempt.pct;
          sumAllPct += attempt.pct;
          countAllPct++;
          if (attempt.passed) passedCount++;

          userHistoryList.push({
            id: resolvedQuizId,
            title: quizTitle,
            score: attempt.score,
            totalQs: attempt.total,
            pct: attempt.pct,
            passed: attempt.passed,
          });

          if (quizStatsMap[resolvedQuizId]) {
            quizStatsMap[resolvedQuizId].totalScore += attempt.pct;
            quizStatsMap[resolvedQuizId].attempts++;
          }

          if (attempt.pct > highestQuizPct) {
            highestQuizPct = attempt.pct;
            strongestTitle = quizTitle;
          }
          if (attempt.pct < lowestQuizPct) {
            lowestQuizPct = attempt.pct;
            weakestTitle = quizTitle;
          }
        }
      }

      const userAvg = quizzesTaken > 0 ? Math.round(userSumPct / quizzesTaken) : 0;
      const passRate = quizzesTaken > 0 ? Math.round((passedCount / quizzesTaken) * 100) : 0;

      return {
        id: u.id,
        email: u.email,
        displayName: u.displayName || u.name || u.email.split("@")[0],
        photoURL: u.photoURL || u.avatarUrl || u.profilePhoto || u.profileImage,
        quizzesTaken,
        avgScore: userAvg,
        passRate,
        strongestTopic: strongestTitle !== "—" ? strongestTitle : "None",
        weakestTopic: weakestTitle !== "—" ? weakestTitle : "None",
        history: userHistoryList,
        rawUser: u,
      };
    });

    // TOTAL AGENTS TRACKED = Count ONLY those who attempted at least 1 quiz!
    const activeTrackedAgents = rawBreakdown
      .filter((a) => a.quizzesTaken > 0)
      .sort((a, b) => b.avgScore - a.avgScore);

    const avgPlatform = countAllPct > 0 ? Math.round(sumAllPct / countAllPct) : 0;

    // Calculate Top and Bottom performing quizzes
    const quizPerformanceList = Object.entries(quizStatsMap)
      .filter(([_, data]) => data.attempts > 0)
      .map(([id, data]) => ({
        id,
        title: data.title,
        avgScore: Math.round(data.totalScore / data.attempts),
        attempts: data.attempts,
      }));

    // Top 3
    const sortedTop = [...quizPerformanceList].sort((a, b) => b.avgScore - a.avgScore).slice(0, 3);
    // Bottom 3
    const sortedBottom = [...quizPerformanceList]
      .filter((q) => q.avgScore < 90)
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, 3);

    return {
      activeCount: active,
      inactiveCount: inactive,
      totalAttempts: attempts,
      avgPlatformScore: avgPlatform,
      totalAgentsTracked: activeTrackedAgents.length,
      topQuizzes: sortedTop,
      bottomQuizzes: sortedBottom,
      agentBreakdown: activeTrackedAgents,
    };
  }, [quizzes, users]);

  // Selected agent detailed metrics for modal
  const agentModalDetails = useMemo(() => {
    if (!selectedAgentForAnalytics) return null;
    const agent = selectedAgentForAnalytics;
    const history = [...(agent.history || [])];

    // Strengths & Weaknesses (Top 5 & Bottom 5)
    const sortedByScore = [...history].sort((a, b) => b.pct - a.pct);
    const top5Strongest = sortedByScore.slice(0, 5);
    const top5Weakest = [...history]
      .filter((item) => item.pct < 90)
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 5);

    // Sorted alphabetically by title for table history
    history.sort((a, b) => a.title.localeCompare(b.title));

    const totalPages = Math.max(1, Math.ceil(history.length / historyPerPage));
    const start = (agentHistoryPage - 1) * historyPerPage;
    const paginatedHistory = history.slice(start, start + historyPerPage);

    return {
      agent,
      top5Strongest,
      top5Weakest,
      history,
      paginatedHistory,
      totalPages,
    };
  }, [selectedAgentForAnalytics, agentHistoryPage]);

  // Toggle Active Status Switch
  const handleToggleStatus = async (quiz: Quiz) => {
    try {
      const docRef = doc(db, "quizzes", quiz.id);
      await updateDoc(docRef, { active: !quiz.active });
      toast.info(`Assessment ${!quiz.active ? "activated" : "deactivated"}.`);
    } catch (e: any) {
      toast.error("Failed to toggle status: " + e.message);
    }
  };

  // Open Editor
  const handleOpenEditor = (quiz?: Quiz) => {
    if (quiz) {
      setEditingId(quiz.id);
      setQuizTitle(quiz.title || "");
      setQuizTime(quiz.time || 15);
      setMobileAllowed(!!quiz.mobileAllowed);
      setQuestions(
        quiz.questionData && quiz.questionData.length > 0
          ? quiz.questionData
          : [{ text: "", options: ["", "", "", ""], correct: 1 }]
      );
    } else {
      setEditingId(null);
      setQuizTitle("");
      setQuizTime(15);
      setMobileAllowed(false);
      setQuestions([{ text: "", options: ["", "", "", ""], correct: 1 }]);
    }
    setViewMode("editor");
  };

  // Add/Remove Questions
  const handleAddQuestion = () => {
    setQuestions([...questions, { text: "", options: ["", "", "", ""], correct: 1 }]);
  };

  const handleRemoveQuestion = (idx: number) => {
    if (questions.length <= 1) {
      toast.warning("Assessment must have at least one question.");
      return;
    }
    setQuestions(questions.filter((_, i) => i !== idx));
  };

  const handleUpdateQuestion = (idx: number, updated: Partial<MCQQuestion>) => {
    const next = [...questions];
    next[idx] = { ...next[idx], ...updated };
    setQuestions(next);
  };

  // Save Quiz
  const handleSaveQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quizTitle.trim()) {
      toast.warning("Assessment title is required.");
      return;
    }

    setSavingQuiz(true);
    const payload = {
      title: quizTitle.trim(),
      time: Number(quizTime) || 15,
      mobileAllowed: !!mobileAllowed,
      questions: questions.length,
      questionData: questions,
      active: true,
      updatedAt: Date.now(),
    };

    try {
      if (editingId) {
        await setDoc(doc(db, "quizzes", editingId), payload, { merge: true });
        toast.success("Assessment updated successfully!");
      } else {
        const nextNum = Math.max(0, ...quizzes.map((q) => Number(q.id) || 0)) + 1;
        const newId = String(nextNum);

        await setDoc(doc(db, "quizzes", newId), {
          ...payload,
          date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          attempts: 0,
          createdAt: Date.now(),
        });
        toast.success("New assessment created successfully!");
      }
      await touchMetadata("quizzes");
      setViewMode("table");
    } catch (err: any) {
      toast.error("Failed to save assessment: " + err.message);
    } finally {
      setSavingQuiz(false);
    }
  };

  // Single Delete
  const handleDeleteSingle = async (id: string) => {
    const confirmed = await showConfirm({
      title: "Delete Assessment?",
      message: "Are you sure you want to delete Quiz #" + id + "?",
      isDestructive: true,
      confirmText: "Delete Quiz",
    });
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "quizzes", id));
      await touchMetadata("quizzes");
      toast.success("Assessment deleted successfully.");
    } catch (e: any) {
      toast.error("Delete failed: " + e.message);
    }
  };

  // Bulk Delete
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await showConfirm({
      title: "Delete Selected Quizzes?",
      message: "Are you sure you want to delete " + selectedIds.size + " selected assessments?",
      isDestructive: true,
      confirmText: "Delete Quizzes",
    });
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach((id) => {
        batch.delete(doc(db, "quizzes", id));
      });
      await batch.commit();
      await touchMetadata("quizzes");
      setSelectedIds(new Set());
      toast.success(selectedIds.size + " assessments deleted successfully.");
    } catch (e: any) {
      toast.error("Bulk delete failed: " + e.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  // Template Download
  const handleDownloadTemplate = () => {
    const headers = [["Question", "Option 1", "Option 2", "Option 3", "Option 4", "Correct Option (1-4)"]];
    const sample = [
      ["What is the standard procedure for Phase 1 inspection?", "Follow SOP 1", "Skip to SOP 2", "Call supervisor", "None", 1],
      ["How many days are given for grievance resolution?", "7 Days", "15 Days", "30 Days", "45 Days", 2],
    ];
    const ws = XLSX.utils.aoa_to_sheet([...headers, ...sample]);
    ws["!cols"] = [{ wch: 45 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Quiz Template");
    XLSX.writeFile(wb, "ESIC_Quiz_Upload_Template.xlsx");
  };

  // Bulk Upload Questions
  const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        if (rows.length === 0) {
          toast.warning("The uploaded spreadsheet is empty.");
          return;
        }

        const newQuestions: MCQQuestion[] = [];
        rows.forEach((row) => {
          const qText = row["Question"] || row["Question Text"] || "";
          if (qText) {
            newQuestions.push({
              text: String(qText).trim(),
              options: [
                String(row["Option 1"] || "").trim(),
                String(row["Option 2"] || "").trim(),
                String(row["Option 3"] || "").trim(),
                String(row["Option 4"] || "").trim(),
              ],
              correct: parseInt(row["Correct Option (1-4)"]) || 1,
            });
          }
        });

        if (newQuestions.length > 0) {
          setQuestions(newQuestions);
          toast.success("Imported " + newQuestions.length + " questions from spreadsheet!");
        } else {
          toast.error("No valid questions found in file.");
        }
      } catch (err: any) {
        toast.error("Upload error: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* ----------------------------------------------------
          VIEW 1: GLOBAL QUIZ ANALYTICS (OLD WEBSITE REPLICATED & ENHANCED)
          ---------------------------------------------------- */}
      {viewMode === "global-analytics" ? (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewMode("table")}
                className="p-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl transition-colors"
                title="Back to Quizzes"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">Global Quiz Analytics</h1>
                <p className="text-xs text-slate-500">
                  Real-time telemetry, agent attempts, and competency metrics.
                </p>
              </div>
            </div>

            <button
              onClick={() => setViewMode("table")}
              className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors shadow-xs"
            >
              Back to Quizzes Table
            </button>
          </div>

          {/* 4 Top Metric Cards (TOTAL AGENTS TRACKED ONLY COUNTS ATTEMPTED USERS) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-center">
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                TOTAL QUIZZES
              </div>
              <div className="text-3xl font-black text-blue-600">{quizzes.length}</div>
              <div className="text-[11px] text-slate-400 font-semibold mt-1">
                {activeCount} Active | {inactiveCount} Inactive
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                TOTAL ATTEMPTS
              </div>
              <div className="text-3xl font-black text-amber-600">{totalAttempts}</div>
              <div className="text-[11px] text-slate-400 font-semibold mt-1">Platform Total</div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                AVG PLATFORM SCORE
              </div>
              <div className="text-3xl font-black text-emerald-600">{avgPlatformScore}%</div>
              <div className="text-[11px] text-slate-400 font-semibold mt-1">Overall Average</div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                TOTAL AGENTS TRACKED
              </div>
              <div className="text-3xl font-black text-purple-600">{totalAgentsTracked}</div>
              <div className="text-[11px] text-slate-400 font-semibold mt-1">With Quiz Attempts</div>
            </div>
          </div>

          {/* 2 Comparison Cards (Top Performing vs Needs Improvement) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Top Performing */}
            <div className="bg-white border border-emerald-100 rounded-3xl p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm">
                <TrendingUp className="w-4 h-4" />
                <span>Top Performing Quizzes</span>
              </div>
              <div className="space-y-2">
                {topQuizzes.length === 0 ? (
                  <div className="text-xs text-slate-400 py-3 text-center">No quiz attempt data recorded yet.</div>
                ) : (
                  topQuizzes.map((q, idx) => (
                    <div
                      key={q.id}
                      className="flex items-center justify-between p-3 bg-slate-50/70 border border-slate-100 rounded-xl text-xs"
                    >
                      <span className="font-semibold text-slate-800 truncate pr-2">
                        {idx + 1}. {q.title}
                      </span>
                      <span className="font-extrabold text-emerald-600 shrink-0">{q.avgScore}%</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Needs Improvement */}
            <div className="bg-white border border-rose-100 rounded-3xl p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-rose-700 font-bold text-sm">
                <TrendingDown className="w-4 h-4" />
                <span>Needs Improvement (Lowest Scores)</span>
              </div>
              <div className="space-y-2">
                {bottomQuizzes.length === 0 ? (
                  <div className="text-xs text-slate-400 py-3 text-center">No low scores recorded yet.</div>
                ) : (
                  bottomQuizzes.map((q, idx) => (
                    <div
                      key={q.id}
                      className="flex items-center justify-between p-3 bg-slate-50/70 border border-slate-100 rounded-xl text-xs"
                    >
                      <span className="font-semibold text-slate-800 truncate pr-2">
                        {idx + 1}. {q.title}
                      </span>
                      <span className="font-extrabold text-rose-600 shrink-0">{q.avgScore}%</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Agent Performance Breakdown Table */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-base">Agent Performance Breakdown</h3>

            <div className="overflow-x-auto rounded-2xl border border-slate-100">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                    <th className="p-4">Agent Name</th>
                    <th className="p-4 text-center">Quizzes Taken</th>
                    <th className="p-4 text-center">Avg Score</th>
                    <th className="p-4">Strongest Topic</th>
                    <th className="p-4">Weakest Topic</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                  {agentBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-400">
                        No agent quiz attempts recorded yet.
                      </td>
                    </tr>
                  ) : (
                    agentBreakdown.map((agent) => (
                      <tr key={agent.email} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-4">
                          <button
                            onClick={() => {
                              setSelectedAgentForAnalytics(agent);
                              setAgentHistoryPage(1);
                            }}
                            className="font-bold text-blue-600 hover:underline text-left"
                          >
                            {agent.displayName}
                          </button>
                          <div className="text-[10px] text-slate-400">{agent.email}</div>
                        </td>
                        <td className="p-4 text-center font-bold text-slate-900">{agent.quizzesTaken}</td>
                        <td className="p-4 text-center font-extrabold text-emerald-600">{agent.avgScore}%</td>
                        <td className="p-4">
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold border-l-2 border-emerald-500 pl-2">
                            {agent.strongestTopic}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className="inline-flex items-center gap-1 text-rose-700 font-semibold border-l-2 border-rose-500 pl-2">
                            {agent.weakestTopic}
                          </span>
                        </td>
                        <td className="p-4 text-right whitespace-nowrap">
                          <button
                            onClick={() => {
                              setSelectedAgentForAnalytics(agent);
                              setAgentHistoryPage(1);
                            }}
                            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold transition-colors shadow-2xs"
                          >
                            View Breakdown
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : viewMode === "editor" ? (
        /* ----------------------------------------------------
            VIEW 2: QUIZ EDITOR
            ---------------------------------------------------- */
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <h2 className="text-xl font-bold text-slate-900">
              {editingId ? "Edit Assessment #" + editingId : "Create New Assessment"}
            </h2>
            <button
              onClick={() => setViewMode("table")}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSaveQuiz} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Quiz Title *
                </label>
                <input
                  type="text"
                  value={quizTitle}
                  onChange={(e) => setQuizTitle(e.target.value)}
                  placeholder="e.g. ESIC Scheme & Benefits Assessment Quiz"
                  required
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Time Limit (Minutes)
                </label>
                <input
                  type="number"
                  min="1"
                  max="180"
                  value={quizTime}
                  onChange={(e) => setQuizTime(Number(e.target.value))}
                  required
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold"
                />
              </div>
            </div>

            <div className="flex items-center justify-between border-y border-slate-100 py-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-slate-500" />
                <span className="text-xs font-semibold text-slate-700">Allow Mobile Access</span>
              </div>
              <input
                type="checkbox"
                checked={mobileAllowed}
                onChange={(e) => setMobileAllowed(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded cursor-pointer"
              />
            </div>

            {/* Questions Builder */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900 text-sm">Questions ({questions.length})</h3>
                <button
                  type="button"
                  onClick={handleAddQuestion}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Question</span>
                </button>
              </div>

              {questions.map((q, qIdx) => (
                <div key={qIdx} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-600">Question #{qIdx + 1}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveQuestion(qIdx)}
                      className="text-slate-400 hover:text-rose-600 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <input
                    type="text"
                    value={q.text}
                    onChange={(e) => handleUpdateQuestion(qIdx, { text: e.target.value })}
                    placeholder="Type question text..."
                    required
                    className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none font-semibold focus:ring-2 focus:ring-blue-500"
                  />

                  <div className="space-y-1.5">
                    {q.options.map((opt, optIdx) => (
                      <div key={optIdx} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={"quiz_q_" + qIdx + "_correct"}
                          checked={Number(q.correct) === optIdx + 1}
                          onChange={() => handleUpdateQuestion(qIdx, { correct: optIdx + 1 })}
                          className="w-4 h-4 text-blue-600 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={opt}
                          onChange={(e) => {
                            const newOpts = [...q.options];
                            newOpts[optIdx] = e.target.value;
                            handleUpdateQuestion(qIdx, { options: newOpts });
                          }}
                          placeholder={"Option " + String.fromCharCode(65 + optIdx)}
                          required
                          className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className="px-4 py-2 border border-slate-200 text-xs font-semibold rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingQuiz}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-sm"
              >
                {savingQuiz ? "Saving..." : "Save Assessment"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* ----------------------------------------------------
            VIEW 3: MAIN QUIZZES TABLE
            ---------------------------------------------------- */
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Manage Assessments & Quizzes</h1>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="file"
                id="bulkQuizInput"
                accept=".xlsx, .xls, .csv"
                className="hidden"
                onChange={handleBulkUpload}
              />

              <button
                onClick={() => setViewMode("global-analytics")}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-xl text-xs font-bold shadow-xs transition-colors"
              >
                <BarChart3 className="w-4 h-4" />
                <span>Global Analytics</span>
              </button>

              <button
                onClick={handleDownloadTemplate}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-blue-600 rounded-xl text-xs font-semibold shadow-xs"
              >
                <Download className="w-4 h-4" />
                <span>Template</span>
              </button>

              <button
                onClick={() => document.getElementById("bulkQuizInput")?.click()}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 rounded-xl text-xs font-semibold shadow-xs"
              >
                <Upload className="w-4 h-4" />
                <span>Bulk Upload</span>
              </button>

              <button
                onClick={() => handleOpenEditor()}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Quiz</span>
              </button>
            </div>
          </div>

          {/* 3 Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs text-center">
              <Gamepad2 className="w-6 h-6 text-blue-600 mx-auto mb-2" />
              <div className="text-2xl font-extrabold text-slate-900">{activeCount}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Active Assessments
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs text-center">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto mb-2" />
              <div className="text-2xl font-extrabold text-slate-900">{totalAttempts}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Total Attempts Completed
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs text-center">
              <Clock className="w-6 h-6 text-purple-600 mx-auto mb-2" />
              <div className="text-2xl font-extrabold text-slate-900">{avgPlatformScore}%</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                Avg. Platform Score
              </div>
            </div>
          </div>

          {/* Table Section */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
            {selectedIds.size > 0 && (
              <div className="flex items-center justify-between bg-rose-50 border border-rose-200 px-4 py-2.5 rounded-xl text-xs">
                <span className="font-bold text-rose-800">{selectedIds.size} quizzes selected</span>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold flex items-center gap-1 shadow-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{bulkDeleting ? "Deleting..." : "Delete Selected"}</span>
                </button>
              </div>
            )}

            <div className="overflow-x-auto rounded-2xl border border-slate-100">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                    <th className="p-4 text-center">
                      <input
                        type="checkbox"
                        checked={quizzes.length > 0 && quizzes.every((q) => selectedIds.has(q.id))}
                        onChange={(e) => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) quizzes.forEach((q) => next.add(q.id));
                          else next.clear();
                          setSelectedIds(next);
                        }}
                        className="cursor-pointer"
                      />
                    </th>
                    <th className="p-4">ID</th>
                    <th className="p-4">Date Created</th>
                    <th className="p-4">Quiz Title</th>
                    <th className="p-4 text-center">Questions</th>
                    <th className="p-4 text-center">Attempts</th>
                    <th className="p-4 text-center">Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-slate-400">
                        Loading assessments...
                      </td>
                    </tr>
                  ) : quizzes.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-slate-400">
                        No assessments created yet.
                      </td>
                    </tr>
                  ) : (
                    quizzes.map((quiz) => (
                      <tr key={quiz.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-4 text-center">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(quiz.id)}
                            onChange={(e) => {
                              const next = new Set(selectedIds);
                              if (e.target.checked) next.add(quiz.id);
                              else next.delete(quiz.id);
                              setSelectedIds(next);
                            }}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="p-4 font-mono font-bold text-blue-600">#{quiz.id}</td>
                        <td className="p-4 text-slate-400">{quiz.date}</td>
                        <td className="p-4 font-bold text-slate-900">{quiz.title}</td>
                        <td className="p-4 text-center">{quiz.questions}</td>
                        <td className="p-4 text-center font-bold text-emerald-700">
                          {quiz.attempts || 0}
                        </td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => handleToggleStatus(quiz)}
                            className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${
                              quiz.active
                                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                            }`}
                          >
                            {quiz.active ? "Active" : "Inactive"}
                          </button>
                        </td>
                        <td className="p-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleOpenEditor(quiz)}
                              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded"
                              title="Edit Quiz"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteSingle(quiz.id)}
                              className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded"
                              title="Delete Quiz"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================
          MODAL: INDIVIDUAL AGENT DETAILED PERFORMANCE REPORT
          ==================================================== */}
      {agentModalDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-4xl w-full rounded-3xl shadow-2xl overflow-hidden border border-slate-100 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="px-8 py-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-blue-600 text-white font-extrabold text-2xl flex items-center justify-center overflow-hidden border-2 border-white shadow-sm shrink-0">
                  {agentModalDetails.agent.photoURL ? (
                    <img
                      src={agentModalDetails.agent.photoURL}
                      alt="Avatar"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    (agentModalDetails.agent.displayName || "A").charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 leading-tight">
                    {agentModalDetails.agent.displayName}
                  </h2>
                  <div className="text-xs text-slate-400 font-medium">
                    {agentModalDetails.agent.email}
                  </div>
                </div>
              </div>

              <button
                onClick={() => setSelectedAgentForAnalytics(null)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Modal Content */}
            <div className="p-8 overflow-y-auto flex-1 space-y-8 bg-white">
              {/* 3 Top Metrics Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                <div className="border border-slate-200 rounded-2xl p-5 shadow-2xs">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Quizzes Taken
                  </div>
                  <div className="text-3xl font-black text-blue-600 mt-1">
                    {agentModalDetails.agent.quizzesTaken}
                  </div>
                </div>

                <div className="border border-slate-200 rounded-2xl p-5 shadow-2xs">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Average Score
                  </div>
                  <div className="text-3xl font-black text-emerald-600 mt-1">
                    {agentModalDetails.agent.avgScore}%
                  </div>
                </div>

                <div className="border border-slate-200 rounded-2xl p-5 shadow-2xs">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Pass Rate
                  </div>
                  <div className="text-3xl font-black text-amber-600 mt-1">
                    {agentModalDetails.agent.passRate}%
                  </div>
                </div>
              </div>

              {/* Strengths & Weaknesses (Top 5 & Bottom 5) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Top 5 Strongest */}
                <div className="border border-emerald-200 rounded-2xl p-6 bg-[#f4fbf6] space-y-3">
                  <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm">
                    <TrendingUp className="w-4 h-4" />
                    <span>Top 5 Strongest Topics</span>
                  </div>
                  <div className="space-y-2.5">
                    {agentModalDetails.top5Strongest.length === 0 ? (
                      <div className="text-xs text-slate-400">No data available</div>
                    ) : (
                      agentModalDetails.top5Strongest.map((item: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between pb-2 border-b border-emerald-100 text-xs"
                        >
                          <span className="font-semibold text-slate-800 truncate pr-2" title={item.title}>
                            {item.title}
                          </span>
                          <span className="font-extrabold text-emerald-700 shrink-0">{item.pct}%</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Top 5 Weakest */}
                <div className="border border-rose-200 rounded-2xl p-6 bg-[#fdf3f2] space-y-3">
                  <div className="flex items-center gap-2 text-rose-700 font-bold text-sm">
                    <TrendingDown className="w-4 h-4" />
                    <span>Top 5 Weakest Topics</span>
                  </div>
                  <div className="space-y-2.5">
                    {agentModalDetails.top5Weakest.length === 0 ? (
                      <div className="text-xs text-slate-400">No weak topics identified (&gt;= 90% in all).</div>
                    ) : (
                      agentModalDetails.top5Weakest.map((item: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between pb-2 border-b border-rose-100 text-xs"
                        >
                          <span className="font-semibold text-slate-800 truncate pr-2" title={item.title}>
                            {item.title}
                          </span>
                          <span className="font-extrabold text-rose-700 shrink-0">{item.pct}%</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Full Assessment History Table */}
              <div className="space-y-3">
                <h3 className="font-bold text-slate-900 text-base">Full Assessment History</h3>

                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                        <th className="p-4" style={{ width: "50%" }}>Quiz Title</th>
                        <th className="p-4 text-center" style={{ width: "20%" }}>Raw Score</th>
                        <th className="p-4 text-center" style={{ width: "15%" }}>Percentage</th>
                        <th className="p-4 text-center" style={{ width: "15%" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                      {agentModalDetails.paginatedHistory.map((item: any) => (
                        <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="p-4 font-semibold text-slate-900">{item.title}</td>
                          <td className="p-4 text-center text-slate-500 font-medium">
                            {item.score} / {item.totalQs}
                          </td>
                          <td
                            className={`p-4 text-center font-extrabold ${
                              item.passed ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            {item.pct}%
                          </td>
                          <td className="p-4 text-center">
                            <span
                              className={`px-3 py-1 rounded-full text-[11px] font-bold ${
                                item.passed
                                  ? "bg-[#e6f4ea] text-[#137333]"
                                  : "bg-[#fce8e6] text-[#c5221f]"
                              }`}
                            >
                              {item.passed ? "Passed" : "Failed"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {agentModalDetails.totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2 text-xs text-slate-500">
                    <div>
                      Page {agentHistoryPage} of {agentModalDetails.totalPages}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setAgentHistoryPage((p) => Math.max(1, p - 1))}
                        disabled={agentHistoryPage === 1}
                        className="px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 font-semibold flex items-center gap-1"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span>Previous</span>
                      </button>
                      <button
                        onClick={() => setAgentHistoryPage((p) => Math.min(agentModalDetails.totalPages, p + 1))}
                        disabled={agentHistoryPage === agentModalDetails.totalPages}
                        className="px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 font-semibold flex items-center gap-1"
                      >
                        <span>Next</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
