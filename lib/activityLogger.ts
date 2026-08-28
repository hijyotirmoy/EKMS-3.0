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
  type?: "auth" | "doubt" | "report" | "quiz" | "course" | "booking" | "download" | "delete" | "search" | "general";
  color?: "blue" | "emerald" | "rose" | "amber" | "purple" | "teal" | "slate";
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
    doubt: "amber",
    report: "rose",
    quiz: "purple",
    course: "emerald",
    booking: "teal",
    download: "blue",
    delete: "rose",
    search: "slate",
    general: "blue",
  };

  const payloadEvent: ActivityEvent = {
    time: now,
    desc: event.desc,
    type: event.type || "general",
    color: event.color || colorMap[event.type || "general"] || "blue",
    icon: event.icon || (event.type === "delete" ? "Trash2" : "Activity"),
  };

  try {
    const activityDocRef = doc(db, "daily_activity", docId);
    await updateDoc(activityDocRef, {
      lastActive: now,
      timelineEvents: arrayUnion(payloadEvent),
      ...(event.type === "download" ? { filesDownloaded: increment(1) } : {}),
      ...(event.extraData || {}),
    });
  } catch (err) {
    // If doc doesn't exist yet, create it with merge
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
          ...(event.extraData || {}),
        },
        { merge: true }
      );
    } catch (e) {
      console.error("Activity logging error:", e);
    }
  }

  // Update last active in users collection
  try {
    const userDocRef = doc(db, "users", cleanEmail);
    await setDoc(userDocRef, { lastActive: now, isOnline: true }, { merge: true });
  } catch {}
}
