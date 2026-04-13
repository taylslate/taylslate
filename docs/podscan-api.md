# Podscan.fm (v1.0.0)


> **Note:** The previous version of the REST API documentation is still available at [podscan.fm/docs/api](https://podscan.fm/docs/api).

# Podscan REST API Documentation
The Podscan API is a RESTful API that allows you to access the Podscan platform. The API is designed to be easy to use and to have predictable, resource-oriented URLs. The API uses standard HTTP response codes and verbs, and authenticates using standard HTTP Basic Authentication.

You'll find a tutorial video on how to use the API here: [![https://www.youtube.com/watch?v=fSdDGp4R7eM](https://i.ytimg.com/vi/fSdDGp4R7eM/maxresdefault.jpg)](https://www.youtube.com/embed/fSdDGp4R7eM)

## Authentication
The Podscan API uses standard API key authentication. You will need to provide your API key in the `Authorization` header as a `Bearer` token. You can find your [API key in the Podscan dashboard](https://podscan.fm/user/api-tokens).

## Team
You will find your team's ID in the Podscan dashboard, in the Team dropdown menu. You will need this ID to access your team's alerts and mentions.

## Rate Limiting
The Podscan API is rate limited. If you exceed the limit, you will receive a 429 Too Many Requests response. If we detect abuse, we will block your access to the API.
Here are the rate limits for the Podscan API:
- **Trial**: 100 requests per day, 10 requests per minute, 5 concurrent
- **Essential Plan**: 1000 requests per day, 60 requests per minute, 5 concurrent
- **Premium Plan**: 2000 requests per day, 120 requests per minute, 10 concurrent
- **Professional Plan**: 5000 requests per day, 120 requests per minute, 15 concurrent
- **Advanced Plan**: 10,000 requests per day, 120 requests per minute, 20 concurrent
- Advanced plan owners can request custom rate limits with [metered pricing](https://www.notion.so/Podscan-REST-API-Metered-Pricing-1ae6eb10281980ff8bd2f963e2b03411).

## Concurrency Limiting
The API also limits the number of simultaneous requests you can have in-flight at any given time. If you exceed the concurrency limit, you will receive a 429 Too Many Requests response with `error: concurrency_limit_exceeded`. The response will include `X-Concurrency-Limit` and `Retry-After` headers.

## Restricted Fields
Depending on your plan, we may restrict access to certain fields. These fields usually contain sensitive information, such as email addresses, phone numbers, and podcast-specific audience data, and are only made available on the API for the following plans:
- **Trial**: No restrictions
- **Essential Plan**:
    - Restricted on podcasts: `email`, `itunes_id`, `spotify_id`, `predicted_audience_size`, `itunes_rating_count`, `itunes_rating`, `spotify_rating_count`, `spotify_rating`
- **Premium Plan**: No restrictions
- **Advanced Plan**: No restrictions

Every request to the API will return the following headers:
- `X-RateLimit-Limit`: The maximum number of requests that the consumer is permitted to make in a 60-minute period.
- `X-RateLimit-Remaining`: The number of requests remaining in the current rate limit window.

## Errors
The Podscan API uses standard HTTP response codes to indicate the success or failure of an API request. In general, codes in the 2xx range indicate success, codes in the 4xx range indicate an error that failed given the information provided (e.g., a required parameter was omitted, a charge failed, etc.), and codes in the 5xx range indicate an error with Podscan's servers.

## Pagination
Requests that return multiple items will be paginated by default. You can specify further pages with the `page` parameter. For some resources, you can also set a custom page size with the `per_page` parameter.

## Final Notes
The Podscan API is a work in progress. We will be adding more endpoints and features in the future. If you have any questions or need help, please contact us at [service@podscan.fm](mailto:service@podscan.fm).


## Base URL

- `https://podscan.fm/api/v1`

## Podcasts

### `GET /podcasts/{podcast}`

**Show a single podcast**

In the response, you will find a `reach` object with the following fields:
 - `itunes` with the following fields:
   - `itunes_rating_average` with the average rating
   - `itunes_rating_count` with the number of ratings
   - `itunes_rating_count_bracket` with the bracket of the number of ratings
 - `spotify` with the following fields:
   - `spotify_rating_average` with the average rating
   - `spotify_rating_count` with the number of ratings
   - `spotify_rating_count_bracket` with the bracket of the number of ratings
 - `audience_size` with the estimated audience size per episode
 - `social_links` with an array of social links with the following fields:
   - `platform` with the platform name
   - `url` with the URL
 - `email` with the email address
 - `website` with the website URL

 Some fields are only available for Premium and Enterprise plans (and trials):
 - `email`
 - `itunes_rating_count`
 - `itunes_rating_average`
 - `spotify_rating_count`
 - `spotify_rating_average`
 - `audience_size`

 All other `reach` fields are available for all plans and trial users.

## Listener Engagement Data

The response includes a `listener_engagement` object with measured engagement metrics.
This is a premium add-on — purchase it from the [Add-ons page](https://podscan.fm/addons).
When not enabled, `listener_engagement` is `null`.

| Field | Type | Description |
|-------|------|-------------|
| `total_listeners` | integer | Total unique listeners across all episodes |
| `total_sessions` | integer | Total listening sessions across all episodes |
| `episode_count` | integer | Number of episodes with engagement data |
| `avg_completion_ratio` | float | Average ratio of episode completed (0-1) |
| `avg_engagement_ratio` | float | Average engagement ratio (0-1) |
| `avg_play_seconds` | integer | Average listen duration in seconds |
| `avg_completion_rate` | float | Average completion rate (0-1) |
| `avg_ad_engagement_rate` | float | Average ad engagement rate (0-1, higher = fewer skips) |
| `avg_skips_per_session` | float | Average number of skips per session |
| `avg_pre_roll_ad_engagement_rate` | float | Avg pre-roll ad engagement (0-1) |
| `avg_mid_roll_ad_engagement_rate` | float | Avg mid-roll ad engagement (0-1) |
| `avg_post_roll_ad_engagement_rate` | float | Avg post-roll ad engagement (0-1) |
| `placement_details` | object\|null | Aggregated per-placement reach/engagement breakdown (see below) |
| `country_breakdown` | object | Listener counts by country code |
| `state_breakdown` | object | Region counts grouped by country code, e.g. {"US": {"CA": 45}} |
| `data_start` | string | Start date of data range (YYYY-MM-DD) |
| `data_end` | string | End date of data range (YYYY-MM-DD) |

### Placement Details

The `placement_details` object contains per-placement (pre_roll, mid_roll, post_roll) breakdown:

| Field | Type | Description |
|-------|------|-------------|
| `sessions_reached` | integer | Total sessions that reached this placement |
| `sessions_engaged` | integer | Total sessions that engaged (reached minus skipped) |
| `sessions_skipped` | integer | Total sessions that skipped this placement |
| `reach_rate` | float\|null | Ratio of sessions that reached this placement (0-1) |
| `engagement_rate` | float\|null | Ratio of reached sessions that engaged (0-1) |
| `threshold_seconds` | integer\|null | Threshold in seconds for this placement |
| `episode_duration_seconds` | integer\|null | Episode duration in seconds |

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes | The ID of the podcast |

**Responses:**

- `200`: The podcast object
- `401`: 

---

### `GET /podcasts/rankings`

**Get ranked podcasts by PRS score**

Retrieve podcasts ranked by their Podscan Reach Score (PRS), a 0-100 metric indicating
the potential reach and influence of a podcast based on ratings, reviews, and audience size.

Use these query parameters:
- `min_score` (optional): Minimum PRS score to include in results. Default is 0, maximum is 100.
- `max_score` (optional): Maximum PRS score to include in results. Default is 100, maximum is 100.
- `order` (optional): Sort order for results. Use 'desc' for highest scores first (default),
  or 'asc' for lowest scores first.
- `limit` (optional): Maximum number of podcasts to return. Default is 250, maximum is 1000.
- `format` (optional): Response format. Use 'json' (default) for JSON response, or 'csv'
  for CSV file download. CSV exports are rate-limited to 10 per hour per user.

The endpoint returns:
- `podcasts`: Array of podcast objects with ID, name, URL, PRS score, image, episode count,
  last episode date, and dashboard URL
- `count`: Number of podcasts returned in this response
- `filters`: The filter parameters that were applied to the query
- `statistics`: Global PRS distribution statistics including total count, average score,
  minimum score, and maximum score across all podcasts in the database

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `min_score` | query | integer | No |  |
| `max_score` | query | integer | No |  |
| `order` | query | string | No |  |
| `limit` | query | integer | No |  |
| `format` | query | string | No |  |

**Responses:**

- `200`: 
- `429`: 
- `400`: 
- `422`: 
- `401`: 

---

### `GET /podcasts/{podcast}/episodes`

**List all episodes for a podcast**

Use these query parameters to filter the results:
- `show_only_fully_processed` is a boolean string to show only fully processed episodes (with metadata and a fully processed transcript), values are 'true' or 'false' (default: false)
- `show_full_podcast` is a boolean string to show the full podcast information (instead of just ID, name, and website), values are 'true' or 'false' (default: false)
- `word_level_timestamps` is a boolean string to show word-level timestamps in the transcript, values are 'true' or 'false' (default: false)
     - a boolean, values are `true` or `false`, defaults to `false`
     - populates `episode_transcript_word_level_timestamps`, which can be `false` or an object that contains a JSON object with start and end timings for each phrase, the words within, including avg_logprob confidence scores, no-speech scores, and compression ratio
     - ⚠️ This will increase the size of the response significantly
- `per_page` is the number of results per page (default: 25, max: 250)
- `order_by` is the field to order by (allowed values: `posted_at`, `created_at`, `title`, `podcast_rating`)
- `order_dir` is the direction to order (`asc` or `desc`)
- `before` is the date to get episodes before (defaults to now), like "2024-07-03 15:44:25"
- `since` is the date to get episodes since (defaults to 1 year ago), like "2023-07-03 15:44:25"
- `has_guests` is a boolean to filter episodes with guests (`true`/`false`)
- `has_sponsors` is a boolean to filter episodes with sponsors (`true`/`false`)
- `title_contains` is a string to filter episodes where the title contains this substring (case-insensitive)
- `title_excludes` is a string to filter episodes where the title does NOT contain this substring (case-insensitive)
- `remove_timestamps` is a boolean string to remove timestamps from the transcript, values are 'true' or 'false' (default: false)
- `remove_speaker_labels` is a boolean string to remove speaker labels from the transcript, values are 'true' or 'false' (default: false)
- `transcript_formatter` is the formatter to use for the transcript text. Currently supported values:
   - `paragraph`: Groups consecutive lines from the same speaker into paragraphs
   - If not specified, returns the transcript in its original format
- `exclude_transcript` is a boolean string to exclude the transcript from the response, values are 'true' or 'false' (default: false)
     - ⚠️ **Performance optimization**: When set to 'true', the transcript is not loaded from the database at all, significantly improving response times
     - Note: When excluded, `episode_word_count` will be 0 since it's calculated from the transcript

*⚠️ The `metadata` field contains AI-extracted information and may not be accurate. The structure of this field might change over time as new fields are added.**

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes | The ID of the podcast |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /podcasts/{podcast}/latest/episode`

**Get the latest episode of a podcast**

Returns the most recent episode for the specified podcast.
Results are cached for 30 seconds to improve performance.

Use these query parameters to customize the response:
 - `show_full_podcast` is a boolean string to show the full podcast information (default: false)
 - `word_level_timestamps` is a boolean string to show word-level timestamps in the transcript (default: false)
 - `remove_timestamps` is a boolean string to remove timestamps from the transcript (default: false)
 - `remove_speaker_labels` is a boolean string to remove speaker labels from the transcript (default: false)
 - `transcript_formatter` is the formatter to use for the transcript text (e.g., 'paragraph')
 - `exclude_transcript` is a boolean string to exclude the transcript from the response (default: false)

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes |  |

**Responses:**

- `200`: 
- `404`: 
- `401`: 

---

### `GET /podcasts/{podcast}/latest/guest`

**Get the latest episode's guests**

Returns the guests from the most recent episode that has guests for the specified podcast.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes |  |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /podcasts/{podcast}/latest/sponsor`

**Get the latest episode's sponsors**

Returns the sponsors from the most recent episode that has sponsors for the specified podcast.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes |  |

**Responses:**

- `200`: 
- `401`: 

---

## Podcast Search

### `GET /podcasts/search`

**Search for podcasts**

Full-text search for podcasts

Use these query parameters to filter the results:
- `query` is the search query. For direct matches, use `"` to search for an exact phrase, like `"true crime"`.
     * - `category_ids` is the category IDs to filter by as a comma-separated list
     * - `per_page` is the number of results per page (default: 5, max: 50)
     * - `order_by` is the field to order by (allowed values: `best_match`, `name`, `created_at`, `episode_count`, `rating`, `audience_size`, `last_posted_at`)
     * - `order_dir` is the direction to order (`asc` or `desc`)
     * - `search_fields` is the fields to search in (allowed values: `name`, `description`, `website`, `publisher_name`, and any combination of those as a comma-separated list)
     * - `language` is the language code to filter by (e.g., `en`, `es`, `fr`)
     * - `region` is the region/location code to filter by (e.g., `US`, `GB`, `FR`)
     * - `min_audience_size` is the minimum audience size to filter by
     * - `max_audience_size` is the maximum audience size to filter by
     * - `min_episode_count` is the minimum number of episodes to filter by
     * - `max_episode_count` is the maximum number of episodes to filter by
     *  - `min_last_episode_posted_at` is the minimum date the most recent episode was posted (e.g., `2023-01-01`)
     *  - `max_last_episode_posted_at` is the maximum date the most recent episode was posted (e.g., `2023-12-31`)
     * - `has_guests` is a boolean to filter podcasts with interviews (`true`/`false`)
     * - `has_sponsors` is a boolean to filter podcasts with sponsors (`true`/`false`)
     *
     * ## Advanced Search Techniques
     *
     * For the complete syntax reference including all operators, proximity search, validation error codes, and example queries, see the **Search Query Syntax** section in the API docs sidebar.
     *
     * ### Basic Search
     * Simply enter one or more words to search for podcasts containing any of those words:
     * - `podcast marketing` - finds podcasts mentioning either "podcast" or "marketing" or both
     *
     * ### Exact Phrase Search
     * Use quotation marks to search for an exact phrase:
     * - `"podcast marketing"` - finds only podcasts with the exact phrase "podcast marketing"
     *
     * ### Wildcard Search
     * Use asterisk (*) as a wildcard to replace 0 to n words within phrases:
     * - `"digital * marketing"` - finds phrases like "digital content marketing", "digital inbound marketing"
     * - `"it took * hours to find"` - finds phrases where words appear between "it took" and "hours to find"
     * - `"it * us * get there"` - finds phrases with multiple word placeholders between specified words
     *
     * ### Boolean Operators
     * Use Boolean operators to create complex searches:
     * - `podcast AND marketing` - finds podcasts that contain both "podcast" and "marketing"
     * - `podcast OR webinar` - finds podcasts that contain either "podcast" or "webinar"
     * - `podcast NOT beginner` - finds podcasts about podcasts that don't mention "beginner"
     *
     * ### Complex Queries
     * Combine techniques for more precise searches:
     * - `"podcast marketing" AND (strategy OR tips)` - finds podcasts with exact phrase "podcast marketing" that also include either "strategy" or "tips"
     * - `(advertising OR monetization) NOT "social media"` - finds podcasts about advertising or monetization that don't mention "social media"
     * - `"warning * for clean boss" AND sleep` - finds podcasts with phrase containing "warning" followed by any words and then "for clean boss", that also includes "sleep"

**Note:** Search is not case sensitive. Wildcard (*) can be used as a placeholder for 0 to n words within phrases and combined with boolean operators for powerful, flexible searches.

In the response, you will find a `reach` object with the following fields:
- `itunes` with the following fields:
  - `itunes_rating_average` with the average rating
  - `itunes_rating_count` with the number of ratings (this is what the `rating` order_by field is based on). This field is only available for Premium and Enterprise plans (and trials)
  - `itunes_rating_count_bracket` with the bracket of the number of ratings
- `spotify` with an array of social links with the following fields:
  - `spotify_rating_average` with the average rating
  - `spotify_rating_count` with the number of ratings
  - `spotify_rating_count_bracket` with the bracket of the number of ratings
- `audience_size` with the estimated audience size per episode
- `social_links` with an array of social links with the following fields:
  - `platform` with the platform name
  - `url` with the URL
- `email` with the email address
- `website` with the website URL

Some fields are only available for Premium and Enterprise plans (and trials):
- `email`
- `itunes_rating_count`
- `itunes_rating_average`

All other `reach` fields are available for all plans and trial users.

**Responses:**

- `400`: 
- `200`: 
- `401`: 

---

### `GET /podcasts/search/by/itunesid`

**Search for a podcast by iTunesID**

Search for a podcast by its iTunes ID

Use the `itunes_id` parameter to specify the [iTunes ID of the podcast](https://help.podigee.com/article/406-how-to-find-the-apple-podcasts-id-of-my-podcast).

In the response, you will find a `reach` object with the following fields:
- `itunes` with the following fields:
  - `itunes_rating_average` with the average rating
  - `itunes_rating_count` with the number of ratings (this is what the `rating` order_by field is based on). This field is only available for Premium and Enterprise plans (and trials)
  - `itunes_rating_count_bracket` with the bracket of the number of ratings
- `spotify` with the following fields:
  - `spotify_rating_average` with the average rating
  - `spotify_rating_count` with the number of ratings
  - `spotify_rating_count_bracket` with the bracket of the number of ratings
- `audience_size` with the estimated audience size per episode
- `social_links` with an array of social links with the following fields:
- `platform` with the platform name
- `url` with the URL
- `email` with the email address
- `website` with the website URL

Some fields are only available for Premium and Enterprise plans (and trials):
- `email`
- `itunes_rating_count`
- `itunes_rating_average`
- `spotify_rating_count`
- `spotify_rating_average`
- `audience_size`

All other `reach` fields are available for all plans and trial users.

**Responses:**

- `200`: 
- `404`: 
- `400`: 
- `401`: 

---

### `GET /podcasts/search/by/iTunesID`

**Search for a podcast by iTunesID**

Search for a podcast by its iTunes ID

Use the `itunes_id` parameter to specify the [iTunes ID of the podcast](https://help.podigee.com/article/406-how-to-find-the-apple-podcasts-id-of-my-podcast).

In the response, you will find a `reach` object with the following fields:
- `itunes` with the following fields:
  - `itunes_rating_average` with the average rating
  - `itunes_rating_count` with the number of ratings (this is what the `rating` order_by field is based on). This field is only available for Premium and Enterprise plans (and trials)
  - `itunes_rating_count_bracket` with the bracket of the number of ratings
- `spotify` with the following fields:
  - `spotify_rating_average` with the average rating
  - `spotify_rating_count` with the number of ratings
  - `spotify_rating_count_bracket` with the bracket of the number of ratings
- `audience_size` with the estimated audience size per episode
- `social_links` with an array of social links with the following fields:
- `platform` with the platform name
- `url` with the URL
- `email` with the email address
- `website` with the website URL

Some fields are only available for Premium and Enterprise plans (and trials):
- `email`
- `itunes_rating_count`
- `itunes_rating_average`
- `spotify_rating_count`
- `spotify_rating_average`
- `audience_size`

All other `reach` fields are available for all plans and trial users.

**Responses:**

- `200`: 
- `404`: 
- `400`: 
- `401`: 

---

### `GET /podcasts/search/by/spotifyid`

**Search for a podcast by SpotifyID**

Search for a podcast by its Spotify ID

Use the `spotify_id` parameter to specify the Spotify ID of the podcast.

In the response, you will find a `reach` object with the following fields:
- `itunes` with the following fields:
  - `itunes_rating_average` with the average rating
  - `itunes_rating_count` with the number of ratings (this is what the `rating` order_by field is based on). This field is only available for Premium and Enterprise plans (and trials)
  - `itunes_rating_count_bracket` with the bracket of the number of ratings
- `spotify` with the following fields:
  - `spotify_rating_average` with the average rating
  - `spotify_rating_count` with the number of ratings
  - `spotify_rating_count_bracket` with the bracket of the number of ratings
- `audience_size` with the estimated audience size per episode
- `social_links` with an array of social links with the following fields:
- `platform` with the platform name
- `url` with the URL
- `email` with the email address
- `website` with the website URL

Some fields are only available for Premium and Enterprise plans (and trials):
- `email`
- `itunes_rating_count`
- `itunes_rating_average`
- `spotify_rating_count`
- `spotify_rating_average`
- `audience_size`

All other `reach` fields are available for all plans and trial users.

**Responses:**

- `200`: 
- `404`: 
- `400`: 
- `401`: 

---

### `GET /podcasts/search/by/rss`

**Search for podcasts by RSS feed URL**

Search for all podcasts matching RSS feed URL(s).

### Single vs Batch Mode
- **Single mode**: Use `rss_feed` parameter for a single URL lookup
- **Batch mode**: Use `rss_feeds` parameter with comma-separated URLs (max 50)

When `rss_feeds` is provided, it takes precedence over `rss_feed`.

Both modes return the same response format: `{ podcasts: [...] }`. Each podcast includes
`rss_url` and `rss_url_normalized` fields for correlation with the original request.

### Fuzzy Matching

Fuzzy matching is **enabled by default** and handles common URL formatting issues:

| Issue | Example |
|---|---|
| Missing protocol | `feeds.megaphone.fm/ABC` → `https://feeds.megaphone.fm/ABC` |
| www mismatch | `www.spreaker.com/...` ↔ `spreaker.com/...` |
| Case differences | `feeds.omnycontent.com/ABC` ↔ `feeds.omnycontent.com/abc` |
| Trailing slash | `https://feed.example.com/rss/` ↔ `https://feed.example.com/rss` |
| Prefix services | `rss.pdrl.fm/{hash}/feeds.megaphone.fm/...` → extracts inner URL |

Non-URL inputs (app bundle IDs like `com.audible.application`, hex hashes) are
automatically skipped.

Set `fuzzy_match=false` to disable fuzzy matching and use exact URL comparison only.

### Cache-Only Mode

Set `cache_only=true` to enable fast mode. This only checks the Redis cache
and skips all database queries, redirect lookups, and OpenSearch fallback.
URLs not found in the cache are returned as unmatched. Requires `fuzzy_match=true`
(the default). Ideal for high-volume callers who prioritize speed over completeness.

When fuzzy matching is enabled, the response includes additional metadata:

| Field | Type | Description |
|---|---|---|
| `fuzzy_match` | bool | Whether fuzzy matching was used |
| `cache_only` | bool | Whether cache-only fast mode was used |
| `skipped_inputs` | int | Number of non-URL inputs skipped |
| `suggested_feeds` | int | Number of unmatched valid URLs queued for discovery |

Returns an array of podcasts with identical structure to single podcast response.

**Responses:**

- `200`: 
- `404`: 
- `400`: 
- `401`: 

---

### `GET /podcasts/search/by/RSS`

**Search for podcasts by RSS feed URL**

Search for all podcasts matching RSS feed URL(s).

### Single vs Batch Mode
- **Single mode**: Use `rss_feed` parameter for a single URL lookup
- **Batch mode**: Use `rss_feeds` parameter with comma-separated URLs (max 50)

When `rss_feeds` is provided, it takes precedence over `rss_feed`.

Both modes return the same response format: `{ podcasts: [...] }`. Each podcast includes
`rss_url` and `rss_url_normalized` fields for correlation with the original request.

### Fuzzy Matching

Fuzzy matching is **enabled by default** and handles common URL formatting issues:

| Issue | Example |
|---|---|
| Missing protocol | `feeds.megaphone.fm/ABC` → `https://feeds.megaphone.fm/ABC` |
| www mismatch | `www.spreaker.com/...` ↔ `spreaker.com/...` |
| Case differences | `feeds.omnycontent.com/ABC` ↔ `feeds.omnycontent.com/abc` |
| Trailing slash | `https://feed.example.com/rss/` ↔ `https://feed.example.com/rss` |
| Prefix services | `rss.pdrl.fm/{hash}/feeds.megaphone.fm/...` → extracts inner URL |

Non-URL inputs (app bundle IDs like `com.audible.application`, hex hashes) are
automatically skipped.

Set `fuzzy_match=false` to disable fuzzy matching and use exact URL comparison only.

### Cache-Only Mode

Set `cache_only=true` to enable fast mode. This only checks the Redis cache
and skips all database queries, redirect lookups, and OpenSearch fallback.
URLs not found in the cache are returned as unmatched. Requires `fuzzy_match=true`
(the default). Ideal for high-volume callers who prioritize speed over completeness.

When fuzzy matching is enabled, the response includes additional metadata:

| Field | Type | Description |
|---|---|---|
| `fuzzy_match` | bool | Whether fuzzy matching was used |
| `cache_only` | bool | Whether cache-only fast mode was used |
| `skipped_inputs` | int | Number of non-URL inputs skipped |
| `suggested_feeds` | int | Number of unmatched valid URLs queued for discovery |

Returns an array of podcasts with identical structure to single podcast response.

**Responses:**

- `200`: 
- `404`: 
- `400`: 
- `401`: 

---

### `GET /podcasts/search/by/guid`

**Search for a podcast by GUID**

Search for a podcast by its GUID

Use the `guid` parameter to specify the GUID of the podcast. For more information on GUIDs, see https://podcastnamespace.org/tag/guid

In the response, you will find a `reach` object with the following fields:
- `itunes` with the following fields:
  - `itunes_rating_average` with the average rating
  - `itunes_rating_count` with the number of ratings (this is what the `rating` order_by field is based on). This field is only available for Premium and Enterprise plans (and trials)
  - `itunes_rating_count_bracket` with the bracket of the number of ratings
- `spotify` with the following fields:
  - `spotify_rating_average` with the average rating
  - `spotify_rating_count` with the number of ratings
  - `spotify_rating_count_bracket` with the bracket of the number of ratings
- `audience_size` with the estimated audience size per episode
- `social_links` with an array of social links with the following fields:
- `platform` with the platform name
- `url` with the URL
- `email` with the email address
- `website` with the website URL

Some fields are only available for Premium and Enterprise plans (and trials):
- `email`
- `itunes_rating_count`
- `itunes_rating_average`
- `spotify_rating_count`
- `spotify_rating_average`
- `audience_size`

All other `reach` fields are available for all plans and trial users.

**Responses:**

- `200`: 
- `404`: 
- `400`: 
- `401`: 

---

## Podcast Discovery

### `GET /podcasts/{podcast}/related_podcasts`

**List related podcasts**

List podcasts related to the specified podcast. These are the shows listeners often listen to
in addition to the specified podcast.

By default, results use vector-based content similarity when available, with a fallback to
directory-based similarity data. Use the `similarity_source` query parameter to control
the similarity method:

- `legacy`: Directory-based similarity only (iTunes/PodcastSimilarity)
- `vector`: Vector similarity using the best available index (defaults to content)
- `vector:content`: Content-based similarity (topics, guests, themes)
- `vector:demographics`: Audience demographic similarity
- `vector:commercial`: Commercial profile similarity (brand safety, sponsors)

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes | The ID of the podcast |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /podcasts/{podcast}/discover`

**Discover similar podcasts using multi-index vector similarity**

Discover podcasts similar to the specified podcast using vector similarity across multiple dimensions.
Unlike the related_podcasts endpoint which uses directory-based similarity, this endpoint uses
Podscan's vector similarity engine for deeper, multi-dimensional matching.

Query parameters:
- `indices[]`: Similarity indices to query. Options: `content`, `demographics`, `commercial`. Default: `content`
- `weights[]`: Weights (0.0-1.0) for each index, in the same order as indices[]. Default: equal weights
- `limit`: Maximum results to return (1-50, default: 20)

When multiple indices are specified, results are blended using the provided weights.
Each result includes per-index similarity scores when available.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes | The ID of the podcast |

**Responses:**

- `200`: 
- `401`: 

---

### `POST /podcasts/batch-probe`

**Batch probe for latest episodes matching criteria**

Efficiently probe multiple podcasts for their latest fully processed episode matching criteria.
This endpoint reduces API calls by allowing batch checking of up to 100 podcasts at once.

Use these request body parameters:
- `podcast_ids` (required): Array of podcast IDs to probe. Maximum of 100 IDs per request.
- `episodes_to_check` (optional): Number of the most recent episodes to check for each podcast,
  going back in chronological order from the latest episode. Default is 10, minimum is 1, maximum is 25.
- `active_within_days` (optional): Only include podcasts that have posted episodes within X days.
  If not provided, no activity filtering is applied. Minimum is 1, maximum is 365.
- `has_guests` (optional): Filter episodes by guest presence. Accepts boolean (true/false) or string
  ("true"/"false"/"1"/"0"). When true, only returns episodes with guests. When false, only returns
  episodes without guests. If omitted, no guest filtering.
- `has_hosts` (optional): Filter episodes by host presence. Accepts boolean (true/false) or string
  ("true"/"false"/"1"/"0"). When true, only returns episodes with hosts. When false, only returns
  episodes without hosts. If omitted, no host filtering.
- `has_sponsors` (optional): Filter episodes by sponsor presence. Accepts boolean (true/false) or string
  ("true"/"false"/"1"/"0"). When true, only returns episodes with sponsors. When false, only returns
  episodes without sponsors. If omitted, no sponsor filtering.

The endpoint returns the first (most recent) episode for each podcast that meets ALL specified criteria:
- Episode is fully processed (has extraction data) and has transcript available
- If active_within_days is set: Podcast/episode posted within that timeframe
- If has_guests is set: Episode matches the specified boolean value for guest presence
- If has_hosts is set: Episode matches the specified boolean value for host presence
- If has_sponsors is set: Episode matches the specified boolean value for sponsor presence

Returns a mapping of podcast IDs to their latest qualifying episode ID, or null if none found.

Example request:
```json
{
  "podcast_ids": ["pd_abc123", "pd_def456", "pd_ghi789"],
  "episodes_to_check": 10,
  "active_within_days": 60,
  "has_guests": true
}
```

Example response:
```json
{
  "results": {
    "pd_abc123": "ep_xyz789",
    "pd_def456": "ep_qrs456",
    "pd_ghi789": null
  },
  "podcasts_checked": 3,
  "episodes_found": 2
}
```

Note: The `results` object will include all provided podcast IDs as keys, with null values
for podcasts that either don't exist or don't have any qualifying episodes within the
checked range.

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "episodes_to_check": {
            "type": "integer",
            "minimum": 1,
            "maximum": 25
        },
        "active_within_days": {
            "type": "integer",
            "minimum": 1,
            "maximum": 365
        },
        "podcast_ids": {
            "type": "array",
            "items": {
                "type": "string"
            },
            "minItems": 1,
            "maxItems": 100
        }
    },
    "required": [
        "podcast_ids"
    ]
}
```

**Responses:**

- `200`: 
- `400`: 
- `422`: 
- `401`: 

---

## Podcast Analytics

### `GET /podcasts/{podcast}/demographics`

**Get demographics data**

Returns aggregated demographics data from recent episodes (up to 12) that have demographics data for the specified podcast.

**This endpoint is only available to premium-and-above subscribers and trial users.**

The aggregated demographics data includes:
- Gender skew (`heavily_male`, `mostly_male`, `leaning_male`, `balanced`, `leaning_female`, `mostly_female`, `heavily_female`, `diverse`, `mixed`)
- Age distribution (`0-18`, `18-24`, `25-34`, `35-44`, `45-54`, `55-64`, `65+`)
- Purchasing power (`low`, `medium`, `high`)
- Education level (`low`, `medium`, `high`)
- Engagement level (`low`, `medium`, `high`)
- Geographic distribution (`North America`, `Europe`, `Asia`, `Australia/Oceania`, `South America`, `Africa`, with percentage distribution)
- Professional industry distribution (data like `Technology Startups`, `Enterprise Software`, `Digital Marketing`, `Financial Services`, `Healthcare Technology`, `Education Technology`, `Creative Arts`, `Media Production`, with percentage distribution)
- Technology adoption profile (`laggard`, `late_majority`, `early_majority`, `early_adopter`, `innovator`, with confidence score and reasoning)
- Content consumption habits (`Spotify`, `YouTube`, `Instagram`, `TikTok`, `LinkedIn`, `Twitter/X`, with frequency, preferred formats, and consumption context)
- Political/ideological leaning (`far_left`, `left`, `center_left`, `center`, `center_right`, `right`, `far_right`, with polarization level and reasoning)
- Family status distribution (`single_no_children`, `married_no_children`, `single_parent`, `married_with_children`, `empty_nester`, with percentage distribution)
- Urban/rural distribution (`urban`, `suburban`, `rural`, with confidence score and reasoning)
- Brand affinity/loyalty profile (`very_low`, `low`, `moderate`, `high`, `very_high`, with price sensitivity, brand switching frequency, and advocacy potential)

The `episodes_analyzed` field indicates the number of episodes analyzed to generate this data.
The `total_episodes` field indicates the total number of episodes in the podcast, some of which may not have demographics data.

Note: This data is extracted by autonomous AI systems and may not be 100% accurate. Some values might be null or partially available.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes |  |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /podcasts/{podcast}/brand-safety`

**Get detailed brand safety assessment for podcast**

Returns comprehensive GARM (Global Alliance for Responsible Media) brand safety assessment
aggregated from recent episodes (typically the last 10 episodes with brand safety data).
This includes normalized data with all categories and detailed risk analysis.

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `framework` | string | Always `"GARM"` |
| `podcast_id` | string | The podcast identifier |
| `podcast_name` | string | The podcast name |
| `aggregation.episode_count` | integer | Number of recent episodes used for aggregation |
| `aggregation.max_risk_level` | string | Highest risk level found across all episodes |
| `aggregation.most_common_recommendation` | string | Most frequent advertiser recommendation |
| `aggregation.risk_distribution` | object | Count of episodes per risk level |
| `categories` | array | Detailed category-by-category analysis from the most recent episode |

## Risk Levels

Ordered from safest to most concerning:

| Value | Meaning |
|-------|---------|
| `none` | No content related to this category present |
| `low` | Educational, informative, or scientific treatment; news feature stories |
| `medium` | Dramatic depiction in entertainment context; breaking news or op-ed coverage |
| `high` | Glamorization, gratuitous depiction, or insensitive treatment |
| `floor_violation` | Content violates Brand Safety Floor (illegal, explicit, promoting harm) |

## Advertiser Recommendations

| Value | Meaning |
|-------|---------|
| `safe` / `safe_for_all` | Content is safe for all advertisers |
| `safe_with_caution` | Content may require advertiser discretion |
| `warning` / `medium_risk` | Content has moderate brand safety concerns |
| `unsafe` / `high_risk` | Content has significant brand safety concerns |
| `unsafe_for_all` | Content is unsafe for all advertisers |
| `low_risk` | Minimal brand safety concerns |
| `none` | No specific recommendation |

## GARM Categories Assessed

Each of the 12 standard GARM categories is returned in the `categories` array:

| # | Category | Covers |
|---|----------|--------|
| 1 | Adult & Explicit Sexual Content | Sexual content, nudity, explicit material |
| 2 | Arms & Ammunition | Weapons, firearms, ammunition sales/promotion |
| 3 | Crime & Harmful Acts | Criminal activity, trafficking, human rights violations |
| 4 | Death, Injury or Military Conflict | Violence, death, war, injury depictions |
| 5 | Online Piracy | Copyright infringement, counterfeiting, pirating |
| 6 | Hate Speech & Acts of Aggression | Discrimination, vilification, incitement |
| 7 | Obscenity and Profanity | Excessive profanity, obscene gestures, gory content |
| 8 | Illegal Drugs/Tobacco/Vaping/Alcohol | Substance use, promotion, abuse |
| 9 | Spam or Harmful Content | Malware, phishing, harmful content |
| 10 | Terrorism | Terrorist activity, promotion of terrorism |
| 11 | Debated Sensitive Social Issue | Controversial social/political topics |
| 12 | Misinformation | False or misleading information causing harm |

## Category Object Fields

Each item in the `categories` array contains:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | The category identifier |
| `risk_level` | string | One of the risk levels above |
| `advertiser_recommendation` | string | Recommendation for advertisers |
| `reasoning` | string | Explanation of the risk assessment |
| `evidence` | array | Supporting evidence (timestamps and excerpts from transcript) |

## GARM Category Assessment Criteria

These criteria are derived from the GARM Brand Safety Floor + Suitability Framework.

### Brand Safety Floor — Content Unsuitable for Any Advertising

| Category | Brand Safety Floor |
|----------|--------------------|
| Adult & Explicit Sexual Content | Child exploitation material; explicit/gratuitous portrayal of sexual acts or genitalia |
| Arms & Ammunition | Illegal weapons promotion/sales instructions; glorification of illegal arms for harm |
| Crime & Harmful Acts | Graphic criminal activity; human rights abuses (trafficking, slavery, cruelty); harassment |
| Death, Injury or Military Conflict | Incitement of violence/death; graphic intentional harm; war crime footage |
| Online Piracy | Copyright infringement, pirating, and counterfeiting |
| Hate Speech & Acts of Aggression | Inciting hatred, violence, or dehumanization based on protected characteristics |
| Obscenity and Profanity | Excessive profanity/gestures to shock or offend; gory/graphic content to disgust |
| Illegal Drugs/Tobacco/Vaping/Alcohol | Illegal drug promotion; prescription drug abuse promotion; substance promotion to minors |
| Spam or Harmful Content | Malware distribution and phishing |
| Terrorism | Promotion of graphic terrorist activity causing harm to individuals or communities |
| Debated Sensitive Social Issue | Insensitive/harmful treatment that demeans groups or incites conflict |
| Misinformation | Verifiably false or deliberately misleading content linked to user or societal harm |

### Suitability Framework — Risk Levels for Sensitive Content

| Category | High Risk | Medium Risk | Low Risk |
|----------|-----------|-------------|----------|
| Adult & Explicit Sexual Content | Suggestive scenarios needing adult advisories; full nudity | Dramatized sexuality in entertainment; artistic nudity | Educational/scientific discussion of sexual topics |
| Arms & Ammunition | Glorification of illegal arms sales or possession | Dramatized weapons in entertainment; breaking news on arms | Educational/scientific discussion of arms; news features |
| Crime & Harmful Acts | Portrayals of criminal acts or human rights violations | Dramatized crime in entertainment; breaking news coverage | Educational/scientific treatment of crime; news features |
| Death, Injury or Military Conflict | Portrayals of death/injury; insensitive treatment of war crimes | Dramatized conflict in entertainment; breaking news coverage | Educational/scientific discussion of conflict; news features |
| Online Piracy | Glorification or gratuitous portrayal of piracy | Dramatized piracy in entertainment; breaking news coverage | Educational/scientific discussion of piracy; news features |
| Hate Speech & Acts of Aggression | Hateful/denigrating content targeting protected characteristics | Dramatized hate speech in entertainment; breaking news | Educational/scientific discussion of hate speech; news features |
| Obscenity and Profanity | Glorification or gratuitous use of profanity/obscenities | Genre-appropriate profanity in entertainment; breaking news | Educational/informative treatment of obscenity; news features |
| Illegal Drugs/Tobacco/Vaping/Alcohol | Glorification of drug use/abuse; encouraging minor substance use | Dramatized substance use in entertainment; breaking news | Educational/scientific discussion of substances; news features |
| Spam or Harmful Content | Glorification or gratuitous portrayal of spam/malware | Dramatized spam/malware in entertainment; breaking news | Educational/scientific discussion of spam/malware; news features |
| Terrorism | Disturbing/agitating terrorism portrayals; insensitive treatment | Dramatized terrorism in entertainment; breaking news coverage | Educational/scientific discussion of terrorism; news features |
| Debated Sensitive Social Issue | Discussion of issues in negative or partisan contexts | Dramatized issues in entertainment; partisan opinion coverage | Educational/scientific discussion of issues; news features |
| Misinformation | Glorification or gratuitous promotion of misinformation | Dramatized misinformation in entertainment; breaking news | Educational/scientific treatment; news features on campaigns |

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes | The ID of the podcast |

**Responses:**

- `200`: 
- `404`: 
- `401`: 

---

### `GET /podcasts/{podcast}/chart-history`

**Get chart position history for a podcast**

Returns the podcast's chart position history across platforms (Apple Podcasts, Spotify),
including trend analysis showing whether the podcast is rising or falling in the charts.

## Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| days | integer | 30 | Number of days of history (7-30) |

## Response

The response includes two sections:

- `chart_history`: Array of chart position entries sorted by date (most recent first), each containing platform, country, category, rank, and date
- `trends`: Analysis of chart movement per platform/category/country combination, plus an overall summary with highest rank achieved

## Trend Direction Values

- `strongly_up`: Significantly more categories trending up than down
- `slightly_up`: More categories trending up than down
- `stable`: Equal up and down movement
- `slightly_down`: More categories trending down than up
- `strongly_down`: Significantly more categories trending down than up

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes | The encoded podcast ID |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /podcasts/{podcast}/analysis`

**Get podcast analysis**

Returns aggregated analysis data for a podcast, including guest history,
sponsor history, and a catchup summary based on existing extraction data.

This endpoint reads from already-processed extraction data and does **not**
trigger any new analysis. Only episodes with a `processed` extraction are included.

## Response fields

| Field | Type | Description |
|-------|------|-------------|
| `podcast_id` | string | Encoded podcast ID |
| `podcast_name` | string | Podcast name |
| `episodes_analyzed` | integer | Number of episodes with processed extractions |
| `guests` | array | Most frequent guests across episodes (up to 50) |
| `sponsors` | array | Most frequent sponsors across episodes (up to 50) |
| `hosts` | array | Hosts found across episodes |
| `catchup_summary` | object\|null | Summary from the most recent analyzed episode |

## Guest object

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Guest name |
| `company` | string\|null | Guest company or affiliation |
| `industry` | string\|null | Guest industry |
| `occupation` | string\|null | Guest occupation |
| `episode_count` | integer | Number of episodes this guest appeared on |

## Sponsor object

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Sponsor name |
| `product_mentioned` | string\|null | Product mentioned in sponsorship |
| `url` | string\|null | Sponsor URL |
| `episode_count` | integer | Number of episodes this sponsor appeared on |

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes |  |

**Responses:**

- `200`: 
- `401`: 

---

## Podcast Admin

### `POST /podcasts/suggest`

**Suggest a podcast**

Suggest a podcast to be added to the database. Optionally specify enclosure URLs to prioritize
specific episodes for immediate transcription.

Use the `url` parameter to specify the URL of the podcast's RSS feed. Has to be a valid feed.
Use the `enclosure_urls` parameter to specify up to 10 episode audio URLs that should be
prioritized for immediate transcription once the podcast is processed.

Response includes status for each enclosure URL:
- `already_transcribed`: Episode exists with full transcript (no further action)
- `found`: Episode exists, queued for immediate transcription
- `pending`: Episode not yet in database, will be prioritized when created during scan

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "url": {
            "type": "string",
            "format": "uri"
        },
        "enclosure_urls": {
            "type": "array",
            "items": {
                "type": "string",
                "format": "uri"
            },
            "maxItems": 10
        }
    },
    "required": [
        "url"
    ]
}
```

**Responses:**

- `200`: 
- `400`: 
- `422`: 
- `401`: 

---

### `POST /podcasts/{podcast}/retranscribe-all`

**Request retranscription and reanalysis of all episodes**

Initiates retranscription and subsequent reanalysis of all episodes in a podcast.
Rate limited to 5 requests per team per day.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes |  |

**Responses:**

- `500`: 
- `200`: 
- `429`: 
- `401`: 

---

### `POST /podcasts/{podcast}/diarization`

**Set diarization status**

Updates the diarization status for a podcast. This affects how speaker detection
is handled during transcription. This is a suggestion to the Podscan backend and may be changed internally.

Required: string `status`: The diarization status to set. Valid values are:
- `diarization_recommended`: This suggests to Podscan that it should diarize every episode of the podcast.
- `diarization_blocked`: This suggests to Podscan that it should not diarize any episodes of the podcast.
- `diarization_optional`: This suggests to Podscan that it can choose whether to diarize episodes of the podcast, depending on load.
- null (to remove the status)

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes |  |

**Responses:**

- `500`: 
- `200`: 
- `400`: 
- `401`: 

---

### `POST /podcasts/{podcast}/scan/all`

**Queue a deep scan of all episodes for a podcast**

This triggers a full RSS feed scan with immediate priority,
enabling prioritized processing and diarization for all episodes.

Rate limited to 50 requests per hour per team.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes |  |

**Responses:**

- `500`: 
- `200`: 
- `429`: 
- `401`: 

---

### `POST /podcasts/{podcast}/resummarize`

**Request AI summary regeneration for a podcast**

Queues a job to regenerate the AI-powered summary for the specified podcast.
The summary will be available within a few minutes after processing.

Rate limited to 100 requests per day per team (configurable) and
1 request per hour per podcast per team.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `podcast` | path | string | Yes |  |

**Responses:**

- `500`: 
- `200`: 
- `429`: 
- `503`: 
- `401`: 

---

## Episodes

### `GET /episodes/{episode}`

**Show a single episode**

Use these query parameters to filter the results:
  - `show_full_podcast` is a boolean string to show the full podcast information (instead of just ID, name, and website), values are 'true' or 'false' (default: false)
    - when active, populates `podcast` with the podcast information: `podcast_id`, `podcast_guid`, `podcast_name`, `podcast_url`, `podcast_description`, `podcast_image_url`, `podcast_categories`, `podcast_has_guests`, `podcast_has_sponsors`, `publisher_name`, `reach`, `rss_url`, `rss_url_normalized`, `is_active`, `episode_count`, `language`, `region`, `last_posted_at`, `last_scanned_at`, `created_at`, `updated_at`, `is_duplicate`, `is_duplicate_of`, `avg_episode_duration`, `avg_episode_duration_display`, `listener_engagement`, `podcast_summary`
    - when inactive, populates `podcast_id`, `podcast_name`, and `podcast_url` only
  - `word_level_timestamps` is a boolean string to show word-level timestamps in the transcript, values are 'true' or 'false' (default: false)
     - populates `episode_transcript_word_level_timestamps`, which can be `false` or an object that contains a JSON object with start and end timings for each phrase, the words within, including avg_logprob confidence scores, no-speech scores, and compression ratio
     - ⚠️ This will increase the size of the response significantly
 - `remove_timestamps` is a boolean string to remove timestamps from the transcript, values are 'true' or 'false' (default: false)
 - `remove_speaker_labels` is a boolean string to remove speaker labels from the transcript, values are 'true' or 'false' (default: false)
- `transcript_formatter` is the formatter to use for the transcript text. Currently supported values:
  - `paragraph`: Groups consecutive lines from the same speaker into paragraphs
  - If not specified, returns the transcript in its original format
- `exclude_transcript` is a boolean string to exclude the transcript from the response, values are 'true' or 'false' (default: false)

 *⚠️ The `metadata` field contains AI-extracted information and may not be accurate. The structure of this field might change over time as new fields are added.**

## Listener Engagement Data

The response includes a `listener_engagement` object with measured engagement metrics.
This is a premium add-on — purchase it from the [Add-ons page](https://podscan.fm/addons).
When not enabled, `listener_engagement` is `null`.

| Field | Type | Description |
|-------|------|-------------|
| `total_listeners` | integer | Unique listeners for this episode |
| `total_sessions` | integer | Total listening sessions |
| `total_play_seconds` | integer | Total seconds played across all sessions |
| `avg_play_seconds` | integer | Average listen duration in seconds |
| `median_play_seconds` | integer | Median listen duration in seconds |
| `avg_completion_ratio` | float | Average ratio of episode completed (0-1) |
| `median_completion_ratio` | float | Median ratio of episode completed (0-1) |
| `completed_listeners` | integer | Listeners who completed the episode |
| `completion_rate` | float | Completion rate (0-1) |
| `total_skip_forward_count` | integer | Total skip-forward events |
| `total_skip_back_count` | integer | Total skip-back events |
| `total_scrub_count` | integer | Total scrub/seek events |
| `avg_skips_per_session` | float | Average skips per session |
| `engagement_ratio` | float | Engagement ratio (0-1) |
| `ad_engagement_rate` | float | Ad engagement rate (0-1, higher = fewer skips) |
| `pre_roll_ad_engagement_rate` | float | Pre-roll ad engagement (0-1) |
| `mid_roll_ad_engagement_rate` | float | Mid-roll ad engagement (0-1) |
| `post_roll_ad_engagement_rate` | float | Post-roll ad engagement (0-1) |
| `placement_details` | object\|null | Per-placement reach/engagement breakdown (see below) |
| `retention_curve` | array | Position-based retention [{position, percent}] |
| `skip_distribution` | array | Position-based skip rates [{position, skip_rate}] |
| `country_breakdown` | object | Listener counts by country code |
| `state_breakdown` | object | Region counts grouped by country code, e.g. {"US": {"CA": 45}} |
| `data_start` | string | Start date of data range (YYYY-MM-DD) |
| `data_end` | string | End date of data range (YYYY-MM-DD) |
| `podcast_benchmarks` | object | Podcast-level averages for comparison |

### Placement Details

The `placement_details` object contains per-placement (pre_roll, mid_roll, post_roll) breakdown:

| Field | Type | Description |
|-------|------|-------------|
| `sessions_reached` | integer | Sessions that reached this placement |
| `sessions_engaged` | integer | Sessions that engaged (reached minus skipped) |
| `sessions_skipped` | integer | Sessions that skipped this placement |
| `reach_rate` | float\|null | Ratio of sessions that reached this placement (0-1) |
| `engagement_rate` | float\|null | Ratio of reached sessions that engaged (0-1) |
| `threshold_seconds` | integer\|null | Threshold in seconds for this placement |
| `episode_duration_seconds` | integer\|null | Episode duration in seconds |

## Sponsor Segments

The response includes a `sponsor_segments` array with timestamped sponsor placement data.
This is `null` when no sponsor segments are detected.

| Field | Type | Description |
|-------|------|-------------|
| `sponsor_name` | string | Name of the sponsor |
| `sponsor_entity_id` | string\|null | Encoded entity ID (if matched to a known entity) |
| `segment_type` | string\|null | Placement type (e.g. pre_roll, mid_roll, post_roll) |
| `start_timestamp` | string\|null | Start time of the sponsor segment (HH:MM:SS) |
| `end_timestamp` | string\|null | End time of the sponsor segment (HH:MM:SS) |
| `confidence` | string | Confidence level (high, medium, low) |
| `transcript_content` | string\|null | Verbatim transcript text of the ad read |

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `episode` | path | string | Yes | The ID of the episode |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /episodes/recent`

**Get the most recent episodes**

List the most recently ingested & transcribed episodes.

Use these query parameters to filter the results:
 - `limit` is the number of episodes to return
 - `category_ids` contains the category IDs to filter by as a comma-separated list
 - `podcast_ids` contains the podcast IDs to filter by as a comma-separated list
 - `before` is the date to get episodes before (defaults to now), like "2024-07-03 15:44:25"
 - `since` is the date to get episodes since (defaults to 7 days ago), like "2023-07-03 15:44:25"
 - `podcast_language` is the language code to filter by
    - a string, e.g., 'en', 'es', 'fr' or with region code like 'en-US', 'es-MX'
    - must be in format 'xx' (two-letter language code) or 'xx-XX' (language with region)
 - `has_guests` is a boolean to filter episodes with guests (`true`/`false`)
 - `has_sponsors` is a boolean to filter episodes with sponsors (`true`/`false`)
 - `show_only_fully_processed` is a boolean string to show only fully processed episodes (with metadata and a fully processed transcript), values are 'true' or 'false' (default: false)
 - `show_full_podcast` is a boolean string to show the full podcast information (instead of just ID, name, and website), values are 'true' or 'false' (default: false)
    - when active, populates `podcast` with the podcast information: `podcast_id`, `podcast_guid`, `podcast_name`, `podcast_url`, `podcast_description`, `podcast_image_url`, `podcast_categories`, `podcast_has_guests`, `podcast_has_sponsors`, `publisher_name`, `reach`, `rss_url`, `rss_url_normalized`, `is_active`, `episode_count`, `language`, `region`, `last_posted_at`, `last_scanned_at`, `created_at`, `updated_at`, `is_duplicate`, `is_duplicate_of`, `avg_episode_duration`, `avg_episode_duration_display`, `listener_engagement`, `podcast_summary`
    - when inactive, populates `podcast_id`, `podcast_name`, and `podcast_url` only
* - `word_level_timestamps` is a boolean string to show word-level timestamps in the transcript, values are 'true' or 'false' (default: false)
     - populates `episode_transcript_word_level_timestamps`, which can be `false` or an object that contains a JSON object with start and end timings for each phrase, the words within, including avg_logprob confidence scores, no-speech scores, and compression ratio
    - ⚠️ This will increase the size of the response significantly
- `remove_timestamps` is a boolean string to remove timestamps from the transcript, values are 'true' or 'false' (default: false)
- `remove_speaker_labels` is a boolean string to remove speaker labels from the transcript, values are 'true' or 'false' (default: false)
- `transcript_formatter` is the formatter to use for the transcript text. Currently supported values:
  - `paragraph`: Groups consecutive lines from the same speaker into paragraphs
  - If not specified, returns the transcript in its original format
- `exclude_transcript` is a boolean string to exclude the transcript from the response, values are 'true' or 'false' (default: false)

 **⚠️ The `metadata` field contains AI-extracted information and may not be accurate. The structure of this field might change over time as new fields are added.**

**Responses:**

- `200`: 
- `400`: 
- `401`: 

---

### `POST /episodes/bulk`

**Bulk download episodes**

Download multiple episodes at once by providing their IDs (maximum 50 IDs).

Use these query parameters to filter the results:
 - `episode_ids` contains the episode IDs to fetch as a comma-separated list (maximum 250)
 - `show_full_podcast` is a boolean string to show the full podcast information (instead of just ID, name, and website), values are 'true' or 'false' (default: false)
   - when active, populates `podcast` with the podcast information: `podcast_id`, `podcast_guid`, `podcast_name`, `podcast_url`, `podcast_description`, `podcast_image_url`, `podcast_categories`, `podcast_has_guests`, `podcast_has_sponsors`, `publisher_name`, `reach`, `rss_url`, `rss_url_normalized`, `is_active`, `episode_count`, `language`, `region`, `last_posted_at`, `last_scanned_at`, `created_at`, `updated_at`, `is_duplicate`, `is_duplicate_of`, `avg_episode_duration`, `avg_episode_duration_display`, `listener_engagement`, `podcast_summary`
   - when inactive, populates `podcast_id`, `podcast_name`, and `podcast_url` only
 - `word_level_timestamps` is a boolean string to show word-level timestamps in the transcript, values are 'true' or 'false' (default: false)
     - populates `episode_transcript_word_level_timestamps`, which can be `false` or an object that contains a JSON object with start and end timings for each phrase, the words within, including avg_logprob confidence scores, no-speech scores, and compression ratio
     - ⚠️ This will increase the size of the response significantly
 - `remove_timestamps` is a boolean string to remove timestamps from the transcript, values are 'true' or 'false' (default: false)
 - `remove_speaker_labels` is a boolean string to remove speaker labels from the transcript, values are 'true' or 'false' (default: false)
- `transcript_formatter` is the formatter to use for the transcript text. Currently supported values:
  - `paragraph`: Groups consecutive lines from the same speaker into paragraphs
  - If not specified, returns the transcript in its original format
 - `exclude_transcript` is a boolean string to exclude the transcript from the response, values are 'true' or 'false' (default: false)

 **⚠️ The `metadata` field contains AI-extracted information and may not be accurate. The structure of this field might change over time as new fields are added.**

**Responses:**

- `200`: 
- `400`: 
- `401`: 

---

## Episode Search

### `GET /episodes/search`

**Search for episodes**

Full-text search for podcast episodes.

### Parameters
Use these query parameters to filter the results:
 - `query` is the search query
 - `category_ids` contains the category IDs to filter by
   - a string, as a comma-separated list, like `ct_123,ct_456`
 - `podcast_ids` contains the podcast IDs to filter by
   - a string, as a comma-separated list, like `pd_123,pd_456`
 - `before` is the date to get episodes before
   - a string like `2024-07-03 15:44:25`, defaults to now
 - `since` is the date to get episodes since
   - a string like `2023-07-03 15:44:25`, defaults to 1 year ago
 - `per_page` is the number of results per page
    - an integer, defaults to `5`, maximum of `50`
 - `order_by` is the field to order by
    - a string, valid options: `best_match`, `created_at`, `title`, `posted_at`, or `podcast_rating`. Defaults to `posted_at`
 - `order_dir` is the direction to order
    - a string, valid options: `asc` or `desc`, defaults to `desc`
 - `search_fields` is the fields to search in
    - a string, as a comma-separated list, valid options: `transcription`, `title`, `description`, and any combination of those. Defaults to all valid fields
 - `podcast_language` is the language code to filter by
    - a string, e.g., 'en', 'es', 'fr'
 - `podcast_region` is the region/location code to filter by
    - a string, e.g., 'US', 'GB', 'FR'
 - `min_duration` is the minimum episode duration to filter by (in seconds)
 - `max_duration` is the maximum episode duration to filter by (in seconds)
 - `min_podcast_audience_size` is the minimum podcast audience size to filter by
 - `max_podcast_audience_size` is the maximum podcast audience size to filter by
 - `has_guests` is a boolean to filter episodes with guests (`true`/`false`)
 - `has_sponsors` is a boolean to filter episodes with sponsors (`true`/`false`)
 - `show_only_fully_processed` is a boolean string to show only fully processed episodes (with metadata and a fully processed transcript)
 - `show_full_podcast` is a boolean string to show the full podcast information (instead of just ID, name, and website),
    - a boolean, values are `true` or `false`, defaults to `false`
    - when active, populates `podcast` with the podcast information: `podcast_id`, `podcast_guid`, `podcast_name`, `podcast_url`, `podcast_description`, `podcast_image_url`, `podcast_categories`, `podcast_has_guests`, `podcast_has_sponsors`, `publisher_name`, `reach`, `rss_url`, `rss_url_normalized`, `is_active`, `episode_count`, `language`, `region`, `last_posted_at`, `last_scanned_at`, `created_at`, `updated_at`, `is_duplicate`, `is_duplicate_of`, `avg_episode_duration`, `avg_episode_duration_display`, `listener_engagement`, `podcast_summary`
    - when inactive, populates `podcast_id`, `podcast_name`, and `podcast_url` only
 - `word_level_timestamps` is a boolean string to show word-level timestamps in the transcript
     - populates `episode_transcript_word_level_timestamps`, which can be `false` or an object that contains a JSON object with start and end timings for each phrase, the words within, including avg_logprob confidence scores, no-speech scores, and compression ratio
    - ⚠️ This will increase the size of the response significantly
 - `remove_timestamps` is a boolean string to remove timestamps from the transcript
 - `remove_speaker_labels` is a boolean string to remove speaker labels from the transcript
 - `transcript_formatter` is the formatter to use for the transcript text. Currently supported values:
   - `paragraph`: Groups consecutive lines from the same speaker into paragraphs
   - If not specified, returns the transcript in its original format
 - `exclude_transcript` is a boolean string to exclude the transcript from the response

 ## Advanced Search Techniques

 For the complete syntax reference including all operators, proximity search, validation error codes, and example queries, see the **Search Query Syntax** section in the API docs sidebar.

 ### Basic Search
 Simply enter one or more words to search for episodes containing any of those words:
 - `podcast marketing` - finds episodes mentioning either "podcast" or "marketing" or both

 ### Exact Phrase Search
 Use quotation marks to search for an exact phrase:
 - `"podcast marketing"` - finds only episodes with the exact phrase "podcast marketing"
     *
     *  ### Wildcard Search
     *  Use asterisk (*) as a wildcard to replace 0 to n words within phrases:
     *  - `"digital * marketing"` - finds phrases like "digital content marketing", "digital inbound marketing"
     *  - `"it took * hours to find"` - finds phrases where words appear between "it took" and "hours to find"
     *  - `"it * us * get there"` - finds phrases with multiple word placeholders between specified words
     *
     *  ### Boolean Operators
     *  Use Boolean operators to create complex searches:
     *  - `podcast AND marketing` - finds episodes that contain both "podcast" and "marketing"
     *  - `podcast OR webinar` - finds episodes that contain either "podcast" or "webinar"
     *  - `podcast NOT beginner` - finds episodes about podcasts that don't mention "beginner"
     *
     *  ### Complex Queries
     *  Combine techniques for more precise searches:
     *  - `"podcast marketing" AND (strategy OR tips)` - finds episodes with exact phrase "podcast marketing" that also include either "strategy" or "tips"
     *  - `(advertising OR monetization) NOT "social media"` - finds episodes about advertising or monetization that don't mention "social media"
     *  - `"warning * for clean boss" AND sleep` - finds episodes with phrase containing "warning" followed by any words and then "for clean boss", that also includes "sleep"

 **Note:** Search is not case sensitive. Wildcard (*) can be used as a placeholder for 0 to n words within phrases and combined with boolean operators for powerful, flexible searches.

 ### A Warning about the Metadata Field
 **⚠️ The `metadata` field contains AI-extracted information and may not be accurate. The structure of this field might change over time as new fields are added.**

**Responses:**

- `400`: 
- `200`: 
- `422`: 
- `401`: 

---

### `GET /episodes/search/by/guid`

**Search for episodes by GUID**

Search for a podcast episode by its GUID. You can usually find the GUID in the episode's metadata. Some podcast platforms don't provide GUIDs, so this may not work for all episodes. You might also find duplicates if a self-assigned GUID is not unique.

### Single vs Batch Mode
- **Single mode**: Use `guid` parameter for a single GUID lookup
- **Batch mode**: Use `guids` parameter with comma-separated GUIDs (max 50)

Both modes return the same response format: `{ episodes: [...] }`. Each episode includes
`episode_guid` for client-side grouping. When `guids` is provided, it takes precedence over `guid`.

Use these query parameters to filter the results:
- `guid` is the GUID of the episode (single mode)
- `guids` is a comma-separated list of GUIDs (batch mode, max 50)
- `show_full_podcast` is a boolean string to show the full podcast information (instead of just ID, name, and website), values are 'true' or 'false' (default: false)
    - when active, populates `podcast` with the podcast information: `podcast_id`, `podcast_guid`, `podcast_name`, `podcast_url`, `podcast_description`, `podcast_image_url`, `podcast_categories`, `podcast_has_guests`, `podcast_has_sponsors`, `publisher_name`, `reach`, `rss_url`, `rss_url_normalized`, `is_active`, `episode_count`, `language`, `region`, `last_posted_at`, `last_scanned_at`, `created_at`, `updated_at`, `is_duplicate`, `is_duplicate_of`, `avg_episode_duration`, `avg_episode_duration_display`, `listener_engagement`, `podcast_summary`
    - when inactive, populates `podcast_id`, `podcast_name`, and `podcast_url` only
- `word_level_timestamps` is a boolean string to show word-level timestamps in the transcript, values are 'true' or 'false' (default: false)
- `remove_timestamps` is a boolean string to remove timestamps from the transcript, values are 'true' or 'false' (default: false)
- `remove_speaker_labels` is a boolean string to remove speaker labels from the transcript, values are 'true' or 'false' (default: false)
- `transcript_formatter` is the formatter to use for the transcript text. Currently supported values:
   - `paragraph`: Groups consecutive lines from the same speaker into paragraphs
   - If not specified, returns the transcript in its original format
- `exclude_transcript` is a boolean string to exclude the transcript from the response, values are 'true' or 'false' (default: false)

**Responses:**

- `200`: 
- `404`: 
- `400`: 
- `401`: 

---

### `GET /episodes/search/by/GUID`

**Search for episodes by GUID**

Search for a podcast episode by its GUID. You can usually find the GUID in the episode's metadata. Some podcast platforms don't provide GUIDs, so this may not work for all episodes. You might also find duplicates if a self-assigned GUID is not unique.

### Single vs Batch Mode
- **Single mode**: Use `guid` parameter for a single GUID lookup
- **Batch mode**: Use `guids` parameter with comma-separated GUIDs (max 50)

Both modes return the same response format: `{ episodes: [...] }`. Each episode includes
`episode_guid` for client-side grouping. When `guids` is provided, it takes precedence over `guid`.

Use these query parameters to filter the results:
- `guid` is the GUID of the episode (single mode)
- `guids` is a comma-separated list of GUIDs (batch mode, max 50)
- `show_full_podcast` is a boolean string to show the full podcast information (instead of just ID, name, and website), values are 'true' or 'false' (default: false)
    - when active, populates `podcast` with the podcast information: `podcast_id`, `podcast_guid`, `podcast_name`, `podcast_url`, `podcast_description`, `podcast_image_url`, `podcast_categories`, `podcast_has_guests`, `podcast_has_sponsors`, `publisher_name`, `reach`, `rss_url`, `rss_url_normalized`, `is_active`, `episode_count`, `language`, `region`, `last_posted_at`, `last_scanned_at`, `created_at`, `updated_at`, `is_duplicate`, `is_duplicate_of`, `avg_episode_duration`, `avg_episode_duration_display`, `listener_engagement`, `podcast_summary`
    - when inactive, populates `podcast_id`, `podcast_name`, and `podcast_url` only
- `word_level_timestamps` is a boolean string to show word-level timestamps in the transcript, values are 'true' or 'false' (default: false)
- `remove_timestamps` is a boolean string to remove timestamps from the transcript, values are 'true' or 'false' (default: false)
- `remove_speaker_labels` is a boolean string to remove speaker labels from the transcript, values are 'true' or 'false' (default: false)
- `transcript_formatter` is the formatter to use for the transcript text. Currently supported values:
   - `paragraph`: Groups consecutive lines from the same speaker into paragraphs
   - If not specified, returns the transcript in its original format
- `exclude_transcript` is a boolean string to exclude the transcript from the response, values are 'true' or 'false' (default: false)

**Responses:**

- `200`: 
- `404`: 
- `400`: 
- `401`: 

---

### `GET /episodes/search/by/enclosure-url`

**Search for episodes by enclosure URL (audio link)**

Search for podcast episodes by their enclosure URL (the audio file URL). Since multiple
episodes can share the same audio URL, this returns an array of matching episodes
sorted by the PRS score of their parent podcast (highest first).

### Single vs Batch Mode
- **Single mode**: Use `enclosure_url` parameter for a single URL lookup
- **Batch mode**: Use `enclosure_urls` parameter with comma-separated URLs (max 50)

Both modes return the same response format: `{ episodes: [...] }`. Each episode includes
`episode_audio_url` for client-side grouping. When `enclosure_urls` is provided, it takes precedence over `enclosure_url`.

Use these query parameters:
- `enclosure_url` is the audio file URL to search for (single mode)
- `enclosure_urls` is a comma-separated list of audio file URLs (batch mode, max 50)
- `show_full_podcast` is a boolean string to show the full podcast information, values are 'true' or 'false' (default: false)
- `word_level_timestamps` is a boolean string to show word-level timestamps in the transcript, values are 'true' or 'false' (default: false)
- `remove_timestamps` is a boolean string to remove timestamps from the transcript, values are 'true' or 'false' (default: false)
- `remove_speaker_labels` is a boolean string to remove speaker labels from the transcript, values are 'true' or 'false' (default: false)
- `transcript_formatter` is the formatter to use for the transcript text. Currently supported values:
  - `paragraph`: Groups consecutive lines from the same speaker into paragraphs
  - If not specified, returns the transcript in its original format
- `exclude_transcript` is a boolean string to exclude the transcript from the response, values are 'true' or 'false' (default: false)

### Fuzzy Matching

Fuzzy matching is **enabled by default** and handles common URL formatting issues:

| Issue | Example |
|---|---|
| Missing protocol | `traffic.megaphone.fm/X.mp3` → `https://traffic.megaphone.fm/X.mp3` |
| www mismatch | `www.buzzsprout.com/...` ↔ `buzzsprout.com/...` |
| Case differences | `traffic.megaphone.fm/ABC.mp3` ↔ `traffic.megaphone.fm/abc.mp3` |
| Trailing slash | `https://feed.example.com/audio/` ↔ `https://feed.example.com/audio` |
| Proxy services | `dts.podtrac.com/redirect.mp3/traffic.megaphone.fm/...` → extracts inner URL |

Audio enclosure URLs frequently chain through multiple analytics proxy services
(Podtrac, Podsights, Chartable, etc.). Fuzzy matching recursively unwraps these
proxy layers to find the canonical audio URL.

Non-URL inputs (app bundle IDs like `com.audible.application`, hex hashes) are
automatically skipped.

Set `fuzzy_match=false` to disable fuzzy matching and use exact URL comparison only.

### Cache-Only Mode

Set `cache_only=true` to enable fast mode. This only checks the Redis cache
and skips all database queries, redirect lookups, and OpenSearch fallback.
URLs not found in the cache are returned as unmatched. Requires `fuzzy_match=true`
(the default). Ideal for high-volume callers who prioritize speed over completeness.

When fuzzy matching is enabled, the response includes additional metadata:

| Field | Type | Description |
|---|---|---|
| `fuzzy_match` | bool | Whether fuzzy matching was used |
| `cache_only` | bool | Whether cache-only fast mode was used |
| `skipped_inputs` | int | Number of non-URL inputs skipped |
| `suggested_enclosures` | int | Number of unmatched valid URLs (always 0 in cache-only mode) |

**⚠️ The `metadata` field contains AI-extracted information and may not be accurate. The structure of this field might change over time as new fields are added.**

**Responses:**

- `200`: 
- `400`: 
- `401`: 

---

## Episode Analytics

### `GET /episodes/{episode}/demographics`

**Get episode demographics**

Returns the demographics data from the most recent extraction for a podcast episode. The full episode and its context is used to extract the demographics data.

**This endpoint is only available to premium-and-above subscribers and trial users.**

The demographics data includes:
- Gender skew (`heavily_male`, `mostly_male`, `leaning_male`, `balanced`, `leaning_female`, `mostly_female`, `heavily_female`, `diverse`, `mixed`)
- Age distribution (`0-18`, `18-24`, `25-34`, `35-44`, `45-54`, `55-64`, `65+`)
- Purchasing power (`low`, `medium`, `high`)
- Education level (`low`, `medium`, `high`)
- Engagement level (`low`, `medium`, `high`)
- Geographic distribution (`North America`, `Europe`, `Asia`, `Australia/Oceania`, `South America`, `Africa`, with percentage distribution)
- Professional industry distribution (data like `Technology Startups`, `Enterprise Software`, `Digital Marketing`, `Financial Services`, `Healthcare Technology`, `Education Technology`, `Creative Arts`, `Media Production`, with percentage distribution)
- Technology adoption profile (`laggard`, `late_majority`, `early_majority`, `early_adopter`, `innovator`, with confidence score and reasoning)
- Content consumption habits (`Spotify`, `YouTube`, `Instagram`, `TikTok`, `LinkedIn`, `Twitter/X`, with frequency, preferred formats, and consumption context)
- Political/ideological leaning (`far_left`, `left`, `center_left`, `center`, `center_right`, `right`, `far_right`, with polarization level and reasoning)
- Family status distribution (`single_no_children`, `married_no_children`, `single_parent`, `married_with_children`, `empty_nester`, with percentage distribution)
- Urban/rural distribution (`urban`, `suburban`, `rural`, with confidence score and reasoning)
- Brand affinity/loyalty profile (`very_low`, `low`, `moderate`, `high`, `very_high`, with price sensitivity, brand switching frequency, and advocacy potential)

Note: This data is extracted by autonomous AI systems and may not be 100% accurate. Some values might be null or partially available.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `episode` | path | string | Yes | The ID of the episode |

**Responses:**

- `200`: 
- `404`: 
- `403`: 
- `401`: 

---

### `GET /episodes/{episode}/brand-safety`

**Get detailed brand safety assessment for episode**

Returns comprehensive GARM (Global Alliance for Responsible Media) brand safety assessment
for a specific episode. This includes normalized data with all 12 standard categories and
detailed risk analysis with supporting evidence from the transcript.

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `framework` | string | Always `"GARM"` |
| `overall_assessment.risk_level` | string | Overall risk level for the entire episode |
| `overall_assessment.advertiser_recommendation` | string | Overall advertiser recommendation |
| `overall_assessment.reasoning` | string | Explanation of the overall assessment |
| `categories` | array | Complete category-by-category breakdown (all 12 categories) |
| `assessed_at` | string | ISO 8601 timestamp of when the assessment was performed |

## Risk Levels

Ordered from safest to most concerning:

| Value | Meaning |
|-------|---------|
| `none` | No content related to this category present |
| `low` | Educational, informative, or scientific treatment; news feature stories |
| `medium` | Dramatic depiction in entertainment context; breaking news or op-ed coverage |
| `high` | Glamorization, gratuitous depiction, or insensitive treatment |
| `floor_violation` | Content violates Brand Safety Floor (illegal, explicit, promoting harm) |

## Advertiser Recommendations

| Value | Meaning |
|-------|---------|
| `safe` / `safe_for_all` | Content is safe for all advertisers |
| `safe_with_caution` | Content may require advertiser discretion |
| `warning` / `medium_risk` | Content has moderate brand safety concerns |
| `unsafe` / `high_risk` | Content has significant brand safety concerns |
| `unsafe_for_all` | Content is unsafe for all advertisers |
| `low_risk` | Minimal brand safety concerns |
| `none` | No specific recommendation |

## GARM Categories Assessed

Each of the 12 standard GARM categories is returned in the `categories` array:

| # | Category | Covers |
|---|----------|--------|
| 1 | Adult & Explicit Sexual Content | Sexual content, nudity, explicit material |
| 2 | Arms & Ammunition | Weapons, firearms, ammunition sales/promotion |
| 3 | Crime & Harmful Acts | Criminal activity, trafficking, human rights violations |
| 4 | Death, Injury or Military Conflict | Violence, death, war, injury depictions |
| 5 | Online Piracy | Copyright infringement, counterfeiting, pirating |
| 6 | Hate Speech & Acts of Aggression | Discrimination, vilification, incitement |
| 7 | Obscenity and Profanity | Excessive profanity, obscene gestures, gory content |
| 8 | Illegal Drugs/Tobacco/Vaping/Alcohol | Substance use, promotion, abuse |
| 9 | Spam or Harmful Content | Malware, phishing, harmful content |
| 10 | Terrorism | Terrorist activity, promotion of terrorism |
| 11 | Debated Sensitive Social Issue | Controversial social/political topics |
| 12 | Misinformation | False or misleading information causing harm |

## Category Object Fields

Each item in the `categories` array contains:

| Field | Type | Description |
|-------|------|-------------|
| `name` / `category` | string | The category identifier (e.g., `"adult_explicit_sexual_content"`) |
| `risk_level` | string | One of the risk levels above |
| `advertiser_recommendation` | string | Recommendation for advertisers |
| `reasoning` | string | Detailed explanation of why this risk level was assigned |
| `evidence` | array | Supporting evidence with timestamps and excerpts from the transcript |

## Evidence Object Fields

Each item in the `evidence` array contains:

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | Time in transcript where the content appears (e.g., `"00:12:34"`) |
| `excerpt` / `text` | string | The actual content that triggered the risk assessment |

## GARM Category Assessment Criteria

These criteria are derived from the GARM Brand Safety Floor + Suitability Framework.

### Brand Safety Floor — Content Unsuitable for Any Advertising

| Category | Brand Safety Floor |
|----------|--------------------|
| Adult & Explicit Sexual Content | Child exploitation material; explicit/gratuitous portrayal of sexual acts or genitalia |
| Arms & Ammunition | Illegal weapons promotion/sales instructions; glorification of illegal arms for harm |
| Crime & Harmful Acts | Graphic criminal activity; human rights abuses (trafficking, slavery, cruelty); harassment |
| Death, Injury or Military Conflict | Incitement of violence/death; graphic intentional harm; war crime footage |
| Online Piracy | Copyright infringement, pirating, and counterfeiting |
| Hate Speech & Acts of Aggression | Inciting hatred, violence, or dehumanization based on protected characteristics |
| Obscenity and Profanity | Excessive profanity/gestures to shock or offend; gory/graphic content to disgust |
| Illegal Drugs/Tobacco/Vaping/Alcohol | Illegal drug promotion; prescription drug abuse promotion; substance promotion to minors |
| Spam or Harmful Content | Malware distribution and phishing |
| Terrorism | Promotion of graphic terrorist activity causing harm to individuals or communities |
| Debated Sensitive Social Issue | Insensitive/harmful treatment that demeans groups or incites conflict |
| Misinformation | Verifiably false or deliberately misleading content linked to user or societal harm |

### Suitability Framework — Risk Levels for Sensitive Content

| Category | High Risk | Medium Risk | Low Risk |
|----------|-----------|-------------|----------|
| Adult & Explicit Sexual Content | Suggestive scenarios needing adult advisories; full nudity | Dramatized sexuality in entertainment; artistic nudity | Educational/scientific discussion of sexual topics |
| Arms & Ammunition | Glorification of illegal arms sales or possession | Dramatized weapons in entertainment; breaking news on arms | Educational/scientific discussion of arms; news features |
| Crime & Harmful Acts | Portrayals of criminal acts or human rights violations | Dramatized crime in entertainment; breaking news coverage | Educational/scientific treatment of crime; news features |
| Death, Injury or Military Conflict | Portrayals of death/injury; insensitive treatment of war crimes | Dramatized conflict in entertainment; breaking news coverage | Educational/scientific discussion of conflict; news features |
| Online Piracy | Glorification or gratuitous portrayal of piracy | Dramatized piracy in entertainment; breaking news coverage | Educational/scientific discussion of piracy; news features |
| Hate Speech & Acts of Aggression | Hateful/denigrating content targeting protected characteristics | Dramatized hate speech in entertainment; breaking news | Educational/scientific discussion of hate speech; news features |
| Obscenity and Profanity | Glorification or gratuitous use of profanity/obscenities | Genre-appropriate profanity in entertainment; breaking news | Educational/informative treatment of obscenity; news features |
| Illegal Drugs/Tobacco/Vaping/Alcohol | Glorification of drug use/abuse; encouraging minor substance use | Dramatized substance use in entertainment; breaking news | Educational/scientific discussion of substances; news features |
| Spam or Harmful Content | Glorification or gratuitous portrayal of spam/malware | Dramatized spam/malware in entertainment; breaking news | Educational/scientific discussion of spam/malware; news features |
| Terrorism | Disturbing/agitating terrorism portrayals; insensitive treatment | Dramatized terrorism in entertainment; breaking news coverage | Educational/scientific discussion of terrorism; news features |
| Debated Sensitive Social Issue | Discussion of issues in negative or partisan contexts | Dramatized issues in entertainment; partisan opinion coverage | Educational/scientific discussion of issues; news features |
| Misinformation | Glorification or gratuitous promotion of misinformation | Dramatized misinformation in entertainment; breaking news | Educational/scientific treatment; news features on campaigns |

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `episode` | path | string | Yes |  |

**Responses:**

- `200`: 
- `404`: 
- `401`: 

---

### `GET /episodes/{episode}/engagement`

**Get listener engagement data for an episode**

Returns listener engagement metrics for a specific episode, including completion rates,
skip behavior, ad engagement, geographic breakdowns, and podcast-level benchmarks.

This endpoint requires the engagement data add-on to be enabled for your team.
If the add-on is not enabled, a 403 error is returned.

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `episode_id` | string | Encoded episode ID |
| `episode_title` | string | Episode title |
| `podcast_id` | string | Encoded podcast ID |
| `podcast_name` | string | Podcast name |
| `engagement_data` | object | Episode-level engagement metrics with podcast benchmarks |

## Engagement Data Fields

| Field | Type | Description |
|-------|------|-------------|
| `total_listeners` | int | Unique listeners |
| `total_sessions` | int | Total listening sessions |
| `total_play_seconds` | int | Total seconds played across all sessions |
| `avg_play_seconds` | int | Average seconds played per session |
| `avg_completion_ratio` | float | Average completion ratio (0.0 to 1.0) |
| `completion_rate` | float | Percentage of listeners who completed the episode |
| `engagement_ratio` | float | Overall engagement ratio |
| `ad_engagement_rate` | float | Overall ad engagement rate |
| `placement_details` | object/null | Per-placement (pre/mid/post-roll) engagement breakdown |
| `retention_curve` | array/null | Listener retention over episode duration |
| `country_breakdown` | object/null | Listener counts by country |
| `podcast_benchmarks` | object/null | Podcast-level averages for comparison |

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `episode` | path | string | Yes | The encoded episode ID |

**Responses:**

- `200`: 
- `404`: 
- `403`: 
- `401`: 

---

## Episode Admin

### `POST /episodes/{episode}/retranscribe`

**Request retranscription**

Initiates retranscription of a podcast episode. Rate limited to 10 high-priority
requests per team per hour. Additional requests are queued with low priority.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `episode` | path | string | Yes |  |

**Responses:**

- `200`: 
- `401`: 

---

### `POST /episodes/{episode}/reanalyze`

**Request reanalysis**

Initiates reanalysis of a podcast episode's metadata. Rate limited to 10 high-priority
requests per team per hour. Additional requests are queued with low priority.

This will:
1. Re-extract metadata about hosts, guests, and sponsors
2. Generate new episode summaries
3. Update speaker diarization
4. Re-analyze for branded content

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `episode` | path | string | Yes |  |

**Responses:**

- `200`: 
- `401`: 

---

## Alerts

### `GET /teams/{team}/alerts/{alert}`

**Show a single alert**

Returns the details of a single alert.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team as a string |
| `alert` | path | string | Yes | The ID of the alert as a string |

**Responses:**

- `200`: 
- `401`: 

---

### `PUT /teams/{team}/alerts/{alert}`

**Update an alert**

Updates the configuration of an existing alert, including its name, filter expressions, notification
preferences, webhook settings, and podcast/category restrictions. Any fields not included in the
request body will retain their current values.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team as a string |
| `alert` | path | string | Yes | The ID of the alert as a string |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "alert_name": {
            "type": "string",
            "maxLength": 255
        },
        "alert_enabled": {
            "type": "boolean"
        },
        "notification_email": {
            "type": [
                "string",
                "null"
            ],
            "format": "email"
        },
        "notification_summary_enabled": {
            "type": "boolean"
        },
        "notification_summary_frequency": {
            "type": [
                "string",
                "null"
            ],
            "enum": [
                "daily",
                "weekly",
                "monthly"
            ]
        },
        "webhook_enabled": {
            "type": "boolean"
        },
        "webhook_url": {
            "type": [
                "string",
                "null"
            ],
            "format": "uri"
        },
        "prompt_question_enabled": {
            "type": "boolean"
        },
        "prompt_question": {
            "type": [
                "string",
                "null"
            ]
        },
        "restrict_to_category_ids": {
            "type": [
                "string",
                "null"
            ]
        },
        "restrict_to_podcast_ids": {
            "type": [
                "string",
                "null"
            ]
        },
        "ignore_category_ids": {
            "type": [
                "string",
                "null"
            ]
        },
        "ignore_podcast_ids": {
            "type": [
                "string",
                "null"
            ]
        },
        "prompt_filters": {
            "type": "array",
            "items": {
                "type": "string"
            },
            "minItems": 1,
            "maxItems": 10
        }
    },
    "required": [
        "alert_name",
        "prompt_filters"
    ]
}
```

**Responses:**

- `200`: 
- `400`: 
- `422`: 
- `401`: 

---

### `DELETE /teams/{team}/alerts/{alert}`

**Delete an alert**

Permanently deletes an alert and all of its associated mentions. This action cannot be undone.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team as a string |
| `alert` | path | string | Yes | The ID of the alert as a string |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /teams/{team}/alerts`

**List all alerts for a team**

Returns a paginated list of all alerts owned by the specified team. Each alert includes its configuration,
filter expressions, notification settings, and a total mention count. Use the `per_page` query parameter
to control page size (default 25, max 100).

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team as a string |

**Responses:**

- `200`: 
- `401`: 

---

### `POST /teams/{team}/alerts`

**Create a new alert**

Creates and immediately activates a new alert for the team.

Alert filters support the full search query syntax including boolean operators (AND, OR, NOT),
phrase search, wildcards, and proximity operators (NEAR/N, WITHIN/N, SENTENCE).
For the complete syntax reference, validation error codes, and examples, see the **Search Query Syntax** section in the API docs sidebar.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team as a string |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "alert_name": {
            "type": "string",
            "maxLength": 255
        },
        "alert_enabled": {
            "type": "boolean"
        },
        "notification_email": {
            "type": [
                "string",
                "null"
            ],
            "format": "email"
        },
        "notification_summary_enabled": {
            "type": "boolean"
        },
        "notification_summary_frequency": {
            "type": [
                "string",
                "null"
            ],
            "enum": [
                "daily",
                "weekly",
                "monthly"
            ]
        },
        "webhook_enabled": {
            "type": "boolean"
        },
        "webhook_url": {
            "type": [
                "string",
                "null"
            ],
            "format": "uri"
        },
        "prompt_question_enabled": {
            "type": "boolean"
        },
        "prompt_question": {
            "type": [
                "string",
                "null"
            ]
        },
        "restrict_to_category_ids": {
            "type": [
                "string",
                "null"
            ]
        },
        "ignore_category_ids": {
            "type": [
                "string",
                "null"
            ]
        },
        "restrict_to_podcast_ids": {
            "type": [
                "string",
                "null"
            ]
        },
        "ignore_podcast_ids": {
            "type": [
                "string",
                "null"
            ]
        },
        "prompt_filters": {
            "type": "array",
            "items": {
                "type": "string"
            },
            "minItems": 1,
            "maxItems": 10
        }
    },
    "required": [
        "alert_name",
        "prompt_filters"
    ]
}
```

**Responses:**

- `200`: Returns the newly created alert object
- `400`: 
- `403`: 
- `422`: 
- `401`: 

---

### `GET /teams/{team}/alerts/{alert}/mentions`

**List mentions for an alert**

Returns a list of mentions for an alert.

Use these query parameters to filter the results:
- `per_page` is the number of results per page (default: 25, max: 100)
- `order_by` is the field to order by (allowed values: `created_at`, `updated_at`)
- `order_dir` is the direction to order (`asc` or `desc`)
- `before` is the date to get mentions before (defaults to now), like "2024-07-03 15:44:25"
- `since` is the date to get mentions since (defaults to 1 year ago), like "2023-07-03 15:44:25"

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team as a string |
| `alert` | path | string | Yes | The ID of the alert as a string |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /teams/{team}/alerts/{alert}/mentions/{mention}`

