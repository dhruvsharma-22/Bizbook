import { NextResponse } from "next/server";
import { requireInstituteAccess, SupabaseAuthorizationError } from "@/lib/supabase/authorization";
import { createFeeReceiptPdf } from "@/lib/supabase/payment-receipts";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, context: { params: Promise<{ receiptId: string }> }) {
  try {
    const { receiptId } = await context.params;
    const session = await createSupabaseServerClient();
    const { data: receipt, error } = await session.from("fee_receipts").select("institute_id, branch_id, receipt_number")
      .eq("id", receiptId).maybeSingle();
    if (error || !receipt) return json({ error: "The fee receipt is unavailable in this workspace." }, 404);
    const access = await requireInstituteAccess(receipt.institute_id, {
      allowedRoles: ["owner", "administrator", "accountant"],
      ...(receipt.branch_id ? { branchId: receipt.branch_id } : {}),
    });
    if (access.accessScope === "branches" && !receipt.branch_id) return json({ error: "This receipt is outside your permitted branches." }, 403);
    const pdf = await createFeeReceiptPdf(receiptId);
    const safeName = receipt.receipt_number.replace(/[^A-Za-z0-9_-]/g, "_");
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeName}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
    return json({ error: "The fee receipt PDF could not be generated." }, 503);
  }
}
