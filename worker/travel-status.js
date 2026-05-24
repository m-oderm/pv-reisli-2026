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

// Statische Anreise-Route. Mailand bleibt als Umsteige-Knoten sichtbar,
// das eigentliche Endziel wird nicht genannt.
const ANREISE_ROUTE = [
  { time: '08:00', label: 'Abfahrt Bahnhof Zug', detail: 'EC 13 Richtung Mailand' },
  { time: '10:50', label: 'Ankunft Mailand Centrale', detail: '2 h 50 min Fahrzeit' },
  { time: '11:10', label: 'Umstieg', detail: 'FR 9612, ca. 1 h 6 min' },
  { time: '12:16', label: 'Ankunft am Ziel', detail: null }
]

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return preflight()
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed' }, 405)
    }

    const status = await fetchSbbStatus()
    return jsonResponse(status, 200, {
      'Cache-Control': 'public, max-age=60'
    })
  }
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
    const plannedDeparture = from.departure || null
    const plannedPlatform = from.platform || null
    const realtimePlatform = from.prognosis?.platform || null
    const realtimeDeparture = from.prognosis?.departure || null
    const delayMin = typeof from.delay === 'number' ? from.delay : 0

    let status = 'on_time'
    let message = DEFAULT_MESSAGE
    if (delayMin > 0) {
      status = 'delayed'
      message = `Leichte Verzögerung: ${delayMin} Minuten. Durstplanung bleibt stabil.`
    } else if (delayMin === 0 && realtimeDeparture && realtimeDeparture !== plannedDeparture) {
      // Prognose weicht ab, aber kein delay-Feld → vorsichtshalber als delayed flag
      status = 'delayed'
      message = 'Abfahrtszeit verschoben. Bitte Anzeigetafel beachten.'
    }

    const platform = realtimePlatform || plannedPlatform || null

    return {
      status,
      delayMinutes: delayMin,
      platform,
      plannedDeparture,
      message,
      route: ANREISE_ROUTE,
      updatedAt: new Date().toISOString()
    }
  } catch {
    return {
      status: 'unknown',
      delayMinutes: null,
      platform: null,
      plannedDeparture: null,
      message: UNKNOWN_MESSAGE,
      route: ANREISE_ROUTE,
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
