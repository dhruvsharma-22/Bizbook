"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogOut } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function PlatformAdminSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { error: signOutError } = await createSupabaseBrowserClient().auth.signOut();
      if (signOutError) throw signOutError;
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Could not sign out. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end">
      <button type="button" aria-label="Sign out" title="Sign out" onClick={() => void signOut()} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 bg-white px-2.5 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60 sm:px-3.5 sm:text-sm">
        {busy ? <LoaderCircle size={15} className="animate-spin" /> : <LogOut size={15} />}
        <span className="hidden sm:inline">{busy ? "Signing out…" : "Sign out"}</span>
      </button>
      {error && <p role="alert" className="mt-1 text-[10px] text-rose-700">{error}</p>}
    </div>
  );
}
