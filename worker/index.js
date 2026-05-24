/**
 * PV-Reisli 2026: Worker-Entrypoint
 *
 * Wird über `wrangler.jsonc` im Root als `main` deployt. Routet
 *   /api/travel-conditions  → Wetter-Proxy
 *   /api/trip-program       → Tagesprogramm mit serverseitigem Zeit-Gating
 *   /api/travel-status      → Live-Zuginfo (Mock)
 *   alles andere            → statische Assets aus `dist/`, über env.ASSETS
 */

import travelConditions from './travel-conditions.js'
import tripProgram from './trip-program.js'
import travelStatus from './travel-status.js'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (url.pathname === '/api/travel-conditions') {
      return travelConditions.fetch(request, env, ctx)
    }
    if (url.pathname === '/api/trip-program') {
      return tripProgram.fetch(request, env, ctx)
    }
    if (url.pathname === '/api/travel-status') {
      return travelStatus.fetch(request, env, ctx)
    }
    if (url.pathname === '/api/_debug') {
      return new Response(JSON.stringify({
        urlHostname: url.hostname,
        urlHref: request.url,
        hostHeader: request.headers.get('host'),
        cfHost: request.headers.get('cf-connecting-host'),
        env: { ALLOW_TIME_OVERRIDE: env?.ALLOW_TIME_OVERRIDE ?? null }
      }, null, 2), { headers: { 'content-type': 'application/json' } })
    }
    return env.ASSETS.fetch(request)
  }
}
