"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  LogOut,
  MailCheck,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { MEMBER_ROLE_DESCRIPTIONS, type ManagedInstituteRole, type MemberAccessScope } from "@/lib/supabase/member-management";
import {
  isAuthorizedTestProjectConfigured,
  loadWorkspaceBranches,
  loadWorkspaceInstitutes,
  saveWorkspaceScopePreference,
  type WorkspaceInstitute,
} from "@/lib/supabase/workspace-scope";

type AccountInvitation = {
  id: string;
  institute_id: string;
  institute_name: string;
  role: ManagedInstituteRole;
  access_scope: MemberAccessScope;
  branch_ids: string[];
  expires_at: string;
  created_at: string;
};

function roleName(role: ManagedInstituteRole) {
  return role[0].toUpperCase() + role.slice(1);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default function MemberAccountHome() {
  const router = useRouter();
  const projectConfigured = isAuthorizedTestProjectConfigured();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [verified, setVerified] = useState(false);
  const [institutes, setInstitutes] = useState<WorkspaceInstitute[]>([]);
  const [invitations, setInvitations] = useState<AccountInvitation[]>([]);
  const [loading, setLoading] = useState(projectConfigured);
  const [workingId, setWorkingId] = useState("");
  const [error, setError] = useState(projectConfigured ? "" : "Member access is unavailable because this deployment is not connected to the authorized BizBook database.");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!projectConfigured) return;
    let current = true;
    void Promise.resolve().then(async () => {
      setLoading(true);
      setError("");
      const supabase = createSupabaseBrowserClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        router.replace("/member-login?next=/member");
        return;
      }
      if (!current) return;
      const userEmail = authData.user.email ?? "";
      setEmail(userEmail);
      setDisplayName(typeof authData.user.user_metadata?.name === "string" ? authData.user.user_metadata.name : "");
      const isVerified = Boolean(authData.user.email_confirmed_at);
      setVerified(isVerified);
      const activeInstitutes = await loadWorkspaceInstitutes(supabase);
      if (!current) return;
      setInstitutes(activeInstitutes);
      if (!isVerified) {
        setInvitations([]);
      } else {
        const { data, error: invitationError } = await supabase.rpc("list_my_member_access_invitations");
        if (invitationError) throw new Error(invitationError.message);
        if (!current) return;
        setInvitations(data ?? []);
      }
      setLoading(false);
    }).catch((cause: unknown) => {
      if (current) {
        setError(cause instanceof Error ? cause.message : "Your member account could not be loaded.");
        setLoading(false);
      }
    });
    return () => { current = false; };
  }, [projectConfigured, reload, router]);

  async function acceptInvitation(invitation: AccountInvitation) {
    setWorkingId(invitation.id);
    setError("");
    setNotice("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: acceptError } = await supabase.rpc("accept_member_access_invitation", { p_invitation_id: invitation.id });
      if (acceptError) throw acceptError;
      setNotice(`You joined ${invitation.institute_name} as ${roleName(invitation.role)}. This institute is now available in your workspaces.`);
      setReload((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This invitation could not be accepted. Refresh and try again.");
    } finally {
      setWorkingId("");
    }
  }

  async function openInstitute(institute: WorkspaceInstitute) {
    setWorkingId(institute.id);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const branches = institute.accessScope === "branches" ? await loadWorkspaceBranches(supabase, institute.id) : [];
      if (institute.accessScope === "branches" && branches.length === 0) {
        throw new Error("No active branch is assigned to this account. Ask the institute owner to review your access.");
      }
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("Sign in again to open this institute.");
      await saveWorkspaceScopePreference(supabase, authData.user.id, {
        instituteId: institute.id,
        branchId: institute.accessScope === "branches" ? branches[0].id : "",
      });
      router.push("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The institute workspace could not be opened.");
      setWorkingId("");
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
    } finally {
      setSigningOut(false);
    }
  }

  const initials = (displayName || email || "BizBook")
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-[radial-gradient(ellipse_at_top_left,_#1c3470_0%,_#111f4a_34%,_#0b1734_68%,_#071126_100%)] text-slate-100">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0 opacity-[0.16]" style={{ backgroundImage: "radial-gradient(circle, rgba(191, 219, 254, 0.55) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <div className="absolute -left-40 -top-48 size-[30rem] rounded-full bg-indigo-400/20 blur-3xl" />
        <div className="absolute -bottom-56 -right-32 size-[34rem] rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="absolute right-[18%] top-[38rem] size-72 rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>

      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#09152f]/85 backdrop-blur-xl after:absolute after:bottom-0 after:left-0 after:h-px after:w-full after:bg-gradient-to-r after:from-cyan-400/70 after:via-indigo-400/60 after:to-fuchsia-400/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl border border-indigo-300/20 bg-indigo-400/15 text-indigo-100"><Building2 size={19} /></span>
            <div><p className="text-base font-extrabold tracking-tight text-white">BizBook</p><p className="text-[11px] font-medium text-blue-200/70">Member portal</p></div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/member/settings" aria-label="Open account settings" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-300 bg-white px-2.5 text-xs font-bold text-rose-700 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-rose-600 hover:bg-rose-600 hover:text-white hover:shadow-lg hover:shadow-rose-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09152f] sm:px-3.5"><Settings2 size={16} /><span className="hidden sm:inline">Settings</span></Link>
            <button type="button" aria-label="Sign out" disabled={signingOut} onClick={() => void signOut()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-500 px-2.5 text-xs font-bold text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:bg-rose-600 hover:shadow-lg hover:shadow-rose-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09152f] disabled:cursor-wait disabled:opacity-60 sm:px-3.5"><LogOut size={15} />{signingOut ? <span className="hidden sm:inline">Signing out…</span> : <span className="hidden sm:inline">Sign out</span>}</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-12 pt-8 sm:px-6 sm:pb-16 sm:pt-12">
        <section className="flex flex-col justify-between gap-7 border-b border-white/12 pb-7 sm:flex-row sm:items-end sm:pb-9">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-cyan-200"><ShieldCheck size={14} /> Member account</p>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Welcome{displayName ? `, ${displayName.split(/\s+/)[0]}` : ""}</h1>
            <p className="mt-2 text-sm leading-6 text-blue-100/75">Your institute access, invitations, and account details in one place.</p>
            <p className="mt-5 flex max-w-2xl items-start gap-2.5 text-sm leading-6 text-cyan-100/90"><Users size={17} className="mt-0.5 shrink-0 text-cyan-300" /><span>You can join different institutes with the same member account. Accept invitations sent to this email to add more workspaces.</span></p>
          </div>
          <div className="flex min-w-0 items-center gap-3 sm:max-w-[280px] sm:pb-1">
            <span className="grid size-11 shrink-0 place-items-center rounded-full border border-indigo-200/20 bg-indigo-300/10 text-sm font-extrabold text-white">{initials || <UserRound size={19} />}</span>
            <div className="min-w-0"><p className="truncate text-sm font-bold text-white">{displayName || "Member account"}</p><p className="mt-0.5 truncate text-xs text-blue-100/65">{email || "Loading your email"}</p><p className={`mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-semibold ${verified ? "text-emerald-300" : "text-amber-300"}`}>{verified ? <><CheckCircle2 size={13} />Verified email</> : <><Clock3 size={13} />Verification needed</>}</p></div>
          </div>
        </section>

        {!projectConfigured && <p role="alert" className="mt-6 border-l-2 border-amber-300 pl-3 text-sm leading-6 text-amber-100">{error}</p>}
        {projectConfigured && error && <p role="alert" className="mt-6 border-l-2 border-rose-400 pl-3 text-sm leading-6 text-rose-200">{error}</p>}
        {notice && <p role="status" className="mt-6 border-l-2 border-emerald-400 pl-3 text-sm leading-6 text-emerald-200">{notice}</p>}
        {!verified && !loading && <p className="mt-6 border-l-2 border-amber-300 pl-3 text-sm leading-6 text-amber-100"><strong>Verify your email to see invitations.</strong> Sign in with the account that owns this email and complete verification. BizBook will not create a second account for an email already registered.</p>}

        <div className="mt-9 grid items-start gap-x-10 gap-y-10 lg:grid-cols-2">
          <section id="member-invitations" className="border-t-2 border-cyan-300/55 pt-5" aria-labelledby="member-invitations-title">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Pending access</p><h2 id="member-invitations-title" className="mt-1.5 flex items-center gap-2 text-xl font-bold text-white"><MailCheck size={19} className="text-cyan-200" /> Invitations for you <span className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-xs font-bold text-cyan-100">{loading ? "…" : invitations.length.toLocaleString("en-IN")}</span></h2><p className="mt-1 text-xs leading-5 text-blue-100/60">Review invitations to join another institute.</p></div>
              <button type="button" onClick={() => setReload((value) => value + 1)} disabled={loading} aria-label="Refresh invitations" className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 text-blue-100/70 transition duration-200 hover:border-rose-300 hover:bg-white hover:text-rose-700 disabled:opacity-50"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>
            </div>
            {loading ? <p role="status" className="mt-5 flex items-center gap-2 py-4 text-sm text-blue-100/70"><LoaderCircle size={16} className="animate-spin text-cyan-300" />Loading invitations…</p>
              : invitations.length ? <div className="mt-2 divide-y divide-white/10">{invitations.map((invitation) => <article key={invitation.id} className="py-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan-300/10 text-cyan-200"><Building2 size={17} /></span><div className="min-w-0"><h3 className="break-words text-sm font-bold text-white">{invitation.institute_name}</h3><p className="mt-1 text-xs font-semibold text-cyan-200">{roleName(invitation.role)} access</p></div></div>
                  <button type="button" disabled={workingId === invitation.id} onClick={() => void acceptInvitation(invitation)} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-rose-300 bg-white px-3.5 text-xs font-extrabold text-rose-700 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-rose-600 hover:bg-rose-600 hover:text-white hover:shadow-lg hover:shadow-rose-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1734] disabled:cursor-not-allowed disabled:opacity-50">{workingId === invitation.id ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}Accept invitation</button>
                </div>
                <p className="mt-3 pl-12 text-xs leading-5 text-blue-100/70">{MEMBER_ROLE_DESCRIPTIONS[invitation.role]}</p>
                <p className="mt-2 pl-12 text-[11px] font-medium text-blue-100/55">{invitation.access_scope === "institute" ? "Institute-wide access" : `${invitation.branch_ids.length} assigned branch(es)`} <span className="px-1 text-blue-100/35">·</span> Expires {formatDate(invitation.expires_at)}</p>
              </article>)}</div>
                : <p className="mt-5 border-t border-white/10 py-5 text-sm leading-6 text-blue-100/65">No pending invitations. Ask the institute owner to invite this verified email address.</p>}
          </section>

          <section id="member-workspaces" className="border-t-2 border-violet-300/55 pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-5" aria-labelledby="member-workspaces-title">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">Your access</p><h2 id="member-workspaces-title" className="mt-1.5 flex items-center gap-2 text-xl font-bold text-white"><Building2 size={19} className="text-violet-200" /> Your workspaces <span className="rounded-full bg-violet-300/10 px-2 py-0.5 text-xs font-bold text-violet-100">{loading ? "…" : institutes.length.toLocaleString("en-IN")}</span></h2><p className="mt-1 text-xs leading-5 text-blue-100/60">Open any institute you have joined with this account.</p></div>
            {loading ? <p role="status" className="mt-5 flex items-center gap-2 py-4 text-sm text-blue-100/70"><LoaderCircle size={16} className="animate-spin text-violet-300" />Loading institutes…</p>
              : institutes.length ? <div className="mt-2 divide-y divide-white/10">{institutes.map((institute) => <article key={institute.id} className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-300/10 text-violet-200"><Building2 size={17} /></span><div className="min-w-0"><h3 className="break-words text-sm font-bold text-white">{institute.name}</h3><p className="mt-1 text-xs text-blue-100/65">{roleName(institute.role)} <span className="px-1 text-blue-100/35">·</span> {institute.accessScope === "institute" ? "Institute-wide" : "Assigned branches"}</p></div></div>
                <button type="button" disabled={workingId === institute.id} onClick={() => void openInstitute(institute)} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-rose-300 bg-white px-3.5 text-xs font-extrabold text-rose-700 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-rose-600 hover:bg-rose-600 hover:text-white hover:shadow-lg hover:shadow-rose-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1734] disabled:cursor-wait disabled:opacity-50">{workingId === institute.id ? <LoaderCircle size={14} className="animate-spin" /> : <ArrowUpRight size={14} />}Open workspace</button>
              </article>)}</div>
                : <p className="mt-5 border-t border-white/10 py-5 text-sm leading-6 text-blue-100/65">No institutes joined yet. Accept an invitation to add your first workspace. You can join more than one institute with this same account.</p>}
          </section>
        </div>
      </main>
    </div>
  );
}
