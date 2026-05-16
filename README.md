# PV-Reisli 2026 · Pegelspitze Reisen

Eine professionelle, augenzwinkernde One-Page-Reisewebsite für das **PV-Reisli 2026**.
Vier Tage, sechs Mann, ein Plan — und ein Zielort, der bis zur Abfahrt **geheim** bleibt.

> *Mit Stil, Schalk und solider Durstplanung.*

---

## Stack

- **Vite + React 18** — Build und Frontend
- **Framer Motion** — Einblendungen und kleine Animationen
- **Lucide React** — Icon-Set
- **Vanilla CSS** — kein Tailwind, damit der Build auf Cloudflare Pages absolut problemlos ist
- **Cloudflare Pages** — Hosting
- **Cloudflare Worker / Pages Function** — Serverseitiger Wetter-Proxy

## Projektstruktur

```
pv-reisli-2026/
├── index.html
├── package.json
├── vite.config.js
├── src/
│   ├── main.jsx
│   ├── App.jsx           ← alle Sektionen
│   └── style.css         ← Retro-Plakat-Styles
├── functions/
│   └── api/
│       └── travel-conditions.js   ← Pages-Function-Adapter
└── worker/
    ├── travel-conditions.js       ← der eigentliche Wetter-Proxy
    └── wrangler.toml              ← falls als eigenständiger Worker deployt
```

## Lokal entwickeln

```bash
npm install
npm run dev
```

Die Site läuft dann auf `http://localhost:5173`.

Für den Wetter-Proxy lokal:

```bash
# in einem zweiten Terminal
cd worker
echo "SECRET_WEATHER_LAT=..." > .dev.vars     # bewusst nicht hier dokumentiert
echo "SECRET_WEATHER_LON=..." >> .dev.vars
echo "SECRET_WEATHER_TZ=..." >> .dev.vars
npx wrangler dev travel-conditions.js --port 8787
```

Vite hat einen Dev-Proxy von `/api/*` auf `http://127.0.0.1:8787`. Damit ruft das
Frontend lokal denselben Endpunkt auf wie in Production.

> Die echten Werte für die drei Secrets sind dem Reiseleiter bekannt und liegen
> ausschliesslich in der `.dev.vars` (gitignored) bzw. in den Cloudflare-Secrets.

## Production-Build

```bash
npm run build
```

Output landet in `dist/`.

---

## Deployment auf Cloudflare Pages (empfohlen, einfachster Weg)

Dieser Weg nutzt die **Pages-Function** unter `functions/api/travel-conditions.js`.
Du brauchst keinen separaten Worker und keine Route — Pages routet `/api/*` automatisch.

1. **Repository auf GitHub pushen.**

2. **Cloudflare Dashboard → Pages → Create project → Connect to GitHub** und das
   Repo `pv-reisli-2026` auswählen.

3. **Build-Settings:**
   - Framework preset: *None* (oder *Vite*)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: leer lassen (Repo-Root)

4. **Environment Variables / Secrets** (im Pages-Projekt unter
   *Settings → Environment variables → Production* anlegen, als **Secret**):

   | Name                  | Wert                  |
   | --------------------- | --------------------- |
   | `SECRET_WEATHER_LAT`  | *(Breitengrad Ziel)*  |
   | `SECRET_WEATHER_LON`  | *(Längengrad Ziel)*   |
   | `SECRET_WEATHER_TZ`   | *(IANA-Zeitzone)*     |

   Wichtig: als **Secret** speichern, nicht als Plain Text. Diese Werte stehen
   nirgendwo im Repo.

5. **Deploy auslösen** (passiert automatisch nach dem ersten Save).

6. **Testen:**
   ```
   curl https://<projektname>.pages.dev/api/travel-conditions
   ```
   Erwartet: JSON mit `daily`, `daily_units`, `note`, `within_travel_window` —
   **kein** `latitude`, `longitude`, `timezone`, `location`.

---

## Alternative: eigenständiger Worker mit Route

Wenn du den Wetter-Proxy bewusst als separaten Worker betreiben willst (z. B.
weil du eine eigene Domain hast und sauber trennen möchtest):

1. **Datei `functions/api/travel-conditions.js` aus dem Repo entfernen** (sonst
   konkurriert sie mit der Route).

2. **Worker deployen:**
   ```bash
   cd worker
   npx wrangler login
   npx wrangler deploy
   ```

3. **Secrets setzen:**
   ```bash
   npx wrangler secret put SECRET_WEATHER_LAT
   npx wrangler secret put SECRET_WEATHER_LON
   npx wrangler secret put SECRET_WEATHER_TZ
   ```

4. **Worker-Route im Cloudflare-Dashboard** (Workers & Pages → Worker auswählen
   → Triggers → Routes):
   - `meine-domain.ch/api/travel-conditions` (Custom Domain), **oder**
   - `pv-reisli-2026.pages.dev/api/travel-conditions` *(funktioniert nur, wenn
     du auf dem gleichen Account auch das Pages-Projekt hast und die Subdomain
     freigeschaltet ist; einfacher ist eine eigene Domain)*

5. **Testen** mit `curl` wie oben.

---

## Geheimhaltung — Checkliste

Vor dem Push und nach jedem Deploy nochmal prüfen:

- [ ] Kein Ortsname (Stadt / Land / Region) in `src/**`, `index.html`, `README.md`
      oder sonstigen ausgelieferten Dateien.
- [ ] Keine Koordinaten oder Zeitzonen-Strings im Frontend.
- [ ] Worker-Antwort enthält keine `latitude`, `longitude`, `timezone`, keinen
      Ortsnamen — nur `daily`, `daily_units`, `note`, `within_travel_window`.
- [ ] Secrets stehen nur im Cloudflare-Dashboard, nicht in `wrangler.toml` und
      nicht in `.env.example`.
- [ ] `dist/` wird **nicht** committed (`.gitignore` deckt das ab).

Schneller Check per `grep` (sollte keine Treffer in `src/`, `index.html`,
`README.md` liefern — der einzige erlaubte Fundort sind die Secret-Namen
in `worker/`):

```bash
grep -RIn -E "<ein Ortsname>|<lat>|<lon>|Europe/[A-Z][a-z]+" src/ index.html README.md
```

---

## Sektionen der Website

- **Hero** — «PV-Reisli 2026 · Es wird ernst!»
- **Eckdaten** — Reisezeitraum, Treffpunkt, Rückkehr
- **Countdown** — live bis 30.05.2026 07:45 Uhr Schweizer Zeit
- **Reiseleitung** — Hakan & Franz
- **Wetter** — über `/api/travel-conditions`, stündliches Auto-Refresh,
  manueller Aktualisieren-Button, neutrale Fallback-Prognose
- **Dresscode** — inkl. stilisiertem PV-Polo (Inline-SVG)
- **Packliste** — was muss mit
- **Outdoor war Tarnung** — was darf zuhause bleiben
- **Wichtig** — Treffpunkt, PV-Polo, weitere Infos, Erwartung

## Lizenz / Nutzung

Internes Projekt für den PV. Reproduktion nur mit Genehmigung der Reiseleitung
und einem nachweisbar gepflegten Durst.
