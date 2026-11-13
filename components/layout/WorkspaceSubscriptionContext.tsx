"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { canOpenWorkspaceForSubscription, effectiveSubscriptionStatus } from "@/lib/supabase/subscription-access";

export type WorkspaceNotification = {
  key: string;
  kind: "announcement" | "subscription";
  title: string;
  message: string;
  created_at: string;
  is_read: boolean;
};

export type WorkspaceSubscription = {
  plan_name: string | null;
  status: string;
  billing_cycle: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_period_ends_at: string | null;
  free_access_enabled?: boolean;
  pending_plan_name?: string | null;
};

export type WorkspaceUpdates = {
  subscription: WorkspaceSubscription | null;
  notifications: WorkspaceNotification[];
};

type GateState = "checking" | "active" | "no_plan" | "expired" | "suspended" | "payment_due" | "unavailable";
type LoadState = { instituteId: string | null; snapshot: WorkspaceUpdates | null; loading: boolean; error: string };
type SubscriptionContextValue = {
  instituteId: string | null;
  snapshot: WorkspaceUpdates | null;
  loading: boolean;
  error: string;
  now: number | null;
  gateState: GateState;
  refresh: () => void;
};

const WorkspaceSubscriptionContext = createContext<SubscriptionContextValue | null>(null);

function parseWorkspaceUpdates(value: unknown): WorkspaceUpdates | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const subscription = record.subscription;
  const validSubscription = subscription === null || Boolean(
    subscription && typeof subscription === "object" && !Array.isArray(subscription)
      && typeof (subscription as Record<string, unknown>).status === "string",
  );
  if (!validSubscription || !Array.isArray(record.notifications)) return null;
  const notifications = record.notifications.filter((item): item is WorkspaceNotification => Boolean(
    item && typeof item === "object" && !Array.isArray(item)
      && typeof (item as Record<string, unknown>).key === "string"
      && typeof (item as Record<string, unknown>).title === "string"
      && typeof (item as Record<string, unknown>).message === "string"
      && typeof (item as Record<string, unknown>).created_at === "string",
  )).map((item) => ({
    ...item,
    kind: item.kind === "subscription" ? "subscription" as const : "announcement" as const,
    is_read: item.is_read === true,
  }));
  return { subscription: subscription as WorkspaceSubscription | null, notifications };
}

export function WorkspaceSubscriptionProvider({ children }: { children: ReactNode }) {
  const { selection, loading: scopeLoading } = useWorkspaceScope();
  const instituteId = selection?.instituteId ?? null;
  const [loadState, setLoadState] = useState<LoadState>({ instituteId: null, snapshot: null, loading: true, error: "" });
  const [now, setNow] = useState<number | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestVersion = useRef(0);

  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    void Promise.resolve().then(tick);
    if (!instituteId) return;
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [instituteId]);

  useEffect(() => {
    let active = true;
    if (scopeLoading) return () => { active = false; };
    if (!instituteId) {
      void Promise.resolve().then(() => {
        if (active) setLoadState({ instituteId: null, snapshot: null, loading: false, error: "" });
      });
      return () => { active = false; };
    }

    const controller = new AbortController();
    const currentRequest = ++requestVersion.current;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoadState((current) => current.instituteId === instituteId
        ? { ...current, loading: true, error: "" }
        : { instituteId, snapshot: null, loading: true, error: "" });
      try {
        const response = await fetch(`/api/workspace/updates?instituteId=${encodeURIComponent(instituteId)}`, {
          cache: "no-store", signal: controller.signal,
        });
        const result = await response.json() as { updates?: unknown; error?: string };
        const snapshot = parseWorkspaceUpdates(result.updates);
        if (!response.ok || !snapshot) throw new Error(result.error || "Workspace subscription could not be checked.");
        if (active && requestVersion.current === currentRequest) setLoadState({ instituteId, snapshot, loading: false, error: "" });
      } catch (cause) {
        if (!active || (cause instanceof DOMException && cause.name === "AbortError")) return;
        if (requestVersion.current === currentRequest) setLoadState({
          instituteId,
          snapshot: null,
          loading: false,
          error: cause instanceof Error ? cause.message : "Workspace subscription could not be checked.",
        });
      }
    });

    const timer = window.setInterval(() => refresh(), 60_000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [instituteId, refresh, refreshVersion, scopeLoading]);

  const currentState = loadState.instituteId === instituteId ? loadState : null;
  const loading = scopeLoading || Boolean(instituteId && (!currentState || currentState.loading));
  const error = currentState?.error ?? "";
  const snapshot = currentState?.snapshot ?? null;
  const subscription = snapshot?.subscription ?? null;
  const gateState: GateState = loading || now === null ? "checking"
    : error ? "unavailable"
      : !instituteId ? "active"
        : !snapshot || !subscription ? "no_plan"
          : subscription.status === "suspended" && !subscription.free_access_enabled ? "suspended"
            : canOpenWorkspaceForSubscription(subscription, now) ? "active"
              : subscription.status === "past_due" ? "payment_due"
                : effectiveSubscriptionStatus(
                  subscription.status,
                  subscription.status === "trialing" ? subscription.trial_ends_at : subscription.current_period_end,
                  now,
                ) === "expired" ? "expired"
                  : "no_plan";

  const value = useMemo(() => ({ instituteId, snapshot, loading, error, now, gateState, refresh }),
    [error, gateState, instituteId, loading, now, refresh, snapshot]);
  return <WorkspaceSubscriptionContext.Provider value={value}>{children}</WorkspaceSubscriptionContext.Provider>;
}

export function useWorkspaceSubscription() {
  const value = useContext(WorkspaceSubscriptionContext);
  if (!value) throw new Error("useWorkspaceSubscription must be used inside WorkspaceSubscriptionProvider");
  return value;
}
