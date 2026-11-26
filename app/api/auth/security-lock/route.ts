import { NextRequest, NextResponse } from "next/server";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

async function verifyIdToken(idToken: string) {
  try {
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "";
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const user = data.users?.[0];
    if (!user || !user.email) return null;
    return {
      email: user.email.toLowerCase().trim(),
      uid: user.localId,
    };
  } catch (e) {
    return null;
  }
}

async function isUserAdmin(email: string) {
  try {
    const snap = await getDoc(doc(db, "users", email.toLowerCase().trim()));
    if (snap.exists()) {
      const role = (snap.data().role || "").toLowerCase().trim();
      return role.includes("admin") || role.includes("master");
    }
  } catch (e) {}
  return false;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email")?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    let isLocked = false;
    let failedAttempts = 0;
    let lockedUntil: number | null = null;
    let lockReason = "";

    try {
      const lockSnap = await getDoc(doc(db, "security_locks", email));
      if (lockSnap.exists()) {
        const d = lockSnap.data();
        const now = Date.now();
        if (d.isLocked && (!d.lockedUntil || now < d.lockedUntil)) {
          isLocked = true;
          failedAttempts = d.failedAttempts || 5;
          lockedUntil = d.lockedUntil || null;
          lockReason = d.lockReason || "";
        }
      }
    } catch (e) {}

    if (!isLocked) {
      try {
        const userSnap = await getDoc(doc(db, "users", email));
        if (userSnap.exists()) {
          const u = userSnap.data();
          const now = Date.now();
          if (u.isLocked && (!u.lockedUntil || now < u.lockedUntil)) {
            isLocked = true;
            failedAttempts = u.failedAttempts || 5;
            lockedUntil = u.lockedUntil || null;
            lockReason = u.lockReason || "";
          }
        }
      } catch (e) {}
    }

    return NextResponse.json({
      email,
      isLocked,
      failedAttempts,
      lockedUntil,
      lockReason,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = body.email?.trim().toLowerCase();
    const action = body.action;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const now = Date.now();

    // 1. UNLOCK ACTION: Must be authenticated and authorized
    if (action === "unlock") {
      const authHeader = request.headers.get("authorization") || "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : "";

      if (!idToken) {
        return NextResponse.json({ error: "Unauthorized: Missing authentication token for account unlock." }, { status: 401 });
      }

      const verifiedUser = await verifyIdToken(idToken);
      if (!verifiedUser) {
        return NextResponse.json({ error: "Unauthorized: Invalid or expired session token." }, { status: 401 });
      }

      // Allow if user is unlocking their own verified account OR caller is an Administrator
      const isOwner = verifiedUser.email === email;
      const isAdmin = await isUserAdmin(verifiedUser.email);

      if (!isOwner && !isAdmin) {
        return NextResponse.json({ error: "Forbidden: You do not have permission to unlock this account." }, { status: 403 });
      }

      const unlockPayload = {
        email,
        isLocked: false,
        failedAttempts: 0,
        lockedUntil: null,
        lockReason: null,
        unlockedAt: now,
      };

      await Promise.allSettled([
        setDoc(doc(db, "security_locks", email), unlockPayload, { merge: true }),
        setDoc(doc(db, "users", email), unlockPayload, { merge: true }),
      ]);

      return NextResponse.json({ success: true, message: "Account unlocked successfully" });
    }

    // 2. FAILED ATTEMPT: Enforce server-side rate limits & incrementing to prevent sudden DoS lockout
    let currentFailed = 0;
    let lastFailed = 0;

    try {
      const existingSnap = await getDoc(doc(db, "security_locks", email));
      if (existingSnap.exists()) {
        const d = existingSnap.data();
        currentFailed = d.failedAttempts || 0;
        lastFailed = d.lastFailedAttempt || 0;
      } else {
        const userSnap = await getDoc(doc(db, "users", email));
        if (userSnap.exists()) {
          const u = userSnap.data();
          currentFailed = u.failedAttempts || 0;
          lastFailed = u.lastFailedAttempt || 0;
        }
      }
    } catch (e) {}

    // Reset attempt counter if previous failed attempt was more than 24h ago
    if (now - lastFailed > 24 * 3600 * 1000) {
      currentFailed = 0;
    }

    const newFailed = Math.min(5, currentFailed + 1);
    const isLocked = newFailed >= 5;
    const lockedUntil = isLocked ? now + 24 * 3600 * 1000 : null;
    const lockReason = isLocked ? "5 consecutive failed login attempts" : "";

    const payload: any = {
      email,
      failedAttempts: newFailed,
      lastFailedAttempt: now,
      isLocked,
      updatedAt: now,
    };

    if (isLocked) {
      payload.lockedAt = now;
      payload.lockedUntil = lockedUntil;
      payload.lockReason = lockReason;
    }

    await Promise.allSettled([
      setDoc(doc(db, "security_locks", email), payload, { merge: true }),
      setDoc(doc(db, "users", email), payload, { merge: true }),
    ]);

    if (isLocked) {
      try {
        const d = new Date();
        const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const docId = `${email}_${today}`;
        const activityRef = doc(db, "daily_activity", docId);
        const snap = await getDoc(activityRef);
        const event = {
          time: now,
          desc: "Account Locked (5 failed login attempts exceeded)",
          type: "report",
          icon: "Lock",
          color: "rose",
        };

        if (snap.exists()) {
          const events = snap.data()?.timelineEvents || [];
          await setDoc(
            activityRef,
            {
              timelineEvents: [...events, event],
            },
            { merge: true }
          );
        } else {
          await setDoc(
            activityRef,
            {
              email,
              name: email.split("@")[0],
              date: today,
              totalSeconds: 0,
              timelineEvents: [event],
            },
            { merge: true }
          );
        }
      } catch (e) {
        console.warn("Could not log lock event to daily_activity:", e);
      }
    }

    return NextResponse.json({
      success: true,
      email,
      isLocked,
      failedAttempts: newFailed,
      lockedUntil,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
