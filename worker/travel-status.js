/**
 * PV-Reisli 2026: Travel-Status Endpoint
 *
 * Liefert Live-Status der aktiven Reise-Etappe. Anreise (Sa) bis und mit
 * Dienstag 13:20 (= 30 min vor Abfahrt Rueckreise), danach Rueckreise.
 *
 * Beide Trips folgen demselben Muster: eine SBB-Etappe + 20 min Umstieg
 * in Mailand + eine Trenitalia-Etappe (in unterschiedlicher Reihenfolge).
 *
 * Response enthaelt {tripId, status, delayMinutes, ..., route, transfer*}
 * und ist sanitisiert (kein Geheim-Wort).
 */

const SBB_API = 'https://transport.opendata.ch/v1/connections'

// ViaggiaTreno spricht nur plain HTTP, Cloudflare Workers nur HTTPS.
// r.jina.ai ist ein offener Reader-Proxy, der HTTP-Quellen ueber HTTPS
// spiegelt. Fragil aber funktional. Fallback: nur statische Daten.
const VT_PROXY = 'https://r.jina.ai/http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno'

const MILANO_CENTRALE_ID = 'S01700'
const TORINO_PORTA_NUOVA_ID = 'S00219'

const DEFAULT_MESSAGE = 'Die Reise läuft planmässig.'
const UNKNOWN_MESSAGE =
  'Live-Zuginfo derzeit nicht verfügbar. Die Reiseleitung wirkt dennoch zuversichtlich.'

// Umstieg in Mailand: Ankunft erste Etappe -> Abfahrt zweite Etappe = 20 Min.
// Faellt der Puffer unter 5 Min, wird der Umstieg knapp; bei 0 oder negativ
// ist der Anschluss nicht mehr erreichbar.
const TRANSFER_BUFFER_MIN = 20
const TRANSFER_TIGHT_THRESHOLD = 5

const TEST_OVERRIDE_TOKEN = 'pegelspitze-bunker-2026'

// Ab diesem Zeitpunkt wechselt der aktive Trip von Anreise auf Rueckreise.
// 30 min vor Abfahrt Trenitalia 9641 in Turin (13:50 Europe/Rome = Europe/Zurich).
const RETURN_UNLOCK_MS = Date.parse('2026-06-02T13:20:00+02:00')

// --- Trip-Konfigurationen ---

const OUTBOUND_CONFIG = {
  id: 'outbound',
  sbb: { from: 'Zug', to: 'Milano Centrale', date: '2026-05-30', time: '08:00' },
  trenitalia: {
    trainNo: '9612',
    depStationId: MILANO_CENTRALE_ID,
    arrStationId: TORINO_PORTA_NUOVA_ID,
    depHourWindowZurich: { min: 10, max: 12 }
  },
  // SBB ist die erste Etappe und kann durch Verspaetung den Umstieg vermasseln.
  firstLeg: 'sbb',
  connectionLabel: 'Anschluss-Trenitalia 11:10',
  route: [
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
}

const RETURN_CONFIG = {
  id: 'return',
  sbb: { from: 'Milano Centrale', to: 'Zug', date: '2026-06-02', time: '15:10' },
  trenitalia: {
    trainNo: '9641',
    depStationId: TORINO_PORTA_NUOVA_ID,
    arrStationId: MILANO_CENTRALE_ID,
    depHourWindowZurich: { min: 13, max: 15 }
  },
  // Trenitalia ist die erste Etappe und kann durch Verspaetung den Umstieg vermasseln.
  firstLeg: 'trenitalia',
  connectionLabel: 'Anschluss-EC 20 15:10',
  // Rueckreise: alle Stops sind ab Unlock-Zeit sichtbar (kein schrittweises Reveal).
  route: [
    {
      kind: 'trenitalia_dep',
      time: '13:50',
      revealAt: '2026-06-02T13:20:00+02:00',
      label: 'Abfahrt am Reisestart',
      detail: 'FR 9641, ca. 1 h'
    },
    {
      kind: 'trenitalia_arr',
      time: '14:50',
      revealAt: '2026-06-02T13:20:00+02:00',
      label: 'Ankunft Mailand Centrale',
      detail: 'Umstieg auf SBB'
    },
    {
      kind: 'sbb_dep',
      time: '15:10',
      revealAt: '2026-06-02T13:20:00+02:00',
      label: 'Abfahrt Mailand Centrale',
      detail: 'EC 20 Richtung Zürich'
    },
    {
      kind: 'sbb_arr',
      time: '18:00',
      revealAt: '2026-06-02T13:20:00+02:00',
      label: 'Ankunft Zug',
      detail: 'Bahnhof Zug'
    }
  ]
}

export function getActiveTripConfig(nowMs) {
  return nowMs >= RETURN_UNLOCK_MS ? RETURN_CONFIG : OUTBOUND_CONFIG
}

// Exportierte Configs damit der Debug-Endpoint beide Züge gleichzeitig
// abfragen kann ohne Duplikation.
export { OUTBOUND_CONFIG, RETURN_CONFIG, MILANO_CENTRALE_ID, TORINO_PORTA_NUOVA_ID, VT_PROXY }
export { jinaHeaders, isRateLimitedBody, hmInZurich, isInZurichDepartureWindow }

// --- Helpers ---

function hmInZurich(iso) {
  const ms = typeof iso === 'number' ? iso : Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(ms))
}

