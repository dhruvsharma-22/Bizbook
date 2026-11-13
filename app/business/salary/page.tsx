import Link from "next/link";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import SharedPayrollWorkspace from "@/components/business/SharedPayrollWorkspace";

export default function SalaryPage() {
  return (
    <WorkspaceLayout>
      <section className="mx-3 mt-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:mx-5 sm:flex-row sm:items-center sm:justify-between sm:p-5 lg:mx-6">
        <div>
          <h2 className="font-bold text-slate-900">Shared institute payroll</h2>
          <p className="mt-1 text-sm text-slate-600">Salary records are saved to the selected institute and branch. Fee receipts are managed in Payment Receipts.</p>
        </div>
        <Link href="/payments/receipt-records" className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-[#5B21B6] hover:bg-slate-50">Open payment receipts</Link>
      </section>
      <SharedPayrollWorkspace />
    </WorkspaceLayout>
  );
}
