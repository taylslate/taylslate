import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getBrandProfileByUserId,
  getShowProfileByUserId,
  getUserProfile,
} from "@/lib/data/queries";
import Sidebar from "@/components/layout/Sidebar";

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

  return (
    <div className="min-h-screen bg-[var(--brand-surface)]">
      <Sidebar />
      <main className="ml-[240px] min-h-screen">{children}</main>
    </div>
  );
}
