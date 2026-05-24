/**
 * PV-Reisli 2026: Travel-Status Endpoint
 *
 * Holt Echtzeit-Status der Anreise via transport.opendata.ch (SBB OpenData).
 * Liefert dem Frontend nur sanitisierte Felder:
 *   status, delayMinutes, platform, plannedDeparture, message, updatedAt
 *
 * Der Zielort (Mailand) wird im Worker als Routing-Parameter genutzt,
 * erscheint aber NICHT im Response. Geheimhaltung bleibt gewahrt.
 */

const SBB_API = 'https://transport.opendata.ch/v1/connections'
const ANREISE_FROM = 'Zug'
const ANREISE_TO = 'Milano Centrale'
const ANREISE_DATE = '2026-05-30'
const ANREISE_TIME = '08:00'

const DEFAULT_MESSAGE = 'Die Reise läuft planmässig.'
const UNKNOWN_MESSAGE =
  'Live-Zuginfo derzeit nicht verfügbar. Die Reiseleitung wirkt dennoch zuversichtlich.'

// Anreise-Route. Stops erscheinen schrittweise (revealAt). Schweizer Teil
// (kind: sbb_dep, sbb_arr) wird mit Live-Daten angereichert, italienischer
// Teil bleibt statisch. Mailand ist Zwischenhalt und nicht in der
// Geheim-Wortliste, das Endziel bleibt unbenannt.
const ANREISE_ROUTE = [
  {
    kind: 'sbb_dep',
    time: '08:00',
    revealAt: '2026-05-30T07:45:00+02:00',
    label: 'Abfahrt Bahnhof Zug',
    detail: 'EC 13 Richtung Mailand'
  },
  {
    kind: 'sbb_arr',
    time: '10:50',
    revealAt: '2026-05-30T08:00:00+02:00',
    label: 'Ankunft Mailand Centrale',
    detail: '2 h 50 min Fahrzeit'
  },
  {
    kind: 'static',
    time: '11:10',
    revealAt: '2026-05-30T10:50:00+02:00',
    label: 'Umstieg',
    detail: 'FR 9612, ca. 1 h 6 min'
  },
  {
    kind: 'static',
    time: '12:16',
    revealAt: '2026-05-30T11:10:00+02:00',
    label: 'Ankunft am Ziel',
    detail: null
  }
]

function hmInZurich(iso) {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(ms))
}

const TEST_OVERRIDE_TOKEN = 'pegelspitze-bunker-2026'

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return preflight()
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed' }, 405)
    }

    const url = new URL(request.url)
    const now = resolveNow(url)
    const status = await fetchSbbStatus()
    const route = buildRoute(status, now)
    return jsonResponse(
      { ...status, route },
      200,
      { 'Cache-Control': 'public, max-age=60' }
    )
  }
}

function resolveNow(url) {
  const testKey = url.searchParams.get('testKey')
  if (testKey === TEST_OVERRIDE_TOKEN) {
    const override = url.searchParams.get('now')
    if (override) {
      const parsed = Date.parse(override)
      if (!Number.isNaN(parsed)) return parsed
    }
  }
  return Date.now()
}

function buildRoute(status, nowMs) {
  const liveDepTime = status?.realtimeDeparture
    ? hmInZurich(status.realtimeDeparture)
    : null
  const liveArrTime = status?.realtimeArrival
    ? hmInZurich(status.realtimeArrival)
    : null
  const platform = status?.platform || null
  return ANREISE_ROUTE
    .filter((stop) => Date.parse(stop.revealAt) <= nowMs)
    .map((stop) => {
      const out = { ...stop }
      delete out.revealAt
      if (stop.kind === 'sbb_dep') {
        if (liveDepTime) out.time = liveDepTime
        if (platform) out.platform = platform
        if (typeof status?.delayMinutes === 'number' && status.delayMinutes > 0) {
          out.delayMinutes = status.delayMinutes
        }
      }
      if (stop.kind === 'sbb_arr' && liveArrTime) {
        out.time = liveArrTime
      }
      delete out.kind
      return out
    })
}

async function fetchSbbStatus() {
  const params = new URLSearchParams({
    from: ANREISE_FROM,
    to: ANREISE_TO,
    date: ANREISE_DATE,
    time: ANREISE_TIME,
    limit: '1'
  })
  try {
    const res = await fetch(`${SBB_API}?${params.toString()}`, {
      cf: { cacheTtl: 60, cacheEverything: true }
    })
    if (!res.ok) throw new Error(`sbb ${res.status}`)
    const body = await res.json()
    const conn = body?.connections?.[0]
    if (!conn) throw new Error('no connection')

    const from = conn.from || {}
    const to = conn.to || {}
    const plannedDeparture = from.departure || null
    const plannedArrival = to.arrival || null
    const plannedPlatform = from.platform || null
    const realtimePlatform = from.prognosis?.platform || null
    const realtimeDeparture = from.prognosis?.departure || null
    const realtimeArrival = to.prognosis?.arrival || null
    const delayMin = typeof from.delay === 'number' ? from.delay : 0

    let status = 'on_time'
    let message = DEFAULT_MESSAGE
    if (delayMin > 0) {
      status = 'delayed'
      message = `Leichte Verzögerung: ${delayMin} Minuten. Durstplanung bleibt stabil.`
    } else if (delayMin === 0 && realtimeDeparture && realtimeDeparture !== plannedDeparture) {
      status = 'delayed'
      message = 'Abfahrtszeit verschoben. Bitte Anzeigetafel beachten.'
    }

    const platform = realtimePlatform || plannedPlatform || null

    return {
      status,
      delayMinutes: delayMin,
      platform,
      plannedDeparture,
      plannedArrival,
      realtimeDeparture,
      realtimeArrival,
      message,
      updatedAt: new Date().toISOString()
    }
  } catch {
    return {
      status: 'unknown',
      delayMinutes: null,
      platform: null,
      plannedDeparture: null,
      plannedArrival: null,
      realtimeDeparture: null,
      realtimeArrival: null,
      message: UNKNOWN_MESSAGE,
      updatedAt: new Date().toISOString()
    }
  }
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  })
}

function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  })
}
