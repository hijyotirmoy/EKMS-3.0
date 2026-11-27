import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getActiveBookingDb, getOldBookingDb, getCasesSettingsDb } from "@/lib/firebase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SEQUENCE_FILE = path.join(process.cwd(), "data", "booking_sequence.json");
const RECORDS_FILE = path.join(process.cwd(), "data", "google_sheets_records.json");

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function getMaxSeqFromLocalRecords(): number {
  try {
    if (fs.existsSync(RECORDS_FILE)) {
      const content = fs.readFileSync(RECORDS_FILE, "utf8");
      const list = JSON.parse(content);
      if (Array.isArray(list)) {
        let max = 0;
        for (const item of list) {
          const t = String(item.booking_ref_id || item.reference_id || item.tokenNo || "");
          const m = t.match(/^[A-Z]{3,4}-(\d{4,6})-[A-Z0-9]{4,5}$/i);
          if (m) {
            const num = parseInt(m[1], 10);
            if (num > max && num < 200000) max = num;
          }
        }
        return max;
      }
    }
  } catch (_) {}
  return 0;
}

function getStoredFileSeq(): number {
  try {
    if (fs.existsSync(SEQUENCE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SEQUENCE_FILE, "utf8"));
      if (typeof data.lastSeq === "number" && !isNaN(data.lastSeq) && data.lastSeq < 200000) {
        return data.lastSeq;
      }
    }
  } catch (_) {}
  return 0;
}

function saveStoredFileSeq(seq: number, token: string) {
  try {
    const dir = path.dirname(SEQUENCE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      SEQUENCE_FILE,
      JSON.stringify({ lastSeq: seq, lastToken: token, updatedAt: new Date().toISOString() }, null, 2),
      "utf8"
    );
  } catch (e: any) {
    console.warn("Failed to write booking_sequence.json:", e?.message);
  }
}

export async function GET(request: NextRequest) {
  return handleGenerateToken(request);
}

export async function POST(request: NextRequest) {
  return handleGenerateToken(request);
}

async function handleGenerateToken(request: NextRequest) {
  let prefix = "ESI";
  let suffix = "DISP";

  try {
    const url = new URL(request.url);
    const qPrefix = url.searchParams.get("prefix");
    const qSuffix = url.searchParams.get("suffix");
    if (qPrefix) prefix = qPrefix.toUpperCase().trim();
    if (qSuffix) suffix = qSuffix.toUpperCase().trim();

    if (request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (body?.prefix) prefix = String(body.prefix).toUpperCase().trim();
      if (body?.suffix) suffix = String(body.suffix).toUpperCase().trim();
      if (body?.facilityType === "ESIC_HOSPITAL" || body?.isHospital) suffix = "HOSP";
    }
  } catch (_) {}

  // 1. Gather highest known sequence from all available sources
  const fileSeq = getStoredFileSeq();
  const recordsMaxSeq = getMaxSeqFromLocalRecords();
  const safeFloor = 1; // Start from ESI-000001-DISP

  let currentHighest = Math.max(fileSeq, recordsMaxSeq, safeFloor - 1);

  // 2. Try to read Firestore counter doc from active triage-booking db
  try {
    const db = getActiveBookingDb() || getCasesSettingsDb();
    if (db) {
      const snap = await getDoc(doc(db, "counters", "bookingSequence"));
      if (snap.exists()) {
        const val = snap.data()?.lastSeq;
        if (typeof val === "number" && val > currentHighest && val < 200000) {
          currentHighest = val;
        }
      }
    }
  } catch (err: any) {
    // Quota exhausted or offline - safely use local persistent highest
  }

  // 3. Atomically advance to next unique sequence (6-digit ESI format)
  const nextSeq = currentHighest + 1;
  const tokenNo = `${prefix}-${String(nextSeq).padStart(6, "0")}-${suffix}`;
  const docId = tokenNo.replace(/[^a-zA-Z0-9_-]/g, "_");

  // 4. Save to persistent server file store immediately
  saveStoredFileSeq(nextSeq, tokenNo);

  // 5. Dual-write to primary triage-booking db and safety backup ekmsbooking db
  try {
    const primaryDb = getActiveBookingDb();
    const backupDb = getOldBookingDb();
    const counterDoc = { lastSeq: nextSeq, lastAssignedToken: tokenNo, updatedAt: Date.now() };
    if (primaryDb) {
      setDoc(doc(primaryDb, "counters", "bookingSequence"), counterDoc, { merge: true }).catch(() => {});
    }
    if (backupDb) {
      setDoc(doc(backupDb, "counters", "bookingSequence"), counterDoc, { merge: true }).catch(() => {});
    }
  } catch (_) {}

  return NextResponse.json(
    {
      success: true,
      tokenNo,
      seq: nextSeq,
      docId,
    },
    { status: 200, headers: corsHeaders() }
  );
}
