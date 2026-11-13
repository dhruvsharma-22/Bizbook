"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ClipboardList, LoaderCircle, MailCheck, MailPlus, RefreshCw, ShieldCheck, Trash2, UserRound, Users } from "lucide-react";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  canManageInstituteMembers,
  canRemoveManagedMember,
  MEMBER_ROLE_DESCRIPTIONS,
  memberRoleOptions,
  type ManagedInstituteRole,
  type ManagedMember,
  type MemberAccessScope,
} from "@/lib/supabase/member-management";
import { isAuthorizedTestProjectConfigured } from "@/lib/supabase/workspace-scope";

type PendingInvitation = {
  id: string;
  email: string;
  role: ManagedInstituteRole;
  access_scope: MemberAccessScope;
  branch_ids: string[];
  expires_at: string;
};

function friendlyError(message: string): string {
  if (message.includes("first create a BizBook account")) return "This person needs one verified BizBook account first. Ask them to create it from Member Portal; if they already use BizBook with another institute, invite the same email they already use.";
  if (message.includes("already has a membership")) return "This email already has a membership in the selected institute.";
  if (message.includes("already has an invitation")) return "A pending invite already exists for this email. Revoke it before creating another.";
  return message || "The request could not be completed. Please retry.";
}

export default function MemberManagementWorkspace() {
  const projectConfigured = isAuthorizedTestProjectConfigured();
  const { institutes, selection, loading: workspaceLoading } = useWorkspaceScope();
  const institute = institutes.find((item) => item.id === selection?.instituteId) ?? null;
  const [members, setMembers] = useState<ManagedMember[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [actorUserId, setActorUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ManagedInstituteRole>("staff");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const roleOptions = useMemo(() => institute ? memberRoleOptions(institute.role) : [], [institute]);
  const selectedRole = roleOptions.includes(role) ? role : roleOptions[0] ?? "staff";
  const manager = canManageInstituteMembers(institute);

  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  useEffect(() => {
    if (workspaceLoading || !projectConfigured || !institute || !manager) return;
    let current = true;
    void Promise.resolve().then(async () => {
      setLoading(true);
      setError("");
      const supabase = createSupabaseBrowserClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sign in with an authorized institute administrator account.");
      if (!current) return;
      setActorUserId(auth.user.id);
      const [memberResult, invitationResult] = await Promise.all([
        supabase.rpc("list_institute_members", { p_institute_id: institute.id }),
        supabase.rpc("list_member_access_invitations", { p_institute_id: institute.id }),
      ]);
      if (!current) return;
      if (memberResult.error || invitationResult.error) {
        setError(friendlyError(memberResult.error?.message ?? invitationResult.error?.message ?? "Member data could not be loaded."));
        setMembers([]);
        setInvitations([]);
      } else {
        setMembers(memberResult.data ?? []);
        setInvitations(invitationResult.data ?? []);
      }
      setLoading(false);
    }).catch((cause: unknown) => {
      if (current) {
        setError(friendlyError(cause instanceof Error ? cause.message : "Member data could not be loaded."));
        setLoading(false);
      }
    });
    return () => { current = false; };
  }, [institute, manager, projectConfigured, refreshVersion, workspaceLoading]);

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!institute || !manager || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const { data, error: rpcError } = await createSupabaseBrowserClient().rpc("create_member_access_invitation", {
        p_institute_id: institute.id,
        p_email: normalizedEmail,
        p_role: selectedRole,
        p_access_scope: "institute",
        p_branch_ids: [],
      });
      if (rpcError) throw new Error(friendlyError(rpcError.message));
      const result = data as { status?: string } | null;
      if (result?.status !== "invited") throw new Error("The invitation was not confirmed by the database. Please retry.");
      setEmail("");
      setNotice(`Invitation created for ${normalizedEmail}. It will appear in their Member Portal after they sign in with this verified email. They should use this same account for every BizBook institute.`);
      refresh();
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : "The invitation could not be created."));
    } finally {
      setSaving(false);
    }
  }

  async function revokeInvitation(invitation: PendingInvitation) {
    if (!window.confirm(`Revoke the pending invitation for ${invitation.email}?`)) return;
    setWorkingId(invitation.id);
    setError("");
    try {
      const { error: rpcError } = await createSupabaseBrowserClient().rpc("revoke_member_access_invitation", { p_invitation_id: invitation.id });
      if (rpcError) throw rpcError;
      setNotice(`Invitation for ${invitation.email} revoked.`);
      refresh();
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : "The invitation could not be revoked."));
    } finally {
      setWorkingId("");
    }
  }

  async function removeMember(member: ManagedMember) {
    if (!institute || !window.confirm(`Remove ${member.email} from ${institute.name}? Their BizBook account and memberships in other institutes will remain.`)) return;
    setWorkingId(member.user_id);
    setError("");
    try {
      const { error: rpcError } = await createSupabaseBrowserClient().rpc("remove_institute_member", {
        p_institute_id: institute.id,
        p_user_id: member.user_id,
      });
      if (rpcError) throw rpcError;
      setNotice(`${member.email} no longer has access to ${institute.name}.`);
      refresh();
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : "The membership could not be removed."));
    } finally {
      setWorkingId("");
    }
  }

  if (!projectConfigured) {
    return <main className="mx-auto max-w-4xl p-4 sm:p-6"><p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Member management is unavailable because this deployment is not connected to the authorized BizBook database.</p></main>;
  }

  if (!workspaceLoading && (!manager || !institute)) {
    return <main className="mx-auto max-w-4xl p-4 sm:p-6"><section className="rounded-2xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-slate-900">Owner access required</h1><p className="mt-2 text-sm leading-6 text-slate-700">Only an institute owner or institute-wide administrator can manage members. Your current role does not grant access to this page.</p></section></main>;
  }

  if (workspaceLoading || loading) {
    return <main className="mx-auto max-w-6xl p-4 sm:p-6"><div role="status" className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600"><LoaderCircle className="animate-spin" size={18} />Loading members and invitations…</div></main>;
  }

  if (!manager || !institute) return null;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="rounded-3xl bg-slate-900 p-6 text-white shadow-sm sm:p-8">
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/10 text-violet-200"><Users size={24} /></span>
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-200">Institute access</p><h1 className="mt-1 text-2xl font-bold">Members & invitations</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Every person uses one BizBook account across institutes. Ask new people to create and verify their account in Member Portal first; if someone already works with another institute, invite the same email they already use. They accept each institute invitation separately.</p></div>
        </div>
        <p className="mt-5 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200"><ShieldCheck size={15} />One email, one BizBook login. Each invitation grants only the selected institute role after acceptance.</p>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <section aria-labelledby="invite-steps-title" className="rounded-2xl border border-white/10 bg-zinc-950 p-5 shadow-[0_12px_40px_rgba(0,0,0,0.25)] sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-violet-500/15 text-violet-300">
            <ClipboardList size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-300">QUICK GUIDE</p>
            <h2 id="invite-steps-title" className="mt-1 text-lg font-bold text-white sm:text-xl">Invite a member in 3 simple steps</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-400">Follow these steps so the invitation reaches the right BizBook account.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <article className="rounded-xl border border-white/10 bg-black p-4 transition-colors hover:border-violet-400/40">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><UserRound size={20} aria-hidden="true" /></span>
              <span className="text-xs font-bold uppercase tracking-wider text-violet-300">STEP 1</span>
            </div>
            <h3 className="mt-3 font-semibold text-white">Member creates an account</h3>
            <p className="mt-1 text-sm leading-5 text-zinc-400">The member first creates and verifies their BizBook Member account.</p>
            <Link href="/member-login" className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-violet-400/30 px-3 py-2 text-sm font-semibold text-violet-200 transition hover:bg-violet-500/10 focus:outline-none focus:ring-2 focus:ring-violet-400">
              Create member account <span aria-hidden="true">↗</span>
            </Link>
          </article>
          <article className="rounded-xl border border-white/10 bg-black p-4 transition-colors hover:border-sky-400/40">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-300"><MailPlus size={20} aria-hidden="true" /></span>
              <span className="text-xs font-bold uppercase tracking-wider text-sky-300">STEP 2</span>
            </div>
            <h3 className="mt-3 font-semibold text-white">Institute sends the invitation</h3>
            <p className="mt-1 text-sm leading-5 text-zinc-400">Enter the same verified email in the form below, choose a role, and send the invite.</p>
          </article>
          <article className="rounded-xl border border-white/10 bg-black p-4 transition-colors hover:border-emerald-400/40">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300"><MailCheck size={20} aria-hidden="true" /></span>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">STEP 3</span>
            </div>
            <h3 className="mt-3 font-semibold text-white">Member accepts the invite</h3>
            <p className="mt-1 text-sm leading-5 text-zinc-400">The member signs in to their Member Portal, opens the invitation, and accepts it to get institute access.</p>
            <Link href="/member-login" className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-violet-400">
              Open Member Portal <span aria-hidden="true">↗</span>
            </Link>
          </article>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-800"><MailPlus size={19} /></span><div><h2 className="font-bold text-slate-900">Invite by account email</h2><p className="text-xs text-slate-500">Use the member’s one verified BizBook email.</p></div></div>
          <form onSubmit={inviteMember} className="mt-5 space-y-4">
            <label className="block text-sm font-semibold text-slate-700">Member email
              <input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100" />
            </label>
            <label className="block text-sm font-semibold text-slate-700">Role
              <select value={selectedRole} onChange={(event) => setRole(event.target.value as ManagedInstituteRole)} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100">
                {roleOptions.map((option) => <option key={option} value={option}>{option[0].toUpperCase() + option.slice(1)}</option>)}
              </select>
              <span className="mt-1.5 block text-xs font-normal leading-5 text-slate-500">{MEMBER_ROLE_DESCRIPTIONS[selectedRole]}</span>
            </label>
            <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">New to BizBook? Have them create one account in the <Link href="/member-login" className="font-semibold text-violet-800 underline">Member Portal</Link> first. If they already use another institute, invite the email on that same account. They accept this invitation before access is added.</p>
            {institute.role === "administrator" && <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">Administrators can invite Accountant and Staff roles. Only an Owner can invite another Owner or Administrator.</p>}
            <button type="submit" disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">{saving ? <LoaderCircle size={17} className="animate-spin" /> : <MailPlus size={17} />}{saving ? "Creating invitation…" : "Add invitation"}</button>
          </form>
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">Current members</h2><p className="mt-1 text-xs text-slate-500">Removing a member only removes access to this institute.</p></div><button type="button" onClick={refresh} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Refresh members"><RefreshCw size={17} /></button></div>
            <div className="mt-4 divide-y divide-slate-100">
              {members.length ? members.map((member) => <article key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="flex min-w-0 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600"><UserRound size={17} /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{member.email || "BizBook account"}</p><p className="text-xs capitalize text-slate-500">{member.role} · {member.access_scope === "institute" ? "Institute-wide" : "Workspace-limited"}{member.is_active ? "" : " · inactive"}</p></div></div>{canRemoveManagedMember({ userId: actorUserId, role: institute.role, accessScope: institute.accessScope }, member) && <button type="button" disabled={workingId === member.user_id} onClick={() => void removeMember(member)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={14} />Remove</button>}</article>) : <p className="py-5 text-sm text-slate-500">No member records are available yet.</p>}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-bold text-slate-900">Pending invitations</h2><p className="mt-1 text-xs text-slate-500">An invitation grants no access until accepted by its matching verified account.</p>
            <div className="mt-4 divide-y divide-slate-100">
              {invitations.length ? invitations.map((invitation) => <article key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{invitation.email}</p><p className="text-xs capitalize text-slate-500">{invitation.role} · {invitation.access_scope === "institute" ? "Institute-wide" : "Workspace-limited"} · expires {new Date(invitation.expires_at).toLocaleDateString()}</p></div><button type="button" disabled={workingId === invitation.id} onClick={() => void revokeInvitation(invitation)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Revoke</button></article>) : <p className="py-5 text-sm text-slate-500">No pending invitations.</p>}
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-800"><ShieldCheck size={19} /></span><div><h2 className="font-bold text-slate-900">Institute role guide</h2><p className="text-xs text-slate-500">Role access is enforced by database policies on every request.</p></div></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(["owner", "administrator", "accountant", "staff"] as const).map((memberRole) => <article key={memberRole} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="text-sm font-bold capitalize text-slate-900">{memberRole}</h3><p className="mt-2 text-xs leading-5 text-slate-600">{MEMBER_ROLE_DESCRIPTIONS[memberRole]}</p></article>)}
        </div>
      </section>
    </main>
  );
}
