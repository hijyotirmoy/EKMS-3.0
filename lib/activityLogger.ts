import { doc, setDoc, updateDoc, arrayUnion, increment } from "firebase/firestore";
import { db } from "@/lib/firebase";

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface ActivityEvent {
  time: number;
  desc: string;
  type?:
    | "auth"
    | "doubt"
    | "report"
    | "quiz"
    | "course"
    | "booking"
    | "download"
    | "delete"
    | "search"
    | "add"
    | "edit"
    | "feedback"
    | "facility"
    | "settings"
    | "profile"
    | "general";
  color?: "blue" | "emerald" | "rose" | "amber" | "purple" | "teal" | "slate" | "indigo";
  icon?: string;
}

export async function logUserActivity(
  email: string | null | undefined,
  event: {
    desc: string;
    type?: ActivityEvent["type"];
    color?: ActivityEvent["color"];
    icon?: string;
    extraData?: Record<string, any>;
  }
) {
  if (!email) return;
  const cleanEmail = email.toLowerCase().trim();
  const today = getTodayDateString();
  const docId = `${cleanEmail}_${today}`;
  const now = Date.now();

  const colorMap: Record<string, ActivityEvent["color"]> = {
    auth: "blue",
    add: "emerald",
    edit: "blue",
    delete: "rose",
    report: "rose",
    feedback: "purple",
    doubt: "amber",
    quiz: "purple",
    course: "emerald",
    booking: "teal",
    facility: "amber",
    download: "teal",
    search: "slate",
    settings: "slate",
    profile: "indigo",
    general: "blue",
  };

  const payloadEvent: ActivityEvent = {
    time: now,
    desc: event.desc,
    type: event.type || "general",
    color: event.color || colorMap[event.type || "general"] || "blue",
    icon: event.icon || (event.type === "delete" ? "Trash2" : event.type === "add" ? "PlusCircle" : event.type === "edit" ? "Edit" : "Activity"),
  };

  try {
    const activityDocRef = doc(db, "daily_activity", docId);
    await updateDoc(activityDocRef, {
      lastActive: now,
      timelineEvents: arrayUnion(payloadEvent),
      ...(event.type === "download" ? { filesDownloaded: increment(1) } : {}),
      ...(event.type === "quiz" ? { quizzesCompletedCount: increment(1) } : {}),
      ...(event.extraData || {}),
    });
  } catch (err) {
    try {
      const activityDocRef = doc(db, "daily_activity", docId);
      await setDoc(
        activityDocRef,
        {
          email: cleanEmail,
          date: today,
          loginTime: now,
          firstLogin: now,
          lastActive: now,
          timelineEvents: [payloadEvent],
          ...(event.type === "download" ? { filesDownloaded: 1 } : {}),
          ...(event.type === "quiz" ? { quizzesCompletedCount: 1 } : {}),
          ...(event.extraData || {}),
        },
        { merge: true }
      );
    } catch (e) {
      console.error("Activity logging error:", e);
    }
  }

  // Update last active in users collection (Throttled to once every 10 mins per session to save writes)
  const lastUserDocWriteKey = `last_user_write_${cleanEmail}`;
  const lastWriteTime = (globalThis as any)[lastUserDocWriteKey] || 0;
  if (now - lastWriteTime > 10 * 60 * 1000) {
    (globalThis as any)[lastUserDocWriteKey] = now;
    try {
      const userDocRef = doc(db, "users", cleanEmail);
      await setDoc(userDocRef, { lastActive: now, isOnline: true }, { merge: true });
    } catch {}
  }
}
