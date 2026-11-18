import { describe, expect, it } from "vitest";
import { channelIsMadeForKids, libraryRowIsMadeForKids } from "./kids";

describe("channelIsMadeForKids", () => {
  it("excludes madeForKids true and keeps false", () => {
    expect(channelIsMadeForKids({ madeForKids: true, topicCategories: ["Fitness"] })).toBe(true);
    expect(
      channelIsMadeForKids({
        madeForKids: false,
        topicCategories: ["Children's music", "https://en.wikipedia.org/wiki/Nursery_rhyme"],
        nicheTags: ["Children's music"],
      })
    ).toBe(false);
  });

  it("treats a null flag as kids only for a narrow topic or niche phrase", () => {
    expect(
      channelIsMadeForKids({
        madeForKids: null,
        topicCategories: ["https://en.wikipedia.org/wiki/Children%27s_music"],
      })
    ).toBe(true);
    expect(
      channelIsMadeForKids({
        madeForKids: null,
        topicCategories: ["Nursery rhyme"],
      })
    ).toBe(true);
    expect(
      channelIsMadeForKids({
        madeForKids: null,
        topicCategories: ["https://en.wikipedia.org/wiki/Nursery_rhymes"],
      })
    ).toBe(true);
    expect(
      channelIsMadeForKids({
        madeForKids: null,
        nicheTags: ["Kids music"],
      })
    ).toBe(true);
    expect(
      channelIsMadeForKids({
        madeForKids: null,
        topicCategories: ["Fitness"],
        nicheTags: ["Parenting & Family", "Music"],
      })
    ).toBe(false);
    expect(
      channelIsMadeForKids({
        madeForKids: null,
        topicCategories: ["Toy", "Hobby", "Entertainment"],
        nicheTags: ["Parenting & Family"],
      })
    ).toBe(false);
    expect(channelIsMadeForKids({ madeForKids: undefined, topicCategories: [] })).toBe(false);
  });

  it("reads the stored row shape", () => {
    expect(libraryRowIsMadeForKids({ made_for_kids: true, topic_categories: ["Fitness"], niche_tags: [] })).toBe(
      true
    );
    expect(
      libraryRowIsMadeForKids({
        made_for_kids: false,
        topic_categories: ["Children's music"],
        niche_tags: [],
      })
    ).toBe(false);
    expect(
      libraryRowIsMadeForKids({
        made_for_kids: null,
        topic_categories: ["https://en.wikipedia.org/wiki/Children%27s_music"],
        niche_tags: ["Parenting & Family"],
      })
    ).toBe(true);
  });
});
