import { NextResponse } from "next/server";
import { getCaseByRef, deleteCase } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const resolvedParams = (await params) || params || {};
  const case_ref = resolvedParams.case_ref;
  const caseItem = await getCaseByRef(case_ref);

  if (!caseItem) {
    return NextResponse.json({ detail: "Case not found" }, { status: 404 });
  }

  return NextResponse.json(caseItem);
}

export async function DELETE(request, { params }) {
  const resolvedParams = (await params) || params || {};
  const case_ref = resolvedParams.case_ref;
  await deleteCase(case_ref);
  return NextResponse.json({ success: true, case_ref });
}
