import type { Metadata } from "next";
import PublicInstallmentCheckout from "@/components/payments/PublicInstallmentCheckout";

export const metadata: Metadata = {
  title: "Pay installment | BizBook",
  description: "Secure installment payment checkout.",
  referrer: "no-referrer",
  robots: { index: false, follow: false, noarchive: true },
};

export default function PayPage() {
  return <PublicInstallmentCheckout />;
}
