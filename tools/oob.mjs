// Pull a real order of battle from Wikidata and snap it onto the installations
// already extracted from the map archive.
//
// Wikidata is CC0. We take facts only - unit name, country, headquarters
// coordinates - and use our own OSM-derived bases for the actual positions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = 'https://query.wikidata.org/sparql';

/** Countries to pull, by Wikidata id, mapped to our map-data country names. */
const COUNTRIES = [
  ['Q30', 'United States of America'], ['Q145', 'United Kingdom'], ['Q142', 'France'],
  ['Q183', 'Germany'], ['Q159', 'Russia'], ['Q148', 'China'], ['Q668', 'India'],
  ['Q17', 'Japan'], ['Q36', 'Poland'], ['Q38', 'Italy'], ['Q16', 'Canada'],
  ['Q408', 'Australia'], ['Q43', 'Turkey'], ['Q884', 'South Korea'], ['Q212', 'Ukraine'],
  ['Q29', 'Spain'], ['Q55', 'Netherlands'], ['Q34', 'Sweden'], ['Q20', 'Norway'],
];

/** Formations we do not want: reserves of paperwork, not of manoeuvre. */
const REJECT = /waffen|\bss\b|wehrmacht|imperial japanese|red army|soviet|garrison|\bschool\b|headquarters|supply corps|cyber|\bdepot\b|\bcentre?\b|reserve fleet|installations command|heritage|engineering systems|systems command|inspector|surgeon|personnel command|materiel command|recruit|civil air patrol|cadet|reserve officer|training (command|center|centre|school)|recruiting|band|academy|museum|memorial|veteran|auxiliar|home guard|logistic|medical|dental|chaplain|finance|judge advocate|public affairs|test (and|&) evaluation|weather squadron|communications squadron|force support|contracting|comptroller|civil engineer squadron|security forces squadron|maintenance squadron|munitions squadron|operations support squadron|readiness squadron/i;

/** Name -> the template we field it as. */
function classify(name) {
  const n = name.toLowerCase();
  // air first: a "fleet air wing" flies, it does not sail
  if (/air (wing|force|division|squadron|group|base)|fleet air|fighter|bomber|aviation|airlift|tactical wing|wing$/.test(n)) return 'airwing';
  if (/helicopter|rotary/.test(n)) return 'airborne';
  if (/fleet|flotilla|destroyer|frigate|submarine|naval|navy|maritime|patrol boat/.test(n)) return 'flotilla';
  if (/airborne|parachute|air assault|paratroop|air mobile|airmobile/.test(n)) return 'airborne';
  if (/marine|amphibious|naval infantry|commando/.test(n)) return 'marine';
  if (/armor|armour|tank|panzer|cavalry|cuirassier|dragoon/.test(n)) return 'armoured';
  if (/mechanized|mechanised|motor|stryker|infantry fighting/.test(n)) return 'mechanised';
  if (/territorial|national guard|home defen|militia/.test(n)) return 'territorial';
  if (/mountain|alpine|jaeger|jäger/.test(n)) return 'airborne';
  return 'light';
}

async function sparql(query) {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': 'theatre-wargame/0.1 (order of battle import)',
    },
  });
  if (!res.ok) throw new Error(`sparql ${res.status}`);
  return res.json();
}

