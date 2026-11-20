# PEF Design — Cloudflare R2 migration (NOT ACTIVE)

Current production uploads remain on existing providers. The R2 API route is deliberately fail-closed (503). No R2 credentials are stored in GitHub.

## Activation prerequisites
1. Create an R2 bucket with **private** access. Configure CORS to allow only the PEF production origin and the required HTTP methods. Never use public write access.
2. Configure Vercel **server-side only** environment variables: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY. Never prefix secrets with VITE_, NEXT_PUBLIC_, or expose them in HTML.
3. Validate the Supabase user JWT server-side against the project's JWKS, check ownership and per-user rate limits. Do not accept user IDs from the request body.
4. Maintain durable per-user and global storage reservations in a transactional database. Reject uploads when storage+reservations exceeds 8 GiB. Reconcile object sizes and orphaned uploads.
5. Enforce max 3 MiB/photo, 20 MiB/video, 2–5 photos per listing, and 10 seconds/video, with server-side inspection of uploaded media; enforce limits on every upload route.
6. Issue short-lived presigned PUT URLs with constrained object keys and content types. Finalize uploads only after verifying actual object metadata and size; delete invalid files.
7. Monitor Cloudflare Class A and Class B operation counts; configure independent alerts and a manual upload kill switch. Quota thresholds in config are NOT enforced automatically.
8. Configure Cloudflare billing alerts. Alerts are **not** hard billing caps. Cloudflare may bill for usage above free allowances. Confirm product-specific spend limits in the dashboard before enabling uploads.
9. Test with a private bucket, simulate over-quota requests, concurrent uploads, failed uploads, deletes, and authentication failures. Only then change the application upload flow.
10. Keep an easy rollback path to the existing provider; do not delete source media until verified migration.

## Current status
- config/r2-safety-policy.js: policy thresholds only, not an enforcement mechanism.
- api/r2/prepare-upload.js: validates basic file metadata but always returns HTTP 503 for valid uploads.
- **No production media flow has been changed.**
