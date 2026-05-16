# PV-Reisli 2026 · Pegelspitze Reisen

Eine professionelle, augenzwinkernde One-Page-Reisewebsite für das **PV-Reisli 2026**.
Vier Tage, sechs Mann, ein Plan — und ein Zielort, der bis zur Abfahrt **geheim** bleibt.

> *Mit Stil, Schalk und solider Durstplanung.*

---

## Stack

- **Vite 6 + React 18** — Build und Frontend
- **Framer Motion** — Einblendungen und Mikro-Animationen
- **Lucide React** — Icon-Set
- **Vanilla CSS** — kein Tailwind, damit der Build auf Cloudflare sauber durchläuft
- **Cloudflare Workers + Static Assets** — gesamtes Deployment in einer Einheit
- **Cloudflare Worker** mit Secrets — serverseitiger Wetter-Proxy

## Projektstruktur

```
pv-reisli-2026/
├── index.html
├── package.json
├── vite.config.js
├── wrangler.jsonc          ← Workers + Static Assets Deploy-Config (Root)
├── src/
│   ├── main.jsx
│   ├── App.jsx             ← alle Sektionen
│   └── style.css           ← Retro-Plakat-Styles
└── worker/
    ├── index.js            ← Worker-Entry: routet /api/* + Asset-Fallthrough
    ├── travel-conditions.js ← Wetter-Proxy mit Secret-Lookup + Sanitisierung
    └── wrangler.toml       ← Alternative: API als eigenständiger Worker
```

## Lokal entwickeln

```bash
npm install
npm run dev
```

Die Site läuft dann auf `http://localhost:5173`.

Für den Wetter-Proxy lokal in einem zweiten Terminal:

```bash
cd worker
# .dev.vars anlegen (gitignored) — Werte kennt die Reiseleitung
cat > .dev.vars <<'EOF'
SECRET_WEATHER_LAT=...
SECRET_WEATHER_LON=...
SECRET_WEATHER_TZ=...
EOF

npx wrangler dev travel-conditions.js --port 8787
```

`vite.config.js` proxiet `/api/*` automatisch auf `http://127.0.0.1:8787` — das
Frontend ruft lokal dieselbe URL auf wie in Production.

## Production-Build (lokal)

```bash
npm run build
```

Output landet in `dist/`.

---

## Deployment — Cloudflare Workers + Static Assets (einzige nötige Variante)

Cloudflare deployt das Projekt als **Worker mit Static Assets**: ein einziger
Worker (`worker/index.js`) routet `/api/travel-conditions` an den Wetter-Proxy
und liefert für alles andere die statischen Files aus `dist/` aus. Konfiguriert
über die `wrangler.jsonc` im Repo-Root.

### Erstdeployment

1. **Repo auf GitHub pushen.**

2. **Cloudflare Dashboard → Workers & Pages → Create → Connect Git** und das
   Repo `pv-reisli-2026` auswählen. Cloudflare erkennt das Framework als Vite,
   das Build-Verzeichnis als `dist`, und setzt den Deploy-Befehl automatisch
   auf `npx wrangler deploy`.

3. **Secrets / Environment Variables** im Projekt setzen
   (*Settings → Variables and Secrets → Production*, jeweils als **Secret**,
   nicht Plain Text):

   | Name                  | Wert                  |
   | --------------------- | --------------------- |
   | `SECRET_WEATHER_LAT`  | *(Breitengrad Ziel)*  |
   | `SECRET_WEATHER_LON`  | *(Längengrad Ziel)*   |
   | `SECRET_WEATHER_TZ`   | *(IANA-Zeitzone)*     |

   Die echten Werte stehen ausschliesslich hier — nicht im Repo, nicht in
   `wrangler.jsonc`, nicht im Frontend-Bundle.

4. **Deploy starten.** Cloudflare führt aus:
   ```
   bun install && bun run build && npx wrangler deploy
   ```
   `wrangler deploy` liest `wrangler.jsonc`, deployt `worker/index.js` als
   Worker und uploadet `dist/` als Static Assets unter dem `ASSETS`-Binding.

5. **Smoke-Test** nach dem ersten erfolgreichen Deploy:
   ```bash
   curl https://<projektname>.<account>.workers.dev/
   curl https://<projektname>.<account>.workers.dev/api/travel-conditions
   ```
   Der API-Call muss JSON liefern mit `daily`, `daily_units`, `note`,
   `within_travel_window` — und **kein** `latitude`, `longitude`, `timezone`,
   `location`, `name`, `country`.

### Eigene Domain anhängen (optional)

