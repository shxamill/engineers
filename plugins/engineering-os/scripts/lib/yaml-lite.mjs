// Minimal YAML subset parser (zero dependencies) for the Engineering OS's own config files.
// Supports: nested maps, lists of maps/scalars, inline lists [a, "b c"], quoted strings, numbers,
// booleans, null, and `#` comments. Anything else throws, so config stays in a reviewable subset.

function scalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^".*"$/.test(s)) return JSON.parse(s);
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) throw new Error(`unterminated inline list: ${s}`);
    const body = s.slice(1, -1).trim();
    if (!body) return [];
    const items = [];
    let cur = '';
    let quote = null;
    for (const c of body) {
      if (quote) { cur += c; if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; cur += c; continue; }
      if (c === ',') { items.push(scalar(cur)); cur = ''; continue; }
      cur += c;
    }
    items.push(scalar(cur));
    return items;
  }
  if (s.startsWith('{')) throw new Error(`inline maps are not supported: ${s}`);
  return s;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

export function parseYaml(text) {
  const lines = [];
  text.split(/\r?\n/).forEach((raw, n) => {
    const line = stripComment(raw).replace(/\s+$/, '');
    if (!line.trim()) return;
    if (/\t/.test(line.match(/^\s*/)[0])) throw new Error(`line ${n + 1}: tabs are not allowed for indentation`);
    lines.push({ indent: line.match(/^ */)[0].length, text: line.trim(), n: n + 1 });
  });
  let i = 0;

  function block(indent) {
    if (i >= lines.length || lines[i].indent < indent) return null;
    return lines[i].text.startsWith('- ') || lines[i].text === '-' ? list(lines[i].indent) : map(lines[i].indent);
  }

  function keyValue(text, n) {
    const m = text.match(/^("[^"]*"|'[^']*'|[^:]+?):(\s+(.*))?$/);
    if (!m) throw new Error(`line ${n}: expected "key: value", got "${text}"`);
    return [String(scalar(m[1])), m[3]];
  }

  function map(indent) {
    const out = {};
    while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith('- ')) {
      const { text, n } = lines[i];
      const [k, v] = keyValue(text, n);
      i++;
      if (Object.hasOwn(out, k)) throw new Error(`line ${n}: duplicate key "${k}"`);
      out[k] = v === undefined || v === '' ? block(indent + 1) : scalar(v);
    }
    return out;
  }

  function list(indent) {
    const out = [];
    while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
      const { text, n } = lines[i];
      const rest = text.slice(1).trim();
      i++;
      if (!rest) { out.push(block(indent + 1)); continue; }
      if (/^("[^"]*"|'[^']*'|[^:[\]"']+?):(\s|$)/.test(rest)) {
        const itemIndent = indent + 2;
        const [k, v] = keyValue(rest, n);
        const item = { [k]: v === undefined || v === '' ? block(itemIndent + 1) : scalar(v) };
        if (i < lines.length && lines[i].indent === itemIndent && !lines[i].text.startsWith('- ')) Object.assign(item, map(itemIndent));
        out.push(item);
      } else out.push(scalar(rest));
    }
    return out;
  }

  const result = block(0);
  if (i < lines.length) throw new Error(`line ${lines[i].n}: unexpected indentation`);
  return result ?? {};
}
