import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, MotionConfig, useDragControls, useReducedMotion } from 'framer-motion'
import {
  Beer,
  Bug,
  Building2,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  CircleX,
  Clock,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudMoonRain,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  CloudSunRain,
  Compass,
  Copy,
  Coffee,
  Droplets,
  Dumbbell,
  ExternalLink,
  FileText,
  Flame,
  Footprints,
  HeartPulse,
  HelpCircle,
  Hourglass,
  Lightbulb,
  Lock,
  Luggage,
  Map,
  MapPin,
  MessageCircle,
  Martini,
  Moon,
  Mountain,
  Music,
  RefreshCw,
  ShieldCheck,
  Shirt,
  Smartphone,
  Snowflake,
  Sparkles,
  Square,
  Sun,
  SunMedium,
  Tent,
  Ticket,
  Train,
  Umbrella,
  Users,
  Utensils,
  WalletCards,
  Wind,
  X
} from 'lucide-react'

/*
 * PV-Reisli 2026, Einseiten-Reisewebsite für Pegelspitze Reisen.
 * Der Zielort bleibt geheim. Wetterdaten kommen aus worker/travel-conditions.js,
 * die Koordinaten liegen ausschliesslich als Cloudflare Secrets vor.
 */

const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

const NAV_OFFSET_PX = 72
const HOURLY_REFRESH_MS = MS_PER_HOUR

// Bewegungs-Kurven, identisch zu den CSS-Variablen --ease-smooth und --ease-out-soft.
const EASE_SMOOTH = [0.4, 0, 0.2, 1]
const EASE_OUT_SOFT = [0.16, 1, 0.3, 1]

// 30.05.2026, 07:45 Uhr Europe/Zurich. Ende Mai gilt CEST, also UTC+2.
const COUNTDOWN_TARGET_MS = new Date('2026-05-30T07:45:00+02:00').getTime()
const TRAVEL_QUEST_START_MS = COUNTDOWN_TARGET_MS
const SATURDAY_UNLOCK_MS = new Date('2026-05-30T12:20:00+02:00').getTime()
const SATURDAY_MIDNIGHT_MS = new Date('2026-05-30T00:00:00+02:00').getTime()
const TRIP_END_MS = new Date('2026-06-02T19:00:00+02:00').getTime()

const NAV_ITEMS_PRE_TRIP = [
  { id: 'eckdaten', label: 'Eckdaten' },
  { id: 'countdown', label: 'Countdown' },
  { id: 'wetter', label: 'Wetter' },
  { id: 'packliste', label: 'Packliste' },
  { id: 'dresscode', label: 'Dresscode' }
]
const NAV_ITEMS_DURING_TRIP = [
  { id: 'tagesbriefing', label: 'Tagesbriefing' },
  { id: 'eckdaten', label: 'Eckdaten' },
  { id: 'reiseleitung', label: 'Reiseleitung' },
  { id: 'wetter', label: 'Wetter' }
]

function getNavItems(tripStarted) {
  return tripStarted ? NAV_ITEMS_DURING_TRIP : NAV_ITEMS_PRE_TRIP
}

// Zeit-Override per ?now=ISO im Frontend. Nur fuer UI-Phase-Entscheidungen,
// die echte Geheimhaltung laeuft serverseitig im Worker.
function getOverrideNow() {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('now')
    if (!raw) return null
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? null : parsed
  } catch {
    return null
  }
}
const NOW_OVERRIDE_MS = getOverrideNow()
function effectiveNow() {
  return NOW_OVERRIDE_MS ?? Date.now()
}

function getTestKey() {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('testKey')
  } catch {
    return null
  }
}
const TEST_KEY = getTestKey()

function getDebugFlag() {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('debug') === '1'
  } catch {
    return false
  }
}
const DEBUG_MODE = getDebugFlag()

const TRAVEL_DATES = ['2026-05-30', '2026-05-31', '2026-06-01', '2026-06-02']

const FALLBACK_PAYLOAD = {
  daily: {
    time: TRAVEL_DATES,
    weather_code: [2, 2, 95, 2],
    temperature_2m_max: [22, 23, 22, 22],
    temperature_2m_min: [12, 13, 13, 12],
    precipitation_probability_max: [25, 30, 55, 35]
  },
  note: 'Aktuell offline. Neutrale Vorschau, das Ziel bleibt geheim.'
}

const WEATHER_FALLBACK_INFO = { label: 'wechselhaft', Icon: CloudSun }

// Open-Meteo WMO Wetter-Codes auf laienverständliche Labels.
const WEATHER_CODE_TABLE = {
  0: { label: 'sonnig', Icon: Sun },
  1: { label: 'meist sonnig', Icon: Sun },
  2: { label: 'teils bewölkt', Icon: CloudSun },
  3: { label: 'bedeckt', Icon: Cloud },
  45: { label: 'neblig', Icon: CloudFog },
  48: { label: 'neblig', Icon: CloudFog },
  51: { label: 'leichter Regen', Icon: CloudDrizzle },
  53: { label: 'leichter Regen', Icon: CloudDrizzle },
  55: { label: 'anhaltender Regen', Icon: CloudRain },
  56: { label: 'gefrierender Regen', Icon: CloudRainWind },
  57: { label: 'gefrierender Regen', Icon: CloudRainWind },
  61: { label: 'leichter Regen', Icon: CloudDrizzle },
  63: { label: 'Regen', Icon: CloudRain },
  65: { label: 'starker Regen', Icon: CloudRainWind },
  66: { label: 'gefrierender Regen', Icon: CloudRainWind },
  67: { label: 'gefrierender Regen', Icon: CloudRainWind },
  71: { label: 'leichter Schneefall', Icon: CloudSnow },
  73: { label: 'Schneefall', Icon: CloudSnow },
  75: { label: 'starker Schneefall', Icon: CloudSnow },
  77: { label: 'Schneefall', Icon: Snowflake },
  80: { label: 'wechselhaft', Icon: CloudSunRain },
  81: { label: 'wechselhaft', Icon: CloudSunRain },
  82: { label: 'heftige Schauer', Icon: CloudRainWind },
  85: { label: 'Schneeschauer', Icon: CloudSnow },
  86: { label: 'Schneeschauer', Icon: CloudSnow },
  95: { label: 'Gewitter', Icon: CloudLightning },
  96: { label: 'Gewitter mit Hagel', Icon: CloudLightning },
  99: { label: 'Hagelgewitter', Icon: CloudLightning }
}

/* ----- Hilfsfunktionen ------------------------------------------- */

function splitMs(ms) {
  return {
    days: Math.floor(ms / MS_PER_DAY),
    hours: Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR),
    minutes: Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE),
    seconds: Math.floor((ms % MS_PER_MINUTE) / MS_PER_SECOND)
  }
}

function formatGermanDay(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const weekday = date.toLocaleDateString('de-CH', { weekday: 'short', timeZone: 'UTC' })
  return `${weekday}, ${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.`
}

// Für die Nachtstunden ersetzen wir Sonne/CloudSun durch Mond/CloudMoon,
// damit das stündliche Bild zur Tageszeit passt.
const NIGHT_ICON_OVERRIDES = {
  0: Moon,
  1: Moon,
  2: CloudMoon,
  80: CloudMoonRain,
  81: CloudMoonRain
}

function weatherCodeToInfo(code, isNight = false) {
  const known = WEATHER_CODE_TABLE[code]
  const info = known ?? WEATHER_FALLBACK_INFO
  if (isNight) {
    if (NIGHT_ICON_OVERRIDES[code]) {
      return { ...info, Icon: NIGHT_ICON_OVERRIDES[code] }
    }
    if (!known) {
      // Unbekannter Code in der Nacht: CloudSunRain waere unpassend, neutrale
      // Mond-Variante verwenden.
      return { ...info, Icon: CloudMoon }
    }
  }
  return info
}

function smoothScrollTo(id) {
  const el = document.getElementById(id)
  if (!el) return
  const top = el.getBoundingClientRect().top + window.scrollY - NAV_OFFSET_PX
  window.scrollTo({ top, behavior: 'smooth' })
}

function deriveDays(data) {
  if (!data?.daily?.time) return []
  const d = data.daily
  const all = d.time.map((iso, idx) => ({
    iso,
    label: formatGermanDay(iso),
    info: weatherCodeToInfo(d.weather_code?.[idx] ?? 2),
    max: d.temperature_2m_max?.[idx],
    maxP10: d.temperature_2m_max_p10?.[idx] ?? null,
    maxP90: d.temperature_2m_max_p90?.[idx] ?? null,
    min: d.temperature_2m_min?.[idx],
    minP10: d.temperature_2m_min_p10?.[idx] ?? null,
    minP90: d.temperature_2m_min_p90?.[idx] ?? null,
    rain: d.precipitation_probability_max?.[idx],
    precipSum: d.precipitation_sum?.[idx] ?? null,
    precipSumP10: d.precipitation_sum_p10?.[idx] ?? null,
    precipSumP90: d.precipitation_sum_p90?.[idx] ?? null,
    wind: d.wind_speed_10m_max?.[idx] ?? null,
    windP10: d.wind_speed_10m_max_p10?.[idx] ?? null,
    windP90: d.wind_speed_10m_max_p90?.[idx] ?? null,
    windDir: d.wind_direction_10m_dominant?.[idx] ?? null,
    sunshineSec: d.sunshine_duration?.[idx] ?? null,
    daylightSec: d.daylight_duration?.[idx] ?? null,
    sunrise: d.sunrise?.[idx] ?? null,
    sunset: d.sunset?.[idx] ?? null,
    hourly: extractHourlyForDay(data.hourly, iso, d.sunrise?.[idx], d.sunset?.[idx]),
    confidence: data.confidence_per_day?.[idx] ?? null
  }))
  // Solange Reisetage im Forecast auftauchen, blenden wir den Rest aus.
  const trip = all.filter((day) => TRAVEL_DATES.includes(day.iso))
  return trip.length > 0 ? trip : all
}

function rangeNumber(v, decimals) {
  if (typeof v !== 'number') return null
  return decimals > 0 ? v.toFixed(decimals).replace('.', ',') : String(Math.round(v))
}

function normalizeLocalIso(value) {
  return typeof value === 'string' && value.length >= 16 ? value.slice(0, 16) : null
}

function extractHourlyForDay(hourly, iso, sunrise, sunset) {
  if (!hourly?.time || !iso) return null
  const rise = normalizeLocalIso(sunrise)
  const set = normalizeLocalIso(sunset)
  const points = []
  for (let i = 0; i < hourly.time.length; i++) {
    const ts = normalizeLocalIso(hourly.time[i])
    if (!ts || ts.slice(0, 10) !== iso) continue
    const isNight = rise && set ? !(ts >= rise && ts <= set) : false
    points.push({
      hour: parseInt(ts.slice(11, 13), 10),
      temp: hourly.temperature_2m?.[i] ?? null,
      code: hourly.weather_code?.[i] ?? null,
      pop: hourly.precipitation_probability?.[i] ?? null,
      isNight
    })
  }
  return points.length > 0 ? points : null
}

const COMPASS_POINTS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW']
function windDirectionLabel(deg) {
  if (typeof deg !== 'number') return null
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8
  return COMPASS_POINTS[idx]
}

function confidenceLabel(value) {
  if (value == null) return null
  if (value >= 80) return 'hoch'
  if (value >= 60) return 'mittel'
  if (value >= 45) return 'tief'
  return 'sehr tief'
}

function formatTimeOnly(iso) {
  if (!iso) return null
  const match = iso.match(/T(\d{2}:\d{2})/)
  return match ? match[1] : null
}

function formatSunshine(sunshineSec, daylightSec) {
  if (typeof sunshineSec !== 'number') return { value: null, hint: null }
  const hours = sunshineSec / 3600
  const value = `${hours.toFixed(1).replace('.', ',')} h`
  let hint = null
  if (typeof daylightSec === 'number' && daylightSec > 0) {
    const percent = Math.round((sunshineSec / daylightSec) * 100)
    hint = `${percent} % der Tageshelle`
  }
  return { value, hint }
}

/* ----- Hooks ----------------------------------------------------- */

function useCountdown(targetTs) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), MS_PER_SECOND)
    return () => clearInterval(id)
  }, [])
  const diff = Math.max(0, targetTs - now)
  return { ...splitMs(diff), done: diff === 0 }
}

function useTravelConditions() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isFallback, setIsFallback] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/travel-conditions', { cache: 'no-store' })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const json = await res.json()
      if (!json?.daily) throw new Error('no daily payload')
      setData(json)
      setIsFallback(false)
    } catch {
      setData(FALLBACK_PAYLOAD)
      setIsFallback(true)
    } finally {
      setUpdatedAt(new Date())
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
    const id = setInterval(reload, HOURLY_REFRESH_MS)
    return () => clearInterval(id)
  }, [reload])

  return { data, loading, isFallback, updatedAt, reload }
}

/* ----- Tagesprogramm ---------------------------------------------- */

function buildTripProgramUrl() {
  const base = '/api/trip-program'
  if (!NOW_OVERRIDE_MS) return base
  const params = new URLSearchParams()
  params.set('now', new Date(NOW_OVERRIDE_MS).toISOString())
  if (TEST_KEY) params.set('testKey', TEST_KEY)
  return `${base}?${params.toString()}`
}

function buildTravelStatusUrl() {
  const base = '/api/travel-status'
  if (!NOW_OVERRIDE_MS) return base
  const params = new URLSearchParams()
  params.set('now', new Date(NOW_OVERRIDE_MS).toISOString())
  if (TEST_KEY) params.set('testKey', TEST_KEY)
  return `${base}?${params.toString()}`
}

