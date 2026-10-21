import { redirect } from "next/navigation";
import { safeLoginNext } from "@/lib/auth/login-magic";

// Old show-only code URL. Brands and shows both use /login now.
export default async function ShowLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  if (!raw) redirect("/login");
  const next = safeLoginNext(raw, "https://www.taylslate.com");
  redirect(`/login?next=${encodeURIComponent(next)}`);
}