**Show a single mention**

Returns the details of a single mention.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team as a string |
| `alert` | path | string | Yes | The ID of the alert as a string |
| `mention` | path | string | Yes | The ID of the mention as a string |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /teams/{team}/alerts/{alert}/mentions/export`

**Export mentions for an alert as JSON or CSV**

Exports up to 10,000 mentions for an alert with optional date filtering.
Supports JSON and CSV output formats.
## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| format | string | json | Export format: `json` or `csv` |
| since | string | null | ISO 8601 date — only include mentions after this date |
| until | string | null | ISO 8601 date — only include mentions before this date |
| limit | int | 1000 | Max rows to export (1–10000) |

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The encoded team ID (te_xxx) |
| `alert` | path | string | Yes | The encoded alert ID (al_xxx) |

**Responses:**

- `200`: 
- `401`: 

---

## Alert Groups

### `GET /teams/{team}/alert-groups/{group}`

**Show an alert group**

Returns a single alert group with its children and alerts.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The encoded team ID (te_xxx) |
| `group` | path | string | Yes | The encoded alert group ID (sg_xxx) |

**Responses:**

- `200`: 
- `401`: 

---

### `PUT /teams/{team}/alert-groups/{group}`

**Update an alert group**

Updates the name or enabled status of an alert group.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The encoded team ID (te_xxx) |
| `group` | path | string | Yes | The encoded alert group ID (sg_xxx) |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "description": "The new name for the alert group",
            "maxLength": 255
        },
        "enabled": {
            "type": "boolean",
            "description": "Whether the group is enabled"
        }
    }
}
```

