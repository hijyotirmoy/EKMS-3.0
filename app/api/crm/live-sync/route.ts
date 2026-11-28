import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Targeted In-Memory Store for Dhwani CRM live sync
// Maps target key -> { beneficiary, timestamp }
// Keys:
// - `client:<clientId>` (Private per-browser pair)
// - `agent:<agentId/email>` (Private per-agent pair)
// - `crm:<crmUser>` (Dhwani CRM user pairing)
// - `anonymous:recent` (Fallback for legacy un-tagged bookmarklets, short TTL)
const targetedSyncStore = new Map();

function cleanupStaleRecords() {
  const now = Date.now();
  for (const [key, value] of Array.from(targetedSyncStore.entries())) {
    const maxAge = 5 * 60 * 1000; // 5 minutes TTL
    if (now - ((value as any)?.timestamp || 0) > maxAge) {
      targetedSyncStore.delete(key);
    }
  }
}

const ASSAM_DISTRICTS = [
  "Baksa",
  "Barpeta",
  "Bongaigaon",
  "Cachar",
  "Charaideo",
  "Chirang",
  "Darrang",
  "Dhemaji",
  "Dhubri",
  "Dibrugarh",
  "Dima Hasao",
  "Goalpara",
  "Golaghat",
  "Hailakandi",
  "Hojai",
  "Jorhat",
  "Kamrup Metro",
  "Kamrup Rural",
  "Karbi Anglong",
  "Karimganj",
  "Kokrajhar",
  "Lakhimpur",
  "Majuli",
  "Marigaon",
  "Nagaon",
  "Nalbari",
  "Sivasagar",
  "Sonitpur",
  "Tinsukia",
  "Udalguri",
];

