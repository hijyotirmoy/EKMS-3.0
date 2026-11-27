import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { collection, doc, getDoc, getDocs, setDoc, query, orderBy, limit as firestoreLimit, updateDoc, deleteDoc, deleteField, where } from "firebase/firestore";
import { bookingDb } from "@/lib/firebase";
import { validateApiKey, corsHeaders } from "@/lib/apiKeyAuth";
import { createDispensaryNotification } from "@/lib/notificationService";
import { extractIpNumber } from "@/lib/appointmentTypes";
import { areFacilitiesMatching, areSlotsMatching } from "@/lib/slotTiming";

export const dynamic = "force-dynamic";

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
  const clientIp = getClientIp(request);
  const rateLimitResult = checkRateLimit(`appt_get_${clientIp}`, { limit: 200, windowMs: 60000 });
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Rate limit exceeded." },
      { status: 429, headers: corsHeaders() }
    );
  }

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

      // Strictly ignore obsolete ESIC-* and Anonymous Beneficiary duplicates
      const tok = String(data.tokenNo || d.id || "").trim();
      const pName = String(data.patientName || data.ipName || "").trim().toLowerCase();
      if (tok.startsWith("ESIC-") || pName.includes("anonymous")) {
        return;
      }
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
  const clientIp = getClientIp(request);
  const rateLimitResult = checkRateLimit(`appt_post_${clientIp}`, { limit: 100, windowMs: 60000 });
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Rate limit exceeded." },
      { status: 429, headers: corsHeaders() }
    );
  }

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

    const ipNumber = extractIpNumber(body);

    // Double-booking check: prevent duplicate bookings for the same facility, date, and slot
    if (!body._skipSlotCheck && bookingDb) {
      try {
        const slotCheckSnap = await getDocs(
          query(collection(bookingDb, "dispensary_appointments"), where("date", "==", appointmentDate))
        );
        const slotConflict = slotCheckSnap.docs.find((d) => {
          const data = d.data();
          if (data.status === "cancelled") return false;
          if (data.id === docId || data.tokenNo === tokenNo || data.referenceNo === referenceNo) return false;
          const fac = data.dispensaryName || data.facilityName || "";
          return areFacilitiesMatching(fac, dispensaryName) && areSlotsMatching(data.timeSlot, body.timeSlot || "10:00 AM - 11:00 AM");
        });
        if (slotConflict) {
          return NextResponse.json(
            {
              success: false,
              error: `Slot ${body.timeSlot || "10:00 AM - 11:00 AM"} is already booked and locked for ${dispensaryName} on ${appointmentDate}.`,
            },
            { status: 409, headers: corsHeaders() }
          );
        }
      } catch (e) {
        console.warn("Slot conflict check error:", (e as any)?.message);
      }
    }

    const appointmentPayload = {
      id: docId,
      tokenNo,
      referenceNo,
      ipName: patientName,
      patientName,
      ipNumber,
      ipNo: ipNumber,
      esicNumber: ipNumber,
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
      bookedByEmail: body.bookedByEmail || ((authRes.keyDoc as any)?.email || ""),
      bookedByName: body.bookedByName || authRes.keyDoc?.name || "Authorized Agent",
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
      case_ref: body.case_ref || body.caseId || null,
      caseId: body.caseId || body.case_ref || null,
    };

    // Save in Firestore dispensary_appointments with collision and status progression protection
    let targetDocId = docId;
    let targetRef = doc(bookingDb, "dispensary_appointments", targetDocId);
    try {
      const existingSnap = await getDoc(targetRef);
      if (existingSnap.exists()) {
        const existingData = existingSnap.data();
        const existingPhone = String(existingData.phone || existingData.patientPhone || "").replace(/\D/g, "");
        const incomingPhone = String(phone).replace(/\D/g, "");
        const isDifferentPatient = Boolean(
          existingPhone && incomingPhone && existingPhone.length >= 10 && incomingPhone.length >= 10 && existingPhone !== incomingPhone
        );

        if (isDifferentPatient) {
          // Collision: Do NOT overwrite the existing patient!
          // Re-allocate to a new unique token
          const fallbackSeq = Math.max(163, Math.floor(Date.now() % 100000));
          const newToken = `ESIC-${String(fallbackSeq).padStart(5, "0")}-${suffix}`;
          targetDocId = newToken.replace(/[^a-zA-Z0-9_-]/g, "_");
          targetRef = doc(bookingDb, "dispensary_appointments", targetDocId);
          appointmentPayload.id = targetDocId;
          appointmentPayload.tokenNo = newToken;
          appointmentPayload.referenceNo = newToken;
        } else {
          // Same patient: Protect existing clinical stage if current payload has no explicit updated status
          if (existingData.status && existingData.status !== "scheduled" && (!body.status || body.status === "scheduled")) {
            delete (appointmentPayload as any).status;
          }
          if (existingData.receptionCheckedInAt && !(appointmentPayload as any).receptionCheckedInAt) {
            delete (appointmentPayload as any).receptionCheckedInAt;
            delete (appointmentPayload as any).receptionCheckedInBy;
          }
          if (existingData.doctorName && !(appointmentPayload as any).doctorName) {
            delete (appointmentPayload as any).doctorName;
            delete (appointmentPayload as any).doctorConsultedAt;
            delete (appointmentPayload as any).prescribedBy;
          }
          if (existingData.dispensedAt && !(appointmentPayload as any).dispensedAt) {
            delete (appointmentPayload as any).dispensedAt;
            delete (appointmentPayload as any).dispensedBy;
          }
        }
      }
    } catch (_) {}
    await setDoc(targetRef, appointmentPayload, { merge: true });

    // Real-time notification delivered to the Receptionist of that dispensary
    await createDispensaryNotification({
      targetDispensary: dispensaryName,
      targetDispensaryRole: "Receptionist",
      title: "New OPD Appointment Booked",
      message: `Patient ${patientName} (${tokenNo}) booked for ${appointmentDate} at ${dispensaryName}.`,
      link: "/dispensary/reception",
      tokenNo,
    }).catch((e) => console.warn("Failed to dispatch dispensary booking notification:", e));

    // Optional direct sync to Google Sheets ONLY for external API clients
    // (EKMS Triage already executes dedicated deduplicated sync via recordAppointmentBookingToSheet)
    if (!body._skipSheetWebhook && body.source !== "EKMS Triage") {
      try {
        const defaultWebhook =
          "https://script.google.com/macros/s/AKfycbzzk3DPzW9urW_i350_Kq5Sm1rPw9pcha6pEafuTowHH1Vcbl08vRxWX89qnlJgTjQP6w/exec";
        const webhookUrl =
          process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
          process.env.NEXT_PUBLIC_GOOGLE_SHEETS_WEBHOOK_URL ||
          defaultWebhook;
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(6000),
          body: JSON.stringify({
            record_type: "Booking Done",
            case_id: body.case_ref || body.caseId || "",
            booking_ref_id: tokenNo,
            reference_id: tokenNo,
            name: patientName,
            phone_no: phone,
            ip_no: ipNumber,
            date_time: `${appointmentDate} ${appointmentPayload.timeSlot || ""}`.trim(),
            dispensary_name: dispensaryName,
            agent_name: appointmentPayload.bookedByName || "Triage Desk",
            chief_complaint: appointmentPayload.chiefComplaint || appointmentPayload.purpose || "",
            status: "Booking Confirmed",
          }),
        }).catch((e) => console.warn("Google Sheet webhook booking notice:", e.message));
      } catch (_) {}
    }

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

