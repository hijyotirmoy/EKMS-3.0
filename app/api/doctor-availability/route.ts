import { NextRequest, NextResponse } from "next/server";
import { doc, setDoc, deleteDoc, getDocs, collection } from "firebase/firestore";
import { db, bookingDb } from "@/lib/firebase";
import { getTriageBaseUrl } from "@/lib/triageSync";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * GET /api/doctor-availability
 */
export async function GET(request: NextRequest) {
  try {
    const records: any[] = [];
    const seen = new Set<string>();

    for (const dbInstance of [bookingDb, db].filter(Boolean)) {
      try {
        const snap = await getDocs(collection(dbInstance, "doctor_availability"));
        snap.forEach((d) => {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            records.push({ id: d.id, ...d.data() });
          }
        });
      } catch (e: any) {
        if (e?.code !== "permission-denied") {
          console.warn("doctor_availability read warning on instance:", e);
        }
      }
    }

    return NextResponse.json(
      { success: true, records },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch availability records" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * POST /api/doctor-availability
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || !body.date || (!body.doctorId && !body.doctorEmail)) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: doctorId/doctorEmail, date" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const cleanDoctorId = String(body.doctorId || body.doctorEmail).toLowerCase().replace(/[^a-zA-Z0-9_-]/g, "_");
    const docId = body.id || `${cleanDoctorId}_${body.date}`;

    const payload = {
      ...body,
      id: docId,
      updatedAt: Date.now(),
    };

    // Save to bookingDb (primary operational DB for appointments & dispensary)
    try {
      if (bookingDb) {
        await setDoc(doc(bookingDb, "doctor_availability", docId), payload, { merge: true });
      }
    } catch (e) {
      console.warn("bookingDb doctor_availability write note:", e);
    }

    // Also attempt saving to main db
    try {
      if (db) {
        await setDoc(doc(db, "doctor_availability", docId), payload, { merge: true });
      }
    } catch (e) {
      console.warn("main db doctor_availability write note:", e);
    }

    // Forward to Triage API for live cross-system replication
    try {
      const triageUrl = `${getTriageBaseUrl()}/api/doctor-availability`;

      fetch(triageUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch (_) {}

    return NextResponse.json(
      { success: true, message: "Doctor availability saved successfully", record: payload },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to save availability record" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * DELETE /api/doctor-availability?id=...&doctorId=...&date=...
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const doctorId = searchParams.get("doctorId") || searchParams.get("doctorEmail");
    const date = searchParams.get("date");

    const cleanDoctorId = String(doctorId || "").toLowerCase().replace(/[^a-zA-Z0-9_-]/g, "_");
    const docId = id || (doctorId && date ? `${cleanDoctorId}_${date}` : null);

    if (!docId) {
      return NextResponse.json(
        { success: false, error: "Missing doc id or doctorId + date" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    try {
      if (bookingDb) {
        await deleteDoc(doc(bookingDb, "doctor_availability", docId));
      }
    } catch (_) {}

    try {
      if (db) {
        await deleteDoc(doc(db, "doctor_availability", docId));
      }
    } catch (_) {}

    // Forward deletion to Triage API
    try {
      const triageUrl = `${getTriageBaseUrl()}/api/doctor-availability?id=${encodeURIComponent(docId)}`;
      fetch(triageUrl, { method: "DELETE" }).catch(() => {});
    } catch (_) {}

    return NextResponse.json(
      { success: true, message: "Doctor availability record deleted" },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to delete availability record" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
