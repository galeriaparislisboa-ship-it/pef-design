// PEF Design — R2 safety policy (preparation only; R2 is not activated).
// IMPORTANT: These values MUST be enforced on the server before enabling R2 uploads.
// A browser-side check alone is bypassable and does not prevent Cloudflare billing.
export const R2_POLICY = Object.freeze({
  maxStoredBytes: 8 * 1024 ** 3,
  warningBytes: 6 * 1024 ** 3,
  criticalBytes: 7 * 1024 ** 3,
  maxPhotosPerListing: 5,
  minPhotosPerListing: 2,
  maxVideoSeconds: 10,
  maxPhotoUploadBytes: 3 * 1024 ** 2,
  maxVideoUploadBytes: 20 * 1024 ** 2,
  monthlyClassAWarning: 700_000,
  monthlyClassBWarning: 7_000_000,
  monthlyClassAMax: 800_000,
  monthlyClassBMax: 8_000_000,
});
// Required before production: authenticated server endpoint for uploads,
// transactional reservation of storage capacity before issuing presigned URLs,
// accounting for uploads/deletes/overwrites, cleanup of abandoned reservations,
// rate limits per user, operation counters, monitoring and admin kill switch.
// Cloudflare R2 does not offer a guaranteed $0 hard billing cap via this file.
// Keep existing Supabase/Cloudinary upload flows unchanged until migration is ready.