/**
 * PATCH /api/v1/appointments
 * Updates specific appointment fields in Firestore bookingDb
 */
export async function PATCH(request: NextRequest) {
  const authRes = await validateApiKey(request, "appointments:create");
  if (!authRes.valid) {
    return NextResponse.json(
      { success: false, error: authRes.error },
      { status: authRes.status || 401, headers: corsHeaders() }
    );
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || (!body.id && !body.tokenNo)) {
      return NextResponse.json(
        { success: false, error: "Missing required identifier: 'id' or 'tokenNo'" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const docId = body.id || body.tokenNo.replace(/[^a-zA-Z0-9_-]/g, "_");
    const targetRef = doc(bookingDb, "dispensary_appointments", docId);
    const existingSnap = await getDoc(targetRef);

    if (!existingSnap.exists()) {
      return NextResponse.json(
        { success: false, error: `Document ${docId} not found` },
        { status: 404, headers: corsHeaders() }
      );
    }

    const updates = { ...(body.updates || {}) };
    if (body.removeFields && Array.isArray(body.removeFields)) {
      for (const field of body.removeFields) {
        updates[field] = deleteField();
      }
    }

    await updateDoc(targetRef, updates);

    return NextResponse.json(
      { success: true, message: `Document ${docId} updated successfully`, docId },
      { status: 200, headers: corsHeaders() }
    );
  } catch (err: any) {
    console.error("PATCH /api/v1/appointments error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to update appointment: " + err.message },
      { status: 500, headers: corsHeaders() }
    );
  }
}

/**
 * DELETE /api/v1/appointments
 * Removes an appointment by ID from Firestore bookingDb
 */
export async function DELETE(request: NextRequest) {
  const authRes = await validateApiKey(request, "appointments:create");
  if (!authRes.valid) {
    return NextResponse.json(
      { success: false, error: authRes.error },
      { status: authRes.status || 401, headers: corsHeaders() }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Missing required parameter: 'id'" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const targetRef = doc(bookingDb, "dispensary_appointments", id);
    await deleteDoc(targetRef);

    return NextResponse.json(
      { success: true, message: `Document ${id} deleted successfully` },
      { status: 200, headers: corsHeaders() }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500, headers: corsHeaders() }
    );
  }
}
