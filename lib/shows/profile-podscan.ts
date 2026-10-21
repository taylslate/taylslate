// show_profiles.podscan_id is a self-reported label. Catalog ties are a
// deal (deals.show_profile_id) or the show_owner row whose contact email
// matches the profile owner. Callers that build a profile patch from a
// client or from a URL lookup drop the id here so it is not saved.

export const SHOW_PROFILE_PODSCAN_ID_LABEL =
  "Self-reported Podscan id. Display only. Catalog ties are a deal or a show_owner email match.";

export function omitClientPodscanId<T extends object>(
  value: T
): Omit<T, "podscan_id"> {
  const copy = { ...value } as T & { podscan_id?: unknown };
  delete copy.podscan_id;
  return copy;
}

/** Fields the onboarding welcome step saves from a Podscan URL lookup. */
export function profilePatchFromLookup(podcast: {
  show_name: string;
  show_description: string | null;
  show_image_url: string | null;
  show_categories: string[];
  episode_count: number | null;
  audience_size: number | null;
  podscan_id?: string | null;
  podscan_id_label?: string;
}): {
  show_name: string;
  show_description: string | null;
  show_image_url: string | null;
  show_categories: string[];
  episode_count: number | null;
  audience_size: number | null;
} {
  return {
    show_name: podcast.show_name,
    show_description: podcast.show_description,
    show_image_url: podcast.show_image_url,
    show_categories: podcast.show_categories,
    episode_count: podcast.episode_count,
    audience_size: podcast.audience_size,
  };
}
