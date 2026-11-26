"use client";

import React, { useEffect, useState, useMemo } from "react";
import { TriageConsole } from "@/components/triage/TriageConsole";
import { useAuth } from "@/context/AuthContext";
import { syncFacilityAvailability } from "@/lib/facilityAvailability";

export default function NativeTriagePage() {
  const { user, userProfile, openLoginModal } = useAuth();
  const [meta, setMeta] = useState<any>({ totalCases: 0, pendingReview: 0 });

  useEffect(() => {
    document.title = "Triage";
    try {
      syncFacilityAvailability();
    } catch (e) {}
    return () => {
      try {
        sessionStorage.removeItem("ekms_active_triage_session");
        sessionStorage.removeItem("ekms_active_ai_chat_session");
        sessionStorage.removeItem("ekms_main_ai_chat_session");
        localStorage.removeItem("ekms_main_ai_chat_session");
      } catch (e) {}
    };
  }, []);

  const currentAgent = useMemo(() => {
    const rawName =
      userProfile?.name ||
      userProfile?.displayName ||
      user?.displayName ||
      user?.email?.split("@")[0] ||
      "Agent";
    return {
      email: user?.email || userProfile?.email || "agent@ekms.in",
      displayName: userProfile?.name || user?.displayName || rawName,
      role: userProfile?.role || "Agent",
      isAdmin: Boolean(
        userProfile?.role?.toLowerCase().includes("admin") ||
        userProfile?.role?.toLowerCase().includes("master")
      ),
      isMasterAdmin: Boolean(userProfile?.role?.toLowerCase().includes("master")),
    };
  }, [user, userProfile]);

  return (
    <div className="animate-in fade-in duration-200 w-full max-w-full pt-1">
      {/* Main Native Triage Console */}
      <TriageConsole
        meta={meta}
        onCaseCreated={() => {}}
        currentAgent={currentAgent}
        onOpenLogin={openLoginModal}
      />
    </div>
  );
}
