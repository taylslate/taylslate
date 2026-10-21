import { describe, expect, it } from "vitest";
import {
  omitClientPodscanId,
  profilePatchFromLookup,
  SHOW_PROFILE_PODSCAN_ID_LABEL,
} from "./profile-podscan";

describe("omitClientPodscanId", () => {
  it("drops an imposter podscan id and keeps the rest of the payload", () => {
    expect(
      omitClientPodscanId({
        podscan_id: "pd_smartless",
        show_name: "My Show",
        audience_size: 1200,
      })
    ).toEqual({ show_name: "My Show", audience_size: 1200 });
  });

  it("leaves a payload that never carried a podscan id unchanged", () => {
    expect(omitClientPodscanId({ show_name: "My Show" })).toEqual({ show_name: "My Show" });
  });

  it("labels the column as display-only", () => {
    expect(SHOW_PROFILE_PODSCAN_ID_LABEL).toMatch(/Display only/);
  });
});

describe("profilePatchFromLookup", () => {
  it("saves show details and leaves another show's podscan id out", () => {
    expect(
      profilePatchFromLookup({
        podscan_id: "pd_smartless",
        podscan_id_label: SHOW_PROFILE_PODSCAN_ID_LABEL,
        show_name: "My Show",
        show_description: "A show",
        show_image_url: null,
        show_categories: ["Business"],
        episode_count: 10,
        audience_size: 5000,
      })
    ).toEqual({
      show_name: "My Show",
      show_description: "A show",
      show_image_url: null,
      show_categories: ["Business"],
      episode_count: 10,
      audience_size: 5000,
    });
  });
});
