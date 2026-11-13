/** Supabase-facing adapter for the pure BizBook Brain summary calculations. */
export {
  buildExpenseObligationSummary,
  buildDashboardFinancialSummary,
  buildProfitAndLoss,
} from "@/lib/bizbook-brain/financial-summary-engine";
export type {
  DashboardFinancialSummary,
  ExpenseObligationSummary,
  ExpenseObligationSummaryRow,
  FinancialActivitySummaryRow,
  InstallmentBalanceSummaryRow,
  ProfitAndLoss,
} from "@/lib/bizbook-brain/financial-summary-engine";

export function formatDashboardCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}
