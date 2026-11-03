export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  return rows
    .filter((r) => r.some((cell) => cell.trim() !== ""))
    .map((cells) => {
      const obj = {};
      header.forEach((key, idx) => {
        obj[key] = cells[idx] ?? "";
      });
      return obj;
    });
}

export function validPublicationYear(year, min = 1709, max = 1994) {
  const y = parseInt(year, 10);
  return !Number.isNaN(y) && y >= min && y <= max;
}

export function yearToDecade(year) {
  const y = parseInt(year, 10);
  if (Number.isNaN(y)) return "";
  const decadeStart = Math.floor(y / 10) * 10;
  return `${decadeStart}s`;
}

export const DECADE_COLUMNS = [];
for (let y = 1700; y <= 1990; y += 10) {
  DECADE_COLUMNS.push(`${y}s`);
}
