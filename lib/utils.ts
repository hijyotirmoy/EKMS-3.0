import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  doc,
  getDoc,
  updateDoc,
  getDocs,
  collection,
  query,
  where,
  deleteDoc,
} from "firebase/firestore";
import { Course, CourseUserProgress, DayAvailability, BookingRecord } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format bytes to KB / MB
export function formatBytes(bytes?: number, decimals = 2): string {
  if (!bytes || bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// Slug creator
export function createSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

// Format relative time (e.g. "2 hours ago")
export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  let interval = seconds / 31536000;
  if (interval >= 1) return Math.floor(interval) + " years ago";
  interval = seconds / 2592000;
  if (interval >= 1) return Math.floor(interval) + " months ago";
  interval = seconds / 86400;
  if (interval >= 1) return Math.floor(interval) + " days ago";
  interval = seconds / 3600;
  if (interval >= 1) return Math.floor(interval) + " hours ago";
  interval = seconds / 60;
  if (interval >= 1) return Math.floor(interval) + " mins ago";
  return "Just now";
}

// Parse markdown formatting (links, bold, italic, line breaks) to safe HTML
export function parseMarkdownLinks(text?: string): string {
  if (!text) return "";
  return text
    .replace(
      /\[(.*?)\]\((.*?)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline font-semibold hover:text-blue-800">$1</a>'
    )
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-slate-900">$1</strong>')
    .replace(/__(.*?)__/g, '<strong class="font-bold text-slate-900">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
    .replace(/\n/g, "<br />");
}

// Haversine distance formula in KM
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(1));
}

// Dynamic Course Progress Recalculator (Enforces >= 90% checkpoint passing grade)
export function recalculateCourseProgress(
  course: Course,
  prog?: CourseUserProgress
): CourseUserProgress {
  if (!prog) {
    return { status: "new", unlockedIndex: 0, chapterScores: {}, finalScore: null, chapterAnswers: {} };
  }

  let trueUnlockedIndex = 0;
  let isFullyCompleted = true;
  let recalculatedFinalScore: number | null = null;
  const recalculatedChapterScores: Record<number | string, number> = {};

  // 1. Evaluate Chapters
  if (course.chapters && course.chapters.length > 0) {
    for (let i = 0; i < course.chapters.length; i++) {
      const ch = course.chapters[i];
      if (ch.questions && ch.questions.length > 0) {
        const ans = prog.chapterAnswers && prog.chapterAnswers[i] ? prog.chapterAnswers[i] : {};
        let score = 0;
        let answered = 0;
        ch.questions.forEach((q, qIndex) => {
          if (ans[qIndex] !== undefined && ans[qIndex] !== null) {
            answered++;
            if (ans[qIndex] === Number(q.correct)) score++;
          }
        });

        // Only record chapter score if it was explicitly submitted and all questions were answered
        const hasSubmittedScore = prog.chapterScores && typeof prog.chapterScores[i] === "number";
        if (hasSubmittedScore && answered === ch.questions.length) {
          const pct = Math.round((score / ch.questions.length) * 100);
          recalculatedChapterScores[i] = pct;

          if (pct < 90) {
            isFullyCompleted = false;
            break; // Failed to pass 90% threshold
          }
        } else {
          isFullyCompleted = false;
          break; // Unsubmitted or currently retaking
        }
      } else {
        if (prog.unlockedIndex <= i) {
          isFullyCompleted = false;
          break;
        }
      }
      trueUnlockedIndex = i + 1;
    }
  }

  // 2. Evaluate Final Assessment
  if (isFullyCompleted && course.finalQuiz && course.finalQuiz.length > 0) {
    const ans = prog.chapterAnswers && prog.chapterAnswers["final"] ? prog.chapterAnswers["final"] : {};
    let score = 0;
    let answered = 0;
    course.finalQuiz.forEach((q, qIndex) => {
      if (ans[qIndex] !== undefined && ans[qIndex] !== null) {
        answered++;
        if (ans[qIndex] === Number(q.correct)) score++;
      }
    });

    const hasSubmittedFinal = typeof prog.finalScore === "number";
    if (hasSubmittedFinal && answered === course.finalQuiz.length) {
      const pct = Math.round((score / course.finalQuiz.length) * 100);
      recalculatedFinalScore = pct;

      if (pct < 90) {
        isFullyCompleted = false;
      } else {
        trueUnlockedIndex++;
      }
    } else {
      isFullyCompleted = false;
    }
  }

  const totalExpectedTabs =
    (course.chapters ? course.chapters.length : 0) + (course.finalQuiz && course.finalQuiz.length > 0 ? 1 : 0);
  const hasAnyProgress =
    prog.unlockedIndex > 0 || (prog.chapterAnswers && Object.keys(prog.chapterAnswers).length > 0);

  let finalStatus: "new" | "in-progress" | "completed" = "new";
  if (isFullyCompleted && totalExpectedTabs > 0 && trueUnlockedIndex >= totalExpectedTabs) {
    finalStatus = "completed";
  } else if (prog.status === "in-progress" || trueUnlockedIndex > 0 || hasAnyProgress) {
    finalStatus = "in-progress";
  }

  return {
    ...prog,
    unlockedIndex: trueUnlockedIndex,
    status: finalStatus,
    chapterScores: recalculatedChapterScores,
    finalScore: recalculatedFinalScore,
  };
}

// Convert image file to compressed Base64 Data URI
export function getBase64Image(file: File, maxSize = 600, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (err) => reject(err);
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > height && width > maxSize) {
          height *= maxSize / width;
          width = maxSize;
        } else if (height > maxSize) {
          width *= maxSize / height;
          height = maxSize;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } else {
          resolve(img.src);
        }
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

// Indian Standard Time (IST) Midnight Helper
export function getISTMidnight(): Date {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istToday = new Date(istString);
  istToday.setHours(0, 0, 0, 0);
  return istToday;
}

// Calculate follow-up date after scheduled date (dateKey: "YYYY-MM-DD", offsetDays: default 8)
export function getFollowUpInfo(dateKey: string, offsetDays: number = 8) {
  if (!dateKey) return { key: "", formatted: "N/A" };
  const parts = dateKey.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    return { key: "", formatted: "N/A" };
  }
  const [y, m, d] = parts;
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + (offsetDays > 0 ? offsetDays : 8));

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const key = `${year}-${month}-${day}`;

  const formatted = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return { key, formatted };
}

