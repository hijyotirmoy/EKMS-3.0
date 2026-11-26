import { NextRequest, NextResponse } from "next/server";
import { doc, getDoc, updateDoc, setDoc, deleteDoc, collection, query, where, getDocs } from "firebase/firestore";
import { bookingDb } from "@/lib/firebase";
import { validateApiKey, corsHeaders } from "@/lib/apiKeyAuth";
import { extractIpNumber } from "@/lib/appointmentTypes";
import { getTriageBaseUrl } from "@/lib/triageSync";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

async function findAppointmentDoc(idOrToken: string) {
  const cleanId = idOrToken.replace(/[^a-zA-Z0-9_-]/g, "_");
  const directRef = doc(bookingDb, "dispensary_appointments", cleanId);
  const directSnap = await getDoc(directRef);
  if (directSnap.exists()) {
    return { ref: directRef, data: { id: directSnap.id, ...directSnap.data() } };
  }

  // Also query by tokenNo or referenceNo if direct docId didn't match
  const qToken = query(collection(bookingDb, "dispensary_appointments"), where("tokenNo", "==", idOrToken));
  const snapToken = await getDocs(qToken);
  if (!snapToken.empty) {
    const d = snapToken.docs[0];
    return { ref: d.ref, data: { id: d.id, ...d.data() } };
  }

  const qRef = query(collection(bookingDb, "dispensary_appointments"), where("referenceNo", "==", idOrToken));
  const snapRef = await getDocs(qRef);
  if (!snapRef.empty) {
    const d = snapRef.docs[0];
    return { ref: d.ref, data: { id: d.id, ...d.data() } };
  }

  return null;
}

