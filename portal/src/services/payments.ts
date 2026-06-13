export type MobileProvider = "wave" | "orange_money";

export type PaymentTransaction = {
  id: string;
  provider: MobileProvider;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed";
  reference?: string;
  checkoutUrl?: string;
  providerReference?: string;
};

export async function initiateMobilePayment(input: {
  provider: MobileProvider;
  amount: number;
  phone: string;
  reference: string;
}): Promise<PaymentTransaction> {
  const response = await fetch("/payments/initiate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, currency: "XOF" }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Paiement mobile impossible.");
  }
  return payload;
}

export async function getMobilePaymentStatus(id: string): Promise<PaymentTransaction> {
  const response = await fetch(`/payments/${id}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Statut paiement introuvable.");
  }
  return payload;
}

export async function markMobilePaymentPaidForDev(id: string): Promise<PaymentTransaction> {
  const response = await fetch(`/payments/${id}/dev-mark-paid`, { method: "POST" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Confirmation locale indisponible.");
  }
  return payload;
}
