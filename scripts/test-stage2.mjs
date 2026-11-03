/**
 * Stage 2 browser test checklist (run after serving the folder).
 * Run: node scripts/test-stage2.mjs
 * Requires: npx serve running (default http://localhost:3000)
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", i = 0, inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.some((c) => c.trim())).map((cells) => {
    const o = {}; header.forEach((k, idx) => o[k] = cells[idx] ?? ""); return o;
  });
}

const topics = parseCsv(readFileSync(path.join(DATA, "topics.csv"), "utf8"));
const docs = parseCsv(readFileSync(path.join(DATA, "topic_documents.csv"), "utf8"));

let failures = 0;

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.text();
}

console.log("=== STAGE 2 TESTS ===\n");

try {
  const html = await fetchText(`${BASE}/`);
  if (!html.includes("topic-grid")) {
    console.log("✗ Homepage missing topic-grid");
    failures++;
  } else {
    console.log("✓ Homepage loads");
  }

  const js = await fetchText(`${BASE}/script.js`);
  if (!js.includes("showTopic")) {
    console.log("✗ script.js missing showTopic");
    failures++;
  } else {
    console.log("✓ script.js loads");
  }

  const topicsCsv = await fetchText(`${BASE}/data/topics.csv`);
  const docsCsv = await fetchText(`${BASE}/data/topic_documents.csv`);
  if (!topicsCsv.includes("justice")) { console.log("✗ topics.csv not served"); failures++; }
  else console.log("✓ topics.csv served");
  if (!docsCsv.includes("uri")) { console.log("✗ topic_documents.csv not served"); failures++; }
  else console.log("✓ topic_documents.csv served");

  for (const topic of topics) {
    const topicDocs = docs.filter((d) => d.topic === topic.topic);
    if (topicDocs.length !== Number(topic.total_publications)) {
      console.log(`✗ ${topic.topic}: doc count ${topicDocs.length} != ${topic.total_publications}`);
      failures++;
    }
    const broken = topicDocs.slice(0, 20).filter((d) => d.uri && !d.uri.startsWith("http"));
    if (broken.length) {
      console.log(`✗ ${topic.topic}: ${broken.length} invalid URIs`);
      failures++;
    }
  }
  console.log(`✓ All ${topics.length} topics have matching document counts`);

  for (const topic of topics) {
    const first = topic.first_year;
    const last = topic.last_year;
    if (Number(first) < 1709 || Number(first) > 1994) {
      console.log(`✗ ${topic.topic}: invalid first_year ${first}`);
      failures++;
    }
    if (Number(last) < 1709 || Number(last) > 1994) {
      console.log(`✗ ${topic.topic}: invalid last_year ${last}`);
      failures++;
    }
  }
  console.log("✓ All first_year / last_year within 1709–1994");

  console.log("  (Note: decade totals may sum below publication count when enriched rows lack a valid year.)");

} catch (err) {
  console.log("✗ Server not reachable:", err.message);
  console.log("  Start with: npx serve");
  failures++;
}

if (failures) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\n✓ All Stage 2 data tests passed.");
console.log("  Manually verify clicks in browser: every rectangle opens its topic page.");
