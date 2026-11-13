"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "login" | "signup" | "recover" | "confirmation";
type LoginAudience = "workspace" | "member";

function authReturnPath(audience: LoginAudience, afterSignup = false): string {
  if (audience === "member") return "/member";
  const params = new URLSearchParams(window.location.search);
  if (afterSignup) return params.get("next") === "/settings/subscription" ? "/setup?next=%2Fsettings%2Fsubscription" : "/setup";
  if (params.get("next") === "/settings/subscription") return "/settings/subscription";
  if (params.get("next") === "/platform-admin") return "/platform-admin";
  if (params.get("next") === "/account") return "/account";
  if (params.get("next") === "/account/invitations") return "/account";
  return "/account";
}

function authCallbackUrl(audience: LoginAudience, afterSignup = false): string {
  const callback = new URL("/auth/callback", window.location.origin);
  callback.searchParams.set("next", authReturnPath(audience, afterSignup));
  return callback.toString();
}

function authErrorMessage(reason: unknown, fallback: string): string {
  if (reason && typeof reason === "object") {
    const error = reason as { code?: unknown; status?: unknown; message?: unknown };
    if (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit" || error.status === 429) {
      return "Email delivery is temporarily rate-limited by the authentication provider. Wait a little, then try again.";
    }
    if (typeof error.message === "string") {
      const message = error.message.toLowerCase();
      if (message.includes("already registered") || message.includes("already exists")) {
        return "This email already has a BizBook account. Sign in with that account; one email works across its institute invitations.";
      }
      return error.message;
    }
  }
  return fallback;
}

const configured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
);

const inputClass = "mt-1 h-11 w-full rounded-xl border border-slate-200/90 bg-white/95 px-3.5 text-sm text-slate-900 shadow-sm outline-none transition duration-200 placeholder:text-slate-400 hover:border-violet-300 focus:border-violet-500 focus:ring-4 focus:ring-violet-100/80";

