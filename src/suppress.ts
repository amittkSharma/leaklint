export type Directive = {
  /** 1-based line of the comment. */
  line: number;
  /** Rule ids to silence; empty means all rules. */
  rules: string[];
  reason?: string;
};

const DIRECTIVE = /\/\/\s*leaklint-disable-next-line\b([^\n]*)/;

/** Parses `// leaklint-disable-next-line [rule[, rule]] [-- reason]` comments. */
export function parseDirectives(text: string): Directive[] {
  const directives: Directive[] = [];
  text.split('\n').forEach((lineText, index) => {
    const match = DIRECTIVE.exec(lineText);
    if (!match) return;
    const [ruleList, ...reason] = match[1].split(/\s+--\s+/);
    const rules = ruleList
      .replace(/\s*--\s*$/, '')
      .split(',')
      .map((rule) => rule.trim())
      .filter(Boolean);
    directives.push({ line: index + 1, rules, reason: reason.join(' -- ').trim() || undefined });
  });
  return directives;
}
