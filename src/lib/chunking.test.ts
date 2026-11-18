import { describe, expect, it } from "vitest";
import { chunkContent } from "@/lib/chunking";

const makeWords = (count: number) =>
  Array.from({ length: count }, (_, i) => `word${i}`);

describe("chunkContent", () => {
  it("returns no chunks for empty or whitespace-only input", async () => {
    expect(await chunkContent("")).toEqual([]);
    expect(await chunkContent("   \n   ")).toEqual([]);
  });
  it("returns a single trimmed chunk for short text", async () => {
    expect(await chunkContent("  hello world  ")).toEqual(["hello world"]);
  });

  it("split ling text into several chunks of at most 150 characters", async () => {
    const chunks = await chunkContent(makeWords(60).join(" "));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(150);
    }
  });
  it("does not lose any words when splitting", async () => {
    const words = makeWords(60);
    const chunks = await chunkContent(words.join(" "));

    const wordsInChunks = new Set(chunks.flatMap((chunk) => chunk.split(" ")));
    for (const word of words) {
      expect(wordsInChunks.has(word)).toBe(true);
    }
  });
  it("overlaps consecutive chunks so context is not cut off", async () => {
    const chunks = await chunkContent(makeWords(60).join(" "));
    for (let i = 1; i < chunks.length; i += 1) {
      const previousWords = chunks[i - 1].split(" ");
      const firstWordOfCurrent = chunks[i].split(" ")[0];
      expect(previousWords).toContain(firstWordOfCurrent);
    }
  });
  it("cannot split text without spaces (known limitation)", async () => {
    const chunks = await chunkContent("x".repeat(400));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(400);
  });
});