// Merge booking records from two databases (main db and bookingDb)
export function mergeBookingData(
  mainData: Record<string, DayAvailability>,
  secondaryData: Record<string, DayAvailability>
): Record<string, DayAvailability> {
  const merged: Record<string, DayAvailability> = {};

  // Copy all main db dates
  for (const [dateKey, dayObj] of Object.entries(mainData || {})) {
    merged[dateKey] = { ...dayObj, bookedRecords: [...(dayObj.bookedRecords || [])] };
  }

  // Merge secondary db dates
  for (const [dateKey, secObj] of Object.entries(secondaryData || {})) {
    if (!merged[dateKey]) {
      merged[dateKey] = { ...secObj, bookedRecords: [...(secObj.bookedRecords || [])] };
    } else {
      const existingRecords = merged[dateKey].bookedRecords || [];
      const secRecords = secObj.bookedRecords || [];

      const recordMap = new Map<string, BookingRecord>();
      existingRecords.forEach((r) => {
        const key = `${r.timestamp}_${r.phone || r.ipName}_${r.agentEmail}`;
        recordMap.set(key, r);
      });
      secRecords.forEach((r) => {
        const key = `${r.timestamp}_${r.phone || r.ipName}_${r.agentEmail}`;
        recordMap.set(key, r);
      });

      merged[dateKey] = {
        ...merged[dateKey],
        ...secObj,
        seats: secObj.seats !== undefined ? secObj.seats : merged[dateKey].seats,
        text: secObj.text || merged[dateKey].text,
        bookedRecords: Array.from(recordMap.values()),
      };
    }
  }

  return merged;
}

export interface DeleteBookingParams {
  timestamp?: number;
  agentEmail: string;
  ipName?: string;
  phone?: string;
  dateKey?: string;
  rescheduledDate?: string;
  originalScheduledDate?: string;
}

/**
 * Completely removes a booking record from BOTH databases (bookingDb & db)
 * across ALL potential date documents (b.dateKey, b.rescheduledDate, b.originalScheduledDate,
 * and scanning all date docs in both databases if needed), and cleans up all related rescheduleLogs.
 */
