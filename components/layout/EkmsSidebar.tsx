"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Home,
  Folder,
  HelpCircle,
  Building2,
  Megaphone,
  GraduationCap,
  Gamepad2,
  Users,
  CalendarCheck,
  MapPin,
  PieChart,
  Edit,
  FileSpreadsheet,
  Users2,
  ClipboardCheck,
  Settings,
  User,
  Flag,
  ExternalLink,
} from "lucide-react";

interface EkmsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function EkmsSidebar({ isOpen, onClose }: EkmsSidebarProps) {
  const pathname = usePathname();
  const { userProfile, isAdmin, isMasterAdmin, isLoggedIn, openLoginModal } = useAuth();

  const handleNavClick = (e: React.MouseEvent, href: string) => {
    if (!isLoggedIn && href !== "/") {
      e.preventDefault();
      openLoginModal();
      return;
    }
    onClose();
  };

  const handleMiniNavClick = (e: React.MouseEvent, href: string) => {
    if (!isLoggedIn && href !== "/") {
      e.preventDefault();
      openLoginModal();
      return;
    }
  };

  // Badges
  const [unresolvedDoubtsCount, setUnresolvedDoubtsCount] = useState(0);
  const [pendingReportsCount, setPendingReportsCount] = useState(0);
  const [missingContentCount, setMissingContentCount] = useState(0);
  const [courses, setCourses] = useState<any[]>([]);
  const [quizzes, setQuizzes] = useState<any[]>([]);

