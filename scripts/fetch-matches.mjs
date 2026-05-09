import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WIDGET_ID = "cea3d880-eaaf-4c3f-acf7-481c305d9cbf";
const WIDGET_TYPE = "club-matches";
const BASE = "https://next.fussball.de";
const WIDGET_URL = `${BASE}/widget/${WIDGET_TYPE}/${WIDGET_ID}`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "data");
const OUT_FILE = join(OUT_DIR, "matches.json");

function matchUrl(id) {
  return id ? `${BASE}/spiel/-/${id}` : null;
}

function teamUrl(teamPermanentId) {
  return teamPermanentId ? `${BASE}/mannschaft/-/${teamPermanentId}` : null;
}

function enrichMatch(m) {
  if (!m || typeof m !== "object") return m;
  const home = m.homeTeam;
  const guest = m.guestTeam;
  return {
    ...m,
    links: {
      match: matchUrl(m.id),
      homeTeam: home?.teamPermanentId ? teamUrl(home.teamPermanentId) : null,
      guestTeam: guest?.teamPermanentId ? teamUrl(guest.teamPermanentId) : null,
    },
  };
}

function extractNextData(html) {
  const re =
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;
  const m = html.match(re);
  if (!m) throw new Error("__NEXT_DATA__ nicht gefunden – Seitenaufbau geändert?");
  return JSON.parse(m[1]);
}

const res = await fetch(WIDGET_URL, {
  headers: {
    "User-Agent": "fussball-de-widget-export/1.0 (+github; maschinelle Auswertung)",
    Accept: "text/html,application/xhtml+xml",
  },
});

if (!res.ok) {
  throw new Error(`HTTP ${res.status} beim Abruf von ${WIDGET_URL}`);
}

const html = await res.text();
const next = extractNextData(html);
const pageProps = next.props?.pageProps;
if (!pageProps) throw new Error("pageProps fehlt in __NEXT_DATA__");

const previousMatches = pageProps.previousMatches ?? [];
const nextMatches = pageProps.nextMatches ?? [];

const output = {
  meta: {
    widgetId: WIDGET_ID,
    widgetType: WIDGET_TYPE,
    widgetUrl: WIDGET_URL,
    generatedAt: new Date().toISOString(),
    clubName: pageProps.clubName ?? null,
    note:
      "Anzeigetexte (z. B. Mannschaftsnamen, Datum-Strings in kickoff) können von Fussball.de verschleiert sein. Für Automation eignen sich id, status, teamPermanentId, clubId und links.",
  },
  widgetQueryParams: pageProps.widgetQueryParams ?? null,
  previousMatches: previousMatches.map(enrichMatch),
  nextMatches: nextMatches.map(enrichMatch),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), "utf8");
console.log("Geschrieben:", OUT_FILE);
console.log(
  "Vergangene:",
  output.previousMatches.length,
  "| Nächste:",
  output.nextMatches.length
);
