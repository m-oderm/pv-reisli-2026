/**
 * PV-Reisli 2026 — Worker-Entrypoint
 * ----------------------------------
 * Wird über `wrangler.jsonc` (Root) als `main` deployt. Routet
 *   /api/travel-conditions  → Wetter-Proxy
 *   alles andere            → statische Assets aus `dist/` (über env.ASSETS)
 */

import travelConditions from './travel-conditions.js'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (url.pathname === '/api/travel-conditions') {
      return travelConditions.fetch(request, env, ctx)
    }

    // Alles andere fällt auf den statischen Asset-Handler durch.
    return env.ASSETS.fetch(request)
  }
}
