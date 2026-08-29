"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminAnnouncementsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/notifications");
  }, [router]);

  return (
    <div className="p-12 text-center text-slate-400 text-xs">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
      <span>Redirecting to Manage Notifications...</span>
    </div>
  );
}
