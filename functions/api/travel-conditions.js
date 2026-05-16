// Cloudflare Pages Functions Adapter
// ----------------------------------
// Diese Datei mappt den Worker aus `worker/travel-conditions.js` direkt
// auf eine Pages-Function. Damit funktioniert /api/travel-conditions
// "out of the box", wenn du das Repo bei Cloudflare Pages deployst —
// ohne dass du eine separate Worker-Route konfigurieren musst.
//
// Wenn du lieber einen *eigenständigen* Worker betreibst, kannst du
// diese Datei ignorieren bzw. löschen und stattdessen den Inhalt aus
// `worker/travel-conditions.js` als Cloudflare Worker deployen und die
// Worker-Route auf `/api/travel-conditions` setzen.

import worker from '../../worker/travel-conditions.js'

export const onRequest = (context) =>
  worker.fetch(context.request, context.env, context)
