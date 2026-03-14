// ============================================================
// REPHONIC API CLIENT (STUB)
// Rephonic provides podcast audience demographics, listener overlap,
// and similar-show recommendations.
// Docs: https://rephonic.com/api (requires enterprise API access)
//
// Expected API shape (based on public documentation):
//
// GET /podcasts/search?q=<query>
// → { results: [{ id, name, description, image_url, publisher, categories,
//      audience_size, demographics: { age, gender, income, education },
//      similar_podcasts: [{ id, name, overlap_score }] }] }
//
// GET /podcasts/:id
// → { id, name, description, image_url, publisher, categories,
//      audience_size, episode_count, frequency, avg_episode_length,
//      demographics: { age_ranges: {...}, gender: {...}, income: {...} },
//      listener_geography: { us, uk, canada, australia, ... },
//      similar_podcasts: [...], reach_score, apple_id, spotify_id }
//
// GET /podcasts/:id/audience
// → { demographics, interests, geography, overlap_podcasts }
//
// When API key is available, these methods will be implemented
// to fill Show.demographics, Show.audience_interests, and
// suggest similar shows for campaign recommendations.
// ============================================================

// ---- Types (expected from Rephonic API) ----

export interface RephonicPodcast {
  id: string;
  name: string;
  description?: string;
  image_url?: string;
  publisher?: string;
  categories?: string[];
  audience_size?: number;
  episode_count?: number;
  frequency?: string; // "weekly", "biweekly", etc.
  avg_episode_length?: number; // minutes
  reach_score?: number;
  apple_id?: string;
  spotify_id?: string;
  demographics?: RephonicDemographics;
  listener_geography?: Record<string, number>;
  similar_podcasts?: { id: string; name: string; overlap_score: number }[];
}

export interface RephonicDemographics {
  age_ranges?: Record<string, number>; // e.g., { "18-24": 0.12, "25-34": 0.35, ... }
  gender?: { male: number; female: number };
  income?: Record<string, number>;
  education?: Record<string, number>;
}

// ---- Client ----

export class RephonicClient {
  private apiKey: string | null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.REPHONIC_API_KEY ?? null;
  }

  /**
   * Search for podcasts by name or keyword.
   * Returns null until Rephonic API key is configured.
   */
  async searchPodcasts(_query: string): Promise<RephonicPodcast[] | null> {
    if (!this.apiKey) {
      console.log("Rephonic API key not configured");
      return null;
    }
    // TODO: Implement when API access is granted
    // GET /podcasts/search?q=<query>
    return null;
  }

  /**
   * Get full podcast details including demographics and listener overlap.
   * Returns null until Rephonic API key is configured.
   */
  async getPodcastDetails(_podcastId: string): Promise<RephonicPodcast | null> {
    if (!this.apiKey) {
      console.log("Rephonic API key not configured");
      return null;
    }
    // TODO: Implement when API access is granted
    // GET /podcasts/<podcastId>
    return null;
  }
}

// ---- Singleton ----

export function getRephonicClientSafe(): RephonicClient | null {
  if (!process.env.REPHONIC_API_KEY) {
    console.log("Rephonic API key not configured — skipping Rephonic enrichment");
    return null;
  }
  return new RephonicClient();
}
