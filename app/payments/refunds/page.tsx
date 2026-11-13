"use client";

import { useRouter } from "next/navigation";
import SharedRefundRecords from "@/components/payments/SharedRefundRecords";

export default function RefundsPage() {
  const router = useRouter();
  return <SharedRefundRecords onUseBrowser={() => router.push("/payments/history")} />;
}
