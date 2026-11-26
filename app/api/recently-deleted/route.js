import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DATA_FILE = path.join(process.cwd(), "data", "recently_deleted.json");
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function readDiskItems() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const now = Date.now();
        // Auto-purge any items older than 7 days
        return list.filter((item) => {
          if (item.expiresAt && now > Number(item.expiresAt)) return false;
          if (item.deletedTimestamp && now - Number(item.deletedTimestamp) > RETENTION_MS) return false;
          return true;
        });
      }
    }
  } catch (e) {
    console.warn("readDiskItems error:", e.message);
  }
  return [];
}

function writeDiskItems(items) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2), "utf8");
  } catch (e) {
    console.error("writeDiskItems error:", e.message);
  }
}

export async function GET() {
  const items = readDiskItems();
  return NextResponse.json({
    success: true,
    total: items.length,
    items,
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const action = body.action || "archive";
    let items = readDiskItems();

    if (action === "archive" && body.record) {
      items = [body.record, ...items.filter((x) => x.id !== body.record.id)];
      writeDiskItems(items);
      return NextResponse.json({ success: true, message: "Archived to disk", itemsCount: items.length });
    }

    if (action === "permanent_delete" && body.recordId) {
      items = items.filter((x) => x.id !== body.recordId && x.originalId !== body.recordId);
      writeDiskItems(items);
      return NextResponse.json({ success: true, message: "Permanently deleted from disk", itemsCount: items.length });
    }

    if (action === "empty") {
      writeDiskItems([]);
      return NextResponse.json({ success: true, message: "Emptied recycle bin on disk", itemsCount: 0 });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
