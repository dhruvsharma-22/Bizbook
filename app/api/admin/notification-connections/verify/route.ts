import { NextResponse } from "next/server";

/** Institute-scoped provider checks were retired; only platform administrators may configure central senders. */
export async function POST() {
  return NextResponse.json(
    { error: "Institute-level notification checks are disabled. Use central BizBook provider settings." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
