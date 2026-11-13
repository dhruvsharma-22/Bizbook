"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Wallet,
  ReceiptText,
  ChartNoAxesCombined,
  Settings,
  ChevronDown,
  ChevronRight,
  X,
  LogOut,
  UserRound,
  Search,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { dateInTimeZone } from "@/lib/supabase/student-balance-report";
import { isAuthorizedTestProjectConfigured } from "@/lib/supabase/workspace-scope";

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
);

const navigation = [
  {
    label: "Member Portal & Invitations",
    icon: UserRound,
    href: "/member",
  },
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/dashboard",
  },
  {
    label: "My Business",
    icon: Building2,
    children: [
      { label: "Business Profile", href: "/business/profile" },
      { label: "Students / Staff", href: "/business/students" },
      { label: "Admission Cancellation", href: "/business/students?workflow=cancel-admission" },
      { label: "Staff Attendance", href: "/business/attendance" },
      { label: "Payment/Salary", href: "/business/salary" },
    ],
  },
  {
    label: "Payments & Collections",
    icon: Wallet,
    children: [
      { label: "Outstanding Payments", href: "/payments/outstanding" },
      { label: "Payment History", href: "/payments/history" },
      { label: "Fee Receipts & Invoices", href: "/payments/receipts" },
      { label: "Overdue Payments", href: "/payments/overdue" },
      { label: "Advance Payments", href: "/payments/advance" },
      { label: "Refund Management", href: "/payments/refunds" },
      { label: "Record Manual Payment", href: "/payments/receipt-records?workflow=manual" },
      { label: "Reminder Status", href: "/payments/reminders" },
    ],
  },
  {
    label: "Expenses",
    icon: ReceiptText,
    children: [
      { label: "Fixed Expense Setup", href: "/expenses/fixed-monthly" },
      { label: "Due Dates & Payments", href: "/expenses/record-payment" },
    ],
  },
  {
    label: "Reports & Analytics",
    icon: ChartNoAxesCombined,
    children: [
      { label: "Financial Summary", href: "/reports/financial-summary" },
      { label: "Net Profit & Loss", href: "/reports/profit-loss" },
      { label: "Revenue & Expenses", href: "/reports/revenue-expenses" },
      { label: "Collection Forecast", href: "/reports/collection-forecast" },
      { label: "Comparisons", href: "/reports/comparisons" },
    ],
  },
  {
    label: "Account Settings",
    icon: Settings,
    children: [
      { label: "Members & Invitations", href: "/business/members" },
      { label: "Login & Security", href: "/settings/security" },
      { label: "Payment Integrations", href: "/settings/integrations" },
      { label: "Plan Pricing", href: "/plans" },
      { label: "Plans & Subscription", href: "/settings/subscription" },
      { label: "Legacy Data Review", href: "/settings/data-import" },
      { label: "Support", href: "/support" },
    ],
  },
];

type SidebarPaymentIndicators = {
  scopeKey: string;
  overdueCount: number | null;
  overdueExpenseCount: number | null;
  overdueSalaryCount: number | null;
  hasNewPayment: boolean;
  latestPaymentCreatedAt: string | null;
};

function splitHref(href: string) {
  const [pathname, query = ""] = href.split("?", 2);
  return { pathname, query: new URLSearchParams(query) };
}

function SidebarAlertBadge({ count, label }: { count: number | null; label: string }) {
  if (count === null || count < 1) return null;
  const display = count > 99 ? "99+" : String(count);
  return <span role="status" aria-label={`${count} ${label}`} title={label} className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border border-rose-300/30 bg-rose-500 px-1.5 text-[10px] font-bold leading-none text-white shadow-[0_2px_10px_rgba(244,63,94,.28)]">{display}</span>;
}

