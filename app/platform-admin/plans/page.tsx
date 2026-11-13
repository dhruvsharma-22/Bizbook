import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import PlatformPlanPricing from "@/components/platform-admin/PlatformPlanPricing";
import { PlatformAuthorizationError, requirePlatformAdministrator } from "@/lib/supabase/authorization";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";

export const instant = false;

function AccessNotice({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 shadow-xl sm:p-9">
        <span className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-800"><ShieldCheck size={22} /></span>
        <p className="mt-6 text-xs font-extrabold uppercase tracking-[0.16em] text-blue-700">BizBook Company Admin</p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
        <Link href="/platform-admin" className="mt-6 inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white"><ArrowLeft size={15} />Company Admin home</Link>
      </section>
    </main>
  );
}

export default async function PlatformPlansPage() {
  // The administrator session is request-scoped and must not be prerendered.
  await connection();

  let isTestProject = false;
  try { isTestProject = isAuthorizedTestProjectUrl(getSupabasePublicConfig().url); } catch { /* fail closed when configuration is absent */ }
  if (!isTestProject) {
    return <AccessNotice title="Plan pricing unavailable" message="The plan pricing console is restricted to the authorized test project. No database connection was made." />;
  }

  let role: "owner" | "operator" | "support";
  try {
    ({ role } = await requirePlatformAdministrator());
  } catch (error) {
    if (error instanceof PlatformAuthorizationError && error.status === 401) redirect("/login?next=%2Fplatform-admin%2Fplans");
    if (error instanceof PlatformAuthorizationError && error.status === 403) {
      return <AccessNotice title="Company Admin access required" message="A verified BizBook Company Admin account is required to view subscription plans." />;
    }
    return <AccessNotice title="Access could not be verified" message="The plan console remains closed until the platform administrator role can be confirmed." />;
  }
  if (role === "support") {
    return <AccessNotice title="Pricing access is restricted" message="Support administrators can access support requests but cannot view or change plan pricing." />;
  }

  return (
    <div className="space-y-5">
      <section className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 via-indigo-800 to-violet-950 px-5 py-5 text-white shadow-[0_22px_48px_-32px_rgba(30,41,59,.65)] sm:rounded-3xl sm:px-7 sm:py-6">
        <div className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[.2em] text-blue-100"><span>Company Admin</span><span>/</span><span>Billing</span></div>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">Plan pricing</h1>
        <p className="mt-2 max-w-2xl text-xs leading-5 text-blue-100 sm:text-sm sm:leading-6">Manage the BizBook plan catalog, pricing, features, and access limits.</p>
      </section>
      <PlatformPlanPricing />
    </div>
  );
}
