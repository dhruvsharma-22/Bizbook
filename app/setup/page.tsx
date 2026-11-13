"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, LoaderCircle } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim());

export default function SetupPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [continueToSubscription, setContinueToSubscription] = useState(false);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    const params = new URLSearchParams(window.location.search);
    void Promise.resolve().then(() => { if (active) setContinueToSubscription(params.get("next") === "/settings/subscription"); });
    void (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError || !auth.user) { router.replace("/login"); return; }
        const { data: memberships, error: membershipError } = await supabase.from("user_memberships")
          .select("institute_id").eq("user_id", auth.user.id).eq("is_active", true).limit(1);
        if (membershipError) throw new Error("Your institute access could not be checked.");
        if (memberships?.length) { router.replace("/dashboard"); router.refresh(); return; }
        if (active) setReady(true);
      } catch (cause) { if (active) { setError(cause instanceof Error ? cause.message : "Your account could not be checked."); setReady(true); } }
    })();
    return () => { active = false; };
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = businessName.trim();
    if (!name || name.length > 100) { setError("Enter an institute name between 1 and 100 characters."); return; }
    setBusy(true); setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: createError } = await supabase.rpc("create_coaching_institute_with_configured_trial", { p_business_name: name });
      if (createError) throw createError;
      if (typeof data !== "string" || !data) throw new Error("BizBook did not return the new institute workspace.");
      router.replace(continueToSubscription ? "/settings/subscription" : "/dashboard");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create your institute workspace."); }
    finally { setBusy(false); }
  }

  if (!configured) return <main className="bizbook-auth-shell flex min-h-screen items-center justify-center p-4"><section className="max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">Supabase is not configured. Add the public Supabase URL and publishable key to enable account setup. <Link className="ml-1 font-semibold underline" href="/login">Return to sign in</Link>.</section></main>;

  return <main className="bizbook-auth-shell flex min-h-screen items-center justify-center px-4 py-10"><form onSubmit={submit} className="bizbook-auth-card w-full max-w-lg space-y-5 rounded-3xl bg-white p-6 sm:p-8">
    <div className="flex size-12 items-center justify-center rounded-xl bg-violet-50 text-[#5B21B6]"><Building2 size={24} /></div>
    <div><p className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">Welcome to BizBook</p><h1 className="mt-1 text-2xl font-bold text-slate-950">Create your institute workspace</h1><p className="mt-2 text-sm leading-6 text-slate-500">Your account is ready. Set up your institute to open the dashboard. A subscription is optional and can be chosen later.</p></div>
    <label className="block text-sm font-medium text-slate-700">Institute or business name<input required minLength={1} maxLength={100} autoComplete="organization" value={businessName} onChange={(event) => setBusinessName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[#5B21B6] focus:ring-2 focus:ring-violet-100" /></label>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <button type="submit" disabled={!ready || busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#5B21B6] px-4 py-3 text-sm font-semibold text-white hover:bg-[#4C1D95] disabled:cursor-not-allowed disabled:opacity-50">{busy || !ready ? <LoaderCircle size={17} className="animate-spin" /> : null}{busy ? "Creating workspace…" : ready ? "Continue to BizBook" : "Checking account…"}</button>
    {continueToSubscription && <p className="text-center text-xs text-slate-500">You can review plan options after your institute is created.</p>}
  </form></main>;
}
