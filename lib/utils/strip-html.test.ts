import { describe, it, expect } from "vitest";
import { stripHtml } from "./strip-html";

describe("stripHtml", () => {
  it("returns empty string for null/undefined/empty input", () => {
    expect(stripHtml(null)).toBe("");
    expect(stripHtml(undefined)).toBe("");
    expect(stripHtml("")).toBe("");
  });

  it("strips <p> wrapping tags that come from podcast feeds", () => {
    expect(stripHtml("<p>This show is about tech and business.</p>")).toBe(
      "This show is about tech and business."
    );
  });

  it("treats <p>, <br>, <div>, <li> as line-break boundaries so words don't fuse", () => {
    expect(stripHtml("<p>First para</p><p>Second para</p>")).toBe("First para Second para");
    expect(stripHtml("Line one<br/>Line two")).toBe("Line one Line two");
  });

  it("strips inline formatting tags without breaking adjacent words", () => {
    expect(stripHtml("a <strong>powerful</strong> show")).toBe("a powerful show");
  });

  it("drops entire script and style blocks including their content", () => {
    expect(stripHtml("before<script>alert('xss')</script>after")).toBe("beforeafter");
    expect(stripHtml("x<style>body{color:red}</style>y")).toBe("xy");
  });

  it("decodes common named entities we see in feed descriptions", () => {
    expect(stripHtml("rock &amp; roll")).toBe("rock & roll");
    expect(stripHtml("it&#39;s great &quot;shows&quot;")).toBe("it's great \"shows\"");
    expect(stripHtml("before&nbsp;after")).toBe("before after");
  });

  it("collapses whitespace runs into single spaces and trims the edges", () => {
    expect(stripHtml("  <p>  lots   of    space </p>  ")).toBe("lots of space");
  });

  it("handles links with attributes", () => {
    expect(stripHtml('Check out <a href="https://example.com">our site</a>')).toBe(
      "Check out our site"
    );
  });

  it("leaves plain text untouched", () => {
    expect(stripHtml("Just a plain description without any tags.")).toBe(
      "Just a plain description without any tags."
    );
  });
});
