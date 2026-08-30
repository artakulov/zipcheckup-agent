// Minimal RFC4180 reader. Deliberately NOT split(',').
// 2,158 rows of the ZipCheckup zip-summary CSV carry quoted fields with embedded
// commas; a naive split shifts every later column and silently produces wrong
// health data (e.g. home_safety_grade: 59). See docs/DATA.md.

/**
 * Parse RFC4180 CSV text into { header, rows } where each row is an array of strings.
 * Handles quoted fields, doubled quotes ("" -> "), CRLF and LF line endings.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
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
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
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

  const header = rows.shift() ?? [];
  return { header, rows };
}

/** Turn a parsed row array into an object keyed by header, dropping empty cells entirely.
 *  Empty is NEVER coerced to 0/false/"none" - absence is not zero. */
export function rowToObject(header, row) {
  const out = {};
  for (let c = 0; c < header.length; c += 1) {
    const value = (row[c] ?? '').trim();
    if (value !== '') out[header[c]] = value;
  }
  return out;
}
