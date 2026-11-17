// Literal show-name patterns for PostgREST ilike.
//
// PostgREST maps * to % inside like and ilike, and a backslash does
// not escape *. Every * is removed so a search cannot widen into a
// pattern. The search page and direct show search already escape \,
// %, and _. One escape pass is undone first so those callers are not
// escaped twice. A comma and a closing parenthesis stay literal. They
// are metacharacters only inside a PostgREST .or() filter string, and
// these patterns are passed to .ilike() only.

const SEARCH_MAX = 100;
const LIKE_ESCAPED = /\\([\\%_])/g;
const LIKE_SPECIAL = /[\\%_]/g;

export function escapeShowNameTerm(raw: string): string {
  const stripped = raw.trim().replace(/\*/g, "");
  if (!stripped) return "";
  const plain = stripped.replace(LIKE_ESCAPED, "$1").slice(0, SEARCH_MAX);
  return plain.replace(LIKE_SPECIAL, (char) => `\\${char}`);
}

export function showNameContainsPattern(raw: string): string {
  const term = escapeShowNameTerm(raw);
  if (!term) return "";
  return `%${term}%`;
}

export function showNameExactPattern(raw: string): string {
  return escapeShowNameTerm(raw);
}
