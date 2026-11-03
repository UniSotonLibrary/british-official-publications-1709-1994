/**
 * Stage 1: Validate data/*.csv against british_official_publications_enriched.csv
 * Run: node scripts/validate-data.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseCsv,
  validPublicationYear,
  yearToDecade,
  DECADE_COLUMNS,
} from "./lib-csv.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");

const TOPIC_META = {
  land: "Land & Property",
  agriculture: "Agriculture & Rural Affairs",
  health: "Health & Public Health",
  education: "Education",
  justice: "Justice, Crime & Prisons",
  government: "Government & Administration",
  parliament: "Parliament & Legislation",
  economy: "Economy, Finance & Taxation",
  trade: "Trade, Industry & Employment",
  transport: "Transport & Infrastructure",
  housing: "Housing & Urban Development",
  welfare: "Social Welfare & Poverty",
  defence: "Defence & Military",
  religion: "Religion & Church",
  environment: "Environment & Natural Resources",
  science: "Science, Technology & Communications",
  population: "Population & Demography",
  international: "International Affairs & Empire",
  culture: "Culture & Heritage",
  other: "Other",
};

const THEME_TO_TOPIC = Object.fromEntries(
  Object.entries(TOPIC_META).map(([slug, theme]) => [theme, slug])
);

function assignDecade(row) {
  if (validPublicationYear(row.PublicationYear)) {
    return yearToDecade(row.PublicationYear);
  }
  if (DECADE_COLUMNS.includes(row.Decade)) {
    return row.Decade;
  }
  return "";
}

const enriched = parseCsv(fs.readFileSync(path.join(DATA, "british_official_publications_enriched.csv"), "utf8"));
const topics = parseCsv(fs.readFileSync(path.join(DATA, "topics.csv"), "utf8"));
const docs = parseCsv(fs.readFileSync(path.join(DATA, "topic_documents.csv"), "utf8"));

const expected = {};
for (const slug of Object.keys(TOPIC_META)) {
  expected[slug] = {
    total: 0,
    decades: Object.fromEntries(DECADE_COLUMNS.map((d) => [d, 0])),
    validYears: [],
  };
}

let unmappedThemes = 0;
for (const row of enriched) {
  const slug = THEME_TO_TOPIC[row.Theme];
  if (!slug) { unmappedThemes++; continue; }
  const e = expected[slug];
  e.total++;
  const decade = assignDecade(row);
  if (decade && e.decades[decade] != null) e.decades[decade]++;
  if (validPublicationYear(row.PublicationYear)) {
    e.validYears.push(parseInt(row.PublicationYear, 10));
  }
}

const errors = [];

console.log("=== DATA VALIDATION ===\n");
console.log(`Enriched publications: ${enriched.length}`);
console.log(`Topics rows: ${topics.length}`);
console.log(`Topic documents rows: ${docs.length}`);
if (unmappedThemes) console.log(`WARNING: ${unmappedThemes} enriched rows with unmapped Theme`);

for (const topicRow of topics) {
  const slug = topicRow.topic;
  const exp = expected[slug];
  if (!exp) { errors.push(`${slug}: unknown topic in topics.csv`); continue; }

  if (Number(topicRow.total_publications) !== exp.total) {
    errors.push(`${slug}: total_publications ${topicRow.total_publications} != expected ${exp.total}`);
  }

  const years = exp.validYears.sort((a, b) => a - b);
  const expFirst = years[0] ?? "";
  const expLast = years[years.length - 1] ?? "";
  if (String(topicRow.first_year) !== String(expFirst)) {
    errors.push(`${slug}: first_year ${topicRow.first_year} != expected ${expFirst}`);
  }
  if (String(topicRow.last_year) !== String(expLast)) {
    errors.push(`${slug}: last_year ${topicRow.last_year} != expected ${expLast}`);
  }

  for (const decade of DECADE_COLUMNS) {
    const got = Number(topicRow[decade]) || 0;
    const want = exp.decades[decade];
    if (got !== want) {
      errors.push(`${slug}: ${decade} ${got} != expected ${want}`);
    }
  }
}

const docCounts = {};
for (const d of docs) docCounts[d.topic] = (docCounts[d.topic] || 0) + 1;
for (const slug of Object.keys(TOPIC_META)) {
  if ((docCounts[slug] || 0) !== expected[slug].total) {
    errors.push(`${slug}: topic_documents count ${docCounts[slug] || 0} != expected ${expected[slug].total}`);
  }
}

if (errors.length === 0) {
  console.log("\n✓ All topics.csv values match enriched dataset.");
  process.exit(0);
} else {
  console.log(`\n✗ ${errors.length} mismatch(es):\n`);
  errors.forEach((e) => console.log("  -", e));
  process.exit(1);
}