**Responses:**

- `200`: 
- `422`: 
- `401`: 

---

### `DELETE /teams/{team}/alert-groups/{group}`

**Delete an alert group**

Deletes an alert group. Child groups and alerts within the group become
root-level items (they are not deleted).

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The encoded team ID (te_xxx) |
| `group` | path | string | Yes | The encoded alert group ID (sg_xxx) |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /teams/{team}/alert-groups`

**List alert groups**

Returns all alert groups for the team as a hierarchical tree, including
child groups and alerts within each group, ordered by position.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The encoded team ID (te_xxx) |

**Responses:**

- `200`: 
- `401`: 

---

### `POST /teams/{team}/alert-groups`

**Create an alert group**

Creates a new alert group for the team. Groups can be nested up to 3 levels deep.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The encoded team ID (te_xxx) |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "description": "The name of the alert group",
            "maxLength": 255
        },
        "parent_id": {
            "type": [
                "string",
                "null"
            ],
            "description": "The encoded ID of the parent group (sg_xxx). Omit for a root-level group."
        }
    },
    "required": [
        "name"
    ]
}
```

**Responses:**

- `201`: 
- `422`: 
- `404`: 
- `400`: 
- `401`: 

---

### `POST /teams/{team}/alert-groups/reorder`

**Reorder alert groups**

