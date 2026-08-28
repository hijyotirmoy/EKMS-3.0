import { NextRequest, NextResponse } from "next/server";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

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

    if (action === "unlock" || body.isLocked === false) {
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

      return NextResponse.json({ success: true, message: "Account unlocked" });
    }

    const failedAttempts = body.failedAttempts || 1;
    const isLocked = body.isLocked ?? failedAttempts >= 5;
    const lockedUntil = body.lockedUntil || (isLocked ? now + 24 * 3600 * 1000 : null);
    const lockReason = body.lockReason || (isLocked ? "5 consecutive failed login attempts" : "");

    const payload: any = {
      email,
      failedAttempts,
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
      failedAttempts,
      lockedUntil,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