function isInZurichDepartureWindow(ms, window) {
  if (typeof ms !== 'number' || !window) return false
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    hour12: false
  }).format(new Date(ms)))
  return hour >= window.min && hour < window.max
}

// Wenn JINA_API_KEY als Cloudflare-Secret hinterlegt ist, schickt der Worker
// den Bearer-Header mit. Damit fallen die anonymen 20 Crawls/Min/IP weg.
// Ohne Key bleibt der Code rueckwaertskompatibel (anonym mit Limit).
function jinaHeaders(env) {
  const key = env?.JINA_API_KEY
  return key ? { Authorization: `Bearer ${key}` } : {}
}

function isRateLimitedBody(text) {
  return typeof text === 'string'
    && /"code":\s*429|RateLimitTriggered|Per IP rate limit/i.test(text)
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

// --- Main ---

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return preflight()
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed' }, 405)
    }

    const url = new URL(request.url)
    const now = resolveNow(url)
    const config = getActiveTripConfig(now)
    const [sbb, trenitalia] = await Promise.all([
      fetchSbbStatus(config.sbb),
      fetchTrenitaliaStatus(env, config.trenitalia)
    ])
    const route = buildRoute(config.route, sbb, trenitalia, now)
    const overall = deriveTransferAwareStatus(config, sbb, trenitalia)
    return jsonResponse(
      { tripId: config.id, ...sbb, ...(overall ?? {}), route },
      200,
      { 'Cache-Control': 'public, max-age=60' }
    )
  }
}

// --- Status-Komposition ---

/**
 * Kombiniert SBB- und Trenitalia-Lage zu einer einzigen Reise-Lage und
 * einer Mannschafts-Nachricht. Trip-Config sagt, welche Etappe zuerst
 * faehrt und damit den Umstieg vermasseln kann.
 * Bei unbekanntem SBB-Status wird nichts kombiniert (Aufrufer faellt auf
 * SBB-Defaults zurueck).
 */
function deriveTransferAwareStatus(config, sbb, trenitalia) {
  if (!sbb || sbb.status === 'unknown') return null

  const sbbDelay = typeof sbb.delayMinutes === 'number' ? sbb.delayMinutes : 0
  const trenDep = typeof trenitalia?.dep?.delayMinutes === 'number' ? trenitalia.dep.delayMinutes : 0
  const trenArr = typeof trenitalia?.arr?.delayMinutes === 'number' ? trenitalia.arr.delayMinutes : 0
  const trenitaliaDelay = Math.max(trenDep, trenArr)

  const firstIsSbb = config.firstLeg === 'sbb'
  const firstLegDelay = firstIsSbb ? sbbDelay : trenitaliaDelay
  const secondLegDelay = firstIsSbb ? trenitaliaDelay : sbbDelay
  const firstLegName = firstIsSbb ? 'SBB' : 'Trenitalia'
  const secondLegName = firstIsSbb ? 'Trenitalia' : 'SBB'

  const transferMarginMin = TRANSFER_BUFFER_MIN - firstLegDelay
  let transferRisk
  if (transferMarginMin <= 0) transferRisk = 'missed'
  else if (transferMarginMin < TRANSFER_TIGHT_THRESHOLD) transferRisk = 'tight'
  else transferRisk = 'safe'

  let status
  let message
  if (transferRisk === 'missed') {
    status = 'delayed'
    message = `${firstLegName} +${firstLegDelay} Min. ${config.connectionLabel} nicht mehr erreichbar. Reiseleitung sucht Plan B.`
  } else if (transferRisk === 'tight') {
    status = 'delayed'
    message = `${firstLegName} +${firstLegDelay} Min. Umstieg knapp (${transferMarginMin} Min Restpuffer). Schnellfüssig sein.`
  } else if (firstLegDelay > 0 && secondLegDelay > 0) {
    status = 'delayed'
    message = `${firstLegName} +${firstLegDelay} Min. Umstieg sicher. Endankunft +${secondLegDelay} Min.`
  } else if (firstLegDelay > 0) {
    status = 'delayed'
    message = `${firstLegName} +${firstLegDelay} Min. Umstieg sicher.`
  } else if (secondLegDelay > 0) {
    status = 'delayed'
    message = `${firstLegName} pünktlich. Endankunft ${secondLegName} +${secondLegDelay} Min.`
  } else {
    status = 'on_time'
    message = DEFAULT_MESSAGE
  }

  return {
    status,
    message,
    transferMarginMin,
    transferRisk,
    sbbDelayMinutes: sbbDelay,
    trenitaliaDelayMinutes: trenitaliaDelay
  }
}