Bulk reorder groups and alerts within groups. Accepts the full tree structure
and updates all positions and parent assignments. Use this after drag-and-drop
operations.

Each item in the `items` array must specify:

| Field | Type | Description |
|-------|------|-------------|
| type | string | `alert` or `group` |
| id | string | The encoded ID of the item |
| position | int | The new zero-based position |
| parent_id | string/null | The encoded group ID of the parent, or null for root |

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The encoded team ID (te_xxx) |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": [
                            "alert",
                            "group"
                        ]
                    },
                    "id": {
                        "type": "string"
                    },
                    "position": {
                        "type": "integer",
                        "minimum": 0
                    },
                    "parent_id": {
                        "type": [
                            "string",
                            "null"
                        ]
                    }
                },
                "required": [
                    "type",
                    "id",
                    "position"
                ]
            },
            "minItems": 1
        }
    },
    "required": [
        "items"
    ]
}
```

**Responses:**

- `200`: 
- `403`: 
- `400`: 
- `422`: 
- `401`: 

---

### `POST /teams/{team}/alert-groups/{group}/batch-toggle`

**Batch toggle alerts in a group**

Enable or disable all alerts within an alert group. This only affects
the alerts directly inside the specified group (not alerts in child groups).

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The encoded team ID (te_xxx) |
| `group` | path | string | Yes | The encoded alert group ID (sg_xxx) |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "enabled": {
            "type": "boolean",
            "description": "Whether to enable (`true`) or disable (`false`) all alerts in the group"
        }
    },
    "required": [
        "enabled"
    ]
}
```

