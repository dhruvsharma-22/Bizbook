"use client";

import { useEffect, useMemo, useState } from "react";
import { Clipboard, ExternalLink, ShieldCheck } from "lucide-react";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const configured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
);

export default function SecuritySettingsPage() {
  const [isInstituteManager, setIsInstituteManager] = useState(false);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [appOrigin, setAppOrigin] = useState("");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const projectRef = useMemo(() => {
    try { return new URL(supabaseUrl).hostname.split(".")[0] ?? ""; } catch { return ""; }
  }, [supabaseUrl]);
  const projectAuthCallback = useMemo(() => {
    try { return new URL("/auth/v1/callback", supabaseUrl).toString(); } catch { return ""; }
  }, [supabaseUrl]);
  const dashboardPath = projectRef
    ? `https://supabase.com/dashboard/project/${encodeURIComponent(projectRef)}/auth/providers`
    : "https://supabase.com/dashboard";

  useEffect(() => {
    if (!configured) return;
    let active = true;
    void (async () => {
      try {
        await Promise.resolve();
        if (active) setAppOrigin(window.location.origin);
        const supabase = createSupabaseBrowserClient();
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError || !auth.user) return;
        const { data: memberships, error: membershipError } = await supabase
          .from("user_memberships")
          .select("role")
          .eq("user_id", auth.user.id)
          .eq("is_active", true);
        if (membershipError) throw new Error("Could not verify institute settings access.");
        if (active) setIsInstituteManager((memberships ?? []).some((membership) => membership.role === "owner" || membership.role === "administrator"));
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load security setup.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyNotice(`${label} copied.`);
    } catch {
      setCopyNotice("Clipboard access is unavailable. Select and copy the value manually.");
    }
  }

  return (
    <WorkspaceLayout>
      <main className="p-4 sm:p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <header>
            <p className="text-sm font-semibold text-[#5B21B6]">Institute settings</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Login and security setup</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              BizBook calls Supabase Auth for email/password, Google OAuth, email OTP, and phone OTP. Project-level provider credentials are managed in Supabase Auth; this page does not save credentials or claim a provider is connected.
            </p>
          </header>

          {!configured && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              Configure the authorized test Supabase URL and publishable key before setting up Auth providers.
            </section>
          )}
          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
          {loading && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Checking institute manager access…</p>}
          {!loading && configured && !isInstituteManager && (
            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">An active institute owner or administrator membership is required to view this setup guide.</p>
          )}

          {isInstituteManager && (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <ShieldCheck size={21} className="mt-0.5 text-[#5B21B6]" />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold text-slate-900">Google OAuth callback values</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">Add the Supabase callback to Google Cloud OAuth, then add the BizBook callback under Supabase Auth redirect URLs. Use the test project values shown here; production setup remains separate.</p>
                    <div className="mt-4 space-y-3">
                      <CopyRow label="Google authorized JavaScript origin" value={appOrigin} onCopy={copyValue} />
                      <CopyRow label="Google authorized redirect URI" value={projectAuthCallback} onCopy={copyValue} />
                      <CopyRow label="Supabase Auth redirect allow-list URL" value={appOrigin ? `${appOrigin}/auth/callback` : ""} onCopy={copyValue} />
                    </div>
                    <a href={dashboardPath} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#5B21B6] underline">
                      Open this project&apos;s Supabase Auth providers <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="font-semibold text-slate-900">Email OTP and password recovery</h2>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
                  <li>Configure a custom SMTP provider and verified sender in Supabase Auth.</li>
                  <li>For numeric email OTP, configure the email template to include the Supabase Auth token as <code>{"{{ .Token }}"}</code>.</li>
                  <li>Add the BizBook callback URL above to the Auth redirect allow-list and test a signup, recovery, and OTP flow with a test account.</li>
                </ol>
                <a href="https://supabase.com/docs/guides/auth/auth-smtp" target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#5B21B6] underline">
                  Supabase custom SMTP setup <ExternalLink size={14} />
                </a>
                <a href="https://supabase.com/docs/guides/auth/auth-email-templates" target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#5B21B6] underline">
                  Supabase email template setup <ExternalLink size={14} />
                </a>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="font-semibold text-slate-900">Phone OTP</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Enable phone sign-in in Supabase Auth and configure a supported SMS provider, sender, OTP expiry, send limits, and CAPTCHA. Follow the destination country&apos;s rules for SMS delivery. BizBook displays a resend cooldown; Supabase Auth enforces the server-side send limits and expiry.</p>
                <a href="https://supabase.com/docs/guides/auth/phone-login" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#5B21B6] underline">
                  Supabase phone sign-in setup <ExternalLink size={14} />
                </a>
              </section>

              {copyNotice && <p role="status" className="text-sm text-slate-600">{copyNotice}</p>}
              <p className="text-sm text-slate-500">Provider status is not readable from the current app configuration. Verify sign-in, OTP delivery, redirect allow-lists, and Auth logs in the test Supabase project before treating any method as ready.</p>
            </>
          )}
        </div>
      </main>
    </WorkspaceLayout>
  );
}

function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: (label: string, value: string) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-500">{label}</p>
        <code className="mt-1 block break-all text-xs text-slate-800">{value || "Supabase URL is not configured"}</code>
      </div>
      <button type="button" disabled={!value} onClick={() => onCopy(label, value)} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
        <Clipboard size={14} /> Copy
      </button>
    </div>
  );
}
