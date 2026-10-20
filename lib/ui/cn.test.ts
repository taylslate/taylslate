import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("merges conflicting tailwind classes and keeps the later one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("px-2", false && "px-4", "text-sm")).toBe("px-2 text-sm");
  });
});
