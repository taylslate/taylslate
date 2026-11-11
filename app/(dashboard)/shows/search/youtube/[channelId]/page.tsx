import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUser, getEffectiveRole } from "@/lib/data/queries";
import { isBrandSide } from "@/lib/nav/items";
import { getLibraryCreator } from "@/lib/youtube-library/brand-read";

function countLine(value: number | null, singular: string, plural: string): string {
  if (value == null) return `${plural} not listed`;
  const count = value.toLocaleString("en-US");
  return `${count} ${value === 1 ? singular : plural}`;
}

export default async function LibraryCreatorPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const eff = await getEffectiveRole(user.id);
  if (!eff) redirect("/onboarding");
  if (!isBrandSide(eff.effectiveRole)) redirect("/dashboard");

  const { channelId } = await params;
  const creator = await getLibraryCreator(channelId);
  if (!creator) notFound();

  const description = Array.from(creator.description).slice(0, 300).join("");
  const views =
    creator.averageViews == null
      ? "Views not listed"
      : `${creator.averageViews.toLocaleString("en-US")} ${creator.averageViewsLabel} views`;

  return (
    <div className="w-full p-4 sm:p-8">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]">
        YouTube
      </p>
      <div className="mt-4 flex items-start gap-4">
        {creator.thumbnailUrl ? (
          <img
            src={creator.thumbnailUrl}
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--ts-ink-on-paper)]">
            {creator.title.trim() || "YouTube creator"}
          </h1>
          <p className="mt-1 text-sm text-[var(--ts-ink-muted-on-paper)]">
            {creator.country ?? "Country not listed"}
          </p>
        </div>
      </div>

      <dl className="mt-6 space-y-2 text-sm text-[var(--ts-ink-on-paper)]">
        <div>
          <dt className="sr-only">Subscribers</dt>
          <dd>{countLine(creator.subscriberCount, "subscriber", "subscribers")}</dd>
        </div>
        <div>
          <dt className="sr-only">Videos</dt>
          <dd>{countLine(creator.videoCount, "video", "videos")}</dd>
        </div>
        <div>
          <dt className="sr-only">Average views</dt>
          <dd>{views}</dd>
        </div>
      </dl>

      {creator.nicheTags.length > 0 ? (
        <p className="mt-4 text-sm text-[var(--ts-ink-muted-on-paper)]">
          {creator.nicheTags.join(", ")}
        </p>
      ) : null}

      {description ? (
        <p className="mt-4 max-w-2xl whitespace-pre-wrap text-sm text-[var(--ts-ink-on-paper)]">
          {description}
        </p>
      ) : null}

      <a
        href={creator.youtubeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-block text-sm font-medium text-[var(--ts-ink-on-paper)] underline"
      >
        View on YouTube
      </a>
      <p className="mt-6 text-xs text-[var(--ts-ink-muted-on-paper)]">
        Channel data from YouTube
      </p>
    </div>
  );
}
