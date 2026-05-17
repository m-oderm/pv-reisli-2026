import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CalendarDays,
  Clock,
  MapPin,
  Train,
  Users,
  CloudSun,
  Shirt,
  Luggage,
  Lock,
  MessageCircle,
  Beer,
  Mountain,
  Tent,
  Footprints,
  Compass,
  Umbrella,
  WalletCards,
  Smartphone,
  Glasses,
  CircleX,
  Ticket,
  Utensils,
  Music,
  Building2,
  RefreshCw,
  CloudRain,
  Sun,
  HelpCircle,
  Sparkles,
  ShieldCheck,
  IdCard,
  Pill
} from 'lucide-react'

/* -----------------------------------------------------------------
   PV-Reisli 2026 — Einseiten-Reisewebsite
   Reiseunternehmen: Pegelspitze Reisen
   Zielort: bleibt streng geheim. Wird ausschliesslich serverseitig
   verarbeitet (siehe worker/travel-conditions.js + Cloudflare Secrets).
----------------------------------------------------------------- */

const NAV_ITEMS = [
  { id: 'eckdaten', label: 'Eckdaten' },
  { id: 'countdown', label: 'Countdown' },
  { id: 'wetter', label: 'Wetter' },
  { id: 'packliste', label: 'Packliste' },
  { id: 'dresscode', label: 'Dresscode' }
]

// Zielzeit für den Countdown: 30.05.2026, 07:45 Uhr Europe/Zurich.
// Schweiz ist Ende Mai in CEST (UTC+2), daher 07:45 +02:00 = 05:45 UTC.
const TARGET_UTC = new Date('2026-05-30T07:45:00+02:00').getTime()

// Reisedaten — bewusst hartkodiert, da im Konzept fix:
const TRAVEL_DATES = ['2026-05-30', '2026-05-31', '2026-06-01', '2026-06-02']

// Neutrale Ersatzprognose — keine Ortsangaben.
const FALLBACK_DAILY = {
  time: TRAVEL_DATES,
  weather_code: [2, 2, 95, 2],
  temperature_2m_max: [22, 23, 22, 22],
  temperature_2m_min: [12, 13, 13, 12],
  precipitation_probability_max: [25, 30, 55, 35]
}

const FALLBACK_PAYLOAD = {
  daily: FALLBACK_DAILY,
  note: 'Aktuell offline — neutrale Vorschau. Das Ziel bleibt geheim.',
  __fallback: true
}

/* ---------- Hilfsfunktionen ---------- */

function useCountdown(targetTs) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const diff = Math.max(0, targetTs - now)
  const days = Math.floor(diff / 86_400_000)
  const hours = Math.floor((diff % 86_400_000) / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  const seconds = Math.floor((diff % 60_000) / 1000)
  return { days, hours, minutes, seconds, done: diff === 0 }
}

function formatGermanDay(iso) {
  // iso = "2026-05-30"
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const weekday = date.toLocaleDateString('de-CH', { weekday: 'short', timeZone: 'UTC' })
  return `${weekday}, ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.`
}

function weatherCodeToInfo(code) {
  // Open-Meteo WMO Codes — kompakte deutsche Beschriftung
  if (code === 0) return { label: 'klar', Icon: Sun }
  if ([1, 2].includes(code)) return { label: 'teils sonnig', Icon: CloudSun }
  if (code === 3) return { label: 'bewölkt', Icon: CloudSun }
  if ([45, 48].includes(code)) return { label: 'neblig', Icon: CloudSun }
  if ([51, 53, 55, 56, 57].includes(code)) return { label: 'Niesel', Icon: CloudRain }
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: 'Regen', Icon: CloudRain }
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: 'Schnee', Icon: CloudRain }
  if ([95, 96, 99].includes(code)) return { label: 'Gewitter möglich', Icon: Umbrella }
  return { label: 'wechselhaft', Icon: CloudSun }
}

function smoothScrollTo(id) {
  const el = document.getElementById(id)
  if (!el) return
  const top = el.getBoundingClientRect().top + window.scrollY - 72
  window.scrollTo({ top, behavior: 'smooth' })
}

/* ---------- Komponenten ---------- */

