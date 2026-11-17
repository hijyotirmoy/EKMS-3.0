import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  writeBatch,
} from "firebase/firestore";
import { db, logsDb } from "@/lib/firebase";
import { AppNotification, NotificationType, UserProfile } from "@/lib/types";

/**
 * Gets cached read notification IDs for user from localStorage
 */
export function getLocalReadNotifications(userEmail: string): string[] {
  if (typeof window === "undefined" || !userEmail) return [];
  try {
    const raw = localStorage.getItem(`ekms_read_notifs_${userEmail.toLowerCase().trim()}`);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Gets cached closed notification IDs for user from localStorage
 */
export function getLocalClosedNotifications(userEmail: string): string[] {
  if (typeof window === "undefined" || !userEmail) return [];
  try {
    const raw = localStorage.getItem(`ekms_closed_notifs_${userEmail.toLowerCase().trim()}`);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Creates a notification in Firestore if it doesn't already exist
 */
export async function createDispensaryNotification(data: {
  targetDispensary: string;
  targetDispensaryRole: "Doctor" | "Pharmacist" | "Receptionist" | "all";
  title: string;
  message: string;
  link: string;
  tokenNo?: string;
}) {
  try {
    const docId = `disp_notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const notifRef = doc(logsDb, "notifications", docId);

    const payload: Record<string, any> = {
      id: docId,
      title: data.title || "Dispensary OPD Alert",
      message: data.message || "",
      type: "dispensary_opd",
      targetEmail: "all",
      targetRole: "all",
      targetDispensary: (data.targetDispensary || "").trim(),
      targetDispensaryRole: data.targetDispensaryRole || "all",
      link: data.link || "/appointment",
      readBy: [],
      closedBy: [],
      createdAt: Date.now(),
      metadata: {
        tokenNo: data.tokenNo || "",
        targetDispensary: data.targetDispensary,
        targetDispensaryRole: data.targetDispensaryRole,
      },
    };

    await setDoc(notifRef, payload, { merge: true }).catch((e) => {
      console.warn("Write to logsDb dispensary notification:", e);
    });

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ekms-notification-created"));
    }

    return docId;
  } catch (err) {
    console.warn("createDispensaryNotification error:", err);
    return null;
  }
}

/**
 * Creates a notification in Firestore if it doesn't already exist
 */
export async function createNotification(
  data: {
    id?: string;
    title: string;
    message: string;
    type?: NotificationType;
    targetEmail?: string | "all";
    targetRole?: "all" | "admin" | "agent";
    celebrantEmail?: string;
    link?: string;
    metadata?: Record<string, any>;
    createdAt?: number;
  }
) {
  // Stop all booking notifications for agents, admins, and master admins
  if (
    data.type === "booking" ||
    (data.title && /booking|appointment/i.test(data.title)) ||
    (data.link && data.link.includes("/booking"))
  ) {
    return null;
  }

  try {
    const docId = data.id || doc(collection(logsDb, "notifications")).id;
    const notifRef = doc(logsDb, "notifications", docId);
    const existingSnap = await getDoc(notifRef).catch(() => null);

    // If notification already exists with readBy/closedBy data, do not wipe out readBy array
    if (existingSnap && existingSnap.exists()) {
      return docId;
    }

    const payload: Record<string, any> = {
      id: docId,
      title: data.title || "",
      message: data.message || "",
      type: data.type || "system",
      targetEmail: (data.targetEmail || "all").toLowerCase().trim(),
      targetRole: data.targetRole || "all",
      readBy: [],
      closedBy: [],
      createdAt: data.createdAt || Date.now(),
      metadata: data.metadata || {},
    };

    if (data.celebrantEmail) {
      payload.celebrantEmail = data.celebrantEmail.toLowerCase().trim();
    }
    if (data.link) {
      payload.link = data.link;
    }

    // Write to logsDb (new dedicated account for all notifications)
    const p1 = setDoc(notifRef, payload, { merge: true }).catch((e) => {
      console.warn("Write to logsDb notifications collection:", e);
    });
    const p2 = setDoc(
      doc(logsDb, "announcements", docId),
      { ...payload, isVisible: true, isNotification: true },
      { merge: true }
    ).catch((e) => {
      console.warn("Write to logsDb announcements collection:", e);
    });

    await Promise.allSettled([p1, p2]);

    if (typeof window !== "undefined") {
      try {
        sessionStorage.removeItem("navbar_notifications");
        sessionStorage.removeItem("navbar_announcements");
        window.dispatchEvent(new CustomEvent("ekms-notification-created"));
      } catch (e) {}
    }

    return docId;
  } catch (error) {
    console.error("Failed to create notification:", error);
    return null;
  }
}

/**
 * Dispatches an admin-only notification
 */
export async function notifyAdmins(data: {
  id?: string;
  title: string;
  message: string;
  type?: NotificationType;
  link?: string;
  metadata?: Record<string, any>;
}) {
  if (
    data.type === "booking" ||
    (data.title && /booking|appointment/i.test(data.title)) ||
    (data.link && data.link.includes("/booking"))
  ) {
    return null;
  }
  return createNotification({
    ...data,
    targetEmail: "all",
    targetRole: "admin",
  });
}

/**
 * Dispatches an agent-only notification
 */
export async function notifyAgents(data: {
  id?: string;
  title: string;
  message: string;
  type?: NotificationType;
  link?: string;
  metadata?: Record<string, any>;
}) {
  return createNotification({
    ...data,
    targetEmail: "all",
    targetRole: "agent",
  });
}

/**
 * Marks a notification as read by a specific user
 */
export async function markNotificationRead(notificationId: string, userEmail: string) {
  if (!notificationId || !userEmail) return;
  const emailKey = userEmail.toLowerCase().trim();

  // Save to localStorage immediately
  try {
    if (typeof window !== "undefined") {
      const stored = getLocalReadNotifications(emailKey);
      if (!stored.includes(notificationId)) {
        stored.push(notificationId);
        localStorage.setItem(`ekms_read_notifs_${emailKey}`, JSON.stringify(stored));
      }
    }
  } catch (e) {}

  const payload = {
    id: notificationId,
    readBy: arrayUnion(emailKey),
    updatedAt: Date.now(),
  };

  await Promise.allSettled([
    setDoc(doc(logsDb, "notifications", notificationId), payload, { merge: true }),
    setDoc(doc(logsDb, "announcements", notificationId), payload, { merge: true }),
  ]);
}

/**
 * Marks a notification as unread by a specific user
 */
export async function markNotificationUnread(notificationId: string, userEmail: string) {
  if (!notificationId || !userEmail) return;
  const emailKey = userEmail.toLowerCase().trim();

  // Remove from localStorage
  try {
    if (typeof window !== "undefined") {
      const stored = getLocalReadNotifications(emailKey).filter((id) => id !== notificationId);
      localStorage.setItem(`ekms_read_notifs_${emailKey}`, JSON.stringify(stored));
    }
  } catch (e) {}

  const payload = {
    id: notificationId,
    readBy: arrayRemove(emailKey),
    updatedAt: Date.now(),
  };

  await Promise.allSettled([
    setDoc(doc(logsDb, "notifications", notificationId), payload, { merge: true }),
    setDoc(doc(logsDb, "announcements", notificationId), payload, { merge: true }),
  ]);
}

/**
 * Marks multiple notifications as read in a single batch
 */
export async function markAllNotificationsRead(notificationIds: string[], userEmail: string) {
  if (!notificationIds.length || !userEmail) return;
  const emailKey = userEmail.toLowerCase().trim();

  // Save to localStorage immediately
  try {
    if (typeof window !== "undefined") {
      const stored = getLocalReadNotifications(emailKey);
      const combined = Array.from(new Set([...stored, ...notificationIds]));
      localStorage.setItem(`ekms_read_notifs_${emailKey}`, JSON.stringify(combined));
    }
  } catch (e) {}

  try {
    const batchLogs = writeBatch(logsDb);
    notificationIds.forEach((id) => {
      const ref = doc(logsDb, "notifications", id);
      batchLogs.set(
        ref,
        {
          id,
          readBy: arrayUnion(emailKey),
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    });
    await batchLogs.commit();
  } catch (error) {}
}

/**
 * Closes / dismisses a notification for a user
 */
export async function closeNotification(notificationId: string, userEmail: string) {
  if (!notificationId || !userEmail) return;
  const emailKey = userEmail.toLowerCase().trim();

  // Save to localStorage immediately
  try {
    if (typeof window !== "undefined") {
      const stored = getLocalClosedNotifications(emailKey);
      if (!stored.includes(notificationId)) {
        stored.push(notificationId);
        localStorage.setItem(`ekms_closed_notifs_${emailKey}`, JSON.stringify(stored));
      }
    }
  } catch (e) {}

  const payload = {
    id: notificationId,
    closedBy: arrayUnion(emailKey),
    updatedAt: Date.now(),
  };

  await Promise.allSettled([
    setDoc(doc(logsDb, "notifications", notificationId), payload, { merge: true }),
    setDoc(doc(logsDb, "announcements", notificationId), payload, { merge: true }),
  ]);
}

/**
 * Formats relative timestamp for notifications
 */
export function formatNotificationTime(timestamp?: number): string {
  if (!timestamp) return "Just now";
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 45) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;

  const dateObj = new Date(timestamp);
  return dateObj.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Checks team members for birthdays in the upcoming 7 days or today,
 * and creates celebratory reminder notifications for other team members.
 */
export async function checkAndCreateBirthdayNotifications(users: UserProfile[]) {
  if (!users || users.length === 0) return;

  const now = new Date();

  for (const user of users) {
    const dobString = user.birthday || (user as any).dob;
    if (!dobString || !user.email) continue;

    const bdayInfo = parseBirthdayDaysRemaining(dobString);
    if (!bdayInfo) continue;

    const { daysRemaining, formattedBday, nextBdayYear } = bdayInfo;

    // Check if birthday is within the next 7 days (including today = 0)
    if (daysRemaining >= 0 && daysRemaining <= 7) {
      const sanitizedEmail = user.email.toLowerCase().replace(/[^a-z0-9]/g, "_");
      const notifId = `bday_${sanitizedEmail}_${nextBdayYear}`;

      let relativeText = "";
      if (daysRemaining === 0) {
        relativeText = "Today";
      } else if (daysRemaining === 1) {
        relativeText = "Tomorrow";
      } else {
        relativeText = `in ${daysRemaining} days`;
      }

      const displayName = user.displayName || user.name || user.email.split("@")[0];

      await createNotification({
        id: notifId,
        title: daysRemaining === 0 ? `🎂 Happy Birthday ${displayName}! 🎉` : `🎂 Upcoming Birthday: ${displayName}!`,
        message:
          daysRemaining === 0
            ? `**${displayName}** is celebrating their birthday today (${formattedBday})! Send them your warmest wishes and greetings! 🎈🎉`
            : `**${displayName}**'s birthday is **${relativeText}** (${formattedBday})! Don't forget to wish them! 🎈🎉`,
        type: "birthday",
        targetEmail: "all",
        celebrantEmail: user.email.toLowerCase(),
        link: "/team",
        metadata: {
          bdayUserEmail: user.email,
          bdayUserName: displayName,
          bdayDate: formattedBday,
          daysRemaining,
        },
      });
    }
  }
}

/**
 * Helper to parse birthday date and calculate days remaining until next occurrence
 */
export function parseBirthdayDaysRemaining(
  dobString: string
): { daysRemaining: number; formattedBday: string; nextBdayYear: number } | null {
  if (!dobString) return null;
  try {
    let month = 0;
    let day = 0;

    // Support YYYY-MM-DD, DD-MM-YYYY, MM-DD, etc.
    const parts = dobString.split(/[-/.]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        // YYYY-MM-DD
        month = parseInt(parts[1], 10);
        day = parseInt(parts[2], 10);
      } else if (parts[2].length === 4) {
        // DD-MM-YYYY
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
      }
    } else if (parts.length === 2) {
      // MM-DD
      month = parseInt(parts[0], 10);
      day = parseInt(parts[1], 10);
    }

    if (!month || !day || isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) {
      const d = new Date(dobString);
      if (isNaN(d.getTime())) return null;
      month = d.getMonth() + 1;
      day = d.getDate();
    }

    const now = new Date();
    // Normalize today to midnight in local time
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    let nextBdayYear = now.getFullYear();
    let nextBday = new Date(nextBdayYear, month - 1, day);

    // If birthday already passed this year (before today), use next year
    if (nextBday.getTime() < todayMidnight) {
      nextBdayYear += 1;
      nextBday = new Date(nextBdayYear, month - 1, day);
    }

    const diffDays = Math.round((nextBday.getTime() - todayMidnight) / (1000 * 60 * 60 * 24));
    const formattedBday = nextBday.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    return {
      daysRemaining: diffDays,
      formattedBday,
      nextBdayYear,
    };
  } catch {
    return null;
  }
}
