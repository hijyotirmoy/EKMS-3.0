import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const buildTime =
    process.env.NEXT_PUBLIC_BUILD_TIME ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.COMMIT_REF ||
    process.env.BUILD_ID ||
    "dev-build";

  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "3.0.2";

  return NextResponse.json(
    {
      success: true,
      buildTime,
      version: appVersion,
      timestamp: Date.now(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    }
  );
}