// --- Route ---

function buildRoute(routeDef, sbb, trenitalia, nowMs) {
  const liveDepTime = sbb?.realtimeDeparture ? hmInZurich(sbb.realtimeDeparture) : null
  const liveArrTime = sbb?.realtimeArrival ? hmInZurich(sbb.realtimeArrival) : null
  const platform = sbb?.platform || null
  return routeDef
    .filter((stop) => Date.parse(stop.revealAt) <= nowMs)
    .map((stop) => {
      const out = { ...stop }
      delete out.revealAt
      if (stop.kind === 'sbb_dep') {
        if (liveDepTime) out.time = liveDepTime
        if (platform) out.platform = platform
        if (typeof sbb?.delayMinutes === 'number' && sbb.delayMinutes > 0) {
          out.delayMinutes = sbb.delayMinutes
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

// --- Trenitalia ---

/**
 * Versucht die Trenitalia-Daten via r.jina.ai HTTPS-Proxy auf ViaggiaTreno
 * zu holen. Liefert { dep, arr } mit time/platform/delayMinutes, oder null
 * wenn unverfuegbar oder Validierung fehlschlaegt. Best effort, kein Block.
 */
export async function fetchTrenitaliaStatus(env, config) {
  try {
    // 1. cerca treno: gibt uns Origin-Station-ID des Zuges am heutigen Tag.
    // 15 min Cache, da Tagesliste sich nicht oft aendert und das r.jina.ai
    // Rate-Limit (20 Crawls/Min/IP anonym) sonst getriggert wird.
    const cercaUrl = `${VT_PROXY}/cercaNumeroTrenoTrenoAutocomplete/${config.trainNo}`
    const cercaRes = await fetch(cercaUrl, {
      headers: jinaHeaders(env),
      cf: { cacheTtl: 900, cacheEverything: true }
    })
    if (!cercaRes.ok) return null
    const cercaText = await cercaRes.text()
    if (isRateLimitedBody(cercaText)) return null
    const body = cercaText.split('Markdown Content:')[1]?.trim() ?? ''
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
    const ids = lines
      .map((l) => l.split('|')[1])
      .filter(Boolean)
      .map((tuple) => {
        const parts = tuple.split('-')
        return { trainNo: parts[0], stationId: parts[1], epoch: parts[2] }
      })
    // Bevorzuge ID die zur Startstation des Trips passt
    let pick = ids.find((i) => i.stationId === config.depStationId)
    if (!pick) pick = ids[0]
    if (!pick) return null

    // 2. andamentoTreno: holt den Live-Lauf des Zuges.
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

    // Validierung: beide Halte muessen vorkommen UND Start vor Ziel liegen.
    const depIdx = fermate.findIndex((f) => f.id === config.depStationId)
    const arrIdx = fermate.findIndex((f) => f.id === config.arrStationId)
    if (depIdx < 0 || arrIdx < 0 || depIdx >= arrIdx) return null

    const depStop = fermate[depIdx]
    const arrStop = fermate[arrIdx]

    // Plausibilitaet: geplante Abfahrt muss im erwarteten Fenster liegen.
    if (!isInZurichDepartureWindow(depStop?.partenza_teorica, config.depHourWindowZurich)) return null

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
      dep: fromStop(depStop, 'dep'),
      arr: fromStop(arrStop, 'arr')
    }
  } catch {
    return null
  }
}

// --- SBB ---

async function fetchSbbStatus(config) {
  const params = new URLSearchParams({
    from: config.from,
    to: config.to,
    date: config.date,
    time: config.time,
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
