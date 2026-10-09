# Urja Meter Ops API Wrapper

A small REST API in front of the legacy "Urja Meter Ops" web portal
(https://urja-ops.flockenergy.tech). The portal has no API, so this service
logs in like a normal user, calls the same endpoints the portal's own pages
use, and exposes the data as clean JSON.

- How the portal works (reverse-engineered): [PROTOCOL.md](./PROTOCOL.md)
- API description (OpenAPI 3): [openapi.json](./openapi.json)
- Reflection: see the [Reflection](#reflection) section below

## Endpoints

| Endpoint                        | Description                                        |
| ------------------------------- | -------------------------------------------------- |
| `GET /health`                   | Service health check                               |
| `GET /api/v1/meters/:id`        | Meter details and network hierarchy (clean JSON)   |
| `GET /api/v1/meters/:id/geo`    | Meter location (latitude and longitude as numbers) |
| `GET /api/v1/meters/:id/energy` | Consumption data (see "Known limitations")         |
| `GET /api/v1/meters?q=&page=`   | Meter list / search (see "Known limitations")      |

## Requirements

- Node.js 18 or newer
- A login for the portal (provided with the assignment)

## Install, configure, run

```bash
git clone https://github.com/Abhishek-singh-007/flock-energy-meter-api.git
cd flock-energy-meter-api
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

Open `.env` and fill in `PORTAL_USERNAME` (the login email) and
`PORTAL_PASSWORD`. Then start the server:

```bash
npm start
```

It listens on http://localhost:3000 (change with `PORT`).

### Configuration

| Variable             | Default                             | Meaning                                                   |
| -------------------- | ----------------------------------- | --------------------------------------------------------- |
| `PORTAL_BASE_URL`    | `https://urja-ops.flockenergy.tech` | Portal origin                                             |
| `PORTAL_LOGIN_PATH`  | `/login`                            | Login form path                                           |
| `PORTAL_SEARCH_PATH` | `/portal/meters/search`             | Meter search endpoint (unverified guess, see limitations) |
| `PORTAL_USERNAME`    | none                                | Login email                                               |
| `PORTAL_PASSWORD`    | none                                | Login password                                            |
| `PORT`               | `3000`                              | Port of this API                                          |

## Sample requests

```bash
curl http://localhost:3000/api/v1/meters/J100000
```

```json
{
  "meterId": "J100000",
  "serialNo": "SE33962",
  "make": "HPL",
  "phaseType": "single",
  "installationStatus": "Decommissioned",
  "installationType": "Whole Current",
  "hierarchy": {
    "zone": "Jaipur Zone 1 (Z-01)",
    "circle": "Circle 1 (C-01)",
    "division": "Division 1 (D-01)",
    "subdivision": "Subdivision 1 (SD-01)",
    "substation": "Substation 1 (SS-01)",
    "feeder": "Feeder 1 (F-001)",
    "dt": "Malviya Nagar DT 1 (DT-001)"
  }
}
```

```bash
curl http://localhost:3000/api/v1/meters/J100000/geo
# {"meterId":"J100000","latitude":26.938961002479868,"longitude":75.83095696146852}

curl http://localhost:3000/api/v1/meters/J999999
# 404 {"error":"meter 'J999999' not found"}
```

## How it is structured

Everything lives in `index.js`, in these parts:

1. **Portal client**: an axios instance with a timeout and automatic
   redirects disabled.
2. **Login and session**: `loginToPortal()` posts the login form and keeps
   the session cookie in memory. `portalGet()` wraps every portal call; if the
   session looks expired it logs in again once and retries.
3. **Parsing**: `parseSvelteData()` decodes SvelteKit's `devalue` format and
   `toCleanMeter()` maps it to a flat, readable object.
4. **Routes**: thin handlers that validate input, call the portal and map
   the result.
5. **Error mapping**: unknown meter gives 404, invalid id gives 400, portal
   unreachable gives 502, anything else gives 500.

## Assumptions

- Only read access is needed, so after login the service makes GET requests only.
- Meter ids consist of letters, digits, `-` and `_` (for example `J100000`).
  Anything else is rejected with 400 before it reaches the portal.
- The portal returns latitude and longitude as strings; they are converted to
  numbers because that is what API consumers expect.
- One shared portal session is enough (a single-instance, single-user wrapper).

## Design decisions and trade-offs

- **Use the portal's own data endpoints instead of scraping HTML.** They return
  structured data, which is less fragile than parsing markup.
- **Decode `devalue` with the official package** rather than a hand-written
  parser. It is the format SvelteKit itself uses.
- **One in-memory session, lazy login, one retry.** Simple and enough for a
  single instance. The trade-off is that concurrent requests during an expiry
  may each trigger a login.
- **Single file.** The service is small. Splitting into modules would be the
  first refactor if it grows.
- **Meaningful HTTP codes** so consumers can tell "not found" from "portal down".
- **Credentials only in `.env`**, which is git-ignored. `.env.example` is committed.

## Known limitations

- `GET /api/v1/meters/:id/energy` currently returns the portal's JSON unchanged
  inside `portalResponse`. Query parameters are forwarded as-is. It is not yet
  mapped into a clean schema.
- `GET /api/v1/meters` currently returns the portal's search response unchanged
  inside `portalResponse`. The search path is a guess based on the pattern of
  the other `/portal/...` endpoints; if it differs, set `PORTAL_SEARCH_PATH`.
- Session expiry is detected via a 401, a redirect to login, or an HTML
  response. This was not tested against a real expired session.

## What I intentionally skipped

- Network hierarchy reconstruction across all meters, a local index, caching
  and a web client (all optional in the brief).
- Automated tests. I verified behaviour manually with the browser and curl.
- Authentication on this API itself; it is meant to run locally.
- Locking around re-login.

## What I would improve with more time

- Clean, typed models for the energy and list responses.
- A short-TTL cache for meter details.
- A lock so only one re-login happens at a time.
- Unit tests for the devalue mapping, and integration tests against a mocked portal.
- Split `index.js` into modules (client, parsers, routes).
- A hierarchy endpoint built from the list data, and a small web UI.

## Use of AI assistance

I used an AI assistant for guidance and to understand errors (for example the
CSRF 403 and the devalue format). Exploring the portal in the browser's
Network tab, finding the endpoints and testing were done by me.

## Reflection

### What assumptions did you make?

- Read-only access is enough, so after logging in the service only makes GET requests.
- Meter ids look like `J100000` (letters, digits, `-`, `_`). I validate this before calling the portal so malformed input never reaches it.
- The portal sends latitude and longitude as strings; I assumed API consumers want numbers, so I convert them.
- One shared portal session in memory is enough, because this is a single-instance wrapper meant to run locally.
- The portal's own page endpoints (`__data.json` and `/portal/...`) are stable enough to build on, since they are what the portal's UI itself uses.
- I assumed the meter search endpoint follows the same `/portal/meters/...` pattern as `geo` and `energy`. I have not verified this, which is why the path is configurable (`PORTAL_SEARCH_PATH`) and listed under known limitations.

### Which part was the most difficult, and how did you get unstuck?

Logging in. It failed in three different ways, one after the other:

1. `ETIMEDOUT`: my base URL pointed to the root domain instead of the portal's subdomain. I compared the URL in my code with the one in the browser's address bar.
2. `403 Cross-site POST form submissions are forbidden`: this is SvelteKit's CSRF protection. The error text was in the response body, and adding an `Origin` header fixed it.
3. HTTP 200 but no cookie: the form field was `email`, not `username`. I printed the response body and saw that the portal answers with a redirect object on success, so I now check the body `type` instead of trusting the status code.

The common pattern was that the answer was always in the actual response (body, headers, or the Network tab), not in guessing. After login, the second hard part was the meter detail response, which is a flat array where objects point to each other by index. I learned that this is SvelteKit's `devalue` format and used the official `devalue` package to decode it instead of writing a parser.

### If you had another day, what would you improve?

- Map the `energy` and search responses into clean, documented schemas (they are currently passed through from the portal) and verify the real search path, page size and last-page detection.
- Test session expiry properly with an invalid or expired cookie and record the portal's real behaviour in PROTOCOL.md, instead of relying on my 401 / redirect / HTML checks.
- Add a lock so only one re-login happens when several requests hit an expired session at the same time.
- Add tests: unit tests for the devalue mapping and integration tests against a mocked portal.
- Split `index.js` into modules (client, parsers, routes).
- Reconstruct the network hierarchy across meters, add a short-TTL cache, and build a small web UI (map of meters, consumption chart).

### What mistake did you make while solving this?

My first version of the service used `https://flockenergy.tech` as the base URL instead of `https://urja-ops.flockenergy.tech`. The requests went to a different server entirely and timed out, and I first read it as a network problem instead of checking the URL against the browser. It cost time that a simple comparison with the address bar would have saved. A related mistake was assuming the login field was `username` because the assignment gave me a "username"; the form actually wanted `email`.

### If you were reviewing your own submission, what would you criticise?

- Two of the four data endpoints (`energy` and the meter list) are not yet modelled; they return the portal's response unchanged, so a consumer still has to understand the portal's format. That undercuts the "clean API" goal.
- Everything is in a single `index.js`. It is fine at this size, but it will not scale and is harder to test.
- There are no automated tests; I verified behaviour manually with the browser and curl.
- Session expiry handling is untested against a real expired session, and concurrent requests can trigger several logins at once.
- The API itself has no authentication or rate limiting, and nothing is cached, so every request hits the legacy portal.
- I did not attempt any of the optional extensions (hierarchy, local index, caching, web client).