function BrandLogo({ size = 44 }) {
  // Pegelspitze-Reisen Logo: rund, Berge + Kompass + Bierkrug.
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
      {/* Berge */}
      <path d="M14 54 L30 32 L40 44 L52 26 L66 54 Z" fill="#163d34" stroke="#f7ecd1" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M30 32 L36 39 L40 44" fill="none" stroke="#f7ecd1" strokeOpacity="0.6" strokeWidth="1" />
      {/* Sonne / Kompass-Stern */}
      <g transform="translate(40 22)">
        <circle r="3.2" fill="#b88a3b" />
        <g stroke="#b88a3b" strokeWidth="1.4" strokeLinecap="round">
          <line x1="0" y1="-7" x2="0" y2="-4.5" />
          <line x1="0" y1="7" x2="0" y2="4.5" />
          <line x1="-7" y1="0" x2="-4.5" y2="0" />
          <line x1="7" y1="0" x2="4.5" y2="0" />
        </g>
      </g>
      {/* Bierkrug */}
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
  const click = (id) => {
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
            <button key={item.id} onClick={() => click(item.id)}>
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
          transition={{ duration: 0.7 }}
          className="hero-title"
        >
          PV-Reisli<br />
          <span className="hero-year">2026</span>
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
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
            <span>30.05. – 02.06.2026</span>
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
      transition={{ duration: 0.55, delay }}
      className={`card ${className}`}
    >
      {children}
    </motion.div>
  )
}

