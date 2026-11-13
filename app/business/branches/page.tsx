"use client";

import { Building2 } from "lucide-react";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";

export default function BranchesPage() {
  return (
    <WorkspaceLayout>
      <main className="p-4 sm:p-6">
        <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <span className="grid size-11 place-items-center rounded-xl bg-violet-50 text-violet-800"><Building2 size={21} /></span>
          <p className="mt-5 text-xs font-bold uppercase tracking-wider text-violet-700">Workspace settings</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">Branch management is paused</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">Branch creation and switching are currently unavailable in the BizBook workspace. Existing branch data and membership restrictions are retained in the database and continue to be enforced.</p>
          <p className="mt-3 text-sm leading-6 text-slate-600">New members are added to the institute and receive permissions through their assigned role.</p>
        </section>
      </main>
    </WorkspaceLayout>
  );
}
