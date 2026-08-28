"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { doc, getDoc, setDoc, updateDoc, increment, arrayUnion } from "firebase/firestore";
import { db } from "@/lib/firebase";
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
  const initializedTodayRef = useRef<string | null>(null);

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

  // Record initial login & session startup
  useEffect(() => {
    if (!isLoggedIn || !user?.email) return;

    const email = user.email.toLowerCase();
    const today = getTodayDateString();
    const docId = `${email}_${today}`;
    const activityDocRef = doc(db, "daily_activity", docId);
    const userDocRef = doc(db, "users", email);

    const initSession = async () => {
      try {
        const now = Date.now();
        const snap = await getDoc(activityDocRef);
        const userName = userProfile?.displayName || userProfile?.name || user.displayName || email.split("@")[0];

        if (!snap.exists()) {
          await setDoc(activityDocRef, {
            email,
            name: userName,
            date: today,
            loginTime: now,
            firstLogin: now,
            lastActive: now,
            loginCount: 1,
            totalSeconds: 0,
            pageVisits: { [(pathname || "/").replace(/[/.]/g, "_")]: 0 },
            timelineEvents: [
              {
                time: now,
                desc: "Logged in to EKMS Portal (Session #1)",
                type: "auth",
                icon: "LogIn",
                color: "emerald",
              },
            ],
          });
        } else {
          const actData = snap.data();
          const isReturningAfterLogout = !!actData.logoutTime && actData.logoutTime >= (actData.loginTime || 0);

          if (initializedTodayRef.current !== today || isReturningAfterLogout) {
            const nextSessionNum = (actData.loginCount || 1) + (isReturningAfterLogout ? 1 : 0);
            await updateDoc(activityDocRef, {
              name: userName,
              lastActive: now,
              loginTime: now,
              ...(isReturningAfterLogout ? { loginCount: increment(1) } : {}),
              timelineEvents: arrayUnion({
                time: now,
                desc: `Logged in to EKMS Portal (Session #${nextSessionNum})`,
                type: "auth",
                icon: "LogIn",
                color: "blue",
              }),
            });
          }
        }

        // Also update users collection
        await setDoc(
          userDocRef,
          {
            lastLogin: now,
            lastActive: now,
            isOnline: true,
          },
          { merge: true }
        );

        initializedTodayRef.current = today;
      } catch (err) {
        console.error("ActivityTracker init error:", err);
      }
    };

    initSession();
  }, [isLoggedIn, user?.email, userProfile?.displayName, userProfile?.name]);

  // Periodic heartbeat every 15s to accumulate active time spent
  useEffect(() => {
    if (!isLoggedIn || !user?.email) return;

    const email = user.email.toLowerCase();
    const heartbeatInterval = setInterval(async () => {
      // Only count active time if tab is visible and user interacted in the last 3 minutes
      const isVisible = typeof document !== "undefined" && document.visibilityState === "visible";
      const isIdle = Date.now() - lastActiveTimestampRef.current > 3 * 60 * 1000;

      if (!isVisible || isIdle) return;

      const today = getTodayDateString();
      const docId = `${email}_${today}`;
      const activityDocRef = doc(db, "daily_activity", docId);
      const userDocRef = doc(db, "users", email);
      const now = Date.now();
      const cleanPath = (pathname || "/").replace(/[/.]/g, "_");

      try {
        await updateDoc(activityDocRef, {
          totalSeconds: increment(15),
          [`pageVisits.${cleanPath}`]: increment(15),
          lastActive: now,
        });

        await updateDoc(userDocRef, {
          lastActive: now,
          isOnline: true,
        });
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
              totalSeconds: 15,
              pageVisits: { [cleanPath]: 15 },
            },
            { merge: true }
          );
        } catch {}
      }
    }, 15000);

    return () => clearInterval(heartbeatInterval);
  }, [isLoggedIn, user?.email, pathname]);

  // Record logout / tab close
  useEffect(() => {
    if (!isLoggedIn || !user?.email) return;

    const email = user.email.toLowerCase();

    const handleBeforeUnload = () => {
      const today = getTodayDateString();
      const docId = `${email}_${today}`;
      const now = Date.now();
      try {
        setDoc(
          doc(db, "daily_activity", docId),
          {
            logoutTime: now,
            lastActive: now,
          },
          { merge: true }
        );
        setDoc(
          doc(db, "users", email),
          {
            lastLogout: now,
            isOnline: false,
          },
          { merge: true }
        );
      } catch {}
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isLoggedIn, user?.email]);

  return null;
}
