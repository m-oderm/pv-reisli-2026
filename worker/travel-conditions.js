/**
 * PV-Reisli 2026 — Travel-Conditions Proxy
 * ----------------------------------------
 * Cloudflare Worker, der für das Frontend eine sanitisierte
 * Wettervorhersage bereitstellt. Der Standort wird ausschliesslich
 * über drei Cloudflare-Secrets bzw. Environment-Variablen aufgelöst:
 *
 *   SECRET_WEATHER_LAT   – Breitengrad
 *   SECRET_WEATHER_LON   – Längengrad
 *   SECRET_WEATHER_TZ    – Zeitzone (IANA-Name)
 *
 * Datenquellen (beide werden parallel angefragt, Ergebnisse gemittelt):
 *   • Open-Meteo (Ensemble GFS + ECMWF + ICON-EU) — bis 16 Tage
 *   • Met Norway / api.met.no                     — bis  9–10 Tage
 *
 * Die Antwort enthält NIE Koordinaten, Ortsnamen oder Zeitzone.
 */

const TRAVEL_START = '2026-05-30'
const TRAVEL_END = '2026-06-02'
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast'
const MET_NORWAY_BASE = 'https://api.met.no/weatherapi/locationforecast/2.0/compact'
const DAILY_PARAMS =
  'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'

// Met Norway verlangt einen aussagekräftigen User-Agent.
const MET_NORWAY_UA = 'pv-reisli-2026/1.0 (+https://github.com/m-oderm/pv-reisli-2026)'

// Open-Meteo liefert mit dem GFS-Modell bis ca. 15 Tage in die Zukunft.
// Wir bleiben mit 13 Tagen Puffer auf der sicheren Seite.
const FORECAST_HORIZON_DAYS = 13

export default {
  async fetch(request, env, ctx) {
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

    const today = new Date()
    const start = new Date(`${TRAVEL_START}T00:00:00Z`)
    const end = new Date(`${TRAVEL_END}T00:00:00Z`)
    const msPerDay = 86_400_000
    const daysUntilStart = Math.floor((start.getTime() - today.getTime()) / msPerDay)
    const daysUntilEnd = Math.floor((end.getTime() - today.getTime()) / msPerDay)

    // Exakter Reise-Range nur, wenn auch der letzte Reisetag sicher im Fenster
    // ist. Sonst maximaler Forecast (16 Tage), damit Reisetage erscheinen,
    // sobald sie verfügbar sind.
    const withinForecastWindow =
      daysUntilEnd <= FORECAST_HORIZON_DAYS && daysUntilStart >= -7

    const [omRes, mnRes] = await Promise.allSettled([
      fetchOpenMeteo(lat, lon, tz, withinForecastWindow),
      fetchMetNorway(lat, lon)
    ])

    const om = omRes.status === 'fulfilled' ? omRes.value : null
    const mn = mnRes.status === 'fulfilled' ? mnRes.value : null

    if (!om) {
      // Open-Meteo ist Pflicht — nur sie liefert PoP und 16-Tage-Range.
      const detail = omRes.status === 'rejected' ? String(omRes.reason).slice(0, 200) : ''
      return jsonResponse({ error: 'primary_source_failed', detail }, 502)
    }

    const mnByDate = mn ? metNorwayToDaily(mn, tz) : null
    const { daily, sourcesPerDay } = mergeDaily(om.daily, mnByDate)

    const sourcesAvailable = mn ? 2 : 1
    const note = composeNote(withinForecastWindow, sourcesAvailable)

    return jsonResponse(
      {
        daily,
        daily_units: pickUnits(om.daily_units),
        within_travel_window: withinForecastWindow,
        sources_count: sourcesAvailable,
        sources_per_day: sourcesPerDay,
        note
      },
      200,
      { 'Cache-Control': 'public, max-age=1800' }
    )
  }
}

/* ---------- Quellen ---------- */

async function fetchOpenMeteo(lat, lon, tz, withinForecastWindow) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: String(tz),
    daily: DAILY_PARAMS
  })
  if (withinForecastWindow) {
    params.set('start_date', TRAVEL_START)
    params.set('end_date', TRAVEL_END)
  } else {
    params.set('forecast_days', '16')
  }

  const res = await fetch(`${OPEN_METEO_BASE}?${params.toString()}`, {
    cf: { cacheTtl: 1800, cacheEverything: true }
  })
  if (!res.ok) {
    let reason = ''
    try {
      const body = await res.json()
      if (typeof body?.reason === 'string') reason = body.reason
    } catch { /* ignorieren */ }
    throw new Error(`open-meteo ${res.status}: ${reason}`)
  }
  return await res.json()
}

