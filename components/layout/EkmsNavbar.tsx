"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Menu,
  Search,
  X,
  Bell,
  User as UserIcon,
  ArrowLeft,
} from "lucide-react";
import NotificationModal from "@/components/common/NotificationModal";
import { getLocalReadNotifications } from "@/lib/notificationService";

interface EkmsNavbarProps {
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
}

export default function EkmsNavbar({ onToggleSidebar }: EkmsNavbarProps) {
  const { user, userProfile, isLoggedIn, isAdmin, openLoginModal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [searchTerm, setSearchTerm] = useState("");
  const [isSearchActiveMobile, setIsSearchActiveMobile] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [isNotifOpen, setIsNotifOpen] = useState(false);

  const [readOverrideIds, setReadOverrideIds] = useState<Set<string>>(() => {
    return new Set(user?.email ? getLocalReadNotifications(user.email) : []);
  });

  // Sync with localStorage when user logs in or refreshes
  useEffect(() => {
    if (user?.email) {
      const localIds = getLocalReadNotifications(user.email);
      setReadOverrideIds((prev) => {
        const next = new Set(prev);
        localIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [user?.email]);

  // Listen to instant read events
  useEffect(() => {
    const handleReadUpdate = (e: any) => {
      if (e.detail?.ids) {
        setReadOverrideIds((prev) => {
          const next = new Set(prev);
          e.detail.ids.forEach((id: string) => next.add(id));
          return next;
        });
      }
    };

    window.addEventListener("ekms-notification-read-update", handleReadUpdate);
    return () => {
      window.removeEventListener("ekms-notification-read-update", handleReadUpdate);
    };
  }, []);

  // Sync Notifications Badge (only if logged in)
  useEffect(() => {
    if (!isLoggedIn || !user?.email) {
      setNotificationCount(0);
      return;
    }

    const userEmail = user.email.toLowerCase().trim();
    let rawNotifs: any[] = [];
    let rawAnn: any[] = [];

    const calculateUnread = () => {
      let unread = 0;
      const seenIds = new Set<string>();
      const combinedMap = new Map<string, any>();

      rawNotifs.forEach((n) => combinedMap.set(n.id, n));
      rawAnn.forEach((a) => {
        if (!combinedMap.has(a.id)) {
          combinedMap.set(a.id, a);
        }
      });

      const userRole = (userProfile?.role || (user ? "Agent" : "guest")).toLowerCase().trim();
      const isUserAdmin = isAdmin || userRole.includes("admin") || userRole.includes("master");

      combinedMap.forEach((data) => {
        const target = (data.targetEmail || "all").toLowerCase().trim();
        const isDirectlyForMe = target !== "all" && target === userEmail;

        const notifRole = (data.targetRole || "all").toLowerCase().trim();
        const isRoleAdmin = notifRole === "admin" || notifRole === "master_admin" || notifRole === "admins";
        const isRoleAgent = notifRole === "agent" || notifRole === "agents";

        // Role check
        if (isRoleAdmin && !isUserAdmin) return;
        if (isRoleAgent && isUserAdmin && !isDirectlyForMe) return;

        if (target === "all" || target === userEmail) {
          if (data.type === "birthday" && data.celebrantEmail?.toLowerCase().trim() === userEmail) {
            return;
          }
          seenIds.add(data.id);
          const isRead = data.readBy?.includes(userEmail) || readOverrideIds.has(data.id);
          const isClosed = data.closedBy?.includes(userEmail) || readOverrideIds.has(data.id);
          if (!isRead && !isClosed) {
            unread++;
          }
        }
      });

      setNotificationCount(unread);
    };

    const unsubNotifs = onSnapshot(
      collection(db, "notifications"),
      (snap) => {
        rawNotifs = [];
        snap.forEach((d) => rawNotifs.push({ id: d.id, ...d.data() }));
        calculateUnread();
      },
      (err) => {}
    );

    const unsubAnn = onSnapshot(
      collection(db, "announcements"),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          if (data.isNotification || (data.type && data.type !== "announcement")) {
            list.push({ id: d.id, ...data });
          } else if (data.isVisible) {
            list.push({
              id: d.id,
              title: data.title || "📢 Official Announcement",
              message: data.message,
              type: "announcement",
              targetEmail: (data.targetEmail || "all").toLowerCase().trim(),
              targetRole: data.targetRole || "all",
              readBy: data.readBy || [],
              closedBy: data.closedBy || [],
              createdAt: data.createdAt || Date.now(),
            });
          }
        });
        rawAnn = list;
        calculateUnread();
      },
      (err) => {}
    );

    return () => {
      try {
        unsubNotifs();
      } catch (e) {}
      try {
        unsubAnn();
      } catch (e) {}
    };
  }, [isLoggedIn, user, isAdmin, readOverrideIds]);

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    if (pathname === "/") {
      window.dispatchEvent(new CustomEvent("ekms-global-search", { detail: val }));
    }
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchTerm.trim()) return;

    if (pathname === "/") {
      window.dispatchEvent(new CustomEvent("ekms-global-search", { detail: searchTerm.trim() }));
    } else {
      router.push(`/?search=${encodeURIComponent(searchTerm.trim())}`);
    }
  };

  const handleClearSearch = () => {
    setSearchTerm("");
    if (pathname === "/") {
      window.dispatchEvent(new CustomEvent("ekms-global-search", { detail: "" }));
    }
  };

  const navLinks = [
    { href: "/files", label: "Files" },
    { href: "/doubts", label: "Doubts" },
    { href: "/facility", label: "Facilities" },
  ];

  return (
    <>
      <header className="fixed top-0 left-0 right-0 h-14 bg-white border-b border-slate-200 z-40 flex items-center justify-between px-3 md:px-4 shadow-sm select-none">
        {/* Mobile Search Active Mode */}
        {isSearchActiveMobile ? (
          <div className="flex items-center w-full gap-2 animate-in fade-in duration-150">
            <button
              onClick={() => setIsSearchActiveMobile(false)}
              className="p-2 text-slate-600 hover:bg-slate-100 rounded-full"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <form onSubmit={handleSearchSubmit} className="flex-1 relative flex items-center">
              <input
                type="text"
                autoFocus
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search guidance database..."
                className="w-full pl-4 pr-10 py-1.5 bg-slate-100 border border-slate-300 rounded-full text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-3 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </form>
            <button
              onClick={() => {
                handleSearchSubmit();
                setIsSearchActiveMobile(false);
              }}
              className="p-2 text-blue-600 hover:bg-blue-50 rounded-full font-medium"
            >
              <Search className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full">
            {/* Left Area: Hamburger & Brand */}
            <div className="flex items-center gap-2 md:gap-3">
              <button
                onClick={onToggleSidebar}
                className="p-2 -ml-1 text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
                title="Toggle Sidebar"
              >
                <Menu className="w-5 h-5" />
              </button>

              <Link href="/" className="flex items-center gap-2.5 group">
                <div className="relative w-8 h-8 flex-shrink-0">
                  <Image
                    src="/logo.png"
                    alt="EKMS Logo"
                    fill
                    className="object-contain rounded-full shadow-xs group-hover:scale-105 transition-transform"
                    priority
                  />
                </div>
                <div className="flex flex-col">
                  <span className="text-base font-extrabold text-slate-900 tracking-tight leading-none group-hover:text-blue-600 transition-colors">
                    ESIC KMS
                  </span>
                  <span className="text-[9px] uppercase tracking-wider font-semibold text-blue-600 hidden md:block mt-0.5">
                    Knowledge Management System
                  </span>
                </div>
              </Link>
            </div>

            {/* Middle Area: Global Search Input */}
            <div className="hidden md:flex flex-1 max-w-lg mx-4">
              <form onSubmit={handleSearchSubmit} className="w-full relative flex items-center">
                <div className="relative w-full flex items-center">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder="Search guidance database by keyword, tags, question, or QA code..."
                    className="w-full pl-5 pr-16 py-2 bg-slate-50/70 hover:bg-slate-50 border border-slate-200 rounded-full text-xs text-slate-700 placeholder:text-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-2xs"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={handleClearSearch}
                      className="absolute right-12 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-200/60 rounded-full transition-colors flex items-center justify-center"
                      title="Clear search"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="submit"
                    className="absolute right-0 top-0 bottom-0 px-3.5 flex items-center justify-center text-slate-400 hover:text-blue-600 border-l border-slate-200 hover:bg-slate-100 rounded-r-full transition-colors"
                    title="Search"
                  >
                    <Search className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
              </form>
            </div>

            {/* Right Area: Navigation links, Bell & Auth */}
            <div className="flex items-center gap-1.5 md:gap-3 min-w-max">
              {/* Mobile Search Button */}
              <button
                onClick={() => setIsSearchActiveMobile(true)}
                className="md:hidden p-2 text-slate-700 hover:bg-slate-100 rounded-full"
                title="Search"
              >
                <Search className="w-5 h-5" />
              </button>

              {/* Desktop Nav Links */}
              <nav className="hidden lg:flex items-center gap-1">
                {navLinks.map((link) => {
                  const isActive = pathname === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={(e) => {
                        if (!isLoggedIn) {
                          e.preventDefault();
                          openLoginModal();
                        }
                      }}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        isActive
                          ? "bg-blue-50 text-blue-700 font-semibold"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </nav>

              {/* Notification Bell */}
              <button
                onClick={() => setIsNotifOpen(true)}
                className="relative p-2 text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
                title="Notifications"
              >
                <Bell className="w-5 h-5 text-slate-700" />
                {notificationCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[17px] h-[17px] px-1 bg-rose-600 text-white rounded-full text-[9px] font-extrabold flex items-center justify-center border-2 border-white shadow-xs animate-pulse pointer-events-none">
                    {notificationCount > 9 ? "9+" : notificationCount}
                  </span>
                )}
              </button>

              {/* Sign In / Profile Avatar */}
              {isLoggedIn && user ? (
                <Link
                  href="/profile"
                  className="flex items-center gap-2 p-1 pl-2 pr-1.5 bg-slate-100 hover:bg-slate-200 rounded-full border border-slate-200 transition-colors"
                  title="Open Profile Settings"
                >
                  <span className="text-xs font-medium text-slate-700 hidden sm:inline max-w-[100px] truncate">
                    {userProfile?.displayName || user.email?.split("@")[0]}
                  </span>
                  <div className="w-7 h-7 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center overflow-hidden border border-white shadow-sm">
                    {userProfile?.photoURL ? (
                      <img
                        src={userProfile.photoURL}
                        alt="Avatar"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      (userProfile?.displayName || user.email || "A").charAt(0).toUpperCase()
                    )}
                  </div>
                </Link>
              ) : (
                <button
                  onClick={openLoginModal}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-600 font-semibold text-xs rounded-full transition-colors shadow-sm"
                >
                  <UserIcon className="w-4 h-4" />
                  <span>Sign In</span>
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Global Notifications Modal */}
      <NotificationModal isOpen={isNotifOpen} onClose={() => setIsNotifOpen(false)} />
    </>
  );
}
