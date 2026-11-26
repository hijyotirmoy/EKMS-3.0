import { NextResponse } from "next/server";
import { getFacilities, getCachedFacilities } from "@/lib/triageDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    let list = getCachedFacilities();
    if (!list || list.length === 0) {
      list = await getFacilities();
    }
    return NextResponse.json({ success: true, count: list.length, facilities: list });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message, facilities: [] }, { status: 500 });
  }
}
