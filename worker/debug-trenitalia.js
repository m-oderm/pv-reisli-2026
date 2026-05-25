/**
 * PV-Reisli 2026: Debug-Endpoint fuer Trenitalia via r.jina.ai
 *
 * Liefert die Roh-Antworten der zwei ViaggiaTreno-Aufrufe, damit man
 * im Browser sehen kann was der HTTPS-Proxy tatsaechlich liefert.
 * NUR mit testKey aufrufbar, damit nicht jeder die internen Calls
 * sehen kann.
 */

const VT_PROXY = 'https://r.jina.ai/http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno'
const MILANO_CENTRALE_ID = 'S01700'
const TORINO_PORTA_NUOVA_ID = 'S00219'
const TRENITALIA_TRAIN = '9612'
const TEST_OVERRIDE_TOKEN = 'pegelspitze-bunker-2026'

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return preflight()
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed' }, 405)
    }

    const url = new URL(request.url)
    if (url.searchParams.get('testKey') !== TEST_OVERRIDE_TOKEN) {
      return jsonResponse({ error: 'forbidden' }, 403)
    }

    const result = {
      meta: {
        proxy: VT_PROXY,
        train: TRENITALIA_TRAIN,
        milanoCentraleId: MILANO_CENTRALE_ID,
        torinoPortaNuovaId: TORINO_PORTA_NUOVA_ID,
        fetchedAt: new Date().toISOString()
      },
      cerca: await fetchStep(`${VT_PROXY}/cercaNumeroTrenoTrenoAutocomplete/${TRENITALIA_TRAIN}`),
      andamento: null,
      parsed: null
    }

    // Cerca parsen, daraus den passenden Eintrag finden
    if (result.cerca?.ok && result.cerca?.markdown) {
      const lines = result.cerca.markdown.split('\n').map((l) => l.trim()).filter(Boolean)
      const ids = lines
        .map((l) => l.split('|')[1])
        .filter(Boolean)
        .map((tuple) => {
          const parts = tuple.split('-')
          return { trainNo: parts[0], stationId: parts[1], epoch: parts[2] }
        })
      const pick = ids.find((i) => i.stationId === MILANO_CENTRALE_ID) || ids[0] || null
      result.parsed = { allIds: ids, pickedForAndamento: pick }
      if (pick) {
        const andUrl = `${VT_PROXY}/andamentoTreno/${pick.stationId}/${pick.trainNo}/${pick.epoch}`
        result.andamento = await fetchStep(andUrl)
        if (result.andamento?.ok && result.andamento.markdown) {
          try {
            const json = JSON.parse(result.andamento.markdown)
            const fermate = Array.isArray(json?.fermate) ? json.fermate : []
            const milano = fermate.find((f) => f.id === MILANO_CENTRALE_ID) ?? null
            const torino = fermate.find((f) => f.id === TORINO_PORTA_NUOVA_ID) ?? null
            result.parsed.fermateCount = fermate.length
            result.parsed.milanoStop = milano
            result.parsed.torinoStop = torino
            result.parsed.relevantStations = fermate.map((f) => ({
              id: f.id,
              stazione: f.stazione,
              programmataMs: f.programmata,
              ritardo: f.ritardo,
              binarioProgrammato: f.binarioProgrammatoPartenzaDescrizione ?? f.binarioProgrammatoArrivoDescrizione,
              binarioEffettivo: f.binarioEffettivoPartenzaDescrizione ?? f.binarioEffettivoArrivoDescrizione
            }))
          } catch (e) {
            result.parsed.parseError = String(e?.message || e)
          }
        }
      }
    }

    return jsonResponse(result, 200, {
      'Cache-Control': 'no-store'
    })
  }
}

async function fetchStep(url) {
  const startedAt = Date.now()
  try {
    const res = await fetch(url, { cf: { cacheTtl: 0, cacheEverything: false } })
    const text = await res.text()
    // r.jina.ai-Wrap: nach "Markdown Content:" steht der eigentliche Inhalt
    const wrapSplit = text.split('Markdown Content:')
    const markdown = wrapSplit.length > 1 ? wrapSplit[1].trim() : null
    return {
      url,
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - startedAt,
      rawTextLength: text.length,
      rawTextPreview: text.slice(0, 500),
      markdown
    }
  } catch (err) {
    return {
      url,
      ok: false,
      error: String(err?.message || err),
      durationMs: Date.now() - startedAt
    }
  }
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
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