**Responses:**

- `200`: 
- `422`: 
- `401`: 

---

## Topics

### `GET /topics/trending`

**Get trending topics**

Parameters:
- `timeframe`, string,  Timeframe for trends (`daily`/`weekly`/`monthly`)
- `limit`, int, Number of topics to return (default: `10`, max: `100`)
- `with_history`, bool, Include 30-day occurrence history (default: `false`)

Get trending topics for the specified timeframe. Topics are ranked by:
1. Number of occurrences in the timeframe
2. Momentum (rate of growth)
3. Relationship strength with other trending topics

The response includes:
- `topics`: Array of trending topics, each containing:
  - `topic_id`: Topic identifier
  - `name`: Topic name
  - `occurrences`: Number of occurrences in timeframe
  - `momentum`: Growth metrics
  - `related_topics`: Array of related trending topics

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `timeframe` | query | string | No |  |
| `with_history` | query | boolean | No |  |

**Responses:**

- `500`: 
- `200`: 
- `400`: 
- `401`: 

---

### `GET /topics/search`

**Search topics**

Parameters:
- `query` string, Search query
- `per_page` int, Results per page (default: 25, max: 100)
Search for topics by name. The search is case-insensitive and supports partial matches.
Results are ordered by relevance and recent activity.

## Advanced Search Techniques

### Basic Search
Simply enter one or more words to search for topics containing any of those words:
- `podcast marketing` - finds topics mentioning either "podcast" or "marketing" or both

### Exact Phrase Search
Use quotation marks to search for an exact phrase:
- `"podcast marketing"` - finds only topics with the exact phrase "podcast marketing"
     *
     * ### Wildcard Search
     * Use asterisk (*) as a wildcard to replace 0 to n words within phrases:
     * - `"digital * marketing"` - finds phrases like "digital content marketing", "digital inbound marketing"
     * - `"it took * hours to find"` - finds phrases where words appear between "it took" and "hours to find"
     * - `"it * us * get there"` - finds phrases with multiple word placeholders between specified words
     *
     * ### Boolean Operators
     * Use Boolean operators to create complex searches:
     * - `podcast AND marketing` - finds topics that contain both "podcast" and "marketing"
     * - `podcast OR webinar` - finds topics that contain either "podcast" or "webinar"
     * - `podcast NOT beginner` - finds topics about podcasts that don't mention "beginner"
     *
     * ### Complex Queries
     * Combine techniques for more precise searches:
     * - `"podcast marketing" AND (strategy OR tips)` - finds topics with exact phrase "podcast marketing" that also include either "strategy" or "tips"
     * - `(advertising OR monetization) NOT "social media"` - finds topics about advertising or monetization that don't mention "social media"
     * - `"warning * for clean boss" AND sleep` - finds topics with phrase containing "warning" followed by any words and then "for clean boss", that also includes "sleep"

**Note:** Search is not case sensitive. Wildcard (*) can be used as a placeholder for 0 to n words within phrases and combined with boolean operators for powerful, flexible searches.

**Responses:**

- `400`: 
- `200`: 
- `500`: 
- `401`: 

---

### `GET /topics/{topicId}/episodes`

**Get latest episodes for a topic**

General Parameters:
- `topic` string, The topic ID
- `per_page` int, Results per page (default: 25, max: 50)
Episode Parameters:
- `word_level_timestamps` bool, Include word-level timestamps (default: false)
- `remove_timestamps` bool, Remove timestamps from transcript (default: false)
- `remove_speaker_labels` bool, Remove speaker labels (default: false)
- `transcript_formatter` string, Format for transcript text ('paragraph' or default)
Podcast Parameters:
- `show_full_podcast` bool, Include full podcast details (default: false)
- `podcast_has_guests` bool, Filter by podcasts with guests
- `podcast_has_sponsors` bool, Filter by podcasts with sponsors
- `podcast_audience_min` int, Filter by minimum audience size
- `podcast_audience_max` int, Filter by maximum audience size

