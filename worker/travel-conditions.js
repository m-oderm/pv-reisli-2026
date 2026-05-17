/**
 * PV-Reisli 2026: Travel-Conditions Proxy
 *
 * Cloudflare Worker, der für das Frontend eine sanitisierte
 * Wettervorhersage bereitstellt. Der Standort wird ausschliesslich
 * über drei Cloudflare-Secrets aufgelöst:
 *
 *   SECRET_WEATHER_LAT   Breitengrad
 *   SECRET_WEATHER_LON   Längengrad
 *   SECRET_WEATHER_TZ    Zeitzone, IANA-Name
 *
 * Datenquellen, beide parallel abgefragt und gemittelt:
 *   * Open-Meteo, Ensemble aus GFS, ECMWF, ICON-EU. Bis 16 Tage.
 *   * Met Norway, api.met.no. Bis 9 bis 10 Tage.
 *
 * Die Antwort enthält nie Koordinaten, Ortsnamen oder Zeitzone.
 */

const TRAVEL_START = '2026-05-30'
const TRAVEL_END = '2026-06-02'

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast'
const MET_NORWAY_BASE = 'https://api.met.no/weatherapi/locationforecast/2.0/compact'

const DAILY_PARAMS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'precipitation_sum',
  'wind_speed_10m_max',
  'uv_index_max',
  'sunrise',
  'sunset'
].join(',')

// Met Norway verlangt einen aussagekräftigen User-Agent, sonst rate-limit.
const MET_NORWAY_UA = 'pv-reisli-2026/1.0 (+https://github.com/m-oderm/pv-reisli-2026)'

const MS_PER_DAY = 86_400_000
const CACHE_TTL_SECONDS = 1800
const FALLBACK_FORECAST_DAYS = 16

// Open-Meteo liefert mit dem GFS-Modell bis ca. 15 Tage in die Zukunft.
// 13 Tage Puffer halten uns auf der sicheren Seite.
const FORECAST_HORIZON_DAYS = 13

// Wie lange die Reise zurückliegen darf und wir trotzdem den exakten Range
// abfragen, statt auf den Standard-Forecast umzuschalten.
const ALLOW_PAST_TRIP_DAYS = 7

// Wie viele Zeichen einer Open-Meteo-Fehlermeldung wir durchreichen.
const ERROR_DETAIL_MAX_CHARS = 200

