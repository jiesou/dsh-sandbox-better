/**
 * Keep the model's runtime context free of the deployment's directory list.
 *
 * `dsh-sandbox-policy` writes `Additional writable directories: [...]` into the
 * per-step policy line. That list is machine configuration, not a decision the
 * model has to make, and it repeats every step. The policy line itself
 * (mode + workspace) stays.
 */

const MARKER = ' Additional writable directories: '
const TAIL = ' Some platform temporary areas may also be writable.'

/**
 * Remove the additional-directories clause from one policy line.
 * @param text - the rendered `sandbox:policy` context.
 * @returns the line without the clause; unchanged when absent.
 */
export function stripAdditionalRoots(text: string): string {
  const start = text.indexOf(MARKER)
  if (start < 0) return text
  const end = text.indexOf(TAIL, start)
  if (end < 0) return text
  return `${text.slice(0, start)}${text.slice(end)}`
}
