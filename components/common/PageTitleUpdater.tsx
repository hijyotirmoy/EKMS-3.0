"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export const PAGE_TITLES: Record<string, string> = {
  "/": "Home",
  "/booking": "Booking",
  "/appointment": "Appointment",
  "/files": "Files",
  "/doubts": "Doubts",
  "/facility": "Facilities",
  "/facilities": "Facilities",
  "/onboarding": "Onboarding",
  "/quiz": "Quizzes",
  "/quizzes": "Quizzes",
  "/data": "Data",
  "/team": "Team",
  "/profile": "Profile",
  "/reports": "Reports",
  "/admin": "Overview",
  "/admin/overview": "Overview",
  "/admin/bookings": "Manage Bookings",
  "/admin/booking": "Manage Bookings",
  "/admin/files": "Manage Files",
  "/admin/doubts": "Manage Doubts",
  "/admin/facilities": "Manage Facilities",
  "/admin/facility": "Manage Facilities",
  "/admin/appointment": "Manage Appointment",
  "/admin/dispensary": "Manage Appointment",
  "/admin/qa": "Manage Q&A",
  "/admin/quiz": "Manage Quizzes",
  "/admin/onboarding": "Manage Onboarding",
  "/admin/announcements": "Announcements",
  "/admin/missing-content": "Missing Content",
  "/admin/notifications": "Notifications",
  "/admin/settings": "System Settings",
  "/admin/teams": "Manage Teams",
};

export function resolvePageTitle(pathname: string | null): string {
  if (!pathname) return "Home";
  const normalized = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;

  if (PAGE_TITLES[normalized]) {
    return PAGE_TITLES[normalized];
  }

  if (normalized.startsWith("/admin/reports")) {
    return "Reports";
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    return last
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return "Home";
}

export default function PageTitleUpdater() {
  const pathname = usePathname();

  useEffect(() => {
    const title = resolvePageTitle(pathname);
    if (title && typeof document !== "undefined") {
      document.title = title;
    }
  }, [pathname]);

  return null;
}
