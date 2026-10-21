import { canViewDesignPreview } from "./access";
import PreviewClient from "./preview-client";
import { getAuthenticatedUser } from "@/lib/data/queries";

export const metadata = {
  title: "Design preview",
};

export default async function DesignPreviewPage() {
  const user = await getAuthenticatedUser();
  if (!user || !canViewDesignPreview(user.email)) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-lg font-medium text-[var(--ts-ink-on-paper)]">Design preview</h1>
        <p className="mt-2 text-sm text-[var(--ts-ink-muted-on-paper)]">
          This page is for Taylslate admins.
        </p>
      </div>
    );
  }

  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html:
            'document.documentElement.dataset.designPreview="ink-gold";',
        }}
      />
      <PreviewClient />
    </>
  );
}
