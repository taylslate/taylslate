// Demographics plus listener data. A 404 is empty data. The detail
// call is skipped when the search hit already has listener_engagement.

export function isNotFound(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { status?: unknown }).status === 404;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function listenerFromDetail(body: unknown): unknown | null {
  if (!isRecord(body)) return null;
  if (isRecord(body.listener_engagement)) return body.listener_engagement;
  if (isRecord(body.podcast) && isRecord(body.podcast.listener_engagement)) {
    return body.podcast.listener_engagement;
  }
  return null;
}

export function hasListener(value: unknown): boolean {
  return isRecord(value);
}

export async function enrichShow(
  podcastId: string,
  listenerOnSearch: unknown | null,
  get: (path: string) => Promise<unknown>
): Promise<{ demographics: unknown; listener: unknown }> {
  let demographics: unknown = null;
  try {
    demographics = await get(`/podcasts/${podcastId}/demographics`);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  if (hasListener(listenerOnSearch)) {
    return { demographics, listener: listenerOnSearch };
  }
  let listener: unknown = null;
  try {
    listener = listenerFromDetail(await get(`/podcasts/${podcastId}`));
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  return { demographics, listener };
}