async function fetchMetNorway(lat, lon) {
  // Met Norway erwartet `lat` und `lon` als reine Floats. Genauigkeit > 4
  // Nachkommastellen wird per Vertrag abgelehnt — wir runden.
  const latStr = Number(lat).toFixed(4)
  const lonStr = Number(lon).toFixed(4)
  const url = `${MET_NORWAY_BASE}?lat=${latStr}&lon=${lonStr}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': MET_NORWAY_UA,
      'Accept': 'application/json'
    },
    cf: { cacheTtl: 1800, cacheEverything: true }
  })
  if (!res.ok) throw new Error(`met-norway ${res.status}`)
  return await res.json()
}

/* ---------- Aggregation ---------- */

/**
 * Wandelt Met-Norway-Stündlichkeiten in eine Map (lokales Datum → {max,min}) um.
 * Tage, deren Sampling nicht sowohl Morgen- als auch Nachmittagsstunden
 * abdeckt, werden verworfen — sonst läge der „Tageshöchst" für heute z. B.
 * nur auf den Abendstunden und würde den Mittelwert verfälschen.
 */
function metNorwayToDaily(mn, tz) {
  const byDate = new Map()
  const series = mn?.properties?.timeseries
  if (!Array.isArray(series)) return byDate

  for (const ts of series) {
    const temp = ts?.data?.instant?.details?.air_temperature
    if (typeof temp !== 'number') continue
    const d = new Date(ts.time)
    if (Number.isNaN(d.getTime())) continue

    const { date, hour } = localDateAndHour(d, tz)

    let entry = byDate.get(date)
    if (!entry) {
      entry = { max: temp, min: temp, hasMorning: false, hasAfternoon: false }
      byDate.set(date, entry)
    }
    if (temp > entry.max) entry.max = temp
    if (temp < entry.min) entry.min = temp
    if (hour < 12) entry.hasMorning = true
    else entry.hasAfternoon = true
  }

  for (const [date, entry] of byDate) {
    if (!entry.hasMorning || !entry.hasAfternoon) byDate.delete(date)
  }
  return byDate
}

function localDateAndHour(d, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  }).formatToParts(d)
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    hour: parseInt(lookup.hour, 10)
  }
}

/**
 * Erzeugt die finale `daily`-Struktur. Min/Max-Temperaturen werden über beide
 * Quellen gemittelt, sofern beide vorhanden sind. Weather-Code und PoP bleiben
 * von Open-Meteo (Met Norway hat in diesem Forecast-Horizont keinen
 * vergleichbaren Datentyp).
 */
function mergeDaily(omDaily, mnByDate) {
  const time = Array.isArray(omDaily?.time) ? omDaily.time : []
  const omMax = omDaily?.temperature_2m_max || []
  const omMin = omDaily?.temperature_2m_min || []

  const out = {
    time: [...time],
    weather_code: pickArray(omDaily?.weather_code, time.length),
    temperature_2m_max: [],
    temperature_2m_min: [],
    precipitation_probability_max: pickArray(omDaily?.precipitation_probability_max, time.length)
  }
  const sourcesPerDay = []

  for (let i = 0; i < time.length; i++) {
    const dateKey = time[i]
    const mn = mnByDate ? mnByDate.get(dateKey) : null
    const om_x = typeof omMax[i] === 'number' ? omMax[i] : null
    const om_n = typeof omMin[i] === 'number' ? omMin[i] : null

    if (mn && typeof mn.max === 'number' && typeof mn.min === 'number' && om_x !== null && om_n !== null) {
      out.temperature_2m_max.push(round1((om_x + mn.max) / 2))
      out.temperature_2m_min.push(round1((om_n + mn.min) / 2))
      sourcesPerDay.push(2)
    } else {
      out.temperature_2m_max.push(om_x)
      out.temperature_2m_min.push(om_n)
      sourcesPerDay.push(1)
    }
  }

  return { daily: out, sourcesPerDay }
}

function pickArray(arr, len) {
  if (!Array.isArray(arr)) return new Array(len).fill(null)
  return arr.slice(0, len)
}

function round1(v) { return Math.round(v * 10) / 10 }

/* ---------- Antwort-Bestandteile ---------- */

function pickUnits(units) {
  if (!units) return null
  const allowed = [
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_probability_max'
  ]
  const out = {}
  for (const key of allowed) {
    if (typeof units[key] === 'string') out[key] = units[key]
  }
  return out
}

function composeNote(withinForecastWindow, sourcesAvailable) {
  const ensemble = sourcesAvailable === 2 ? 'Mittel aus 2 Modellen' : '1 Modell aktiv'
  if (withinForecastWindow) {
    return `Live Forecast aktiv · ${ensemble}. Das Ziel bleibt geheim.`
  }
  return `Live Forecast wird tagesweise verfügbar · ${ensemble}. Das Ziel bleibt geheim.`
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
