import crypto from "crypto";

// A short signature that ties the public census-image URL to one facility, so
// the (login-free) image endpoint can't be used to fetch other facilities.
// Signed with CRON_SECRET, which already guards the scheduled endpoints.
export function censusImageToken(facilityId: string): string {
  const secret = process.env.CRON_SECRET || "bc-billing-dev-secret";
  return crypto.createHmac("sha256", secret).update(`census-image|${facilityId}`).digest("hex").slice(0, 32);
}
