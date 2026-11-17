import { NextRequest, NextResponse } from "next/server";
import { collection, doc, getDocs, setDoc, query, orderBy, limit as firestoreLimit } from "firebase/firestore";
import { bookingDb } from "@/lib/firebase";
import { validateApiKey, corsHeaders } from "@/lib/apiKeyAuth";
import { createDispensaryNotification } from "@/lib/notificationService";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

/**
 * GET /api/v1/appointments
 * Query params: dispensary, status, date, tokenNo, limit
 */
export async function GET(request: NextRequest) {
  const authRes = await validateApiKey(request, "appointments:read");
  if (!authRes.valid) {
    return NextResponse.json(
      { success: false, error: authRes.error },
      { status: authRes.status || 401, headers: corsHeaders() }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const dispensary = searchParams.get("dispensary")?.toLowerCase().trim();
    const status = searchParams.get("status")?.toLowerCase().trim();
    const date = searchParams.get("date")?.trim();
    const tokenNo = searchParams.get("tokenNo")?.toLowerCase().trim();
    const limitNum = Math.min(parseInt(searchParams.get("limit") || "100", 10) || 100, 250);

    const q = query(
      collection(bookingDb, "dispensary_appointments"),
      orderBy("createdAt", "desc"),
      firestoreLimit(limitNum)
    );

    const snapshot = await getDocs(q);
    const appointments: any[] = [];

    snapshot.forEach((d) => {
      const data = d.data();
      const app = { id: d.id, ...data };

      // Filter in memory for maximum flexibility without Firestore composite index constraints
      if (dispensary) {
        const appDisp = (data.dispensaryName || data.facilityName || "").toLowerCase();
        if (!appDisp.includes(dispensary) && !dispensary.includes(appDisp)) {
          return;
        }
      }

      if (status && status !== "all") {
        const appStatus = (data.status || "scheduled").toLowerCase();
        if (status === "visited") {
          if (appStatus !== "visited" && appStatus !== "completed") return;
        } else if (appStatus !== status) {
          return;
        }
      }

      if (date && data.date !== date) {
        return;
      }

      if (tokenNo) {
        const appToken = (data.tokenNo || data.referenceNo || d.id).toLowerCase();
        if (!appToken.includes(tokenNo)) return;
      }

      appointments.push(app);
    });

    return NextResponse.json(
      {
        success: true,
        count: appointments.length,
        consumer: authRes.keyDoc?.name,
        appointments,
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (err: any) {
    console.error("GET /api/v1/appointments error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error: " + err.message },
      { status: 500, headers: corsHeaders() }
    );
  }
}

/**
 * POST /api/v1/appointments
 * Books a new appointment
 */
export async function POST(request: NextRequest) {
  const authRes = await validateApiKey(request, "appointments:create");
  if (!authRes.valid) {
    return NextResponse.json(
      { success: false, error: authRes.error },
      { status: authRes.status || 401, headers: corsHeaders() }
    );
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body provided." },
        { status: 400, headers: corsHeaders() }
      );
    }

    const patientName = (body.patientName || body.ipName || "").trim();
    const phone = (body.phone || body.patientPhone || "").trim();
    const dispensaryName = (body.dispensaryName || body.facilityName || "").trim();
    const appointmentDate = (body.date || "").trim();

    if (!patientName) {
      return NextResponse.json(
        { success: false, error: "Missing required field: patientName" },
        { status: 400, headers: corsHeaders() }
      );
    }
    if (!dispensaryName) {
      return NextResponse.json(
        { success: false, error: "Missing required field: dispensaryName" },
        { status: 400, headers: corsHeaders() }
      );
    }
    if (!appointmentDate) {
      return NextResponse.json(
        { success: false, error: "Missing required field: date (YYYY-MM-DD)" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const isHospital = dispensaryName.toLowerCase().includes("hospital");
    const suffix = isHospital ? "HOSP" : "DISP";
    const tokenNo = body.tokenNo || body.referenceNo || `ESIC-${String(Math.floor(100 + Math.random() * 900)).padStart(5, "0")}-${suffix}`;
    const referenceNo = body.referenceNo || tokenNo;
    const docId = (body.id || referenceNo || tokenNo).replace(/[^a-zA-Z0-9_-]/g, "_");

    const appointmentPayload = {
      id: docId,
      tokenNo,
      referenceNo,
      ipName: patientName,
      patientName,
      ipNumber: (body.ipNumber || body.esicNumber || "N/A").trim(),
      phone: phone || "N/A",
      patientPhone: phone || "N/A",
      age: String(body.age || body.patientAge || "").trim(),
      gender: body.gender || body.patientSex || "Male",
      dispensaryName,
      facilityName: dispensaryName,
      dispensaryId: body.dispensaryId || "",
      district: body.district || body.facilityDistrict || "",
      location: body.location || body.patientAddress || "",
      date: appointmentDate,
      timeSlot: body.timeSlot || "10:00 AM - 11:00 AM",
      department: body.department || "General Medicine / Primary Care OPD",
      purpose: body.purpose || body.chiefComplaint || "General Health Check",
      chiefComplaint: body.chiefComplaint || body.purpose || "",
      notes: body.notes || body.agentNotes || "",
      status: body.status || "scheduled",
      bookedByEmail: body.bookedByEmail || `${authRes.keyDoc?.name?.toLowerCase().replace(/\s+/g, ".") || "api"}@piramalswasthya.org`,
      bookedByName: body.bookedByName || authRes.keyDoc?.name || "API Consumer",
      bookedAt: body.bookedAt || new Date().toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
      createdAt: body.createdAt || Date.now(),
      source: body.source || (authRes.keyDoc?.name ? `API (${authRes.keyDoc.name})` : "REST API"),
      // Clinical Summary Dossier from Triage API
      callerId: body.callerId || body.caller_id || null,
      clinicalSummary: body.clinicalSummary || null,
      clinicalRecord: body.clinicalRecord || body.clinicalOverview || null,
      clinicalOverview: body.clinicalOverview || body.clinicalRecord || null,
      redFlags: Array.isArray(body.redFlags) ? body.redFlags : [],
      past3Calls: Array.isArray(body.past3Calls) ? body.past3Calls : [],
      pastCallHistory: Array.isArray(body.pastCallHistory) ? body.pastCallHistory : [],
      pastCallsCount: body.pastCallsCount || (Array.isArray(body.past3Calls) ? body.past3Calls.length : 0),
      triageLevel: body.triageLevel || null,
      triageScore: body.triageScore ?? null,
    };

    // Save in Firestore dispensary_appointments
    await setDoc(doc(bookingDb, "dispensary_appointments", docId), appointmentPayload, { merge: true });

    // Real-time notification delivered to the Receptionist of that dispensary
    await createDispensaryNotification({
      targetDispensary: dispensaryName,
      targetDispensaryRole: "Receptionist",
      title: "New OPD Appointment Booked",
      message: `Patient ${patientName} (${tokenNo}) booked for ${appointmentDate} at ${dispensaryName}.`,
      link: "/dispensary/reception",
      tokenNo,
    }).catch((e) => console.warn("Failed to dispatch dispensary booking notification:", e));

    return NextResponse.json(
      {
        success: true,
        message: "Appointment successfully scheduled via EKMS API.",
        appointment: appointmentPayload,
      },
      { status: 201, headers: corsHeaders() }
    );
  } catch (err: any) {
    console.error("POST /api/v1/appointments error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error: " + err.message },
      { status: 500, headers: corsHeaders() }
    );
  }
}
