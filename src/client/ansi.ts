// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape codes requires control chars
const ANSI_RE = /\x1b\[[0-9;]*m/g

/** Remove ANSI color/style escape sequences from a string. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}
