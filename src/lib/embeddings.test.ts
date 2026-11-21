import { embed, embedMany } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateEmbedding, generateEmbeddings } from "@/lib/embeddings";

vi.mock("ai", () => ({
  embed: vi.fn(),
  embedMany: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: {
    textEmbeddingModel: vi.fn((name: string) => `mock-model:${name}`),
  },
}));

const mockedEmbed = vi.mocked(embed);
const mockedEmbedMany = vi.mocked(embedMany);

describe("embedding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateEmbedding", () => {
    it("returns the embedding from the model", async () => {
      mockedEmbed.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] } as never);
      const result = await generateEmbedding("hello");
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });
    it("uses text-embedding-3-small and passed the text as value", async () => {
      mockedEmbed.mockResolvedValue({ embedding: [] } as never);
      await generateEmbedding("hello");
      expect(mockedEmbed).toHaveBeenCalledWith({
        model: "mock-model:text-embedding-3-small",
        value: "hello",
      });
    });
    it("removes every newline before embedding", async () => {
      mockedEmbed.mockResolvedValue({ embedding: [] } as never);
      await generateEmbedding("line one\nline two\nline three");

      const { value } = mockedEmbed.mock.calls[0][0];
      expect(value).not.toContain("\n");
      expect(value).toBe("line one line two line three");
    });
  });

  describe("generateEmbeddings", () => {
    it("returns one embedding per input text", async () => {
      mockedEmbedMany.mockResolvedValue({ embeddings: [[1], [2]] } as never);
      const result = await generateEmbeddings(["a", "b"]);
      expect(result).toEqual([[1], [2]]);
    });
    it("uses text-embedding-3-small and passed all texts as values", async () => {
      mockedEmbedMany.mockResolvedValue({ embeddings: [] } as never);
      await generateEmbeddings(["a", "b"]);
      expect(mockedEmbedMany).toHaveBeenCalledWith({
        model: "mock-model:text-embedding-3-small",
        values: ["a", "b"],
      });
    });
    it("removes every newline from each text", async () => {
      mockedEmbedMany.mockResolvedValue({ embeddings: [] } as never);
      await generateEmbeddings(["a\nb\nc", "d\ne\nf"]);
      const { values } = mockedEmbedMany.mock.calls[0][0];
      for (const value of values) {
        expect(value).not.toContain("\n");
      }
    });
  });
});
