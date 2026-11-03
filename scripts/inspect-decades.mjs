import fs from "fs";
import { parseCsv, validPublicationYear, yearToDecade, DECADE_COLUMNS } from "./lib-csv.mjs";

const rows = parseCsv(fs.readFileSync("data/british_official_publications_enriched.csv", "utf8"));

function assignDecade(row) {
  if (validPublicationYear(row.PublicationYear)) {
    return yearToDecade(row.PublicationYear);
  }
  if (DECADE_COLUMNS.includes(row.Decade)) {
    return row.Decade;
  }
  return "";
}

let unassigned = 0;
const byTheme = {};
for (const r of rows) {
  const d = assignDecade(r);
  if (!d) unassigned++;
  else {
    byTheme[r.Theme] = byTheme[r.Theme] || {};
    byTheme[r.Theme][d] = (byTheme[r.Theme][d] || 0) + 1;
  }
}
console.log("Unassigned after fix logic:", unassigned);
console.log("Total rows:", rows.length);