function Eckdaten() {
  const rows = [
    { Icon: CalendarDays, label: 'Reisezeitraum', value: 'Sa, 30.05.2026 – Di, 02.06.2026' },
    { Icon: Clock, label: 'Treffpunkt', value: 'Sa, 30.05.2026 · 07:45 Uhr' },
    { Icon: MapPin, label: 'Ort', value: 'Bahnhof Zug' },
    { Icon: Train, label: 'Rückkehr', value: 'Di, 02.06.2026 · ca. 18:00 Uhr in Zug' },
    { Icon: Users, label: 'Mannschaft', value: '6 Mann, ein Plan' },
    { Icon: Lock, label: 'Ziel', value: 'Bleibt geheim. Vertraut der Reiseleitung.' }
  ]
  return (
    <section id="eckdaten" className="section">
      <SectionTitle icon={Ticket} kicker="Mission Briefing" title="Eckdaten" />
      <Card className="card-cream">
        <ul className="data-list">
          {rows.map(({ Icon, label, value }) => (
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

function CountdownSection() {
  const { days, hours, minutes, seconds, done } = useCountdown(TARGET_UTC)
  const blocks = [
    { v: days, l: 'Tage' },
    { v: hours, l: 'Stunden' },
    { v: minutes, l: 'Minuten' },
    { v: seconds, l: 'Sekunden' }
  ]
  return (
    <section id="countdown" className="section">
      <SectionTitle icon={Clock} kicker="T minus" title="Countdown bis Abmarsch" />
      <Card className="card-navy">
        {done ? (
          <p className="countdown-done">
            <Sparkles size={20} /> Es ist soweit. Pegelspitze in Sicht.
          </p>
        ) : (
          <div className="countdown-grid">
            {blocks.map(({ v, l }) => (
              <div key={l} className="cd-block">
                <div className="cd-value">{String(v).padStart(2, '0')}</div>
                <div className="cd-label">{l}</div>
              </div>
            ))}
          </div>
        )}
        <p className="countdown-foot">
          <Clock size={14} /> Zielzeit: 30.05.2026 · 07:45 Uhr (Schweizer Zeit)
        </p>
      </Card>
    </section>
  )
}

function Reiseleitung() {
  const crew = [
    {
      name: 'Marc Odermatt',
      nick: 'Hakan',
      role: 'Zuständig für Überblick, Tarnung und moralische Ausreden.'
    },
    {
      name: 'Timon Burkart',
      nick: 'Franz',
      role: 'Zuständig für Charme, Chaoskontrolle und gepflegten Durst.'
    }
  ]
  return (
    <section id="reiseleitung" className="section">
      <SectionTitle icon={Users} kicker="Im Einsatz" title="Reiseleitung" />
      <div className="grid-2">
        {crew.map((p, i) => (
          <Card key={p.nick} delay={i * 0.1}>
            <div className="leader">
              <div className="leader-avatar" aria-hidden="true">
                <Compass size={28} />
              </div>
              <div>
                <h3 className="leader-name">{p.name}</h3>
                <p className="leader-nick">«{p.nick}»</p>
                <p className="leader-role">{p.role}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}

function Wetter() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [usingFallback, setUsingFallback] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/travel-conditions', { cache: 'no-store' })
      if (!res.ok) throw new Error('bad status')
      const json = await res.json()
      if (!json || !json.daily) throw new Error('no daily')
      setData(json)
      setUsingFallback(false)
    } catch (err) {
      setData(FALLBACK_PAYLOAD)
      setUsingFallback(true)
    } finally {
      setUpdatedAt(new Date())
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 60 * 60 * 1000) // stündlich
    return () => clearInterval(id)
  }, [load])

  const days = useMemo(() => {
    if (!data || !data.daily || !data.daily.time) return []
    return data.daily.time.map((iso, idx) => {
      const code = data.daily.weather_code?.[idx]
      const info = weatherCodeToInfo(code ?? 2)
      return {
        iso,
        label: formatGermanDay(iso),
        info,
        max: data.daily.temperature_2m_max?.[idx],
        min: data.daily.temperature_2m_min?.[idx],
        rain: data.daily.precipitation_probability_max?.[idx]
      }
    })
  }, [data])

  // Im Frontend zeigen wir nur die Reisetage an, falls vorhanden — sonst alles.
  const visibleDays = useMemo(() => {
    const filtered = days.filter((d) => TRAVEL_DATES.includes(d.iso))
    return filtered.length > 0 ? filtered : days
  }, [days])

  return (
    <section id="wetter" className="section">
      <SectionTitle icon={CloudSun} kicker="Wetterlage am Zielort" title="Travel Conditions" />
      <Card className="card-cream">
        <div className="weather-head">
          <p className="weather-note">
            {data?.note ?? 'Lade aktuelle Daten…'}
          </p>
          <button className="btn-ghost" onClick={load} disabled={loading} aria-label="Wetter aktualisieren">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Aktualisieren
          </button>
        </div>

        <AnimatePresence mode="popLayout">
          <motion.div
            key={usingFallback ? 'fb' : 'live'}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="weather-grid"
          >
            {visibleDays.length === 0 && !loading && (
              <p className="muted">Keine Vorhersagedaten verfügbar.</p>
            )}
            {visibleDays.map((d) => {
              const Icon = d.info.Icon
              return (
                <div key={d.iso} className="weather-day">
                  <div className="wd-head">
                    <span className="wd-day">{d.label}</span>
                    <Icon size={22} />
                  </div>
                  <div className="wd-temp">
                    <span className="wd-max">{Math.round(d.max ?? 0)}°</span>
                    <span className="wd-min">/ {Math.round(d.min ?? 0)}°</span>
                  </div>
                  <div className="wd-label">{d.info.label}</div>
                  <div className="wd-rain">
                    <Umbrella size={14} /> {Math.round(d.rain ?? 0)} %
                  </div>
                </div>
              )
            })}
          </motion.div>
        </AnimatePresence>

        <div className="weather-foot">
          <span><Lock size={12} /> Standort wird nicht angezeigt.</span>
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
  // Stilisiertes PV-Polo nach Vorlage des realen Vereinspolos:
  // dunkelblau, weisses PV-Monogramm in feiner Kontur auf der linken Brust,
  // zwei dunkle Knöpfe, keine Goldakzente.
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
        {/* Subtile Piqué-Textur */}
        <pattern id="pique" patternUnits="userSpaceOnUse" width="3" height="3">
          <rect width="3" height="3" fill="url(#poloGrad)" />
          <circle cx="0.5" cy="0.5" r="0.35" fill="#06101e" opacity="0.55" />
          <circle cx="2" cy="2" r="0.35" fill="#06101e" opacity="0.55" />
        </pattern>
      </defs>

      {/* Hauptkörper + Ärmel */}
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

      {/* Kragen (Strickware) */}
      <path
        d="M76 52 L100 78 L124 52 L116 47 L100 65 L84 47 Z"
        fill="#08182c"
        stroke="#1a3a60"
        strokeWidth="0.6"
      />
      {/* Strick-Rippen — angedeutet */}
      <g stroke="#1a3a60" strokeWidth="0.25" opacity="0.7">
        <line x1="80" y1="51" x2="82.5" y2="58" />
        <line x1="86" y1="51" x2="88.5" y2="60" />
        <line x1="92" y1="51" x2="94.5" y2="62" />
        <line x1="105.5" y1="62" x2="108" y2="51" />
        <line x1="111.5" y1="60" x2="114" y2="51" />
        <line x1="117.5" y1="58" x2="120" y2="51" />
      </g>

      {/* Knopfleiste */}
      <rect x="96" y="65" width="8" height="50" fill="#08182c" stroke="#1a3a60" strokeWidth="0.4" />
      <line x1="96.5" y1="65" x2="96.5" y2="115" stroke="#1a3a60" strokeWidth="0.2" strokeDasharray="1 1" />
      <line x1="103.5" y1="65" x2="103.5" y2="115" stroke="#1a3a60" strokeWidth="0.2" strokeDasharray="1 1" />

      {/* Zwei dunkle Knöpfe mit Loch-Andeutung */}
      {[78, 100].map((cy) => (
        <g key={cy}>
          <circle cx="100" cy={cy} r="2.2" fill="#06101e" stroke="#1a3a60" strokeWidth="0.4" />
          <circle cx="98.7" cy={cy} r="0.35" fill="#1a3a60" />
          <circle cx="101.3" cy={cy} r="0.35" fill="#1a3a60" />
          <circle cx="100" cy={cy - 1.3} r="0.35" fill="#1a3a60" />
          <circle cx="100" cy={cy + 1.3} r="0.35" fill="#1a3a60" />
        </g>
      ))}

      {/* PV-Monogramm — obere rechte Brust, weisse Kontur (Stickerei-Look) */}
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

function Dresscode() {
  const points = [
    { Icon: Shirt, text: 'PV-Polo ist Pflicht.' },
    { Icon: Shirt, text: 'Ein Hemd kann nicht schaden.' },
    { Icon: ShieldCheck, text: 'Dunkel, würdevoll, bereit für grosse Taten.' },
    { Icon: Beer, text: 'Man weiss nie, wann aus «nur schnell eins» ein offizieller Programmpunkt wird.' }
  ]
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
            {points.map(({ Icon, text }, i) => (
              <li key={i}>
                <Icon size={18} /> <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </section>
  )
}

function Packliste() {
  const items = [
    { Icon: IdCard, text: 'ID oder Reisepass' },
    { Icon: WalletCards, text: 'Portemonnaie, Karte, etwas Bargeld' },
    { Icon: Smartphone, text: 'Handy, Ladegerät, Powerbank' },
    { Icon: Shirt, text: 'PV-Polo' },
    { Icon: Shirt, text: 'Ein Hemd oder Ausgangs-Outfit' },
    { Icon: Footprints, text: 'Bequeme Schuhe' },
    { Icon: Umbrella, text: 'Leichte Jacke oder Regenschutz' },
    { Icon: Glasses, text: 'Sonnenbrille' },
    { Icon: Pill, text: 'Toilettenartikel und Medikamente' }
  ]
  return (
    <section id="packliste" className="section">
      <SectionTitle icon={Luggage} kicker="Was muss mit" title="Packliste" />
      <Card className="card-cream">
        <ul className="packlist">
          {items.map(({ Icon, text }, i) => (
            <li key={i}>
              <span className="check" aria-hidden="true" />
              <Icon size={18} />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}

function ZuhauseLassen() {
  const items = [
    { Icon: Mountain, text: 'Wanderschuhe' },
    { Icon: Tent, text: 'Zelt' },
    { Icon: Footprints, text: 'Trekkingstöcke' },
    { Icon: Tent, text: 'Schlafsack' },
    { Icon: Compass, text: 'Survival-Ausrüstung' }
  ]
  return (
    <section id="zuhause" className="section">
      <SectionTitle icon={CircleX} kicker="Kann zuhause bleiben" title="Outdoor war Tarnung" />
      <Card>
        <p className="lead">
          Die falsche Fährte war Absicht. Die Wanderschuhe dürfen sich ausruhen.
        </p>
        <ul className="strikelist">
          {items.map(({ Icon, text }, i) => (
            <li key={i}>
              <Icon size={18} />
              <span>{text}</span>
              <CircleX size={16} className="strike-x" />
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}

function Wichtig() {
  return (
    <section id="wichtig" className="section">
      <SectionTitle icon={MessageCircle} kicker="Letzte Worte vor dem Abmarsch" title="Wichtig" />
      <div className="grid-2">
        <Card className="card-green">
          <div className="kvline">
            <Train size={22} />
            <div>
              <h3>Treffpunkt</h3>
              <p>Samstag, 30.05.2026 · 07:45 Uhr · Bahnhof Zug</p>
              <p className="muted">Pünktlich. Bitte nicht hetzen — aber auch nicht trödeln.</p>
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
              <p className="muted"><Utensils size={12} /> Essen, <Music size={12} /> Musik, <Building2 size={12} /> Kultur — in dieser Reihenfolge verhandelbar.</p>
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
          <Packliste />
          <ZuhauseLassen />
          <Wichtig />
        </div>
      </main>
      <Footer />
    </div>
  )
}
