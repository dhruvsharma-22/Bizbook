"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const { error: updateError } = await createSupabaseBrowserClient().auth.updateUser({ password });
      if (updateError) throw updateError;
      const instituteId = new URLSearchParams(window.location.search).get("instituteId") ?? "";
      const destination = /^[A-Za-z0-9_-]{1,100}$/.test(instituteId)
        ? `/dashboard?instituteId=${encodeURIComponent(instituteId)}`
        : "/dashboard";
      router.replace(destination);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-[#5B21B6]">Choose a new password</h1>
        <p className="text-sm text-slate-500">Use at least 8 characters for your BizBook account.</p>
        <label className="block text-sm font-medium text-slate-700">New password<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[#5B21B6] focus:ring-2 focus:ring-violet-100" /></label>
        <label className="block text-sm font-medium text-slate-700">Confirm password<input required minLength={8} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[#5B21B6] focus:ring-2 focus:ring-violet-100" /></label>
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-[#5B21B6] px-4 py-3 text-sm font-semibold text-white hover:bg-[#4C1D95] disabled:opacity-50">{busy ? "Updating…" : "Update password"}</button>
      </form>
    </main>
  );
}
