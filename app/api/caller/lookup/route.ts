import { NextResponse } from "next/server";
import { bookingDb } from "@/lib/firebase";
import { collection, query, where, getDocs, limit, orderBy } from "firebase/firestore";
import { getCallerIdForPhone } from "@/lib/callerId";

function normalizePhone(p: string) {
  if (!p) return "";
  const digits = String(p).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function cleanNameOrField(val: any) {
  if (!val) return "";
  const trimmed = String(val).trim();
  if (
    trimmed === "." ||
    trimmed === "," ||
    trimmed === ";" ||
    trimmed === "'" ||
    trimmed === '"' ||
    trimmed === "-" ||
    trimmed === "--" ||
    trimmed.toLowerCase() === "n/a" ||
    trimmed.toLowerCase() === "null" ||
    trimmed.toLowerCase() === "undefined"
  ) {
    return "";
  }
  return trimmed;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, x-consumer",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawPhone = searchParams.get("phone") || "";
  const queryPhone = normalizePhone(rawPhone);

  if (!queryPhone || queryPhone.length !== 10) {
    return NextResponse.json(
      { found: false, detail: "Phone number must be at least 10 digits" },
      { headers: CORS_HEADERS }
    );
  }

  try {
    const q = query(
      collection(bookingDb, "dispensary_appointments"),
      orderBy("createdAt", "desc"),
      limit(200)
    );
    const snap = await getDocs(q);

    const matches: any[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const phoneDigits = String(data.phone || "").replace(/\D/g, "");
      if (phoneDigits.endsWith(queryPhone)) {
        matches.push({ id: docSnap.id, ...data });
      }
    });

    const standardCid = queryPhone ? getCallerIdForPhone(queryPhone) : "";

    if (matches.length === 0) {
      return NextResponse.json(
        {
          found: false,
          phone: queryPhone,
          caller_id: standardCid,
          caller_name: "",
          ip_number: "",
          age: null,
          sex: "",
          history: [],
        },
        { headers: CORS_HEADERS }
      );
    }

    const latest = matches[0];
    const cleanName = cleanNameOrField(latest.ipName || latest.caller_name || "");
    const cleanIp = (latest.ipNumber || latest.ip_number || "").replace(/\D/g, "");

    const history = matches.map((m, i) => {
      const histCid = (m.callerId && /^CID\d{4}[A-Z]\d{3}$/i.test(m.callerId)) ? m.callerId : standardCid;
      return {
        id: m.id || `hist_${i}`,
        case_ref: m.tokenNo || m.referenceNo || `APPT-${i}`,
        caller_id: histCid,
        created_at: m.createdAt ? new Date(m.createdAt).toISOString() : m.date || "",
        caller_name: m.ipName || cleanName,
        call_type: m.isNonClinical ? "non_clinical" : "clinical",
        isNonClinical: Boolean(m.isNonClinical),
        chief_complaint: m.chiefComplaint || m.purpose || "Dispensary Consultation",
        summary: m.clinicalSummary || m.doctorNotes || m.purpose || "",
        urgency_level: "Routine",
        urgency_score: 2,
        navigation: `Appointment at ${m.dispensaryName || "Dispensary"} on ${m.date || ""} (${m.timeSlot || ""})`,
        recommended_action: `Consultation at ${m.dispensaryName || "Dispensary"}`,
        recommended_facility_type: m.dispensaryName || "Dispensary",
        has_appointment: true,
        tokenNo: m.tokenNo || m.referenceNo,
        status: m.status || "scheduled",
      };
    });

    const finalCallerId = (latest.callerId && /^CID\d{4}[A-Z]\d{3}$/i.test(latest.callerId)) ? latest.callerId : standardCid;

    return NextResponse.json(
      {
        found: true,
        phone: queryPhone,
        caller_id: finalCallerId,
        caller_name: cleanName,
        ip_number: cleanIp.length > 4 ? cleanIp : "",
        age: latest.age ? Number(latest.age) : null,
        sex: latest.gender || latest.sex || "",
        district: latest.district || "",
        city: latest.location || "",
        history,
      },
      { headers: CORS_HEADERS }
    );
  } catch (err: any) {
    console.error("Caller lookup error:", err);
    return NextResponse.json(
      { found: false, error: err?.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
