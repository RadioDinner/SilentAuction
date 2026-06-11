import { describe, it, expect } from "vitest";
import { normalizePrivateKey } from "./private-key";

const PEM = "-----BEGIN PRIVATE KEY-----\nMIIEvAIB\n-----END PRIVATE KEY-----\n";

describe("normalizePrivateKey", () => {
  it("converts literal \\n into real newlines", () => {
    expect(
      normalizePrivateKey("-----BEGIN PRIVATE KEY-----\\nMIIEvAIB\\n-----END PRIVATE KEY-----\\n"),
    ).toBe(PEM);
  });

  it("strips a wrapping pair of double quotes", () => {
    expect(
      normalizePrivateKey('"-----BEGIN PRIVATE KEY-----\\nMIIEvAIB\\n-----END PRIVATE KEY-----\\n"'),
    ).toBe(PEM);
  });

  it("strips wrapping single quotes", () => {
    expect(
      normalizePrivateKey("'-----BEGIN PRIVATE KEY-----\\nMIIEvAIB\\n-----END PRIVATE KEY-----\\n'"),
    ).toBe(PEM);
  });

  it("leaves a real multiline PEM untouched", () => {
    expect(normalizePrivateKey(PEM)).toBe(PEM);
  });

  it("handles double-escaped \\\\n", () => {
    expect(
      normalizePrivateKey("-----BEGIN PRIVATE KEY-----\\\\nMIIEvAIB\\\\n-----END PRIVATE KEY-----\\\\n"),
    ).toBe(PEM);
  });

  it("handles undefined", () => {
    expect(normalizePrivateKey(undefined)).toBe("");
  });
});
