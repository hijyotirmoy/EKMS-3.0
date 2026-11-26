import { NextResponse } from "next/server";
import { getFirestoreContext } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// In-memory fallback availability map
let serverAvailabilityMap = {};
let isLoadedFromDb = false;

async function loadFromDbIfNeeded() {
  if (isLoadedFromDb) return;
  try {
    const ctx = await getFirestoreContext();
    if (ctx) {
      if (ctx.type === "admin") {
        const snap = await ctx.db.collection("system_meta").doc("facility_availability").get();
        if (snap.exists) {
          serverAvailabilityMap = snap.data()?.availability || {};
          isLoadedFromDb = true;
          return;
        }
      } else {
        const { doc, getDoc } = await import("firebase/firestore");
        const snap = await getDoc(doc(ctx.db, "system_meta", "facility_availability"));
        if (snap.exists()) {
          serverAvailabilityMap = snap.data()?.availability || {};
          isLoadedFromDb = true;
          return;
        }
      }
    }
  } catch (e) {
    console.warn("Could not load facility availability from Firestore:", e.message);
  }
  isLoadedFromDb = true;
}

export async function GET() {
  await loadFromDbIfNeeded();
  return NextResponse.json({
    success: true,
    availability: serverAvailabilityMap,
    updatedAt: Date.now(),
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const map = body?.availability || body || {};
    serverAvailabilityMap = { ...serverAvailabilityMap, ...map };
    isLoadedFromDb = true;

    // Persist to Firestore
    try {
      const ctx = await getFirestoreContext();
      if (ctx) {
        if (ctx.type === "admin") {
          await ctx.db.collection("system_meta").doc("facility_availability").set(
            { availability: serverAvailabilityMap, updatedAt: Date.now() },
            { merge: true }
          );
        } else {
          const { doc, setDoc } = await import("firebase/firestore");
          await setDoc(
            doc(ctx.db, "system_meta", "facility_availability"),
            { availability: serverAvailabilityMap, updatedAt: Date.now() },
            { merge: true }
          );
        }
      }
    } catch (e) {
      console.warn("Failed to persist facility availability to Firestore:", e.message);
    }

    return NextResponse.json({
      success: true,
      availability: serverAvailabilityMap,
      message: "Facility availability updated globally across all users",
    });
  } catch (err) {
    return NextResponse.json(
      { detail: `Failed to update facility availability: ${err.message}` },
      { status: 500 }
    );
  }
}
