/**
 * PV-Reisli 2026: Trip-Program Endpoint
 *
 * Serverseitig zeit-gegated. Vor unlockAt liefert der Worker pro Tag
 * nur ein minimales Locked-Stub, danach die vollen Details. So sind
 * Restaurants, Adressen und Maps-Links nie im Client-Bundle bevor sie
 * freigeschaltet sind.
 *
 * Zeit-Override per ?now=ISO ist nur aktiv, wenn die ENV-Var
 * ALLOW_TIME_OVERRIDE === 'true' gesetzt ist (lokale Dev und Preview).
 * In Production ist sie nicht gesetzt, der Param wird ignoriert.
 */

const TRAVEL_QUEST_START = '2026-05-30T07:45:00+02:00'
const SATURDAY_UNLOCK = '2026-05-30T12:20:00+02:00'

const TRAVEL_QUEST = {
  badge: 'ANREISE-DOSSIER',
  chapter: 'Kapitel 0',
  title: 'Die falsche Fährte endet am Gleis',
  motto: 'Zuganschrift ist nicht gleich Endziel',
  intro:
    'Die Reise hat begonnen. Die Mannschaft ist versammelt, das Ziel bleibt geschwärzt und die Reiseleitung lächelt verdächtig ruhig.',
  hint: 'Wer jetzt schon glaubt, alles zu wissen, unterschätzt die Bürokratie von Pegelspitze Reisen.'
}

const TRAVEL_QUEST_HINTS = [
  {
    id: 1,
    unlockAt: '2026-05-30T07:45:00+02:00',
    title: 'Sammelpunkt bestätigt',
    text: 'Bahnhof Zug. 07:45 Uhr. Wer hier ist, hat die erste Prüfung bestanden.'
  },
  {
    id: 2,
    unlockAt: '2026-05-30T08:00:00+02:00',
    title: 'Abfahrt',
    text: 'Der Zug rollt. Die Anschrift mag eine Richtung verraten, aber nicht die ganze Wahrheit.'
  },
  {
    id: 3,
    unlockAt: '2026-05-30T08:45:00+02:00',
    title: 'Falsche Sicherheit',
    text: 'Nur weil etwas am Zug steht, heisst das nicht, dass dort die Mission endet.'
  },
  {
    id: 4,
    unlockAt: '2026-05-30T09:30:00+02:00',
    title: 'Industrie, Stoff und Stil',
    text: 'Gesucht ist ein Ort, an dem Eleganz, Motoren, Kaffee und Fussball eine verdächtig gute Allianz bilden.'
  },
  {
    id: 5,
    unlockAt: '2026-05-30T10:30:00+02:00',
    title: 'Die Alte Dame',
    text: 'Schwarz und Weiss. Grosses Stadion. Noch grössere Meinungen. Mehr wird vorerst nicht bestätigt.'
  },
  {
    id: 6,
    unlockAt: '2026-05-30T11:30:00+02:00',
    title: 'Finale nähert sich',
    text: 'Das Ziel wird bald entsiegelt. Haltet PV-Polo und Haltung bereit.'
  },
  {
    id: 7,
    unlockAt: '2026-05-30T12:20:00+02:00',
    title: 'Ziel entsiegelt',
    text: 'Das Tagesprogramm wurde freigegeben. Kapitel 1 ist aktiv.'
  }
]