  useEffect(() => {
    if (!isLoggedIn) {
      setUnresolvedDoubtsCount(0);
      setPendingReportsCount(0);
      setMissingContentCount(0);
      setCourses([]);
      setQuizzes([]);
      return;
    }

    // 1. Doubts badge (only fetch unresolved to save reads)
    const qDoubts = query(collection(db, "doubts"), where("status", "in", ["pending", "waiting"]));
    const unsubscribeDoubts = onSnapshot(qDoubts, (snap) => {
      setUnresolvedDoubtsCount(snap.size);
    });

    // 2. Active Courses listener for agent pending courses count
    const unsubCourses = onSnapshot(collection(db, "onboardings"), (snap) => {
      const list: any[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      setCourses(list);
    });

    // 3. Active Quizzes listener for agent pending quizzes count
    const unsubQuizzes = onSnapshot(collection(db, "quizzes"), (snap) => {
      const list: any[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      setQuizzes(list);
    });

    // 4. Reports & Missing badges only if Admin
    let unsubscribeReports = () => {};
    let unsubscribeMissing = () => {};

    if (isAdmin) {
      const qReports = query(collection(db, "reports"), where("status", "==", "pending"));
      unsubscribeReports = onSnapshot(qReports, (snap) => {
        setPendingReportsCount(snap.size);
      });

      unsubscribeMissing = onSnapshot(collection(db, "missing_searches"), (snap) => {
        setMissingContentCount(snap.size);
      });
    }

    return () => {
      unsubscribeDoubts();
      unsubCourses();
      unsubQuizzes();
      unsubscribeReports();
      unsubscribeMissing();
    };
  }, [isLoggedIn, isAdmin]);

  // Compute agent-specific pending courses
  const pendingCoursesCount = React.useMemo(() => {
    if (!isLoggedIn) return 0;
    const progressMap = userProfile?.courseProgress || {};
    return courses.filter((c) => c.active !== false && progressMap[c.id]?.status !== "completed").length;
  }, [courses, userProfile, isLoggedIn]);

  // Compute agent-specific pending quizzes
  const pendingQuizzesCount = React.useMemo(() => {
    if (!isLoggedIn) return 0;
    const completedList = userProfile?.quizCompleted || [];
    const scoreMap = userProfile?.quizScores || {};
    return quizzes.filter((q) => {
      if (!q.active) return false;
      const isDone =
        completedList.includes(q.id) ||
        scoreMap[q.id] !== undefined ||
        scoreMap["Q" + q.id] !== undefined ||
        scoreMap[q.id.replace(/\D/g, "")] !== undefined;
      return !isDone;
    }).length;
  }, [quizzes, userProfile, isLoggedIn]);

  const totalAdminActionCount = pendingReportsCount + missingContentCount + unresolvedDoubtsCount;

  // Navigation definition
  const primaryLinks = [
    { href: "/", label: "Home", icon: Home, color: "text-rose-500" },
    { href: "/files", label: "Files", icon: Folder, color: "text-amber-500" },
    {
      href: "/doubts",
      label: "Doubts",
      icon: HelpCircle,
      color: "text-sky-500",
      badge: unresolvedDoubtsCount,
    },
    { href: "/facility", label: "Facilities", icon: Building2, color: "text-emerald-600" },
  ];

  const quickLinks = [
    {
      href: "/onboarding",
      label: "Onboarding",
      icon: GraduationCap,
      color: "text-blue-600",
      badge: pendingCoursesCount,
    },
    {
      href: "/quiz",
      label: "Quizzes",
      icon: Gamepad2,
      color: "text-purple-600",
      badge: pendingQuizzesCount,
    },
    { href: "/team", label: "Team", icon: Users, color: "text-blue-600" },
    { href: "/booking", label: "Booking", icon: CalendarCheck, color: "text-amber-500" },
  ];

  const adminLinks = [
    {
      href: "/admin/overview",
      label: "Overview",
      icon: PieChart,
      color: "text-teal-500",
      badge: totalAdminActionCount,
    },
    { href: "/admin/qa", label: "Manage Q&A", icon: Edit, color: "text-cyan-500" },
    { href: "/admin/files", label: "Manage Files", icon: Folder, color: "text-rose-600" },
    { href: "/admin/facilities", label: "Manage Facilities", icon: Building2, color: "text-emerald-600" },
    {
      href: "/admin/missing-content",
      label: "Missing Content",
      icon: FileSpreadsheet,
      color: "text-amber-600",
      badge: missingContentCount,
    },
    { href: "/admin/teams", label: "Manage Teams", icon: Users2, color: "text-indigo-600" },
    { href: "/admin/announcements", label: "Announcements", icon: Megaphone, color: "text-pink-500" },
    { href: "/admin/doubts", label: "Manage Doubts", icon: HelpCircle, color: "text-sky-500" },
    { href: "/admin/quiz", label: "Manage Quizzes", icon: ClipboardCheck, color: "text-purple-600" },
    { href: "/admin/onboarding", label: "Manage Onboarding", icon: GraduationCap, color: "text-blue-600" },
    { href: "/admin/bookings", label: "Manage Bookings", icon: CalendarCheck, color: "text-amber-500" },
    { href: "/admin/settings", label: "System Settings", icon: Settings, color: "text-slate-600" },
  ];

  const exploreLinks = [
    { href: "/profile", label: "Profile", icon: User, color: "text-blue-600" },
    { href: "/reports", label: "Reports", icon: Flag, color: "text-rose-600", badge: pendingReportsCount },
  ];

  // Mini sidebar items
  const miniLinks = [
    { href: "/", label: "Home", icon: Home, color: "text-rose-500", isExternal: false },
    { href: "/onboarding", label: "Onboarding", icon: GraduationCap, color: "text-blue-600", isExternal: false, badge: pendingCoursesCount },
    { href: "/quiz", label: "Quizzes", icon: Gamepad2, color: "text-purple-600", isExternal: false, badge: pendingQuizzesCount },
    { href: "/booking", label: "Booking", icon: CalendarCheck, color: "text-amber-500", isExternal: false },
    { href: "https://facility.ekms.in/", label: "Facility Map", icon: MapPin, color: "text-emerald-600", isExternal: true },
  ];

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 top-14 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
        />
      )}

