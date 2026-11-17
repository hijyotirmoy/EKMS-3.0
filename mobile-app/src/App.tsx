import React, { useState, useEffect, useRef } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import MobileHeader from "./components/MobileHeader";
import BottomNav, { MobileTab } from "./components/BottomNav";
import NotificationDrawer from "./components/NotificationDrawer";
import LoginModal from "./components/LoginModal";
import HomeView from "./views/HomeView";
import BookingsView from "./views/BookingsView";
import DoubtsView from "./views/DoubtsView";
import QuizzesView from "./views/QuizzesView";
import ProfileView from "./views/ProfileView";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { logsDb } from "./lib/firebase";
import { AppNotification } from "./lib/types";

function MainLayout() {
  const { isLoggedIn, loading, user, userProfile, isAdmin, openLoginModal } = useAuth();
  const [activeTab, setActiveTab] = useState<MobileTab>("home");
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const hasRequestedPerm = useRef(false);
  const isFirstLoad = useRef(true);

  // Protected Tab Navigation: If user clicks protected tab while not logged in, prompt login
  const handleTabChange = (tab: MobileTab) => {
    if (tab !== "home" && !isLoggedIn) {
      openLoginModal();
      return;
    }
    setActiveTab(tab);
  };

  // Setup Native Android Notification Channel & Listeners
  useEffect(() => {
    const setupNativeNotifs = async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;

        const { LocalNotifications } = await import("@capacitor/local-notifications");

        if (!hasRequestedPerm.current) {
          hasRequestedPerm.current = true;
          const status = await LocalNotifications.checkPermissions();
          if (status.display !== "granted") {
            await LocalNotifications.requestPermissions();
          }

          try {
            await LocalNotifications.createChannel({
              id: "ekms_mobile_alerts",
              name: "EKMS Mobile Alerts",
              description: "Instant role-based notifications for field agents",
              importance: 5,
              visibility: 1,
              vibration: true,
              sound: "beep.wav",
            });
          } catch (e) {}
        }
      } catch (e) {
        console.warn("Native notif setup warning:", e);
      }
    };

    setupNativeNotifs();
  }, []);

  // Listen to Firestore Notifications and fire OS Status Bar Notifications
  useEffect(() => {
    if (!user?.email) return;
    const userEmail = user.email.toLowerCase().trim();

    const getNotifiedMap = (): Record<string, number> => {
      try {
        const raw = localStorage.getItem(`ekms_standalone_notified_${userEmail}`);
        return raw ? JSON.parse(raw) : {};
      } catch (e) {
        return {};
      }
    };

    const q = query(
      collection(logsDb, "notifications"),
      orderBy("createdAt", "desc"),
      limit(25)
    );

    const unsub = onSnapshot(q, async (snapshot) => {
      try {
        let isNative = false;
        let LocalNotifications: any = null;

        try {
          const cap = await import("@capacitor/core");
          isNative = cap.Capacitor.isNativePlatform();
          if (isNative) {
            LocalNotifications = (await import("@capacitor/local-notifications")).LocalNotifications;
          }
        } catch (e) {}

        const notifiedMap = getNotifiedMap();
        let changed = false;

        const userRole = (userProfile?.role || (user ? "Agent" : "guest")).toLowerCase().trim();
        const isUserAdmin = isAdmin || userRole.includes("admin") || userRole.includes("master");

        for (const docChange of snapshot.docChanges()) {
          if (docChange.type === "added" || docChange.type === "modified") {
            const item = { id: docChange.doc.id, ...docChange.doc.data() } as AppNotification;
            if (notifiedMap[item.id]) continue;

            const target = (item.targetEmail || "all").toLowerCase().trim();
            const isDirectlyForMe = target !== "all" && target === userEmail;

            const notifRole = (item.targetRole || "all").toLowerCase().trim();
            const isRoleAdmin = notifRole === "admin" || notifRole === "master_admin" || notifRole === "admins";
            const isRoleAgent = notifRole === "agent" || notifRole === "agents";

            if (isRoleAdmin && !isUserAdmin) continue;
            if (isRoleAgent && isUserAdmin && !isDirectlyForMe) continue;
            if (target !== "all" && target !== userEmail) continue;

            const createdAt = item.createdAt || Date.now();
            const fifteenMinsAgo = Date.now() - 15 * 60 * 1000;

            if (isFirstLoad.current && createdAt < fifteenMinsAgo) {
              notifiedMap[item.id] = Date.now();
              continue;
            }

            // Trigger OS Notification in Android status bar!
            if (isNative && LocalNotifications) {
              const notifId = Math.abs(
                item.id.split("").reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0)
              ) % 2147483647;

              await LocalNotifications.schedule({
                notifications: [
                  {
                    id: notifId,
                    title: item.title || "EKMS Alert",
                    body: item.message || "New update received.",
                    channelId: "ekms_mobile_alerts",
                    sound: "beep.wav",
                    extra: {
                      id: item.id,
                      link: item.link || null,
                    },
                  },
                ],
              });
            }

            notifiedMap[item.id] = Date.now();
            changed = true;
          }
        }

        isFirstLoad.current = false;
        if (changed) {
          localStorage.setItem(`ekms_standalone_notified_${userEmail}`, JSON.stringify(notifiedMap));
        }
      } catch (e) {
        console.warn("Status bar push notification warning:", e);
      }
    });

    return () => unsub();
  }, [user?.email, userProfile, isAdmin, user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-4">
        <div className="w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center p-3 mb-4 animate-pulse">
          <img src="/ekms-logo.png" alt="EKMS" className="w-full h-full object-contain" />
        </div>
        <p className="text-xs text-slate-400 font-medium tracking-wide">Starting EKMS Mobile...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <MobileHeader
        onOpenNotifications={() => {
          if (!isLoggedIn) {
            openLoginModal();
          } else {
            setIsNotifDrawerOpen(true);
          }
        }}
        unreadCount={unreadNotifCount}
      />

      <main className="flex-1">
        {activeTab === "home" && <HomeView onNavigateTab={handleTabChange} />}
        {activeTab === "bookings" && <BookingsView />}
        {activeTab === "doubts" && <DoubtsView />}
        {activeTab === "quizzes" && <QuizzesView />}
        {activeTab === "profile" && <ProfileView />}
      </main>

      <BottomNav activeTab={activeTab} onChangeTab={handleTabChange} />

      <NotificationDrawer
        isOpen={isNotifDrawerOpen}
        onClose={() => setIsNotifDrawerOpen(false)}
        onUnreadChange={(count) => setUnreadNotifCount(count)}
      />

      <LoginModal />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainLayout />
    </AuthProvider>
  );
}
