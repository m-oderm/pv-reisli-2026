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
 * Die Antwort enthält NIE Koordinaten, Ortsnamen oder Zeitzone.
 * Sie kann von jedem Browser unter `/api/travel-conditions`
 * (per Worker-Route oder als Pages-Function gemappt) abgerufen werden.
 */

const TRAVEL_START = '2026-05-30'
const TRAVEL_END = '2026-06-02'
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast'
const DAILY_PARAMS =
  'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'

// Open-Meteo liefert mit dem GFS-Modell bis ca. 15 Tage in die Zukunft.
// Wir bleiben mit 13 Tagen Puffer auf der sicheren Seite.
const FORECAST_HORIZON_DAYS = 13

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // Nur GET auf /api/travel-conditions ist erlaubt.
    if (url.pathname !== '/api/travel-conditions') {
      return notFound()
    }
    if (request.method === 'OPTIONS') {
      return preflight()
    }
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

    // Wir fragen den exakten Reise-Range nur, wenn auch der letzte Reisetag
    // sicher im Modell-Fenster liegt. Sonst holen wir den maximalen Forecast,
    // damit Reisetage automatisch im Frontend auftauchen, sobald sie verfügbar
    // werden.
    const withinForecastWindow =
      daysUntilEnd <= FORECAST_HORIZON_DAYS && daysUntilStart >= -7

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

    const apiUrl = `${OPEN_METEO_BASE}?${params.toString()}`

    try {
      const upstream = await fetch(apiUrl, {
        cf: { cacheTtl: 1800, cacheEverything: true }
      })

      if (!upstream.ok) {
        // Open-Meteo liefert bei Fehlern { error: true, reason: "..." }.
        // Wir reichen den `reason` durch — er enthält keine Ortsangaben.
        let detail = ''
        try {
          const body = await upstream.json()
          if (typeof body?.reason === 'string') detail = body.reason
        } catch {
          /* ignorieren */
        }
        return jsonResponse(
          { error: 'upstream_error', status: upstream.status, detail },
          502
        )
      }

      const raw = await upstream.json()

      // Nur die wirklich nötigen Felder durchreichen.
      // KEINE Koordinaten, KEIN Ortsname, KEINE Zeitzone.
      const sanitised = {
        daily: pickDaily(raw.daily),
        daily_units: pickUnits(raw.daily_units),
        within_travel_window: withinForecastWindow,
        note: withinForecastWindow
          ? 'Live Forecast aktiv. Das Ziel bleibt geheim.'
          : 'Live Forecast wird tagesweise verfügbar. Das Ziel bleibt geheim.'
      }

      return jsonResponse(sanitised, 200, {
        'Cache-Control': 'public, max-age=1800'
      })
    } catch (err) {
      return jsonResponse(
        { error: 'fetch_failed', note: 'Forecast-Dienst aktuell nicht erreichbar.' },
        502
      )
    }
  }
}

function pickDaily(daily) {
  if (!daily) return null
  // Wir akzeptieren nur eine fest definierte Whitelist an Feldern.
  const allowed = [
    'time',
    'weather_code',
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_probability_max'
  ]
  const out = {}
  for (const key of allowed) {
    if (Array.isArray(daily[key])) out[key] = daily[key]
  }
  return out
}

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
