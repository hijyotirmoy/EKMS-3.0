import React from "react";
import { Home, Calendar, HelpCircle, GraduationCap, User } from "lucide-react";

export type MobileTab = "home" | "bookings" | "doubts" | "quizzes" | "profile";

interface BottomNavProps {
  activeTab: MobileTab;
  onChangeTab: (tab: MobileTab) => void;
}

export default function BottomNav({ activeTab, onChangeTab }: BottomNavProps) {
  const tabs = [
    { id: "home", label: "Home", icon: Home },
    { id: "bookings", label: "Bookings", icon: Calendar },
    { id: "doubts", label: "Doubts", icon: HelpCircle },
    { id: "quizzes", label: "Quizzes", icon: GraduationCap },
    { id: "profile", label: "Profile", icon: User },
  ] as const;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800/80 px-2 py-1 pb-safe">
      <div className="flex items-center justify-around max-w-lg mx-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id as MobileTab)}
              className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-xl transition-all ${
                isActive
                  ? "text-blue-400 font-semibold scale-105"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <div
                className={`p-1 rounded-lg transition-colors ${
                  isActive ? "bg-blue-600/20" : ""
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? "text-blue-400" : "text-slate-400"}`} />
              </div>
              <span className="text-[10px] mt-0.5 tracking-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