function LoginArtwork() {
  return (
    <aside aria-hidden="true" className="bizbook-login-artwork relative order-1 hidden min-h-0 overflow-hidden lg:block">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <svg viewBox="0 0 640 900" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
          <defs>
            <pattern id="bizbook-art-dots" width="30" height="30" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.2" fill="white" fillOpacity=".3" />
            </pattern>
            <linearGradient id="bizbook-art-ribbon-a" x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#f5d0fe" stopOpacity=".35" />
              <stop offset="1" stopColor="#c4b5fd" stopOpacity=".05" />
            </linearGradient>
            <linearGradient id="bizbook-art-ribbon-b" x1="1" y1="0" x2="0" y2="1">
              <stop stopColor="#a5b4fc" stopOpacity=".28" />
              <stop offset="1" stopColor="#e9d5ff" stopOpacity=".04" />
            </linearGradient>
            <radialGradient id="bizbook-art-glow">
              <stop stopColor="#f5d0fe" stopOpacity=".42" />
              <stop offset="1" stopColor="#c4b5fd" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="640" height="900" fill="url(#bizbook-art-dots)" opacity=".42" />
          <circle cx="110" cy="175" r="245" fill="url(#bizbook-art-glow)" />
          <circle cx="575" cy="710" r="300" fill="url(#bizbook-art-glow)" opacity=".62" />
          <path d="M-130 526C36 376 132 349 255 419c111 63 177 69 279-14 83-67 146-92 241-45v540H-130z" fill="url(#bizbook-art-ribbon-a)" />
          <path d="M-110 644c144-112 246-165 365-105 114 58 172 152 311 67 70-43 119-101 209-102v396H-110z" fill="url(#bizbook-art-ribbon-b)" />
          <path d="M-110 307c132-88 215-117 321-74 89 36 150 111 239 89 78-19 130-89 214-125" fill="none" stroke="#f5eaff" strokeOpacity=".32" strokeWidth="2" />
          <path d="M-104 345c139-88 219-107 322-61 83 37 150 102 237 80 83-21 135-84 217-120" fill="none" stroke="#ddd6fe" strokeOpacity=".27" strokeWidth="2" />
          <path d="M-112 708c143-96 241-138 350-92 98 42 162 111 266 68 70-29 120-83 181-111" fill="none" stroke="#f5d0fe" strokeOpacity=".3" strokeWidth="2" />
          <path d="M-88 746c142-94 238-129 347-82 93 41 160 104 263 63 71-29 121-75 171-102" fill="none" stroke="#ddd6fe" strokeOpacity=".2" strokeWidth="2" />
          <circle cx="493" cy="250" r="5" fill="#f5d0fe" fillOpacity=".8" />
          <circle cx="530" cy="279" r="2.5" fill="#fff" fillOpacity=".78" />
          <circle cx="465" cy="292" r="2.5" fill="#ddd6fe" fillOpacity=".9" />
          <path d="m128 215 7 17 17 7-17 7-7 17-7-17-17-7 17-7z" fill="#f5d0fe" fillOpacity=".72" />
          <path d="m520 565 5 12 12 5-12 5-5 12-5-12-12-5 12-5z" fill="#e9d5ff" fillOpacity=".78" />
        </svg>
      </div>
    </aside>
  );
}
export default function LoginPage({ audience = "workspace" }: { audience?: LoginAudience }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setTimeout(() => setCooldownSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownSeconds]);

  async function signInWithGoogle() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!configured) throw new Error("Supabase Auth is not configured for this deployment.");
      const { error: authError } = await createSupabaseBrowserClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: authCallbackUrl(audience) },
      });
      if (authError) throw authError;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google sign-in is not available.");
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    if (!configured || !email.trim() || busy || cooldownSeconds > 0) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { error: resendError } = await createSupabaseBrowserClient().auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: authCallbackUrl(audience, true) },
      });
      if (resendError) throw resendError;
      setCooldownSeconds(20);
      setNotice("A new confirmation email was requested. Use the link in it to verify your account.");
    } catch (reason) {
      setError(authErrorMessage(reason, "Could not resend the confirmation email."));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      if (!configured) throw new Error("Supabase Auth is not configured for this deployment.");
      const supabase = createSupabaseBrowserClient();

      if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        router.replace(authReturnPath(audience));
        router.refresh();
        return;
      }

      if (mode === "signup") {
        if (name.trim().length > 100) throw new Error("Name must be 100 characters or fewer.");
        if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { name: name.trim() }, emailRedirectTo: authCallbackUrl(audience, true) },
        });
        if (authError) throw authError;
        if (data.user?.identities?.length === 0) {
          setPassword("");
          setMode("login");
          throw new Error("This email already has a BizBook account. Sign in with that account instead.");
        }
        if (data.session) {
          await supabase.auth.signOut();
          throw new Error("Email confirmation is disabled in Supabase Auth. Enable it so new accounts verify their email before entering BizBook.");
        }
        setMode("confirmation");
        setCooldownSeconds(20);
        setNotice(`A confirmation email was requested for ${email.trim()}. Open its link to verify your account and continue.`);
        return;
      }

      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", "/account/update-password");
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: callback.toString() });
      if (authError) throw authError;
      setNotice("If an account exists for that address, a password reset link has been sent.");
    } catch (reason) {
      setError(authErrorMessage(reason, "Unable to complete the request."));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "login" ? "Welcome back"
    : mode === "signup" ? "Create your account"
      : mode === "recover" ? "Reset your password"
        : "Check your email";
  const description = mode === "login"
    ? audience === "member" ? "Sign in to view your institute invitations and workspace access." : "Sign in to manage your institute workspace."
    : mode === "signup"
      ? audience === "member" ? "Create one account to accept invitations from your institutes." : "Create your account, then set up your institute workspace."
      : mode === "recover" ? "Enter your account email and we’ll send a secure password reset link." : "Verify your email address to finish setting up your BizBook account.";
  const submitLabel = mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link";

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[radial-gradient(ellipse_at_top_left,_#e7eaff_0%,_transparent_42%),radial-gradient(ellipse_at_bottom_right,_#fff0d6_0%,_transparent_38%),#f5f6fc] px-3 py-4 font-sans antialiased sm:px-6 sm:py-7 lg:grid lg:h-dvh lg:min-h-0 lg:place-items-center lg:overflow-hidden lg:p-5">
      <section className="relative mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-[1040px] overflow-hidden rounded-[28px] border border-white/80 bg-white/95 shadow-[0_30px_100px_rgba(25,34,74,0.18)] backdrop-blur-xl sm:min-h-[min(760px,calc(100dvh-3.5rem))] lg:h-[calc(100dvh-2.5rem)] lg:max-h-[680px] lg:min-h-[480px] lg:grid lg:grid-cols-2">
        <LoginArtwork />
        <div className="order-2 flex min-w-0 flex-1 flex-col px-5 py-5 sm:px-8 sm:py-6 lg:px-9 lg:py-5 xl:px-10">
          <header className="hidden items-center gap-3 lg:flex">
            <span className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-blue-600 text-white shadow-lg shadow-violet-700/25 ring-1 ring-white/60"><Building2 size={19} /></span>
            <span>
              <span className="block text-[14px] font-bold tracking-tight text-slate-950">BizBook</span>
              <span className="block text-[10px] font-medium text-slate-600">{audience === "member" ? "Member portal" : "Institute workspace"}</span>
            </span>
          </header>

          <div className="my-auto w-full max-w-[340px] self-center py-5 lg:py-3">
            <h1 className="text-[27px] font-extrabold leading-tight tracking-[-0.04em] text-slate-950 sm:text-[30px]">{title}</h1>
            <p className="mt-2 max-w-sm text-[13px] leading-6 text-slate-600">{description}</p>

            {!configured && (
              <div role="status" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                Supabase Auth is not configured. Set the public Supabase URL and publishable key in the deployment environment to enable accounts.
              </div>
            )}

            {mode === "confirmation" ? (
              <section className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-950">
                <span className="grid size-10 place-items-center rounded-full bg-white text-emerald-700 shadow-sm"><CheckCircle2 size={21} /></span>
                <p className="mt-3 font-bold">Confirmation email requested</p>
                <p className="mt-1">{notice}</p>
                {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
                <button type="button" disabled={busy || cooldownSeconds > 0 || !configured} onClick={() => void resendConfirmation()} className="mt-4 min-h-10 rounded-lg border border-emerald-300 bg-white px-4 text-xs font-bold text-emerald-900 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50">
                  {cooldownSeconds > 0 ? `Resend email in ${cooldownSeconds}s` : "Resend confirmation email"}
                </button>
              </section>
            ) : (
              <form onSubmit={submit} className="mt-5 space-y-3">
                {mode === "signup" && (
                  <label className="block text-[13px] font-semibold text-slate-800">
                    Your name
                    <input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} className={inputClass} placeholder="Your full name" />
                  </label>
                )}
                <label className="block text-[13px] font-semibold text-slate-800">
                  Email address
                  <span className="relative block">
                    <Image src="/brand/gmail.webp" alt="" aria-hidden="true" width={18} height={18} className="pointer-events-none absolute left-3.5 top-[calc(50%+2px)] -translate-y-1/2 rounded-sm" />
                    <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} className={`${inputClass} pl-10`} placeholder="you@example.com" />
                  </span>
                </label>

                {(mode === "login" || mode === "signup") && (
                  <label className="block text-[13px] font-semibold text-slate-800">
                    <span className="flex items-center justify-between gap-3">
                      {mode === "signup" ? "Create a password" : "Password"}
                      {mode === "login" && <button type="button" onClick={() => { setMode("recover"); setError(""); setNotice(""); }} className="text-xs font-semibold text-blue-700 hover:text-blue-900 hover:underline">Forgot password?</button>}
                    </span>
                    <span className="relative block">
                      <LockKeyhole size={16} className="pointer-events-none absolute left-3.5 top-[calc(50%+2px)] -translate-y-1/2 text-slate-400" />
                      <input required type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={mode === "signup" ? 8 : undefined} className={`${inputClass} px-10`} placeholder={mode === "signup" ? "At least 8 characters" : "Enter your password"} />
                      <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-2.5 top-2 grid size-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </span>
                  </label>
                )}

                {error && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs leading-5 text-rose-800">{error}</p>}
                {notice && <p role="status" className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">{notice}</p>}

                <button type="submit" disabled={busy || !configured} className="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-700 via-indigo-700 to-blue-700 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-900/20 transition duration-200 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50">
                  {busy ? <LoaderCircle size={17} className="animate-spin" /> : null}
                  {submitLabel}
                  {!busy && <ArrowRight size={17} />}
                </button>
              </form>
            )}

            {(mode === "login" || mode === "signup") && (
              <>
                <div className="my-3 flex items-center gap-3 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
                <button type="button" onClick={signInWithGoogle} disabled={busy || !configured} className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm transition duration-200 hover:border-slate-300 hover:bg-slate-50 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50">
                  <Image src="/brand/google-g-logo.png" alt="" aria-hidden="true" width={18} height={18} className="shrink-0" />
                  Continue with Google
                </button>
              </>
            )}

            <div className="mt-3 text-center text-[11px] text-slate-500">
              {mode === "login" ? (
                <>Don&apos;t have an account? <button type="button" onClick={() => { setMode("signup"); setError(""); setNotice(""); }} className="font-semibold text-blue-700 hover:text-blue-900 hover:underline">Create an account</button></>
              ) : mode === "signup" ? (
                <>Already have an account? <button type="button" onClick={() => { setMode("login"); setError(""); setNotice(""); }} className="font-semibold text-blue-700 hover:text-blue-900 hover:underline">Sign in</button></>
              ) : mode === "confirmation" ? (
                <button type="button" onClick={() => { setMode("login"); setError(""); setNotice(""); }} className="inline-flex items-center gap-1.5 font-bold text-blue-700 hover:underline"><ArrowLeft size={14} /> Back to sign in</button>
              ) : (
                <button type="button" onClick={() => { setMode("login"); setError(""); setNotice(""); }} className="inline-flex items-center gap-1.5 font-bold text-blue-700 hover:underline"><ArrowLeft size={14} /> Back to sign in</button>
              )}
            </div>

            {mode === "login" && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-xl border border-amber-200/90 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-100/70 px-3 py-3 text-center text-[11px] text-slate-700 shadow-sm shadow-amber-900/5">
                {audience === "member" ? <><span>Institute owner?</span><Link href="/login" className="font-semibold text-blue-800 hover:underline">Workspace sign in</Link></> : <><span>Part of an institute team?</span><Link href="/member-login" className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-gradient-to-r from-amber-100 to-yellow-200 px-3 py-1 font-bold text-amber-950 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-amber-400 hover:from-amber-200 hover:to-yellow-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">Member sign in <ArrowRight size={12} /></Link></>}
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-[9px] text-slate-400">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck size={13} /> Secure sign in</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
