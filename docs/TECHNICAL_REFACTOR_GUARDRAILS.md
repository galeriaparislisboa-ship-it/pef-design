# PEF Design — Technical refactor guardrails

This branch is a safe working copy of `beta-cloudflare-publication-sans-login`. Do not merge into `main` or deploy as production without review and approval.

## Non-negotiable invariants
- **Visual design (DA):** preserve exact official supplied logos/icons, fonts, colors, dimensions, spacing, animations and existing layouts. Never redraw logos.
- **UX:** preserve navigation, button positions and actions, swipe gestures, iOS-style controls, form validation, profile/gallery separation, and all existing approved interactions.
- **Listing media:** new listings require 2–5 photos; optional 10-second video is always displayed in position 2 when supplied. Keep mobile reordering.
- **Migrated listings:** allow text-only legacy/migrated D1 listings to be rendered temporarily without relaxing validation for newly published listings.
- **Architecture:** D1 for listing data, Cloudflare Worker API; avoid destructive migrations and keep media data untouched until verified.
- **Security:** keep administrator and gallery identities distinct; do not bypass authorization.

## Safe workflow
1. Inventory and identify the current data-fetch and render pipeline before changing it.
2. Introduce the smallest isolated adapter needed to map Cloudflare D1 listing records into the existing feed. Do not replace HTML/CSS/layout.
3. Add test cases for text-only migrated listings and the two-photo new-publication rule.
4. Compare screenshots and mobile interactions against the existing version.
5. Verify API/network errors, missing media fallbacks, and count/pagination.
6. Request explicit approval before any DA/UX change or production deployment.

## Current verified baseline
- Staging preview renders up to 20 text listings via `/api/text-listings`.
- This is a separate staging overlay; it does **not** prove the normal feed is connected.
- Existing `index.html` remains unchanged at branch creation.
