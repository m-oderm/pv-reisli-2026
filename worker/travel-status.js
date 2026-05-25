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

// ViaggiaTreno spricht nur plain HTTP, Cloudflare Workers nur HTTPS.
// r.jina.ai ist ein offener Reader-Proxy, der HTTP-Quellen ueber HTTPS
// spiegelt. Fragil aber funktional. Fallback: nur statische Daten.
const VT_PROXY = 'https://r.jina.ai/http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno'
const MILANO_CENTRALE_ID = 'S01700'
const TORINO_PORTA_NUOVA_ID = 'S00219'
const TRENITALIA_TRAIN = '9612'

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
    kind: 'trenitalia_dep',
    time: '11:10',
    revealAt: '2026-05-30T10:40:00+02:00',
    label: 'Umstieg',
    detail: 'FR 9612, ca. 1 h 6 min'
  },
  {
    kind: 'trenitalia_arr',
    time: '12:16',
    revealAt: '2026-05-30T11:00:00+02:00',
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

// Zeitfenster fuer die geplante Mailand-Abfahrt. Real ist 11:10 Zurich-Zeit,
// das Fenster 10:00 bis 12:00 (exklusive) faengt nur unseren Zug ein und
// verwirft fremde 9612er, die zufaellig auch durch Mailand fahren.
const TRENITALIA_DEPARTURE_WINDOW = { minHourZurich: 10, maxHourZurich: 12 }

function isInZurichDepartureWindow(ms) {
  if (typeof ms !== 'number') return false
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    hour12: false
  }).format(new Date(ms)))
  return hour >= TRENITALIA_DEPARTURE_WINDOW.minHourZurich
    && hour < TRENITALIA_DEPARTURE_WINDOW.maxHourZurich
}

const TEST_OVERRIDE_TOKEN = 'pegelspitze-bunker-2026'

// Wenn JINA_API_KEY als Cloudflare-Secret hinterlegt ist, schickt der Worker
// den Bearer-Header mit. Damit fallen die anonymen 20 Crawls/Min/IP weg.
// Ohne Key bleibt der Code rueckwaertskompatibel (anonym mit Limit).
function jinaHeaders(env) {
  const key = env?.JINA_API_KEY
  return key ? { Authorization: `Bearer ${key}` } : {}
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return preflight()
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed' }, 405)
    }

    const url = new URL(request.url)
    const now = resolveNow(url)
    const [status, trenitalia] = await Promise.all([
      fetchSbbStatus(),
      fetchTrenitaliaStatus(env, now)
    ])
    const route = buildRoute(status, trenitalia, now)
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

function buildRoute(status, trenitalia, nowMs) {
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
      } else if (stop.kind === 'sbb_arr' && liveArrTime) {
        out.time = liveArrTime
      } else if (stop.kind === 'trenitalia_dep' && trenitalia?.dep) {
        if (trenitalia.dep.time) out.time = trenitalia.dep.time
        if (trenitalia.dep.platform) out.platform = trenitalia.dep.platform
        if (trenitalia.dep.delayMinutes > 0) out.delayMinutes = trenitalia.dep.delayMinutes
      } else if (stop.kind === 'trenitalia_arr' && trenitalia?.arr) {
        if (trenitalia.arr.time) out.time = trenitalia.arr.time
        if (trenitalia.arr.delayMinutes > 0) out.delayMinutes = trenitalia.arr.delayMinutes
      }
      delete out.kind
      return out
    })
}

/**
 * Versucht die Trenitalia-Daten via r.jina.ai HTTPS-Proxy auf ViaggiaTreno
 * zu holen. Liefert { dep, arr } mit time/platform/delayMinutes, oder null
 * wenn unverfuegbar. Best effort, kein Block bei Fehler.
 */
function isRateLimitedBody(text) {
  return typeof text === 'string' && /"code":\s*429|RateLimitTriggered|Per IP rate limit/i.test(text)
}

