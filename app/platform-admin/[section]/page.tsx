import { notFound, redirect } from "next/navigation";
import {
  Activity, BellRing, Building2, CreditCard, FileText, LifeBuoy, LayoutDashboard,
  Megaphone, MessageCircle, ShieldCheck, Users,
} from "lucide-react";
import PlatformOperations from "@/components/platform-admin/PlatformOperations";
import PlatformProviderSettings from "@/components/platform-admin/PlatformProviderSettings";
import PlatformSupportInbox from "@/components/platform-admin/PlatformSupportInbox";
import PlatformAnnouncements from "@/components/platform-admin/PlatformAnnouncements";
import PlatformFeeReceiptSettings from "@/components/platform-admin/PlatformFeeReceiptSettings";
import PlatformReminderSettings from "@/components/platform-admin/PlatformReminderSettings";
import { PlatformAuthorizationError, requirePlatformAdministrator } from "@/lib/supabase/authorization";
import styles from "@/components/platform-admin/PlatformAdminSection.module.css";

export const instant = false;

const sections = {
  overview: { title: "Overview", group: "Dashboard", description: "A quick view of institute accounts, plans, invoices, and platform access.", Icon: LayoutDashboard, color: "from-violet-700 via-violet-800 to-indigo-900", view: "operationsOverview" },
  health: { title: "System health", group: "Dashboard", description: "Review the latest authorized server checks and platform readiness.", Icon: Activity, color: "from-sky-600 via-blue-700 to-cyan-800", view: "operationsHealth" },
  institutes: { title: "Institute directory", group: "Institute operations", description: "Find institute workspaces and manage their platform access and subscription assignment.", Icon: Building2, color: "from-cyan-600 via-teal-700 to-emerald-800", view: "operationsInstitutes" },
  subscriptions: { title: "Subscriptions", group: "Billing", description: "Assign plans, manage subscription periods, and issue platform invoices.", Icon: FileText, color: "from-orange-600 via-amber-700 to-yellow-800", view: "operationsSubscriptions" },
  access: { title: "Platform administrator roles", group: "Governance", description: "Manage verified Company Admin roles and access.", Icon: Users, color: "from-fuchsia-700 via-purple-800 to-indigo-900", view: "operationsAccess" },
  audit: { title: "Administrative audit history", group: "Governance", description: "Review recorded plan, institute, subscription, and administrator changes.", Icon: ShieldCheck, color: "from-slate-700 via-slate-800 to-blue-950", view: "operationsAudit" },
  updates: { title: "Workspace updates", group: "Communications", description: "Publish service news and subscription updates for BizBook workspaces.", Icon: Megaphone, color: "from-yellow-600 via-amber-700 to-lime-800", view: "announcements" },
  support: { title: "Support inbox", group: "Communications", description: "Review and reply to institute support requests.", Icon: LifeBuoy, color: "from-emerald-700 via-green-800 to-teal-900", view: "support" },
  "provider-overview": { title: "Provider overview", group: "Platform services", description: "Review central payment and messaging configuration status.", Icon: CreditCard, color: "from-indigo-700 via-violet-800 to-blue-950", view: "providerOverview" },
  "payment-providers": { title: "Payment providers", group: "Platform services", description: "Manage test-only payment provider configuration for BizBook subscriptions.", Icon: CreditCard, color: "from-rose-700 via-red-800 to-pink-950", view: "paymentProviders" },
  "messaging-providers": { title: "Messaging providers", group: "Platform services", description: "Manage central sender configuration for platform notifications and reminders.", Icon: MessageCircle, color: "from-pink-700 via-fuchsia-800 to-purple-950", view: "messagingProviders" },
  "student-reminders": { title: "Student fee reminders", group: "Communications", description: "Set the company-wide reminder schedule sent to opted-in student and family contacts.", Icon: BellRing, color: "from-amber-600 via-orange-700 to-red-900", view: "studentReminders" },
  receipts: { title: "Student fee receipt template", group: "Communications", description: "Design the receipt preview and delivery settings used by institute workspaces.", Icon: FileText, color: "from-emerald-700 via-green-800 to-teal-950", view: "receipts" },
  "subscription-reminders": { title: "BizBook subscription reminders", group: "Communications", description: "Configure separate trial and renewal reminders sent to coaching owners.", Icon: BellRing, color: "from-indigo-700 via-blue-800 to-violet-950", view: "subscriptionReminders" },
  security: { title: "Security and access", group: "Platform services", description: "Review the safeguards applied to Company Admin provider settings.", Icon: ShieldCheck, color: "from-teal-700 via-emerald-800 to-cyan-950", view: "security" },
} as const;

