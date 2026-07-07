import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getBrandProfileByUserId,
  getEffectiveRole,
  getShowProfileByUserId,
  getUserProfile,
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Role-less profile = user hasn't completed the (existing) role-selection
  // onboarding at /onboarding. Send them back there.
  const profile = await getUserProfile(user.id);
  if (!profile?.role) {
    redirect("/onboarding");
  }

  // Brand users need the Wave 8 brand onboarding before hitting the dashboard.
  if (profile.role === "brand") {
    const brandProfile = await getBrandProfileByUserId(user.id);
    if (!brandProfile?.onboarded_at) {
      redirect("/onboarding/brand");
    }
  }

  // Show/creator users need the Wave 9 show onboarding before hitting the dashboard.
  if (profile.role === "show") {
    const showProfile = await getShowProfileByUserId(user.id);
    if (!showProfile?.onboarded_at) {
      redirect("/onboarding/show");
    }
  }

  const eff = await getEffectiveRole(user.id);
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
    <div className="min-h-screen bg-[var(--brand-surface)]">
      <Sidebar
        role={effectiveRole}
        canSwitchTo={canSwitchTo}
        isAdmin={isAdmin}
        testAccounts={TEST_ACCOUNTS.map(({ key, label }) => ({ key, label }))}
      />
      <main className="ml-[240px] min-h-screen">
        {impersonating && (
          <div className="sticky top-0 z-40 flex items-center justify-center bg-[var(--brand-orange)] text-white text-sm font-medium px-6 py-2 text-center">
            <span>Impersonating {impersonating.label}</span>
            {canReturnToAdmin && <ReturnToAdminButton />}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