function useTripProgram() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    try {
      const res = await fetch(buildTripProgramUrl(), { cache: 'no-store' })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (e) {
      setError(e?.message || 'unknown')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
    const id = setInterval(reload, 60_000)
    return () => clearInterval(id)
  }, [reload])

  // Schneller Refetch beim Phasenwechsel: pruefe jede Sekunde, ob ein
  // unlockAt gerade ueberschritten wurde, dann reload.
  useEffect(() => {
    if (!data) return
    const stamps = []
    for (const d of data.days ?? []) {
      if (d.locked && d.unlockAt) stamps.push(Date.parse(d.unlockAt))
    }
    for (const h of data?.quest?.hints ?? []) {
      if (h.locked && h.unlockAt) stamps.push(Date.parse(h.unlockAt))
    }
    if (data.saturdayUnlock) stamps.push(Date.parse(data.saturdayUnlock))
    if (data.travelQuestStart) stamps.push(Date.parse(data.travelQuestStart))
    const future = stamps.filter((t) => t > effectiveNow())
    if (future.length === 0) return
    const id = setInterval(() => {
      const now = effectiveNow()
      if (future.some((t) => Math.abs(t - now) <= 1500 && t <= now)) {
        reload()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [data, reload])

  return { data, loading, error, reload }
}

function useTravelStatus() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let active = true
    const fallback = () => ({
      status: 'unknown',
      delayMinutes: null,
      message: 'Live-Zuginfo derzeit nicht verfügbar. Die Reiseleitung wirkt dennoch zuversichtlich.',
      updatedAt: new Date().toISOString()
    })
    const tick = async () => {
      try {
        const res = await fetch(buildTravelStatusUrl(), { cache: 'no-store' })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const body = await res.json()
        if (active) setStatus(body)
      } catch {
        if (active) setStatus(fallback())
      }
    }
    tick()
    const id = setInterval(tick, 90_000)
    return () => { active = false; clearInterval(id) }
  }, [])

  return status
}

function isoDateInZurich(ms) {
  const d = new Date(ms)
  // YYYY-MM-DD in Europe/Zurich. Wir nutzen toLocaleDateString.
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' })
  return fmt.format(d)
}

function getUnlockedDays(days, nowMs) {
  if (!Array.isArray(days)) return []
  return days.filter((d) => !d.locked || Date.parse(d.unlockAt) <= nowMs)
}

function getCurrentFocusDay(days, nowMs) {
  if (!Array.isArray(days) || days.length === 0) return null
  const today = isoDateInZurich(nowMs)
  const todayDay = days.find((d) => d.date === today && !d.locked)
  if (todayDay) return todayDay
  const unlocked = days.filter((d) => !d.locked)
  return unlocked.length > 0 ? unlocked[unlocked.length - 1] : null
}

function getUnlockedQuestHints(hints, nowMs) {
  if (!Array.isArray(hints)) return []
  return hints.filter((h) => !h.locked)
}

function getNextLockedHint(hints, nowMs) {
  if (!Array.isArray(hints)) return null
  return hints.find((h) => h.locked && Date.parse(h.unlockAt) > nowMs) ?? null
}

function getNextItemFromDay(day, nowMs) {
  if (!day?.items?.length) return null
  const today = isoDateInZurich(nowMs)
  // Wenn der Tag noch in der Zukunft liegt, ist sein erstes Item der naechste Fixpunkt.
  if (today !== day.date) {
    const dayStartMs = Date.parse(`${day.date}T00:00:00+02:00`)
    if (nowMs < dayStartMs) return day.items[0]
    return null
  }
  const nowDate = new Date(nowMs)
  const fmtHm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  const nowHm = fmtHm.format(nowDate)
  // Items mit konkretem HH:MM: erstes Item dessen Zeit groesser ist
  for (const item of day.items) {
    if (typeof item.time === 'string' && /^\d{2}:\d{2}$/.test(item.time) && item.time > nowHm) {
      return item
    }
  }
  // Fallback: textuelle Tageszeiten (Vormittag/Nachmittag/Abend/danach)
  const hour = parseInt(nowHm.slice(0, 2), 10)
  const buckets = []
  if (hour < 12) buckets.push('vormittag', 'morgen')
  if (hour < 17) buckets.push('nachmittag', 'lunch')
  if (hour < 22) buckets.push('abend')
  for (const item of day.items) {
    if (typeof item.time !== 'string') continue
    const t = item.time.toLowerCase()
    if (buckets.some((b) => t.includes(b))) return item
  }
  return null
}

function findWeatherForDate(weather, date) {
  if (!weather?.daily?.time || !date) return null
  const i = weather.daily.time.indexOf(date)
  if (i < 0) return null
  const get = (key) => weather.daily?.[key]?.[i]
  return {
    max: get('temperature_2m_max'),
    min: get('temperature_2m_min'),
    pop: get('precipitation_probability_max'),
    code: get('weather_code')
  }
}

function formatUnlockHm(iso) {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ms))
}

function formatUnlockFull(iso) {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ms))
}

async function copyToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch { /* fallback unten */ }
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

const ITEM_TYPE_ICONS = {
  travel: Train,
  food: Utensils,
  lodging: Building2,
  nightlife: Martini,
  activity: Map,
  free: Sparkles,
  meeting: Users
}
function iconForItem(type) {
  return ITEM_TYPE_ICONS[type] ?? Clock
}

/* ----- Komponenten ----------------------------------------------- */

function BrandLogo({ size = 44 }) {
  const secret = useSecretMode()
  const c = secret
    ? {
        discFrom: '#08230f',
        discTo: '#020a04',
        ring: '#4ade80',
        accent: '#facc15',
        forest: '#022c1a',
        forestStroke: '#86efac',
        box: '#facc15',
        boxHighlight: '#fde047',
        boxInk: '#050a05',
        gradId: 'discGradSecret'
      }
    : {
        discFrom: '#173052',
        discTo: '#0b223d',
        ring: '#b88a3b',
        accent: '#b88a3b',
        forest: '#163d34',
        forestStroke: '#f7ecd1',
        box: '#f7ecd1',
        boxHighlight: '#fff8e1',
        boxInk: '#132238',
        gradId: 'discGrad'
      }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      role="img"
      aria-label="Pegelspitze Reisen"
      className="brand-logo"
    >
      <defs>
        <radialGradient id={c.gradId} cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor={c.discFrom} />
          <stop offset="100%" stopColor={c.discTo} />
        </radialGradient>
      </defs>
      <circle cx="40" cy="40" r="37" fill={`url(#${c.gradId})`} stroke={c.ring} strokeWidth="2.5" />
      <circle cx="40" cy="40" r="32" fill="none" stroke={c.ring} strokeOpacity="0.45" strokeDasharray="2 3" />
      <path d="M14 54 L30 32 L40 44 L52 26 L66 54 Z" fill={c.forest} stroke={c.forestStroke} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M30 32 L36 39 L40 44" fill="none" stroke={c.forestStroke} strokeOpacity="0.6" strokeWidth="1" />
      <g transform="translate(40 22)">
        <circle r="3.2" fill={c.accent} />
        <g stroke={c.accent} strokeWidth="1.4" strokeLinecap="round">
          <line x1="0" y1="-7" x2="0" y2="-4.5" />
          <line x1="0" y1="7" x2="0" y2="4.5" />
          <line x1="-7" y1="0" x2="-4.5" y2="0" />
          <line x1="7" y1="0" x2="4.5" y2="0" />
        </g>
      </g>
      <g transform="translate(40 58)">
        <rect x="-7" y="-7" width="11" height="12" rx="1.5" fill={c.box} stroke={c.boxInk} strokeWidth="1.2" />
        <rect x="-7" y="-7" width="11" height="3.5" fill={c.boxHighlight} stroke={c.boxInk} strokeWidth="1.2" />
        <path d="M4 -5 q4 0 4 4 q0 4 -4 4" fill="none" stroke={c.boxInk} strokeWidth="1.2" />
      </g>
    </svg>
  )
}

function Nav({ onToggleSecret, navItems }) {
  const [open, setOpen] = useState(false)
  const clickCountRef = useRef(0)
  const resetTimerRef = useRef(null)

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
  }, [])

  const handleClick = (id) => {
    setOpen(false)
    smoothScrollTo(id)
  }

  const handleBrandClick = () => {
    smoothScrollTo('hero')
    clickCountRef.current += 1
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    if (clickCountRef.current >= SECRET_TRIGGER_CLICKS) {
      clickCountRef.current = 0
      onToggleSecret?.()
      return
    }
    resetTimerRef.current = setTimeout(() => {
      clickCountRef.current = 0
    }, SECRET_RESET_MS)
  }

  return (
    <header className="nav">
      <div className="nav-inner">
        <button className="brand" onClick={handleBrandClick} aria-label="Zum Anfang">
          <BrandLogo size={38} />
          <span className="brand-text">
            <span className="brand-name">Pegelspitze Reisen</span>
          </span>
        </button>
        <button
          className="nav-toggle"
          aria-label="Menü"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span /><span /><span />
        </button>
        <nav className={`nav-links ${open ? 'open' : ''}`}>
          {(navItems ?? NAV_ITEMS_PRE_TRIP).map((item) => (
            <button key={item.id} onClick={() => handleClick(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}

function Ribbon({ children }) {
  const prefersReduced = useReducedMotion()
  const animate = prefersReduced
    ? { opacity: 1, scale: 1, rotate: -1.5 }
    : { opacity: 1, scale: 1, rotate: [-1.5, -2.6, -1.5] }
  const transition = prefersReduced
    ? { opacity: { duration: 0.4 }, scale: { duration: 0.4 } }
    : {
        opacity: { delay: 0.35, duration: 0.6, ease: EASE_OUT_SOFT },
        scale: { delay: 0.35, duration: 0.6, ease: EASE_OUT_SOFT },
        rotate: { delay: 1.1, duration: 5.5, repeat: Infinity, ease: 'easeInOut' }
      }
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, rotate: -1.5 }}
      animate={animate}
      transition={transition}
      className="ribbon"
    >
      {children}
    </motion.div>
  )
}

function getHeroPhase(nowMs) {
  if (nowMs < TRAVEL_QUEST_START_MS) return 'pre'
  if (nowMs < SATURDAY_UNLOCK_MS) return 'anreise'
  if (nowMs < TRIP_END_MS) return 'fokus'
  return 'finale'
}

function getPreHeroContent(secret) {
  return {
    stamp: secret ? 'KLASSIFIZIERT · OPERATION 30.05.2026' : 'Geheime Mission · 30.05.2026',
    ribbon: 'Es wird ernst!',
    note: secret
      ? <><Sparkles size={14} aria-hidden="true" /> Tarnung erfolgreich. Quelle verlässlich.</>
      : <><Sparkles size={14} aria-hidden="true" /> Die falsche Fährte war Absicht <span aria-hidden="true">;)</span></>,
    facts: [
      { Icon: Train, text: '07:45 · Bahnhof Zug' },
      { Icon: CalendarDays, text: '30.05. bis 02.06.2026' },
      { Icon: Lock, text: 'Ziel: klassifiziert' }
    ]
  }
}

function getAnreiseHeroContent(travelStatus, secret) {
  const route = travelStatus?.route ?? []
  // Naechster Stop: der erste Stop dessen Zeit noch nicht in der Vergangenheit liegt
  const nowHm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(effectiveNow()))
  const nextStop = route.find((s) => typeof s.time === 'string' && /^\d{2}:\d{2}$/.test(s.time) && s.time > nowHm)
    ?? route[route.length - 1]
    ?? null

  let statusText = 'Unterwegs'
  if (travelStatus?.status === 'on_time') statusText = 'pünktlich'
  else if (travelStatus?.status === 'delayed' && typeof travelStatus.delayMinutes === 'number') {
    statusText = `+${travelStatus.delayMinutes} min`
  } else if (travelStatus?.status === 'unknown') statusText = 'Lage unklar'

  return {
    stamp: secret ? 'KLASSIFIZIERT · ANFAHRT AKTIV' : 'MISSION LÄUFT · ANREISE',
    ribbon: 'Es ist soweit!',
    note: (
      <>
        <Sparkles size={14} aria-hidden="true" /> {travelStatus?.message ?? 'Der Zug rollt.'}
      </>
    ),
    facts: [
      {
        Icon: Train,
        text: nextStop ? `${nextStop.time} · ${nextStop.label}` : 'Unterwegs'
      },
      { Icon: CalendarDays, text: 'Tag 1 von 4' },
      { Icon: ShieldCheck, text: statusText }
    ]
  }
}

function getFokusHeroContent(program, weather, nowMs, secret) {
  const days = program?.days ?? []
  const day = getCurrentFocusDay(days, nowMs)
  if (!day) return getPreHeroContent(secret)
  const idx = days.indexOf(day)
  const dayNo = idx >= 0 ? idx + 1 : 1
  const total = days.length || 4

  const fmtDay = new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit'
  })
  const todayLabel = `Heute: ${fmtDay.format(new Date(`${day.date}T12:00:00+02:00`))}`

  const nextItem = getNextItemFromDay(day, nowMs)
  const noteText = nextItem
    ? `Nächster Punkt: ${nextItem.time} · ${nextItem.title}`
    : day.dayHint || day.intro || 'Tagesbriefing offen.'

  const live = findWeatherForDate(weather, day.date)
  let WeatherIcon = CloudSun
  let weatherText = day.weatherBrief?.split('.')[0] ?? 'Wetterlage offen'
  if (live && typeof live.max === 'number') {
    const info = weatherCodeToInfo(live.code ?? 2, false)
    if (info?.Icon) WeatherIcon = info.Icon
    const max = Math.round(live.max)
    const pop = typeof live.pop === 'number' ? Math.round(live.pop) : null
    weatherText = pop != null && pop >= 5 ? `${max}° · ${pop} %` : `${max}°`
  }

  return {
    stamp: secret
      ? `AKTIVER TAGESBEFEHL · TAG ${dayNo} VON ${total}`
      : `${day.chapter} · TAG ${dayNo} VON ${total}`,
    ribbon: day.motto || 'Heute aktiv.',
    note: (
      <>
        <Clock size={14} aria-hidden="true" /> {noteText}
      </>
    ),
    facts: [
      { Icon: CalendarDays, text: todayLabel },
      { Icon: WeatherIcon, text: weatherText },
      { Icon: Sparkles, text: `Tag ${dayNo} von ${total}` }
    ]
  }
}

