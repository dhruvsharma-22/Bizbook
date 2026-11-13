
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const preview = {
      channel: "EMAIL",
      status: "SIMULATION_ONLY",
      to: body.to ?? "Not provided",
      coachingName: body.coachingName ?? "Demo Coaching",
      studentName: body.studentName ?? "Student",
      subject: body.subject ?? "Payment Notification",
      message: body.message ?? "",
      simulatedAt: new Date().toISOString(),
    };

    console.info("BizBook email preview generated", {
      channel: "EMAIL",
      status: "SIMULATION_ONLY",
    });

    return NextResponse.json({
      success: true,
      simulated: true,
      preview,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid request body." },
      { status: 400 }
    );
  }
}