      {/* ----------------------------------------------------
          1. MINI COLLAPSED SIDEBAR (DESKTOP ONLY WHEN COLLAPSED)
          ---------------------------------------------------- */}
      {!isOpen && (
        <aside className="hidden lg:flex fixed top-14 left-0 bottom-0 w-[72px] bg-white border-r border-slate-200 z-30 py-3 flex-col items-center gap-1.5 select-none animate-in fade-in duration-200">
          {miniLinks.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            if (item.isExternal) {
              return (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center justify-center w-16 py-3 px-1 rounded-xl text-center text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all group"
                  title={item.label}
                >
                  <Icon
                    className={`w-5 h-5 mb-1.5 ${item.color} group-hover:scale-110 transition-transform`}
                  />
                  <span className="text-[10px] font-semibold leading-tight truncate w-full">
                    {item.label}
                  </span>
                </a>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={true}
                onClick={(e) => handleMiniNavClick(e, item.href)}
                className={`flex flex-col items-center justify-center w-16 py-3 px-1 rounded-xl text-center transition-all group relative ${
                  isActive
                    ? "bg-slate-100 text-slate-900 font-bold shadow-xs"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
                title={item.label}
              >
                <div className="relative">
                  <Icon
                    className={`w-5 h-5 mb-1.5 ${item.color} group-hover:scale-110 transition-transform`}
                  />
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="absolute -top-1 -right-2 bg-rose-600 text-white text-[9px] font-bold px-1.5 py-0.2 rounded-full ring-2 ring-white">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-semibold leading-tight truncate w-full">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </aside>
      )}

      {/* ----------------------------------------------------
          2. FULL DRAWER SIDEBAR (EXPANDED OR MOBILE OVERLAY)
          ---------------------------------------------------- */}
      <aside
        className={`fixed top-14 left-0 bottom-0 w-64 bg-white border-r border-slate-200 z-40 overflow-y-auto transition-transform duration-300 ease-in-out flex flex-col justify-between select-none ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="py-3 divide-y divide-slate-100">
          {/* Primary Core Links */}
          <div className="px-2 space-y-1">
            {primaryLinks.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  onClick={(e) => handleNavClick(e, item.href)}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                    isActive
                      ? "bg-slate-100 text-slate-900 font-semibold shadow-xs"
                      : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <Icon
                      className={`w-5 h-5 ${item.color} group-hover:scale-110 transition-transform`}
                    />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Quick Options */}
          <div className="pt-3 px-2 space-y-1">
            <div className="px-3 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Quick Options
            </div>
            {quickLinks.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  onClick={(e) => handleNavClick(e, item.href)}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                    isActive
                      ? "bg-slate-100 text-slate-900 font-semibold shadow-xs"
                      : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <Icon
                      className={`w-5 h-5 ${item.color} group-hover:scale-110 transition-transform`}
                    />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </Link>
              );
            })}

            {/* External Assam Facility Link */}
            <a
              href="https://facility.ekms.in/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3.5 py-2 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-all group"
            >
              <div className="flex items-center gap-3.5">
                <MapPin className="w-5 h-5 text-emerald-700 group-hover:scale-110 transition-transform" />
                <span>Facility Map</span>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </a>
          </div>

          {/* Admin Controls Suite (Role Protected) */}
          {isAdmin && (
            <div className="pt-3 px-2 space-y-1">
              <div className="px-3 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Admin Controls</span>
                <span className="text-[10px] bg-indigo-50 text-indigo-700 font-bold px-1.5 py-0.2 rounded border border-indigo-200">
                  {isMasterAdmin ? "MASTER" : "ADMIN"}
                </span>
              </div>
              {adminLinks.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={true}
                    onClick={(e) => handleNavClick(e, item.href)}
                    className={`flex items-center justify-between px-3.5 py-2 rounded-xl text-sm font-medium transition-all group ${
                      isActive
                        ? "bg-slate-100 text-slate-900 font-semibold"
                        : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-3.5">
                      <Icon
                        className={`w-5 h-5 ${item.color} group-hover:scale-110 transition-transform`}
                      />
                      <span className="truncate">{item.label}</span>
                    </div>
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Explore & Account Settings */}
          <div className="pt-3 px-2 space-y-1">
            <div className="px-3 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Explore & Feedback
            </div>
            {exploreLinks.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  onClick={(e) => handleNavClick(e, item.href)}
                  className={`flex items-center justify-between px-3.5 py-2 rounded-xl text-sm font-medium transition-all group ${
                    isActive
                      ? "bg-slate-100 text-slate-900 font-semibold"
                      : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <Icon
                      className={`w-5 h-5 ${item.color} group-hover:scale-110 transition-transform`}
                    />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 text-[11px] text-slate-500 leading-relaxed">
          <div>© 2026 ESIC KMS</div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Designed & Developed by{" "}
            <a
              href="https://jyotirmoychoudhury.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline font-medium"
            >
              Jyotirmoy Choudhury
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}
