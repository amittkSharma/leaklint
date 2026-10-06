const REGEX_ENTRY = /^\/(.+)\/([dimsuv]*)$/;

/** Config entries written as `/pattern/flags` are regular expressions; anything else is a plain name or glob. */
export function toRegExp(entry: string): RegExp | undefined {
  const match = REGEX_ENTRY.exec(entry);
  return match ? new RegExp(match[1], match[2]) : undefined;
}
