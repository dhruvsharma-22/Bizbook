import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowUpRight, LockKeyhole, ShieldCheck } from "lucide-react";
import PlatformAdminNavigation from "@/components/platform-admin/PlatformAdminNavigation";
import PlatformAdminSignOut from "@/components/platform-admin/PlatformAdminSignOut";
import { PlatformAuthorizationError, requirePlatformAdministrator } from "@/lib/supabase/authorization";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";

export const instant = false;

function GateNotice({ title, description }: { title: string; description: string }) {
  return <main className="grid min-h-[70vh] place-items-center px-4 py-12"><section className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-7 shadow-xl sm:p-9"><span className="grid size-12 place-items-center rounded-2xl bg-violet-50 text-violet-800"><LockKeyhole size={22} /></span><p className="mt-5 text-[10px] font-extrabold uppercase tracking-[.18em] text-violet-700">BizBook Company Admin</p><h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">{title}</h1><p className="mt-3 text-sm leading-6 text-slate-600">{description}</p><Link href="/dashboard" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white">Return to BizBook <ArrowUpRight size={15} /></Link></section></main>;
}

export default async function PlatformAdminLayout({ children }: { children: ReactNode }) {
  await connection();
  let testProject = false;
  try { testProject = isAuthorizedTestProjectUrl(getSupabasePublicConfig().url); } catch { /* missing configuration fails closed */ }
  if (!testProject) return <GateNotice title="Company Admin unavailable" description="This development console is restricted to the authorized Supabase test project. No database connection was made." />;

  let role: "owner" | "operator" | "support";
  try {
    ({ role } = await requirePlatformAdministrator());
  } catch (error) {
    if (error instanceof PlatformAuthorizationError && error.status === 401) redirect("/login?next=%2Fplatform-admin");
    if (error instanceof PlatformAuthorizationError && error.status === 403) return <GateNotice title="Company Admin access required" description="This workspace is available only to verified BizBook Company Admin accounts." />;
    return <GateNotice title="Access could not be verified" description="The platform could not confirm Company Admin access. The console remains closed until authorization can be verified." />;
  }

  return (
    <div className="min-h-screen bg-[#f4f6fb] text-slate-900">
      <PlatformAdminNavigation role={role} />
      <div className="min-w-0 lg:pl-[264px]">
        <header className="border-b border-slate-200/90 bg-white px-4 py-3 sm:px-7">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3">
            <div className="min-w-0"><p className="text-[9px] font-extrabold uppercase tracking-[.18em] text-violet-700">BizBook platform</p><p className="mt-0.5 truncate text-sm font-bold text-slate-900">Company administration</p></div>
            <div className="flex shrink-0 items-center gap-2"><Link href="/dashboard" className="hidden min-h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 sm:inline-flex"><ArrowUpRight size={14} />Coaching workspace</Link><span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-800 md:inline-flex"><ShieldCheck size={13} />Secure console</span><PlatformAdminSignOut /></div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-3 py-4 sm:px-6 sm:py-6 xl:px-8">{children}</main>
        <footer className="mx-auto flex max-w-[1440px] flex-col gap-1 border-t border-slate-200 px-4 py-5 text-[10px] font-medium text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-7"><span>BizBook Company Admin</span><span>Sandbox protected · Provider credentials stay server-side</span></footer>
      </div>
    </div>
  );
}
