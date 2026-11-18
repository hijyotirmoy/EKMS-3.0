import { NextRequest, NextResponse } from "next/server";
import { collection, query, where, getDocs, updateDoc, limit } from "firebase/firestore";
import { bookingDb } from "@/lib/firebase";
import { corsHeaders } from "@/lib/apiKeyAuth";

let latestTriageIpState: {
  ip: string;
  name?: string;
  phone?: string;
  caseRef?: string;
  timestamp: number;
} | null = null;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET() {
  return NextResponse.json(
    {
      success: true,
      data: latestTriageIpState,
    },
    { status: 200, headers: corsHeaders() }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawIp =
      body.ip_number ||
      body.ipNumber ||
      body.ipNo ||
      body.ip_no ||
      body.esicNumber ||
      body.esicNo ||
      body.ip ||
      "";

    const cleanIp = String(rawIp || "").trim();
    const phone = String(body.phone || "").trim();
    const callerName = String(body.caller_name || body.callerName || "").trim();
    const caseRef = String(body.case_ref || body.caseRef || "").trim();

    if (!cleanIp || cleanIp === "N/A" || cleanIp === ".") {
      return NextResponse.json(
        { success: false, error: "Invalid or empty IP number provided." },
        { status: 400, headers: corsHeaders() }
      );
    }

    latestTriageIpState = {
      ip: cleanIp,
      name: callerName,
      phone,
      caseRef,
      timestamp: Date.now(),
    };

    // If phone or caseRef or name is provided, search and update corresponding appointment in Firestore
    let matchedCount = 0;
    try {
      const updates: Promise<any>[] = [];

      // 1. Match by caseRef or token
      if (caseRef) {
        const qToken = query(
          collection(bookingDb, "dispensary_appointments"),
          where("tokenNo", "==", caseRef),
          limit(5)
        );
        const snapToken = await getDocs(qToken);
        snapToken.forEach((d) => {
          matchedCount++;
          updates.push(
            updateDoc(d.ref, {
              ipNumber: cleanIp,
              ipNo: cleanIp,
              esicNumber: cleanIp,
              updatedAt: Date.now(),
            }).catch(() => {})
          );
        });
      }

      // 2. Match by phone (last 10 digits)
      if (phone && phone.replace(/\D/g, "").length >= 10) {
        const cleanPhone = phone.replace(/\D/g, "").slice(-10);
        const snapAll = await getDocs(
          query(collection(bookingDb, "dispensary_appointments"), limit(50))
        );
        snapAll.forEach((d) => {
          const data = d.data();
          const dPhone = String(data.phone || data.patientPhone || "").replace(/\D/g, "").slice(-10);
          if (dPhone && dPhone === cleanPhone) {
            matchedCount++;
            updates.push(
              updateDoc(d.ref, {
                ipNumber: cleanIp,
                ipNo: cleanIp,
                esicNumber: cleanIp,
                updatedAt: Date.now(),
              }).catch(() => {})
            );
          }
        });
      }

      await Promise.all(updates);
    } catch (e) {
      console.warn("Dispensary appointment IP auto-sync warning:", e);
    }

    return NextResponse.json(
      {
        success: true,
        message: "Triage IP captured successfully.",
        ip: cleanIp,
        matchedAppointmentsUpdated: matchedCount,
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (err: any) {
    console.error("POST /api/triage/ip error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error: " + err.message },
      { status: 500, headers: corsHeaders() }
    );
  }
}