/**
 * GET /api/v1/appointments/[id]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authRes = await validateApiKey(request, "appointments:read");
  if (!authRes.valid) {
    return NextResponse.json(
      { success: false, error: authRes.error },
      { status: authRes.status || 401, headers: corsHeaders() }
    );
  }

  try {
    const target = await findAppointmentDoc(params.id);
    if (!target) {
      return NextResponse.json(
        { success: false, error: `Appointment not found for ID/token: ${params.id}` },
        { status: 404, headers: corsHeaders() }
      );
    }

    return NextResponse.json(
      {
        success: true,
        appointment: target.data,
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (err: any) {
    console.error("GET /api/v1/appointments/[id] error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error: " + err.message },
      { status: 500, headers: corsHeaders() }
    );
  }
}

/**
 * PATCH /api/v1/appointments/[id]
 * Updates status, notes, cancellationReason, or vitals
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authRes = await validateApiKey(request, "appointments:update");
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
        { success: false, error: "Invalid JSON update payload provided." },
        { status: 400, headers: corsHeaders() }
      );
    }

    const target = await findAppointmentDoc(params.id);
    if (!target) {
      // If not found by doc id, create or upsert with the given id
      const cleanId = params.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      const ref = doc(bookingDb, "dispensary_appointments", cleanId);
      const updateData = {
        ...body,
        updatedAt: Date.now(),
        updatedBy: authRes.keyDoc?.name || "API",
      };
      await setDoc(ref, updateData, { merge: true });
      return NextResponse.json(
        { success: true, message: "Appointment updated successfully", appointment: updateData },
        { status: 200, headers: corsHeaders() }
      );
    }

    const updatePayload: Record<string, any> = {
      updatedAt: Date.now(),
      updatedBy: authRes.keyDoc?.name || "API",
    };

    if (body.status !== undefined) updatePayload.status = body.status;
    const ipVal = extractIpNumber(body);
    if (ipVal !== "N/A" || body.ipNumber !== undefined || body.ipNo !== undefined || body.esicNumber !== undefined) {
      const finalIp = ipVal !== "N/A" ? ipVal : (body.ipNumber || body.ipNo || body.esicNumber || "N/A");
      updatePayload.ipNumber = finalIp;
      updatePayload.ipNo = finalIp;
      updatePayload.esicNumber = finalIp;
    }
    if (body.cancellationReason !== undefined) {
      const cr = String(body.cancellationReason);
      updatePayload.cancellationReason = cr
        .replace(/cancelled in ekms triage/gi, "Cancelled in Source")
        .replace(/cancelled via triage/gi, "Cancelled in Source")
        .replace(/ekms triage/gi, "Source")
        .replace(/triage/gi, "Source");
    }
    if (body.cancelledAt !== undefined) updatePayload.cancelledAt = body.cancelledAt;
    if (body.completedAt !== undefined) updatePayload.completedAt = body.completedAt;
    if (body.completedBy !== undefined) updatePayload.completedBy = body.completedBy;
    if (body.visitedNotes !== undefined) updatePayload.visitedNotes = body.visitedNotes;
    if (body.visitedAt !== undefined) updatePayload.visitedAt = body.visitedAt;
    if (body.visitedBy !== undefined) updatePayload.visitedBy = body.visitedBy;
    if (body.vitals !== undefined) updatePayload.vitals = body.vitals;
    if (body.notes !== undefined) updatePayload.notes = body.notes;
    if (body.timeSlot !== undefined) updatePayload.timeSlot = body.timeSlot;
    if (body.date !== undefined) updatePayload.date = body.date;
    if (body.receptionCheckedInAt !== undefined) updatePayload.receptionCheckedInAt = body.receptionCheckedInAt;
    if (body.receptionCheckedInBy !== undefined) updatePayload.receptionCheckedInBy = body.receptionCheckedInBy;
    if (body.doctorConsultedAt !== undefined) updatePayload.doctorConsultedAt = body.doctorConsultedAt;
    if (body.doctorName !== undefined) updatePayload.doctorName = body.doctorName;
    if (body.doctorEmail !== undefined) updatePayload.doctorEmail = body.doctorEmail;
    if (body.consultationType !== undefined) updatePayload.consultationType = body.consultationType;
    if (body.diagnosis !== undefined) updatePayload.diagnosis = body.diagnosis;
    if (body.prescriptions !== undefined) updatePayload.prescriptions = body.prescriptions;
    if (body.doctorNotes !== undefined) updatePayload.doctorNotes = body.doctorNotes;
    if (body.dispensedAt !== undefined) updatePayload.dispensedAt = body.dispensedAt;
    if (body.dispensedBy !== undefined) updatePayload.dispensedBy = body.dispensedBy;
    if (body.dispensationNotes !== undefined) updatePayload.dispensationNotes = body.dispensationNotes;
    if (body.clinicalSummary !== undefined) updatePayload.clinicalSummary = body.clinicalSummary;
    if (body.clinicalRecord !== undefined) updatePayload.clinicalRecord = body.clinicalRecord;
    if (body.enquiryType !== undefined) updatePayload.enquiryType = body.enquiryType;
    if (body.chiefIssue !== undefined) updatePayload.chiefIssue = body.chiefIssue;
    if (body.remarks !== undefined) updatePayload.remarks = body.remarks;
    if (body.callType !== undefined) updatePayload.callType = body.callType;
    if (body.isNonClinical !== undefined) updatePayload.isNonClinical = body.isNonClinical;
    if (body.purpose !== undefined) updatePayload.purpose = body.purpose;
    if (body.chiefComplaint !== undefined) updatePayload.chiefComplaint = body.chiefComplaint;
    if (body.appointmentType !== undefined) updatePayload.appointmentType = body.appointmentType;
    if (body.redFlags !== undefined) updatePayload.redFlags = body.redFlags;
    if (body.past3Calls !== undefined) updatePayload.past3Calls = body.past3Calls;

    await updateDoc(target.ref, updatePayload);

    return NextResponse.json(
      {
        success: true,
        message: "Appointment successfully updated.",
        appointment: { ...target.data, ...updatePayload },
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (err: any) {
    console.error("PATCH /api/v1/appointments/[id] error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error: " + err.message },
      { status: 500, headers: corsHeaders() }
    );
  }
}

/**
 * DELETE /api/v1/appointments/[id]
 * Cancels or removes appointment
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authRes = await validateApiKey(request, "appointments:delete");
  if (!authRes.valid) {
    return NextResponse.json(
      { success: false, error: authRes.error },
      { status: authRes.status || 401, headers: corsHeaders() }
    );
  }

  try {
    const target = await findAppointmentDoc(params.id);
    if (!target) {
      return NextResponse.json(
        { success: false, error: `Appointment not found for ID/token: ${params.id}` },
        { status: 404, headers: corsHeaders() }
      );
    }

    const { searchParams } = new URL(request.url);
    const isHardDelete = searchParams.get("hard") === "true" || searchParams.get("purge") === "true";

    if (isHardDelete) {
      // Hard delete from EKMS Firestore
      await deleteDoc(target.ref);

      // Also delete from Triage database via API
      try {
        const triageUrl = getTriageBaseUrl();
        await fetch(`${triageUrl}/api/appointments/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: params.id,
            tokenNo: (target.data as any)?.tokenNo,
            referenceNo: (target.data as any)?.referenceNo,
          }),
        });
      } catch (e) {}

      return NextResponse.json(
        {
          success: true,
          message: "Appointment permanently deleted from all databases.",
        },
        { status: 200, headers: corsHeaders() }
      );
    }

    // Mark as cancelled rather than hard deleting to maintain audit history
    await updateDoc(target.ref, {
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      cancellationReason: "Cancelled via EKMS Developer API",
      updatedBy: authRes.keyDoc?.name || "API",
      updatedAt: Date.now(),
    });

    return NextResponse.json(
      {
        success: true,
        message: "Appointment cancelled successfully.",
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (err: any) {
    console.error("DELETE /api/v1/appointments/[id] error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error: " + err.message },
      { status: 500, headers: corsHeaders() }
    );
  }
}
