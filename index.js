import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { unflatten } from "devalue";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL =
  process.env.PORTAL_BASE_URL || "https://urja-ops.flockenergy.tech";
const LOGIN_PATH = process.env.PORTAL_LOGIN_PATH || "/login";
// GUESS: confirm the real path from the Request URL of `search?q=&page=1`
// in the browser Network tab, then set PORTAL_SEARCH_PATH in .env
const SEARCH_PATH = process.env.PORTAL_SEARCH_PATH || "/portal/meters/search";

let sessionCookie = "";

const portal = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  maxRedirects: 0, // we handle redirects ourselves
  validateStatus: (s) => s >= 200 && s < 400,
});

const METER_ID_RE = /^[A-Za-z0-9_-]+$/;

async function loginToPortal() {
  console.log("Attempting to log in to Urja portal...");
  const body = new URLSearchParams({
    email: process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASSWORD,
  }).toString();

  const response = await portal.post(LOGIN_PATH, body, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: BASE_URL, // needed to pass SvelteKit's CSRF check
      Referer: `${BASE_URL}/login`,
    },
  });

  // SvelteKit form actions report the outcome in the response body (`type`),
  // so check it instead of relying on the HTTP status alone
  if (response.data?.type !== "redirect") {
    throw new Error(
      `Login failed: ${JSON.stringify(response.data).slice(0, 200)}`,
    );
  }

  const cookies = response.headers["set-cookie"];
  if (!cookies || cookies.length === 0) {
    throw new Error("Login failed: no cookie returned");
  }
  sessionCookie = cookies.map((c) => c.split(";")[0]).join("; ");
  console.log("Login successful! Session cookie acquired.");
}

// GET with automatic re-login: if the session has expired, log in again once and retry
async function portalGet(path, retry = true) {
  if (!sessionCookie) await loginToPortal();

  const response = await portal.get(path, {
    headers: { Cookie: sessionCookie, Accept: "application/json" },
  });

  const redirectedToLogin =
    response.status >= 300 &&
    String(response.headers.location || "").includes("login");
  // If we get an HTML page instead of JSON (the login page), treat the session as expired too
  const gotHtml =
    typeof response.data === "string" &&
    response.data.trimStart().startsWith("<");

  if (response.status === 401 || redirectedToLogin || gotHtml) {
    if (!retry) throw new Error("Portal session could not be re-established");
    sessionCookie = "";
    return portalGet(path, false);
  }
  return response.data;
}

function notFound(message) {
  return Object.assign(new Error(message), { notFound: true });
}

// Extracts the actual page data from SvelteKit's __data.json response
function parseSvelteData(raw) {
  if (raw.nodes?.some((n) => n.type === "error")) {
    throw notFound("Portal returned an error node (meter not found?)");
  }
  const node = raw.nodes?.find((n) => n.type === "data");
  if (!node) throw new Error("No data node in portal response");
  return unflatten(node.data);
}

function toCleanMeter(parsed) {
  const attrs = Object.fromEntries(
    parsed.detail.data.map((p) => [p.parameterName, p.parameterValue]),
  );
  const h = parsed.hierarchy;
  return {
    meterId: parsed.meterId,
    serialNo: attrs["Serial No"],
    make: attrs["Make"],
    phaseType: attrs["Phase Type"],
    installationStatus: attrs["Installation Status"],
    installationType: attrs["Installation Type"],
    hierarchy: {
      zone: h["Zone"],
      circle: h["Circle"],
      division: h["Division"],
      subdivision: h["Subdivision"],
      substation: h["Sub Station"],
      feeder: h["Feeder"],
      dt: h["DT"],
    },
  };
}

function handleError(res, error, what) {
  if (error.notFound || error.response?.status === 404) {
    return res.status(404).json({ error: `${what} not found` });
  }
  const upstream = ["ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "ECONNABORTED"];
  if (upstream.includes(error.code)) {
    return res
      .status(502)
      .json({ error: "Legacy portal unreachable", message: error.message });
  }
  console.error(error.message, error.response?.status, error.response?.data);
  res
    .status(500)
    .json({ error: `Failed to fetch ${what}`, message: error.message });
}

// Middleware: validate the meter id
function validateMeterId(req, res, next) {
  if (!METER_ID_RE.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid meter id" });
  }
  next();
}

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Endpoint 1: meters list / search (currently the portal's raw response; will be cleaned once its shape is known)
// Query: ?q=<text>&page=<number>
app.get("/api/v1/meters", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const page = Number.parseInt(req.query.page ?? "1", 10);
  if (!Number.isInteger(page) || page < 1) {
    return res.status(400).json({ error: "page must be a positive integer" });
  }
  try {
    const params = new URLSearchParams({ q, page: String(page) });
    const raw = await portalGet(`${SEARCH_PATH}?${params}`);
    res.json({ page, query: q, portalResponse: raw });
  } catch (error) {
    handleError(res, error, "meters list");
  }
});

// Endpoint 2: single meter (clean JSON)
app.get("/api/v1/meters/:id", validateMeterId, async (req, res) => {
  const meterId = req.params.id;
  try {
    const raw = await portalGet(
      `/meters/${encodeURIComponent(meterId)}/__data.json?x-sveltekit-invalidated=001`,
    );
    res.json(toCleanMeter(parseSvelteData(raw)));
  } catch (error) {
    handleError(res, error, `meter '${meterId}'`);
  }
});

// Endpoint 3: meter location
app.get("/api/v1/meters/:id/geo", validateMeterId, async (req, res) => {
  const meterId = req.params.id;
  try {
    const raw = await portalGet(
      `/portal/meters/${encodeURIComponent(meterId)}/geo`,
    );
    if (!raw?.data) throw notFound("No geo data");
    res.json({
      meterId,
      latitude: Number(raw.data.latitude), // the portal sends these as strings
      longitude: Number(raw.data.longitude),
    });
  } catch (error) {
    handleError(res, error, `location of meter '${meterId}'`);
  }
});

// Endpoint 4: meter energy (currently the portal's raw JSON; will be cleaned once its shape is known)
// Any query parameters (e.g. from/to) are forwarded to the portal as-is
app.get("/api/v1/meters/:id/energy", validateMeterId, async (req, res) => {
  const meterId = req.params.id;
  try {
    const qs = new URLSearchParams(
      Object.entries(req.query).filter(([, v]) => typeof v === "string"),
    ).toString();
    const raw = await portalGet(
      `/portal/meters/${encodeURIComponent(meterId)}/energy${qs ? `?${qs}` : ""}`,
    );
    res.json({ meterId, portalResponse: raw });
  } catch (error) {
    handleError(res, error, `energy of meter '${meterId}'`);
  }
});

app.listen(PORT, () => {
  console.log(`Wrapper API running on http://localhost:${PORT}`);
});