export async function deleteBookingRecordCompletely(
  b: DeleteBookingParams,
  primaryDb: any,
  secondaryDb: any
): Promise<number> {
  const agentEmailLower = (b.agentEmail || "").toLowerCase().trim();
  const ipLower = (b.ipName || "").toLowerCase().trim();
  const phoneClean = (b.phone || "").trim();

  // Candidate dates to check
  const candidateDates = new Set<string>();
  if (b.dateKey) candidateDates.add(b.dateKey);
  if (b.rescheduledDate) candidateDates.add(b.rescheduledDate);
  if (b.originalScheduledDate) candidateDates.add(b.originalScheduledDate);

  let totalRemovedCount = 0;
  const databases = [primaryDb, secondaryDb].filter(Boolean);

  const isMatch = (r: BookingRecord) => {
    const rEmail = (r.agentEmail || "").toLowerCase().trim();
    const rIp = (r.ipName || "").toLowerCase().trim();
    const rPhone = (r.phone || "").trim();

    // Primary match: timestamp & agentEmail
    if (b.timestamp && r.timestamp === b.timestamp && rEmail === agentEmailLower) {
      return true;
    }
    // Secondary match: same agentEmail + same ipName + same phone
    if (agentEmailLower && rEmail === agentEmailLower && ipLower && rIp === ipLower && phoneClean && rPhone === phoneClean) {
      return true;
    }
    return false;
  };

  const cleanDocInDb = async (firestoreInstance: any, dateKeyStr: string) => {
    try {
      const docRef = doc(firestoreInstance, "bookings", dateKeyStr);
      const snap = await getDoc(docRef);
      if (!snap.exists()) return 0;

      const rawRecords: BookingRecord[] = snap.data().bookedRecords || [];
      const remainingRecords = rawRecords.filter((r) => !isMatch(r));
      const removedCount = rawRecords.length - remainingRecords.length;

      if (removedCount > 0) {
        const currentSeats = snap.data().seats !== undefined ? snap.data().seats : 20;
        await updateDoc(docRef, {
          seats: Math.min(20, currentSeats + removedCount),
          bookedRecords: remainingRecords,
        });
        return removedCount;
      }
    } catch (err) {
      console.warn(`Error cleaning date ${dateKeyStr}:`, err);
    }
    return 0;
  };

  // 1. Check candidate dates across both databases
  for (const dateStr of Array.from(candidateDates)) {
    for (const dbInst of databases) {
      const removed = await cleanDocInDb(dbInst, dateStr);
      totalRemovedCount += removed;
    }
  }

  // 2. Fallback: Full scan of all date documents if candidate dates didn't catch it
  if (totalRemovedCount === 0) {
    for (const dbInst of databases) {
      try {
        const allDocsSnap = await getDocs(collection(dbInst, "bookings"));
        for (const docSnap of allDocsSnap.docs) {
          const rawRecords: BookingRecord[] = docSnap.data().bookedRecords || [];
          const remainingRecords = rawRecords.filter((r) => !isMatch(r));
          const removedCount = rawRecords.length - remainingRecords.length;

          if (removedCount > 0) {
            const currentSeats = docSnap.data().seats !== undefined ? docSnap.data().seats : 20;
            await updateDoc(docSnap.ref, {
              seats: Math.min(20, currentSeats + removedCount),
              bookedRecords: remainingRecords,
            });
            totalRemovedCount += removedCount;
          }
        }
      } catch (err) {
        console.warn("Error scanning bookings collection:", err);
      }
    }
  }

  // 3. Clean up related rescheduleLogs from BOTH databases
  for (const dbInst of databases) {
    try {
      if (agentEmailLower) {
        const logsSnap = await getDocs(
          query(collection(dbInst, "rescheduleLogs"), where("seatOwner", "==", agentEmailLower))
        );
        logsSnap.forEach((lDoc) => {
          const l = lDoc.data();
          const logIp = (l.ipName || "").toLowerCase().trim();
          const logPhone = (l.phone || "").trim();
          const matchesIpOrPhone = (ipLower && logIp === ipLower) || (phoneClean && logPhone === phoneClean);
          const matchesDate = candidateDates.has(l.newDate) || candidateDates.has(l.originalDate);

          if (matchesIpOrPhone || matchesDate) {
            deleteDoc(doc(dbInst, "rescheduleLogs", lDoc.id)).catch(() => {});
          }
        });
      }
    } catch (e) {
      console.warn("Error deleting rescheduleLogs:", e);
    }
  }

  return totalRemovedCount;
}

