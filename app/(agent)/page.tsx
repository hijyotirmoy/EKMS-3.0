"use client";

import React, { useEffect, useState, useMemo } from "react";
import { collection, onSnapshot, doc, setDoc, increment } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getOrFetchCollection } from "@/lib/cache";
import { QnAItem } from "@/lib/types";
import { Search, Flag, ChevronLeft, ChevronRight, BookOpen, Calendar, HelpCircle } from "lucide-react";
import ReportIssueModal from "@/components/common/ReportIssueModal";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const { userProfile, isLoggedIn } = useAuth();
  const router = useRouter();

  // Dispensary staff are automatically redirected to their appointment dashboard
  useEffect(() => {
    if (isLoggedIn && (userProfile?.role === "Dispensary Staff" || userProfile?.role === "Dispensary")) {
      router.replace("/appointment");
    }
  }, [isLoggedIn, userProfile, router]);

  const [qaList, setQaList] = useState<QnAItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  // Report modal state
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; code: string; title: string }>({
    id: "",
    code: "",
    title: "",
  });

  // Clamped answers tracker
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  // 1. Fetch Q&A database with session cache to minimize Firebase reads
  useEffect(() => {
    let isMounted = true;

    const loadQa = async () => {
      try {
        const list = await getOrFetchCollection<QnAItem>("qna");
        if (isMounted) {
          list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          setQaList(list);
          setLoading(false);
        }
      } catch (err) {
        console.error("Error loading Q&A:", err);
        if (isMounted) setLoading(false);
      }
    };

    loadQa();

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Global search listener from Navbar
  useEffect(() => {
    const handleGlobalSearch = (e: CustomEvent<string>) => {
      const q = e.detail || "";
      setSearchQuery(q);
      if (q.trim()) {
        setSelectedCategory("All");
      }
      setCurrentPage(1);
    };

    // Check URL params on initial load
    const params = new URLSearchParams(window.location.search);
    const searchParam = params.get("search");
    if (searchParam) {
      setSearchQuery(searchParam);
      setSelectedCategory("All");
    }

    window.addEventListener("ekms-global-search" as any, handleGlobalSearch);
    return () => window.removeEventListener("ekms-global-search" as any, handleGlobalSearch);
  }, []);

  // Extract unique categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    qaList.forEach((item) => {
      if (item.category) set.add(item.category.trim());
    });
    return ["All", ...Array.from(set).sort()];
  }, [qaList]);

  // Filter Q&A by category and search
  const filteredQAs = useMemo(() => {
    let result = qaList;
    const q = searchQuery.toLowerCase().trim();

    // If search is typed, ignore category filter to search full database
    if (q.length > 0) {
      const numQuery = q.replace(/\D/g, "");

      result = result.filter((item) => {
        const matchQ = item.question?.toLowerCase().includes(q);
        const matchA = item.answer?.toLowerCase().includes(q);
        const matchCat = item.category?.toLowerCase().includes(q);
        const matchTag = item.tags?.some((t) => t.toLowerCase().includes(q));
        const matchCode = item.qaCode?.toLowerCase().includes(q);
        const matchSeq = numQuery && item.qaSequence && String(item.qaSequence) === numQuery;

        return matchQ || matchA || matchCat || matchTag || matchCode || matchSeq;
      });
    } else if (selectedCategory !== "All") {
      const catLower = selectedCategory.toLowerCase();
      result = result.filter(
        (item) =>
          item.category?.toLowerCase() === catLower ||
          item.tags?.some((t) => t.toLowerCase() === catLower)
      );
    }

    return result;
  }, [qaList, selectedCategory, searchQuery]);

  // 3. Debounced missing query logger (conserves Firestore write quota)
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 3) return;
    const q = searchQuery.toLowerCase().trim();

    const timer = setTimeout(() => {
      if (filteredQAs.length === 0 && !loading) {
        try {
          const docRef = doc(db, "missing_searches", q);
          setDoc(
            docRef,
            {
              term: q,
              count: increment(1),
              lastAttempt: Date.now(),
            },
            { merge: true }
          );
        } catch (e) {
          console.error("Failed to log missing search:", e);
        }
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [searchQuery, filteredQAs.length, loading]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(filteredQAs.length / itemsPerPage));
  const paginatedQAs = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredQAs.slice(start, start + itemsPerPage);
  }, [filteredQAs, currentPage]);

  const toggleExpand = (id: string) => {
    setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleOpenReport = (qa: QnAItem) => {
    setReportTarget({
      id: qa.id,
      code: qa.qaCode || "QA",
      title: qa.question || "Untitled Q&A",
    });
    setReportModalOpen(true);
  };

  // Plain Text Highlighter
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;
    const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    const parts = text.split(regex);

    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-300 text-slate-900 px-1 py-0.5 rounded font-bold shadow-xs">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  // Safe HTML Highlighter for Answer Blocks
  const highlightHtml = (htmlContent: string, query: string) => {
    if (!query.trim() || query.trim().length < 2) return htmlContent;
    try {
      const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(?![^<]*>)(${escaped})`, "gi");
      return htmlContent.replace(
        regex,
        `<mark class="bg-yellow-300 text-slate-900 px-1 py-0.5 rounded font-bold shadow-xs">$1</mark>`
      );
    } catch (e) {
      return htmlContent;
    }
  };

  return (
    <div className="space-y-2.5 sm:space-y-6">
      {/* Category Filter Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-2 scrollbar-none select-none">
        {categories.map((cat) => {
          const isActive = selectedCategory === cat && !searchQuery;
          return (
            <button
              key={cat}
              onClick={() => {
                setSearchQuery("");
                setSelectedCategory(cat);
                setCurrentPage(1);
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all shadow-xs ${
                isActive
                  ? "bg-slate-900 text-white shadow-sm"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300"
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Active Filter / Search Notification */}
      {(searchQuery || selectedCategory !== "All") && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-100 px-4 py-2 rounded-xl text-xs text-blue-900">
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-blue-600" />
            <span>
              Showing <strong>{filteredQAs.length}</strong> results{" "}
              {searchQuery && (
                <>
                  matching &quot;<strong>{searchQuery}</strong>&quot; across all categories
                </>
              )}
              {!searchQuery && selectedCategory !== "All" && (
                <>
                  in <strong>{selectedCategory}</strong>
                </>
              )}
            </span>
          </div>
          <button
            onClick={() => {
              setSearchQuery("");
              setSelectedCategory("All");
              setCurrentPage(1);
            }}
            className="font-bold underline hover:text-blue-700 ml-3"
          >
            Clear Filters
          </button>
        </div>
      )}

      {/* Q&A Cards Feed */}
      <div className="space-y-4">
        {loading ? (
          <div className="space-y-4">
            {/* Skeleton Category Pills */}
            <div className="flex items-center gap-2 overflow-hidden pb-1">
              {[100, 80, 120, 90, 110, 85, 95].map((w, i) => (
                <div
                  key={i}
                  className="h-7 bg-slate-200 rounded-full animate-pulse shrink-0"
                  style={{ width: `${w}px` }}
                />
              ))}
            </div>

            {/* 6 Shimmering Skeleton Q&A Cards */}
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div
                key={n}
                className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3.5 animate-pulse"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-16 bg-slate-200 rounded-md" />
                    <div className="h-5 w-28 bg-blue-100 rounded-md" />
                  </div>
                  <div className="h-4 w-20 bg-slate-100 rounded" />
                </div>

                <div className="space-y-2 pt-1">
                  <div className="h-5 w-4/5 bg-slate-200 rounded-md" />
                  <div className="h-4 w-3/5 bg-slate-100 rounded-md" />
                </div>

                <div className="space-y-1.5 pt-1">
                  <div className="h-3.5 w-full bg-slate-100 rounded" />
                  <div className="h-3.5 w-11/12 bg-slate-100 rounded" />
                  <div className="h-3.5 w-4/6 bg-slate-100 rounded" />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <div className="h-4 w-20 bg-blue-100 rounded" />
                  <div className="h-4 w-16 bg-slate-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredQAs.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-xs">
            <HelpCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800 mb-1">No Guidelines Found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
              We couldn&apos;t find any answers matching your query. Our system has logged this search to add guidance soon!
            </p>
            <button
              onClick={() => {
                setSearchQuery("");
                setSelectedCategory("All");
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
            >
              Reset Search
            </button>
          </div>
        ) : (
          paginatedQAs.map((qa) => {
            const isExpanded = !!expandedCards[qa.id];
            const plainText = (qa.answer || "").replace(/<[^>]*>?/gm, "").trim();
            const needsReadMore = plainText.length > 220 || (qa.answer && (qa.answer.includes("<br") || qa.answer.includes("<p>") || qa.answer.includes("<ul>") || qa.answer.includes("<ol>")));
            const dateStr = qa.updatedAt
              ? new Date(qa.updatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "Recently";

            return (
              <article
                key={qa.id}
                className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs hover:shadow-md transition-all group"
              >
                {/* Header Pills */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bg-slate-100 border border-slate-300 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                      {highlightText(qa.qaCode || "QA-Unassigned", searchQuery)}
                    </span>
                    <span className="bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                      {highlightText(qa.category || "General", searchQuery)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{dateStr}</span>
                  </div>
                </div>

                {/* Title */}
                <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">
                  {highlightText(qa.question || "Untitled", searchQuery)}
                </h3>

                {/* Answer Content */}
                <div className="relative">
                  <div
                    className={`text-sm text-slate-700 leading-relaxed rich-text-content ${
                      !isExpanded && needsReadMore ? "line-clamp-4" : ""
                    }`}
                    dangerouslySetInnerHTML={{
                      __html: highlightHtml(qa.answer || "No answer provided.", searchQuery),
                    }}
                  />

                  {/* Actions Row */}
                  <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100">
                    {needsReadMore ? (
                      <button
                        onClick={() => toggleExpand(qa.id)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                      >
                        {isExpanded ? "Read Less" : "Read More"}
                      </button>
                    ) : (
                      <div />
                    )}

                    <button
                      onClick={() => handleOpenReport(qa)}
                      className="text-slate-400 hover:text-rose-600 text-xs font-medium flex items-center gap-1 p-1 rounded transition-colors"
                      title="Report issue with this Q&A"
                    >
                      <Flag className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Report</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-4 pb-12 select-none">
          <button
            onClick={() => {
              setCurrentPage((p) => Math.max(1, p - 1));
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            disabled={currentPage === 1}
            className="flex items-center gap-1 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-slate-700 rounded-full shadow-xs transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-blue-600" />
            <span>Previous</span>
          </button>

          <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-full">
            Page {currentPage} of {totalPages}
          </span>

          <button
            onClick={() => {
              setCurrentPage((p) => Math.min(totalPages, p + 1));
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            disabled={currentPage === totalPages}
            className="flex items-center gap-1 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-slate-700 rounded-full shadow-xs transition-colors"
          >
            <span>Next</span>
            <ChevronRight className="w-4 h-4 text-blue-600" />
          </button>
        </div>
      )}

      {/* Issue Reporting Modal */}
      <ReportIssueModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        targetId={reportTarget.id}
        reportType="Q&A"
        targetCodeOrName={`${reportTarget.code}: ${reportTarget.title}`}
      />
    </div>
  );
}
