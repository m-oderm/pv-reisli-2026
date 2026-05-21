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
 * Datenmodell:
 *   * Forecast-API (best_match): liefert deterministische Felder wie
 *     Wetter-Code, Sonnenauf-/-untergang, UV-Index.
 *   * Ensemble-API mit drei Modellen (ECMWF IFS, GFS, ICON-EPS):
 *     liefert ~120 Members pro Variable. Daraus berechnen wir pro Tag
 *     Median (Best Guess) und P10/P90 (Bandbreite).
 *
 * Die Antwort enthält nie Koordinaten, Ortsnamen oder Zeitzone.
 */

const TRAVEL_START = '2026-05-30'
const TRAVEL_END = '2026-06-02'

const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast'
const OPEN_METEO_ENSEMBLE = 'https://ensemble-api.open-meteo.com/v1/ensemble'

const ENSEMBLE_MODELS = 'ecmwf_ifs025,gfs_seamless,icon_seamless'
const ENSEMBLE_HOURLY = 'temperature_2m,precipitation,wind_speed_10m,weather_code'

const FORECAST_DAILY = [
  'weather_code',
  'sunshine_duration',
  'daylight_duration',
  'sunrise',
  'sunset',
  'wind_direction_10m_dominant'
].join(',')

const FORECAST_HOURLY = [
  'temperature_2m',
  'weather_code',
  'precipitation_probability'
].join(',')