*Workers & Pages → das Projekt → Settings → Domains & Routes → Add* und z. B.
`reisli.pegelspitze.ch` (oder deine Domain) anhängen. Der Worker antwortet
dann auch dort auf alles und `/api/travel-conditions` ohne weitere Routen-
Konfiguration.

### Lokal wie in Production testen

```bash
npm run build
cd worker
# .dev.vars wie oben
npx wrangler dev ../worker/index.js --assets ../dist --port 8787
```

Damit testest du den genauen Produktions-Pfad: Worker plus Asset-Binding.

---

## Alternative: API als komplett eigenständiger Worker (selten nötig)

Wenn du den Wetter-Proxy bewusst getrennt vom Frontend deployen willst (eigene
Subdomain, eigener Account, etc.):

1. **Aus `wrangler.jsonc` im Root** den `main`-Eintrag entfernen und den
   Worker-Eintry-Pfad nicht mehr setzen — dann wird im Hauptdeployment kein
   Worker, sondern nur Static Assets ausgeliefert.

2. **Separat deployen:**
   ```bash
   cd worker
   npx wrangler deploy --config wrangler.toml
   npx wrangler secret put SECRET_WEATHER_LAT
   npx wrangler secret put SECRET_WEATHER_LON
   npx wrangler secret put SECRET_WEATHER_TZ
   ```

3. **Worker-Route** im Dashboard auf
   `meine-domain.ch/api/travel-conditions` oder
   `<frontend-host>/api/travel-conditions` setzen.

Im Standardfall ist das nicht nötig — die Workers-+-Assets-Variante oben
reicht völlig.

---

## Geheimhaltungs-Checkliste

Vor jedem Push und nach jedem Deploy:

- [ ] Kein Ortsname (Stadt / Land / Region) in `src/**`, `index.html`,
      `README.md`, `wrangler.jsonc` oder sonstigen ausgelieferten Dateien.
- [ ] Keine Koordinaten oder Zeitzonen-Strings im Frontend.
- [ ] Worker-Antwort enthält **nur** `daily`, `daily_units`, `note`,
      `within_travel_window` — keine `latitude`, `longitude`, `timezone`,
      `location`, `name`, `country`.
- [ ] Secrets stehen ausschliesslich im Cloudflare-Dashboard
      (`SECRET_WEATHER_*`).
- [ ] `dist/`, `node_modules/`, `.wrangler/`, `.dev.vars` sind nicht
      committed (`.gitignore` deckt das ab).

Schneller Frontend-Check — nutze `scripts/audit-leaks.sh` (gitignored,
enthält die konkreten Suchbegriffe nur lokal):

```bash
# Einmalig anlegen, nicht commiten:
mkdir -p scripts
cat > scripts/audit-leaks.sh <<'EOF'
#!/usr/bin/env bash
# Trage die zu suchenden Begriffe pipe-getrennt in PATTERN ein.
# Diese Datei steht in .gitignore und darf NICHT committed werden.
PATTERN='Stadtname|Region|Land|45.xxxx|7.xxxx|Europe/Xxx'
grep -RInE "$PATTERN" src/ index.html README.md wrangler.jsonc \
  worker/index.js worker/wrangler.toml package.json 2>/dev/null \
  && { echo "✗ LEAK gefunden"; exit 1; } \
  || { echo "✓ sauber"; exit 0; }
EOF
chmod +x scripts/audit-leaks.sh
```

Nach Deploy:

```bash
curl -s https://<host>/api/travel-conditions | jq 'keys'
# erwartet: ["daily","daily_units","note","within_travel_window"]
```

---

## Sektionen der Website

- **Hero** — «PV-Reisli 2026 · Es wird ernst!»
- **Eckdaten** — Reisezeitraum, Treffpunkt, Rückkehr
- **Countdown** — live bis 30.05.2026 07:45 Uhr Schweizer Zeit
- **Reiseleitung** — Hakan &amp; Franz
- **Wetter** — über `/api/travel-conditions`, stündliches Auto-Refresh,
  manueller Aktualisieren-Button, neutrale Fallback-Prognose
- **Dresscode** — inkl. stilisiertem PV-Polo (Inline-SVG)
- **Packliste** — was muss mit
- **Outdoor war Tarnung** — was darf zuhause bleiben
- **Wichtig** — Treffpunkt, PV-Polo, weitere Infos, Erwartung

## Lizenz / Nutzung

Internes Projekt für den PV. Reproduktion nur mit Genehmigung der Reiseleitung
und einem nachweisbar gepflegten Durst.
