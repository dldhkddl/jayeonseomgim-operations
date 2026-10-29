function maskPhone(value: string): string {
  const parts = value.split("-");
  if (parts.length === 3) return `${parts[0]}-${"*".repeat(parts[1].length)}-${parts[2]}`;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return value ? "****" : "";
  return `${digits.slice(0, 3)}-${"*".repeat(digits.length - 7)}-${digits.slice(-4)}`;
}

export function maskOrderForList<T extends { recipientPhone1: string; recipientPhone2: string; detailedAddress: string }>(order: T): T {
  const words = order.detailedAddress.trim().split(/\s+/);
  return {
    ...order,
    recipientPhone1: maskPhone(order.recipientPhone1),
    recipientPhone2: maskPhone(order.recipientPhone2),
    detailedAddress: words.length ? `${words[0]} ****` : "",
  };
}
