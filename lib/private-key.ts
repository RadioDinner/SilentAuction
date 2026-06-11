/**
 * Normalize a service-account private key as pasted into an environment
 * variable. Handles the two most common mistakes that cause Node's
 * "DECODER routines::unsupported" error on Vercel:
 *   1. surrounding quotes copied from a .env example into the Vercel UI, and
 *   2. escaped newlines (\n, \r\n, or double-escaped \\n) instead of real ones.
 */
export function normalizePrivateKey(raw: string | undefined): string {
  let k = (raw ?? "").trim();

  // Strip wrapping quotes (possibly more than one layer).
  while (
    k.length >= 2 &&
    ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'")))
  ) {
    k = k.slice(1, -1).trim();
  }

  // Convert escaped newlines to real ones (double-escaped first).
  k = k.replace(/\\\\n/g, "\n").replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");

  // PEM keys conventionally end with a newline; the trim above may have removed it.
  if (k && !k.endsWith("\n")) k += "\n";

  return k;
}