const ALLOWED_UNIT_KEYS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'precipitation_sum',
  'wind_speed_10m_max',
  'uv_index_max'
]

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/api/travel-conditions') return notFound()
    if (request.method === 'OPTIONS') return preflight()
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed' }, 405)
    }

    const lat = env.SECRET_WEATHER_LAT
    const lon = env.SECRET_WEATHER_LON
    const tz = env.SECRET_WEATHER_TZ
    if (!lat || !lon || !tz) {
      return jsonResponse(
        { error: 'configuration_missing', note: 'Worker ist nicht vollständig konfiguriert.' },
        500
      )
    }

    const useTripRange = tripRangeStillAvailable(new Date())

    const [omRes, mnRes] = await Promise.allSettled([
      fetchOpenMeteo({ lat, lon, tz, useTripRange }),
      fetchMetNorway({ lat, lon })
    ])

    const om = omRes.status === 'fulfilled' ? omRes.value : null
    const mn = mnRes.status === 'fulfilled' ? mnRes.value : null

    if (!om) {
      // Open-Meteo ist Pflicht. Nur sie liefert PoP und 16-Tage-Range.
      const detail =
        omRes.status === 'rejected'
          ? String(omRes.reason).slice(0, ERROR_DETAIL_MAX_CHARS)
          : ''
      return jsonResponse({ error: 'primary_source_failed', detail }, 502)
    }

    const mnByDate = mn ? metNorwayToDaily(mn, tz) : null
    const { daily, sourcesPerDay, confidencePerDay } = mergeDaily(om.daily, mnByDate, new Date())

    return jsonResponse(
      {
        daily,
        daily_units: pickUnits(om.daily_units),
        within_travel_window: useTripRange,
        sources_count: mn ? 2 : 1,
        sources_per_day: sourcesPerDay,
        confidence_per_day: confidencePerDay,
        note: composeNote(useTripRange)
      },
      200,
      { 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` }
    )
  }
}

/**
 * Soll der Worker den exakten Reise-Range abfragen oder den
 * Standard-Forecast? Reise-Range nur, wenn das Reise-Ende sicher im
 * Modellfenster liegt und die Reise nicht zu lange zurückliegt.
 */
function tripRangeStillAvailable(today) {
  const tripStart = new Date(`${TRAVEL_START}T00:00:00Z`)
  const tripEnd = new Date(`${TRAVEL_END}T00:00:00Z`)
  const daysUntilStart = Math.floor((tripStart.getTime() - today.getTime()) / MS_PER_DAY)
  const daysUntilEnd = Math.floor((tripEnd.getTime() - today.getTime()) / MS_PER_DAY)
  return daysUntilEnd <= FORECAST_HORIZON_DAYS && daysUntilStart >= -ALLOW_PAST_TRIP_DAYS
}

/* ----- Quellen --------------------------------------------------- */

async function fetchOpenMeteo({ lat, lon, tz, useTripRange }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: String(tz),
    daily: DAILY_PARAMS
  })
  if (useTripRange) {
    params.set('start_date', TRAVEL_START)
    params.set('end_date', TRAVEL_END)
  } else {
    params.set('forecast_days', String(FALLBACK_FORECAST_DAYS))
  }

  const res = await fetch(`${OPEN_METEO_BASE}?${params.toString()}`, {
    cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true }
  })
  if (!res.ok) {
    let reason = ''
    try {
      const body = await res.json()
      if (typeof body?.reason === 'string') reason = body.reason
    } catch {}
    throw new Error(`open-meteo ${res.status}: ${reason}`)
  }
  return await res.json()
}

async function fetchMetNorway({ lat, lon }) {
  // Met Norway lehnt Koordinaten mit mehr als vier Nachkommastellen ab.
  const latStr = Number(lat).toFixed(4)
  const lonStr = Number(lon).toFixed(4)
  const url = `${MET_NORWAY_BASE}?lat=${latStr}&lon=${lonStr}`

  const res = await fetch(url, {
    headers: {
      'User-Agent': MET_NORWAY_UA,
      'Accept': 'application/json'
    },
    cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true }
  })
  if (!res.ok) throw new Error(`met-norway ${res.status}`)
  return await res.json()
}

/* ----- Aggregation ----------------------------------------------- */

/**
 * Aggregiert Met-Norway-Stündlichkeiten zu täglichen Min/Max-Werten in der
 * Ziel-Zeitzone. Tage, deren Sampling nicht beide Tageshälften abdeckt,
 * fliegen raus. Sonst läge der Tageshöchst für heute eventuell nur auf
 * den Abendstunden und würde den Mittelwert verzerren.
 */
function metNorwayToDaily(mn, tz) {
  const collected = new Map()
  const series = mn?.properties?.timeseries
  if (!Array.isArray(series)) return collected

  for (const ts of series) {
    const temp = ts?.data?.instant?.details?.air_temperature
    if (typeof temp !== 'number') continue
    const moment = new Date(ts.time)
    if (Number.isNaN(moment.getTime())) continue

    const { date, hour } = localDateAndHour(moment, tz)

    let entry = collected.get(date)
    if (!entry) {
      entry = { max: temp, min: temp, hasMorning: false, hasAfternoon: false }
      collected.set(date, entry)
    }
    if (temp > entry.max) entry.max = temp
    if (temp < entry.min) entry.min = temp
    if (hour < 12) entry.hasMorning = true
    else entry.hasAfternoon = true
  }

  const result = new Map()
  for (const [date, entry] of collected) {
    if (entry.hasMorning && entry.hasAfternoon) {
      result.set(date, { max: entry.max, min: entry.min })
    }
  }
  return result
}

function localDateAndHour(moment, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  }).formatToParts(moment)
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    hour: parseInt(lookup.hour, 10)
  }
}

/**
 * Mittelt die Min/Max-Temperaturen beider Quellen, sofern beide für einen
 * Tag Werte liefern. Weather-Code und Niederschlagswahrscheinlichkeit
 * bleiben Open-Meteo überlassen, da Met Norway in diesem Forecast-Horizont
 * keinen vergleichbaren Datentyp bietet. Zusätzlich wird pro Tag eine
 * Confidence-Schätzung gerechnet, siehe `estimateConfidence`.
 */
function mergeDaily(omDaily, mnByDate, today) {
  const time = Array.isArray(omDaily?.time) ? omDaily.time : []
  const out = {
    time: [...time],
    weather_code: truncate(omDaily?.weather_code, time.length),
    temperature_2m_max: [],
    temperature_2m_min: [],
    precipitation_probability_max: truncate(omDaily?.precipitation_probability_max, time.length),
    precipitation_sum: truncate(omDaily?.precipitation_sum, time.length),
    wind_speed_10m_max: truncate(omDaily?.wind_speed_10m_max, time.length),
    uv_index_max: truncate(omDaily?.uv_index_max, time.length),
    sunrise: truncate(omDaily?.sunrise, time.length),
    sunset: truncate(omDaily?.sunset, time.length)
  }
  const sourcesPerDay = []
  const confidencePerDay = []

  for (let i = 0; i < time.length; i++) {
    const date = time[i]
    const omMax = numberAt(omDaily?.temperature_2m_max, i)
    const omMin = numberAt(omDaily?.temperature_2m_min, i)
    const mnDay = mnByDate?.get(date) ?? null

    if (mnDay && omMax !== null && omMin !== null) {
      out.temperature_2m_max.push(roundOneDecimal((omMax + mnDay.max) / 2))
      out.temperature_2m_min.push(roundOneDecimal((omMin + mnDay.min) / 2))
      sourcesPerDay.push(2)
    } else {
      out.temperature_2m_max.push(omMax)
      out.temperature_2m_min.push(omMin)
      sourcesPerDay.push(1)
    }

    confidencePerDay.push(estimateConfidence({ date, today, omMax, omMin, mnDay }))
  }

  return { daily: out, sourcesPerDay, confidencePerDay }
}

/**
 * Liefert einen Confidence-Wert in Prozent für einen einzelnen Forecast-Tag.
 *
 * Zwei Bausteine:
 *   * Basis aus der Entfernung in Tagen zum Heute. Wettermodelle verlieren
 *     pro Tag rund 4 Prozentpunkte Trefferquote (vereinfachte Annäherung an
 *     gängige ECMWF-Skill-Scores).
 *   * Anpassung aus dem Ensemble-Spread, sofern Open-Meteo und Met Norway
 *     beide für den Tag Temperaturen liefern. Kleiner Spread = Modelle sind
 *     sich einig, höheres Vertrauen. Grosser Spread = unsicher.
 *
 * Endwert auf 25 bis 95 geclamped.
 */
function estimateConfidence({ date, today, omMax, omMin, mnDay }) {
  const dayMs = new Date(`${date}T12:00:00Z`).getTime()
  const daysAhead = Math.max(0, Math.round((dayMs - today.getTime()) / MS_PER_DAY))

  let confidence = 95 - daysAhead * 4

  if (mnDay && typeof omMax === 'number' && typeof omMin === 'number') {
    const spread = (Math.abs(omMax - mnDay.max) + Math.abs(omMin - mnDay.min)) / 2
    if (spread > 6) confidence -= 15
    else if (spread > 4) confidence -= 8
    else if (spread < 1) confidence += 8
    else if (spread < 2) confidence += 4
  } else {
    // Einzel-Modell hat etwas weniger Vertrauen.
    confidence -= 3
  }

  return Math.max(25, Math.min(95, Math.round(confidence)))
}

function truncate(arr, len) {
  return Array.isArray(arr) ? arr.slice(0, len) : new Array(len).fill(null)
}

function numberAt(arr, idx) {
  return typeof arr?.[idx] === 'number' ? arr[idx] : null
}

function roundOneDecimal(value) {
  return Math.round(value * 10) / 10
}

/* ----- Antwort --------------------------------------------------- */

function pickUnits(units) {
  if (!units) return null
  return ALLOWED_UNIT_KEYS.reduce((out, key) => {
    if (typeof units[key] === 'string') out[key] = units[key]
    return out
  }, {})
}

function composeNote(useTripRange) {
  return useTripRange
    ? 'Live Forecast aktiv. Das Ziel bleibt geheim.'
    : 'Live Forecast wird tagesweise verfügbar. Das Ziel bleibt geheim.'
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

function notFound() {
  return new Response('Not found', { status: 404 })
}
