# KIDS-FILTER1: made-for-kids YouTube channels stay out of brand results

Grounded on `origin/main` at `c0a366e`. Migration 095 is in the repo and is not applied. Nothing in this job was written to `ldtmhafewfifdizgfrnn`.

## What changed

`youtube_channels.made_for_kids` is a nullable boolean. The library pull and the stats refresh store YouTube `channels.list` `status.madeForKids` on the details call they already make. That call stays 1 unit. Parts do not add units.

A true flag fails `passesYouTubeMarketFilter`. A false flag stays eligible. A null flag fails only when a topic category or niche tag is children's music, kids music, or nursery rhyme, including the Wikipedia URL. Parenting, Toy, and Hobby do not match.

Brand search, discovery, the live library fallback, and the list scoring consumes all drop those channels. The code keeps working when 095 is not applied yet: a missing `made_for_kids` column is omitted, and the topic fallback still runs.

## Where

See the KIDS-FILTER1 section in `docs/SENIOR_DEV_HANDOFF.md`.

## Tests

Ship commands are recorded in the PR.
