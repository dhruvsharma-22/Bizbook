"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, CheckCircle2, KeyRound, LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function MemberAccountSettings() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      const { data, error: authError } = await createSupabaseBrowserClient().auth.getUser();
      if (authError || !data.user) {
        router.replace("/member-login?next=/member/settings");
        return;
      }
      if (!active) return;
      setEmail(data.user.email ?? "");
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError("Account settings could not be loaded. Please sign in again.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [router]);

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (newPassword.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const { error: updateError } = await createSupabaseBrowserClient().auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Your password has been changed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your password could not be changed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    setError("");
    try {
      const { error: signOutError } = await createSupabaseBrowserClient().auth.signOut();
      if (signOutError) throw signOutError;
      router.replace("/member-login");
      router.refresh();
    } catch {
      setError("Could not sign out. Please retry.");
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-900/15"><Building2 size={20} /></span>
            <div><p className="text-base font-extrabold tracking-tight">BizBook</p><p className="text-[11px] font-medium text-slate-500">Member portal</p></div>
          </div>
          <Link href="/member" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-violet-200 px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-50"><ArrowLeft size={15} /><span>Back to portal</span></Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-9">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-700">Your account</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">Account settings</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Manage your sign-in details and account security.</p>
        </div>

        <section className="overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-violet-100 bg-violet-50/70 px-5 py-4 sm:px-6">
            <span className="grid size-10 place-items-center rounded-xl bg-white text-violet-700 shadow-sm"><ShieldCheck size={19} /></span>
            <div className="min-w-0"><h2 className="font-bold text-slate-950">Sign-in and security</h2><p className="mt-0.5 truncate text-xs text-slate-600">{loading ? "Loading your account…" : email || "Your BizBook account"}</p></div>
          </div>

          <div className="p-5 sm:p-6">
            {loading ? <div role="status" className="flex items-center gap-2 py-3 text-sm text-slate-500"><LoaderCircle size={17} className="animate-spin" />Loading account settings…</div> : (
              <form onSubmit={updatePassword} className="space-y-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><KeyRound size={17} /></span>
                  <div><h3 className="text-sm font-bold text-slate-900">Change password</h3><p className="mt-1 text-xs leading-5 text-slate-500">Use at least 8 characters. This updates the password for your BizBook account.</p></div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-semibold text-slate-700">New password
                    <input required minLength={8} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 8 characters" className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">Confirm new password
                    <input required minLength={8} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Type it again" className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
                  </label>
                </div>
                {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">{error}</p>}
                {notice && <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800"><CheckCircle2 size={15} />{notice}</p>}
                <button type="submit" disabled={busy || loading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-700 to-indigo-700 px-4 text-xs font-bold text-white shadow-sm transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60">{busy ? <LoaderCircle size={15} className="animate-spin" /> : <KeyRound size={15} />}{busy ? "Updating password…" : "Save new password"}</button>
              </form>
            )}
          </div>
        </section>

        <section className="flex flex-col justify-between gap-4 rounded-2xl border border-rose-100 bg-rose-50/40 p-5 sm:flex-row sm:items-center sm:px-6">
          <div><h2 className="text-sm font-bold text-slate-900">Sign out</h2><p className="mt-1 text-xs text-slate-600">Sign out of this BizBook account on this device.</p></div>
          <button type="button" disabled={signingOut || loading} onClick={() => void signOut()} className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-xl border border-rose-200 bg-white px-4 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60 sm:self-auto"><LogOut size={15} />{signingOut ? "Signing out…" : "Sign out"}</button>
        </section>
      </main>
    </div>
  );
}
