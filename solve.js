// Fast drop-in for csv-reader 1.0.0 (make.fun's reference program).
//
// Returns exactly csv-reader's answer {columns, rows, errors} for every input
// {text, header}, following its written broken-row policy byte for byte:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled; "" inside it is one quote; each CRLF or lone CR inside it is
//     read as LF; what follows the closing quote, up to the next comma or line
//     break, is appended as it stands (quote_junk, when the field ends); a
//     quote that never closes is a literal character and the text after it is
//     read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows are
//     padded (short_row, with fields) or cut (long_row, with extra) to the
//     first record's width;
//   - each error is {code, line, row} in the order met: line the 1-based line
//     its record starts on (every LF, CRLF and lone CR inside quotes counted),
//     row its record's index in rows, null for the header.
//
// Where the reference walks one character at a time and builds each field by
// concatenation behind a function call per field, this reader keeps the hot
// unquoted scan inline in the record loop: a tight charCodeAt walk that cuts
// each field out with a single slice, building a parts array only for the
// rare field that contains a stray CR. Quoted fields (the minority) go
// through a helper that finds segment boundaries with V8's native indexOf
// scans; a monotone cache of the next CR position keeps every CR search a
// single forward pass over the text, whatever the file's mix of LF and CRLF.

const COMMA_END = 0;
const BREAK_END = 1;
const TEXT_END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n !== 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read, set by the scanners.
  let fVal = '';
  let fEnded = TEXT_END;

  // Monotone cache for CR searches: crNext is the first CR at or after
  // crBase (or -1). Queries only move forward, except the unterminated-quote
  // restart, which simply fails the crBase <= p test and recomputes.
  let crBase = 0;
  let crNext = -1;
  let crValid = false;
  function findCR(p) {
    if (crValid && crBase <= p && (crNext === -1 || crNext >= p)) return crNext;
    crNext = text.indexOf('\r', p);
    crBase = p;
    crValid = true;
    return crNext;
  }

  // Reads unquoted characters from pos onto `prefix` up to the next comma or
  // line break: a CR not followed by LF is dropped (stray_cr). Sets fVal and
  // fEnded; returns how many characters were kept from the text. Used for the
  // two rare continuations (quote junk, unterminated quote); the plain
  // unquoted field is scanned inline in the record loop below.
  function scanUnquoted(prefix) {
    let parts = null;
    let segStart = pos;
    let added = 0;
    let i = pos;
    while (true) {
      let a = text.indexOf(',', i);
      if (a === -1) a = n;
      let b = text.indexOf('\n', i);
      if (b === -1) b = n;
      const end = a < b ? a : b;
      const cr = findCR(i);
      if (cr !== -1 && cr < end) {
        if (text.charCodeAt(cr + 1) === 10) {
          // CRLF ends the field; its content stops at the CR.
          if (parts !== null) {
            parts.push(text.slice(segStart, cr));
            fVal = parts.join('');
          } else {
            fVal = prefix + text.slice(segStart, cr);
          }
          added += cr - segStart;
          pos = cr + 2;
          line += 1;
          fEnded = BREAK_END;
          return added;
        }
        // A lone CR is dropped (stray_cr); the field goes on without it.
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (parts === null) parts = [prefix, text.slice(segStart, cr)];
        else parts.push(text.slice(segStart, cr));
        added += cr - segStart;
        i = cr + 1;
        segStart = i;
        continue;
      }
      if (parts !== null) {
        parts.push(text.slice(segStart, end));
        fVal = parts.join('');
      } else {
        fVal = prefix + text.slice(segStart, end);
      }
      added += end - segStart;
      if (end === n) {
        pos = n;
        fEnded = TEXT_END;
      } else if (a === end) {
        pos = end + 1;
        fEnded = COMMA_END;
      } else {
        pos = end + 1;
        line += 1;
        fEnded = BREAK_END;
      }
      return added;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fVal and fEnded.
  function scanQuoted() {
    const open = pos;
    const openLine = line;
    let parts = null;
    let segStart = open + 1;
    let i = segStart;
    while (true) {
      const q = text.indexOf('"', i);
      if (q === -1) break; // no closing quote: handled below
      // Account for the segment [segStart, q): LFs count as lines and stay;
      // each CRLF or lone CR becomes one LF in the value and counts once.
      let p = segStart;
      while (true) {
        const cr = findCR(p);
        if (cr === -1 || cr >= q) {
          let lf = text.indexOf('\n', p);
          while (lf !== -1 && lf < q) {
            line += 1;
            lf = text.indexOf('\n', lf + 1);
          }
          if (parts !== null) parts.push(text.slice(p, q));
          break;
        }
        let lf = text.indexOf('\n', p);
        while (lf !== -1 && lf < cr) {
          line += 1;
          lf = text.indexOf('\n', lf + 1);
        }
        if (parts === null) parts = [text.slice(segStart, cr), '\n'];
        else {
          parts.push(text.slice(p, cr));
          parts.push('\n');
        }
        line += 1;
        p = cr + (text.charCodeAt(cr + 1) === 10 ? 2 : 1);
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one quote in the value.
        if (parts === null) parts = [text.slice(segStart, q), '"'];
        else parts.push('"');
        i = q + 2;
        segStart = i;
        continue;
      }
      // The closing quote.
      let value;
      if (parts === null) {
        value = text.slice(segStart, q);
      } else {
        value = parts.join('');
      }
      pos = q + 1;
      if (pos >= n) {
        fVal = value;
        fEnded = TEXT_END;
        return;
      }
      const d = text.charCodeAt(pos);
      if (d === 44) {
        pos += 1;
        fVal = value;
        fEnded = COMMA_END;
        return;
      }
      if (d === 10) {
        pos += 1;
        line += 1;
        fVal = value;
        fEnded = BREAK_END;
        return;
      }
      if (d === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fVal = value;
        fEnded = BREAK_END;
        return;
      }
      // What follows the closing quote is appended as it stands.
      const added = scanUnquoted(value);
      if (added > 0) {
        errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      }
      return;
    }
    // The quote never closes: it is a literal character, and the text after
    // it is read again as unquoted.
    pos = open + 1;
    line = openLine;
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    scanUnquoted('"');
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        scanQuoted();
      } else {
        quoted = false;
        // Inline unquoted scan: walk to the next comma or line break,
        // dropping any lone CR on the way (stray_cr).
        let segStart = pos;
        let i = pos;
        let parts = null;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === 44) {
            if (parts !== null) {
              parts.push(text.slice(segStart, i));
              fVal = parts.join('');
            } else {
              fVal = text.slice(segStart, i);
            }
            pos = i + 1;
            fEnded = COMMA_END;
            break;
          }
          if (c <= 13) {
            if (c === 10) {
              if (parts !== null) {
                parts.push(text.slice(segStart, i));
                fVal = parts.join('');
              } else {
                fVal = text.slice(segStart, i);
              }
              pos = i + 1;
              line += 1;
              fEnded = BREAK_END;
              break;
            }
            if (c === 13) {
            if (text.charCodeAt(i + 1) === 10) {
              if (parts !== null) {
                parts.push(text.slice(segStart, i));
                fVal = parts.join('');
              } else {
                fVal = text.slice(segStart, i);
              }
              pos = i + 2;
              line += 1;
              fEnded = BREAK_END;
              break;
            }
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              if (parts === null) parts = [text.slice(segStart, i)];
              else parts.push(text.slice(segStart, i));
              i += 1;
              segStart = i;
              continue;
            }
          }
          i += 1;
        }
        if (i >= n) {
          if (parts !== null) {
            parts.push(text.slice(segStart, n));
            fVal = parts.join('');
          } else {
            fVal = text.slice(segStart, n);
          }
          pos = n;
          fEnded = TEXT_END;
        }
      }
      fields.push(fVal);
    } while (fEnded === COMMA_END);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({
        code: 'short_row',
        line: recordLine,
        row: recordRow,
        fields: fields.length,
      });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({
        code: 'long_row',
        line: recordLine,
        row: recordRow,
        extra: fields.splice(width),
      });
    }
    rows.push(fields);
  }
  return { columns: header ? columns ?? [] : null, rows, errors };
}
