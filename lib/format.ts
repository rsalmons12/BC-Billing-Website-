export function money(n: number | null | undefined): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function moneyCents(n: number | null | undefined): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function num(n: number | null | undefined): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return v.toLocaleString("en-US");
}
