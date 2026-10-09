# PROTOCOL.md: How the Urja Meter Ops portal works

Base URL: https://urja-ops.flockenergy.tech

## Stack

- The portal is a SvelteKit app (recognised by `__data.json` URLs and the
  `x-sveltekit-invalidated` query parameter).
- The auth cookie is named `__Secure-better-auth.session_token`, which points
  to the `better-auth` library.

## Authentication

- `POST /login` with `Content-Type: application/x-www-form-urlencoded`.
- Form fields: `email` and `password`. Using `username` instead returned HTTP
  200 but no cookie.
- The request must carry an `Origin` header equal to the portal origin.
  Without it SvelteKit's CSRF protection answers
  `403 Cross-site POST form submissions are forbidden`.
- Success: HTTP 200 with body
  `{"type":"redirect","status":303,"location":"/meters"}` and a `Set-Cookie`
  header. Because the status code is 200 even though the intent is a redirect,
  the body `type` is what has to be checked.
- Cookie attributes: HttpOnly, Secure, SameSite=Lax, Max-Age=3600
  (the session lasts 1 hour).
- Requests after login send the cookie in the `Cookie` header.
- TODO: record exactly what an expired or invalid cookie receives
  (401, redirect to login, or HTML).

## Data endpoints

### Meter detail: `GET /meters/{id}/__data.json?x-sveltekit-invalidated=001`

- Returned in SvelteKit's "devalue" format: a flat array where objects refer to
  each other by array index. Decoded with the `devalue` package (`unflatten`).
- Decoded shape: `meterId`, `detail.data[]` (a list of
  `{parameterName, parameterValue}` pairs: Meter ID, Serial No, Make,
  Phase Type, Installation Status, Installation Type) and `hierarchy`
  (Zone, Circle, Division, Subdivision, Sub Station, Feeder, DT).

### Location: `GET /portal/meters/{id}/geo`

- Plain JSON (not devalue):
  `{"data":{"latitude":"26.93...","longitude":"75.83..."}}`
- Latitude and longitude are strings.

### Consumption: `GET /portal/meters/{id}/energy`

- Plain JSON endpoint under `/portal/...`, called by the meter page.
- TODO: response shape, query parameters (date range or interval?), units.

### Meter list / search

- The meters page calls a request named `search?q=&page=1`.
- TODO: full request URL, response shape, page size, how to detect the last
  page, how `q` filters.

## Quirks and surprises

- Two styles of endpoint exist: `__data.json` (devalue) for page data and
  `/portal/...` (plain JSON) for the rest.
- A wrong login field name does not produce an error status; it returns 200
  without a cookie.
- An unknown meter id shows a "not found" state in the UI.
  TODO: note the HTTP status code seen in the Network tab.