function getFinaleHeroContent(secret) {
  return {
    stamp: secret ? 'MISSION ARCHIVIERT' : 'MISSION ABGESCHLOSSEN · 02.06.2026',
    ribbon: 'Es war ernst!',
    note: (
      <>
        <Sparkles size={14} aria-hidden="true" /> 4 Tage, 6 Mann, eine kontrollierte Eskalation.
      </>
    ),
    facts: [
      { Icon: CalendarDays, text: '30.05. bis 02.06.2026' },
      { Icon: Users, text: '6 Mann angetreten' },
      { Icon: ShieldCheck, text: 'Akte geschlossen' }
    ]
  }
}

function Hero() {
  const secret = useSecretMode()
  const [now, setNow] = useState(() => effectiveNow())
  useEffect(() => {
    if (NOW_OVERRIDE_MS) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const phase = getHeroPhase(now)

  // Hooks immer aufrufen (Hook-Rules), Daten je Phase nutzen
  const travelStatus = useTravelStatus()
  const { data: program } = useTripProgram()
  const { data: weather } = useTravelConditions()

  const content = useMemo(() => {
    if (phase === 'anreise') return getAnreiseHeroContent(travelStatus, secret)
    if (phase === 'fokus') return getFokusHeroContent(program, weather, now, secret)
    if (phase === 'finale') return getFinaleHeroContent(secret)
    return getPreHeroContent(secret)
  }, [phase, travelStatus, program, weather, now, secret])

  return (
    <section id="hero" className="hero">
      <div className="hero-frame">
        <div className="hero-stamp" aria-hidden="true">
          <Lock size={14} /> {content.stamp}
        </div>
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE_OUT_SOFT }}
          className="hero-title"
        >
          PV-Reisli<br />
          <span className="hero-year">2026</span>
        </motion.h1>

        <Ribbon>{content.ribbon}</Ribbon>

        <p className="hero-note">{content.note}</p>

        <div className="hero-quickfacts">
          {content.facts.map((f, i) => (
            <div key={i} className="qf">
              <f.Icon size={18} />
              <span>{f.text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function SectionTitle({ icon: Icon, kicker, title }) {
  return (
    <div className="section-title">
      <div className="kicker">
        <Icon size={16} />
        <span>{kicker}</span>
      </div>
      <h2>{title}</h2>
    </div>
  )
}

function Card({ children, className = '', delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, delay, ease: EASE_OUT_SOFT }}
      className={`card ${className}`}
    >
      {children}
    </motion.div>
  )
}

const ECKDATEN_ROWS = [
  { Icon: CalendarDays, label: 'Reisezeitraum', value: 'Sa, 30.05.2026 bis Di, 02.06.2026' },
  { Icon: Clock, label: 'Treffpunkt', value: 'Sa, 30.05.2026 · 07:45 Uhr' },
  { Icon: MapPin, label: 'Ort', value: 'Bahnhof Zug' },
  { Icon: Train, label: 'Rückkehr', value: 'Di, 02.06.2026 · ca. 18:00 Uhr in Zug' },
  { Icon: Users, label: 'Mannschaft', value: '6 Mann, ein Plan' },
  { Icon: Lock, label: 'Ziel', value: 'Bleibt geheim. Vertraut der Reiseleitung.' }
]

function Eckdaten() {
  const secret = useSecretMode()
  return (
    <section id="eckdaten" className="section">
      <SectionTitle icon={Ticket} kicker={secret ? 'BRIEFING · KLASSIFIZIERT' : 'Mission Briefing'} title="Eckdaten" />
      <Card className="card-cream">
        <ul className="data-list">
          {ECKDATEN_ROWS.map(({ Icon, label, value }) => (
            <li key={label}>
              <span className="data-icon"><Icon size={18} /></span>
              <span className="data-label">{label}</span>
              <span className="data-value">{value}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}

const COUNTDOWN_BLOCKS = [
  { key: 'days', label: 'Tage' },
  { key: 'hours', label: 'Stunden' },
  { key: 'minutes', label: 'Minuten' },
  { key: 'seconds', label: 'Sekunden' }
]

function CountdownSection() {
  const time = useCountdown(COUNTDOWN_TARGET_MS)
  const secret = useSecretMode()
  return (
    <section id="countdown" className="section">
      <SectionTitle icon={Clock} kicker={secret ? 'T-MINUS · COUNTDOWN AKTIV' : 'T minus'} title="Countdown bis Abmarsch" />
      <Card className="card-navy">
        {time.done ? (
          <p className="countdown-done">
            <Sparkles size={20} /> {secret ? 'STATUS: MISSION AKTIV.' : 'Mission läuft.'}
          </p>
        ) : (
          <div className="countdown-grid">
            {COUNTDOWN_BLOCKS.map(({ key, label }) => {
              const value = String(time[key]).padStart(2, '0')
              return (
                <div key={key} className="cd-block">
                  <div className="cd-value">
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={value}
                        initial={{ y: -14, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 14, opacity: 0 }}
                        transition={{ duration: 0.34, ease: EASE_OUT_SOFT }}
                      >
                        {value}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                  <div className="cd-label">{label}</div>
                </div>
              )
            })}
          </div>
        )}
        <p className="countdown-foot">
          <Clock size={14} /> Zielzeit: 30.05.2026 · 07:45 Uhr · Schweizer Zeit
        </p>
      </Card>
    </section>
  )
}

const CREW = [
  {
    name: 'Marc Odermatt',
    nick: 'Hakan',
    role: 'Zuständig für Überblick, Tarnung und moralische Ausreden.'
  },
  {
    name: 'Timon Burkard',
    nick: 'Franz',
    role: 'Zuständig für Charme, Chaoskontrolle und gepflegten Durst.'
  }
]

function Reiseleitung() {
  const secret = useSecretMode()
  return (
    <section id="reiseleitung" className="section">
      <SectionTitle icon={Users} kicker={secret ? 'PERSONAL · KLASSIFIZIERT' : 'Im Einsatz'} title="Reiseleitung" />
      <div className="grid-2">
        {CREW.map((person, idx) => (
          <Card key={person.nick} delay={idx * 0.1}>
            <div className="leader">
              <div className="leader-avatar" aria-hidden="true">
                <Compass size={28} />
              </div>
              <div>
                <h3 className="leader-name">{person.name}</h3>
                <p className="leader-nick">«{person.nick}»</p>
                <p className="leader-role">{person.role}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}

function ConfidenceMeter({ value }) {
  if (value == null) return null
  const filled = Math.max(1, Math.min(5, Math.round(value / 20)))
  const bucket = confidenceLabel(value)
  return (
    <div
      className={`wd-confidence is-${bucket?.replace(' ', '-')}`}
      title="Geschätzte Modell-Genauigkeit für diesen Tag"
    >
      <span className="wd-conf-dots" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`wd-conf-dot ${n <= filled ? 'is-on' : ''}`} />
        ))}
      </span>
      <span className="wd-conf-label">
        Genauigkeit: <strong>{value} %</strong>
      </span>
    </div>
  )
}

function WeatherDay({ day, onOpen }) {
  const Icon = day.info.Icon
  return (
    <button
      type="button"
      className="weather-day"
      onClick={onOpen}
      aria-label={`Details zu ${day.label} öffnen`}
    >
      <div className="wd-head">
        <span className="wd-day">{day.label}</span>
        <Icon size={22} />
      </div>
      <div className="wd-temp">
        <span className="wd-max">{Math.round(day.max ?? 0)}°</span>
        <span className="wd-min">/ {Math.round(day.min ?? 0)}°</span>
      </div>
      <div className="wd-label">{day.info.label}</div>
      <div className="wd-rain">
        <Umbrella size={14} /> {Math.round(day.rain ?? 0)} %
      </div>
      <ConfidenceMeter value={day.confidence} />
    </button>
  )
}

function RangeBar({ low, high, value, unit, decimals = 0 }) {
  if (typeof low !== 'number' || typeof high !== 'number' || typeof value !== 'number') return null
  if (Math.abs(high - low) < (decimals > 0 ? 0.05 : 0.5)) return null
  const lowText = rangeNumber(low, decimals)
  const highText = rangeNumber(high, decimals)
  const pos = ((value - low) / (high - low)) * 100
  return (
    <div className="dmd-range" aria-label={`Modell-Streuung von ${lowText} bis ${highText}${unit ? ` ${unit}` : ''}`}>
      <span className="dmd-range-track" aria-hidden="true">
        <span
          className="dmd-range-dot"
          style={{ left: `${Math.max(0, Math.min(100, pos))}%` }}
        />
      </span>
      <span className="dmd-range-labels">
        <span>{lowText}</span>
        <span>{highText}{unit ? ` ${unit}` : ''}</span>
      </span>
    </div>
  )
}

const DRAG_THRESHOLD_PX = 3
const HOURLY_POP_DISPLAY_THRESHOLD = 30

const SECRET_MODE_KEY = 'pv-reisli-secret-mode'
const SECRET_TRIGGER_CLICKS = 5
const SECRET_RESET_MS = 1500
const SECRET_TOAST_MS = 3000
const SECRET_TOAST_ON = 'Verdeckter Zugriff erkannt. Geheimmodus aktiviert.'
const SECRET_TOAST_OFF = 'Geheimmodus deaktiviert. Reisebüro-Fassade wiederhergestellt.'

const SecretModeContext = createContext(false)
function useSecretMode() { return useContext(SecretModeContext) }

const ToastContext = createContext(() => {})
function useToast() { return useContext(ToastContext) }

let bodyScrollLockCount = 0
let bodyScrollLockPrevious = ''

function acquireBodyScrollLock() {
  if (typeof document === 'undefined') return () => {}
  if (bodyScrollLockCount === 0) {
    bodyScrollLockPrevious = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  bodyScrollLockCount += 1
  return () => {
    bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1)
    if (bodyScrollLockCount === 0) {
      document.body.style.overflow = bodyScrollLockPrevious
      bodyScrollLockPrevious = ''
    }
  }
}

function useDragScroll() {
  const ref = useRef(null)
  const cleanupRef = useRef(null)
  const mountedRef = useRef(true)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cleanupRef.current?.()
    }
  }, [])

  const onMouseDown = useCallback((event) => {
    if (event.button !== 0) return
    const el = ref.current
    if (!el || el.scrollWidth <= el.clientWidth) return
    const startX = event.pageX
    const startScroll = el.scrollLeft
    let moved = false

    const handleMove = (moveEvent) => {
      const delta = moveEvent.pageX - startX
      if (!moved && Math.abs(delta) > DRAG_THRESHOLD_PX) {
        moved = true
        if (mountedRef.current) setIsDragging(true)
      }
      if (moved) {
        moveEvent.preventDefault()
        el.scrollLeft = startScroll - delta
      }
    }
    const stop = () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', stop)
      window.removeEventListener('blur', stop)
      document.removeEventListener('mouseleave', stop)
      cleanupRef.current = null
      if (mountedRef.current) setIsDragging(false)
    }
    cleanupRef.current = stop
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', stop)
    window.addEventListener('blur', stop)
    document.addEventListener('mouseleave', stop)
  }, [])

  return { ref, isDragging, onMouseDown }
}

function HourlyStrip({ points }) {
  const dragScroll = useDragScroll()
  if (!points || points.length === 0) return null
  return (
    <div
      ref={dragScroll.ref}
      className={`hourly-strip${dragScroll.isDragging ? ' is-dragging' : ''}`}
      role="list"
      aria-label="Stündliche Vorhersage"
      onMouseDown={dragScroll.onMouseDown}
    >
      {points.map((p) => {
        const temp = typeof p.temp === 'number' ? Math.round(p.temp) : null
        const info = weatherCodeToInfo(p.code ?? 2, p.isNight)
        const Icon = info.Icon
        const showRain = typeof p.pop === 'number' && p.pop >= HOURLY_POP_DISPLAY_THRESHOLD
        return (
          <div key={p.hour} className="hourly-cell" role="listitem">
            <span className="hourly-hour">{`${String(p.hour).padStart(2, '0')} Uhr`}</span>
            <span className="hourly-icon" aria-hidden="true"><Icon size={22} /></span>
            <span className={`hourly-pop${showRain ? '' : ' hourly-pop-empty'}`}>
              {showRain ? `${Math.round(p.pop)} %` : ' '}
            </span>
            <span className="hourly-temp">{temp == null ? 'k. A.' : `${temp}°`}</span>
          </div>
        )
      })}
    </div>
  )
}

function SunArc({ sunrise, sunset }) {
  const rise = formatTimeOnly(sunrise)
  const set = formatTimeOnly(sunset)
  if (!rise && !set) return null
  return (
    <div className="sun-arc" role="img" aria-label={`Sonne ${rise || 'k. A.'} bis ${set || 'k. A.'}`}>
      <svg viewBox="0 0 220 70" preserveAspectRatio="none" className="sun-arc-svg">
        <defs>
          <linearGradient id="sunArcGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#b88a3b" stopOpacity="0" />
            <stop offset="100%" stopColor="#d8b06a" stopOpacity="0.85" />
          </linearGradient>
        </defs>
        <path
          d="M 20 60 Q 110 -20 200 60"
          fill="none"
          stroke="url(#sunArcGrad)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="3 3"
        />
        <circle cx="20" cy="60" r="4" fill="#b88a3b" />
        <circle cx="200" cy="60" r="4" fill="#b88a3b" />
      </svg>
      <div className="sun-arc-labels">
        <span>
          <span className="sun-arc-label">Aufgang</span>
          <span className="sun-arc-time">{rise || 'k. A.'}</span>
        </span>
        <span>
          <span className="sun-arc-label">Untergang</span>
          <span className="sun-arc-time">{set || 'k. A.'}</span>
        </span>
      </div>
    </div>
  )
}

function WindCompass({ deg, value, label }) {
  if (typeof deg !== 'number') return null
  const hasValue = typeof value === 'number'
  return (
    <div className="wind-compass" role="img" aria-label={`Windrichtung ${label || ''}`}>
      <svg viewBox="0 0 60 60" className="wind-compass-svg">
        <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(184, 138, 59, 0.32)" strokeWidth="1.2" />
        <circle cx="30" cy="30" r="20" fill="none" stroke="rgba(184, 138, 59, 0.18)" strokeWidth="0.8" strokeDasharray="2 3" />
        <text x="30" y="12" fontSize="6" textAnchor="middle" fill="var(--ink-soft)" fontWeight="600">N</text>
        <text x="30" y="54" fontSize="6" textAnchor="middle" fill="var(--ink-soft)" fontWeight="600">S</text>
        <text x="9" y="32" fontSize="6" textAnchor="middle" fill="var(--ink-soft)" fontWeight="600">W</text>
        <text x="51" y="32" fontSize="6" textAnchor="middle" fill="var(--ink-soft)" fontWeight="600">O</text>
        <g transform={`rotate(${deg} 30 30)`}>
          <path d="M 30 10 L 34 28 L 30 25 L 26 28 Z" fill="var(--gold)" />
        </g>
        {hasValue && (
          <>
            <text
              x="30"
              y="33"
              fontSize="11"
              textAnchor="middle"
              fontFamily="'Playfair Display', Georgia, serif"
              fontWeight="700"
              fill="var(--ink)"
            >
              {Math.round(value)}
            </text>
            <text x="30" y="40" fontSize="4" textAnchor="middle" fill="var(--ink-soft)">
              km/h
            </text>
          </>
        )}
      </svg>
    </div>
  )
}

function WindCard({ value, p10, p90, deg, dirLabel }) {
  if (typeof value !== 'number') return null
  const showSpread = typeof p10 === 'number' && typeof p90 === 'number' && Math.abs(p90 - p10) >= 1
  return (
    <div className="wind-card">
      <ul className="wind-list">
        <li>
          <span className="wind-label">Wind</span>
          <span className="wind-value">{Math.round(value)} km/h</span>
        </li>
        {showSpread && (
          <li>
            <span className="wind-label">Spielraum</span>
            <span className="wind-value">{Math.round(p10)} bis {Math.round(p90)} km/h</span>
          </li>
        )}
        {dirLabel && (
          <li>
            <span className="wind-label">Richtung</span>
            <span className="wind-value">aus {dirLabel}</span>
          </li>
        )}
      </ul>
      {typeof deg === 'number' && (
        <WindCompass deg={deg} value={value} label={dirLabel} />
      )}
    </div>
  )
}

function HeaderTempBar({ maxValue, maxP10, maxP90, minValue, minP10, minP90 }) {
  // Doppelbalken: ein Track für Tag (rot-tönig), einer für Nacht (blau-tönig)
  // Ein Punkt zeigt den Median, ein Balken die P10-P90-Spanne.
  const haveDay = typeof maxP10 === 'number' && typeof maxP90 === 'number' && typeof maxValue === 'number'
  const haveNight = typeof minP10 === 'number' && typeof minP90 === 'number' && typeof minValue === 'number'
  if (!haveDay && !haveNight) return null

  const allValues = [minP10, maxP10, minP90, maxP90].filter((v) => typeof v === 'number')
  const lo = Math.floor(Math.min(...allValues))
  const hi = Math.ceil(Math.max(...allValues))
  const span = Math.max(1, hi - lo)
  const pos = (v) => `${((v - lo) / span) * 100}%`
  const width = (lowV, highV) => `${((highV - lowV) / span) * 100}%`

  return (
    <div className="temp-bars" aria-label={`Temperatur-Bandbreite zwischen ${lo}° und ${hi}°`}>
      {haveNight && (
        <div className="temp-bar-row" data-kind="night">
          <span className="temp-bar-label">Nacht</span>
          <span className="temp-bar-track" aria-hidden="true">
            <span
              className="temp-bar-fill night"
              style={{ left: pos(minP10), width: width(minP10, minP90) }}
            />
            <span className="temp-bar-dot night" style={{ left: pos(minValue) }} />
          </span>
          <span className="temp-bar-range">{Math.round(minP10)}° bis {Math.round(minP90)}°</span>
        </div>
      )}
      {haveDay && (
        <div className="temp-bar-row" data-kind="day">
          <span className="temp-bar-label">Tag</span>
          <span className="temp-bar-track" aria-hidden="true">
            <span
              className="temp-bar-fill day"
              style={{ left: pos(maxP10), width: width(maxP10, maxP90) }}
            />
            <span className="temp-bar-dot day" style={{ left: pos(maxValue) }} />
          </span>
          <span className="temp-bar-range">{Math.round(maxP10)}° bis {Math.round(maxP90)}°</span>
        </div>
      )}
    </div>
  )
}

function DetailTile({ Icon, label, value, hint, range, children, wide }) {
  return (
    <div className={`day-modal-detail${wide ? ' dmd-wide' : ''}`}>
      <span className="dmd-icon" aria-hidden="true"><Icon size={18} /></span>
      <span className="dmd-text">
        <span className="dmd-label">{label}</span>
        <span className="dmd-value">{value ?? 'k. A.'}</span>
        {hint && <span className="dmd-hint">{hint}</span>}
        {range}
      </span>
      {children}
    </div>
  )
}

function DayDetailModal({ day, onClose }) {
  const Icon = day.info.Icon
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const dragControls = useDragControls()

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => acquireBodyScrollLock(), [])

  useEffect(() => {
    const restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKey = (event) => {
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusables = dialog.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      const visible = Array.from(focusables).filter((el) => !el.hasAttribute('disabled'))
      if (visible.length === 0) return
      const first = visible[0]
      const last = visible[visible.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      restoreTarget?.focus?.()
    }
  }, [])

  const windDirLabel = windDirectionLabel(day.windDir)
  const sunshine = formatSunshine(day.sunshineSec, day.daylightSec)
  const rainText = day.rain != null ? `${Math.round(day.rain)} %` : null
  const precipText = day.precipSum != null ? `${day.precipSum.toFixed(1)} mm` : null
  const tempMax = day.max != null ? Math.round(day.max) : null
  const tempMin = day.min != null ? Math.round(day.min) : null

  return (
    <motion.div
      className="day-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: EASE_SMOOTH }}
      onClick={onClose}
      role="presentation"
    >
      <motion.div
        ref={dialogRef}
        className="day-modal"
        initial={{ y: 40, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 40, opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.34, ease: EASE_OUT_SOFT }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Wetter-Details für ${day.label}`}
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 600) onClose()
        }}
      >
        <div className="day-modal-toolbar">
          <button
            type="button"
            className="day-modal-handle"
            aria-label="Zum Schliessen nach unten ziehen"
            onPointerDown={(event) => dragControls.start(event)}
          />
          <button
            ref={closeRef}
            type="button"
            className="day-modal-close"
            onClick={onClose}
            aria-label="Schliessen"
          >
            <X size={20} />
          </button>
        </div>

        <header className="day-modal-header">
          <p className="day-modal-day">{day.label}</p>
          <span className="day-modal-icon" aria-hidden="true"><Icon size={56} /></span>
          <p className="day-modal-label-text">{day.info.label}</p>
          <div className="day-modal-temp">
            <span className="day-modal-max">{tempMax != null ? `${tempMax}°` : 'k. A.'}</span>
            <span className="day-modal-min">{tempMin != null ? `${tempMin}°` : 'k. A.'}</span>
          </div>
          <HeaderTempBar
            maxValue={day.max}
            maxP10={day.maxP10}
            maxP90={day.maxP90}
            minValue={day.min}
            minP10={day.minP10}
            minP90={day.minP90}
          />
        </header>

        {day.hourly && (
          <section className="day-modal-section" aria-label="Stündlicher Verlauf">
            <h4 className="day-modal-section-title">
              <Clock size={12} aria-hidden="true" />
              <span>Tagesverlauf</span>
            </h4>
            <HourlyStrip points={day.hourly} />
          </section>
        )}

        <section className="day-modal-section" aria-label="Sonne">
          <h4 className="day-modal-section-title">
            <SunMedium size={12} aria-hidden="true" />
            <span>Sonne</span>
          </h4>
          <div className="day-modal-sun">
            <SunArc sunrise={day.sunrise} sunset={day.sunset} />
            {sunshine.value && (
              <p className="day-modal-sun-hint">
                <SunMedium size={14} aria-hidden="true" />
                <span><strong>{sunshine.value}</strong> Sonnenschein{sunshine.hint ? `, ${sunshine.hint}` : ''}</span>
              </p>
            )}
          </div>
        </section>

        {typeof day.wind === 'number' && (
          <section className="day-modal-section" aria-label="Wind">
            <h4 className="day-modal-section-title">
              <Wind size={12} aria-hidden="true" />
              <span>Wind</span>
            </h4>
            <WindCard
              value={day.wind}
              p10={day.windP10}
              p90={day.windP90}
              deg={day.windDir}
              dirLabel={windDirLabel}
            />
          </section>
        )}

        <section className="day-modal-section" aria-label="Niederschlag">
          <h4 className="day-modal-section-title">
            <Umbrella size={12} aria-hidden="true" />
            <span>Niederschlag</span>
          </h4>
          <div className="day-modal-details">
            <DetailTile Icon={Umbrella} label="Regenrisiko" value={rainText} />
            <DetailTile
              Icon={Droplets}
              label="Regenmenge"
              value={precipText}
              range={<RangeBar low={day.precipSumP10} high={day.precipSumP90} value={day.precipSum} unit="mm" decimals={1} />}
            />
          </div>
        </section>

        <footer className="day-modal-foot">
          <ConfidenceMeter value={day.confidence} />
        </footer>
      </motion.div>
    </motion.div>
  )
}

function Wetter() {
  const { data, loading, isFallback, updatedAt, reload } = useTravelConditions()
  const secret = useSecretMode()
  const allDays = useMemo(() => deriveDays(data), [data])
  const today = isoDateInZurich(effectiveNow())
  // Vergangene Reisetage ausblenden, sobald sie abgeschlossen sind.
  const visibleDays = allDays.filter((d) => d.iso >= today)
  const [openIso, setOpenIso] = useState(null)
  const openDay = visibleDays.find((day) => day.iso === openIso) ?? null

  return (
    <section id="wetter" className="section">
      <SectionTitle icon={CloudSun} kicker={secret ? 'METEO · AUFKLÄRUNG' : 'Wetterlage am Zielort'} title="Travel Conditions" />
      <Card className="card-cream">
        <div className="weather-head">
          <p className="weather-note">{data?.note ?? (loading ? 'Aufklärung läuft…' : 'Lage stabil.')}</p>
          <button
            className="weather-refresh"
            onClick={reload}
            disabled={loading}
            aria-label="Wetter aktualisieren"
            title="Aktualisieren"
          >
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
          </button>
        </div>

        <AnimatePresence mode="popLayout">
          <motion.div
            key={isFallback ? 'fb' : 'live'}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.32, ease: EASE_OUT_SOFT }}
            className="weather-grid"
          >
            {visibleDays.length === 0 && loading && (
              [0, 1, 2, 3].map((i) => <div key={`s-${i}`} className="weather-day-skeleton" aria-hidden="true" />)
            )}
            {visibleDays.length === 0 && !loading && (
              <p className="muted">{secret ? 'Keine Daten. Aufklärung erbeten.' : 'Die Wetterabteilung schweigt noch.'}</p>
            )}
            {visibleDays.map((day) => (
              <WeatherDay
                key={day.iso}
                day={day}
                onOpen={() => setOpenIso(day.iso)}
              />
            ))}
          </motion.div>
        </AnimatePresence>

        <div className="weather-foot">
          <span><Lock size={12} /> Standort bleibt verborgen.</span>
          {updatedAt && (
            <span className="muted">
              Stand: {updatedAt.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })} Uhr
            </span>
          )}
        </div>
      </Card>

      <AnimatePresence>
        {openDay && (
          <DayDetailModal day={openDay} onClose={() => setOpenIso(null)} />
        )}
      </AnimatePresence>
    </section>
  )
}

function PoloGraphic() {
  return (
    <svg
      viewBox="0 0 200 240"
      className="polo"
      role="img"
      aria-label="PV-Polo, dunkelblau mit weissem PV-Monogramm auf der Brust"
    >
      <defs>
        <linearGradient id="poloGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#15375d" />
          <stop offset="55%" stopColor="#10294a" />
          <stop offset="100%" stopColor="#0a1d34" />
        </linearGradient>
        <pattern id="pique" patternUnits="userSpaceOnUse" width="3" height="3">
          <rect width="3" height="3" fill="url(#poloGrad)" />
          <circle cx="0.5" cy="0.5" r="0.35" fill="#06101e" opacity="0.55" />
          <circle cx="2" cy="2" r="0.35" fill="#06101e" opacity="0.55" />
        </pattern>
      </defs>

      <path
        d="
          M60 42
          L40 62
          L20 92
          L40 112
          L55 97
          L55 224
          Q55 234 65 234
          L135 234
          Q145 234 145 224
          L145 97
          L160 112
          L180 92
          L160 62
          L140 42
          L120 52
          Q100 66 80 52
          Z
        "
        fill="url(#pique)"
        stroke="#04101f"
        strokeWidth="1"
        strokeLinejoin="round"
      />

      <path
        d="M76 52 L100 78 L124 52 L116 47 L100 65 L84 47 Z"
        fill="#08182c"
        stroke="#1a3a60"
        strokeWidth="0.6"
      />
      <g stroke="#1a3a60" strokeWidth="0.25" opacity="0.7">
        <line x1="80" y1="51" x2="82.5" y2="58" />
        <line x1="86" y1="51" x2="88.5" y2="60" />
        <line x1="92" y1="51" x2="94.5" y2="62" />
        <line x1="105.5" y1="62" x2="108" y2="51" />
        <line x1="111.5" y1="60" x2="114" y2="51" />
        <line x1="117.5" y1="58" x2="120" y2="51" />
      </g>

      <rect x="96" y="65" width="8" height="50" fill="#08182c" stroke="#1a3a60" strokeWidth="0.4" />
      <line x1="96.5" y1="65" x2="96.5" y2="115" stroke="#1a3a60" strokeWidth="0.2" strokeDasharray="1 1" />
      <line x1="103.5" y1="65" x2="103.5" y2="115" stroke="#1a3a60" strokeWidth="0.2" strokeDasharray="1 1" />

      {[78, 100].map((cy) => (
        <g key={cy}>
          <circle cx="100" cy={cy} r="2.2" fill="#06101e" stroke="#1a3a60" strokeWidth="0.4" />
          <circle cx="98.7" cy={cy} r="0.35" fill="#1a3a60" />
          <circle cx="101.3" cy={cy} r="0.35" fill="#1a3a60" />
          <circle cx="100" cy={cy - 1.3} r="0.35" fill="#1a3a60" />
          <circle cx="100" cy={cy + 1.3} r="0.35" fill="#1a3a60" />
        </g>
      ))}

      <g transform="translate(128 118)">
        <text
          textAnchor="middle"
          x="0"
          y="0"
          letterSpacing="-2"
          fontFamily="'Playfair Display', Georgia, serif"
          fontWeight="800"
          fontSize="20"
          fill="none"
          stroke="#ffffff"
          strokeWidth="0.7"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          PV
        </text>
      </g>
    </svg>
  )
}

const DRESSCODE_POINTS = [
  { Icon: Shirt, text: 'PV-Polo ist Pflicht.' },
  { Icon: Shirt, text: 'Ein Hemd kann nicht schaden.' },
  { Icon: ShieldCheck, text: 'Dunkel, würdevoll, bereit für grosse Taten.' },
  { Icon: Beer, text: 'Man weiss nie, wann aus «nur schnell eins» ein offizieller Programmpunkt wird.' }
]

function Dresscode() {
  const secret = useSecretMode()
  return (
    <section id="dresscode" className="section">
      <SectionTitle icon={Shirt} kicker={secret ? 'UNIFORM · VORSCHRIFT' : 'Uniform-Vorgabe'} title="Dresscode" />
      <Card>
        <div className="dresscode">
          <div className="polo-wrap">
            <PoloGraphic />
            <div className="polo-caption">Das offizielle PV-Polo</div>
            <div className="polo-stamp" aria-hidden="true">
              <Shirt size={12} />
              <span>PV-Polo Pflicht</span>
            </div>
          </div>
          <ul className="bullets">
            {DRESSCODE_POINTS.map(({ Icon, text }) => (
              <li key={text}>
                <Icon size={18} /> <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </section>
  )
}

const PACK_STORAGE_KEY = 'pv-reisli-2026.pack-status'

const PACKLIST_CATEGORIES = [
  {
    id: 'docs',
    Icon: WalletCards,
    title: 'Dokumente und Geld',
    items: [
      { id: 'docs-id', text: 'ID oder Reisepass' },
      { id: 'docs-insurance', text: 'Krankenkassenkarte oder Versicherungskarte' },
      { id: 'docs-card', text: 'Bankkarte oder Kreditkarte' },
      { id: 'docs-cash', text: 'Etwas Bargeld in Euro' },
      { id: 'docs-emergency', text: 'Notfallkontakt gespeichert' }
    ]
  },
  {
    id: 'tech',
    Icon: Smartphone,
    title: 'Technik',
    items: [
      { id: 'tech-phone', text: 'Handy' },
      { id: 'tech-charger', text: 'Ladekabel' },
      { id: 'tech-powerbank', text: 'Powerbank' },
      { id: 'tech-headphones', text: 'Kopfhörer' },
      { id: 'tech-adapter', text: 'Adapter oder Mehrfachstecker, falls nötig' }
    ]
  },
  {
    id: 'clothes',
    Icon: Shirt,
    title: 'Kleidung',
    items: [
      { id: 'cl-daytime', text: 'T-Shirts oder Polos für untertags' },
      { id: 'cl-shorts', text: 'Kurze Hose oder leichte Hose' },
      { id: 'cl-pants', text: 'Lange Hose für den Abend' },
      { id: 'cl-sweater', text: 'Pullover oder leichter Sweater' },
      { id: 'cl-underwear', text: 'Unterwäsche und Socken' },
      { id: 'cl-sleep', text: 'Schlafkleidung' },
      { id: 'cl-shoes', text: 'Bequeme Schuhe' },
      { id: 'cl-shirt', text: 'Hemd für den Abend' },
      { id: 'cl-outfit', text: 'Ausgangs-Outfit' },
      { id: 'cl-polo', text: 'PV-Polo' },
      { id: 'cl-jacket', text: 'Leichte Jacke' },
      { id: 'cl-rain', text: 'Regenschutz oder kleiner Schirm' },
      { id: 'cl-sunglasses', text: 'Sonnenbrille' }
    ]
  },
  {
    id: 'hygiene',
    Icon: HeartPulse,
    title: 'Hygiene und Gesundheit',
    items: [
      { id: 'hy-toilet', text: 'Toilettenartikel' },
      { id: 'hy-teeth', text: 'Zahnbürste und Zahnpasta' },
      { id: 'hy-deo', text: 'Deo' },
      { id: 'hy-meds', text: 'Persönliche Medikamente' },
      { id: 'hy-painkillers', text: 'Schmerzmittel' },
      { id: 'hy-bandaid', text: 'Pflaster' },
      { id: 'hy-sun', text: 'Sonnencreme' },
      { id: 'hy-tissue', text: 'Taschentücher' },
      { id: 'hy-gum', text: 'Kaugummi oder Fisherman’s Friend' }
    ]
  },
  {
    id: 'travel',
    Icon: Luggage,
    title: 'Für unterwegs',
    items: [
      { id: 'tr-bottle', text: 'Trinkflasche' },
      { id: 'tr-snacks', text: 'Snacks für den Zug' },
      { id: 'tr-backpack', text: 'Kleiner Rucksack' },
      { id: 'tr-idcopy', text: 'Kopie oder Foto der ID' },
      { id: 'tr-mood', text: 'Gute Laune' },
      { id: 'tr-thirst', text: 'Stabiler Durst' }
    ]
  }
]

function usePackStatus() {
  const [done, setDone] = useState(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const raw = window.localStorage.getItem(PACK_STORAGE_KEY)
      if (!raw) return new Set()
      const parsed = JSON.parse(raw)
      return new Set(Array.isArray(parsed) ? parsed : [])
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(PACK_STORAGE_KEY, JSON.stringify([...done]))
    } catch {
      /* Speicher nicht verfügbar, ignorieren */
    }
  }, [done])

  const toggle = useCallback((id) => {
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const reset = useCallback(() => setDone(new Set()), [])

  return { done, toggle, reset }
}

const PACK_LIST_VARIANTS = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.045, delayChildren: 0.05 } }
}

const PACK_ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.42, ease: EASE_OUT_SOFT }
  }
}

function PackCategoryCard({ category, done, onToggle, delay }) {
  const { Icon, title, items } = category
  const completed = items.filter((item) => done.has(item.id)).length
  return (
    <Card className="pack-card card-cream" delay={delay}>
      <div className="pack-cat-head">
        <span className="pack-cat-icon" aria-hidden="true"><Icon size={20} /></span>
        <h3 className="pack-cat-title">{title}</h3>
        <span className="pack-cat-count">{completed} / {items.length}</span>
      </div>
      <motion.ul
        className="pack-items"
        variants={PACK_LIST_VARIANTS}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-40px' }}
      >
        {items.map((item) => {
          const isDone = done.has(item.id)
          return (
            <motion.li
              key={item.id}
              variants={PACK_ITEM_VARIANTS}
              className={`pack-item ${isDone ? 'is-done' : ''}`}
            >
              <button
                type="button"
                className="pack-item-btn"
                onClick={() => onToggle(item.id)}
                aria-pressed={isDone}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={isDone ? 'done' : 'todo'}
                    className="pack-check"
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.7, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 28, mass: 0.6 }}
                  >
                    {isDone
                      ? <CheckSquare size={18} aria-hidden="true" />
                      : <Square size={18} aria-hidden="true" />}
                  </motion.span>
                </AnimatePresence>
                <span className="pack-item-text">{item.text}</span>
              </button>
            </motion.li>
          )
        })}
      </motion.ul>
    </Card>
  )
}

function PackingList() {
  const { done, toggle, reset } = usePackStatus()
  const secret = useSecretMode()

  const totalCount = useMemo(
    () => PACKLIST_CATEGORIES.reduce((sum, cat) => sum + cat.items.length, 0),
    []
  )
  const doneCount = useMemo(
    () =>
      PACKLIST_CATEGORIES.reduce(
        (sum, cat) => sum + cat.items.filter((item) => done.has(item.id)).length,
        0
      ),
    [done]
  )
  const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  const allDone = totalCount > 0 && doneCount === totalCount

  return (
    <section id="packliste" className="section">
      <SectionTitle icon={Luggage} kicker={secret ? 'AUSRÜSTUNG · CHECKLISTE' : 'Was muss mit'} title="Packliste" />

      <Card className="pack-progress-card">
        <div className="pack-progress-head">
          <p className="pack-progress-text">
            Packstatus: <strong>{doneCount} / {totalCount}</strong> erledigt
          </p>
          {doneCount > 0 && (
            <button type="button" className="pack-reset" onClick={reset}>
              Zurücksetzen
            </button>
          )}
        </div>
        <div
          className="pack-bar"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Fortschritt der Packliste"
        >
          <div className="pack-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        {allDone && (
          <p className="pack-done-banner">
            <Sparkles size={16} aria-hidden="true" />
            <span>{secret ? 'EINSATZBEREIT.' : 'Rekrut ist reisefähig.'}</span>
          </p>
        )}
      </Card>

      <div className="pack-categories">
        {PACKLIST_CATEGORIES.map((cat, idx) => (
          <PackCategoryCard
            key={cat.id}
            category={cat}
            done={done}
            onToggle={toggle}
            delay={idx * 0.05}
          />
        ))}
      </div>
    </section>
  )
}

const LEAVE_AT_HOME = [
  {
    id: 'wanderschuhe',
    Icon: Footprints,
    title: 'Wanderschuhe',
    label: 'Bleiben daheim',
    detail: 'Nicht nötig. Die härteste Steigung wird vermutlich die Treppe zur nächsten Bar.'
  },
  {
    id: 'zelt',
    Icon: Tent,
    title: 'Zelt',
    label: 'Wurde entlastet',
    detail: 'Die Reiseleitung hat entschieden, dass Dächer überschätzt, aber trotzdem willkommen sind.'
  },
  {
    id: 'trekkingstoecke',
    Icon: Mountain,
    title: 'Trekkingstöcke',
    label: 'Keine Verwendung',
    detail: 'Nur erlaubt, wenn sie gleichzeitig als Taktstock im Club funktionieren.'
  },
  {
    id: 'schlafsack',
    Icon: Luggage,
    title: 'Schlafsack',
    label: 'Fortschritt siegt',
    detail: 'Wird durch ein Bett ersetzt. Die Zivilisation hat gewonnen.'
  },
  {
    id: 'survival',
    Icon: ShieldCheck,
    title: 'Survival-Ausrüstung',
    label: 'Übertrieben',
    detail: 'Die wichtigste Überlebensausrüstung bleibt: Handy, Ladekabel, Portemonnaie und ein stabiler Durst.'
  },
  {
    id: 'kocher',
    Icon: Flame,
    title: 'Campingkocher',
    label: 'Keine Feldküche',
    detail: 'Die warme Verpflegung wurde durch Orte ersetzt, an denen Menschen freiwillig Teller bringen. Revolutionär.'
  },
  {
    id: 'stirnlampe',
    Icon: Lightbulb,
    title: 'Stirnlampe',
    label: 'Nicht nötig',
    detail: 'Sollte es dunkel werden, folgen wir einfach dem Licht der nächsten Bar. Wissenschaftlich kaum geprüft, praktisch bewährt.'
  },
  {
    id: 'karte',
    Icon: Map,
    title: 'Wanderkarte',
    label: 'Falsche Disziplin',
    detail: 'Die Navigation übernimmt die Reiseleitung. Was ungefähr so beruhigend ist, wie es klingt.'
  },
  {
    id: 'mueckennetz',
    Icon: Bug,
    title: 'Mückennetz',
    label: 'Übervorsichtig',
    detail: 'Die grösste Gefahr summt nicht. Sie fragt vermutlich: «Nur noch eins?»'
  },
  {
    id: 'messer',
    Icon: CircleX,
    title: 'Outdoor-Messer',
    label: 'Zuhause lassen',
    detail: 'Wir reisen zivilisiert. Geschnitten wird höchstens die Gesprächsqualität nach Mitternacht.'
  },
  {
    id: 'wasserfilter',
    Icon: Droplets,
    title: 'Wasserfilter',
    label: 'Nicht priorisiert',
    detail: 'Die Reiseleitung hat bestätigt, dass andere Flüssigkeiten organisatorisch höher eingestuft wurden.'
  },
  {
    id: 'kompass',
    Icon: Compass,
    title: 'Kompass',
    label: 'Symbolisch erlaubt',
    detail: 'Darf zuhause bleiben. Die Gruppe findet ihre Richtung erfahrungsgemäss über Hunger, Durst und schlechte Entscheidungen.'
  },
  {
    id: 'ambitionen',
    Icon: Dumbbell,
    title: 'Ernsthafte Outdoor-Ambitionen',
    label: 'Streng verboten',
    detail: 'Wer trotzdem sportlichen Ehrgeiz zeigt, wird sofort zum Gepäckbeauftragten befördert.'
  }
]

function LeaveAtHomeCard({ item, isOpen, onToggle }) {
  const { Icon, title, label, detail, id } = item
  const panelId = `leave-${id}-panel`
  return (
    <div className={`leave-card ${isOpen ? 'is-open' : ''}`}>
      <button
        type="button"
        className="leave-card-header"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="leave-icon" aria-hidden="true"><Icon size={20} /></span>
        <span className="leave-text">
          <span className="leave-title">{title}</span>
          <span className="leave-label">{label}</span>
        </span>
        <ChevronDown size={20} className="leave-chevron" aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={panelId}
            role="region"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.36, ease: EASE_OUT_SOFT },
              opacity: { duration: 0.28, ease: EASE_SMOOTH }
            }}
            className="leave-panel"
          >
            <p className="leave-detail">{detail}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function OutdoorAccordion() {
  const secret = useSecretMode()
  const [openIds, setOpenIds] = useState(() => new Set())
  const toggle = (id) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  return (
    <section id="zuhause" className="section">
      <SectionTitle icon={CircleX} kicker={secret ? 'AUSGESCHLOSSENE AUSRÜSTUNG' : 'Kann zuhause bleiben'} title="Outdoor war Tarnung" />
      <Card>
        <p className="lead">
          {secret
            ? 'Tarnung bestätigt. Wanderschuhe ausgemustert.'
            : 'Die falsche Fährte war Absicht. Die Wanderschuhe dürfen sich ausruhen.'}
        </p>
        <div className="leave-grid">
          {LEAVE_AT_HOME.map((item) => (
            <LeaveAtHomeCard
              key={item.id}
              item={item}
              isOpen={openIds.has(item.id)}
              onToggle={() => toggle(item.id)}
            />
          ))}
        </div>
        <p className="leave-badge">
          <CircleX size={12} aria-hidden="true" />
          <span>Amtlich bestätigt durch Pegelspitze Reisen. Outdoor war Tarnung, Durstplanung ist real.</span>
        </p>
      </Card>
    </section>
  )
}

function Wichtig() {
  const secret = useSecretMode()
  return (
    <section id="wichtig" className="section">
      <SectionTitle icon={MessageCircle} kicker={secret ? 'FINALE LAGEBESPRECHUNG' : 'Kurz vor Abmarsch'} title="Wichtig" />
      <div className="wichtig-grid">
        <Card className="card-green wichtig-primary">
          <div className="kvline">
            <Train size={26} />
            <div>
              <h3>Treffpunkt</h3>
              <p>Samstag, 30.05.2026 · 07:45 Uhr · Bahnhof Zug</p>
              <p className="muted">Pünktlich. Bitte nicht hetzen, aber auch nicht trödeln.</p>
            </div>
          </div>
        </Card>
        <Card className="card-orange">
          <div className="kvline">
            <Shirt size={22} />
            <div>
              <h3>PV-Polo anziehen</h3>
              <p>Uniform zeigt: wir sind eine Mannschaft.</p>
              <p className="muted">Hemd als Backup im Gepäck.</p>
            </div>
          </div>
        </Card>
        <Card className="card-cream">
          <div className="kvline">
            <HelpCircle size={22} />
            <div>
              <h3>Weitere Infos folgen</h3>
              <p>Programm wird vor Ort enthüllt. Vertraut der Reiseleitung.</p>
              <p className="muted">Spontaneität ist Teil der Mission.</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="kvline">
            <Beer size={22} />
            <div>
              <h3>Erwartung</h3>
              <p>Stil, Humor und solide Durstplanung.</p>
              <p className="muted">
                <Utensils size={12} /> Essen, <Music size={12} /> Musik, <Building2 size={12} /> Kultur, in dieser Reihenfolge verhandelbar.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </section>
  )
}

function dayTabLabel(day, nowMs, secret) {
  const today = isoDateInZurich(nowMs)
  const todayMs = Date.parse(`${today}T00:00:00+02:00`)
  const dayMs = Date.parse(`${day.date}T00:00:00+02:00`)
  const diffDays = Math.round((dayMs - todayMs) / 86_400_000)
  const wd = new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich',
    weekday: 'short'
  }).format(new Date(dayMs)).replace('.', '')
  if (diffDays === 0) return secret ? `Heute · ${wd}` : `Heute (${wd})`
  if (diffDays === 1) return secret ? `Morgen · ${wd}` : `Morgen (${wd})`
  if (diffDays === -1) return secret ? `Gestern · ${wd}` : `Gestern (${wd})`
  return wd
}

function DayTabs({ days, selectedId, onSelect, now, secret }) {
  const todayDate = isoDateInZurich(now)
  return (
    <div className="tb-day-tabs" role="tablist" aria-label="Tagesauswahl">
      {days.map((d) => {
        const isActive = d.id === selectedId
        const isToday = d.date === todayDate
        return (
          <button
            key={d.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`tb-day-tab${isActive ? ' is-active' : ''}${isToday ? ' is-today' : ''}`}
            onClick={() => onSelect(d.id)}
          >
            <span className="tb-day-tab-label">{dayTabLabel(d, now, secret)}</span>
            <span className="tb-day-tab-chapter">{d.chapter}</span>
          </button>
        )
      })}
    </div>
  )
}

function Tagesbriefing({ tripStarted, now }) {
  const { data, loading, error } = useTripProgram()
  const travelStatus = useTravelStatus()
  const { data: weather } = useTravelConditions()
  const secret = useSecretMode()
  const [pinnedDayId, setPinnedDayId] = useState(null)

  const kicker = secret ? 'AKTIVER TAGESBEFEHL' : 'Heute im Fokus'
  const title = secret ? 'Einsatzverlauf' : 'Tagesbriefing'

  let content
  if (loading && !data) {
    content = <div className="tb-skeleton" aria-hidden="true" />
  } else if (error && !data) {
    content = (
      <Card className="card-cream">
        <p className="muted">Tagesdossier nicht erreichbar. Reiseleitung bleibt zuversichtlich.</p>
      </Card>
    )
  } else if (data?.showQuest && data.quest) {
    content = <TravelQuestCard quest={data.quest} travelStatus={travelStatus} now={now} secret={secret} />
  } else if (!data || getUnlockedDays(data.days, now).length === 0) {
    content = <BeforeTripCard secret={secret} />
  } else {
    const unlocked = (data.days ?? []).filter((d) => !d.locked)
    const defaultFocus = getCurrentFocusDay(data.days, now)
    const today = isoDateInZurich(now)
    // Tabs nur fuer heute und zukuenftige (= noch nicht abgeschlossene) freigegebene Tage.
    // Abgeschlossene Tage werden weggeblendet, niemand soll dorthin zurueckwechseln muessen.
    const tabbableDays = unlocked.filter((d) => d.date >= today)
    const pinned = pinnedDayId ? tabbableDays.find((d) => d.id === pinnedDayId) : null
    const focus = pinned ?? defaultFocus
    const lockedRest = (data.days ?? []).filter((d) => d.locked)
    // Reiselage nur waehrend der Anreise (Sa 00:00 bis Ankunft 12:20).
    content = (
      <>
        {tabbableDays.length > 1 && (
          <DayTabs
            days={tabbableDays}
            selectedId={focus?.id}
            onSelect={(id) => setPinnedDayId(id === defaultFocus?.id ? null : id)}
            now={now}
            secret={secret}
          />
        )}
        {focus && <FocusDayCard day={focus} now={now} secret={secret} weather={weather} />}
        {lockedRest.length > 0 && (
          <div className="tb-other-days">
            {lockedRest.map((d) => (
              <LockedDayCard key={d.id} day={d} secret={secret} />
            ))}
          </div>
        )}
      </>
    )
  }

  return (
    <section id="tagesbriefing" className="section">
      <SectionTitle icon={FileText} kicker={kicker} title={title} />
      {content}
    </section>
  )
}

function BeforeTripCard({ secret }) {
  return (
    <Card className="card-cream tb-before">
      <div className="tb-before-inner">
        <span className="tb-before-icon" aria-hidden="true"><Hourglass size={28} /></span>
        <div>
          <p className="tb-before-title">{secret ? 'Kein Tagesbefehl freigegeben.' : 'Noch kein Tagesdossier freigegeben.'}</p>
          <p className="tb-before-text muted">
            {secret
              ? 'Aufklaerung wartet auf das Startsignal. Reiseleitung schweigt mit Absicht.'
              : 'Die Reiseleitung schweigt mit Absicht. Das erste Kapitel öffnet sich pünktlich am Samstagmorgen.'}
          </p>
        </div>
      </div>
    </Card>
  )
}

function AnreiseRoute({ route, secret }) {
  const label = secret ? 'EINSATZROUTE' : 'Reiseroute'
  return (
    <div className="anreise-route">
      <span className="anreise-route-label">{label}</span>
      <ol className="anreise-route-list">
        {route.map((stop, idx) => (
          <li key={idx} className="anreise-route-item">
            <span className="anreise-route-time">
              {stop.time}
              {typeof stop.delayMinutes === 'number' && stop.delayMinutes > 0 && (
                <span className="anreise-route-delay">+{stop.delayMinutes}</span>
              )}
            </span>
            <div className="anreise-route-body">
              <div className="anreise-route-stop">{stop.label}</div>
              {stop.detail && <div className="anreise-route-detail">{stop.detail}</div>}
              {stop.platform && (
                <span className="anreise-route-platform">
                  <Train size={11} aria-hidden="true" /> Gleis {stop.platform}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function TravelStatusCard({ status, secret }) {
  if (!status) return null
  const label = secret ? 'LAGEBERICHT' : 'REISELAGE'
  const pillClass =
    status.status === 'on_time' ? 'is-ok' :
    status.status === 'delayed' ? 'is-warn' : 'is-mute'
  const pillText =
    status.status === 'on_time' ? 'pünktlich' :
    status.status === 'delayed' ? `+${status.delayMinutes ?? '?'} min` : 'k. A.'
  return (
    <div className="travel-status-card">
      <span className="travel-status-label">{label}</span>
      <span className={`travel-status-pill ${pillClass}`}>{pillText}</span>
      <span className="travel-status-msg">{status.message}</span>
    </div>
  )
}

function TravelQuestCard({ quest, travelStatus, now, secret }) {
  const hints = quest.hints ?? []
  const unlocked = getUnlockedQuestHints(hints, now)
  const latest = unlocked[unlocked.length - 1]
  const nextLocked = getNextLockedHint(hints, now)

  return (
    <Card className="card-cream tb-quest">
      <div className="tb-quest-head">
        <span className="tb-quest-badge"><Lock size={12} aria-hidden="true" /> {quest.badge}</span>
        <span className="tb-quest-status"><Lock size={12} aria-hidden="true" /> Ziel geschwärzt</span>
      </div>
      <p className="tb-chapter">{quest.chapter}</p>
      <h3 className="tb-quest-title">{quest.title}</h3>
      <p className="tb-motto">«{quest.motto}»</p>
      <p className="tb-intro">{quest.intro}</p>
      <p className="tb-hint-meta muted">{quest.hint}</p>

      {travelStatus && <TravelStatusCard status={travelStatus} secret={secret} />}
      {travelStatus?.route?.length > 0 && <AnreiseRoute route={travelStatus.route} secret={secret} />}

      <ol className="tb-hint-list">
        {hints.map((h) => (
          <li key={h.id} className={`tb-hint ${h.locked ? 'is-locked' : ''} ${h === latest ? 'is-latest' : ''}`}>
            <div className="tb-hint-no">Hinweis {h.id}</div>
            {h.locked ? (
              <>
                <div className="tb-hint-status">Status: unter Verschluss</div>
                <div className="tb-hint-release">Freigabe: {formatUnlockHm(h.unlockAt)} Uhr</div>
              </>
            ) : (
              <>
                <div className="tb-hint-title">{h.title}</div>
                <div className="tb-hint-text">{h.text}</div>
              </>
            )}
          </li>
        ))}
      </ol>

      {nextLocked && (
        <p className="tb-next muted">
          <Clock size={14} aria-hidden="true" /> Nächster Hinweis um {formatUnlockHm(nextLocked.unlockAt)} Uhr
        </p>
      )}
    </Card>
  )
}

const BRIEFING_LABELS_NORMAL = {
  weather: 'Wetterlage',
  dresscode: 'Dresscode',
  logistics: 'Logistik',
  food: 'Kulinarik',
  risk: 'Risiko',
  thirst: 'Durstlage',
  concierge: 'Concierge-Hinweis',
  order: 'Befehl der Reiseleitung'
}
const BRIEFING_LABELS_SECRET = {
  weather: 'Lagebericht',
  dresscode: 'Uniformvorschrift',
  logistics: 'Bewegungsplan',
  food: 'Verpflegung',
  risk: 'Risikostufe',
  thirst: 'Durstlage',
  concierge: 'Concierge-Notiz',
  order: 'Einsatzbefehl'
}

function BriefingTile({ Icon, label, text, accent }) {
  if (!text) return null
  return (
    <div className={`tb-tile${accent ? ` tb-tile-${accent}` : ''}`}>
      <div className="tb-tile-head">
        <span className="tb-tile-icon" aria-hidden="true"><Icon size={14} /></span>
        <span className="tb-tile-label">{label}</span>
      </div>
      <p className="tb-tile-text">{text}</p>
    </div>
  )
}

function WeatherBriefingTile({ label, brief, live, code }) {
  const info = code != null ? weatherCodeToInfo(code, false) : null
  const Icon = info?.Icon ?? CloudSun
  const hasLive = live && (typeof live.max === 'number' || typeof live.min === 'number')
  return (
    <div className="tb-tile tb-tile-weather">
      <div className="tb-tile-head">
        <span className="tb-tile-icon" aria-hidden="true"><Icon size={16} /></span>
        <span className="tb-tile-label">{label}</span>
      </div>
      {hasLive && (
        <div className="tb-tile-weather-live">
          {typeof live.max === 'number' && (
            <span className="tb-tile-weather-max">{Math.round(live.max)}°</span>
          )}
          {typeof live.min === 'number' && (
            <span className="tb-tile-weather-min">{Math.round(live.min)}°</span>
          )}
          {typeof live.pop === 'number' && live.pop >= 5 && (
            <span className="tb-tile-weather-pop">
              <Droplets size={12} aria-hidden="true" /> {Math.round(live.pop)}%
            </span>
          )}
        </div>
      )}
      <p className="tb-tile-text">{brief}</p>
    </div>
  )
}

function FocusDayCard({ day, now, secret, weather }) {
  const toast = useToast()
  const nextItem = getNextItemFromDay(day, now)
  const labels = secret ? BRIEFING_LABELS_SECRET : BRIEFING_LABELS_NORMAL
  const liveWeather = findWeatherForDate(weather, day.date)

  const today = isoDateInZurich(now)
  const dayMs = Date.parse(`${day.date}T23:59:59+02:00`)
  const isToday = today === day.date
  const isPast = now > dayMs
  const statusBadge = isToday
    ? (secret ? 'Aktiver Tagesbefehl' : 'Heute')
    : isPast
    ? (secret ? 'Mission archiviert' : 'Abgeschlossen')
    : (secret ? 'Mission File' : 'Freigegeben')

  const handleCopyBriefing = async () => {
    const ok = await copyToClipboard(day.whatsappBriefing ?? '')
    toast(
      ok
        ? (secret ? 'Befehl kopiert. Weitergabe an die Mannschaft empfohlen.' : 'Tagesbriefing kopiert. Weitergabe an die Mannschaft empfohlen.')
        : 'Kopieren fehlgeschlagen. Bitte manuell auswählen.'
    )
  }

  return (
    <Card className="card-cream tb-focus">
      <div className="tb-focus-head">
        <div className="tb-focus-head-row">
          <span className="tb-chapter">{day.chapter}</span>
          <span className={`tb-focus-badge${isToday ? ' is-today' : isPast ? ' is-past' : ''}`}>{statusBadge}</span>
        </div>
        <h3 className="tb-focus-title">{day.title}</h3>
        <p className="tb-motto">«{day.motto}»</p>
      </div>
      <p className="tb-intro">{day.intro}</p>

      {nextItem && (
        <div className="tb-next-up">
          <span className="tb-next-up-label">{secret ? 'NÄCHSTER FIXPUNKT' : 'Nächster Fixpunkt'}</span>
          <span className="tb-next-up-time">{nextItem.time}</span>
          <span className="tb-next-up-title">{nextItem.title}</span>
        </div>
      )}

      <div className="tb-tiles">
        <WeatherBriefingTile label={labels.weather} brief={day.weatherBrief} live={liveWeather} code={liveWeather?.code} />
        <BriefingTile Icon={Shirt} label={labels.dresscode} text={day.dresscode} />
        <BriefingTile Icon={Map} label={labels.logistics} text={day.logistics} />
        <BriefingTile Icon={Utensils} label={labels.food} text={day.foodNote} />
        <BriefingTile Icon={ShieldCheck} label={labels.risk} text={day.riskLevel} accent="risk" />
        <BriefingTile Icon={Beer} label={labels.thirst} text={day.thirstLevel} accent="thirst" />
      </div>

      {day.conciergeNote && (
        <div className="tb-concierge">
          <span className="tb-concierge-label">{labels.concierge}</span>
          <p className="tb-concierge-text">{day.conciergeNote}</p>
        </div>
      )}

      <h4 className="tb-section-h">{secret ? 'Einsatzverlauf' : 'Tagesprogramm'}</h4>
      <ol className="tb-timeline">
        {day.items.map((item, idx) => {
          const Icon = iconForItem(item.type)
          return (
            <li key={idx} className="tb-tl-item">
              <span className="tb-tl-icon" aria-hidden="true"><Icon size={16} /></span>
              <span className="tb-tl-time">{item.time}</span>
              <div className="tb-tl-body">
                <div className="tb-tl-title">{item.title}</div>
                {item.subtitle && <div className="tb-tl-sub">{item.subtitle}</div>}
                {item.link && (() => {
                  const isTimetable = /sbb\.ch|trainline|raileurope|deutschebahn|bahn\.de|oebb\.at/i.test(item.link)
                  const LinkIcon = isTimetable ? Train : MapPin
                  const label = isTimetable ? 'Fahrplan öffnen' : 'Karte öffnen'
                  return (
                    <a className="tb-tl-link" href={item.link} target="_blank" rel="noopener noreferrer">
                      <LinkIcon size={12} aria-hidden="true" /> {label}
                      <ExternalLink size={11} aria-hidden="true" />
                    </a>
                  )
                })()}
              </div>
            </li>
          )
        })}
      </ol>

      <div className="tb-footer">
        {day.leaderOrder && (
          <p className="tb-day-hint">
            <ShieldCheck size={14} aria-hidden="true" /> {labels.order}: {day.leaderOrder}
          </p>
        )}
        <button type="button" className="tb-copy-btn" onClick={handleCopyBriefing}>
          <Copy size={14} aria-hidden="true" /> {secret ? 'Befehl kopieren' : 'Tagesbriefing kopieren'}
        </button>
      </div>
    </Card>
  )
}

function LockedDayCard({ day, secret }) {
  return (
    <div className="tb-locked-day">
      <div className="tb-locked-head">
        <Lock size={14} aria-hidden="true" />
        <span className="tb-locked-title">{day.title}</span>
      </div>
      <div className="tb-locked-status">{secret ? 'Status: klassifiziert' : 'Status: unter Verschluss'}</div>
      <div className="tb-locked-release">Freigabe: {formatUnlockFull(day.unlockAt)} Uhr</div>
    </div>
  )
}

function ClosedOrPendingDayCard({ day, now, secret }) {
  const dayMs = Date.parse(`${day.date}T23:59:59+02:00`)
  const isClosed = now > dayMs
  return (
    <div className={`tb-other-day ${isClosed ? 'is-closed' : ''}`}>
      <div className="tb-other-head">
        <span className="tb-other-chapter">{day.chapter}</span>
        <span className="tb-other-title">{day.title}</span>
      </div>
      {isClosed && (
        <span className="tb-other-badge">{secret ? 'Mission archiviert' : 'Abgeschlossen'}</span>
      )}
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    ok: { text: 'antwortet', cls: 'is-ok' },
    pending: { text: 'lädt …', cls: 'is-pending' },
    err: { text: 'antwortet nicht', cls: 'is-err' },
    'rate-limited': { text: 'überlastet', cls: 'is-warn' }
  }
  const m = map[status] ?? map.pending
  return <span className={`debug-status ${m.cls}`}>{m.text}</span>
}

function HighlightList({ items }) {
  if (!items?.length) return null
  return (
    <dl className="debug-highlights">
      {items.map((h, i) => (
        <div key={i} className="debug-highlight">
          <dt>{h.label}</dt>
          <dd>{h.value ?? <span className="debug-empty">—</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

function summarizeTripProgram(data) {
  if (!data || typeof data !== 'object') return null
  const days = Array.isArray(data.days) ? data.days : []
  const unlocked = days.filter((d) => !d.locked)
  const quest = data.quest
  const questHints = Array.isArray(quest?.hints) ? quest.hints : []
  const questUnlocked = questHints.filter((h) => !h.locked).length
  return [
    { label: 'Zeit (Server-Sicht)', value: data.now ? new Date(data.now).toLocaleString('de-CH') : null },
    { label: 'Anzahl Tage geliefert', value: days.length },
    { label: 'Davon freigegeben', value: `${unlocked.length} von ${days.length}` },
    { label: 'Anreise-Quest aktiv', value: data.showQuest ? 'ja' : 'nein' },
    {
      label: 'Quest-Hinweise sichtbar',
      value: questHints.length > 0 ? `${questUnlocked} von ${questHints.length}` : '—'
    }
  ]
}

function summarizeTravelStatus(data) {
  if (!data || typeof data !== 'object') return null
  const map = { on_time: 'pünktlich', delayed: 'verspätet', unknown: 'unklar' }
  const route = Array.isArray(data.route) ? data.route : []
  const trenitaliaStops = route.filter((s) => s.label === 'Umstieg' || s.label === 'Ankunft am Ziel')
  const trenitaliaLive = trenitaliaStops.some((s) => s.platform || typeof s.delayMinutes === 'number')
  return [
    { label: 'Reise-Lage', value: map[data.status] ?? data.status ?? '—' },
    {
      label: 'Verspätung',
      value: data.delayMinutes != null ? `${data.delayMinutes} Min` : '—'
    },
    { label: 'Gleis Bahnhof Zug (SBB)', value: data.platform ?? '—' },
    { label: 'Geplante Abfahrt', value: data.plannedDeparture ? new Date(data.plannedDeparture).toLocaleString('de-CH') : '—' },
    { label: 'Live-Ankunft Mailand', value: data.realtimeArrival ? new Date(data.realtimeArrival).toLocaleString('de-CH') : 'noch keine Echtzeitdaten' },
    { label: 'Route-Stops sichtbar', value: `${route.length} von 4` },
    {
      label: 'Trenitalia-Daten im Route-Stop',
      value: trenitaliaStops.length === 0
        ? 'noch nicht freigegeben'
        : (trenitaliaLive ? 'live ergänzt' : 'nur statische Werte')
    },
    { label: 'Nachricht für Mannschaft', value: data.message ?? '—' }
  ]
}

function summarizeTravelConditions(data) {
  if (!data || typeof data !== 'object' || !data.daily) return null
  const t = data.daily.time ?? []
  const first = t[0]
  const max = data.daily.temperature_2m_max?.[0]
  const min = data.daily.temperature_2m_min?.[0]
  const pop = data.daily.precipitation_probability_max?.[0]
  return [
    { label: 'Tage in der Vorhersage', value: t.length },
    { label: 'Erster Tag', value: first ? new Date(first).toLocaleDateString('de-CH') : '—' },
    { label: 'Max-Temperatur Tag 1', value: typeof max === 'number' ? `${Math.round(max)}°` : '—' },
    { label: 'Min-Temperatur Tag 1', value: typeof min === 'number' ? `${Math.round(min)}°` : '—' },
    { label: 'Regenwahrscheinlichkeit Tag 1', value: typeof pop === 'number' ? `${pop} %` : '—' },
    { label: 'Hinweis im Frontend', value: data.note ?? '—' }
  ]
}

function summarizeDebugTrenitalia(data) {
  if (!data || typeof data !== 'object') return null
  const cerca = data.cerca
  const andamento = data.andamento
  const parsed = data.parsed
  const items = []
  items.push({ label: 'Proxy', value: data.meta?.proxy ?? '—' })
  items.push({ label: 'Zug-Nummer', value: data.meta?.train ?? '—' })
  if (cerca) {
    items.push({
      label: 'Zug-Suche (cerca)',
      value: cerca.ok ? `OK (HTTP ${cerca.status}, ${cerca.durationMs} ms)` : `Fehler: ${cerca.error ?? cerca.status}`
    })
  }
  if (parsed?.allIds) {
    items.push({
      label: 'Gefundene Zug-IDs heute',
      value: parsed.allIds.length === 0 ? 'keine' : `${parsed.allIds.length} (${parsed.allIds.map((i) => i.stationId).join(', ')})`
    })
  }
  if (parsed?.pickedForAndamento) {
    const p = parsed.pickedForAndamento
    items.push({
      label: 'Ausgewählter Eintrag',
      value: `${p.stationId} · Zug ${p.trainNo}`
    })
  }
  if (andamento) {
    items.push({
      label: 'Detail-Abfrage (andamento)',
      value: andamento.ok ? `OK (HTTP ${andamento.status}, ${andamento.durationMs} ms)` : `Fehler: ${andamento.error ?? andamento.status}`
    })
  }
  if (parsed?.fermateCount != null) {
    items.push({ label: 'Anzahl Stops im Zug', value: parsed.fermateCount })
    items.push({
      label: 'Mailand Centrale gefunden',
      value: parsed.milanoStop ? 'ja' : 'nein'
    })
    items.push({
      label: 'Turin Porta Nuova gefunden',
      value: parsed.torinoStop ? 'ja' : 'nein'
    })
  }
  if (parsed?.milanoStop) {
    const m = parsed.milanoStop
    items.push({
      label: 'Mailand: Gleis (geplant / effektiv)',
      value: `${m.binarioProgrammatoPartenzaDescrizione ?? '—'} / ${m.binarioEffettivoPartenzaDescrizione ?? '—'}`
    })
    items.push({
      label: 'Mailand: Verspätung Abfahrt',
      value: typeof m.ritardoPartenza === 'number' ? `${m.ritardoPartenza} Min` : '—'
    })
  }
  if (parsed?.parseError) {
    items.push({ label: 'Parse-Fehler', value: parsed.parseError })
  }
  return items
}

function detectRateLimit(data) {
  if (!data || typeof data !== 'object') return false
  // Worker-Endpoint signalisiert Rate-Limit indirekt: cerca/andamento
  // hat rawTextPreview mit code:429
  const samples = [data.cerca?.rawTextPreview, data.andamento?.rawTextPreview]
  return samples.some((s) => typeof s === 'string' && /"code":\s*429|RateLimitTriggered|Per IP rate limit/i.test(s))
}

function DebugBlock({ title, description, status, url, httpStatus, durationMs, data, error, highlights }) {
  const friendlyStatus = status === 'ok' && detectRateLimit(data) ? 'rate-limited' : status
  return (
    <article className="debug-block">
      <header className="debug-block-head">
        <div>
          <h3 className="debug-block-title">{title}</h3>
          {description && <p className="debug-block-desc">{description}</p>}
        </div>
        <StatusBadge status={friendlyStatus} />
      </header>
      <div className="debug-meta-row">
        {typeof httpStatus === 'number' && <span className="debug-chip">HTTP {httpStatus}</span>}
        {typeof durationMs === 'number' && <span className="debug-chip">{durationMs} ms</span>}
      </div>
      {url && (
        <div className="debug-url">
          <span className="debug-url-label">Endpunkt</span>
          <code>{url}</code>
        </div>
      )}
      {error && <p className="debug-error">{error}</p>}
      {friendlyStatus === 'rate-limited' && (
        <p className="debug-warning">
          Der externe Proxy (r.jina.ai) hat ein Rate-Limit ausgelöst. Die App fällt automatisch auf statische Werte zurück. Nach ein paar Minuten wieder versuchen.
        </p>
      )}
      <HighlightList items={highlights} />
      {data !== undefined && (
        <details className="debug-json-wrap">
          <summary>Rohdaten anzeigen</summary>
          <pre className="debug-json">{typeof data === 'string' ? data : JSON.stringify(data, null, 2)}</pre>
        </details>
      )}
    </article>
  )
}

function DebugSection() {
  const [endpoints, setEndpoints] = useState({})
  const [reloadCount, setReloadCount] = useState(0)

  const calls = useMemo(() => {
    const tripUrl = (() => {
      const p = new URLSearchParams()
      if (NOW_OVERRIDE_MS) p.set('now', new Date(NOW_OVERRIDE_MS).toISOString())
      if (TEST_KEY) p.set('testKey', TEST_KEY)
      const q = p.toString()
      return q ? `/api/trip-program?${q}` : '/api/trip-program'
    })()
    const statusUrl = (() => {
      const p = new URLSearchParams()
      if (NOW_OVERRIDE_MS) p.set('now', new Date(NOW_OVERRIDE_MS).toISOString())
      if (TEST_KEY) p.set('testKey', TEST_KEY)
      const q = p.toString()
      return q ? `/api/travel-status?${q}` : '/api/travel-status'
    })()
    const debugUrl = `/api/debug-trenitalia?testKey=${encodeURIComponent(TEST_KEY ?? '')}`
    return [
      {
        key: 'tripProgram',
        title: 'Tagesprogramm',
        description: 'Welche Tage und Anreise-Hinweise schon freigegeben sind. Vor jedem unlockAt liefert der Server nur einen Platzhalter, danach die vollen Details.',
        url: tripUrl,
        summarize: summarizeTripProgram
      },
      {
        key: 'travelStatus',
        title: 'Reise-Lage (SBB + Trenitalia)',
        description: 'Live-Daten der Anreise: kombiniert SBB-Echtzeit für die Schweizer Etappe mit Trenitalia (via Proxy) für den italienischen Teil. Plus die schrittweise Reiseroute.',
        url: statusUrl,
        summarize: summarizeTravelStatus
      },
      {
        key: 'travelConditions',
        title: 'Wetter',
        description: 'Mehrtägige Wettervorhersage am Zielort über Open-Meteo. Der Worker liefert nur generische Wetterfelder, keine Koordinaten oder Ortsnamen.',
        url: '/api/travel-conditions',
        summarize: summarizeTravelConditions
      },
      {
        key: 'debugTrenitalia',
        title: 'Trenitalia roh (r.jina.ai)',
        description: 'Die unverarbeiteten Antworten des italienischen Live-Systems ViaggiaTreno, gespiegelt über den HTTPS-Proxy r.jina.ai. Zeigt Schritt 1 (Zug-Suche) und Schritt 2 (Live-Lauf).',
        url: debugUrl,
        summarize: summarizeDebugTrenitalia
      }
    ]
  }, [])

  useEffect(() => {
    let active = true
    setEndpoints((prev) => {
      const next = { ...prev }
      for (const c of calls) next[c.key] = { ...next[c.key], status: 'pending', url: c.url }
      return next
    })
    Promise.all(calls.map(async (c) => {
      const startedAt = Date.now()
      try {
        const res = await fetch(c.url, { cache: 'no-store' })
        const contentType = res.headers.get('content-type') || ''
        const text = await res.text()
        let parsed
        if (contentType.includes('application/json')) {
          try {
            parsed = JSON.parse(text)
          } catch {
            parsed = text
          }
        } else {
          parsed = text
        }
        if (active) {
          setEndpoints((prev) => ({
            ...prev,
            [c.key]: {
              status: res.ok ? 'ok' : 'err',
              url: c.url,
              httpStatus: res.status,
              durationMs: Date.now() - startedAt,
              data: parsed,
              error: res.ok ? null : `HTTP ${res.status}`
            }
          }))
        }
      } catch (e) {
        if (active) {
          setEndpoints((prev) => ({
            ...prev,
            [c.key]: {
              status: 'err',
              url: c.url,
              durationMs: Date.now() - startedAt,
              data: null,
              error: String(e?.message || e)
            }
          }))
        }
      }
    }))
    return () => { active = false }
  }, [calls, reloadCount])

  return (
    <section id="debug" className="section debug-section">
      <SectionTitle icon={FileText} kicker="API-Debug · nur fuer Tests" title="API-Status" />
      <Card className="card-cream">
        <div className="debug-toolbar">
          <ul className="debug-meta-list">
            <li>
              <span className="debug-meta-label">Test-Schlüssel</span>
              <span className={`debug-meta-value ${TEST_KEY ? 'is-ok' : 'is-warn'}`}>
                {TEST_KEY ? 'gesetzt' : 'fehlt (Trenitalia bleibt verschlossen)'}
              </span>
            </li>
            <li>
              <span className="debug-meta-label">Simulierte Zeit</span>
              <span className="debug-meta-value">
                {NOW_OVERRIDE_MS ? new Date(NOW_OVERRIDE_MS).toLocaleString('de-CH') : 'echte aktuelle Zeit'}
              </span>
            </li>
            <li>
              <span className="debug-meta-label">Browser-Zeit</span>
              <span className="debug-meta-value">{new Date().toLocaleString('de-CH')}</span>
            </li>
          </ul>
          <button type="button" className="weather-refresh debug-reload" onClick={() => setReloadCount((c) => c + 1)} aria-label="Daten neu laden">
            <RefreshCw size={18} />
          </button>
        </div>
        {calls.map((c) => {
          const e = endpoints[c.key] || { status: 'pending', url: c.url }
          const highlights = e.data && c.summarize ? c.summarize(e.data) : null
          return (
            <DebugBlock
              key={c.key}
              title={c.title}
              description={c.description}
              status={e.status}
              url={e.url}
              httpStatus={e.httpStatus}
              durationMs={e.durationMs}
              data={e.data}
              error={e.error}
              highlights={highlights}
            />
          )
        })}
        <p className="debug-note">
          Diese Seite ist nur über den URL-Parameter <code>?debug=1</code> sichtbar. Für Trenitalia-Live-Daten muss zusätzlich <code>testKey</code> gesetzt sein. Werte werden 1:1 vom Server gespiegelt, nichts wird hier umgerechnet oder weggelassen.
        </p>
      </Card>
    </section>
  )
}

function Abschied() {
  const secret = useSecretMode()
  const facts = [
    { Icon: CalendarDays, label: secret ? 'Operationsdauer' : 'Reisedauer', value: '4 Tage' },
    { Icon: Users, label: secret ? 'Eingesetzte Kräfte' : 'Mannschaft', value: '6 Mann' },
    { Icon: Footprints, label: 'Wanderschuhe', value: '0 Paare verwendet' },
    { Icon: Beer, label: 'Durstplanung', value: 'plangemäss vollstreckt' },
    { Icon: Shirt, label: 'PV-Polo-Quote', value: 'erfreulich hoch' },
    { Icon: ShieldCheck, label: 'Restwürde', value: 'weitgehend sichergestellt' }
  ]
  const kicker = secret ? 'MISSION ARCHIVIERT' : 'Reisebericht abgegeben'
  const title = secret ? 'Akte geschlossen' : 'Das war PV-Reisli 2026'
  const farewell = secret
    ? 'Operation erfolgreich beendet. Mannschaft entlassen. Akte versiegelt. Pegelspitze Reisen bleibt im Untergrund, bis das nächste Tarnmanöver ruft.'
    : 'Vier Tage Mission, sechs Mann, eine ordentliche Eskalation und erstaunlich wenig Schaden. Pegelspitze Reisen verbeugt sich, räumt die Aktendeckel auf und plant heimlich die nächste Operation.'
  const ps = secret
    ? 'Nächster Einsatz: vertraulich. Anweisungen folgen über die üblichen Kanäle.'
    : 'Nächster Einsatz: noch klassifiziert. Wer Hinweise hat, meldet sich bei der Reiseleitung.'

  return (
    <section id="abschied" className="section abschied-section">
      <div className="abschied-stamp" aria-hidden="true">
        <ShieldCheck size={16} />
        <span>{secret ? 'DOSSIER VERSIEGELT' : 'AKTE GESCHLOSSEN'}</span>
      </div>
      <SectionTitle icon={FileText} kicker={kicker} title={title} />
      <Card className="card-cream abschied-card">
        <p className="abschied-farewell">{farewell}</p>
        <ul className="abschied-facts">
          {facts.map((f, i) => (
            <li key={i} className="abschied-fact">
              <span className="abschied-fact-icon" aria-hidden="true"><f.Icon size={16} /></span>
              <span className="abschied-fact-label">{f.label}</span>
              <span className="abschied-fact-value">{f.value}</span>
            </li>
          ))}
        </ul>
        <p className="abschied-ps">
          <Sparkles size={14} aria-hidden="true" /> {ps}
        </p>
        <p className="abschied-sign">— Reiseleitung Hakan &amp; Franz</p>
      </Card>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <BrandLogo size={48} />
          <div>
            <p className="footer-name">Pegelspitze Reisen</p>
            <p className="footer-claim">Mit Stil, Humor und solider Durstplanung</p>
          </div>
        </div>
        <p className="footer-tag">
          Seit 2026 diskret, leicht fragwürdig und erstaunlich zuverlässig.
        </p>
        <p className="footer-meta">
          © {new Date().getFullYear()} · PV-Reisli · Reiseleitung Hakan &amp; Franz
        </p>
      </div>
    </footer>
  )
}

function SecretToast({ message }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key={message}
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.28, ease: EASE_OUT_SOFT }}
          className="secret-toast"
          role="status"
          aria-live="polite"
        >
          <Lock size={14} aria-hidden="true" />
          <span>{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function App() {
  const [secretMode, setSecretMode] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(SECRET_MODE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [secretToast, setSecretToast] = useState(null)
  const [now, setNow] = useState(() => effectiveNow())

  useEffect(() => {
    try {
      window.localStorage.setItem(SECRET_MODE_KEY, String(secretMode))
    } catch { /* Speicher nicht verfuegbar, ignorieren */ }
  }, [secretMode])

  useEffect(() => {
    if (!secretToast) return
    const t = setTimeout(() => setSecretToast(null), SECRET_TOAST_MS)
    return () => clearTimeout(t)
  }, [secretToast])

  // Sekunden-Tick fuer Phasenwechsel (07:45, 12:20) und next-item-Berechnung.
  useEffect(() => {
    if (NOW_OVERRIDE_MS) return  // bei Override keinen Tick
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const toggleSecretMode = useCallback(() => {
    setSecretMode((prev) => {
      const next = !prev
      setSecretToast(next ? SECRET_TOAST_ON : SECRET_TOAST_OFF)
      return next
    })
  }, [])

  const showToast = useCallback((message) => setSecretToast(message), [])

  const tripStarted = now >= TRAVEL_QUEST_START_MS
  const tripEnded = now >= TRIP_END_MS
  const showTagesbriefing = now >= SATURDAY_MIDNIGHT_MS && !tripEnded
  const navItems = (DEBUG_MODE || tripEnded) ? [] : getNavItems(tripStarted)

  return (
    <MotionConfig reducedMotion="user">
      <SecretModeContext.Provider value={secretMode}>
        <ToastContext.Provider value={showToast}>
          <div className={`app${secretMode ? ' secret-mode' : ''}${tripEnded ? ' trip-ended' : ''}${DEBUG_MODE ? ' debug-mode' : ''}`}>
            <Nav onToggleSecret={toggleSecretMode} navItems={navItems} />
            <main>
              {!DEBUG_MODE && <Hero />}
              <div className="container">
                {DEBUG_MODE ? (
                  <DebugSection />
                ) : tripEnded ? (
                  <Abschied />
                ) : (
                  <>
                    {showTagesbriefing && <Tagesbriefing tripStarted={tripStarted} now={now} />}
                    <Eckdaten />
                    {!tripStarted && <CountdownSection />}
                    <Reiseleitung />
                    <Wetter />
                    {!tripStarted && <Dresscode />}
                    {!tripStarted && <PackingList />}
                    {!tripStarted && <OutdoorAccordion />}
                    {!tripStarted && <Wichtig />}
                  </>
                )}
              </div>
            </main>
            <Footer />
            <SecretToast message={secretToast} />
          </div>
        </ToastContext.Provider>
      </SecretModeContext.Provider>
    </MotionConfig>
  )
}
