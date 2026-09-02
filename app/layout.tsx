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

const roboto = Roboto({
  weight: ["300", "400", "500", "700", "900"],
  subsets: ["latin"],
  variable: "--font-roboto",
});

export const metadata: Metadata = {
  title: "ESIC KMS — Knowledge Management & Operations Portal",
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
      <body className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
        <PopupProvider>
          <AuthProvider>
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
