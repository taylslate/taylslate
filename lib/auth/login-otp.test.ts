import { describe, expect, it } from "vitest";
import {
  classifyEmailOtpError,
  isSixDigitCode,
  normalizeLoginOtp,
} from "./login-otp";

describe("normalizeLoginOtp / isSixDigitCode", () => {
  it("strips spaces and accepts six digits", () => {
    expect(normalizeLoginOtp(" 482 913 ")).toBe("482913");
    expect(isSixDigitCode("482913")).toBe(true);
  });

  it("rejects empty, short, and non-digit codes", () => {
    expect(normalizeLoginOtp(null)).toBe("");
    expect(isSixDigitCode("")).toBe(false);
    expect(isSixDigitCode("12345")).toBe(false);
    expect(isSixDigitCode("1234567")).toBe(false);
    expect(isSixDigitCode("12ab56")).toBe(false);
  });
});

describe("classifyEmailOtpError", () => {
  it("treats otp_expired as expired even when the message also says invalid", () => {
    expect(
      classifyEmailOtpError({
        code: "otp_expired",
        message: "Token has expired or is invalid",
      }),
    ).toBe("expired");
  });

  it("treats a wrong code as invalid", () => {
    expect(
      classifyEmailOtpError({
        code: "otp_invalid",
        message: "Token has expired or is invalid",
      }),
    ).toBe("invalid");
    expect(classifyEmailOtpError({ message: "invalid otp" })).toBe("invalid");
  });
});
