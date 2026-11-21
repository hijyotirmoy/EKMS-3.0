import { NextRequest, NextResponse } from "next/server";
import { corsHeaders } from "@/lib/apiKeyAuth";
import { getTriageBaseUrl } from "@/lib/triageSync";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawPhone = searchParams.get("phone") || "";
    const cleanPhone = rawPhone.replace(/\D/g, "").slice(-10);

    if (!cleanPhone || cleanPhone.length !== 10) {
      return NextResponse.json(
        { found: false, detail: "Phone number must be at least 10 digits" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const triageBase = getTriageBaseUrl();
    const targetUrl = `${triageBase}/api/caller/lookup?phone=${cleanPhone}`;

    const res = await fetch(targetUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "x-consumer": "ekms-web",
      },
    }).catch(() => null);

    if (!res || !res.ok) {
      return NextResponse.json(
        { found: false, history: [] },
        { status: 200, headers: corsHeaders() }
      );
    }

    const data = await res.json().catch(() => ({ found: false, history: [] }));
    return NextResponse.json(data, { status: 200, headers: corsHeaders() });
  } catch (err: any) {
    console.error("GET /api/triage/caller-lookup error:", err);
    return NextResponse.json(
      { found: false, history: [] },
      { status: 200, headers: corsHeaders() }
    );
  }
}
