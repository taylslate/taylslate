// Validate a new-password submission. Returns an error message, or null when
// the input is acceptable. Kept pure so the branch logic is testable in
// isolation. Min length 8 matches the signup form and the Supabase dashboard.
export function validateNewPassword(
  password: string,
  confirm: string
): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password !== confirm) return "Passwords do not match.";
  return null;
}
