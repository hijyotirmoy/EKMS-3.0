"use client";

import React, { useEffect, useState, useMemo } from "react";
import { CaseLogs } from "@/components/triage/CaseLogs";
import { useAuth } from "@/context/AuthContext";

export default function AdminCasesPage() {
  const { user, userProfile } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    document.title = "Case History";
  }, []);

  const currentAgent = useMemo(() => {
    const rawName =
      userProfile?.name ||
      userProfile?.displayName ||
      user?.displayName ||
      user?.email?.split("@")[0] ||
      "Admin";
    return {
      agentId: user?.email ? user.email.split("@")[0] : "admin",
      email: user?.email || userProfile?.email || "admin@ekms.in",
      displayName: userProfile?.name || user?.displayName || rawName,
      name: userProfile?.name || user?.displayName || rawName,
      role: userProfile?.role || "Admin",
      isAdmin: true,
      isMasterAdmin: Boolean(userProfile?.role?.toLowerCase().includes("master")),
    };
  }, [user, userProfile]);

  return (
    <div className="w-full max-w-full space-y-4">
      <CaseLogs
        refreshKey={refreshKey}
        onCaseDeleted={() => setRefreshKey((k) => k + 1)}
        currentAgent={currentAgent}
      />
    </div>
  );
}
