/**
 * PV-Reisli 2026: Travel-Status Endpoint
 *
 * Mock-Antwort fuer Live-Zuginfo. Spaeter durch SBB- oder Open-Data-API
 * austauschbar. Antwort enthaelt bewusst keine Ziele, Zwischenhalte
 * oder Zugnummern.
 */

const DEFAULT_STATUS = {
  status: 'on_time',
  delayMinutes: 0,
  message: 'Die Reise läuft planmässig.'
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return preflight()
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed' }, 405)
    }

    return jsonResponse(
      {
        ...DEFAULT_STATUS,
        updatedAt: new Date().toISOString()
      },
      200,
      { 'Cache-Control': 'public, max-age=60' }
    )
  }
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
