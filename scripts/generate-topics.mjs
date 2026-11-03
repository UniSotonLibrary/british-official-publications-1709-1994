/**
 * Build data/topics.csv from british_official_publications_enriched.csv
 * Run: node scripts/generate-topics.mjs
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
const ROOT = path.resolve(__dirname, "..");
const ENRICHED = path.join(ROOT, "data", "british_official_publications_enriched.csv");
const TOPICS_OUT = path.join(ROOT, "data", "topics.csv");
const DOCS_OUT = path.join(ROOT, "data", "topic_documents.csv");

const TOPIC_META = {
  land: { theme: "Land & Property", display_name: "Land", colour: "#00E676" },
  agriculture: { theme: "Agriculture & Rural Affairs", display_name: "Agriculture", colour: "#00C853" },
  health: { theme: "Health & Public Health", display_name: "Health", colour: "#FF0090" },
  education: { theme: "Education", display_name: "Education", colour: "#0057FF" },
  justice: { theme: "Justice, Crime & Prisons", display_name: "Justice", colour: "#FF0055" },
  government: { theme: "Government & Administration", display_name: "Government", colour: "#00B8D4" },
  parliament: { theme: "Parliament & Legislation", display_name: "Parliament", colour: "#FFC400" },
  economy: { theme: "Economy, Finance & Taxation", display_name: "Economy", colour: "#FF5E00" },
  trade: { theme: "Trade, Industry & Employment", display_name: "Trade", colour: "#FF6D00" },
  transport: { theme: "Transport & Infrastructure", display_name: "Transport", colour: "#00E5FF" },
  housing: { theme: "Housing & Urban Development", display_name: "Housing", colour: "#FF1744" },
  welfare: { theme: "Social Welfare & Poverty", display_name: "Welfare", colour: "#7B00FF" },
  defence: { theme: "Defence & Military", display_name: "Defence", colour: "#3D5AFE" },
  religion: { theme: "Religion & Church", display_name: "Religion", colour: "#B400FF" },
  environment: { theme: "Environment & Natural Resources", display_name: "Environment", colour: "#00FF87" },
  science: { theme: "Science, Technology & Communications", display_name: "Science", colour: "#4A00E0" },
  population: { theme: "Population & Demography", display_name: "Population", colour: "#E500FF" },
  international: { theme: "International Affairs & Empire", display_name: "International", colour: "#0091EA" },
  culture: { theme: "Culture & Heritage", display_name: "Culture", colour: "#FF9100" },
  other: { theme: "Other", display_name: "Other", colour: "#00BFA5" },
};

const THEME_TO_TOPIC = Object.fromEntries(
  Object.entries(TOPIC_META).map(([slug, meta]) => [meta.theme, slug])
);

/** Derive decade bucket from enriched row (valid year first, else valid Decade column). */
function assignDecade(row) {
  if (validPublicationYear(row.PublicationYear)) {
    return yearToDecade(row.PublicationYear);
  }
  if (DECADE_COLUMNS.includes(row.Decade)) {
    return row.Decade;
  }
  return "";
}

function extractDepartment(row) {
  const parts = [
    row["Main Entry - corporate name"],
    row["Main Entry - subordinate unit"],
    row["Main Entry - subordinate unit.1"],
    row["Main Entry - subordinate unit.2"],
  ]
    .map((p) => (p || "").trim())
    .filter(Boolean);
  if (parts.length) return parts.join(" · ").replace(/\.\s*$/, "");
  return (row.Region || "").trim();
}

function extractReportType(row) {
  const uniform = (row["Series Added Entry - Uniform Title"] || "").trim();
  if (uniform) return uniform.replace(/;+\s*$/, "");

  const series = (row["Series Statement"] || "").trim();
  if (/^HC/i.test(series)) return "House of Commons paper";
  if (/^Cd/i.test(series) || /^C\./i.test(series)) return "Command paper";
  if (series) return series.replace(/;+\s*$/, "");

  return (row["Series Statement.1"] || "").trim().replace(/;+\s*$/, "");
}

function escapeCsv(value) {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath, header, rows) {
  const lines = [header.map(escapeCsv).join(",")];
  for (const row of rows) {
    lines.push(header.map((col) => escapeCsv(row[col])).join(","));
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

const publications = parseCsv(fs.readFileSync(ENRICHED, "utf8"));
const stats = {};

for (const slug of Object.keys(TOPIC_META)) {
  stats[slug] = {
    total: 0,
    decades: Object.fromEntries(DECADE_COLUMNS.map((d) => [d, 0])),
    years: [],
    docs: [],
  };
}

for (const row of publications) {
  const slug = THEME_TO_TOPIC[row.Theme];
  if (!slug) continue;

  const s = stats[slug];
  s.total += 1;

  const decade = assignDecade(row);
  if (decade && s.decades[decade] != null) {
    s.decades[decade] += 1;
  }

  if (validPublicationYear(row.PublicationYear)) {
    s.years.push(parseInt(row.PublicationYear, 10));
  }

  const title = (row["Title Statement - title"] || "").trim();
  s.docs.push({
    topic: slug,
    year: row.PublicationYear || "",
    title: title || "Untitled publication",
    uri: row.uri || "",
    region: row.Region || "",
    subject: row.PrimarySubject || "",
    department: extractDepartment(row),
    report_type: extractReportType(row),
  });
}

const totals = Object.values(stats).map((s) => s.total);
const minTotal = Math.min(...totals);
const maxTotal = Math.max(...totals);

function shapeScale(total) {
  if (maxTotal === minTotal) return 1;
  const t = (total - minTotal) / (maxTotal - minTotal);
  return Number((0.85 + t * 1.15).toFixed(3));
}

const header = [
  "topic",
  "display_name",
  "description",
  "total_publications",
  "colour",
  "shape_scale",
  "first_year",
  "last_year",
  ...DECADE_COLUMNS,
];

const topicRows = Object.entries(TOPIC_META)
  .map(([slug, meta]) => {
    const s = stats[slug];
    const years = s.years.sort((a, b) => a - b);
    const row = {
      topic: slug,
      display_name: meta.display_name,
      description: meta.theme,
      total_publications: s.total,
      colour: meta.colour,
      shape_scale: shapeScale(s.total),
      first_year: years[0] ?? "",
      last_year: years[years.length - 1] ?? "",
    };
    for (const decade of DECADE_COLUMNS) {
      row[decade] = s.decades[decade];
    }
    return row;
  })
  .sort((a, b) => b.total_publications - a.total_publications);

writeCsv(TOPICS_OUT, header, topicRows);

const docHeader = ["topic", "year", "title", "uri", "region", "subject", "department", "report_type"];
const docRows = [];
for (const slug of Object.keys(TOPIC_META)) {
  const sorted = stats[slug].docs.sort((a, b) => {
    const ya = validPublicationYear(a.year) ? parseInt(a.year, 10) : -1;
    const yb = validPublicationYear(b.year) ? parseInt(b.year, 10) : -1;
    return yb - ya;
  });
  docRows.push(...sorted);
}

writeCsv(DOCS_OUT, docHeader, docRows);

console.log(`Wrote ${topicRows.length} topics → ${TOPICS_OUT}`);
console.log(`Wrote ${docRows.length} documents → ${DOCS_OUT}`);
