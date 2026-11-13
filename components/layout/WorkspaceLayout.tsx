
"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { CalendarClock, CircleAlert, Menu, Quote, RefreshCw, ShieldCheck } from "lucide-react";
import AppSidebar from "@/components/layout/AppSidebar";
import WorkspaceTopbar from "@/components/layout/WorkspaceTopbar";
import { useWorkspaceSubscription } from "@/components/layout/WorkspaceSubscriptionContext";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const { instituteId, gateState, error, refresh } = useWorkspaceSubscription();
  const onSubscriptionRoute = pathname === "/settings/subscription" || pathname.startsWith("/settings/subscription/");
  const onPlanPricingRoute = pathname === "/plans";
  const isAccountSettingsRoute = (pathname.startsWith("/settings/") && !pathname.startsWith("/settings/subscription"))
    || pathname === "/business/members"
    || pathname === "/business/profile";
  const showAccessGate = Boolean(
    instituteId && !onSubscriptionRoute && !onPlanPricingRoute && gateState !== "active",
  );

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  return (
    <div className={`bizbook-workspace-shell min-h-screen ${onSubscriptionRoute ? "bizbook-workspace-shell--subscription" : ""}`}>
      <AppSidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        pathname={pathname}
      />

      <div className="min-h-screen md:pl-72">
        <button
          type="button"
          aria-label="Open navigation menu"
          aria-controls="workspace-navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="bizbook-mobile-menu fixed left-3 top-3 z-30 inline-flex h-11 w-11 items-center justify-center rounded-xl md:left-4 md:top-4 md:h-12 md:w-12 md:hidden"
        >
          <Menu size={22} />
        </button>

        <WorkspaceTopbar pathname={pathname} />
        <div
          className={`${showAccessGate ? "bizbook-subscription-blurred" : ""} ${isAccountSettingsRoute ? "bizbook-account-settings" : ""}`.trim() || undefined}
          inert={showAccessGate}
          aria-hidden={showAccessGate || undefined}
        >
          {children}
        </div>
      </div>
      {showAccessGate && (
        <div className="bizbook-subscription-gate fixed inset-x-0 bottom-0 top-[68px] z-30 grid place-items-center overflow-y-auto p-3 md:left-72 md:top-[72px] sm:p-4" role="presentation">
          {gateState === "checking" ? (
            <div className="flex items-center justify-center gap-2.5 py-3" role="status" aria-label="Checking your plan">
              <span className="size-3 rounded-full bg-emerald-500 motion-safe:animate-bounce" />
              <span className="size-3 rounded-full bg-teal-500 motion-safe:animate-bounce [animation-delay:120ms]" />
              <span className="size-3 rounded-full bg-violet-500 motion-safe:animate-bounce [animation-delay:240ms]" />
            </div>
          ) : (
          <section className="bizbook-subscription-gate-card relative w-full max-w-[320px] overflow-hidden rounded-2xl border border-white/80 bg-white/95 p-4 shadow-[0_18px_52px_-30px_rgba(15,23,42,0.52)] backdrop-blur-xl" aria-labelledby="subscription-gate-title" aria-live="polite">
            <div className="bizbook-subscription-gate-glow pointer-events-none absolute -right-10 -top-12 size-28 rounded-full bg-violet-300/35 blur-3xl" />
            <div className="relative">
              <span className={`relative grid size-9 place-items-center rounded-xl ${gateState === "unavailable" ? "bg-rose-50 text-rose-700" : "bg-violet-50 text-violet-700"}`}>
                {gateState === "unavailable" ? <CircleAlert size={16} /> : <CalendarClock size={16} />}
              </span>
              <p className="mt-2 text-[8px] font-extrabold uppercase tracking-[0.18em] text-violet-700">BizBook workspace</p>
              <h1 id="subscription-gate-title" className="mt-1 text-lg font-black tracking-tight text-slate-950 sm:text-xl">
                {gateState === "unavailable" ? "We couldn’t confirm your plan"
                    : gateState === "suspended" ? "Workspace access is paused"
                      : gateState === "payment_due" ? "Your plan needs renewal"
                        : gateState === "expired" ? "Your plan has expired"
                          : "Choose a plan to unlock your workspace"}
              </h1>
              <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-violet-50/80 p-2.5 text-[11px] leading-4 text-violet-950">
                <Quote size={13} className="mt-0.5 shrink-0 text-violet-700" />
                <p>{gateState === "unavailable" ? error || "Your saved plan status could not be loaded. Retry the check or open your plan settings."
                    : "Your institute records are safe. Renew or choose a plan to bring your workspace back into focus."}</p>
              </div>
              {gateState === "unavailable" && <button type="button" onClick={refresh} className="mt-2 inline-flex min-h-8 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-700 shadow-sm hover:bg-slate-50"><RefreshCw size={12} />Check again</button>}
              <Link href="/settings/subscription" className="mt-2.5 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-700 to-indigo-600 px-3 text-[11px] font-extrabold text-white shadow-md shadow-violet-900/20 transition hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2">
                <ShieldCheck size={13} />{gateState === "expired" || gateState === "payment_due" ? "Renew or choose a plan" : "View plans and subscription"}
              </Link>
              <p className="mt-2 text-center text-[9px] leading-3.5 text-slate-500">Your sidebar remains available. Manage access from Subscription.</p>
            </div>
          </section>
          )}
        </div>
      )}
    </div>
  );
}
