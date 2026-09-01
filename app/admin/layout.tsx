"use client";

import React, { useState } from "react";
import AdminGuard from "@/components/auth/AdminGuard";
import EkmsNavbar from "@/components/layout/EkmsNavbar";
import EkmsSidebar from "@/components/layout/EkmsSidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <AdminGuard>
      <div className="min-h-screen flex flex-col bg-slate-50 overflow-x-hidden max-w-full">
        <EkmsNavbar
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        />

        <div className="flex flex-1 pt-14 max-w-full overflow-x-hidden">
          <EkmsSidebar
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
          />

          <main
            className={`flex-1 w-full max-w-full overflow-x-hidden transition-all duration-300 min-h-[calc(100vh-56px)] flex flex-col ${
              isSidebarOpen ? "lg:pl-64" : "lg:pl-[72px]"
            }`}
          >
            <div className="flex-1 w-full max-w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden">
              {children}
            </div>
          </main>
        </div>
      </div>
    </AdminGuard>
  );
}
