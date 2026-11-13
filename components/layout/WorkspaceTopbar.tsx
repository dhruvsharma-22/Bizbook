"use client";

import { RefreshCw } from "lucide-react";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import WorkspaceHeaderStatus from "@/components/layout/WorkspaceHeaderStatus";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/business/profile": "Business Profile",
  "/business/students": "Students & Staff",
  "/business/attendance": "Staff Attendance",
  "/business/salary": "Payroll & Fee Records",
  "/business/members": "Members & Invitations",
  "/payments/outstanding": "Outstanding Payments",
  "/payments/history": "Payment History",
  "/payments/overdue": "Overdue Payments",
  "/payments/advance": "Advance Payments",
  "/payments/refunds": "Refund Management",
  "/payments/receipt-records": "Record Payment",
  "/payments/reminders": "Reminder Status",
  "/expenses": "Expense Ledger",
  "/expenses/fixed-monthly": "Monthly Expense Reminders",
  "/expenses/record-payment": "Record Expense Payment",
  "/reports/financial-summary": "Financial Summary",
  "/reports/profit-loss": "Profit & Loss",
  "/reports/revenue-expenses": "Revenue & Expenses",
  "/reports/collection-forecast": "Collection Forecast",
  "/reports/comparisons": "Comparisons",
  "/settings/security": "Login & Security",
  "/settings/integrations": "Payment Integrations",
  "/plans": "Plan Pricing",
  "/settings/subscription": "Plans & Subscription",
  "/settings/data-import": "Legacy Data Review",
  "/settings/account": "Account Settings",
  "/support": "Support",
  "/member": "Member Portal",
};

export default function WorkspaceTopbar({ pathname }: { pathname: string }) {
  const { loading, error, blocker, refresh } = useWorkspaceScope();
  const pageName = PAGE_TITLES[pathname]
    ?? pathname.split("/").filter(Boolean).at(-1)?.replaceAll("-", " ")
    ?? "Dashboard";

  return (
    <header className="bizbook-topbar sticky top-0 z-20" aria-label="Workspace header">
      <div className="mx-auto flex min-h-[68px] max-w-[1680px] items-center gap-2 px-3 py-2 pl-16 sm:min-h-[72px] sm:px-5 sm:pl-20 md:px-7">
        <div className="min-w-0 flex-1">
          <p className="bizbook-topbar-eyebrow truncate text-[9px] font-bold uppercase tracking-[0.17em] sm:text-[10px]">BizBook Workspace</p>
          <p className="truncate text-base font-bold tracking-tight text-slate-900 sm:text-lg">{pageName}</p>
        </div>
        <WorkspaceHeaderStatus />
      </div>

      {(blocker || error) && (
        <div role="status" className="mx-auto flex max-w-[1680px] items-center justify-between gap-3 border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900 sm:px-6">
          <span>{blocker || error}</span>
          {error && !blocker && <button type="button" onClick={refresh} disabled={loading} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-bold text-violet-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50"><RefreshCw size={13} />Retry</button>}
        </div>
      )}
    </header>
  );
}
