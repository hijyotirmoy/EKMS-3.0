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

interface EkmsNavbarProps {
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
}

export default function EkmsNavbar({ onToggleSidebar }: EkmsNavbarProps) {
  const { user, userProfile, isLoggedIn, openLoginModal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [searchTerm, setSearchTerm] = useState("");
  const [isSearchActiveMobile, setIsSearchActiveMobile] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [isNotifOpen, setIsNotifOpen] = useState(false);

  // Sync Notifications Badge (only if logged in)
  useEffect(() => {
    if (!isLoggedIn) {
      setNotificationCount(0);
      return;
    }
    const q = query(collection(db, "announcements"), where("isVisible", "==", true));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setNotificationCount(snapshot.size);
    });
    return () => unsubscribe();
  }, [isLoggedIn]);

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
          /* Normal Navbar */
          <>
            {/* Left Area: Hamburger & Logo */}
            <div className="flex items-center gap-2 md:gap-4 min-w-max">
              <button
                onClick={onToggleSidebar}
                className="p-2 text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
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
                    className="object-contain rounded-full shadow-sm group-hover:scale-105 transition-transform"
                    priority
                  />
                </div>
                <div className="flex flex-col">
                  <span className="text-lg font-bold text-slate-900 tracking-tight leading-tight">
                    ESIC KMS
                  </span>
                  <span className="text-[9px] uppercase tracking-wider font-semibold text-blue-600 hidden md:block">
                    Knowledge Management
                  </span>
                </div>
              </Link>
            </div>

            {/* Center Area: Search Bar (Desktop) */}
            <div className="hidden md:flex items-center justify-center flex-1 max-w-2xl px-6">
              <form onSubmit={handleSearchSubmit} className="relative w-full flex items-center">
                <div className="flex items-center w-full bg-slate-50 border border-slate-300 rounded-full overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white focus-within:border-transparent transition-all shadow-xs">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder="Search guidance database by keyword, tags, question, or QA code..."
                    className="flex-1 pl-5 pr-3 py-2 bg-transparent text-sm text-slate-800 outline-none"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={handleClearSearch}
                      className="p-1.5 mr-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-full transition-colors"
                      title="Clear search"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-slate-100 border-l border-slate-300 hover:bg-slate-200 text-slate-700 transition-colors flex items-center justify-center"
                    title="Search"
                  >
                    <Search className="w-4 h-4" />
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
                title="Announcements"
              >
                <Bell className="w-5 h-5" />
                {notificationCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-rose-600 text-white rounded-full text-[10px] font-bold flex items-center justify-center border-2 border-white animate-pulse">
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
          </>
        )}
      </header>

      {/* Global Notifications Modal */}
      <NotificationModal isOpen={isNotifOpen} onClose={() => setIsNotifOpen(false)} />
    </>
  );
}
