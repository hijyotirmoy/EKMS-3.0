import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { collection, onSnapshot, doc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Quiz } from "../lib/types";
import {
  GraduationCap,
  Clock,
  Award,
  CheckCircle2,
  XCircle,
  Play,
  ArrowRight,
  RotateCcw,
  Sparkles,
} from "lucide-react";

export default function QuizzesView() {
  const { user, userProfile, refreshProfile } = useAuth();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);

  // Active Quiz State
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [quizFinished, setQuizFinished] = useState(false);
  const [finalScore, setFinalScore] = useState({ score: 0, total: 0, passed: false });

  const userEmail = (user?.email || "").toLowerCase().trim();

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "quizzes"),
      (snapshot) => {
        const list: Quiz[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as Quiz);
        });
        setQuizzes(list);
        setLoading(false);
      },
      (err) => {
        console.warn("Quizzes listener error:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const startQuiz = (quiz: Quiz) => {
    setActiveQuiz(quiz);
    setCurrentQIndex(0);
    setSelectedAnswers({});
    setQuizFinished(false);
  };

  const handleSelectOption = (qIndex: number, optionIndex: number) => {
    setSelectedAnswers((prev) => ({ ...prev, [qIndex]: optionIndex }));
  };

  const handleFinishQuiz = async () => {
    if (!activeQuiz) return;

    let correctCount = 0;
    const questions = activeQuiz.questions || [];

    questions.forEach((q, idx) => {
      if (selectedAnswers[idx] === q.correctAnswer) {
        correctCount++;
      }
    });

    const percent = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
    const isPass = percent >= (activeQuiz.passingScore || 60);

    setFinalScore({
      score: percent,
      total: questions.length,
      passed: isPass,
    });
    setQuizFinished(true);

    // Save score in user profile
    if (userEmail) {
      try {
        const userRef = doc(db, "users", userEmail);
        const updates: any = {
          [`quizScores.${activeQuiz.id}`]: percent,
          totalQuizzesTaken: (userProfile?.totalQuizzesTaken || 0) + 1,
        };

        if (isPass) {
          updates.quizCompleted = arrayUnion(activeQuiz.id);
          updates.quizzesPassed = (userProfile?.quizzesPassed || 0) + 1;
        }

        await updateDoc(userRef, updates);
        await refreshProfile();
      } catch (e) {
        console.warn("Failed to save quiz score:", e);
      }
    }
  };

  if (activeQuiz) {
    const questions = activeQuiz.questions || [];
    const currentQ = questions[currentQIndex];
    const isLast = currentQIndex === questions.length - 1;

    if (quizFinished) {
      return (
        <div className="p-4 space-y-6 max-w-md mx-auto text-center pt-8 pb-24">
          <div className="p-8 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
            <div
              className={`w-20 h-20 mx-auto rounded-3xl flex items-center justify-center shadow-lg ${
                finalScore.passed
                  ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-rose-600/20 text-rose-400 border border-rose-500/30"
              }`}
            >
              {finalScore.passed ? (
                <Award className="w-10 h-10 animate-bounce" />
              ) : (
                <XCircle className="w-10 h-10" />
              )}
            </div>

            <div>
              <h3 className="text-2xl font-bold text-white">
                {finalScore.passed ? "Congratulations! 🎉" : "Keep Practicing! 💪"}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {finalScore.passed
                  ? "You passed the assessment with flying colors!"
                  : "You didn't reach the required score. Review the material and try again."}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-around">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Score</span>
                <span className="text-2xl font-bold text-blue-400">{finalScore.score}%</span>
              </div>
              <div className="h-8 w-px bg-slate-800" />
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Status</span>
                <span
                  className={`text-sm font-bold uppercase ${
                    finalScore.passed ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {finalScore.passed ? "PASSED" : "FAILED"}
                </span>
              </div>
            </div>

            <button
              onClick={() => setActiveQuiz(null)}
              className="w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm shadow-lg shadow-blue-600/30 transition-all active:scale-95"
            >
              Return to Quizzes
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="p-4 space-y-4 pb-24 max-w-md mx-auto">
        {/* Quiz Runner Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h3 className="font-bold text-base text-white truncate max-w-[200px]">
              {activeQuiz.title}
            </h3>
            <span className="text-xs text-slate-400">
              Question {currentQIndex + 1} of {questions.length}
            </span>
          </div>

          <button
            onClick={() => setActiveQuiz(null)}
            className="text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded-lg bg-slate-800"
          >
            Exit
          </button>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
          <div
            className="bg-blue-500 h-full transition-all duration-300"
            style={{ width: `${((currentQIndex + 1) / questions.length) * 100}%` }}
          />
        </div>

        {/* Question Card */}
        {currentQ ? (
          <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-4 shadow-sm">
            <h4 className="font-bold text-white text-base leading-snug">
              {currentQ.question}
            </h4>

            {/* Options */}
            <div className="space-y-2.5 pt-2">
              {currentQ.options.map((opt, oIdx) => {
                const isSelected = selectedAnswers[currentQIndex] === oIdx;
                return (
                  <button
                    key={oIdx}
                    onClick={() => handleSelectOption(currentQIndex, oIdx)}
                    className={`w-full p-3.5 rounded-2xl border text-left text-xs font-medium flex items-center gap-3 transition-all ${
                      isSelected
                        ? "bg-blue-600/20 border-blue-500 text-white shadow-sm ring-1 ring-blue-500"
                        : "bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border flex-shrink-0 ${
                        isSelected
                          ? "bg-blue-600 border-blue-500 text-white"
                          : "border-slate-700 text-slate-400"
                      }`}
                    >
                      {String.fromCharCode(65 + oIdx)}
                    </span>
                    <span className="flex-1 leading-relaxed">{opt}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Navigation Buttons */}
        <div className="flex items-center gap-3 pt-2">
          {currentQIndex > 0 && (
            <button
              onClick={() => setCurrentQIndex((i) => i - 1)}
              className="py-3 px-4 rounded-xl bg-slate-800 text-slate-300 font-semibold text-xs"
            >
              Previous
            </button>
          )}

          {isLast ? (
            <button
              onClick={handleFinishQuiz}
              disabled={selectedAnswers[currentQIndex] === undefined}
              className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md shadow-emerald-600/30 transition-all active:scale-95 disabled:opacity-50"
            >
              Finish &amp; Submit Score
            </button>
          ) : (
            <button
              onClick={() => setCurrentQIndex((i) => i + 1)}
              disabled={selectedAnswers[currentQIndex] === undefined}
              className="flex-1 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-md shadow-blue-600/30 flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
            >
              Next Question
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Assessments &amp; Quizzes</h2>
        <p className="text-xs text-slate-400">
          Complete modules to elevate your knowledge streak and badge rank
        </p>
      </div>

      {/* Quiz List */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          Loading assessments...
        </div>
      ) : quizzes.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/60 rounded-3xl border border-slate-800/60 p-6">
          <GraduationCap className="w-12 h-12 mx-auto mb-2 text-slate-600" />
          <h4 className="font-semibold text-white text-sm">No Quizzes Available</h4>
          <p className="text-xs text-slate-400 mt-1">
            Check back later for newly published modules.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {quizzes.map((quiz) => {
            const completed = userProfile?.quizCompleted?.includes(quiz.id);
            const score = userProfile?.quizScores?.[quiz.id];

            return (
              <div
                key={quiz.id}
                className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-white text-sm leading-snug">
                      {quiz.title}
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                      {quiz.description || "ESIC policy test & claim assessment."}
                    </p>
                  </div>

                  {completed ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 uppercase tracking-wider flex-shrink-0">
                      Passed
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <GraduationCap className="w-3.5 h-3.5 text-purple-400" />
                      {quiz.questions?.length || 0} Questions
                    </span>
                    {score !== undefined && (
                      <span className="text-blue-400 font-semibold">
                        Score: {score}%
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => startQuiz(quiz)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow transition-all active:scale-95"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    {completed ? "Retake" : "Start"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
