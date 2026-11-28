"use client";

import { useState, useEffect } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { CANONICAL_AGENT_MAP } from "@/lib/utils";

// In-memory global singleton for staff directory map across all pages & desk tabs
let globalStaffMap: Record<string, string> = {
  ...CANONICAL_AGENT_MAP,
  "jyoc90@gmail.com": "Jyotirmoy Choudhury",
  "jyoc90": "Jyotirmoy Choudhury",
};
let lastStaffFetch = 0;
const STAFF_TTL = 10 * 60 * 1000; // 10 minutes in-memory / session TTL

function getStoredStaffMap(): Record<string, string> {
  if (typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem("ekms_staff_directory_map");
      const ts = Number(sessionStorage.getItem("ekms_staff_directory_ts") || 0);
      if (raw && Date.now() - ts < STAFF_TTL) {
        const parsed = JSON.parse(raw);
        globalStaffMap = { ...globalStaffMap, ...parsed };
        lastStaffFetch = ts;
        return globalStaffMap;
      }
    } catch {}
  }
  return globalStaffMap;
}

export function invalidateStaffDirectory() {
  lastStaffFetch = 0;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem("ekms_staff_directory_map");
      sessionStorage.removeItem("ekms_staff_directory_ts");
      window.dispatchEvent(new CustomEvent("ekms-staff-directory-refresh"));
    } catch {}
  }
}

export function useStaffDirectory() {
  const { userProfile, user } = useAuth();
  const [staffMap, setStaffMap] = useState<Record<string, string>>(() => getStoredStaffMap());

  useEffect(() => {
    let isMounted = true;

    const fetchDirectory = async (force = false) => {
      const now = Date.now();
      if (!force && lastStaffFetch > 0 && now - lastStaffFetch < STAFF_TTL && Object.keys(globalStaffMap).length > 2) {
        if (isMounted) setStaffMap({ ...globalStaffMap });
        return;
      }

      try {
        const snap = await getDocs(collection(db, "users"));
        if (!isMounted) return;

        const map: Record<string, string> = {
          ...CANONICAL_AGENT_MAP,
          "jyoc90@gmail.com": "Jyotirmoy Choudhury",
          "jyoc90": "Jyotirmoy Choudhury",
        };
        snap.forEach((d) => {
          const data = d.data();
          let realName = (
            data.displayName ||
            data.name ||
            data.fullName ||
            data.agentName ||
            ""
          ).trim();
          const email = (data.email || d.id || "").toLowerCase().trim();
          if (realName) {
            if (realName.includes("@")) realName = realName.split("@")[0].trim();
            if (realName.includes(".") || realName.includes("_")) {
              realName = realName.split(/[._]+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
            }
            if (email) map[email] = CANONICAL_AGENT_MAP[email] || realName;
            map[d.id.toLowerCase().trim()] = CANONICAL_AGENT_MAP[d.id.toLowerCase().trim()] || realName;
            map[realName.toLowerCase()] = realName;
            const prefix = email.split("@")[0];
            if (prefix && !map[prefix]) {
              map[prefix] = CANONICAL_AGENT_MAP[prefix] || realName;
            }
          }
        });

        // Strict guarantees
        map["jyoc90@gmail.com"] = "Jyotirmoy Choudhury";
        map["jyoc90"] = "Jyotirmoy Choudhury";

        globalStaffMap = map;
        lastStaffFetch = Date.now();

        if (typeof window !== "undefined") {
          try {
            sessionStorage.setItem("ekms_staff_directory_map", JSON.stringify(map));
            sessionStorage.setItem("ekms_staff_directory_ts", String(lastStaffFetch));
          } catch {}
        }

        if (isMounted) setStaffMap(map);
      } catch (err: any) {
        console.warn("Staff directory fetch note:", err?.message);
      }
    };

    fetchDirectory(false);

    const handleRefresh = () => fetchDirectory(true);
    window.addEventListener("ekms-staff-directory-refresh", handleRefresh);

    return () => {
      isMounted = false;
      window.removeEventListener("ekms-staff-directory-refresh", handleRefresh);
    };
  }, []);

  const getStaffName = (identifier?: string): string => {
    if (!identifier) return "";
    const clean = identifier.trim();
    const lower = clean.toLowerCase();

    // Specific mapping for jyoc90
    if (lower === "jyoc90@gmail.com" || lower === "jyoc90") {
      return "Jyotirmoy";
    }

    // Check staffMap by full lower identifier
    if (staffMap[lower] && staffMap[lower].toLowerCase() !== lower && !staffMap[lower].includes("@")) {
      return staffMap[lower];
    }

    // Check staffMap by email prefix if identifier is an email
    if (lower.includes("@")) {
      const emailPrefix = lower.split("@")[0];
      if (staffMap[emailPrefix] && !staffMap[emailPrefix].includes("@")) {
        return staffMap[emailPrefix];
      }
    }

    // Check current logged in user if matches
    if (
      userProfile &&
      (userProfile.displayName || userProfile.name) &&
      (lower === user?.email?.toLowerCase() ||
        lower === userProfile.email?.toLowerCase() ||
        lower === (userProfile.id || "").toLowerCase())
    ) {
      return (userProfile.displayName || userProfile.name || "").trim();
    }

    // If identifier is not an email
    if (!clean.includes("@")) {
      if (lower === "jyoc90") return "Jyotirmoy";
      return clean;
    }

    // If still an email, format fallback nicely
    const fallbackPrefix = clean.split("@")[0];
    return staffMap[fallbackPrefix] || (fallbackPrefix.charAt(0).toUpperCase() + fallbackPrefix.slice(1));
  };

  const getDoctorName = (identifier?: string): string => {
    if (!identifier) return "Doctor";
    return getStaffName(identifier);
  };

  return { staffMap, getStaffName, getDoctorName };
}