const MS_PER_DAY = 86_400_000
const CACHE_TTL_SECONDS = 1800
const FALLBACK_FORECAST_DAYS = 16
const FORECAST_HORIZON_DAYS = 13
const ALLOW_PAST_TRIP_DAYS = 7
const ERROR_DETAIL_MAX_CHARS = 200

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

    const [forecastRes, ensembleRes] = await Promise.allSettled([
      fetchForecast({ lat, lon, tz, useTripRange }),
      fetchEnsemble({ lat, lon, tz, useTripRange })
    ])

    const forecast = forecastRes.status === 'fulfilled' ? forecastRes.value : null
    const ensemble = ensembleRes.status === 'fulfilled' ? ensembleRes.value : null

    if (!forecast) {
      const detail =
        forecastRes.status === 'rejected'
          ? String(forecastRes.reason).slice(0, ERROR_DETAIL_MAX_CHARS)
          : ''
      return jsonResponse({ error: 'primary_source_failed', detail }, 502)
    }

    const daily = composeDaily(forecast, ensemble, tz)
    const confidencePerDay = daily.time.map((_, idx) =>
      estimateConfidence({
        tMaxRange: rangeAt(daily.temperature_2m_max_p10, daily.temperature_2m_max_p90, idx),
        tMinRange: rangeAt(daily.temperature_2m_min_p10, daily.temperature_2m_min_p90, idx)
      })
    )

    return jsonResponse(
      {
        daily,
        daily_units: pickUnits(forecast.daily_units),
        hourly: composeHourly(forecast, ensemble),
        within_travel_window: useTripRange,
        ensemble_active: Boolean(ensemble),
        confidence_per_day: confidencePerDay,
        note: composeNote(useTripRange, Boolean(ensemble))
      },
      200,
      { 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` }
    )
  }
}

/* ----- Window-Check ---------------------------------------------- */

function tripRangeStillAvailable(today) {
  const tripStart = new Date(`${TRAVEL_START}T00:00:00Z`)
  const tripEnd = new Date(`${TRAVEL_END}T00:00:00Z`)
  const daysUntilStart = Math.floor((tripStart.getTime() - today.getTime()) / MS_PER_DAY)
  const daysUntilEnd = Math.floor((tripEnd.getTime() - today.getTime()) / MS_PER_DAY)
  return daysUntilEnd <= FORECAST_HORIZON_DAYS && daysUntilStart >= -ALLOW_PAST_TRIP_DAYS
}

/* ----- Quellen --------------------------------------------------- */

async function fetchForecast({ lat, lon, tz, useTripRange }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: String(tz),
    daily: FORECAST_DAILY,
    hourly: FORECAST_HOURLY
  })
  if (useTripRange) {
    params.set('start_date', TRAVEL_START)
    params.set('end_date', TRAVEL_END)
  } else {
    params.set('forecast_days', String(FALLBACK_FORECAST_DAYS))
  }

  const res = await fetch(`${OPEN_METEO_FORECAST}?${params.toString()}`, {
    cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true }
  })
  if (!res.ok) {
    let reason = ''
    try {
      const body = await res.json()
      if (typeof body?.reason === 'string') reason = body.reason
    } catch {}
    throw new Error(`forecast ${res.status}: ${reason}`)
  }
  return await res.json()
}

async function fetchEnsemble({ lat, lon, tz, useTripRange }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: String(tz),
    hourly: ENSEMBLE_HOURLY,
    models: ENSEMBLE_MODELS
  })
  if (useTripRange) {
    params.set('start_date', TRAVEL_START)
    params.set('end_date', TRAVEL_END)
  } else {
    params.set('forecast_days', String(FALLBACK_FORECAST_DAYS))
  }

  const res = await fetch(`${OPEN_METEO_ENSEMBLE}?${params.toString()}`, {
    cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true }
  })
  if (!res.ok) throw new Error(`ensemble ${res.status}`)
  return await res.json()
}

/* ----- Aggregation: hourly Ensemble → daily Statistik -------- */

const MEMBER_KEY_PATTERN = /^(temperature_2m|precipitation|wind_speed_10m|weather_code)_(member\d{2}_)?([a-z0-9_]+)$/

/**
 * Gruppiert die hourly-Member-Spalten nach Variable.
 * Returns `{ temperature_2m: [arr1, arr2, ...], precipitation: [...], wind_speed_10m: [...], weather_code: [...] }`.
 * Die nicht-perturbed Kontroll-Läufe (ohne `_memberNN_`) werden ebenfalls mitgenommen.
 */
function groupMembersByVariable(hourly) {
  const out = {
    temperature_2m: [],
    precipitation: [],
    wind_speed_10m: [],
    weather_code: []
  }
  if (!hourly || typeof hourly !== 'object') return out
  for (const key of Object.keys(hourly)) {
    if (key === 'time') continue
    const match = key.match(MEMBER_KEY_PATTERN)
    if (!match) continue
    const variable = match[1]
    const series = hourly[key]
    if (!Array.isArray(series) || !out[variable]) continue
    out[variable].push(series)
  }
  return out
}

/**
 * Reduziert eine hourly-Serie eines Members auf einen Tageswert.
 * Aggregator-Modi: 'max', 'min', 'sum'. NaN/null/undefined wird ignoriert.
 */
function aggregateDay(hourlyValues, hourIndexes, mode) {
  let acc = mode === 'sum' ? 0 : null
  let seen = 0
  for (const idx of hourIndexes) {
    const v = hourlyValues[idx]
    if (typeof v !== 'number' || Number.isNaN(v)) continue
    seen++
    if (mode === 'sum') acc += v
    else if (acc === null || (mode === 'max' && v > acc) || (mode === 'min' && v < acc)) acc = v
  }
  return seen === 0 ? null : acc
}

/**
 * Berechnet aus mehreren Member-Serien für einen Tag den Median und die
 * 10/90-Perzentile. Konvention: linearer Interpolations-Quantil.
 */
function quantiles(values) {
  const cleaned = values.filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((a, b) => a - b)
  if (cleaned.length === 0) return { p10: null, p50: null, p90: null }
  return {
    p10: quantile(cleaned, 0.1),
    p50: quantile(cleaned, 0.5),
    p90: quantile(cleaned, 0.9)
  }
}

function quantile(sorted, q) {
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * Filtert hourly-Indizes auf jene zwischen Sonnenaufgang und Sonnenuntergang.
 * Die Zeiten sind ISO-Strings ohne Zeitzone (Open-Meteo liefert sie in der
 * angefragten Zeitzone), lexikographischer Vergleich entspricht
 * chronologischer Reihenfolge.
 */
function filterToDaylight(hourIdxs, times, sunrise, sunset) {
  if (!hourIdxs || !Array.isArray(times) || !sunrise || !sunset) return null
  return hourIdxs.filter((i) => {
    const t = times[i]
    return typeof t === 'string' && t >= sunrise && t <= sunset
  })
}

/**
 * Wählt aus mehreren Members einen repräsentativen Wetter-Code.
 *
 * Dreistufige Logik, die zwischen «klar» (Codes 0-3) und «Regen» (51+)
 * einen weichen Übergang über Code 80 (Regenschauer) modelliert:
 *
 *   * ≥ 50 % Members mit Niederschlag → Median der Niederschlags-Codes
 *     (klare Mehrheit, konkreter Regen-Typ)
 *   * 30-50 % Members mit Niederschlag → Code 80 (Regenschauer)
 *     (gemischtes Bild, sporadischer Niederschlag möglich)
 *   * < 30 % Members mit Niederschlag → Median der trockenen Codes
 *     (Mehrheit trocken, kein Regen-Risiko anzeigen)
 *
 * Verhindert die harten P75-Sprünge zwischen «bedeckt» und «Regen» und
 * spiegelt das Modell-Konsens besser wider.
 */
function hybridWeatherCode(codes) {
  if (!Array.isArray(codes) || codes.length === 0) return null

  const wet = codes.filter((c) => c >= 51).length
  const wetRatio = wet / codes.length

  if (wetRatio >= 0.5) {
    const wetSorted = codes.filter((c) => c >= 51).sort((a, b) => a - b)
    return wetSorted[Math.floor(wetSorted.length / 2)]
  }

  if (wetRatio >= 0.3) {
    return 80
  }

  const drySorted = codes.filter((c) => c < 51).sort((a, b) => a - b)
  if (drySorted.length === 0) return null
  return drySorted[Math.floor(drySorted.length / 2)]
}

/**
 * Aggregiert pro Member den Tageshöchst-Code (worst hour of day) und
 * leitet daraus den repräsentativen Tages-Code via hybridWeatherCode ab.
 */
function dominantWeatherCode(memberSeries, hourIdxs) {
  if (!Array.isArray(memberSeries) || memberSeries.length === 0) return null
  const dayMax = []
  for (const series of memberSeries) {
    if (!Array.isArray(series)) continue
    let max = null
    for (const i of hourIdxs) {
      const v = series[i]
      if (typeof v === 'number' && !Number.isNaN(v) && (max === null || v > max)) {
        max = v
      }
    }
    if (max !== null) dayMax.push(max)
  }
  return hybridWeatherCode(dayMax)
}

/**
 * Bildet die hourly Indexes pro lokalem Datum. Die Ensemble-API liefert
 * Zeitstempel bereits in der gewünschten Zeitzone (timezone-Parameter),
 * also reicht der Datums-Prefix für Gruppierung.
 */
function groupHoursByLocalDate(times) {
  const byDate = new Map()
  for (let i = 0; i < times.length; i++) {
    const date = String(times[i]).slice(0, 10)
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date).push(i)
  }
  return byDate
}

/**
 * Berechnet aus den Ensemble-Members pro Tag und Variable die
 * Statistik-Felder. Liefert ein Map von `{ date -> { tMaxP10, tMaxP50, ... } }`.
 */
function ensembleDailyStats(ensemble) {
  if (!ensemble?.hourly?.time) return new Map()
  const grouped = groupMembersByVariable(ensemble.hourly)
  const byDate = groupHoursByLocalDate(ensemble.hourly.time)

  const stats = new Map()
  for (const [date, hourIdxs] of byDate) {
    const tMax = grouped.temperature_2m.map((s) => aggregateDay(s, hourIdxs, 'max'))
    const tMin = grouped.temperature_2m.map((s) => aggregateDay(s, hourIdxs, 'min'))
    const pSum = grouped.precipitation.map((s) => aggregateDay(s, hourIdxs, 'sum'))
    const wMax = grouped.wind_speed_10m.map((s) => aggregateDay(s, hourIdxs, 'max'))

    stats.set(date, {
      tMax: quantiles(tMax),
      tMin: quantiles(tMin),
      pSum: quantiles(pSum),
      wMax: quantiles(wMax)
    })
  }
  return stats
}

/* ----- Daily-Komposition ----------------------------------------- */

function composeDaily(forecast, ensemble) {
  const fDaily = forecast?.daily ?? {}
  const time = Array.isArray(fDaily.time) ? fDaily.time : []
  const stats = ensembleDailyStats(ensemble)
  const grouped = groupMembersByVariable(ensemble?.hourly)
  const codeMembers = grouped.weather_code
  const precipMembers = grouped.precipitation
  const hoursByDate = ensemble?.hourly?.time
    ? groupHoursByLocalDate(ensemble.hourly.time)
    : new Map()

  const out = {
    time: [...time],
    weather_code: [],
    sunshine_duration: truncate(fDaily.sunshine_duration, time.length),
    daylight_duration: truncate(fDaily.daylight_duration, time.length),
    sunrise: truncate(fDaily.sunrise, time.length),
    sunset: truncate(fDaily.sunset, time.length),
    wind_direction_10m_dominant: truncate(fDaily.wind_direction_10m_dominant, time.length),

    temperature_2m_max: [],
    temperature_2m_max_p10: [],
    temperature_2m_max_p90: [],
    temperature_2m_min: [],
    temperature_2m_min_p10: [],
    temperature_2m_min_p90: [],

    precipitation_sum: [],
    precipitation_sum_p10: [],
    precipitation_sum_p90: [],
    precipitation_probability_max: [],

    wind_speed_10m_max: [],
    wind_speed_10m_max_p10: [],
    wind_speed_10m_max_p90: []
  }

  for (let i = 0; i < time.length; i++) {
    const date = time[i]
    const s = stats.get(date)

    const hourIdxs = hoursByDate.get(date)
    // Code-Auswahl nur über Tagstunden, damit Niederschlag in der Nacht das
    // Vorschau-Icon nicht dominiert. Reisende wollen wissen wie das Wetter
    // tagsüber wird.
    const sunrise = fDaily.sunrise?.[i] ?? null
    const sunset = fDaily.sunset?.[i] ?? null
    const daylightIdxs = filterToDaylight(hourIdxs, ensemble?.hourly?.time, sunrise, sunset)
    const codeIdxs = daylightIdxs?.length ? daylightIdxs : hourIdxs
    const ensembleCode = codeIdxs ? dominantWeatherCode(codeMembers, codeIdxs) : null
    out.weather_code.push(ensembleCode ?? fDaily.weather_code?.[i] ?? null)

    out.temperature_2m_max.push(roundOneDecimal(s?.tMax.p50))
    out.temperature_2m_max_p10.push(roundOneDecimal(s?.tMax.p10))
    out.temperature_2m_max_p90.push(roundOneDecimal(s?.tMax.p90))

    out.temperature_2m_min.push(roundOneDecimal(s?.tMin.p50))
    out.temperature_2m_min_p10.push(roundOneDecimal(s?.tMin.p10))
    out.temperature_2m_min_p90.push(roundOneDecimal(s?.tMin.p90))

    out.precipitation_sum.push(roundOneDecimal(s?.pSum.p50))
    out.precipitation_sum_p10.push(roundOneDecimal(s?.pSum.p10))
    out.precipitation_sum_p90.push(roundOneDecimal(s?.pSum.p90))

    // Anteil Members mit "spürbarem" Niederschlag > 1 mm, als ehrliche
    // Regenwahrscheinlichkeit (gleiche Schwelle wie Kachelmannwetter).
    out.precipitation_probability_max.push(
      hourIdxs ? rainProbability(precipMembers, hourIdxs) : null
    )

    out.wind_speed_10m_max.push(roundOneDecimal(s?.wMax.p50))
    out.wind_speed_10m_max_p10.push(roundOneDecimal(s?.wMax.p10))
    out.wind_speed_10m_max_p90.push(roundOneDecimal(s?.wMax.p90))
  }
  return out
}

function rainProbability(precipMembers, hourIdxs) {
  if (!Array.isArray(precipMembers) || precipMembers.length === 0) return null
  const dailySums = precipMembers
    .map((s) => aggregateDay(s, hourIdxs, 'sum'))
    .filter((v) => typeof v === 'number')
  if (dailySums.length === 0) return null
  const wet = dailySums.filter((v) => v > 1).length
  return Math.round((wet / dailySums.length) * 100)
}

/* ----- Confidence aus Bandbreite --------------------------------- */

function rangeAt(p10arr, p90arr, idx) {
  const a = p10arr?.[idx]
  const b = p90arr?.[idx]
  if (typeof a !== 'number' || typeof b !== 'number') return null
  return b - a
}

/**
 * Confidence aus der Temperatur-Bandbreite des Ensembles. Eng beieinander =
 * Modelle einig = hohes Vertrauen. Stark gespreizt = unsicher.
 */
function estimateConfidence({ tMaxRange, tMinRange }) {
  const ranges = [tMaxRange, tMinRange].filter((r) => typeof r === 'number')
  if (ranges.length === 0) return null
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length
  if (avgRange < 1.5) return 95
  if (avgRange < 3) return 85
  if (avgRange < 5) return 70
  if (avgRange < 7) return 55
  if (avgRange < 10) return 40
  return 30
}

/* ----- Helper ---------------------------------------------------- */

function truncate(arr, len) {
  return Array.isArray(arr) ? arr.slice(0, len) : new Array(len).fill(null)
}

function roundOneDecimal(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  return Math.round(value * 10) / 10
}

const ALLOWED_UNIT_KEYS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_speed_10m_max',
  'sunshine_duration',
  'daylight_duration'
]

function pickUnits(units) {
  if (!units) return null
  return ALLOWED_UNIT_KEYS.reduce((out, key) => {
    if (typeof units[key] === 'string') out[key] = units[key]
    return out
  }, {})
}

const ALLOWED_HOURLY_KEYS = [
  'time',
  'temperature_2m',
  'weather_code',
  'precipitation_probability'
]

function pickHourly(hourly) {
  if (!hourly) return null
  const out = {}
  for (const key of ALLOWED_HOURLY_KEYS) {
    if (Array.isArray(hourly[key])) out[key] = hourly[key]
  }
  return out
}

/**
 * Aggregiert die hourly-Daten aus dem Ensemble zu konsistenten Werten:
 *   * temperature_2m: Median über alle Members
 *   * weather_code: 75. Perzentil (gleicher Pessimismus-Bias wie bei daily)
 *   * precipitation_probability: Anteil Members mit > 0.1 mm Niederschlag
 * So sind Code und PoP innerhalb derselben Stunde konsistent — sie kommen
 * aus demselben Member-Pool statt aus Open-Meteos best_match-Mix, der
 * jeden Wert aus einem anderen Modell ziehen kann.
 *
 * Fällt das Ensemble aus, wird auf den deterministischen Forecast zurückgegriffen.
 */
function composeHourly(forecast, ensemble) {
  const ensembleHourly = ensemble?.hourly
  if (!ensembleHourly?.time?.length) {
    return pickHourly(forecast?.hourly)
  }

  const times = ensembleHourly.time
  const grouped = groupMembersByVariable(ensembleHourly)
  const out = {
    time: [...times],
    temperature_2m: new Array(times.length).fill(null),
    weather_code: new Array(times.length).fill(null),
    precipitation_probability: new Array(times.length).fill(null)
  }

  for (let i = 0; i < times.length; i++) {
    const temps = collectAtHour(grouped.temperature_2m, i).sort((a, b) => a - b)
    if (temps.length > 0) out.temperature_2m[i] = roundOneDecimal(quantile(temps, 0.5))

    const codes = collectAtHour(grouped.weather_code, i)
    if (codes.length > 0) {
      out.weather_code[i] = hybridWeatherCode(codes)
      // PoP: Anteil Members mit Niederschlags-Code (51+).
      const wet = codes.filter((c) => c >= 51).length
      out.precipitation_probability[i] = Math.round((wet / codes.length) * 100)
    }
  }
  return out
}

function collectAtHour(memberSeries, hourIdx) {
  if (!Array.isArray(memberSeries)) return []
  const out = []
  for (const series of memberSeries) {
    const v = series?.[hourIdx]
    if (typeof v === 'number' && !Number.isNaN(v)) out.push(v)
  }
  return out
}

function composeNote(useTripRange, ensembleActive) {
  const lead = ensembleActive
    ? 'Sonne, Regen oder Ausreden: Wir sind vorbereitet'
    : 'Wetterlage gemeldet'
  return useTripRange
    ? `${lead}. Tag antippen für das Detail-Briefing.`
    : `${lead}. Akte wird tagesweise schärfer. Tag antippen für Details.`
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
