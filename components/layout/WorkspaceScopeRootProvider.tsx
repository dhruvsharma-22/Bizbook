"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { WorkspaceScopeProvider } from "@/components/layout/WorkspaceScopeContext";
import { WorkspaceSubscriptionProvider } from "@/components/layout/WorkspaceSubscriptionContext";

const WORKSPACE_PREFIXES = ["/dashboard", "/business", "/payments", "/expenses", "/reports", "/settings", "/account", "/support", "/plans"];

export default function WorkspaceScopeRootProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const enabled = !!pathname && WORKSPACE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return (
    <WorkspaceScopeProvider enabled={enabled}>
      {enabled ? <WorkspaceSubscriptionProvider>{children}</WorkspaceSubscriptionProvider> : children}
    </WorkspaceScopeProvider>
  );
}