const queryFor = (qid) => `
SELECT ?unit ?unitLabel ?coord ?parentLabel WHERE {
  ?unit wdt:P31/wdt:P279* wd:Q176799 ;
        wdt:P17 wd:${qid} .
  FILTER NOT EXISTS { ?unit wdt:P576 ?dissolved }
  { ?unit wdt:P159 ?hq . ?hq wdt:P625 ?coord }
  UNION
  { ?unit wdt:P625 ?coord }
  OPTIONAL { ?unit wdt:P361 ?parent }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

const parsePoint = (s) => {
  const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

// ---------------------------------------------------------------- run --------

const installations = JSON.parse(
  fs.readFileSync(path.join(root, 'public/data/installations.json'), 'utf8')).installations;
const world = JSON.parse(fs.readFileSync(path.join(root, 'public/data/world.json'), 'utf8'));

/** Nearest installation of a type, in degrees. */
function nearestBase(lon, lat, types, maxDeg) {
  let best = null, bestD = maxDeg * maxDeg;
  for (const i of installations) {
    if (!types.includes(i.t)) continue;
    const d = (i.lon - lon) ** 2 + (i.lat - lat) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
function nearestProvince(lon, lat) {
  let best = -1, bestD = Infinity;
  for (const p of world.provinces) {
    const d = (p.lon - lon) ** 2 + (p.lat - lat) ** 2;
    if (d < bestD) { bestD = d; best = p.id; }
  }
  return best;
}

const out = [];
const stats = {};
for (const [qid, country] of COUNTRIES) {
  let json;
  try {
    json = await sparql(queryFor(qid));
  } catch (err) {
    console.warn(`${country}: query failed (${err.message})`);
    continue;
  }
  const seen = new Set();
  let kept = 0, rejected = 0;
  for (const row of json.results.bindings) {
    const name = row.unitLabel?.value ?? '';
    if (!name || name.startsWith('Q')) continue;          // unlabelled entity
    if (REJECT.test(name)) { rejected++; continue; }
    if (seen.has(name)) continue;
    seen.add(name);
    const point = parsePoint(row.coord?.value ?? '');
    if (!point) continue;
    const [lon, lat] = point;
    if (!isFinite(lon) || !isFinite(lat)) continue;

    // A real manoeuvre formation is numbered ("18th Combined Arms Army") or
    // named as one. Everything else is an office.
    const numbered = /^\d+(st|nd|rd|th|e|er)?\b|^[IVX]+\b/.test(name);
    const formation = /\b(division|brigade|regiment|corps|fleet|army|wing|flotilla|battalion)\b/i.test(name);
    if (!numbered && !formation) { rejected++; continue; }

    const template = classify(name);
    const types = template === 'airwing' ? ['air'] : template === 'flotilla' ? ['port'] : ['base'];
    // snap to a real installation nearby; otherwise stand where Wikidata says
    const base = nearestBase(lon, lat, types, 0.6);
    const at = base ? [base.lon, base.lat] : [lon, lat];
    out.push({
      country,
      name,
      template,
      lon: Math.round(at[0] * 1e4) / 1e4,
      lat: Math.round(at[1] * 1e4) / 1e4,
      base: base?.n || null,
      p: nearestProvince(at[0], at[1]),
      parent: row.parentLabel?.value ?? null,
    });
    kept++;
  }
  stats[country] = { kept, rejected };
  console.log(`${country.padEnd(26)} ${String(kept).padStart(4)} formations (${rejected} filtered out)`);
}

/**
 * Rank by formation size. Wikidata returns everything down to individual
 * squadrons; a strategic game wants the divisions and brigades.
 */
function echelonRank(name) {
  const n = name.toLowerCase();
  // "Command" is usually a headquarters rather than a formation, so it ranks
  // below anything that actually manoeuvres
  if (/\barmy\b|\bcorps\b|\bfleet\b/.test(n)) return 5;
  if (/\bdivision\b/.test(n)) return 4;
  if (/\bbrigade\b|\bwing\b/.test(n)) return 3;
  if (/\bregiment\b|\bgroup\b|\bflotilla\b/.test(n)) return 2;
  if (/\bbattalion\b|\bsquadron\b/.test(n)) return 1;
  if (/\bcommand\b|\bheadquarters\b|\bstaff\b/.test(n)) return -1;
  return 0;
}

/** Keep the most significant formations per country, not every sub-unit. */
const PER_COUNTRY = 30;
const trimmed = [];
for (const [, country] of COUNTRIES) {
  const mine = out.filter((u) => u.country === country);
  mine.sort((a, b) => (echelonRank(b.name) - echelonRank(a.name))
    || (Number(!!b.base) - Number(!!a.base))
    || a.name.localeCompare(b.name));
  trimmed.push(...mine.slice(0, PER_COUNTRY));
}
out.length = 0;
out.push(...trimmed);

const byTemplate = {};
for (const u of out) byTemplate[u.template] = (byTemplate[u.template] || 0) + 1;
const snapped = out.filter((u) => u.base).length;

fs.writeFileSync(path.join(root, 'public/data/oob.json'), JSON.stringify({
  source: 'Wikidata (CC0), positions snapped to OpenStreetMap installations',
  generated: new Date().toISOString().slice(0, 10),
  units: out,
}));
console.log('kept per country:', Object.fromEntries(
  COUNTRIES.map(([, c]) => [c, out.filter((u) => u.country === c).length])));
console.log(`\ntotal ${out.length} formations, ${snapped} snapped to a real base`);
console.log('by type:', JSON.stringify(byTemplate));
console.log(`size ${(fs.statSync(path.join(root, 'public/data/oob.json')).size / 1e6).toFixed(2)} MB`);
