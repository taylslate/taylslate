import { isInternalAdmin } from "@/lib/auth/admin";

export function canViewDesignPreview(email: string | null | undefined): boolean {
  return isInternalAdmin(email);
}
