import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WIDGET_ID = "cea3d880-eaaf-4c3f-acf7-481c305d9cbf";
const WIDGET_TYPE = "club-matches";
const BASE = "https://next.fussball.de";
const WIDGET_URL = `${BASE}/widget/${WIDGET_TYPE}/${WIDGET_ID}`;
const LEGACY_SPIEL = "https://www.fussball.de/spiel/-/spiel";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "data");
const OUT_FILE = join(OUT_DIR, "matches.json");

const FETCH_DELAY_MS = Number(process.env.FETCH_DELAY_MS || 400);

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCodePoint(parseInt(h, 16))
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function matchUrl(id) {
  return id ? `${BASE}/spiel/-/${id}` : null;
}

function teamUrl(teamPermanentId) {
  return teamPermanentId ? `${BASE}/mannschaft/-/${teamPermanentId}` : null;
}

/** Klartext aus der klassischen Fussball.de-Spielseite (nicht next.fussball). */
function parseLegacySpielHtml(html, matchId) {
  const sourceUrl = `${LEGACY_SPIEL}/${matchId}`;
  const out = { sourceUrl };

  const titleM = html.match(/<title>\s*([^<]+?)\s*<\/title>/i);
  if (titleM) out.pageTitle = decodeHtmlEntities(titleM[1]).trim();

  const ogDesc = html.match(/property="og:description" content="([^"]*)"/i);
  if (ogDesc) out.description = decodeHtmlEntities(ogDesc[1]).trim();

  const compM = html.match(/<a href="[^"]*" class="competition">\s*([^<]*?)\s*</i);
  if (compM) out.competition = compM[1].replace(/\s+/g, " ").trim();

  const homeM = html.match(
    /<div class="team-home">[\s\S]*?<div class="team-name">\s*<a[^>]*>\s*([^<]+?)\s*<\/a>/i
  );
  if (homeM) out.homeTeam = homeM[1].trim();

  const awayM = html.match(
    /<div class="team-away">[\s\S]*?<div class="team-name">\s*<a[^>]*>\s*([^<]+?)\s*<\/a>/i
  );
  if (awayM) out.awayTeam = awayM[1].trim();

  const locM = html.match(
    /<a href="https:\/\/www\.google\.de\/maps[^"]*" class="location"[^>]*>\s*([^<]+?)\s*</i
  );
  if (locM) out.venue = locM[1].replace(/\s+/g, " ").trim();

  const infoM = html.match(
    /<div class="result"[^>]*>[\s\S]*?<span class="info-text">\s*([^<]+?)\s*<\/span>/i
  );
  if (infoM) out.result = infoM[1].trim();

  const halfM = html.match(
    /<span class="half-result">\s*(\[[^\]]+\])\s*<\/span>/i
  );
  if (halfM) out.halfTimeScore = halfM[1].trim();

  return out;
}

async function fetchReadableForMatch(matchId) {
  const url = `${LEGACY_SPIEL}/${matchId}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; fussball-de-widget-export/1.1; +https://github.com/CZ1979/fussball-de-widget)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9",
      },
    });
    if (!res.ok) {
      return { sourceUrl: url, error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    return parseLegacySpielHtml(html, matchId);
  } catch (e) {
    return { sourceUrl: url, error: e instanceof Error ? e.message : String(e) };
  }
}

function enrichMatch(m, readableById) {
  if (!m || typeof m !== "object") return m;
  const home = m.homeTeam;
  const guest = m.guestTeam;
  const readable = m.id ? readableById.get(m.id) ?? null : null;
  return {
    ...m,
    readable,
    links: {
      match: matchUrl(m.id),
      matchLegacy: m.id ? `${LEGACY_SPIEL}/${m.id}` : null,
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
    "User-Agent":
      "Mozilla/5.0 (compatible; fussball-de-widget-export/1.1; maschinelle Auswertung)",
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

const allIds = [
  ...new Set(
    [...previousMatches, ...nextMatches]
      .map((x) => x?.id)
      .filter((id) => typeof id === "string" && id.length > 0)
  ),
];

const readableById = new Map();
for (let i = 0; i < allIds.length; i++) {
  const id = allIds[i];
  process.stderr.write(`Legacy-Spiel ${i + 1}/${allIds.length} ${id}…\n`);
  readableById.set(id, await fetchReadableForMatch(id));
  if (i < allIds.length - 1) await delay(FETCH_DELAY_MS);
}

const output = {
  meta: {
    widgetId: WIDGET_ID,
    widgetType: WIDGET_TYPE,
    widgetUrl: WIDGET_URL,
    generatedAt: new Date().toISOString(),
    clubName: pageProps.clubName ?? null,
    note:
      "Die Felder competitionName, kickoff-Texte und team.name in den Rohdaten sind von Fussball.de oft verschleiert. Für n8n und Auswertungen bitte vorrangig match.readable nutzen (Kommt von www.fussball.de/spiel/-/spiel/<id>, Klartext für Teams, Wettbewerb, Ort). Endstände sind dort teils ebenfalls geschützt; dann ggf. result / halfTimeScore oder die Rohfelder prüfen.",
  },
  widgetQueryParams: pageProps.widgetQueryParams ?? null,
  previousMatches: previousMatches.map((m) => enrichMatch(m, readableById)),
  nextMatches: nextMatches.map((m) => enrichMatch(m, readableById)),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), "utf8");
console.log("Geschrieben:", OUT_FILE);
console.log(
  "Vergangene:",
  output.previousMatches.length,
  "| Nächste:",
  output.nextMatches.length,
  "| Legacy-Abrufe:",
  allIds.length
);
