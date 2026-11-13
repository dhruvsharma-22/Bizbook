"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, BellRing, Building2, CreditCard, FileText, LifeBuoy, LayoutDashboard,
  Megaphone, MessageCircle, ShieldCheck, Users,
} from "lucide-react";

type AdminRole = "owner" | "operator" | "support";
const items = [
  { href: "/platform-admin/overview", label: "Overview", group: "Dashboard", Icon: LayoutDashboard, tone: "text-violet-300", active: "bg-violet-500/20 text-white ring-violet-400/30" },
  { href: "/platform-admin/health", label: "System health", group: "Dashboard", Icon: Activity, tone: "text-sky-300", active: "bg-sky-500/20 text-white ring-sky-400/30" },
  { href: "/platform-admin/institutes", label: "Institutes", group: "Institute operations", Icon: Building2, tone: "text-cyan-300", active: "bg-cyan-500/20 text-white ring-cyan-400/30" },
  { href: "/platform-admin/plans", label: "Plan pricing", group: "Billing", Icon: CreditCard, tone: "text-blue-300", active: "bg-blue-500/20 text-white ring-blue-400/30" },
  { href: "/platform-admin/subscriptions", label: "Subscriptions", group: "Billing", Icon: FileText, tone: "text-amber-300", active: "bg-amber-500/20 text-white ring-amber-400/30" },
  { href: "/platform-admin/access", label: "Admin roles", group: "Governance", Icon: Users, tone: "text-fuchsia-300", active: "bg-fuchsia-500/20 text-white ring-fuchsia-400/30" },
  { href: "/platform-admin/audit", label: "Audit history", group: "Governance", Icon: ShieldCheck, tone: "text-slate-300", active: "bg-slate-500/30 text-white ring-slate-400/30" },
  { href: "/platform-admin/updates", label: "Updates", group: "Communications", Icon: Megaphone, tone: "text-yellow-300", active: "bg-yellow-500/20 text-white ring-yellow-400/30" },
  { href: "/platform-admin/support", label: "Support", group: "Communications", Icon: LifeBuoy, tone: "text-emerald-300", active: "bg-emerald-500/20 text-white ring-emerald-400/30" },
  { href: "/platform-admin/student-reminders", label: "Student fee reminders", group: "Communications", Icon: BellRing, tone: "text-orange-300", active: "bg-orange-500/20 text-white ring-orange-400/30" },
  { href: "/platform-admin/receipts", label: "Student fee receipts", group: "Communications", Icon: FileText, tone: "text-lime-300", active: "bg-lime-500/20 text-white ring-lime-400/30" },
  { href: "/platform-admin/subscription-reminders", label: "BizBook reminders", group: "Communications", Icon: BellRing, tone: "text-indigo-300", active: "bg-indigo-500/20 text-white ring-indigo-400/30" },
  { href: "/platform-admin/provider-overview", label: "Provider overview", group: "Platform services", Icon: CreditCard, tone: "text-indigo-300", active: "bg-indigo-500/20 text-white ring-indigo-400/30" },
  { href: "/platform-admin/payment-providers", label: "Payment providers", group: "Platform services", Icon: CreditCard, tone: "text-rose-300", active: "bg-rose-500/20 text-white ring-rose-400/30" },
  { href: "/platform-admin/messaging-providers", label: "Messaging providers", group: "Platform services", Icon: MessageCircle, tone: "text-pink-300", active: "bg-pink-500/20 text-white ring-pink-400/30" },
  { href: "/platform-admin/security", label: "Security", group: "Platform services", Icon: ShieldCheck, tone: "text-teal-300", active: "bg-teal-500/20 text-white ring-teal-400/30" },
];

function AdminLink({ href, label, Icon, tone, active, mobile = false }: (typeof items)[number] & { mobile?: boolean }) {
  const pathname = usePathname();
  const selected = pathname === href;
  return (
    <Link href={href} aria-current={selected ? "page" : undefined} className={`group flex min-h-10 items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] font-semibold transition ${mobile ? selected ? "bg-violet-50 text-violet-950 ring-1 ring-violet-200" : "text-slate-600 hover:bg-slate-100" : selected ? `ring-1 ${active} shadow-sm` : "text-slate-300 hover:bg-white/[0.07] hover:text-white"}`}>
      <Icon size={16} className={`shrink-0 ${mobile ? selected ? "text-violet-700" : "text-slate-500" : selected ? "text-white" : tone}`} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export default function PlatformAdminNavigation({ role }: { role: AdminRole }) {
  const pathname = usePathname();
  const visible = role === "support" ? items.filter((item) => item.href === "/platform-admin/support") : items;
  const groups = Array.from(new Set(visible.map((item) => item.group)));
  const current = visible.find((item) => item.href === pathname) ?? visible[0];

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col border-r border-white/10 bg-[#11172b] px-4 py-5 text-white shadow-[8px_0_36px_-28px_rgba(15,23,42,.8)] lg:flex">
        <Link href={role === "support" ? "/platform-admin/support" : "/platform-admin/overview"} className="flex items-center gap-3 rounded-2xl px-2 py-2.5">
          <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-950/40"><Building2 size={20} /></span>
          <span><strong className="block text-sm font-extrabold tracking-tight">BizBook</strong><span className="mt-0.5 block text-[9px] font-bold uppercase tracking-[.18em] text-slate-400">Company Admin</span></span>
        </Link>
        <div className="mt-5 rounded-xl border border-white/[.08] bg-white/[.04] px-3 py-2.5"><p className="text-[9px] font-extrabold uppercase tracking-[.17em] text-violet-200">Workspace</p><p className="mt-1 text-xs font-semibold text-white">Platform console</p></div>
        <nav aria-label="Company administration" className="mt-5 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {groups.map((group) => <div key={group}><p className="px-3 text-[9px] font-extrabold uppercase tracking-[.16em] text-slate-500">{group}</p><div className="mt-1.5 space-y-1">{visible.filter((item) => item.group === group).map((item) => <AdminLink key={item.href} {...item} />)}</div></div>)}
        </nav>
        <div className="mt-4 rounded-xl border border-violet-300/15 bg-gradient-to-br from-violet-500/15 to-indigo-500/10 p-3"><p className="text-[10px] font-bold text-violet-100">BizBook platform</p><p className="mt-1 text-[10px] leading-4 text-slate-400">Central tools for institutes, subscriptions, and services.</p></div>
      </aside>

      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur lg:hidden">
        <div className="flex min-h-12 items-center justify-between px-3"><Link href={role === "support" ? "/platform-admin/support" : "/platform-admin/overview"} className="flex items-center gap-2 text-xs font-extrabold text-slate-900"><span className="grid size-7 place-items-center rounded-lg bg-violet-700 text-white"><Building2 size={15} /></span>BizBook <span className="font-medium text-slate-500">/ {current?.label}</span></Link></div>
        <nav aria-label="Company administration sections" className="flex gap-1 overflow-x-auto px-2 pb-2">{visible.map((item) => <div key={item.href} className="shrink-0"><AdminLink {...item} mobile /></div>)}</nav>
      </div>
    </>
  );
}