Get the latest episodes where this topic was mentioned, ordered by posted date.
Results are paginated and limited to the most recent 1000 episodes.
Each page can contain up to 50 results.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `topicId` | path | string | Yes |  |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /topics/trending/export`

**Export trending topics as CSV**

Parameters:
- `timeframe`, string, Timeframe for trends (`daily`/`weekly`/`monthly`)
- `limit`, int, Number of topics to return (default: `10`, max: `100`)

Export trending topics as a downloadable CSV file. Accepts the same
parameters as the trending endpoint. The CSV includes columns for
Topic Name, Topic ID, Occurrence Count, Momentum, and Related Topics.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `timeframe` | query | string | No |  |

**Responses:**

- `200`: 
- `400`: An error
- `500`: An error
- `401`: 

---

### `GET /topics/{topicId}`

**Get topic details**

Parameters:
 - `topic` string, The topic ID
 - `with_history` bool, Include 30-day occurrence history (default: false)

Get detailed information about a specific topic, including:
- Recent occurrences (with episode_id, podcast_id, posted_at, sentiment)
- Related topics
- Trend data
- Lists containing this topic
- History: (Optional) Daily occurrence counts for the last 30 days

The sentiment field in recent_occurrences contains {label, short, score} when available,
or null for legacy data without sentiment analysis.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `topicId` | path | string | Yes |  |
| `with_history` | query | boolean | No |  |

**Responses:**

- `404`: 
- `200`: 
- `401`: 

---

### `GET /topics/{topicId}/related`

**Get related topics**

Parameters:
- `topic`, string, The topic ID

Get topics frequently mentioned alongside the specified topic.
Results are ordered by co-occurrence frequency.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `topicId` | path | string | Yes |  |

**Responses:**

- `404`: 
- `200`: 
- `401`: 

---

### `GET /topics/{topicId}/demographics`

**Get audience demographics for a topic**

Parameters:
- `topic` string, The topic ID
- `per_page` int, Results per page (default: 20, max: 100)
- `page` int, Page number (default: 1)

Get audience demographics for podcasts that discuss this topic.
Returns aggregated demographic data from podcasts where this topic has been mentioned,
including age group, gender skew, education level, engagement level, purchasing power,
living environment, ideological leaning, and family status distributions.

Each podcast in the results includes its full demographic profile and audience size.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `topicId` | path | string | Yes |  |

**Responses:**

- `404`: 
- `200`: 
- `401`: 

---

## Entities

### `GET /entities/{entityId}`

**Get entity details**

Parameters:
- `entity` string, The entity ID
- `with_appearances` bool, Include latest appearances (default: false)
- `appearances_limit` int, Number of appearances to include (default: 10, max: 50)

Get detailed information about a specific entity, including:
- Basic information (name, type)
- Metadata (company, occupation, industry, etc.)
- Social links
- Appearance statistics
- Latest appearances (optional, with limit)

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `entityId` | path | string | Yes |  |
| `with_appearances` | query | boolean | No |  |

**Responses:**

- `404`: 
- `200`: 
- `401`: 

---

### `GET /entities/search`

**Search entities**

Parameters:
- `query` string, Search query
- `search_fields` string|array, Limit search to specific fields (comma-separated or array: `name,company,occupation,industry`)
- `type` string, Filter by entity type (`person`/`organization`/`place`/`thing`)
- `per_page` int, Results per page (default: 25, max: 100)
- `role` string, Filter by appearance role (`host`/`guest`/`sponsor`/`producer`/`mention`)
- `min_appearances` int, Filter by minimum number of appearances
- `order_by` string, Field to sort by (options: `best_match`, `name`, `total_appearances`, `hosts_count`, `guests_count`, `mentions_count`, `type`)
- `order_dir` string, Sort direction (`asc` or `desc`, default: `desc`)

Search for entities by name, company, occupation, or industry. The `search_fields` parameter allows
restricting search to specific fields. Results are paginated and ordered according to the specified criteria.

## Advanced Search Techniques

### Basic Search
Simply enter one or more words to search for entities containing any of those words:
- `podcast marketing` - finds entities mentioning either "podcast" or "marketing" or both

### Exact Phrase Search
Use quotation marks to search for an exact phrase:
- `"podcast marketing"` - finds only entities with the exact phrase "podcast marketing"
     *
     * ### Wildcard Search
     * Use asterisk (*) as a wildcard to replace 0 to n words within phrases:
     * - `"digital * marketing"` - finds phrases like "digital content marketing", "digital inbound marketing"
     * - `"it took * hours to find"` - finds phrases where words appear between "it took" and "hours to find"
     * - `"it * us * get there"` - finds phrases with multiple word placeholders between specified words
     *
     * ### Boolean Operators
     * Use Boolean operators to create complex searches:
     * - `podcast AND marketing` - finds entities that contain both "podcast" and "marketing"
     * - `podcast OR webinar` - finds entities that contain either "podcast" or "webinar"
     * - `podcast NOT beginner` - finds entities about podcasts that don't mention "beginner"
     *
     * ### Complex Queries
     * Combine techniques for more precise searches:
     * - `"podcast marketing" AND (strategy OR tips)` - finds entities with exact phrase "podcast marketing" that also include either "strategy" or "tips"
     * - `(advertising OR monetization) NOT "social media"` - finds entities about advertising or monetization that don't mention "social media"
     * - `"warning * for clean boss" AND sleep` - finds entities with phrase containing "warning" followed by any words and then "for clean boss", that also includes "sleep"

**Note:** Search is not case sensitive. Wildcard (*) can be used as a placeholder for 0 to n words within phrases and combined with boolean operators for powerful, flexible searches.

**Responses:**

- `400`: 
- `200`: 
- `500`: 
- `401`: 

---

### `GET /entities/{entityId}/appearances`

**Get entity appearances**

Parameters:
- `entity` string, The entity ID
- `role` string, Filter by appearance role (`host`/`guest`/`sponsor`/`producer`/`mention`)
- `per_page` int, Results per page (default: 25, max: 100)
- `from` string, Filter by start date (format: YYYY-MM-DD)
- `to` string, Filter by end date (format: YYYY-MM-DD)
- `podcast_id` string, Filter by podcast

Get all appearances for a specific entity, filtered by various criteria and paginated.
Results include episode and podcast details.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `entityId` | path | string | Yes |  |
| `role` | query | string | No |  |
| `podcast_id` | query | string | No |  |
| `from` | query | string | No |  |
| `to` | query | string | No |  |

**Responses:**

- `500`: 
- `200`: 
- `401`: 

---

### `GET /entities/{entityId}/similar`

**Get similar entities**

Parameters:
- `entity` string, The entity ID
- `limit` int, Number of similar entities to return (default: 10, max: 50)
- `min_score` float, Minimum similarity score (0.0-1.0, default: 0.5)

Find entities that are similar to the specified entity based on appearance patterns.
Similarity is calculated based on shared episodes, roles, and metadata.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `entityId` | path | string | Yes |  |

**Responses:**

- `500`: 
- `200`: 
- `401`: 

---

### `GET /episodes/{episodeId}/entities`

**Get episode entities**

Parameters:
- `episode` string, The episode ID
- `role` string, Filter by appearance role (`host`/`guest`/`sponsor`/`producer`/`mention`)

Get all entities mentioned in a specific podcast episode, optionally filtered by role.
Results are grouped by role by default.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `episodeId` | path | string | Yes |  |
| `role` | query | string | No |  |

**Responses:**

- `500`: 
- `200`: 
- `401`: 

---

## Publishers

### `GET /publishers/{publisherId}`

**Get publisher details**

Parameters:
- `publisher` string, The publisher ID
- `with_podcasts` bool, Include podcasts (default: false)
- `podcasts_limit` int, Number of podcasts to include (default: 10, max: 50)

Get detailed information about a specific publisher, including:
- Basic information (name, description, website, etc.)
- Statistics (podcast count, total episodes, total audience, etc.)
- Podcasts (optional, with limit)

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `publisherId` | path | string | Yes |  |
| `with_podcasts` | query | boolean | No |  |

**Responses:**

- `404`: 
- `200`: 
- `401`: 

---

### `GET /publishers/search`

**Search publishers**

Parameters:
- `query` string, Search query
- `search_fields` string|array, Limit search to specific fields (comma-separated or array: `name,description`)
- `verified` boolean, Filter by verification status
- `min_podcasts` int, Filter by minimum number of podcasts
- `max_podcasts` int, Filter by maximum number of podcasts
- `min_audience` int, Filter by minimum audience size
- `max_audience` int, Filter by maximum audience size
- `min_episodes` int, Filter by minimum number of episodes
- `max_episodes` int, Filter by maximum number of episodes
- `per_page` int, Results per page (default: 25, max: 100)
- `order_by` string, Field to sort by (options: `best_match`, `name`, `podcast_count`, `total_audience`, `total_episodes`, `verified`)
- `order_dir` string, Sort direction (`asc` or `desc`, default: `desc`)

Search for publishers by name or description. The `search_fields` parameter allows
restricting search to specific fields. Results are paginated and ordered according to the specified criteria.

## Advanced Search Techniques

### Basic Search
Simply enter one or more words to search for publishers containing any of those words:
- `podcast marketing` - finds publishers mentioning either "podcast" or "marketing" or both

### Exact Phrase Search
Use quotation marks to search for an exact phrase:
- `"podcast marketing"` - finds only publishers with the exact phrase "podcast marketing"
     *
     * ### Wildcard Search
     * Use asterisk (*) as a wildcard to replace 0 to n words within phrases:
     * - `"digital * marketing"` - finds phrases like "digital content marketing", "digital inbound marketing"
     * - `"it took * hours to find"` - finds phrases where words appear between "it took" and "hours to find"
     * - `"it * us * get there"` - finds phrases with multiple word placeholders between specified words
     *
     * ### Boolean Operators
     * Use Boolean operators to create complex searches:
     * - `podcast AND marketing` - finds publishers that contain both "podcast" and "marketing"
     * - `podcast OR webinar` - finds publishers that contain either "podcast" or "webinar"
     * - `podcast NOT beginner` - finds publishers about podcasts that don't mention "beginner"
     *
     * ### Complex Queries
     * Combine techniques for more precise searches:
     * - `"podcast marketing" AND (strategy OR tips)` - finds publishers with exact phrase "podcast marketing" that also include either "strategy" or "tips"
     * - `(advertising OR monetization) NOT "social media"` - finds publishers about advertising or monetization that don't mention "social media"
     * - `"warning * for clean boss" AND sleep` - finds publishers with phrase containing "warning" followed by any words and then "for clean boss", that also includes "sleep"

**Note:** Search is not case sensitive. Wildcard (*) can be used as a placeholder for 0 to n words within phrases and combined with boolean operators for powerful, flexible searches.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `query` | query | string | No |  |
| `verified` | query | boolean | No |  |
| `min_podcasts` | query | string | No |  |
| `max_podcasts` | query | string | No |  |
| `min_audience` | query | string | No |  |
| `max_audience` | query | string | No |  |
| `min_episodes` | query | string | No |  |
| `max_episodes` | query | string | No |  |
| `search_fields` | query | string | No |  |
| `order_by` | query | string | No | Handle sorting parameters |
| `order_dir` | query | string | No |  |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /publishers/{publisherId}/podcasts`

**Get publisher podcasts**

Parameters:
- `publisher` string, The publisher ID
- `per_page` int, Results per page (default: 25, max: 100)

Get all podcasts for a specific publisher, paginated.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `publisherId` | path | string | Yes |  |

**Responses:**

- `500`: 
- `200`: 
- `401`: 

---

## Sponsors

### `GET /sponsors/{sponsor}`

**Get sponsor profile**

Returns detailed profile for a specific sponsor including metrics,
co-sponsors, and appearance history.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `sponsor` | path | string | Yes | Encoded sponsor entity ID (format: en_xxx) |

**Responses:**

- `200`: 
- `404`: 
- `406`: 
- `401`: 

---

### `GET /sponsors`

**Browse top sponsors**

Returns a ranked list of sponsors sorted by the specified criteria.

## Sort Options

| Sort | Description |
|------|-------------|
| reach | Weighted score combining audience reach and podcast count |
| podcast_count | Number of distinct podcasts sponsored |
| rising | Recently discovered sponsors, sorted by podcast count |

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `sort` | query | string | No |  |
| `limit` | query | integer | No |  |

**Responses:**

- `200`: 
- `422`: 
- `401`: 

---

### `GET /sponsors/search`

**Search sponsors**

Full-text search across sponsor names and metadata.
Query must be between 2 and 255 characters.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `query` | query | string | Yes |  |
| `per_page` | query | integer | No |  |
| `page` | query | integer | No |  |

**Responses:**

- `200`: 
- `422`: 
- `401`: 

---

### `GET /sponsors/{sponsor}/podcasts`

**Get sponsored podcasts**

Returns a paginated list of podcasts sponsored by this entity.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `sponsor` | path | string | Yes | Encoded sponsor entity ID (format: en_xxx) |
| `per_page` | query | integer | No |  |
| `page` | query | integer | No |  |

**Responses:**

- `200`: 
- `404`: 
- `406`: 
- `422`: 
- `401`: 

---

### `GET /sponsors/{sponsor}/trend`

**Get sponsor trend data**

Returns time-series data for a sponsor's activity over a given period.

## Period Options

| Period | Description |
|--------|-------------|
| 30d | Last 30 days (daily granularity) |
| 90d | Last 90 days (weekly granularity) |
| 12m | Last 12 months (monthly granularity) |

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `sponsor` | path | string | Yes | Encoded sponsor entity ID (format: en_xxx) |
| `period` | query | string | No |  |

**Responses:**

- `200`: 
- `404`: 
- `406`: 
- `422`: 
- `401`: 

---

## Categories

### `GET /categories`

**List all categories**

Returns a complete list of all podcast categories available in the system. Results are cached for
15 minutes. Each category includes its ID, internal name, and human-readable display name. Use
category IDs to filter alerts or search results by topic.

**Responses:**

- `200`: 
- `401`: 

---

## IAB Categories

### `GET /iab-categories/{id}`

**Get a single IAB category by ID**

GET /api/v1/iab-categories/{id}

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes |  |

**Responses:**

- `200`: 
- `404`: 
- `400`: 
- `401`: 

---

### `GET /iab-categories`

**List all IAB categories**

GET /api/v1/iab-categories

**Responses:**

- `200`: 
- `401`: 

---

## Topic Collections

### `GET /topic-collections`

**List topic collections**

Returns a paginated list of topic collections, sorted by relevance score.
Only collections with at least 5 podcasts are included.

## Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| limit | int | Number of collections to return (default: `25`, max: `100`) |
| page | int | Page number for pagination (default: `1`) |

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `limit` | query | integer | No |  |
| `page` | query | integer | No |  |

**Responses:**

- `200`: 
- `422`: 
- `401`: 

---

### `GET /topic-collections/{slug}`

**Show a topic collection**

Returns a single topic collection by slug, including its associated topic
and top podcasts ranked by relevance.

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| slug | string | URL-friendly identifier |
| topic | object | Associated topic with `topic_id` and `name` |
| podcast_count | int | Total podcasts in collection |
| relevance_score | float | Collection relevance ranking |
| description | string | Collection description |
| podcasts | array | Top podcasts with metadata |

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `slug` | path | string | Yes |  |

**Responses:**

- `200`: 
- `404`: 
- `401`: 

---

## Category Leaders

### `POST /category-leaders/search`

**Search category leaders**

Search for top podcasts in selected categories, ranked by Podscan Reach Score (PRS).
Accepts one or more category selections of different types and returns
de-duplicated results sorted by PRS.

## Request Body

| Field | Type | Description |
|-------|------|-------------|
| selections | array | Array of category selections (required) |
| selections[].type | string | Category type: `category`, `iab`, or `chart` |
| selections[].id | mixed | Category identifier |
| selections[].country | string | Country code for chart type (default: `us`) |
| selections[].platform | string | Platform for chart type: `apple` or `spotify` |
| limit | int | Max results to return (capped by plan limit) |

## Plan Limits

| Plan | Max Results |
|------|-------------|
| Trial | 5 |
| Premium | 25 |
| Professional | 500 |
| Advanced | 1000 |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "limit": {
            "type": [
                "integer",
                "null"
            ],
            "minimum": 1
        },
        "selections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": [
                            "category",
                            "iab",
                            "chart"
                        ]
                    },
                    "id": {
                        "type": "string"
                    },
                    "country": {
                        "type": [
                            "string",
                            "null"
                        ],
                        "maxLength": 10
                    },
                    "platform": {
                        "type": [
                            "string",
                            "null"
                        ],
                        "enum": [
                            "apple",
                            "spotify"
                        ]
                    }
                },
                "required": [
                    "type",
                    "id"
                ]
            },
            "minItems": 1
        }
    },
    "required": [
        "selections"
    ]
}
```

**Responses:**

- `200`: 
- `422`: 
- `401`: 

---

### `POST /category-leaders/export`

**Export category leaders as CSV**

Uses the same search parameters as the search endpoint to generate
a downloadable CSV file including contact fields (email, social links).

## Request Body

| Field | Type | Description |
|-------|------|-------------|
| selections | array | Array of category selections (required) |
| selections[].type | string | Category type: `category`, `iab`, or `chart` |
| selections[].id | mixed | Category identifier |
| selections[].country | string | Country code for chart type (default: `us`) |
| selections[].platform | string | Platform for chart type: `apple` or `spotify` |
| limit | int | Max results to return (capped by plan limit) |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "limit": {
            "type": [
                "integer",
                "null"
            ],
            "minimum": 1
        },
        "selections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": [
                            "category",
                            "iab",
                            "chart"
                        ]
                    },
                    "id": {
                        "type": "string"
                    },
                    "country": {
                        "type": [
                            "string",
                            "null"
                        ],
                        "maxLength": 10
                    },
                    "platform": {
                        "type": [
                            "string",
                            "null"
                        ],
                        "enum": [
                            "apple",
                            "spotify"
                        ]
                    }
                },
                "required": [
                    "type",
                    "id"
                ]
            },
            "minItems": 1
        }
    },
    "required": [
        "selections"
    ]
}
```

**Responses:**

- `200`: 
- `422`: 
- `401`: 

---

## Charts

### `GET /charts/countries/available`

**Get available countries**

Get a list of countries that currently have chart data available.
These are countries where we have active chart data from either Apple Podcasts or Spotify.

The response is an object with:
- country codes as keys (e.g., `us`, `gb`)
- country names as values (e.g., `United States`, `United Kingdom`)

This list may be a subset of all supported countries, as some countries might not
have current chart data available.

**Responses:**

- `200`: 
- `401`: 

---

### `GET /charts/countries/supported`

**Get supported countries**

Get a complete list of all supported countries, regardless of whether they currently
have chart data available. These are all countries where we can potentially track
podcast charts.

The response is an object with:
- country codes as keys (e.g., `us`, `gb`)
- country names as values (e.g., `United States`, `United Kingdom`)

This is the complete list of countries we support, even if some don't currently
have active chart data.

**Responses:**

- `200`: 
- `401`: 

---

### `GET /charts/{platform}/{countryCode}/categories`

**Get available categories**

Get all available podcast categories for a specific country and platform.
Returns categories that currently have chart data available.

Use these parameters:
- platform: Must be either `apple` or `spotify`
- countryCode: 2-letter country code (e.g., `us`, `gb`)
Important: these categories are for chart ranking only and are not the same as the podcast's genre categories.

The response structure differs between platforms:
- For Spotify: A flat list of categories
- For Apple: A hierarchical structure with main categories and subcategories

The response includes:
- country: Object with code and name
- platform: Platform identifier
- categories: Array (Spotify) or Object (Apple) of categories:
  Spotify format:
  - slug: Category identifier
  - name: Display name
  Apple format:
  - slug: Category identifier
  - name: Display name
  - subcategories: Object with subcategories (optional)

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `platform` | path | string | Yes | The platform (apple or spotify) |
| `countryCode` | path | string | Yes | The 2-letter country code |

**Responses:**

- `200`: 
- `404`: 
- `400`: 
- `401`: 

---

### `GET /charts/{platform}/{countryCode}/{category}`

**Get category charts for a country**

Get detailed chart data for a specific category in a country on either Apple Podcasts or Spotify.
Returns all ranked shows in that category.

Use these parameters:
- `platform`: Must be either `apple` or `spotify`
- `countryCode`: 2-letter country code (e.g., `us`, `gb`)
- `category`: Platform-specific category identifier, listed at `/charts/{platform}/{countryCode}/categories`

Important: these categories are for chart ranking only and are not the same as the podcast's genre categories.

