"use client";

import React, { useState, useEffect, useMemo } from "react";
import { doc, getDoc, collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getOrFetchCollection } from "@/lib/cache";
import { UserProfile, Quiz, Doubt, Course, OrganogramConfig } from "@/lib/types";
import OrganogramCanvas from "@/components/team/OrganogramCanvas";
import {
  Users,
  Mail,
  Cake,
  Flame,
  Crown,
  Shield,
  Headphones,
  Building2,
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
  const [activeTab, setActiveTab] = useState<"directory" | "organogram">("directory");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [doubts, setDoubts] = useState<Doubt[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [orgConfig, setOrgConfig] = useState<OrganogramConfig>({
    branches: [],
    tiers: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Real-time live listener on users
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      const uList: UserProfile[] = [];
      snap.forEach((d) => {
        const data = d.data();
        const email = (data.email || d.id || "").toLowerCase().trim();
        uList.push({
          ...(data as Omit<UserProfile, "email">),
          email: email,
          id: d.id,
          displayName: data.displayName || data.name || email.split("@")[0],
        });
      });
      if (isMounted) {
        setUsers(uList);
        setLoading(false);
      }
    });

    // Real-time live listener on organogram config
    const unsubOrg = onSnapshot(doc(db, "settings", "organogram"), (snap) => {
      if (snap.exists() && isMounted) {
        const data = snap.data() as OrganogramConfig;
        setOrgConfig(data);
      }
    });

    const loadTeamData = async () => {
      try {
        const [qList, dList, cList] = await Promise.all([
          getOrFetchCollection<Quiz>("quizzes"),
          getOrFetchCollection<Doubt>("doubts"),
          getOrFetchCollection<Course>("onboardings", { metaKey: "onboarding" }),
        ]);

        if (isMounted) {
          setQuizzes(qList);
          setDoubts(dList);
          setCourses(cList);
        }
      } catch (err) {
        console.error("Team data load error:", err);
      }
    };

    loadTeamData();

    return () => {
      isMounted = false;
      unsubUsers();
      unsubOrg();
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
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 select-none overflow-x-auto scrollbar-none">
        <button
          onClick={() => setActiveTab("directory")}
          className={`flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
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
          className={`flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
            activeTab === "organogram"
              ? "bg-blue-600 text-white shadow-xs"
              : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Network className="w-4 h-4" />
          <span>Organogram Hierarchy</span>
        </button>
      </div>

      {/* ----------------------------------------------------
          TAB 1: DIRECTORY CARDS (2-COL ON MOBILE)
          ---------------------------------------------------- */}
      {activeTab === "directory" && (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4 animate-in fade-in duration-150">
          {loading ? (
            <div className="col-span-full text-center py-16 text-slate-400">
              Loading team directory...
            </div>
          ) : (
            users.map((member) => {
              const streak = member.streak || 0;
              const isMaster = member.role === "Master Admin";
              const isAdmin = member.role === "Admin";
              const isDispensary = member.role === "Dispensary Staff" || member.role === "Dispensary";

              return (
                <div
                  key={member.email}
                  className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-5 shadow-xs hover:shadow-md transition-all text-center flex flex-col items-center justify-between relative group"
                >
                  {/* Streak & ID badges */}
                  <div className="flex items-center justify-between w-full mb-2 sm:mb-3 text-[10px] sm:text-xs">
                    {streak > 0 ? (
                      <span className="flex items-center gap-1 font-bold text-rose-600 bg-rose-50 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] border border-rose-100">
                        <Flame className="w-2.5 h-2.5 sm:w-3 sm:h-3 fill-rose-500 text-rose-500" />
                        <span>{streak}d</span>
                      </span>
                    ) : (
                      <span />
                    )}

                    <span className="text-[9px] sm:text-[10px] font-bold text-slate-400">
                      {member.agentId || "#---"}
                    </span>
                  </div>

                  {/* Avatar */}
                  <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-blue-600 text-white font-extrabold text-lg sm:text-2xl flex items-center justify-center overflow-hidden shadow-md mb-2 sm:mb-3 border-2 border-white">
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
                  <div className="space-y-1 mb-2 sm:mb-4 flex-1 w-full px-1">
                    <h3 className="font-bold text-slate-900 text-xs sm:text-sm truncate">
                      {member.displayName || member.name || "Agent"}
                    </h3>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-wider ${
                        isMaster
                          ? "bg-rose-50 text-rose-700 border border-rose-200"
                          : isAdmin
                          ? "bg-purple-50 text-purple-700 border border-purple-200"
                          : isDispensary
                          ? "bg-teal-50 text-teal-700 border border-teal-200"
                          : "bg-blue-50 text-blue-700 border border-blue-200"
                      }`}
                    >
                      {isMaster ? (
                        <Crown className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                      ) : isAdmin ? (
                        <Shield className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                      ) : isDispensary ? (
                        <Building2 className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                      ) : (
                        <Headphones className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                      )}
                      <span className="truncate">{member.role || "Agent"}</span>
                    </span>
                  </div>

                  {/* Contact details */}
                  <div className="w-full pt-2 sm:pt-3 border-t border-slate-100 space-y-1 text-slate-500">
                    <div className="flex items-center justify-center gap-1 truncate px-1">
                      <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="truncate text-[10px] sm:text-[11px] text-slate-600 font-medium" title={member.email || (member as any).id || ""}>
                        {member.email || (member as any).id || "No email"}
                      </span>
                    </div>
                    {(member.birthday || (member as any).dob) && (
                      <div className="flex items-center justify-center gap-1 text-amber-600 font-medium text-[10px] sm:text-[11px]">
                        <Cake className="w-3 h-3 shrink-0 text-amber-500" />
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
          TAB 2: ORGANOGRAM HIERARCHY TREE CANVAS
          ---------------------------------------------------- */}
      {activeTab === "organogram" && (
        <div className="animate-in fade-in duration-150">
          <OrganogramCanvas config={orgConfig} users={users} isAdminMode={false} />
        </div>
      )}
    </div>
  );
}
