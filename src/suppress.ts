export type Directive = { line: number; rules: string[]; reason?: string };

const RE = /\/\/\s*leaklint-disable-next-line\b([^\n]*)/;

/** `// leaklint-disable-next-line [rule[, rule]] [-- reason]`; `line` is the 1-based line of the comment. */
export function parseDirectives(text: string): Directive[] {
  const out: Directive[] = [];
  text.split('\n').forEach((l, i) => {
    const m = RE.exec(l);
    if (!m) return;
    const [head, ...rest] = m[1].split(/\s+--\s+/);
    const rules = head.replace(/\s*--\s*$/, '').split(',').map((r) => r.trim()).filter(Boolean);
    out.push({ line: i + 1, rules, reason: rest.join(' -- ').trim() || undefined });
  });
  return out;
}
