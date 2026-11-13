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
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  isAuthorizedTestProjectConfigured,
  isAccessibleWorkspaceBranchSelection,
  loadWorkspaceScopePreference,
  loadWorkspaceBranches,
  loadWorkspaceInstitutes,
  resolveWorkspaceScopeSelection,
  saveWorkspaceScopePreference,
  type WorkspaceBranch,
  type WorkspaceInstitute,
} from "@/lib/supabase/workspace-scope";

type SavedSelection = { userId: string; instituteId: string; branchId: string };
type WorkspaceScopeValue = {
  institutes: WorkspaceInstitute[];
  branches: WorkspaceBranch[];
  selection: SavedSelection | null;
  loading: boolean;
  error: string;
  blocker: string;
  refresh: () => void;
  selectInstitute: (instituteId: string) => Promise<void>;
  selectBranch: (branchId: string) => void;
  setBlocker: (reason: string) => void;
};

const WorkspaceScopeContext = createContext<WorkspaceScopeValue | null>(null);

export function WorkspaceScopeProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [institutes, setInstitutes] = useState<WorkspaceInstitute[]>([]);
  const [branches, setBranches] = useState<WorkspaceBranch[]>([]);
  const [selection, setSelection] = useState<SavedSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [blocker, setBlocker] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const userIdRef = useRef("");
  const requestRef = useRef(0);
  const preferenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const preferenceRevisionRef = useRef(0);

  const persistSelection = useCallback((next: SavedSelection) => {
    const revision = ++preferenceRevisionRef.current;
    const operation = preferenceQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (revision !== preferenceRevisionRef.current) return;
        await saveWorkspaceScopePreference(
          createSupabaseBrowserClient(),
          next.userId,
          { instituteId: next.instituteId, branchId: next.branchId },
        );
      });
    preferenceQueueRef.current = operation;
    void operation.catch((cause: unknown) => {
      if (revision === preferenceRevisionRef.current) {
        setError(cause instanceof Error ? cause.message : "Your workspace selection could not be saved.");
      }
    });
  }, []);

  const applyInstitute = useCallback(async (instituteId: string, preferredBranchId?: string) => {
    const institute = institutes.find((item) => item.id === instituteId);
    if (!institute) return null;
    const request = ++requestRef.current;
    setLoading(true);
    setError("");
    setBranches([]);
    const pendingSelection = { userId: userIdRef.current, instituteId, branchId: "" };
    setSelection(pendingSelection);
    try {
      const available = await loadWorkspaceBranches(createSupabaseBrowserClient(), instituteId);
      if (request !== requestRef.current) return;
      setBranches(available);
      const preferred = preferredBranchId ?? "";
      const branchId = preferred && available.some((item) => item.id === preferred)
        ? preferred
        : institute.accessScope === "branches" ? (available[0]?.id ?? "") : "";
      const next = { userId: userIdRef.current, instituteId, branchId };
      setSelection(next);
      return next;
    } catch (cause) {
      if (request === requestRef.current) {
        setBranches([]);
        setError(cause instanceof Error ? cause.message : "Authorized branches could not be loaded.");
      }
      return null;
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [institutes]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      if (!enabled) {
        setInstitutes([]);
        setBranches([]);
        setSelection(null);
        setLoading(false);
        setError("");
        setBlocker("");
        return;
      }
      setLoading(true);
      setError("");
      if (!isAuthorizedTestProjectConfigured()) {
        setError("The shared workspace is not connected to its authorized test project.");
        setLoading(false);
        return;
      }
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error: authError } = await supabase.auth.getUser();
        if (authError || !data.user) throw new Error("Sign in to load your institute and branch access.");
        const [rows, preferenceResult] = await Promise.all([
          loadWorkspaceInstitutes(supabase),
          loadWorkspaceScopePreference(supabase, data.user.id)
            .then((preference) => ({ preference, error: "" }))
            .catch((cause: unknown) => ({
              preference: null,
              error: cause instanceof Error ? cause.message : "Saved workspace selection could not be loaded.",
            })),
        ]);
        if (!active) return;
        userIdRef.current = data.user.id;
        setInstitutes(rows);
        if (!rows.length) {
          setSelection(null);
          setBranches([]);
          setLoading(false);
          return;
        }
        const { preference, error: preferenceError } = preferenceResult;
        const preferredInstitute = rows.find((item) => item.id === preference?.instituteId) ?? rows[0];
        const available = await loadWorkspaceBranches(supabase, preferredInstitute.id);
        if (!active) return;
        const scope = resolveWorkspaceScopeSelection([preferredInstitute], available, preference);
        if (!scope) throw new Error("Your authorized workspace could not be selected.");
        const next = { userId: data.user.id, ...scope };
        setBranches(available);
        setSelection(next);
        if (preferenceError) setError(`${preferenceError} Using your first authorized scope.`);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Your workspace access could not be verified.");
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, [enabled, refreshKey]);

  const selectInstitute = useCallback(async (instituteId: string) => {
    if (blocker) return;
    if (!institutes.some((item) => item.id === instituteId)) {
      setError("That institute is not in your authorized workspace list.");
      return;
    }
    const next = await applyInstitute(instituteId, "");
    if (next) persistSelection(next);
  }, [applyInstitute, blocker, institutes, persistSelection]);

  const selectBranch = useCallback((branchId: string) => {
    if (blocker) return;
    if (!selection) return;
    const institute = institutes.find((item) => item.id === selection.instituteId);
    if (!institute) return;
    if (!isAccessibleWorkspaceBranchSelection(institute, branches, branchId)) {
      setError("That branch is not in your authorized branch list.");
      return;
    }
    setError("");
    const next = { ...selection, branchId };
    setSelection(next);
    persistSelection(next);
  }, [blocker, branches, institutes, persistSelection, selection]);

  const setScopeBlocker = useCallback((reason: string) => setBlocker(reason), []);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  const value = useMemo(() => ({ institutes, branches, selection, loading, error, blocker, refresh, selectInstitute, selectBranch, setBlocker: setScopeBlocker }),
    [blocker, branches, error, institutes, loading, refresh, selectBranch, selectInstitute, selection, setScopeBlocker]);

  return <WorkspaceScopeContext.Provider value={value}>{children}</WorkspaceScopeContext.Provider>;
}

export function useWorkspaceScope() {
  const value = useContext(WorkspaceScopeContext);
  if (!value) throw new Error("useWorkspaceScope must be used inside WorkspaceScopeProvider");
  return value;
}
