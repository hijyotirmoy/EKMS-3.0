"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { doc, getDoc, setDoc, updateDoc, increment } from "firebase/firestore";
import { db, logsDb } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";

export function getTodayDateString(): string {
  // YYYY-MM-DD in local time
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function ActivityTracker() {
  const { user, userProfile, isLoggedIn } = useAuth();
  const pathname = usePathname();
  const lastActiveTimestampRef = useRef<number>(Date.now());
  const lastOnlineSyncRef = useRef<number>(0);

  // Track user interaction to determine idle state
  useEffect(() => {
    const handleActivity = () => {
      lastActiveTimestampRef.current = Date.now();
    };

    window.addEventListener("mousemove", handleActivity, { passive: true });
    window.addEventListener("mousedown", handleActivity, { passive: true });
    window.addEventListener("keydown", handleActivity, { passive: true });
    window.addEventListener("touchstart", handleActivity, { passive: true });
    window.addEventListener("scroll", handleActivity, { passive: true });

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("mousedown", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
      window.removeEventListener("scroll", handleActivity);
    };
  }, []);

  // Periodic heartbeat every 45s (batched) to record active time and throttle presence writes
  useEffect(() => {
    if (!isLoggedIn || !user?.email) return;

    const email = user.email.toLowerCase();
    const HEARTBEAT_SECONDS = 45;
    const HEARTBEAT_MS = HEARTBEAT_SECONDS * 1000;
    const USER_PRESENCE_THROTTLE_MS = 2 * 60 * 1000; // Only update user presence every 2 minutes

    const heartbeatInterval = setInterval(async () => {
      // Only count active time if tab is visible and user interacted in the last 3 minutes
      const isVisible = typeof document !== "undefined" && document.visibilityState === "visible";
      const isIdle = Date.now() - lastActiveTimestampRef.current > 3 * 60 * 1000;

      if (!isVisible || isIdle) return;

      const today = getTodayDateString();
      const docId = `${email}_${today}`;
      const activityDocRef = doc(logsDb, "daily_activity", docId);
      const userDocRef = doc(db, "users", email);
      const now = Date.now();
      const cleanPath = (pathname || "/").replace(/[/.]/g, "_");

      try {
        await updateDoc(activityDocRef, {
          totalSeconds: increment(HEARTBEAT_SECONDS),
          [`pageVisits.${cleanPath}`]: increment(HEARTBEAT_SECONDS),
          lastActive: now,
        });

        // Throttle presence write to once every 2 minutes to prevent snapshot storm for other agents
        if (now - lastOnlineSyncRef.current >= USER_PRESENCE_THROTTLE_MS) {
          lastOnlineSyncRef.current = now;
          await updateDoc(userDocRef, {
            lastActive: now,
            isOnline: true,
          }).catch(() => {});
        }
      } catch (e) {
        try {
          const userName = userProfile?.displayName || userProfile?.name || email.split("@")[0];
          await setDoc(
            activityDocRef,
            {
              email,
              name: userName,
              date: today,
              loginTime: now,
              firstLogin: now,
              lastActive: now,
              loginCount: 1,
              totalSeconds: HEARTBEAT_SECONDS,
              pageVisits: { [cleanPath]: HEARTBEAT_SECONDS },
            },
            { merge: true }
          );

          if (now - lastOnlineSyncRef.current >= USER_PRESENCE_THROTTLE_MS) {
            lastOnlineSyncRef.current = now;
            await updateDoc(userDocRef, {
              lastActive: now,
              isOnline: true,
            }).catch(() => {});
          }
        } catch {}
      }
    }, HEARTBEAT_MS);

    return () => clearInterval(heartbeatInterval);
  }, [isLoggedIn, user?.email, pathname, userProfile]);

  return null;
}
