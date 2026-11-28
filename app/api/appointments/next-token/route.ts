import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { doc, getDoc, setDoc, runTransaction } from "firebase/firestore";
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
          const t = String(item.booking_ref_id || item.reference_id || item.tokenNo || "").trim();
          // Strictly match production canonical ESI tokens (e.g. ESI-000098-DISP), ignore obsolete ESIC-*
          const m = t.match(/^ESI-(\d{4,6})-(DISP|HOSP)$/i);
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

let inMemoryLastSeq = 0;

async function handleGenerateToken(request: NextRequest) {
  let prefix = "ESI";
  let suffix = "DISP";
  let isPreview = false;

  try {
    const url = new URL(request.url);
    const qPrefix = url.searchParams.get("prefix");
    const qSuffix = url.searchParams.get("suffix");
    if (url.searchParams.get("preview") === "true" || url.searchParams.get("peek") === "true") {
      isPreview = true;
    }
    if (qPrefix) prefix = qPrefix.toUpperCase().trim();
    if (qSuffix) suffix = qSuffix.toUpperCase().trim();

    if (request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (body?.prefix) prefix = String(body.prefix).toUpperCase().trim();
      if (body?.suffix) suffix = String(body.suffix).toUpperCase().trim();
      if (body?.facilityType === "ESIC_HOSPITAL" || body?.isHospital) suffix = "HOSP";
      if (body?.preview || body?.peek) isPreview = true;
    }
  } catch (_) {}

  // 1. Gather highest known sequence from all local stores and memory
  const fileSeq = getStoredFileSeq();
  const recordsMaxSeq = getMaxSeqFromLocalRecords();
  const safeFloor = 1;

  let currentHighest = Math.max(inMemoryLastSeq, fileSeq, recordsMaxSeq, safeFloor - 1);
  const nextSeq = currentHighest + 1;

  const tokenNo = `${prefix}-${String(nextSeq).padStart(6, "0")}-${suffix}`;
  const docId = tokenNo.replace(/[^a-zA-Z0-9_-]/g, "_");

  if (!isPreview) {
    inMemoryLastSeq = nextSeq;
    // 2. Persist to local sequence store immediately (synchronous < 1ms)
    saveStoredFileSeq(nextSeq, tokenNo);

    // 3. Fast non-blocking background synchronization to Firestore
    (async () => {
      try {
        const primaryDb = getActiveBookingDb() || getCasesSettingsDb();
        if (primaryDb) {
          const counterRef = doc(primaryDb, "counters", "bookingSequence");
          await setDoc(
            counterRef,
            {
              lastSeq: nextSeq,
              lastAssignedToken: tokenNo,
              updatedAt: Date.now(),
            },
            { merge: true }
          ).catch(() => {});
        }
        const backupDb = getOldBookingDb();
        if (backupDb) {
          await setDoc(
            doc(backupDb, "counters", "bookingSequence"),
            { lastSeq: nextSeq, lastAssignedToken: tokenNo, updatedAt: Date.now() },
            { merge: true }
          ).catch(() => {});
        }
      } catch (_) {}
    })();
  }

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
