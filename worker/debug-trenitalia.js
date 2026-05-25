/**
 * PV-Reisli 2026: Debug-Endpoint fuer Trenitalia via r.jina.ai
 *
 * Liefert die Roh-Antworten beider Zuege (Anreise 9612 + Rueckreise 9641)
 * damit man im Browser sehen kann was der HTTPS-Proxy tatsaechlich liefert.
 * NUR mit testKey aufrufbar.
 */

import {
  OUTBOUND_CONFIG,
  RETURN_CONFIG,
  VT_PROXY,
  MILANO_CENTRALE_ID,
  TORINO_PORTA_NUOVA_ID,
  jinaHeaders,
  isRateLimitedBody,
  hmInZurich,
  isInZurichDepartureWindow,
  shouldFetchTrenitalia
} from './travel-status.js'

const TEST_OVERRIDE_TOKEN = 'pegelspitze-bunker-2026'

function resolveNow(url) {
  if (url.searchParams.get('testKey') !== TEST_OVERRIDE_TOKEN) return Date.now()
  const override = url.searchParams.get('now')
  if (!override) return Date.now()
  const parsed = Date.parse(override)
  return Number.isNaN(parsed) ? Date.now() : parsed
}

function fetchWindowReason(config, nowMs) {
  if (nowMs < config.fetchWindowStartMs) return 'vor Fetch-Fenster (Trenitalia-API wird gespart)'
  if (nowMs > config.fetchWindowEndMs) return 'nach Fetch-Fenster (Trenitalia-API wird gespart)'
  return null
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return preflight()
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed' }, 405)
    }

    const url = new URL(request.url)
    if (url.searchParams.get('testKey') !== TEST_OVERRIDE_TOKEN) {
      return jsonResponse({ error: 'forbidden' }, 403)
    }

    const now = resolveNow(url)
    const outboundActive = shouldFetchTrenitalia(OUTBOUND_CONFIG, now)
    const returnActive = shouldFetchTrenitalia(RETURN_CONFIG, now)

    const [outbound, ret] = await Promise.all([
      outboundActive
        ? probeTrip(OUTBOUND_CONFIG.trenitalia, env)
        : Promise.resolve({
            skipped: true,
            reason: fetchWindowReason(OUTBOUND_CONFIG, now) ?? 'inaktiv',
            config: trenitaliaConfigSummary(OUTBOUND_CONFIG.trenitalia)
          }),
      returnActive
        ? probeTrip(RETURN_CONFIG.trenitalia, env)
        : Promise.resolve({
            skipped: true,
            reason: fetchWindowReason(RETURN_CONFIG, now) ?? 'inaktiv',
            config: trenitaliaConfigSummary(RETURN_CONFIG.trenitalia)
          })
    ])

    return jsonResponse({
      meta: {
        proxy: VT_PROXY,
        milanoCentraleId: MILANO_CENTRALE_ID,
        torinoPortaNuovaId: TORINO_PORTA_NUOVA_ID,
        auth: env?.JINA_API_KEY ? 'mit Key' : 'anonym',
        fetchedAt: new Date().toISOString(),
        resolvedNow: new Date(now).toISOString()
      },
      outbound,
      return: ret
    }, 200, { 'Cache-Control': 'no-store' })
  }
}

function trenitaliaConfigSummary(t) {
  return {
    train: t.trainNo,
    depStationId: t.depStationId,
    arrStationId: t.arrStationId,
    depHourWindowZurich: t.depHourWindowZurich
  }
}

async function probeTrip(trenitaliaConfig, env) {
  const result = {
    config: trenitaliaConfigSummary(trenitaliaConfig),
    cerca: await fetchStep(`${VT_PROXY}/cercaNumeroTrenoTrenoAutocomplete/${trenitaliaConfig.trainNo}`, env),
    andamento: null,
    parsed: null
  }

  if (!result.cerca?.ok || !result.cerca?.markdown) return result

  const lines = result.cerca.markdown.split('\n').map((l) => l.trim()).filter(Boolean)
  const ids = lines
    .map((l) => l.split('|')[1])
    .filter(Boolean)
    .map((tuple) => {
      const parts = tuple.split('-')
      return { trainNo: parts[0], stationId: parts[1], epoch: parts[2] }
    })
  const pick = ids.find((i) => i.stationId === trenitaliaConfig.depStationId) || ids[0] || null
  result.parsed = { allIds: ids, pickedForAndamento: pick }
  if (!pick) return result

  const andUrl = `${VT_PROXY}/andamentoTreno/${pick.stationId}/${pick.trainNo}/${pick.epoch}`
  result.andamento = await fetchStep(andUrl, env)
  if (!result.andamento?.ok || !result.andamento.markdown) return result

  try {
    const json = JSON.parse(result.andamento.markdown)
    const fermate = Array.isArray(json?.fermate) ? json.fermate : []
    const depIdx = fermate.findIndex((f) => f.id === trenitaliaConfig.depStationId)
    const arrIdx = fermate.findIndex((f) => f.id === trenitaliaConfig.arrStationId)
    const depStop = depIdx >= 0 ? fermate[depIdx] : null
    const arrStop = arrIdx >= 0 ? fermate[arrIdx] : null

    const directionOk = depIdx >= 0 && arrIdx >= 0 && depIdx < arrIdx
    const plannedDepartureMs = typeof depStop?.partenza_teorica === 'number' ? depStop.partenza_teorica : null
    const plannedArrivalMs = typeof arrStop?.arrivo_teorico === 'number' ? arrStop.arrivo_teorico : null
    const scheduleOk = isInZurichDepartureWindow(plannedDepartureMs, trenitaliaConfig.depHourWindowZurich)

    result.parsed.fermateCount = fermate.length
    result.parsed.depStop = depStop
    result.parsed.arrStop = arrStop
    result.parsed.directionCheck = {
      ok: directionOk,
      depIndex: depIdx,
      arrIndex: arrIdx
    }
    result.parsed.scheduleCheck = {
      ok: scheduleOk,
      plannedDeparture: hmInZurich(plannedDepartureMs),
      plannedArrival: hmInZurich(plannedArrivalMs),
      windowZurich: `${trenitaliaConfig.depHourWindowZurich.min}:00–${trenitaliaConfig.depHourWindowZurich.max}:00`
    }
    result.parsed.liveMatchAccepted = directionOk && scheduleOk && fermate.length > 0
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

  return result
}

async function fetchStep(url, env) {
  const startedAt = Date.now()
  try {
    const res = await fetch(url, {
      headers: jinaHeaders(env),
      cf: { cacheTtl: 0, cacheEverything: false }
    })
    const text = await res.text()
    const wrapSplit = text.split('Markdown Content:')
    const markdown = wrapSplit.length > 1 ? wrapSplit[1].trim() : null
    return {
      url,
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - startedAt,
      rawTextLength: text.length,
      rawTextPreview: text.slice(0, 500),
      markdown,
      rateLimited: isRateLimitedBody(text)
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