type SectionKey = keyof typeof sections;

function Content({ section, requestedInstituteId }: { section: SectionKey; requestedInstituteId: string }) {
  const view = sections[section].view;
  if (view.startsWith("operations")) {
    return <div className={styles[view as keyof typeof styles]}><PlatformOperations requestedInstituteId={requestedInstituteId} /></div>;
  }
  if (view === "announcements") return <PlatformAnnouncements />;
  if (view === "support") return <PlatformSupportInbox />;
  if (view === "providerOverview" || view === "paymentProviders" || view === "messagingProviders" || view === "security") {
    return <div className={styles[view as keyof typeof styles]}><PlatformProviderSettings /></div>;
  }
  if (view === "receipts") return <PlatformFeeReceiptSettings />;
  if (view === "studentReminders") return <PlatformReminderSettings />;
  if (view === "subscriptionReminders") return <PlatformReminderSettings
    endpoint="/api/platform-admin/subscription-reminders"
    sectionId="subscription-reminder-schedule"
    title="BizBook subscription reminder schedule"
    description="Separate company-wide schedule for BizBook trial-end and renewal reminders sent to coaching owners. Coaching institutes cannot change these settings."
    dateReference="trial or renewal date"
    audience="Coaching owner contacts"
    tone="indigo"
  />;
  return null;
}

export default async function PlatformAdminSectionPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ institute?: string | string[] }> }) {
  const [{ section: rawSection }, query] = await Promise.all([params, searchParams]);
  if (!Object.prototype.hasOwnProperty.call(sections, rawSection)) notFound();
  const section = rawSection as SectionKey;

  let role: "owner" | "operator" | "support";
  try {
    ({ role } = await requirePlatformAdministrator());
  } catch (error) {
    if (error instanceof PlatformAuthorizationError && error.status === 401) redirect("/login?next=%2Fplatform-admin");
    notFound();
  }
  if (role === "support" && section !== "support") redirect("/platform-admin/support");

  const page = sections[section];
  const Icon = page.Icon;
  const requestedInstituteId = Array.isArray(query.institute) ? query.institute[0] ?? "" : query.institute ?? "";
  return (
    <div className="space-y-5 sm:space-y-6">
      <section className={`relative isolate overflow-hidden rounded-2xl bg-gradient-to-br ${page.color} px-5 py-5 text-white shadow-[0_22px_48px_-32px_rgba(30,41,59,.65)] sm:rounded-3xl sm:px-7 sm:py-6`}>
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_80%_15%,rgba(255,255,255,.16),transparent_32%),radial-gradient(circle_at_10%_110%,rgba(255,255,255,.08),transparent_36%)]" />
        <div className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[.2em] text-white/75"><span>Company Admin</span><span>/</span><span>{page.group}</span></div>
        <div className="mt-4 flex items-start justify-between gap-4"><div className="min-w-0"><h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{page.title}</h1><p className="mt-2 max-w-2xl text-xs leading-5 text-white/80 sm:text-sm sm:leading-6">{page.description}</p></div><span className="hidden size-12 shrink-0 place-items-center rounded-2xl border border-white/20 bg-white/10 text-white shadow-inner sm:grid"><Icon size={22} /></span></div>
      </section>
      <div className="min-w-0"><Content section={section} requestedInstituteId={requestedInstituteId} /></div>
    </div>
  );
}