function isActiveHref(href: string, pathname: string, currentQuery: string) {
  const target = splitHref(href);
  if (target.pathname !== pathname) return false;

  const current = new URLSearchParams(currentQuery);
  const queryMatches = (required: URLSearchParams) =>
    [...required.entries()].every(([key, value]) => current.get(key) === value);

  if ([...target.query.keys()].length > 0) return queryMatches(target.query);

  // A query-specific destination (for example Admission Cancellation) owns
  // the active state when it matches, so its parent route is not highlighted too.
  const hasMatchingSpecificDestination = navigation.some((item) =>
    "children" in item && item.children?.some((child) => {
      const candidate = splitHref(child.href);
      return candidate.pathname === pathname
        && [...candidate.query.keys()].length > 0
        && queryMatches(candidate.query);
    })
  );

  return !hasMatchingSpecificDestination;
}

type AppSidebarProps = {
  open: boolean;
  onClose: () => void;
  pathname?: string;
};

export default function AppSidebar({
  ...props
}: AppSidebarProps) {
  return (
    <Suspense fallback={<SidebarFallback open={props.open} />}>
      <AppSidebarContent {...props} />
    </Suspense>
  );
}

function SidebarFallback({ open }: { open: boolean }) {
  return (
    <aside
      aria-label="Main navigation"
      aria-busy="true"
      className={`bizbook-sidebar fixed inset-y-0 left-0 z-50 flex w-[min(84vw,320px)] flex-col transition-transform duration-200 md:w-72 md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
    >
      <div className="bizbook-sidebar-brand flex h-[78px] shrink-0 items-center gap-3 px-5">
        <div className="bizbook-sidebar-mark flex h-11 w-11 items-center justify-center rounded-2xl text-white ring-1 ring-white/20"><Building2 size={23} strokeWidth={2.3} /></div>
        <div><p className="text-lg font-bold tracking-tight text-white">BizBook</p><p className="bizbook-sidebar-muted text-xs">Coaching Centre Workspace</p></div>
      </div>
      <p className="bizbook-sidebar-muted px-6 py-5 text-sm">Loading navigation…</p>
    </aside>
  );
}

function AppSidebarContent({
  open,
  onClose,
  pathname: pathnameProp,
}: AppSidebarProps) {
  const currentPathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = pathnameProp ?? currentPathname;
  const queryString = searchParams.toString();
  const workspaceScope = useWorkspaceScope();
  const selection = workspaceScope.selection;
  const selectedInstitute = workspaceScope.institutes.find((item) => item.id === selection?.instituteId);
  const canViewPayments = selectedInstitute?.role === "owner"
    || selectedInstitute?.role === "administrator"
    || selectedInstitute?.role === "accountant";
  const [paymentIndicators, setPaymentIndicators] = useState<SidebarPaymentIndicators>({
    scopeKey: "",
    overdueCount: null,
    overdueExpenseCount: null,
    overdueSalaryCount: null,
    hasNewPayment: false,
    latestPaymentCreatedAt: null,
  });
  const paymentSeenKey = selection
    ? `bizbook:payment-history-seen:${selection.userId}:${selection.instituteId}:${selection.branchId || "all"}`
    : "";
  const currentPaymentIndicators = paymentIndicators.scopeKey === paymentSeenKey
    ? paymentIndicators
    : { scopeKey: paymentSeenKey, overdueCount: null, overdueExpenseCount: null, overdueSalaryCount: null, hasNewPayment: false, latestPaymentCreatedAt: null };
  const overdueCount = currentPaymentIndicators.overdueCount;
  const overdueExpenseCount = currentPaymentIndicators.overdueExpenseCount;
  const overdueSalaryCount = currentPaymentIndicators.overdueSalaryCount;
  const hasNewPayment = currentPaymentIndicators.hasNewPayment;
  const latestPaymentCreatedAt = currentPaymentIndicators.latestPaymentCreatedAt;

  const [expanded, setExpanded] = useState<string[]>([]);
  const [navSearch, setNavSearch] = useState("");
  const canOpenMemberPortal = Boolean(selectedInstitute && selectedInstitute.role !== "owner");
  const availableNavigation = navigation.filter(
    (item) => item.label !== "Member Portal & Invitations" || canOpenMemberPortal,
  );

  const visibleNavigation = (() => {
    const query = navSearch.trim().toLocaleLowerCase();
    if (!query) return availableNavigation;
    return availableNavigation.flatMap((item) => {
      if ("href" in item) return item.label.toLocaleLowerCase().includes(query) ? [item] : [];
      if (item.label.toLocaleLowerCase().includes(query)) return [item];
      const matchingChildren = item.children.filter((child) => child.label.toLocaleLowerCase().includes(query));
      return matchingChildren.length ? [{ ...item, children: matchingChildren }] : [];
    });
  })();

  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  useEffect(() => {
    if (!supabaseConfigured
      || !isAuthorizedTestProjectConfigured()
      || workspaceScope.loading
      || !selection
      || !selectedInstitute
      || !canViewPayments) return;

    const activeSelection = selection;
    const activeInstitute = selectedInstitute;
    const activePaymentSeenKey = paymentSeenKey;
    let active = true;
    let initialized = false;
    const supabase = createSupabaseBrowserClient();

    async function refreshSidebarIndicators() {
      let today: string;
      try {
        today = dateInTimeZone(new Date(), activeInstitute.timeZone);
      } catch {
        return;
      }

      let overdueQuery = supabase
        .from("installment_balances")
        .select("installment_id", { count: "exact", head: true })
        .eq("institute_id", activeSelection.instituteId)
        .gt("outstanding_amount", 0)
        .neq("scheduled_status", "Cancelled")
        .or(`due_date.lt.${today},and(sequence_number.eq.0,due_date.eq.${today})`);
      let latestPaymentQuery = supabase
        .from("payments")
        .select("created_at")
        .eq("institute_id", activeSelection.instituteId)
        .order("created_at", { ascending: false })
        .limit(1);
      const recurringExpenseParams = new URLSearchParams({ instituteId: activeSelection.instituteId, summary: "1" });
      if (activeSelection.branchId) recurringExpenseParams.set("branchId", activeSelection.branchId);
      const expenseCountRequest = fetch(`/api/expenses/recurring?${recurringExpenseParams.toString()}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return null;
          const result = await response.json() as { overdueCount?: number };
          return Number.isFinite(result.overdueCount) ? Number(result.overdueCount) : null;
        })
        .catch(() => null);
      const currentMonth = today.slice(0, 7);
      const businessDay = Number(today.slice(-2));
      const staffResultPromise = supabase.rpc("list_staff_compensation", {
        p_institute_id: activeSelection.instituteId,
        p_branch_id: activeSelection.branchId || null,
      });

      if (activeSelection.branchId) {
        overdueQuery = overdueQuery.eq("branch_id", activeSelection.branchId);
        latestPaymentQuery = latestPaymentQuery.eq("branch_id", activeSelection.branchId);
      }

      let salaryPaymentQuery = supabase.from("salary_payments").select("staff_id")
        .eq("institute_id", activeSelection.instituteId).eq("payroll_month", currentMonth);
      if (activeSelection.branchId) salaryPaymentQuery = salaryPaymentQuery.eq("branch_id", activeSelection.branchId);
      const [overdueResult, paymentResult, expenseCount, currentSalaryPayments, staffResult] = await Promise.all([
        overdueQuery,
        latestPaymentQuery,
        expenseCountRequest,
        salaryPaymentQuery,
        staffResultPromise,
      ]);
      if (!active) return;

      const paidStaffIds = new Set((currentSalaryPayments.data ?? []).map((row) => row.staff_id));
      const salaryCount = staffResult.error || currentSalaryPayments.error
        ? null
        : (staffResult.data ?? []).filter((staff) => Number(staff.monthly_salary) > 0
          && (!staff.joining_date || staff.joining_date <= today)
          && staff.payment_day !== null && staff.payment_day <= businessDay
          && !paidStaffIds.has(staff.id)).length;

      const latest = paymentResult.error ? null : paymentResult.data?.[0]?.created_at ?? null;
      let shouldShowNewPayment = false;
      let shouldClearNewPayment = false;
      if (!initialized) {
        initialized = true;
        if (latest && !paymentResult.error) {
          try {
            const seen = window.sessionStorage.getItem(activePaymentSeenKey);
            if (pathname === "/payments/history" || !seen) {
              window.sessionStorage.setItem(activePaymentSeenKey, latest);
              shouldClearNewPayment = pathname === "/payments/history";
            } else if (!Number.isFinite(Date.parse(seen)) || Date.parse(latest) > Date.parse(seen)) {
              shouldShowNewPayment = true;
            }
          } catch {
            // Keep the indicator session-local; storage restrictions should not break navigation.
          }
        }
      } else if (latest && !paymentResult.error && pathname === "/payments/history") {
        try {
          window.sessionStorage.setItem(activePaymentSeenKey, latest);
          shouldClearNewPayment = true;
        } catch {
          // Keep the indicator session-local; storage restrictions should not break navigation.
        }
      } else if (latest && !paymentResult.error) {
        try {
          const seen = window.sessionStorage.getItem(activePaymentSeenKey);
          shouldShowNewPayment = !seen || !Number.isFinite(Date.parse(seen)) || Date.parse(latest) > Date.parse(seen);
        } catch {
          // Keep the indicator session-local; storage restrictions should not break navigation.
        }
      }

      setPaymentIndicators((previous) => {
        const sameScope = previous.scopeKey === activePaymentSeenKey;
        return {
          scopeKey: activePaymentSeenKey,
          overdueCount: overdueResult.error
            ? (sameScope ? previous.overdueCount : null)
            : overdueResult.count ?? 0,
          overdueExpenseCount: expenseCount === null
            ? (sameScope ? previous.overdueExpenseCount : null)
            : expenseCount,
          overdueSalaryCount: salaryCount === null
            ? (sameScope ? previous.overdueSalaryCount : null)
            : salaryCount,
          hasNewPayment: shouldShowNewPayment || (sameScope && previous.hasNewPayment && !shouldClearNewPayment),
          latestPaymentCreatedAt: latest ?? (sameScope ? previous.latestPaymentCreatedAt : null),
        };
      });
    }

    void refreshSidebarIndicators().catch(() => undefined);
    const interval = window.setInterval(() => {
      void refreshSidebarIndicators().catch(() => undefined);
    }, 60_000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [canViewPayments, pathname, paymentSeenKey, selectedInstitute, selection, workspaceScope.loading]);

  function markPaymentHistorySeen() {
    setPaymentIndicators((previous) => ({
      scopeKey: paymentSeenKey,
      overdueCount: previous.scopeKey === paymentSeenKey ? previous.overdueCount : null,
      overdueExpenseCount: previous.scopeKey === paymentSeenKey ? previous.overdueExpenseCount : null,
      overdueSalaryCount: previous.scopeKey === paymentSeenKey ? previous.overdueSalaryCount : null,
      hasNewPayment: false,
      latestPaymentCreatedAt: previous.scopeKey === paymentSeenKey ? previous.latestPaymentCreatedAt : null,
    }));
    if (!paymentSeenKey || !latestPaymentCreatedAt) return;
    try {
      window.sessionStorage.setItem(paymentSeenKey, latestPaymentCreatedAt);
    } catch {
      // Navigation should still work if session storage is unavailable.
    }
  }

  async function signOut() {
    if (!supabaseConfigured || signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    const { error } = await createSupabaseBrowserClient().auth.signOut();
    if (error) {
      setSignOutError("Sign out failed. Please try again.");
      setSigningOut(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  // Automatically expand the section containing the current route.
  useEffect(() => {
    const activeSection = navigation.find(
      (item) =>
        "children" in item &&
        item.children?.some((child) => isActiveHref(child.href, pathname, queryString))
    );

    const timer = window.setTimeout(() => {
      setExpanded(activeSection ? [activeSection.label] : []);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname, queryString]);

  // Close the mobile drawer when navigating.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, queryString]);

  function toggle(label: string) {
    setExpanded((previous) =>
      previous.includes(label)
        ? previous.filter((item) => item !== label)
        : [...previous, label]
    );
  }

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <button
          type="button"
          suppressHydrationWarning
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-950/50 md:hidden"
        />
      )}

      <aside
        id="workspace-navigation"
        aria-label="Main navigation"
        className={`bizbook-sidebar fixed inset-y-0 left-0 z-50 flex w-[min(84vw,320px)] flex-col transition-[transform,visibility] duration-200 md:w-72 md:translate-x-0 ${
          open ? "visible translate-x-0" : "invisible -translate-x-full md:visible"
        }`}
      >
        {/* Brand */}
        <div className="bizbook-sidebar-brand flex h-[78px] shrink-0 items-center justify-between px-5">
          <Link
            href="/dashboard"
            onClick={onClose}
            className="flex min-w-0 items-center gap-3"
          >
            <div className="bizbook-sidebar-mark flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white ring-1 ring-white/20">
              <Building2 size={23} strokeWidth={2.3} />
            </div>

            <div className="min-w-0">
              <span className="text-lg font-bold tracking-tight text-white">
                BizBook
              </span>
              <p
                className="bizbook-sidebar-muted max-w-[190px] truncate text-xs"
                title={selectedInstitute?.name ?? "Coaching Centre Workspace"}
              >
                {selectedInstitute?.name ?? "Coaching Centre Workspace"}
              </p>
            </div>
          </Link>

          <button
            type="button"
            suppressHydrationWarning
            onClick={onClose}
            aria-label="Close menu"
            className="bizbook-sidebar-close rounded-lg p-2 transition md:hidden"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="bizbook-sidebar-nav min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-4">
          <p className="bizbook-sidebar-label mb-3 px-3 text-[10px] font-bold tracking-[0.2em]">
            WORKSPACE
          </p>

          <label className="mx-1 mb-3 flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-violet-100 focus-within:border-violet-300/50 focus-within:bg-white/10">
            <Search size={15} className="shrink-0 text-violet-300" aria-hidden="true" />
            <input
              type="search"
              aria-label="Find a page"
              placeholder="Find a page"
              value={navSearch}
              onChange={(event) => setNavSearch(event.target.value)}
              className="min-w-0 flex-1 bg-transparent py-2 text-xs text-white outline-none placeholder:text-violet-200/55"
            />
          </label>

          {visibleNavigation.length === 0 && <p role="status" className="px-3 py-4 text-xs leading-5 text-violet-200/70">No pages match “{navSearch}”. Try a shorter search.</p>}

          {visibleNavigation.map((item) => {
            const Icon = item.icon;
            const hasChildren =
              "children" in item && !!item.children;

            const children = "children" in item ? item.children ?? [] : [];
            const isOpen = expanded.includes(item.label) || (!!navSearch.trim() && hasChildren);

            const active =
              ("href" in item && typeof item.href === "string" && isActiveHref(item.href, pathname, queryString)) ||
              children.some((child) => isActiveHref(child.href, pathname, queryString));

            return (
              <div key={item.label}>
                {"href" in item && item.href ? (
                  <Link
                    href={item.href}
                    onClick={() => { setNavSearch(""); onClose(); }}
                    aria-current={
                      isActiveHref(item.href, pathname, queryString) ? "page" : undefined
                    }
                    className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${
                      active
                        ? "bizbook-nav-active"
                        : "bizbook-nav-link"
                    }`}
                  >
                    <Icon size={19} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                      {item.label}
                    </span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    suppressHydrationWarning
                    onClick={() => toggle(item.label)}
                    aria-expanded={isOpen}
                    className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${
                      active
                        ? "bizbook-nav-section-active"
                        : "bizbook-nav-link"
                    }`}
                  >
                    <Icon size={19} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                      {item.label}
                    </span>

                    {item.label === "Payments & Collections" && !isOpen && canViewPayments && <SidebarAlertBadge count={overdueCount} label="student installment payments overdue" />}
                    {item.label === "My Business" && !isOpen && canViewPayments && <SidebarAlertBadge count={overdueSalaryCount} label="salary payments past their due day" />}
                    {item.label === "Expenses" && !isOpen && canViewPayments && <SidebarAlertBadge count={overdueExpenseCount} label="expenses overdue" />}
                    {item.label === "Payments & Collections" && !isOpen && hasNewPayment && <span className="relative inline-flex size-2 shrink-0" aria-label="New payment recorded"><span className="absolute inline-flex size-full motion-safe:animate-ping rounded-full bg-cyan-300 opacity-75" /><span className="relative size-2 rounded-full bg-cyan-300" /><span className="sr-only">New payment recorded</span></span>}

                    {isOpen ? (
                      <ChevronDown
                        size={16}
                        className="bizbook-nav-chevron shrink-0"
                      />
                    ) : (
                      <ChevronRight
                        size={16}
                        className="bizbook-nav-chevron shrink-0"
                      />
                    )}
                  </button>
                )}

                {/* Nested navigation */}
                {hasChildren && isOpen && (
                  <div className="bizbook-sidebar-subnav ml-5 mt-1 space-y-1 border-l py-1 pl-3">
                    {children.map((child) => {
                      const childActive = isActiveHref(child.href, pathname, queryString);

                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={() => {
                            setNavSearch("");
                            onClose();
                            if (child.href === "/payments/history") markPaymentHistorySeen();
                          }}
                          aria-current={
                            childActive ? "page" : undefined
                          }
                          className={`bizbook-subnav-link flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-xs transition ${
                            childActive
                              ? "bizbook-subnav-active font-semibold"
                              : ""
                          } ${hasNewPayment && child.href === "/payments/history" ? "border border-rose-400/30 bg-rose-500/10 font-semibold text-rose-100 shadow-[0_0_16px_rgba(244,63,94,.14)]" : ""}`}
                        >
                          <span>{child.label}</span>
                          {child.href === "/payments/overdue" && canViewPayments && <SidebarAlertBadge count={overdueCount} label="student installment payments overdue" />}
                          {child.href === "/business/salary" && canViewPayments && <SidebarAlertBadge count={overdueSalaryCount} label="salary payments past their due day" />}
                          {child.href === "/expenses/record-payment" && canViewPayments && <SidebarAlertBadge count={overdueExpenseCount} label="expenses overdue" />}
                          {child.href === "/payments/history" && hasNewPayment && (
                            <span className="relative inline-flex h-2 w-2 shrink-0" aria-label="New payment recorded">
                              <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-red-500 opacity-75" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                              <span className="sr-only">New payment recorded</span>
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="bizbook-sidebar-footer shrink-0 p-4">
          <div className="bizbook-sidebar-promo rounded-2xl p-4">
            <p className="bizbook-sidebar-muted text-xs">
              Business workspace
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              Manage smarter with BizBook
            </p>
          </div>
          {supabaseConfigured && (
            <>
              <button type="button" suppressHydrationWarning onClick={signOut} disabled={signingOut} className="bizbook-signout mt-3 inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold transition disabled:opacity-50">
                <LogOut size={16} />{signingOut ? "Signing out…" : "Sign out"}
              </button>
              {signOutError && <p role="alert" className="mt-1 text-xs text-rose-600">{signOutError}</p>}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
