# YouTube OAuth verification

Chris or Angus submits this. The OAuth client goes in the same Cloud project as `YOUTUBE_API_KEY`. YouTube allows one Cloud project per API client.

Launch mode is Testing until Google verifies the sensitive scopes. Do not publish the app to In production before verification. Do not add scopes. Do not create a second Cloud project.

## Scopes

Request only these two:

- `https://www.googleapis.com/auth/youtube.force-ssl`
- `https://www.googleapis.com/auth/yt-analytics.readonly`

No openid, email, profile, youtube.readonly, or youtube.upload.

### Why youtube.force-ssl

Taylslate reads the caption track on a video the creator booked, so it can check that the sponsor read aired. `captions.list` and `captions.download` accept only `youtube.force-ssl` or `youtubepartner`. There is no narrower caption scope. `youtube.force-ssl` also allows writes. Taylslate never uploads, edits, deletes, or posts. The settings page says that before the creator connects.

### Why yt-analytics.readonly

Taylslate reads views, estimated minutes watched, average view duration, and the audience-retention points that cover the ad read, for videos on that creator's Taylslate deals. Those values are stored raw. Taylslate does not compute a score from them. A brand does not see them in this job. `yt-analytics.readonly` cannot change the channel.

## Demo video script

Record on `https://www.taylslate.com` after this job is deployed, in English. `www.taylslate.com` is the canonical host. Vercel 307s `https://taylslate.com` to www at the domain level, keeping the path and query, so the OAuth redirect URI, the disconnect Origin check, and the callback cookie all use www. `readYoutubeOauthConfig` also rewrites an apex `NEXT_PUBLIC_SITE_URL` to www. `NEXT_PUBLIC_SITE_URL` should be `https://www.taylslate.com`. Upload the video to YouTube as Unlisted.

1. Open `/settings/youtube` while signed in as a show. Show the app name Taylslate on the consent screen.
2. Click Connect YouTube. On the Google consent screen, keep the address bar visible so the OAuth client id is readable. Show both scopes.
3. Approve. Return to `/settings/youtube` and show the connected channel.
4. Show a caption-based aircheck on the admin review screen for a YouTube line. The provider is `youtube-captions`. Point at the match result. Do not show a full caption dump if you can avoid it. An excerpt is enough.
5. Show that the analytics scope is in use without a product screen. After the analytics pass has run (at least 48 hours after the video was published, and within 14 days), open `youtube_aircheck_metrics` in the Supabase table view and show the row for that aircheck: `views`, `estimated_minutes_watched`, `average_view_duration_seconds`, and the `retention` points. Do not show a computed score. There is no admin screen for these values. An admin metrics view would need Chris's OK.
6. Disconnect on `/settings/youtube`.
7. Open `https://security.google.com/settings/security/permissions` and remove Taylslate there as well.

## Submission checklist

1. Search Console: verify `taylslate.com` as a Domain property, signed in as a project Owner or Editor.
2. Branding: app name Taylslate, support email, logo at least 120 by 120, home `https://www.taylslate.com`, privacy `https://www.taylslate.com/privacy`, terms `https://www.taylslate.com/terms`, authorized domain `taylslate.com`.
3. Audience: External, publishing status Testing.
4. Data Access: the two scopes above and nothing else.
5. Web client. Redirect URI exactly `https://www.taylslate.com/api/youtube/callback`. Put the client id and secret in Vercel Production as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. Generate `YOUTUBE_TOKEN_ENC_KEY` (32 random bytes, base64). Set `NEXT_PUBLIC_SITE_URL` to `https://www.taylslate.com` if it is still the bare domain. Enable the YouTube Analytics API if it is off.
6. After the privacy and terms text is live: Verify Branding, then Publish branding.
7. When this job is deployed: add each launch creator as a test user (100 max). They will see a testing warning and must reconnect every 7 days. Ask them to connect within 2 days before their air date.
8. Record the demo above and upload it as Unlisted.
9. Submit sensitive-scope verification. Paste the two justifications above and the video link. Answer reviewer mail quickly. A question restarts the clock.
10. The same day, file the YouTube API Services Audit and Quota Extension form: `https://support.google.com/youtube/contact/yt_api_form`. Include the Cloud project number, the privacy policy, terms, and home page, and screenshots of consent, both scopes, and revocation.

Endpoints to list on the quota form: `captions.list`, `captions.download`, `videos.list`, `channels.list`, `playlistItems.list`, `search.list`.

Since June 1, 2026, `search.list` has its own bucket (default 100 calls a day) and 10,000 units a day covers the other methods. The library pull uses about 30 searches a day. Ask for more search calls on the same form if brand discovery depends on live search.

Google's stated review is up to 10 days for sensitive scopes, longer if they ask questions. Do not plan on extra quota before January.
