import SubscriptionCheckoutPage from "@/components/settings/SubscriptionCheckoutPage";

export default async function Page({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  return <SubscriptionCheckoutPage invoiceId={invoiceId} />;
}
