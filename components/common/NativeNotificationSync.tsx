"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { logsDb } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { AppNotification } from "@/lib/types";

export default function NativeNotificationSync() {
  const { user, userProfile, isAdmin } = useAuth();
  const router = useRouter();
  const userEmail = (user?.email || "").toLowerCase().trim();
  const hasRequestedPermission = useRef(false);
  const isFirstLoad = useRef(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cleanupListener: (() => void) | null = null;

    const setupCapacitor = async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        const isNative = Capacitor.isNativePlatform();

        if (isNative) {
          const { LocalNotifications } = await import("@capacitor/local-notifications");

          // Request permission on Android 13+
          if (!hasRequestedPermission.current) {
            hasRequestedPermission.current = true;
            const status = await LocalNotifications.checkPermissions();
            if (status.display !== "granted") {
              await LocalNotifications.requestPermissions();
            }

            // Create high-priority notification channel with vibration and sound
            try {
              await LocalNotifications.createChannel({
                id: "ekms_notifications",
                name: "EKMS Alerts",
                description: "Personalized role-based alerts for EKMS",
                importance: 5,
                visibility: 1,
                vibration: true,
                sound: "beep.wav",
              });
            } catch (e) {
              console.warn("Could not create notification channel:", e);
            }
          }

          // Handle notification click action
          const actionListener = await LocalNotifications.addListener(
            "localNotificationActionPerformed",
            (notificationAction) => {
              const extra = notificationAction.notification.extra;
              if (extra?.link) {
                router.push(extra.link);
              } else {
                window.dispatchEvent(new CustomEvent("ekms-open-notification-drawer"));
              }
            }
          );

          cleanupListener = () => {
            actionListener.remove();
          };
        } else if ("Notification" in window && Notification.permission === "default") {
          // In desktop or mobile browser, request browser notification permission
          try {
            await Notification.requestPermission();
          } catch (e) {}
        }
      } catch (err) {
        console.warn("Capacitor notification init error:", err);
      }
    };

    setupCapacitor();

    return () => {
      if (cleanupListener) cleanupListener();
    };
  }, [router]);

  // Real-time Firestore notification listener for role-based & user-based push
  useEffect(() => {
    if (!userEmail) return;

    const getNotifiedMap = (): Record<string, number> => {
      try {
        const raw = localStorage.getItem(`ekms_native_notified_${userEmail}`);
        return raw ? JSON.parse(raw) : {};
      } catch (e) {
        return {};
      }
    };

    const saveNotifiedMap = (map: Record<string, number>) => {
      try {
        localStorage.setItem(`ekms_native_notified_${userEmail}`, JSON.stringify(map));
      } catch (e) {}
    };

    const q = query(
      collection(logsDb, "notifications"),
      orderBy("createdAt", "desc"),
      limit(25)
    );

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        try {
          const notifiedMap = getNotifiedMap();
          let hasNewNotification = false;

          const userRole = (userProfile?.role || (user ? "Agent" : "guest")).toLowerCase().trim();
          const isUserAdmin = isAdmin || userRole.includes("admin") || userRole.includes("master");

          let isNative = false;
          let LocalNotifications: any = null;

          try {
            const cap = await import("@capacitor/core");
            isNative = cap.Capacitor.isNativePlatform();
            if (isNative) {
              LocalNotifications = (await import("@capacitor/local-notifications")).LocalNotifications;
            }
          } catch (e) {}

          for (const docChange of snapshot.docChanges()) {
            if (docChange.type === "added" || docChange.type === "modified") {
              const item = { id: docChange.doc.id, ...docChange.doc.data() } as AppNotification;

              // Check if already notified
              if (notifiedMap[item.id]) continue;

              // Filter out booking notifications completely for all users
              if (
                item.type === "booking" ||
                (item.title && /booking|appointment/i.test(item.title)) ||
                (item.link && item.link.includes("/booking"))
              ) {
                notifiedMap[item.id] = Date.now();
                continue;
              }

              // Personalized and Role-based filtering
              const target = (item.targetEmail || "all").toLowerCase().trim();
              const isDirectlyForMe = target !== "all" && target === userEmail;

              const notifRole = (item.targetRole || "all").toLowerCase().trim();
              const isRoleAdmin = notifRole === "admin" || notifRole === "master_admin" || notifRole === "admins";
              const isRoleAgent = notifRole === "agent" || notifRole === "agents";

              if (isRoleAdmin && !isUserAdmin) continue;
              if (isRoleAgent && isUserAdmin && !isDirectlyForMe) continue;
              if (target !== "all" && target !== userEmail) continue;

              // Don't notify own birthday
              if (item.type === "birthday" && item.celebrantEmail?.toLowerCase().trim() === userEmail) {
                continue;
              }

              // On the very first snapshot load, only alert if created within the last 15 minutes
              const createdAt = item.createdAt || Date.now();
              const fifteenMinsAgo = Date.now() - 15 * 60 * 1000;

              if (isFirstLoad.current && createdAt < fifteenMinsAgo) {
                notifiedMap[item.id] = Date.now();
                continue;
              }

              // Fire native Android notification in system notification bar
              const notifTitle = item.title || "EKMS Notification";
              const notifBody = item.message || "You have a new update in EKMS.";

              if (isNative && LocalNotifications) {
                const notifId = Math.abs(
                  item.id.split("").reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0)
                ) % 2147483647;

                await LocalNotifications.schedule({
                  notifications: [
                    {
                      id: notifId,
                      title: notifTitle,
                      body: notifBody,
                      channelId: "ekms_notifications",
                      sound: "beep.wav",
                      extra: {
                        id: item.id,
                        link: item.link || null,
                      },
                    },
                  ],
                });
              } else if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
                // Browser notification fallback
                try {
                  const n = new Notification(notifTitle, {
                    body: notifBody,
                    icon: "/ekms-logo.png",
                  });
                  n.onclick = () => {
                    window.focus();
                    if (item.link) router.push(item.link);
                    else window.dispatchEvent(new CustomEvent("ekms-open-notification-drawer"));
                  };
                } catch (e) {}
              }

              notifiedMap[item.id] = Date.now();
              hasNewNotification = true;
            }
          }

          isFirstLoad.current = false;

          if (hasNewNotification) {
            saveNotifiedMap(notifiedMap);
          }
        } catch (e) {
          console.warn("Native notification dispatch error:", e);
        }
      },
      (err) => console.warn("Native notification snapshot listener warning:", err)
    );

    return () => {
      unsubscribe();
    };
  }, [userEmail, userProfile, isAdmin, user, router]);

  return null;
}