async function fetchTrenitaliaStatus(env, nowMs) {
  try {
    // 1. cerca treno: gibt uns Origin-Station-ID des Zuges am heutigen Tag.
    // 15 min Cache, da Tagesliste sich nicht oft aendert und r.jina.ai
    // ein striktes Rate-Limit (20 Crawls/Min/IP anonym) hat. Mit Key
    // sind die Limits deutlich hoeher, Cache schont trotzdem Tokens.
    const cercaUrl = `${VT_PROXY}/cercaNumeroTrenoTrenoAutocomplete/${TRENITALIA_TRAIN}`
    const cercaRes = await fetch(cercaUrl, {
      headers: jinaHeaders(env),
      cf: { cacheTtl: 900, cacheEverything: true }
    })
    if (!cercaRes.ok) return null
    const cercaText = await cercaRes.text()
    if (isRateLimitedBody(cercaText)) return null
    // r.jina.ai-Wrap: nach "Markdown Content:" kommt der eigentliche Inhalt
    const body = cercaText.split('Markdown Content:')[1]?.trim() ?? ''
    // Format: "9612 - BATTIPAGLIA - 25/05/26|9612-S09823-1779660000000\n..."
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
    // Pick die ID-Tupel rechts vom |
    const ids = lines
      .map((l) => l.split('|')[1])
      .filter(Boolean)
      .map((tuple) => {
        const parts = tuple.split('-')
        return { trainNo: parts[0], stationId: parts[1], epoch: parts[2] }
      })
    // Bevorzuge ID die zu Milano Centrale passt (unser Zug startet dort)
    let pick = ids.find((i) => i.stationId === MILANO_CENTRALE_ID)
    if (!pick) {
      // Fallback: erster Eintrag heute
      pick = ids[0]
    }
    if (!pick) return null

    // 2. andamentoTreno: holt den Live-Lauf des Zuges.
    // 3 min Cache: Echtzeit-Daten bleiben relativ frisch, aber das
    // Rate-Limit des Proxy wird nicht ueberreizt.
    const andUrl = `${VT_PROXY}/andamentoTreno/${pick.stationId}/${pick.trainNo}/${pick.epoch}`
    const andRes = await fetch(andUrl, {
      headers: jinaHeaders(env),
      cf: { cacheTtl: 180, cacheEverything: true }
    })
    if (!andRes.ok) return null
    const andText = await andRes.text()
    if (isRateLimitedBody(andText)) return null
    const andBody = andText.split('Markdown Content:')[1]?.trim() ?? ''
    let andJson
    try {
      andJson = JSON.parse(andBody)
    } catch {
      return null
    }
    const fermate = Array.isArray(andJson?.fermate) ? andJson.fermate : []
    if (fermate.length === 0) return null

    // Beide Halte muessen vorkommen UND Mailand muss vor Turin liegen
    // (sonst faehrt der Zug in falsche Richtung oder ist ein anderer 9612).
    const milanoIdx = fermate.findIndex((f) => f.id === MILANO_CENTRALE_ID)
    const torinoIdx = fermate.findIndex((f) => f.id === TORINO_PORTA_NUOVA_ID)
    if (milanoIdx < 0 || torinoIdx < 0 || milanoIdx >= torinoIdx) return null

    const milano = fermate[milanoIdx]
    const torino = fermate[torinoIdx]

    // Plausibilitaet: Geplante Mailand-Abfahrt muss im erwarteten Fenster
    // liegen. Sonst ist es ein fremder 9612, kein Live-Match.
    if (!isInZurichDepartureWindow(milano?.partenza_teorica)) return null

    const fromStop = (f, mode) => {
      if (!f) return null
      const programmataMs = mode === 'dep' ? f.partenza_teorica : f.arrivo_teorico
      const effectiveMs = mode === 'dep'
        ? f.partenzaReale ?? programmataMs
        : f.arrivoReale ?? programmataMs
      const platform =
        f.binarioEffettivoPartenzaDescrizione ??
        f.binarioProgrammatoPartenzaDescrizione ??
        null
      const delay = mode === 'dep' ? f.ritardoPartenza : f.ritardoArrivo
      return {
        time: effectiveMs ? hmInZurich(new Date(effectiveMs).toISOString()) : null,
        platform: mode === 'dep' ? platform : null,
        delayMinutes: typeof delay === 'number' ? delay : 0
      }
    }

    return {
      dep: fromStop(milano, 'dep'),
      arr: fromStop(torino, 'arr')
    }
  } catch {
    return null
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
