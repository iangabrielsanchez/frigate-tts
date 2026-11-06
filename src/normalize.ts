// Cache identity only; the text sent to Piper is untouched. Casing and extra
// whitespace don't change how a message sounds.
export function cacheText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
