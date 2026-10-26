import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { PopupProvider } from "@/context/PopupContext";
import LoginModal from "@/components/auth/LoginModal";
import MaintenanceModal from "@/components/common/MaintenanceModal";
import AppLoader from "@/components/common/AppLoader";
import ActivityTracker from "@/components/common/ActivityTracker";
import PageAccessGuard from "@/components/auth/PageAccessGuard";
import PageTitleUpdater from "@/components/common/PageTitleUpdater";

const roboto = Roboto({
  weight: ["300", "400", "500", "700", "900"],
  subsets: ["latin"],
  variable: "--font-roboto",
});

export const metadata: Metadata = {
  title: "Home",
  description:
    "Enterprise knowledge base, assessment platform, and appointment booking portal for ESIC insurance agents.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={roboto.variable}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (typeof window !== 'undefined') {
                  var p = window.location.pathname;
                  if (p.endsWith('/') && p.length > 1) p = p.slice(0, -1);
                  var titles = {
                    '/': 'Home',
                    '/booking': 'Booking',
                    '/files': 'Files',
                    '/doubts': 'Doubts',
                    '/facility': 'Facilities',
                    '/facilities': 'Facilities',
                    '/onboarding': 'Onboarding',
                    '/quiz': 'Quizzes',
                    '/quizzes': 'Quizzes',
                    '/data': 'Data',
                    '/team': 'Team',
                    '/profile': 'Profile',
                    '/reports': 'Reports',
                    '/admin': 'Overview',
                    '/admin/overview': 'Overview',
                    '/admin/bookings': 'Manage Bookings',
                    '/admin/booking': 'Manage Bookings',
                    '/admin/files': 'Manage Files',
                    '/admin/doubts': 'Manage Doubts',
                    '/admin/facilities': 'Manage Facilities',
                    '/admin/facility': 'Manage Facilities',
                    '/admin/qa': 'Manage Q&A',
                    '/admin/quiz': 'Manage Quizzes',
                    '/admin/onboarding': 'Manage Onboarding',
                    '/admin/announcements': 'Announcements',
                    '/admin/missing-content': 'Missing Content',
                    '/admin/notifications': 'Notifications',
                    '/admin/settings': 'System Settings',
                    '/admin/teams': 'Manage Teams'
                  };
                  var t = titles[p];
                  if (!t && p.indexOf('/admin/reports') === 0) t = 'Reports';
                  if (!t) {
                    var parts = p.split('/').filter(Boolean);
                    if (parts.length > 0) {
                      var last = parts[parts.length - 1];
                      t = last.charAt(0).toUpperCase() + last.slice(1);
                    }
                  }
                  if (t) document.title = t;
                }
              } catch (e) {}

              if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(function(registrations) {
                  for (var r of registrations) {
                    r.unregister();
                  }
                });
                if ('caches' in window) {
                  caches.keys().then(function(names) {
                    for (var n of names) caches.delete(n);
                  });
                }
              }
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
        <PopupProvider>
          <AuthProvider>
            <PageTitleUpdater />
            <AppLoader />
            <ActivityTracker />
            <PageAccessGuard>
              {children}
            </PageAccessGuard>
            <LoginModal />
            <MaintenanceModal />
          </AuthProvider>
        </PopupProvider>
      </body>
    </html>
  );
}
