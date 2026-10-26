// All amounts are kept in kobo (₦1 = 100 kobo), the same unit the database and Paystack use.

const naira = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  currencyDisplay: "narrowSymbol",
  maximumFractionDigits: 0,
});

export function formatNaira(kobo: number | bigint | string | null | undefined): string {
  if (kobo === null || kobo === undefined || kobo === "") return "—";
  const value = Number(kobo) / 100;
  if (!Number.isFinite(value)) return "—";
  return naira.format(Math.round(value));
}

export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}