const TRIP_DAYS = [
  {
    id: 'saturday',
    date: '2026-05-30',
    unlockAt: '2026-05-30T12:20:00+02:00',
    chapter: 'Kapitel 1',
    title: 'Samstag, 30.05.2026',
    motto: 'Ankunft, Pizza, Eskalation',
    intro:
      'Das Ziel ist entsiegelt. Die Mannschaft ist angekommen und Kapitel 1 beginnt offiziell.',
    dayHint: 'PV-Polo bleibt Pflicht. Wandersachen bleiben weiterhin zu Hause.',
    items: [
      {
        time: '12:16',
        title: 'Ankunft',
        subtitle: 'Erste Lagebeurteilung und Sammlung der Mannschaft',
        type: 'travel',
        location: 'Torino Porta Nuova'
      },
      {
        time: '13:00',
        title: 'Mittagessen',
        subtitle: 'Mezzaluna, 5 Personen',
        type: 'food',
        location: 'Mezzaluna',
        link: 'https://maps.app.goo.gl/6TkdXYfZRTEhEBFL6'
      },
      {
        time: '15:00',
        title: 'Unterkunft beziehen',
        subtitle: 'Check-in und kurze taktische Erholung',
        type: 'lodging',
        location: 'Via Carlo Boucheron 14',
        link: 'https://maps.app.goo.gl/ffPUXF2uw6WgBh9E7'
      },
      {
        time: '19:30',
        title: 'Abendessen',
        subtitle: 'Da Zero, 5 Personen',
        type: 'food',
        location: 'Da Zero',
        link: 'https://maps.app.goo.gl/VzB4sK6PyQNUaZJ69'
      },
      {
        time: 'später',
        title: 'Ausgang',
        subtitle: 'Centralino Club, 2000er Party',
        type: 'nightlife',
        location: 'Centralino Club',
        link: 'https://maps.app.goo.gl/F6JKdsFBiujzwAVS8'
      }
    ],
    whatsappBriefing: [
      'Tagesbriefing Samstag',
      '',
      'Ziel entsiegelt.',
      '12:16 Ankunft',
      '13:00 Mezzaluna',
      '15:00 Check-in',
      '19:30 Da Zero',
      'danach Centralino Club',
      '',
      'PV-Polo bleibt Pflicht. Wandersachen bleiben zu Hause.'
    ].join('\n')
  },
  {
    id: 'sunday',
    date: '2026-05-31',
    unlockAt: '2026-05-30T22:00:00+02:00',
    chapter: 'Kapitel 2',
    title: 'Sonntag, 31.05.2026',
    motto: 'Regeneration, Fussball, Klassiker',
    intro:
      'Nach der ersten Nacht folgt die kontrollierte Wiederherstellung der Einsatzfähigkeit. Frühstück ist kein Vorschlag, sondern Schadensbegrenzung.',
    dayHint: 'Wasser ist keine Schwäche. Es ist ein taktisches Hilfsmittel.',
    items: [
      {
        time: '10:30',
        title: 'Brunch',
        subtitle: 'The Mix Food & Juice, 5 Personen',
        type: 'food',
        location: 'The Mix Food & Juice',
        link: 'https://maps.app.goo.gl/4T7PSSoworAdeDEz7'
      },
      {
        time: '14:00',
        title: 'Museum & Stadiontour',
        subtitle: 'Juventus Museum und Stadiontour',
        type: 'activity',
        location: 'Juventus Museum',
        link: 'https://maps.app.goo.gl/b4FCNQWjvWb3k4Ad8'
      },
      {
        time: '19:30',
        title: 'Abendessen',
        subtitle: 'Porto di Savona, 5 Personen',
        type: 'food',
        location: 'Porto di Savona',
        link: 'https://maps.app.goo.gl/uqCpKE2UcJ2eUpxH6'
      },
      {
        time: 'danach',
        title: 'Bar',
        subtitle: 'Gemütlich in eine Bar, Details vor Ort',
        type: 'nightlife',
        location: 'TBD'
      }
    ],
    whatsappBriefing: [
      'Tagesbriefing Sonntag',
      '',
      '10:30 The Mix Food & Juice',
      '14:00 Juventus Museum und Stadiontour',
      '19:30 Porto di Savona',
      'danach gemütlich Bar',
      '',
      'Pegelspitze Reisen empfiehlt: Wasser nicht komplett ignorieren.'
    ].join('\n')
  },
  {
    id: 'monday',
    date: '2026-06-01',
    unlockAt: '2026-05-31T22:00:00+02:00',
    chapter: 'Kapitel 3',
    title: 'Montag, 01.06.2026',
    motto: 'Stadtmission und bunter Abend',
    intro:
      'Der Montag verbindet kulturelle Bewegung mit strategischer Freiheit. Am Abend gilt: guter Boden ist kein Luxus, sondern Einsatzvorbereitung.',
    dayHint: 'Vor dem bunten Abend ist guter Boden Pflicht. Beschwerden werden am Dienstag bearbeitet.',
    items: [
      {
        time: 'Vormittag',
        title: 'Schnitzeljagd / Stadtführung',
        subtitle: 'Selbstgeführte Stadtmission',
        type: 'activity',
        location: 'Startpunkt gemäss Viator',
        link: 'https://www.viator.com/de-DE/tours/Turin/Turin-Scavenger-Hunt-and-Walking-Tour/d802-178424P109'
      },
      {
        time: 'Nachmittag',
        title: 'Zeit zur freien Verfügung',
        subtitle: 'Rekrut entscheidet selbstverantwortlich',
        type: 'free',
        location: 'offen'
      },
      {
        time: '19:30',
        title: 'Abendessen',
        subtitle: 'La Taverna Dei Mercanti, 5 Personen',
        type: 'food',
        location: 'La Taverna Dei Mercanti',
        link: 'https://maps.app.goo.gl/5vMxZh6cvdeZTkHq6'
      },
      {
        time: 'danach',
        title: 'Bunter Abend',
        subtitle: 'FLORA 1925 und Fat Cocktail Bar',
        type: 'nightlife',
        location: 'FLORA 1925 / Fat Cocktail Bar',
        link: 'https://maps.app.goo.gl/jymFhHaprPChdvZv7'
      }
    ],
    whatsappBriefing: [
      'Tagesbriefing Montag',
      '',
      'Vormittag: Schnitzeljagd / Stadtführung',
      'Nachmittag: Zeit zur freien Verfügung',
      '19:30 La Taverna Dei Mercanti',
      'danach FLORA 1925 und Fat Cocktail Bar',
      '',
      'Guter Boden ist heute nicht optional.'
    ].join('\n')
  },
  {
    id: 'tuesday',
    date: '2026-06-02',
    unlockAt: '2026-06-01T22:00:00+02:00',
    chapter: 'Kapitel 4',
    title: 'Dienstag, 02.06.2026',
    motto: 'Letzter Brunch und geordneter Rückzug',
    intro:
      'Die Mission nähert sich dem Abschluss. Restwürde einsammeln, Gepäck prüfen und pünktlich zum Rückzug antreten.',
    dayHint: 'Gepäck, ID und Restwürde kontrollieren. Rückreise ist Teil der Mission.',
    items: [
      {
        time: '10:00',
        title: 'Check-out',
        subtitle: 'Unterkunft abgeben',
        type: 'lodging',
        location: 'Unterkunft'
      },
      {
        time: '11:00',
        title: 'Brunch',
        subtitle: 'Avocuddle Café, 4 Personen',
        type: 'food',
        location: 'Avocuddle Café',
        link: 'https://maps.app.goo.gl/oFs53z93NWZsfLxP9'
      },
      {
        time: '13:50',
        title: 'Rückreise',
        subtitle: 'Ab Torino Porta Nuova',
        type: 'travel',
        location: 'Bahnhof'
      },
      {
        time: '18:00',
        title: 'Ankunft',
        subtitle: 'Zurück in Zug',
        type: 'travel',
        location: 'Zug'
      }
    ],
    whatsappBriefing: [
      'Tagesbriefing Dienstag',
      '',
      '10:00 Check-out',
      '11:00 Avocuddle Café',
      '13:50 Rückreise',
      '18:00 Ankunft in Zug',
      '',
      'Restwürde einsammeln. Gepäck prüfen. Pünktlich bleiben.'
    ].join('\n')
  }
]

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return preflight()
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed' }, 405)
    }

    const now = resolveNow(url, env, request)

    const days = TRIP_DAYS.map((day) => {
      const unlocked = Date.parse(day.unlockAt) <= now
      if (!unlocked) {
        return {
          id: day.id,
          date: day.date,
          unlockAt: day.unlockAt,
          title: day.title,
          locked: true
        }
      }
      return { ...day, locked: false }
    })

    const hints = TRAVEL_QUEST_HINTS.map((hint) => {
      const unlocked = Date.parse(hint.unlockAt) <= now
      if (!unlocked) {
        return { id: hint.id, unlockAt: hint.unlockAt, locked: true }
      }
      return { ...hint, locked: false }
    })

    const showQuest =
      now >= Date.parse(TRAVEL_QUEST_START) && now < Date.parse(SATURDAY_UNLOCK)

    return jsonResponse(
      {
        now: new Date(now).toISOString(),
        travelQuestStart: TRAVEL_QUEST_START,
        saturdayUnlock: SATURDAY_UNLOCK,
        showQuest,
        quest: showQuest ? { ...TRAVEL_QUEST, hints } : null,
        days
      },
      200,
      { 'Cache-Control': 'public, max-age=30' }
    )
  }
}

// Production-Hosts: hier liegt die echte Geheimhaltung, ?now= wird ignoriert.
// Alle anderen Hosts (Cloudflare Preview-Branches, lokales Wrangler) duerfen
// den Override nutzen.
const PRODUCTION_HOSTS = new Set([
  'pv-reisli-2026.marc-odermatt-8c1.workers.dev'
])

function resolveNow(url, env, request) {
  const host = (request?.headers?.get?.('host') || '').toLowerCase()
  const isPreview = !PRODUCTION_HOSTS.has(host)
  const envOverride = env && env.ALLOW_TIME_OVERRIDE === 'true'
  if (isPreview || envOverride) {
    const override = url.searchParams.get('now')
    if (override) {
      const parsed = Date.parse(override)
      if (!Number.isNaN(parsed)) return parsed
    }
  }
  return Date.now()
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
