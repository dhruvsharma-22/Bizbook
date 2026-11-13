import { NextResponse } from "next/server";

/** Institute-scoped provider credentials were retired in favor of central BizBook senders. */
function retired() {
  return NextResponse.json(
    { error: "Institute-level notification credentials are no longer supported. Configure the central BizBook provider as a platform administrator." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() { return retired(); }
export async function POST() { return retired(); }
