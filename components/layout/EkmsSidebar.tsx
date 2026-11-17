"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { collection, query, where, getDocs, doc, onSnapshot } from "firebase/firestore";
import { db, bookingDb } from "@/lib/firebase";
import { getCachedData, setCachedData, clearCachedData } from "@/lib/firestoreCache";
import { getOrFetchCollection } from "@/lib/cache";
import { isDispensaryMatch } from "@/lib/appointmentTypes";
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
  CalendarClock,
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
  Sparkles,
  Lock,
  Database,
  Bell,
  UserCheck,
  Stethoscope,
  Pill,
  HeartPulse,
} from "lucide-react";
import { isPageRestricted } from "@/lib/pageAccess";

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
  const [receptionQueueCount, setReceptionQueueCount] = useState(0);
  const [doctorQueueCount, setDoctorQueueCount] = useState(0);
  const [pharmacyQueueCount, setPharmacyQueueCount] = useState(0);
  const [activeAppointmentsQueueCount, setActiveAppointmentsQueueCount] = useState(0);

  useEffect(() => {
    if (!isLoggedIn) {
      setUnresolvedDoubtsCount(0);
      setPendingReportsCount(0);
      setMissingContentCount(0);
      setCourses([]);
      setQuizzes([]);
      return;
    }

    let isMounted = true;

    const loadBadges = async (force = false) => {
      // 1. Doubts badge
      try {
        const qDoubts = query(collection(db, "doubts"), where("status", "in", ["pending", "waiting"]));
        const snap = await getDocs(qDoubts);
        if (isMounted) setUnresolvedDoubtsCount(snap.size);
      } catch (e) {}

      // 2. Active Courses for pending count
      try {
        const courseList = await getOrFetchCollection<any>("onboardings", { forceRefresh: force });
        if (isMounted) setCourses(courseList);
      } catch (e) {}

      // 3. Active Quizzes for pending count
      try {
        const quizList = await getOrFetchCollection<any>("quizzes", { forceRefresh: force });
        if (isMounted) setQuizzes(quizList);
      } catch (e) {}

      // 4. Admin Reports & Missing badges
      if (isAdmin) {
        try {
          const qReports = query(collection(db, "reports"), where("status", "==", "pending"));
          const rSnap = await getDocs(qReports);
          if (isMounted) setPendingReportsCount(rSnap.size);

          const mSnap = await getDocs(collection(db, "missing_searches"));
          if (isMounted) setMissingContentCount(mSnap.size);
        } catch (e) {}
      }
    };

    loadBadges(false);

    // Instantly sync when metadata bumps (e.g. quiz or course added/deleted)
    const unsubMeta = onSnapshot(
      doc(db, "system", "metadata"),
      () => {
        if (isMounted) {
          clearCachedData("sidebar_quizzes");
          clearCachedData("sidebar_courses");
          loadBadges(true);
        }
      },
      (err) => console.warn("Sidebar metadata sync error:", err)
    );

    const handleFocus = () => {
      if (isMounted) {
        loadBadges(false);
      }
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      isMounted = false;
      unsubMeta();
      window.removeEventListener("focus", handleFocus);
    };
  }, [isLoggedIn, isAdmin, pathname]);

  const isDispensaryUser =
    (userProfile?.role || "").toLowerCase().trim() === "dispensary staff" ||
    (userProfile?.role || "").toLowerCase().trim() === "dispensary" ||
    Boolean(userProfile?.dispensaryRole) ||
    Boolean(userProfile?.dispensaryName);

  // Live Queue Count Badges for Dispensary Desks
  useEffect(() => {
    if (!isLoggedIn || (!isDispensaryUser && !isAdmin)) {
      setReceptionQueueCount(0);
      setDoctorQueueCount(0);
      setPharmacyQueueCount(0);
      setActiveAppointmentsQueueCount(0);
      return;
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const staffDispensary = (userProfile as any)?.dispensaryName || "";

    const q = query(
      collection(bookingDb, "dispensary_appointments"),
      where("date", "==", todayStr)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        let recCount = 0;
        let docCount = 0;
        let pharmCount = 0;
        let totalActive = 0;

        snap.forEach((docSnap) => {
          const data = docSnap.data();
          if (isDispensaryUser && staffDispensary) {
            if (!isDispensaryMatch(data.dispensaryName, staffDispensary, data.dispensaryId, userProfile?.dispensaryId)) {
              return;
            }
          }

          if (data.status !== "completed" && data.status !== "cancelled") {
            totalActive++;
          }

          if (data.status === "scheduled") {
            recCount++;
          } else if (data.status === "with_doctor" || data.status === "visited") {
            docCount++;
          } else if (data.status === "pharmacy_queue") {
            pharmCount++;
          }
        });

        setReceptionQueueCount(recCount);
        setDoctorQueueCount(docCount);
        setPharmacyQueueCount(pharmCount);
        setActiveAppointmentsQueueCount(totalActive);
      },
      (err) => console.warn("Dispensary queue sync error:", err)
    );

    return () => unsub();
  }, [isLoggedIn, isDispensaryUser, isAdmin, userProfile?.dispensaryName, userProfile?.dispensaryId]);

  // Compute agent-specific pending courses
  const pendingCoursesCount = React.useMemo(() => {
    if (!isLoggedIn) return 0;
    const progressMap = userProfile?.courseProgress || {};
    return courses.filter((c) => c.active !== false && progressMap[c.id]?.status !== "completed").length;
  }, [courses, userProfile, isLoggedIn]);

  // Compute agent-specific pending quizzes
  const pendingQuizzesCount = React.useMemo(() => {
    if (!isLoggedIn) return 0;
    const completedList = Array.isArray(userProfile?.quizCompleted) ? userProfile.quizCompleted : [];
    const scoreMap = userProfile?.quizScores && typeof userProfile.quizScores === "object" ? userProfile.quizScores : {};

    return quizzes.filter((q) => {
      if (q.active === false) return false;
      const rawScore =
        scoreMap[q.id] ??
        scoreMap["Q" + q.id] ??
        scoreMap[String(q.id).replace(/\D/g, "")];

      const isScoreValid =
        rawScore !== undefined &&
        (typeof rawScore !== "number" || q.questions <= 0 || rawScore <= q.questions);

      const isDone = completedList.includes(q.id) || isScoreValid;
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
    { href: "/data", label: "Data", icon: Database, color: "text-teal-600" },
  ];

  const dispensaryLinks = [
    { href: "/appointment", label: "Appointments", icon: CalendarClock, color: "text-teal-600", badge: activeAppointmentsQueueCount },
    { href: "/admin/appointment", label: "Manage Appointments", icon: CalendarCheck, color: "text-emerald-600", adminOnly: true },
    { href: "/dispensary/reception", label: "Reception Desk", icon: UserCheck, color: "text-blue-600", badge: receptionQueueCount },
    { href: "/dispensary/doctor", label: "Doctor Desk", icon: Stethoscope, color: "text-teal-600", badge: doctorQueueCount },
    { href: "/dispensary/pharmacy", label: "Pharmacy Desk", icon: Pill, color: "text-amber-500", badge: pharmacyQueueCount },
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
    { href: "/admin/notifications", label: "Notifications", icon: Bell, color: "text-pink-500" },
    {
      href: "/admin/doubts",
      label: "Manage Doubts",
      icon: HelpCircle,
      color: "text-sky-500",
      badge: unresolvedDoubtsCount,
    },
    { href: "/admin/quiz", label: "Manage Quizzes", icon: ClipboardCheck, color: "text-purple-600" },
    { href: "/admin/onboarding", label: "Manage Onboarding", icon: GraduationCap, color: "text-blue-600" },
    { href: "/admin/bookings", label: "Manage Bookings", icon: CalendarCheck, color: "text-amber-500" },
    { href: "/admin/settings", label: "System Settings", icon: Settings, color: "text-slate-600" },
  ];

  const exploreLinks = [
    { href: "/profile", label: "Profile", icon: User, color: "text-blue-600" },
    { href: "/reports", label: "Reports", icon: Flag, color: "text-rose-600", badge: pendingReportsCount },
  ];

  const connectedSites = [
    {
      href: "https://triage.ekms.in/",
      label: "EKMS Triage",
      domain: "triage.ekms.in",
      icon: HeartPulse,
      imageSrc: "/triage-logo.png",
      color: "text-rose-600",
    },
    {
      href: "https://map.ekms.in/",
      label: "EKMS Map",
      domain: "map.ekms.in",
      icon: MapPin,
      imageSrc: "/map-logo.png",
      color: "text-emerald-600",
    },
    {
      href: "https://ai.ekms.in/",
      label: "EKMS AI",
      domain: "ai.ekms.in",
      icon: Sparkles,
      imageSrc: "/ai-logo.png",
      color: "text-purple-600",
    },
    {
      href: "https://data.ekms.in/",
      label: "EKMS Data",
      domain: "data.ekms.in",
      icon: Database,
      imageSrc: "/data-logo.png",
      color: "text-teal-600",
    },
  ];

  // Mini sidebar items
  const miniLinks = [
    { href: "/", label: "Home", icon: Home, color: "text-rose-500", isExternal: false },
    { href: "/booking", label: "Booking", icon: CalendarCheck, color: "text-amber-500", isExternal: false },
    { href: "/appointment", label: "Appt", icon: CalendarClock, color: "text-teal-600", isExternal: false, badge: activeAppointmentsQueueCount },
    { href: "/dispensary/reception", label: "Reception", icon: UserCheck, color: "text-blue-600", isExternal: false, dispensaryStaffOnly: true, badge: receptionQueueCount },
    { href: "/dispensary/doctor", label: "Doctor", icon: Stethoscope, color: "text-teal-600", isExternal: false, dispensaryStaffOnly: true, badge: doctorQueueCount },
    { href: "/dispensary/pharmacy", label: "Pharmacy", icon: Pill, color: "text-amber-500", isExternal: false, dispensaryStaffOnly: true, badge: pharmacyQueueCount },
    { href: "/data", label: "Data", icon: Database, color: "text-teal-600", isExternal: false },
    { href: "https://triage.ekms.in/", label: "Triage", icon: HeartPulse, color: "text-rose-600", isExternal: true, imageSrc: "/triage-logo.png" },
    { href: "https://map.ekms.in/", label: "EKMS Map", icon: MapPin, color: "text-emerald-600", isExternal: true },
  ];

  // Filtered links: Only allowed pages are shown. Restricted pages are totally hidden.
  // Non-logged-in users only see Home.
  const visiblePrimaryLinks = primaryLinks.filter((item) => {
    if (!isLoggedIn) return item.href === "/";
    return !isPageRestricted(item.href, userProfile);
  });

  const visibleQuickLinks = isLoggedIn
    ? quickLinks.filter((item) => !isPageRestricted(item.href, userProfile))
    : [];

  const visibleDispensaryLinks = isLoggedIn
    ? dispensaryLinks.filter((item) => {
        if ((item as any).adminOnly && !isAdmin) return false;
        return !isPageRestricted(item.href, userProfile);
      })
    : [];

  const visibleAdminLinks = isAdmin
    ? adminLinks.filter((item) => !isPageRestricted(item.href, userProfile))
    : [];

  const visibleExploreLinks = isLoggedIn
    ? exploreLinks.filter((item) => !isPageRestricted(item.href, userProfile))
    : [];

  const visibleMiniLinks = miniLinks.filter((item) => {
    if (!isLoggedIn) return item.href === "/";
    if (isDispensaryUser) {
      // 1. Remove EKMS Map completely from all dispensary staff mini menu
      if (item.label === "EKMS Map" || item.isExternal || item.href.includes("map.ekms.in")) {
        return false;
      }
      // 2. Remove Home from dispensary staff mini menu (Appointment is their default dashboard)
      if (item.href === "/") {
        return false;
      }
      // 3. For dispensary staff, only allow Appointment and their role-specific desk
      if (item.href !== "/appointment" && !item.href.startsWith("/dispensary/")) {
        return false;
      }
    }
    if ((item as any).dispensaryStaffOnly && !isDispensaryUser) return false;
    return !isPageRestricted(item.href, userProfile);
  });

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
        <aside className="hidden lg:flex fixed top-14 left-0 bottom-0 w-[72px] bg-white border-r border-slate-200 z-30 py-3 flex-col items-center gap-1.5 select-none animate-in fade-in duration-200 overflow-y-auto overflow-x-hidden">
          {visibleMiniLinks.map((item) => {
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
                  {(item as any).imageSrc ? (
                    <div className="w-5 h-5 mb-1.5 rounded-full overflow-hidden flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                      <Image
                        src={(item as any).imageSrc}
                        alt={item.label}
                        width={20}
                        height={20}
                        className="w-5 h-5 object-contain"
                      />
                    </div>
                  ) : (
                    <Icon
                      className={`w-5 h-5 mb-1.5 ${item.color} group-hover:scale-110 transition-transform`}
                    />
                  )}
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
                    ? "bg-slate-100 text-slate-900 font-bold"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
                title={item.label}
              >
                <div className="relative">
                  <Icon
                    className={`w-5 h-5 mb-1.5 ${item.color} group-hover:scale-110 transition-transform`}
                  />
                  {item.badge !== undefined && item.badge > 0 ? (
                    <span className="absolute -top-1 -right-2 bg-rose-600 text-white text-[9px] font-bold px-1.5 py-0.2 rounded-full ring-2 ring-white">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  ) : null}
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
          {visiblePrimaryLinks.length > 0 && (
            <div className="px-2 space-y-1">
              {visiblePrimaryLinks.map((item) => {
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
                    {item.badge !== undefined && item.badge > 0 ? (
                      <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Quick Options */}
          {visibleQuickLinks.length > 0 && (
            <div className="pt-3 px-2 space-y-1">
              <div className="px-3 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Quick Options
              </div>
              {visibleQuickLinks.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;

                if ((item as any).isExternal) {
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(item as any).isTriage ? handleOpenTriage : undefined}
                      className="flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-all group"
                      title={item.label}
                    >
                      <div className="flex items-center gap-3.5">
                        <Icon
                          className={`w-5 h-5 ${item.color} group-hover:scale-110 transition-transform`}
                        />
                        <span>{item.label}</span>
                      </div>
                      {(item as any).badgeText && (
                        <span className="bg-rose-50 text-rose-700 border border-rose-200/80 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          {(item as any).badgeText}
                          <ExternalLink className="w-2.5 h-2.5 text-rose-500" />
                        </span>
                      )}
                    </a>
                  );
                }

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
                    {item.badge !== undefined && item.badge > 0 ? (
                      <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Dispensary Suite */}
          {visibleDispensaryLinks.length > 0 && (
            <div className="pt-3 px-2 space-y-1">
              <div className="px-3 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Dispensary</span>
                {userProfile?.role === "Dispensary Staff" && (
                  <span className="text-[10px] bg-teal-50 text-teal-700 font-bold px-1.5 py-0.2 rounded border border-teal-200">
                    OPD
                  </span>
                )}
              </div>
              {visibleDispensaryLinks.map((item) => {
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
                    {item.badge !== undefined && item.badge > 0 ? (
                      <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Admin Controls Suite (Role Protected) */}
          {isAdmin && visibleAdminLinks.length > 0 && (
            <div className="pt-3 px-2 space-y-1">
              <div className="px-3 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Admin Controls</span>
                <span className="text-[10px] bg-indigo-50 text-indigo-700 font-bold px-1.5 py-0.2 rounded border border-indigo-200">
                  {isMasterAdmin ? "MASTER" : "ADMIN"}
                </span>
              </div>
              {visibleAdminLinks.map((item) => {
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
                    {item.badge !== undefined && item.badge > 0 ? (
                      <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Explore & Account Settings */}
          {visibleExploreLinks.length > 0 && (
            <div className="pt-3 px-2 space-y-1">
              <div className="px-3 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Explore & Feedback
              </div>
              {visibleExploreLinks.map((item) => {
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
                    {item.badge !== undefined && item.badge > 0 ? (
                      <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Connected Sites Section */}
          {!isDispensaryUser && (
            <div className="pt-3 px-2 space-y-1">
              <div className="px-3 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Connected Sites</span>
                <span className="text-[9px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded">
                  ECOSYSTEM
                </span>
              </div>
              {connectedSites.map((site) => {
                const Icon = site.icon;
                return (
                  <a
                    key={site.href}
                    href={site.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between px-3.5 py-2 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-all group"
                    title={`Open ${site.label} (${site.domain})`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      {site.imageSrc ? (
                        <div className="w-5 h-5 rounded overflow-hidden flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                          <Image
                            src={site.imageSrc}
                            alt={site.label}
                            width={20}
                            height={20}
                            className="w-5 h-5 object-contain"
                          />
                        </div>
                      ) : (
                        <Icon
                          className={`w-5 h-5 ${site.color} group-hover:scale-110 transition-transform shrink-0`}
                        />
                      )}
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-slate-800 group-hover:text-blue-600 transition-colors truncate">
                          {site.label}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono truncate">
                          {site.domain}
                        </span>
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 shrink-0 ml-2" />
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 text-[11px] text-slate-500 leading-relaxed">
          <div>© 2026 EKMS</div>
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