The response includes:
- `country`: Object with code and name
- `platform`: Platform identifier (apple/spotify)
- `category`: Category identifier
- `data`: Object containing:
  - `shows`: Array of ranked shows, each containing:
    - `rank`: Chart position
    - `name`: Podcast name
    - `publisher`: Show publisher/author
    - `movement`: Chart movement
    - `podcast_id`: Podcast ID
  - `updated_at`: Last update timestamp

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `platform` | path | string | Yes | The platform (apple or spotify) |
| `countryCode` | path | string | Yes | The 2-letter country code |
| `category` | path | string | Yes | The category identifier |

**Responses:**

- `200`: 
- `404`: 
- `400`: 
- `401`: 

---

### `GET /charts/{platform}/{countryCode}/{category}/top`

**Get top podcasts**

Get the top ranked podcasts for a specific category in a country.

Use these parameters:
- `platform`: Must be either `apple` or `spotify`
- `countryCode`: 2-letter country code (e.g., `us`, `gb`)
- `category`: Platform-specific category identifier, listed at `/charts/{platform}/{countryCode}/categories`
- `limit`: Maximum number of podcasts to return (default: 10, max: 200). Apple Podcasts may return up to 200 items, Spotify up to 50.

Important: these categories are for chart ranking only and are not the same as the podcast's genre categories.

The response includes:
- `country`: Object with code and name
- `platform`: Platform identifier
- `category`: Category identifier
- `limit`: Number of results requested
- `podcasts`: Array of ranked shows, each containing:
  - `rank`: Chart position
  - `name`: Podcast name
  - `publisher`: Show publisher/author
  - `movement`: Chart movement
  - `podcast_id`: Podcast ID

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `platform` | path | string | Yes | The platform (apple or spotify) |
| `countryCode` | path | string | Yes | The 2-letter country code |
| `category` | path | string | Yes | The category identifier |
| `limit` | query | string | No |  |

**Responses:**

- `200`: 
- `204`: No content
- `400`: 
- `401`: 

---

### `GET /charts/{platform}/{countryCode}/{category}/movements`

**Get chart movements**

Get historical chart movement data for a specific category in a country.
Shows how podcasts have moved up and down the charts over time.

Use these parameters:
- `platform`: Must be either `apple` or `spotify`
- `countryCode`: 2-letter country code (e.g., `us`, `gb`)
- `category`: Platform-specific category identifier, listed at `/charts/{platform}/{countryCode}/categories`
- `days`: Number of days of history to return (default: 7, max: 30)

Important: these categories are for chart ranking only and are not the same as the podcast's genre categories.

The response includes:
- `country`: Object with code and name
- `platform`: Platform identifier
- `category`: Category identifier
- `days`: Number of days included
- `data`: Object containing:
  - `entries`: Array of movement records, each containing:
    - `id`: Entry ID
    - `podcast_id`: Podcast ID
    - `name`: Podcast name
    - `publisher`: Show publisher
    - `movement`: Chart movement type
    - `rank`: Current rank
    - `previous_rank`: Previous rank
    - `effective_date`: Date of movement
  - `chart_data`: Array of daily summaries, each containing:
    - `date`: Date string
    - `new`: Count of new entries
    - `up`: Count of upward movements
    - `down`: Count of downward movements
    - `unchanged`: Count of unchanged positions

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `platform` | path | string | Yes | The platform (apple or spotify) |
| `countryCode` | path | string | Yes | The 2-letter country code |
| `category` | path | string | Yes | The category identifier |
| `days` | query | string | No |  |

**Responses:**

- `200`: 
- `404`: 
- `400`: 
- `401`: 

---

### `GET /charts/countries/{countryCode}`

**Get charts for a specific country**

Get charts for all categories in a specific country, for both Apple Podcasts and Spotify.
Returns the top 10 shows for each category on each platform.

Important: these categories are for chart ranking only and are not the same as the podcast's genre categories.

The response includes:
- `country`: Object with code and name
- `charts`: Object with platform-specific data:
  - `spotify`: Object with categories array
  - `apple`: Object with categories array
  Each category contains:
  - `shows`: Array of ranked shows, each containing:
    - `rank`: Chart position
    - `name`: Podcast name
    - `publisher`: Show publisher/author
    - `movement`: Chart movement (NEW/UP/DOWN/UNCHANGED)
    - `podcast_id`: Podcast ID

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `countryCode` | path | string | Yes | The 2-letter country code |

**Responses:**

- `200`: 
- `404`: 
- `401`: 

---

### `GET /charts/countries/{countryCode}/trending`

**Get trending podcasts for a country**

Get trending podcasts across platforms for a specific country. Returns podcasts that are either new entries
or moving up in the charts, ranked by a trending score that takes into account:
- Current chart rank
- Movement type (new/up/down/unchanged)

The response includes:
- `country`: Object with code and name
- `shows`: Array of trending shows, each containing:
  - `rank`: Current chart position
  - `name`: Podcast name
  - `publisher`: Show publisher/author
  - `movement`: Chart movement (`NEW/UP/DOWN/UNCHANGED`)
  - `trending_score`: Score between 0.5 and 1.9
  - `platform`: Source platform (`apple`/`spotify`)
  - `podcast_id`: Podcast ID
  - `best_category`: Object with category and rank

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `countryCode` | path | string | Yes | The 2-letter country code |

**Responses:**

- `200`: 
- `404`: 
- `401`: 

---

## Share of Voice

### `GET /teams/{team}/sov/sets/{set}`

**Get a competitive set's details**

Returns the competitive set with its brands/entities.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |
| `set` | path | string | Yes | Encoded competitive set ID (cs_xxx) |

**Responses:**

- `200`: 
- `401`: 

---

### `PUT /teams/{team}/sov/sets/{set}`

**Update a competitive set**

Updates the name and/or description of an existing competitive set.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |
| `set` | path | string | Yes | Encoded competitive set ID (cs_xxx) |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "maxLength": 255
        },
        "description": {
            "type": [
                "string",
                "null"
            ],
            "maxLength": 1000
        }
    },
    "required": [
        "name"
    ]
}
```

**Responses:**

- `200`: 
- `422`: 
- `401`: 

---

### `DELETE /teams/{team}/sov/sets/{set}`

**Delete a competitive set and all its data**

Permanently removes a competitive set along with all of its brands, snapshots, and keyword match data. This action cannot be undone.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |
| `set` | path | string | Yes | Encoded competitive set ID (cs_xxx) |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /teams/{team}/sov/sets`

**List competitive sets for a team**

Returns all competitive sets owned by the specified team,
including entity counts and 30-day mention totals.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |

**Responses:**

- `200`: 
- `401`: 

---

### `POST /teams/{team}/sov/sets`

**Create a new competitive set**

Creates a competitive set for the specified team. Subject to
plan-based set limits.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "maxLength": 255
        },
        "description": {
            "type": [
                "string",
                "null"
            ],
            "maxLength": 1000
        }
    },
    "required": [
        "name"
    ]
}
```

**Responses:**

- `422`: 
- `201`: 
- `401`: 

---

### `GET /teams/{team}/sov/sets/{set}/data`

**Get SOV breakdown data for a competitive set**

Returns Share of Voice percentages, mention counts, trends,
and sentiment for each brand in the set.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |
| `set` | path | string | Yes | Encoded competitive set ID (cs_xxx) |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /teams/{team}/sov/sets/{set}/timeseries`

**Get SOV time-series chart data**

Returns daily SOV breakdowns over a time period.
Requires the Share of Voice addon.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |
| `set` | path | string | Yes | Encoded competitive set ID (cs_xxx) |

**Responses:**

- `200`: 
- `403`: 
- `401`: 

---

### `GET /teams/{team}/sov/sets/{set}/sentiment`

**Get sentiment breakdown data**

Returns sentiment analysis per brand.
Requires the Share of Voice addon.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |
| `set` | path | string | Yes | Encoded competitive set ID (cs_xxx) |

**Responses:**

- `200`: 
- `403`: 
- `401`: 

---

### `POST /teams/{team}/sov/sets/{set}/brands`

**Add a brand/competitor to a set**

Adds a new brand or competitor to a competitive set. You can optionally link it to an existing entity
and provide custom keywords for keyword-based mention tracking. Subject to plan-based brand limits.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |
| `set` | path | string | Yes | Encoded competitive set ID (cs_xxx) |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "label": {
            "type": "string",
            "maxLength": 255
        },
        "entity_id": {
            "type": [
                "string",
                "null"
            ],
            "maxLength": 100
        },
        "description": {
            "type": [
                "string",
                "null"
            ],
            "maxLength": 2000
        },
        "keyword_tracking_enabled": {
            "type": [
                "boolean",
                "null"
            ]
        },
        "color": {
            "type": [
                "string",
                "null"
            ],
            "pattern": "^#[0-9a-fA-F]{6}$"
        },
        "keywords": {
            "type": [
                "array",
                "null"
            ],
            "items": {
                "type": "string",
                "maxLength": 255
            },
            "maxItems": 50
        }
    },
    "required": [
        "label"
    ]
}
```

**Responses:**

- `422`: 
- `201`: 
- `404`: 
- `401`: 

---

### `PUT /teams/{team}/sov/sets/{set}/brands/{brand}`

**Update a brand in a set**

Updates the label, keywords, description, color, linked entity, or keyword tracking settings for
an existing brand in a competitive set. Only the fields included in the request will be changed.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |
| `set` | path | string | Yes | Encoded competitive set ID (cs_xxx) |
| `brand` | path | string | Yes | Encoded brand ID (cb_xxx) |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "label": {
            "type": [
                "string",
                "null"
            ],
            "maxLength": 255
        },
        "entity_id": {
            "type": [
                "string",
                "null"
            ],
            "maxLength": 100
        },
        "description": {
            "type": [
                "string",
                "null"
            ],
            "maxLength": 2000
        },
        "keyword_tracking_enabled": {
            "type": [
                "boolean",
                "null"
            ]
        },
        "color": {
            "type": [
                "string",
                "null"
            ],
            "pattern": "^#[0-9a-fA-F]{6}$"
        },
        "keywords": {
            "type": [
                "array",
                "null"
            ],
            "items": {
                "type": "string",
                "maxLength": 255
            },
            "maxItems": 50
        }
    }
}
```

**Responses:**

- `422`: 
- `200`: 
- `401`: 

---

### `DELETE /teams/{team}/sov/sets/{set}/brands/{brand}`

**Remove a brand from a set**

Removes a brand/competitor from a competitive set and deletes its associated keyword match data. This action cannot be undone.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |
| `set` | path | string | Yes | Encoded competitive set ID (cs_xxx) |
| `brand` | path | string | Yes | Encoded brand ID (cb_xxx) |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /teams/{team}/sov/sets/{set}/brands/{brand}/keyword-matches`

**Get keyword match details for a brand (drill-down)**

Returns paginated keyword match data for a specific brand in the set,
including episode details, matched keywords, verification status, and excerpts.
Requires the Share of Voice addon.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |
| `set` | path | string | Yes | Encoded competitive set ID (cs_xxx) |
| `brand` | path | string | Yes | Encoded brand ID (cb_xxx) |
| `period` | query | string | No |  |

**Responses:**

- `200`: 
- `403`: 
- `401`: 

---

### `GET /teams/{team}/sov/sets/{set}/export`

**Export SOV data as CSV**

Downloads a CSV file containing the SOV breakdown for all brands
in a competitive set. Requires the Share of Voice addon.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |
| `set` | path | string | Yes | Encoded competitive set ID (cs_xxx) |
| `period` | query | string | No |  |

**Responses:**

- `200`: 
- `403`: An error
- `401`: 

---

### `GET /teams/{team}/sov/sets/{set}/export/keyword-matches/{brand}`

**Export keyword match data for a brand as CSV**

Downloads a CSV file containing keyword matches for a specific brand.
Requires the Share of Voice addon.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |
| `set` | path | string | Yes | Encoded competitive set ID (cs_xxx) |
| `brand` | path | string | Yes | Encoded brand ID (cb_xxx) |
| `period` | query | string | No |  |

**Responses:**

- `200`: 
- `403`: An error
- `401`: 

---

### `GET /teams/{team}/sov/sets/{set}/export/sentiment`

**Export sentiment breakdown data as CSV**

Downloads a CSV file containing sentiment data for all brands
in a competitive set. Requires the Share of Voice addon.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |
| `set` | path | string | Yes | Encoded competitive set ID (cs_xxx) |
| `period` | query | string | No |  |

**Responses:**

- `200`: 
- `403`: An error
- `401`: 

---

### `GET /teams/{team}/sov/sets/{set}/export/timeseries`

**Export time-series SOV data as CSV**

Downloads a CSV file containing daily SOV data for all brands
in a competitive set. Requires the Share of Voice addon.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID (te_xxx) |
| `set` | path | string | Yes | Encoded competitive set ID (cs_xxx) |
| `period` | query | string | No |  |

**Responses:**

- `200`: 
- `403`: An error
- `401`: 

---

## Reports

### `GET /teams/{team}/reports/{report}`

**Show a single report**

Returns the full details of a report, including its configuration, current status, and progress metrics. The response shape changes depending on the report's status.
## Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| per_page | int | 50 | Number of result items per page (1–100). Only applies to completed reports. |
| page | int | 1 | Page number for result items. Only applies to completed reports. |

## Response by Status

**When the report is not yet completed** (status is `pending`, `processing`, `failed`, or `cancelled`), the response contains only the `report` object:

- `report` — The report object with status, filters, progress metrics (`items_checked`, `positive_matches`, `progress_percentage`), and timestamps

**When the report is completed**, the response additionally includes the matched results:

- `report` — The report object (same as above)
- `items` — Paginated array of report items (matches). Each item contains `report_item_id`, `podcast_id`, `episode_id`, `podcast_name`, `episode_title`, `detected_filter`, `detected_type`, `detected_excerpt`, and `created_at`.
- `items_pagination` — Pagination metadata with `total`, `per_page`, `current_page`, `last_page`, `from`, `to`

## Match Types

Each report item has a `detected_type` field indicating where the match was found:

| Type | Description |
|------|-------------|
| title | Match found in the episode title |
| description | Match found in the episode description |
| transcription | Match found in the episode transcript |

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID |
| `report` | path | string | Yes | Encoded report ID |
| `per_page` | query | string | No |  |

**Responses:**

- `200`: 
- `401`: 

---

### `DELETE /teams/{team}/reports/{report}`

**Delete a report**

Archives a report, removing it from the default report list. The report is not permanently deleted — it can still be retrieved by passing `include_archived=true` to the **List reports** endpoint.
## Restrictions

Reports that are currently running (`pending` or `processing`) cannot be deleted. Cancel them first using the **Cancel** endpoint, then delete.

| Current Status | Can Delete? |
|----------------|-------------|
| completed | Yes |
| failed | Yes |
| cancelled | Yes |
| pending | No — cancel first |
| processing | No — cancel first |

## Response

Returns `success: true` and a confirmation message. The report's `archived_at` timestamp is set, which excludes it from the default list view.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID |
| `report` | path | string | Yes | Encoded report ID |

**Responses:**

- `200`: 
- `422`: 
- `401`: 

---

### `GET /teams/{team}/reports`

**List all reports for a team**

Returns a paginated list of reports for the specified team, ordered by creation date (newest first). Archived reports are excluded by default — use `include_archived=true` to include them.

Each report object in the response contains its current status, filter configuration, and progress metrics. Use this endpoint to build a report dashboard or check on recently created reports.
## Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| per_page | int | 25 | Results per page (1–100) |
| status | string | — | Filter by report status (see table below) |
| include_archived | bool | false | Set to `true` to include archived (deleted) reports |

## Report Statuses

| Status | Description |
|--------|-------------|
| pending | Report is queued and waiting to be processed |
| processing | Report is actively scanning episodes |
| completed | Report has finished — results are available |
| failed | Report encountered an error during processing |
| cancelled | Report was cancelled before completion |

## Response

The response contains a `reports` array and a `pagination` object. Each report includes `report_id`, `report_name`, `status`, `filters`, `lookback_days`, `items_checked`, `positive_matches`, `progress_percentage`, and timestamps.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID |
| `per_page` | query | string | No |  |
| `status` | query | string | No |  |

**Responses:**

- `200`: 
- `401`: 

---

### `POST /teams/{team}/reports`

**Create a new report**

Creates a new report and immediately queues it for background processing. The report scans podcast episodes published within the `lookback_days` window, searching for matches against the provided `filters`.

Once created, the report enters `pending` status and transitions to `processing` as it begins scanning. Use the **Get report status** endpoint to poll for progress, or the **Show report** endpoint to retrieve results once completed.
## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| name | string | A descriptive name for your report (max 255 chars) |
| filters | string | Newline-separated search expressions to match against episode content (max 10000 chars). Each line is a separate filter. |
| lookback_days | int | How many days back to search. Must be within your plan's lookback limit. |

## Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| scan_id | string | Encoded alert ID — links the report to an existing alert for reference |
| languages | string | Comma-separated language codes (e.g. `en,de,fr`) to restrict results |
| regions | string | Comma-separated region codes (e.g. `us,gb,de`) to restrict results |
| restrict_to_podcasts | string | Comma-separated encoded podcast IDs — only search these podcasts |
| ignore_podcasts | string | Comma-separated encoded podcast IDs — exclude these podcasts |
| restrict_to_categories | string | Comma-separated encoded category IDs — only search podcasts in these categories |
| ignore_categories | string | Comma-separated encoded category IDs — exclude podcasts in these categories |
| min_audience_size | int | Only include podcasts with at least this many listeners |
| max_audience_size | int | Only include podcasts with at most this many listeners |
| apple_podcast_rating_min | float | Minimum Apple Podcasts rating (0–5) |
| apple_podcast_rating_max | float | Maximum Apple Podcasts rating (0–5) |
| apple_podcast_rating_count_min | int | Minimum number of Apple Podcasts ratings |
| apple_podcast_rating_count_max | int | Maximum number of Apple Podcasts ratings |
| spotify_podcast_rating_min | float | Minimum Spotify rating (0–5) |
| spotify_podcast_rating_max | float | Maximum Spotify rating (0–5) |
| spotify_podcast_rating_count_min | int | Minimum number of Spotify ratings |
| spotify_podcast_rating_count_max | int | Maximum number of Spotify ratings |
| min_episode_count | int | Only include podcasts with at least this many episodes |
| max_episode_count | int | Only include podcasts with at most this many episodes |

## Plan Limits

Report creation is subject to your subscription plan's limits. If a limit is exceeded, the API returns a `422` error with a descriptive message.

| Plan | Lookback | Monthly Reports | Concurrent | Max Results |
|------|----------|-----------------|------------|-------------|
| Trial / Essentials | 7 days | 3 | 1 | 250 |
| Premium | 30 days | 10 | 1 | 1,000 |
| Professional | 90 days | 30 | 2 | 5,000 |
| Advanced | 180 days | 60 | Unlimited | 50,000 |

## Response

Returns `201 Created` with the new report object. The report will have `status: "pending"` initially. The `max_results` field reflects your plan's limit (not a user-provided value).

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "maxLength": 255
        },
        "filters": {
            "type": "string",
            "maxLength": 10000
        },
        "lookback_days": {
            "type": "integer",
            "minimum": 1
        },
        "scan_id": {
            "type": [
                "string",
                "null"
            ]
        },
        "languages": {
            "type": [
                "string",
                "null"
            ],
            "maxLength": 2000
        },
        "regions": {
            "type": [
                "string",
                "null"
            ],
            "maxLength": 2000
        },
        "restrict_to_categories": {
            "type": [
                "string",
                "null"
            ]
        },
        "restrict_to_podcasts": {
            "type": [
                "string",
                "null"
            ]
        },
        "ignore_categories": {
            "type": [
                "string",
                "null"
            ]
        },
        "ignore_podcasts": {
            "type": [
                "string",
                "null"
            ]
        },
        "min_audience_size": {
            "type": [
                "integer",
                "null"
            ],
            "minimum": 0
        },
        "max_audience_size": {
            "type": [
                "integer",
                "null"
            ],
            "minimum": 0
        },
        "apple_podcast_rating_min": {
            "type": [
                "number",
                "null"
            ],
            "minimum": 0,
            "maximum": 5
        },
        "apple_podcast_rating_max": {
            "type": [
                "number",
                "null"
            ],
            "minimum": 0,
            "maximum": 5
        },
        "apple_podcast_rating_count_min": {
            "type": [
                "integer",
                "null"
            ],
            "minimum": 0
        },
        "apple_podcast_rating_count_max": {
            "type": [
                "integer",
                "null"
            ],
            "minimum": 0
        },
        "spotify_podcast_rating_min": {
            "type": [
                "number",
                "null"
            ],
            "minimum": 0,
            "maximum": 5
        },
        "spotify_podcast_rating_max": {
            "type": [
                "number",
                "null"
            ],
            "minimum": 0,
            "maximum": 5
        },
        "spotify_podcast_rating_count_min": {
            "type": [
                "integer",
                "null"
            ],
            "minimum": 0
        },
        "spotify_podcast_rating_count_max": {
            "type": [
                "integer",
                "null"
            ],
            "minimum": 0
        },
        "min_episode_count": {
            "type": [
                "integer",
                "null"
            ],
            "minimum": 0
        },
        "max_episode_count": {
            "type": [
                "integer",
                "null"
            ],
            "minimum": 0
        }
    },
    "required": [
        "name",
        "filters",
        "lookback_days"
    ]
}
```

