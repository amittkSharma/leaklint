const ENTITIES: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for use inside HTML or XML, in element content and in double- or single-quoted attributes. */
export const escapeMarkup = (text: string): string => text.replace(/[<>&"']/g, (char) => ENTITIES[char]);
