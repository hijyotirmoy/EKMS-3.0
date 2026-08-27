"use client";

import React, { useState, useEffect, useMemo } from "react";
import { doc, getDoc, collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getOrFetchCollection } from "@/lib/cache";
import { UserProfile, Quiz, Doubt, Course, OrganogramTier } from "@/lib/types";
import {
  Users,
  Mail,
  Cake,
  Flame,
  Crown,
  Shield,
  Headphones,
  PieChart,
  Contact,
  Network,
} from "lucide-react";

interface TeamMemberAnalytics extends UserProfile {
  quizCount: number;
  avgScore: number;
  doubtsAsked: number;
  doubtsResolved: number;
  coursesCompleted: number;
}

export default function TeamPage() {
  const [activeTab, setActiveTab] = useState<"directory" | "organogram" | "analytics">("directory");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [doubts, setDoubts] = useState<Doubt[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [orgTiers, setOrgTiers] = useState<OrganogramTier[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Real-time live listener on users
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      const uList: UserProfile[] = [];
      snap.forEach((d) => {
        const data = d.data();
        uList.push({
          ...(data as Omit<UserProfile, "email">),
          email: d.id,
          displayName: data.displayName || data.name || (data.email || d.id).split("@")[0],
        });
      });
      if (isMounted) {
        setUsers(uList);
        setLoading(false);
      }
    });

    const loadTeamData = async () => {
      try {
        const [qList, dList, cList, orgSnap] = await Promise.all([
          getOrFetchCollection<Quiz>("quizzes"),
          getOrFetchCollection<Doubt>("doubts"),
          getOrFetchCollection<Course>("onboardings", { metaKey: "onboarding" }),
          getDoc(doc(db, "settings", "organogram")),
        ]);

        if (isMounted) {
          setQuizzes(qList);
          setDoubts(dList);
          setCourses(cList);
          if (orgSnap.exists() && orgSnap.data()?.tiers) {
            setOrgTiers(orgSnap.data()?.tiers);
          }
        }
      } catch (err) {
        console.error("Team data load error:", err);
      }
    };

    loadTeamData();

    return () => {
      isMounted = false;
      unsubUsers();
    };
  }, []);

  // Process Aggregated Member Analytics
  const teamAnalytics = useMemo(() => {
    return users.map((u) => {
      let quizCount = 0;
      let pctSum = 0;
      let doubtsAsked = 0;
      let doubtsResolved = 0;
      let coursesCompleted = 0;

      // 1. Quizzes
      if (u.quizScores) {
        Object.entries(u.quizScores).forEach(([qId, score]) => {
          const q = quizzes.find((quiz) => quiz.id === qId);
          if (q && q.questions > 0) {
            quizCount++;
            pctSum += (score / q.questions) * 100;
          }
        });
      }

      // 2. Doubts
      doubts.forEach((d) => {
        if (d.authorEmail?.toLowerCase() === u.email.toLowerCase()) doubtsAsked++;
        if (d.resolvedByEmail?.toLowerCase() === u.email.toLowerCase()) doubtsResolved++;
      });

      // 3. Courses
      if (u.courseProgress) {
        Object.values(u.courseProgress).forEach((prog) => {
          if (prog.status === "completed") coursesCompleted++;
        });
      }

      return {
        ...u,
        quizCount,
        avgScore: quizCount > 0 ? Math.round(pctSum / quizCount) : 0,
        doubtsAsked,
        doubtsResolved,
        coursesCompleted,
      };
    });
  }, [users, quizzes, doubts, courses]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Team Hub & Structure</h1>
      </div>

      {/* 3 Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 select-none">
        <button
          onClick={() => setActiveTab("directory")}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all ${
            activeTab === "directory"
              ? "bg-blue-600 text-white shadow-xs"
              : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Contact className="w-4 h-4" />
          <span>Member Directory</span>
        </button>

        <button
          onClick={() => setActiveTab("organogram")}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all ${
            activeTab === "organogram"
              ? "bg-blue-600 text-white shadow-xs"
              : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Network className="w-4 h-4" />
          <span>Organogram Hierarchy</span>
        </button>

        <button
          onClick={() => setActiveTab("analytics")}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all ${
            activeTab === "analytics"
              ? "bg-blue-600 text-white shadow-xs"
              : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
          }`}
        >
          <PieChart className="w-4 h-4" />
          <span>Performance Analytics</span>
        </button>
      </div>

      {/* ----------------------------------------------------
          TAB 1: DIRECTORY CARDS
          ---------------------------------------------------- */}
      {activeTab === "directory" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-in fade-in duration-150">
          {loading ? (
            <div className="col-span-full text-center py-16 text-slate-400">
              Loading team directory...
            </div>
          ) : (
            users.map((member) => {
              const streak = member.streak || 0;
              const isMaster = member.role === "Master Admin";
              const isAdmin = member.role === "Admin";

              return (
                <div
                  key={member.email}
                  className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all text-center flex flex-col items-center justify-between relative group"
                >
                  {/* Streak & ID badges */}
                  <div className="flex items-center justify-between w-full mb-3 text-xs">
                    {streak > 0 ? (
                      <span className="flex items-center gap-1 font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full text-[10px] border border-rose-100">
                        <Flame className="w-3 h-3 fill-rose-500 text-rose-500" />
                        <span>{streak}d</span>
                      </span>
                    ) : (
                      <span />
                    )}

                    <span className="text-[10px] font-bold text-slate-400">
                      {member.agentId || "#---"}
                    </span>
                  </div>

                  {/* Avatar */}
                  <div className="w-20 h-20 rounded-full bg-blue-600 text-white font-extrabold text-2xl flex items-center justify-center overflow-hidden shadow-md mb-3 border-2 border-white">
                    {member.photoURL || (member as any).avatarUrl || (member as any).profilePhoto || (member as any).profileImage ? (
                      <img
                        src={member.photoURL || (member as any).avatarUrl || (member as any).profilePhoto || (member as any).profileImage}
                        alt="Avatar"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      (member.displayName || member.name || member.email).charAt(0).toUpperCase()
                    )}
                  </div>

                  {/* Name & Role */}
                  <div className="space-y-1 mb-4 flex-1">
                    <h3 className="font-bold text-slate-900 text-sm">{member.displayName || member.name || "Agent"}</h3>
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        isMaster
                          ? "bg-rose-50 text-rose-700 border border-rose-200"
                          : isAdmin
                          ? "bg-purple-50 text-purple-700 border border-purple-200"
                          : "bg-blue-50 text-blue-700 border border-blue-200"
                      }`}
                    >
                      {isMaster ? (
                        <Crown className="w-3 h-3" />
                      ) : isAdmin ? (
                        <Shield className="w-3 h-3" />
                      ) : (
                        <Headphones className="w-3 h-3" />
                      )}
                      <span>{member.role || "Agent"}</span>
                    </span>
                  </div>

                  {/* Contact details */}
                  <div className="w-full pt-3 border-t border-slate-100 space-y-1 text-xs text-slate-500">
                    <div className="flex items-center justify-center gap-1.5 truncate px-1">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate text-[11px] text-slate-600 font-medium" title={member.email || (member as any).id || ""}>
                        {member.email || (member as any).id || "No email"}
                      </span>
                    </div>
                    {(member.birthday || (member as any).dob) && (
                      <div className="flex items-center justify-center gap-1.5 text-amber-600 font-medium text-[11px]">
                        <Cake className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                        <span>
                          {(() => {
                            const b = member.birthday || (member as any).dob;
                            try {
                              const parts = String(b).split("-");
                              if (parts.length === 3) {
                                const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                                return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                              }
                              return new Date(b).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                            } catch {
                              return b;
                            }
                          })()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ----------------------------------------------------
          TAB 2: ORGANOGRAM SITEMAP HIERARCHY
          ---------------------------------------------------- */}
      {activeTab === "organogram" && (
        <div className="bg-slate-50/50 border border-slate-200 rounded-3xl p-6 sm:p-10 space-y-10 overflow-x-auto animate-in fade-in duration-150">
          {orgTiers.map((tier, idx) => {
            const tierMembers = users.filter((u) => {
              let userTier = u.orgTier;
              if (!userTier) {
                if (u.role === "Master Admin") userTier = "tier-directors";
                else if (u.role === "Admin") userTier = "tier-admins";
                else userTier = "tier-agents";
              }
              return userTier === tier.id;
            });

            if (tierMembers.length === 0) return null;

            return (
              <div key={tier.id} className="text-center space-y-4 relative">
                {idx > 0 && (
                  <div className="w-0.5 h-6 bg-slate-300 mx-auto -mt-6 mb-4" />
                )}

                <div className="inline-block bg-white border border-slate-200 px-5 py-1.5 rounded-full text-xs font-bold text-slate-700 uppercase tracking-wider shadow-xs">
                  {tier.name}
                </div>

                <div className="flex items-center justify-center gap-4 flex-wrap">
                  {tierMembers.map((m) => (
                    <div
                      key={m.email}
                      className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex items-center gap-3 min-w-[200px] text-left hover:shadow-md transition-shadow"
                    >
                      <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold text-sm flex items-center justify-center overflow-hidden flex-shrink-0">
                        {m.photoURL ? (
                          <img src={m.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                        ) : (
                          (m.displayName || m.email).charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-900 text-xs truncate">
                          {m.displayName || "Agent"}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">{m.email}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ----------------------------------------------------
          TAB 3: PERFORMANCE ANALYTICS LEADERBOARD
          ---------------------------------------------------- */}
      {activeTab === "analytics" && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs animate-in fade-in duration-150">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                  <th className="p-4">Agent Name</th>
                  <th className="p-4 text-center">Quizzes Taken</th>
                  <th className="p-4 text-center">Average Score</th>
                  <th className="p-4 text-center">Doubts Asked</th>
                  <th className="p-4 text-center">Doubts Resolved</th>
                  <th className="p-4 text-center">Courses Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {teamAnalytics
                  .sort((a, b) => b.avgScore - a.avgScore)
                  .map((m) => {
                    const scoreColor =
                      m.avgScore >= 70 ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50";

                    return (
                      <tr key={m.email} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-4">
                          <div className="font-bold text-slate-900">{m.displayName || "Agent"}</div>
                          <div className="text-[11px] text-slate-400">{m.email}</div>
                        </td>
                        <td className="p-4 text-center font-bold text-blue-600">{m.quizCount}</td>
                        <td className="p-4 text-center">
                          <span className={`px-2.5 py-1 rounded-full font-extrabold text-[11px] ${scoreColor}`}>
                            {m.quizCount > 0 ? `${m.avgScore}%` : "N/A"}
                          </span>
                        </td>
                        <td className="p-4 text-center font-semibold text-amber-600">{m.doubtsAsked}</td>
                        <td className="p-4 text-center font-semibold text-emerald-700">
                          {m.doubtsResolved}
                        </td>
                        <td className="p-4 text-center font-semibold text-purple-700">
                          {m.coursesCompleted} Completed
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
