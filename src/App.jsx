import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence, MotionConfig } from 'framer-motion'
import {
  Beer,
  Bug,
  Building2,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  CircleX,
  Clock,
  CloudRain,
  CloudSun,
  Compass,
  Droplets,
  Dumbbell,
  Flame,
  Footprints,
  HeartPulse,
  HelpCircle,
  Lightbulb,
  Lock,
  Luggage,
  Map,
  MapPin,
  MessageCircle,
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
  Tent,
  Ticket,
  Train,
  Umbrella,
  Users,
  Utensils,
  WalletCards
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

const NAV_ITEMS = [
  { id: 'eckdaten', label: 'Eckdaten' },
  { id: 'countdown', label: 'Countdown' },
  { id: 'wetter', label: 'Wetter' },
  { id: 'packliste', label: 'Packliste' },
  { id: 'dresscode', label: 'Dresscode' }
]

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

// Open-Meteo WMO Wetter-Codes auf passende Icons und Kurzlabels.
const WEATHER_CODE_TABLE = {
  0: { label: 'klar', Icon: Sun },
  1: { label: 'teils sonnig', Icon: CloudSun },
  2: { label: 'teils sonnig', Icon: CloudSun },
  3: { label: 'bewölkt', Icon: CloudSun },
  45: { label: 'neblig', Icon: CloudSun },
  48: { label: 'neblig', Icon: CloudSun },
  51: { label: 'Niesel', Icon: CloudRain },
  53: { label: 'Niesel', Icon: CloudRain },
  55: { label: 'Niesel', Icon: CloudRain },
  56: { label: 'Niesel', Icon: CloudRain },
  57: { label: 'Niesel', Icon: CloudRain },
  61: { label: 'Regen', Icon: CloudRain },
  63: { label: 'Regen', Icon: CloudRain },
  65: { label: 'Regen', Icon: CloudRain },
  66: { label: 'Regen', Icon: CloudRain },
  67: { label: 'Regen', Icon: CloudRain },
  71: { label: 'Schnee', Icon: Snowflake },
  73: { label: 'Schnee', Icon: Snowflake },
  75: { label: 'Schnee', Icon: Snowflake },
  77: { label: 'Schnee', Icon: Snowflake },
  80: { label: 'Regen', Icon: CloudRain },
  81: { label: 'Regen', Icon: CloudRain },
  82: { label: 'Regen', Icon: CloudRain },
  85: { label: 'Schnee', Icon: Snowflake },
  86: { label: 'Schnee', Icon: Snowflake },
  95: { label: 'Gewitter möglich', Icon: Umbrella },
  96: { label: 'Gewitter möglich', Icon: Umbrella },
  99: { label: 'Gewitter möglich', Icon: Umbrella }
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

function weatherCodeToInfo(code) {
  return WEATHER_CODE_TABLE[code] ?? WEATHER_FALLBACK_INFO
}

function smoothScrollTo(id) {
  const el = document.getElementById(id)
  if (!el) return
  const top = el.getBoundingClientRect().top + window.scrollY - NAV_OFFSET_PX
  window.scrollTo({ top, behavior: 'smooth' })
}

function deriveDays(data) {
  if (!data?.daily?.time) return []
  const all = data.daily.time.map((iso, idx) => ({
    iso,
    label: formatGermanDay(iso),
    info: weatherCodeToInfo(data.daily.weather_code?.[idx] ?? 2),
    max: data.daily.temperature_2m_max?.[idx],
    min: data.daily.temperature_2m_min?.[idx],
    rain: data.daily.precipitation_probability_max?.[idx]
  }))
  // Solange Reisetage im Forecast auftauchen, blenden wir den Rest aus.
  const trip = all.filter((day) => TRAVEL_DATES.includes(day.iso))
  return trip.length > 0 ? trip : all
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

/* ----- Komponenten ----------------------------------------------- */

function BrandLogo({ size = 44 }) {
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
        <radialGradient id="discGrad" cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#173052" />
          <stop offset="100%" stopColor="#0b223d" />
        </radialGradient>
      </defs>
      <circle cx="40" cy="40" r="37" fill="url(#discGrad)" stroke="#b88a3b" strokeWidth="2.5" />
      <circle cx="40" cy="40" r="32" fill="none" stroke="#b88a3b" strokeOpacity="0.45" strokeDasharray="2 3" />
      <path d="M14 54 L30 32 L40 44 L52 26 L66 54 Z" fill="#163d34" stroke="#f7ecd1" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M30 32 L36 39 L40 44" fill="none" stroke="#f7ecd1" strokeOpacity="0.6" strokeWidth="1" />
      <g transform="translate(40 22)">
        <circle r="3.2" fill="#b88a3b" />
        <g stroke="#b88a3b" strokeWidth="1.4" strokeLinecap="round">
          <line x1="0" y1="-7" x2="0" y2="-4.5" />
          <line x1="0" y1="7" x2="0" y2="4.5" />
          <line x1="-7" y1="0" x2="-4.5" y2="0" />
          <line x1="7" y1="0" x2="4.5" y2="0" />
        </g>
      </g>
      <g transform="translate(40 58)">
        <rect x="-7" y="-7" width="11" height="12" rx="1.5" fill="#f7ecd1" stroke="#132238" strokeWidth="1.2" />
        <rect x="-7" y="-7" width="11" height="3.5" fill="#fff8e1" stroke="#132238" strokeWidth="1.2" />
        <path d="M4 -5 q4 0 4 4 q0 4 -4 4" fill="none" stroke="#132238" strokeWidth="1.2" />
      </g>
    </svg>
  )
}

function Nav() {
  const [open, setOpen] = useState(false)
  const handleClick = (id) => {
    setOpen(false)
    smoothScrollTo(id)
  }
  return (
    <header className="nav">
      <div className="nav-inner">
        <button className="brand" onClick={() => smoothScrollTo('hero')} aria-label="Zum Anfang">
          <BrandLogo size={38} />
          <span className="brand-text">
            <span className="brand-name">Pegelspitze Reisen</span>
            <span className="brand-sub">PV-Reisli 2026</span>
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
          {NAV_ITEMS.map((item) => (
            <button key={item.id} onClick={() => handleClick(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section id="hero" className="hero">
      <div className="hero-frame">
        <div className="hero-stamp" aria-hidden="true">
          <Lock size={14} /> Geheime Mission
        </div>
        <p className="hero-eyebrow">Pegelspitze Reisen präsentiert</p>
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE_OUT_SOFT }}
          className="hero-title"
        >
          PV-Reisli<br />
          <span className="hero-year">2026</span>
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, scale: 0.92, rotate: -1.5 }}
          animate={{
            opacity: 1,
            scale: 1,
            rotate: [-1.5, -2.6, -1.5]
          }}
          transition={{
            opacity: { delay: 0.35, duration: 0.6, ease: EASE_OUT_SOFT },
            scale: { delay: 0.35, duration: 0.6, ease: EASE_OUT_SOFT },
            rotate: {
              delay: 1.1,
              duration: 5.5,
              repeat: Infinity,
              ease: 'easeInOut'
            }
          }}
          className="ribbon"
        >
          Es wird ernst!
        </motion.div>

        <p className="hero-mission">Abfahrt steht bevor · 30.05.2026</p>

        <p className="hero-note">
          <Sparkles size={14} /> Die falsche Fährte war Absicht <span aria-hidden="true">;)</span>
        </p>

        <div className="hero-quickfacts">
          <div className="qf">
            <Train size={18} />
            <span>07:45 · Bahnhof Zug</span>
          </div>
          <div className="qf">
            <CalendarDays size={18} />
            <span>30.05. bis 02.06.2026</span>
          </div>
          <div className="qf">
            <Lock size={18} />
            <span>Ziel: klassifiziert</span>
          </div>
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
  return (
    <section id="eckdaten" className="section">
      <SectionTitle icon={Ticket} kicker="Mission Briefing" title="Eckdaten" />
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
  return (
    <section id="countdown" className="section">
      <SectionTitle icon={Clock} kicker="T minus" title="Countdown bis Abmarsch" />
      <Card className="card-navy">
        {time.done ? (
          <p className="countdown-done">
            <Sparkles size={20} /> Es ist soweit. Pegelspitze in Sicht.
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
  return (
    <section id="reiseleitung" className="section">
      <SectionTitle icon={Users} kicker="Im Einsatz" title="Reiseleitung" />
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

function WeatherDay({ day }) {
  const Icon = day.info.Icon
  return (
    <div className="weather-day">
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
    </div>
  )
}

function Wetter() {
  const { data, loading, isFallback, updatedAt, reload } = useTravelConditions()
  const visibleDays = useMemo(() => deriveDays(data), [data])

  return (
    <section id="wetter" className="section">
      <SectionTitle icon={CloudSun} kicker="Wetterlage am Zielort" title="Travel Conditions" />
      <Card className="card-cream">
        <div className="weather-head">
          <p className="weather-note">{data?.note ?? 'Lade Wetter…'}</p>
          <button
            className="btn-ghost"
            onClick={reload}
            disabled={loading}
            aria-label="Wetter aktualisieren"
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Aktualisieren
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
            {visibleDays.length === 0 && !loading && (
              <p className="muted">Noch keine Vorhersage.</p>
            )}
            {visibleDays.map((day) => (
              <WeatherDay key={day.iso} day={day} />
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
  return (
    <section id="dresscode" className="section">
      <SectionTitle icon={Shirt} kicker="Uniform-Vorgabe" title="Dresscode" />
      <Card>
        <div className="dresscode">
          <div className="polo-wrap">
            <PoloGraphic />
            <div className="polo-caption">Das offizielle PV-Polo</div>
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
      { id: 'docs-tickets', text: 'Zugticket und Reiseunterlagen digital verfügbar' },
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
      { id: 'tech-adapter', text: 'Adapter oder Mehrfachstecker, falls nötig' },
      { id: 'tech-offline', text: 'Offline-Karte oder Screenshots der wichtigsten Infos' }
    ]
  },
  {
    id: 'clothes',
    Icon: Shirt,
    title: 'Kleidung',
    items: [
      { id: 'cl-polo', text: 'PV-Polo' },
      { id: 'cl-shirt', text: 'Hemd für den Abend' },
      { id: 'cl-outfit', text: 'Ausgangs-Outfit' },
      { id: 'cl-shoes', text: 'Bequeme Schuhe' },
      { id: 'cl-jacket', text: 'Leichte Jacke' },
      { id: 'cl-rain', text: 'Regenschutz oder kleiner Schirm' },
      { id: 'cl-sunglasses', text: 'Sonnenbrille' },
      { id: 'cl-underwear', text: 'Unterwäsche und Socken' },
      { id: 'cl-sleep', text: 'Schlafkleidung' },
      { id: 'cl-spare', text: 'Ersatzshirt' }
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
      { id: 'tr-bag', text: 'Kleine Tasche oder Bauchtasche' },
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
      <SectionTitle icon={Luggage} kicker="Was muss mit" title="Packliste" />

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
            <span>Rekrut ist reisefähig.</span>
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
      <SectionTitle icon={CircleX} kicker="Kann zuhause bleiben" title="Outdoor war Tarnung" />
      <Card>
        <p className="lead">
          Die falsche Fährte war Absicht. Die Wanderschuhe dürfen sich ausruhen.
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
  return (
    <section id="wichtig" className="section">
      <SectionTitle icon={MessageCircle} kicker="Kurz vor Abmarsch" title="Wichtig" />
      <div className="grid-2">
        <Card className="card-green">
          <div className="kvline">
            <Train size={22} />
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

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <Nav />
        <main>
          <Hero />
          <div className="container">
            <Eckdaten />
            <CountdownSection />
            <Reiseleitung />
            <Wetter />
            <Dresscode />
            <PackingList />
            <OutdoorAccordion />
            <Wichtig />
          </div>
        </main>
        <Footer />
      </div>
    </MotionConfig>
  )
}
