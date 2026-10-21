import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getAuthenticatedUser,
  getEffectiveRole,
  loadProfileBundle,
} from "@/lib/data/queries";
import Sidebar from "@/components/layout/Sidebar";
import ReturnToAdminButton from "@/components/admin/ReturnToAdminButton";
import { isInternalAdmin } from "@/lib/auth/admin";
import { TEST_ACCOUNTS } from "@/lib/admin/test-accounts";
import { RETURN_TOKEN_COOKIE } from "@/lib/admin/return-token";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/login");
  }

  // Profile, brand row, show row, and the view-as cookie resolve together.
  // getEffectiveRole reads the same three rows; the request cache collapses them.
  const [{ profile, brandProfile, showProfile }, eff] = await Promise.all([
    loadProfileBundle(user.id),
    getEffectiveRole(user.id),
  ]);

  // Role-less profile = user hasn't completed the (existing) role-selection
  // onboarding at /onboarding. Send them back there.
  if (!profile?.role) {
    redirect("/onboarding");
  }

  // Brand users need the Wave 8 brand onboarding before hitting the dashboard.
  if (profile.role === "brand" && !brandProfile?.onboarded_at) {
    redirect("/onboarding/brand");
  }

  // Show/creator users need the Wave 9 show onboarding before hitting the dashboard.
  if (profile.role === "show" && !showProfile?.onboarded_at) {
    redirect("/onboarding/show");
  }
  if (eff?.staleViewAs) {
    redirect("/api/view-mode/clear?next=/dashboard");
  }
  const effectiveRole = eff?.effectiveRole ?? profile.role;
  const canSwitchTo = eff?.canSwitchTo ?? null;

  // Founder-only test-login controls + impersonation banner. The impersonation
  // check is intentionally simple: is the current session one of the fixed test
  // accounts? Layer 3 adds return-to-admin — offered only when a return token
  // cookie is present (i.e. this session was reached via impersonation, not by
  // logging into the test account directly). The httpOnly cookie is readable
  // here in the server component; its mere presence gates the button — the
  // redeem endpoint re-validates the token itself.
  const isAdmin = isInternalAdmin(user.email);
  const impersonating = TEST_ACCOUNTS.find(
    (a) => a.email.toLowerCase() === user.email?.toLowerCase()
  );
  const cookieStore = await cookies();
  const canReturnToAdmin = Boolean(cookieStore.get(RETURN_TOKEN_COOKIE)?.value);

  return (
    <div className="brand-app min-h-screen bg-[var(--ts-paper)] text-[var(--ts-ink-on-paper)]">
      <Sidebar
        role={effectiveRole}
        canSwitchTo={canSwitchTo}
        isAdmin={isAdmin}
        displayName={profile.full_name?.trim() || profile.company_name?.trim() || profile.email}
        testAccounts={TEST_ACCOUNTS.map(({ key, label }) => ({ key, label }))}
      />
      <main className="ml-[240px] min-h-screen">
        {impersonating && (
          <div className="sticky top-0 z-40 flex items-center justify-center bg-[var(--ts-field)] px-6 py-2 text-center text-sm font-medium text-[var(--ts-ink)]">
            <span>Impersonating {impersonating.label}</span>
            {canReturnToAdmin && <ReturnToAdminButton />}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