function extractAssamDistrict(rawDistrict: any) {
  if (!rawDistrict) return "";
  const cleaned = String(rawDistrict).trim();
  if (!cleaned || /select/i.test(cleaned) || /^n\/?a$/i.test(cleaned)) return "";

  const exact = ASSAM_DISTRICTS.find((d) => d.toLowerCase() === cleaned.toLowerCase());
  if (exact) return exact;

  const lower = cleaned.toLowerCase();
  if (lower.includes("metro") || lower.includes("guwahati") || lower === "kamrup m" || lower === "kamrup (m)") {
    return "Kamrup Metro";
  }
  if (lower.includes("rural") || lower === "kamrup r" || lower === "kamrup (r)") {
    return "Kamrup Rural";
  }

  // Extract from first 4 letters, then first 3 letters
  const prefix4 = lower.slice(0, 4);
  const prefix3 = lower.slice(0, 3);

  if (prefix4.length >= 4) {
    const match4 = ASSAM_DISTRICTS.find((d) => d.toLowerCase().startsWith(prefix4));
    if (match4) return match4;
  }

  if (prefix3.length >= 3) {
    const match3 = ASSAM_DISTRICTS.find((d) => d.toLowerCase().startsWith(prefix3));
    if (match3) return match3;
  }

  const containsMatch = ASSAM_DISTRICTS.find((d) => lower.includes(d.toLowerCase()) || d.toLowerCase().includes(lower));
  if (containsMatch) return containsMatch;

  return cleaned;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Allow-Private-Network": "true",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const since = Number(searchParams.get("since") || 0);
  const clientId = (searchParams.get("client_id") || "").trim();
  const agentId = (searchParams.get("agent_id") || "").trim().toLowerCase();
  const crmUser = (searchParams.get("crm_user") || "").trim().toLowerCase();
  const agentEmail = (searchParams.get("agent_email") || (agentId.includes("@") ? agentId : "")).trim().toLowerCase();
  const username = (searchParams.get("username") || (agentEmail ? agentEmail.split("@")[0] : agentId)).trim().toLowerCase();

  cleanupStaleRecords();

  const candidateKeys = [
    clientId ? `client:${clientId}` : null,
    agentId ? `agent:${agentId}` : null,
    agentEmail ? `agent:${agentEmail}` : null,
    username ? `agent:${username}` : null,
    crmUser ? `crm:${crmUser}` : null,
    agentEmail ? `crm:${agentEmail}` : null,
    username ? `crm:${username}` : null,
  ].filter(Boolean);

  let matchedEntry = null;

  for (const key of candidateKeys) {
    if (targetedSyncStore.has(key)) {
      const entry = targetedSyncStore.get(key);
      if (entry && entry.timestamp > since) {
        matchedEntry = entry;
        break;
      }
    }
  }

  // Strictly ONLY return if there is an explicit match for THIS client/agent:
  if (matchedEntry && matchedEntry.timestamp > since) {
    // Delete all keys referencing this entry so it can NEVER bleed to another agent or browser!
    for (const [k, v] of Array.from(targetedSyncStore.entries())) {
      if (
        v === matchedEntry ||
        ((v as any)?.timestamp === matchedEntry.timestamp && (v as any)?.beneficiary?.beneficiary_id === matchedEntry?.beneficiary?.beneficiary_id)
      ) {
        targetedSyncStore.delete(k);
      }
    }

    return NextResponse.json(
      {
        hasUpdate: true,
        beneficiary: matchedEntry.beneficiary,
        timestamp: matchedEntry.timestamp,
      },
      { headers: corsHeaders }
    );
  }

  return NextResponse.json(
    {
      hasUpdate: false,
      timestamp: Date.now(),
    },
    { headers: corsHeaders }
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const cleanDigits = (str: any) => String(str || "").replace(/\D/g, "");
    const cleanText = (str: any) => String(str || "").trim();

    // Extract and sanitize fields
    const rawPhone = cleanDigits(body.phone || body.phoneNumber || body.contact_no || "");
    const phone = rawPhone.length >= 10 ? rawPhone.slice(-10) : rawPhone;

    let callerName = cleanText(
      body.caller_name ||
      body.name ||
      body.first_name ||
      [body.firstName, body.lastName].filter(Boolean).join(" ")
    );
    callerName = callerName
      .replace(/\s+Last\s+Nam(?:e)?$/i, "")
      .replace(/\s+Enter\s+last\s+name$/i, "")
      .trim();

    const rawIp = cleanDigits(body.ip_number || body.ipNumber || body.ip || body.esic_no || "");
    const ipNumber = (rawIp.length > 4 && parseInt(rawIp, 10) > 0) ? rawIp : "";

    const rawAge = cleanDigits(body.age || "");
    const ageNum = parseInt(rawAge, 10);
    const age = (!isNaN(ageNum) && ageNum > 0) ? String(ageNum) : "";
    const sex = cleanText(body.sex || body.gender || "");
    // Exact District from Dhwani CRM without changing or filtering
    const district = cleanText(body.district || "").replace(/^(select|null|none|n\/?a)$/i, "");
    const beneficiaryId = cleanText(body.beneficiary_id || body.beneficiaryId || body.id || "");

    const clientId = cleanText(body.client_id || "");
    const agentId = cleanText(body.agent_id || "").toLowerCase();
    const crmUser = cleanText(body.crm_user || "").toLowerCase();

    const newBeneficiary = {
      caller_name: callerName,
      phone,
      age,
      sex: sex ? (sex.toLowerCase().startsWith("m") ? "Male" : sex.toLowerCase().startsWith("f") ? "Female" : "Other") : "",
      district,
      ip_number: ipNumber,
      beneficiary_id: beneficiaryId,
      source: "dhwani_crm",
      synced_at: new Date().toISOString(),
      client_id: clientId,
      agent_id: agentId,
      crm_user: crmUser,
    };

    const timestamp = Date.now();
    cleanupStaleRecords();

    // Save strictly for the targeted recipient (never in global or anonymous keys!)
    const targetKeys = new Set();
    if (clientId) targetKeys.add(`client:${clientId}`);
    if (agentId) {
      targetKeys.add(`agent:${agentId}`);
      if (agentId.includes("@")) {
        targetKeys.add(`agent:${agentId.split("@")[0]}`);
      }
    }
    if (crmUser) {
      targetKeys.add(`crm:${crmUser}`);
      if (crmUser.includes("@")) {
        targetKeys.add(`crm:${crmUser.split("@")[0]}`);
        targetKeys.add(`agent:${crmUser}`);
        targetKeys.add(`agent:${crmUser.split("@")[0]}`);
      }
    }

    for (const key of Array.from(targetKeys)) {
      targetedSyncStore.set(key, { beneficiary: newBeneficiary, timestamp });
    }

    return NextResponse.json(
      {
        success: true,
        message: "Active CRM beneficiary synchronized privately to paired agent/browser",
        beneficiary: newBeneficiary,
        timestamp,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to process CRM sync payload" },
      { status: 400, headers: corsHeaders }
    );
  }
}