**Responses:**

- `201`: 
- `406`: 
- `404`: 
- `422`: 
- `401`: 

---

### `GET /teams/{team}/reports/{report}/status`

**Get report status**

A lightweight endpoint for polling a report's processing progress. Returns only status and progress fields, making it ideal for frequent polling without transferring the full report payload.
## Recommended Polling Strategy

Poll this endpoint every 3–5 seconds while `is_processing` is `true`. Once `is_completed` becomes `true`, fetch the full report with the **Show report** endpoint to access the results.

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| report_id | string | Encoded report ID |
| status | string | Current status: `pending`, `processing`, `completed`, `failed`, `cancelled` |
| status_label | string | Human-readable status (e.g. "Processing", "Completed") |
| items_checked | int | Number of episodes scanned so far |
| positive_matches | int | Number of matching episodes found so far |
| progress_percentage | float | Estimated completion percentage (0–100) |
| estimated_total | int or null | Estimated total episodes to scan (available once processing starts) |
| total_episodes_in_range | int or null | Total episodes within the lookback window |
| formatted_duration | string or null | Human-readable processing time (e.g. "2m 30s"), available after completion |
| is_completed | bool | `true` when the report has finished successfully |
| is_processing | bool | `true` when the report is actively scanning |

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID |
| `report` | path | string | Yes | Encoded report ID |

**Responses:**

- `200`: 
- `401`: 

---

### `POST /teams/{team}/reports/{report}/retry`

**Retry a report**

Re-runs a report from scratch. All previous results are cleared and the report is re-queued for processing with its original configuration. This is useful for re-running a report after a failure, or regenerating a completed report with fresher data.
## Retryable Statuses

| Current Status | Can Retry? |
|----------------|------------|
| completed | Yes — clears results and re-runs |
| failed | Yes — resets error state and re-runs |
| cancelled | Yes — re-queues from scratch |
| pending | No — already queued |
| processing | No — currently running |

Attempting to retry a `pending` or `processing` report returns a `422` error.

## Limits

Retrying a report counts against your plan's concurrency limits. If you already have the maximum number of reports processing, the retry will be rejected with a `422` error explaining the concurrency limit.

## Response

On success, returns `success: true` and the updated report object with `status: "pending"`. The previous `items`, `items_checked`, and `positive_matches` are all reset to zero.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID |
| `report` | path | string | Yes | Encoded report ID |

**Responses:**

- `200`: 
- `422`: 
- `401`: 

---

### `POST /teams/{team}/reports/{report}/cancel`

**Cancel a report**

Cancels a report that is currently waiting or in progress. Cancelling a report frees up your concurrency slot, allowing you to create a new report immediately.
## Cancellable Statuses

| Current Status | Can Cancel? |
|----------------|-------------|
| pending | Yes |
| processing | Yes |
| completed | No — use **Delete** instead |
| failed | No — use **Retry** or **Delete** |
| cancelled | No — already cancelled |

Attempting to cancel a report in a non-cancellable status returns a `422` error.

## Response

On success, returns `success: true` and the updated report object with `status: "cancelled"`.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID |
| `report` | path | string | Yes | Encoded report ID |

**Responses:**

- `200`: 
- `422`: 
- `401`: 

---

### `POST /teams/{team}/reports/{report}/share`

**Share a report**

Generates a unique share token that enables public, read-only access to the report without authentication. Anyone with the token can view the report results. Only completed reports can be shared.
## How Sharing Works

- A 64-character random token is generated and associated with the report
- The report's `is_shared` flag becomes `true` and the `share_token` is included in subsequent API responses
- Sharing an already-shared report generates a new token, invalidating the previous one
- Use the **Unshare** endpoint to revoke access

## Response

Returns `success: true`, the `share_token` string, and the updated report object.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID |
| `report` | path | string | Yes | Encoded report ID |

**Responses:**

- `200`: 
- `422`: 
- `401`: 

---

### `POST /teams/{team}/reports/{report}/unshare`

**Unshare a report**

Revokes the public share token for a report, immediately disabling public access. Any existing links using the previous share token will stop working.
## Response

Returns `success: true` and the updated report object with `is_shared: false` and `share_token: null`.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID |
| `report` | path | string | Yes | Encoded report ID |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /teams/{team}/reports/{report}/export/{format}`

**Export report results**

Downloads all report results as a file in the requested format. Only completed reports can be exported — attempting to export a report in any other status returns a `422` error.
## Available Formats

| Format | Content-Type | Description |
|--------|-------------|-------------|
| csv | text/csv | Comma-separated values, suitable for spreadsheet import |
| xlsx | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet | Excel workbook with formatted columns |
| json | application/json | Structured JSON array of all matched items |
| markdown | text/markdown | Human-readable Markdown document with report title and results |

Requesting an unsupported format (e.g. `pdf`) returns a `422` error.

## Export Contents

Each row/item in the export contains:

- **podcast_name** — Name of the podcast
- **episode_title** — Title of the matching episode
- **detected_filter** — The filter expression that matched
- **detected_type** — Where the match was found (`title`, `description`, or `transcription`)
- **detected_excerpt** — Text excerpt surrounding the match, with the matched term highlighted using `**bold**` markers
- **detected_timestamp** — Timestamp in the transcript where the match occurs (if available)
- **episode_posted_at** — When the episode was published
- **podcast_website** — Podcast website URL (if available)
- **podcast_email** — Podcast contact email (if available)
- **podcast_id** — Encoded podcast ID
- **episode_id** — Encoded episode ID

## Response

Returns a file download. The filename follows the pattern `report_{report_id}_{date}.{ext}`.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | Encoded team ID |
| `report` | path | string | Yes | Encoded report ID |
| `format` | path | string | Yes | Export format: `csv`, `xlsx`, `json`, or `markdown` |

**Responses:**

- `200`: 
- `401`: 

---

## Lists

### `GET /teams/{team}/lists/{list}`

**Show a single list & its items**

Get detailed information about a single list, including all its items.

**Important**: When `include_items=true`, the response includes a maximum of 100 most recent
items per type. For Mentions specifically, only the latest 100 mentions (by ID descending)
are included. Use the paginated items endpoint for full access to all items.

Use these query parameters to filter and sort the results:
- `per_page`: Number of items per page (default: 25, max: 100)
- `page`: Page number to retrieve
- `order_dir`: Sort direction for items by addition date ('asc' or 'desc', default: 'desc')
- `types[]`: Filter items by type (can specify multiple: Podcast/PodcastEpisode/Alert/Mention/Topic)
- `search`: Search query to filter items by name/title
- `added_after`: Filter items added after this date (format: YYYY-MM-DD)
- `added_before`: Filter items added before this date (format: YYYY-MM-DD)

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team |
| `list` | path | string | Yes | The ID of the list |

**Responses:**

- `200`: 
- `400`: 
- `404`: 
- `401`: 

---

### `PUT /teams/{team}/lists/{list}`

**Update a list**

Update a list's properties. The following fields can be updated:
- `name`: List name (string, max 255 characters)
- `description`: List description (string)
- `is_private`: Whether the list is private (boolean)
- `webhook_url`: Webhook URL for list updates (string)
- `webhook_active`: Whether the webhook is active (boolean)

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team |
| `list` | path | string | Yes | The ID of the list |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "maxLength": 255
        },
        "description": {
            "type": [
                "string",
                "null"
            ]
        },
        "is_private": {
            "type": "boolean"
        },
        "webhook_url": {
            "type": [
                "string",
                "null"
            ],
            "format": "uri"
        },
        "webhook_active": {
            "type": "boolean"
        }
    }
}
```

**Responses:**

- `200`: 
- `403`: 
- `404`: 
- `422`: 
- `401`: 

---

### `DELETE /teams/{team}/lists/{list}`

**Delete a list**

Delete a list and all its item associations. This cannot be undone.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team |
| `list` | path | string | Yes | The ID of the list |

**Responses:**

- `200`: 
- `404`: 
- `401`: 

---

### `GET /teams/{team}/lists`

**List all lists**

Get all lists for a team. Lists can contain podcasts, episodes, alerts, mentions, and topics.

Query parameters:
- `has_only`: Filter lists to only those containing these item types (comma-separated: podcast,episode,alert,mention,topic,entity,publisher)
- `has_none_of`: Filter lists to only those NOT containing these item types (comma-separated)

The response includes:
- `lists`: Array of lists, each containing:
  - `list_id`: List identifier
  - `name`: List name
  - `description`: List description (optional)
  - `type`: List type
  - `is_private`: Whether the list is private
  - `item_count`: Number of items in the list
  - `item_counts`: Breakdown of items by type
  - `items`: Array of items (if include_items is true)
  - `created_at`: Creation timestamp
  - `updated_at`: Last update timestamp

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team |
| `include_items` | query | string | No |  |
| `has_only` | query | string | No |  |
| `has_none_of` | query | string | No |  |

**Responses:**

- `200`: 
- `401`: 

---

### `POST /teams/{team}/lists`

**Create a new list**

Create a new list for the team. Lists can be used to organize podcasts, episodes, alerts, mentions, and topics.

Required fields:
- `name`: List name (string, max 255 characters)
- `type`: List type (string, max 50 characters) — use 'custom' for API-created lists

Optional fields:
- `description`: List description (string)
- `is_private`: Whether the list is private (boolean, defaults to false)
- `webhook_url`: Webhook URL for list updates (string)
- `webhook_active`: Whether the webhook is active (boolean, defaults to false)
- `item`: Optional initial item to add to the list (object with `type` and `id`, where type is one of: Podcast, PodcastEpisode, Alert, Mention, Topic)

The response includes the newly created list object.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "maxLength": 255
        },
        "type": {
            "type": "string",
            "maxLength": 50
        },
        "description": {
            "type": [
                "string",
                "null"
            ]
        },
        "is_private": {
            "type": "boolean"
        },
        "webhook_url": {
            "type": [
                "string",
                "null"
            ],
            "format": "uri"
        },
        "webhook_active": {
            "type": "boolean"
        },
        "item": {
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": [
                        "Podcast",
                        "PodcastEpisode",
                        "Alert",
                        "Mention",
                        "Topic"
                    ]
                },
                "id": {
                    "type": "string"
                }
            }
        }
    },
    "required": [
        "name"
    ]
}
```

**Responses:**

- `200`: 
- `400`: 
- `403`: 
- `422`: 
- `401`: 

---

### `POST /teams/{team}/lists/{list}/items`

**Add item to list**

Add a new item to a list. Required fields:
- `type`: Item type (Podcast/PodcastEpisode/Alert/Mention/Topic)
- `id`: Item identifier

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team |
| `list` | path | string | Yes | The ID of the list |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "type": {
            "type": "string",
            "enum": [
                "Podcast",
                "PodcastEpisode",
                "Alert",
                "Mention",
                "Topic",
                "Entity",
                "Publisher"
            ]
        },
        "id": {
            "type": "string"
        }
    },
    "required": [
        "type",
        "id"
    ]
}
```

**Responses:**

- `400`: 
- `200`: 
- `404`: 
- `422`: 
- `401`: 

---

### `DELETE /teams/{team}/lists/{list}/items`

**Remove item from list**

Remove an item from a list. Required fields:
- `type`: Item type (Podcast/PodcastEpisode/Alert/Mention/Topic)
- `id`: Item identifier

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team |
| `list` | path | string | Yes | The ID of the list |
| `type` | query | string | Yes |  |
| `id` | query | string | Yes |  |

**Responses:**

- `400`: 
- `200`: 
- `404`: 
- `422`: 
- `401`: 

---

## Exports

### `GET /exports/episodes`

**List available episode exports**

This endpoint provides access to daily episode exports that are generated and stored on S3. Each export file is a JSON object containing a list of all episodes that were published that day with their transcripts and as much of additionally analyzed data we can provide.

IMPORTANT ACCESS RESTRICTIONS:
- This feature is only available to Podscan subscribers on the Advanced or Professional plans.
- Trial users and subscribers on the Essentials or Premium plans do not have access to exports.
- Even if you are on the Advanced or Professional plan, you must reach out to our team to enable this feature.

**Responses:**

- `200`: 
- `403`: 
- `401`: 

---

### `GET /exports/podcasts`

**List available podcast exports**

This endpoint provides access to weekly podcast exports that are generated and stored on S3. Each export file is a JSON object containing a list of all podcasts that we are currently tracking in the Podscan database, for each podcast we include as much information and additional metadata as we can find.

IMPORTANT ACCESS RESTRICTIONS:
- This feature is only available to Podscan subscribers on the Advanced or Professional plans.
- Trial users and subscribers on the Essentials or Premium plans do not have access to exports.
- Even if you are on the Advanced or Professional plan, you must reach out to our team to enable this feature.

**Responses:**

- `200`: 
- `403`: 
- `401`: 

---

### `GET /exports/download`

**Download a specific export**

This endpoint generates a temporary pre-signed URL for downloading a specific export file.
The URL expires after 30 minutes.

IMPORTANT ACCESS RESTRICTIONS:
- This feature is only available to Podscan subscribers on the Advanced or Professional plans.
- Trial users and subscribers on the Essentials or Premium plans do not have access to exports.
- Even if you are on the Advanced or Professional plan, you must reach out to our team to enable this feature.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `path` | query | string | No |  |

**Responses:**

- `500`: 
- `200`: 30 minute URL
- `400`: 
- `404`: 
- `403`: 
- `401`: 

---

## Teams

### `GET /teams`

**List all teams**

Returns all teams that the authenticated API key can access, including their basic information
and firehose configuration.

The response includes:
- `teams`: Array of teams, each containing:
  - `team_id`: Team identifier
  - `team_name`: Team name
  - `created_at`: Creation timestamp
  - `updated_at`: Last update timestamp
  - `corrections`: Comma-separated list of corrections

**Responses:**

- `200`: 
- `401`: 

---

### `GET /teams/{team}/webhooks`

**List active webhooks**

Returns all active webhooks for a team. This includes:
- Team-level webhooks
- Firehose webhooks
- Alert-specific webhooks
- List-specific webhooks

The response includes:
- `webhooks`: Array of webhook configurations, each containing:
  - `webhook_type`: Type of webhook (team_webhook/firehose/alert_webhook/list_webhook)
  - `webhook_url`: URL where data is sent
  - `webhook_active`: Whether the webhook is active
  - `source_id`: ID of the source (team/alert/list)
  - `source_type`: Type of the source (team/alert/list)

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `team` | path | string | Yes | The ID of the team |

**Responses:**

- `200`: 
- `401`: 

---

### `GET /teams/{teamId}/firehose/settings`

**Get firehose settings**

Returns the complete firehose configuration for a team. This includes webhook settings,
content filtering rules, and data inclusion preferences.

The response includes:
- `settings`: Object containing:
  - `enabled`: Whether the firehose is enabled
  - `webhook_url`: URL where webhook data is sent
  - `compression_enabled`: Whether payload compression is enabled
  - `include_entities`: Whether to include entity data
  - `include_topics`: Whether to include topic data
  - `include_extraction`: Whether to include extraction data
  - `restricted_to`: Content restrictions
    - `podcasts`: Array of podcast IDs to include
    - `categories`: Array of category IDs to include
  - `blocked`: Content blocks
    - `podcasts`: Array of podcast IDs to exclude
    - `categories`: Array of category IDs to exclude

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `teamId` | path | string | Yes |  |

**Responses:**

- `200`: 
- `401`: 

---

### `PUT /teams/{teamId}/firehose/settings`

**Update firehose settings**

Updates the firehose configuration for a team. All fields are optional - only provided fields will be updated.

Accepts the following fields:
- `enabled`: Enable/disable the firehose (boolean)
- `webhook_url`: URL for sending webhook data (string)
- `compression_enabled`: Enable GZIP compression (boolean)
- `include_entities`: Include entity data in payloads (boolean)
- `include_topics`: Include topic data in payloads (boolean)
- `include_extraction`: Include extraction data in payloads (boolean)
- `restricted_to`: Content restrictions object
  - `podcasts`: Array of podcast IDs to include
  - `categories`: Array of category IDs to include
- `blocked`: Content blocks object
  - `podcasts`: Array of podcast IDs to exclude
  - `categories`: Array of category IDs to exclude

The response includes the complete updated settings in the same format as getFirehoseSettings.

**Parameters:**

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `teamId` | path | string | Yes |  |

**Request Body:**

Content-Type: `application/json`

```json
{
    "type": "object",
    "properties": {
        "enabled": {
            "type": "boolean"
        },
        "webhook_url": {
            "type": [
                "string",
                "null"
            ],
            "format": "uri"
        },
        "compression_enabled": {
            "type": "boolean"
        },
        "include_entities": {
            "type": "boolean"
        },
        "include_topics": {
            "type": "boolean"
        },
        "include_extraction": {
            "type": "boolean"
        },
        "restricted_to": {
            "type": "object",
            "properties": {
                "podcasts": {
                    "type": [
                        "array",
                        "null"
                    ],
                    "items": {
                        "type": "string"
                    }
                },
                "categories": {
                    "type": [
                        "array",
                        "null"
                    ],
                    "items": {
                        "type": "string"
                    }
                }
            }
        },
        "blocked": {
            "type": "object",
            "properties": {
                "podcasts": {
                    "type": [
                        "array",
                        "null"
                    ],
                    "items": {
                        "type": "string"
                    }
                },
                "categories": {
                    "type": [
                        "array",
                        "null"
                    ],
                    "items": {
                        "type": "string"
                    }
                }
            }
        }
    }
}
```

**Responses:**

- `200`: 
- `422`: 
- `401`: 

---
