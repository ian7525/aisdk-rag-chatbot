import { convertToModelMessages, streamText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/chat/route";
import { searchDocuments } from "@/lib/search";

// Keep the real `tool`/`stepCountIs`, replace only the functions that hit OpenAI
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  streamText: vi.fn(),
  convertToModelMessages: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn((name: string) => `mock-openai:${name}`),
}));

// Also keeps db-config (which needs NEON_DATABASE_URL) from being loaded
vi.mock("@/lib/search", () => ({ searchDocuments: vi.fn() }));

const mockedStreamText = vi.mocked(streamText);
const mockedConvert = vi.mocked(convertToModelMessages);
const mockedSearch = vi.mocked(searchDocuments);

const streamResponse = new Response("stream body");

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
function getSearchTool() {
  const options = mockedStreamText.mock.calls[0][0] as unknown as {
    tools: {
      searchKnowledgeBase: {
        execute: (
          input: { query: string },
          options: unknown,
        ) => Promise<string>;
      };
    };
  };
  return options.tools.searchKnowledgeBase;
}

const messages = [
  { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
];

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedConvert.mockResolvedValue(["converted"] as never);
    mockedStreamText.mockReturnValue({
      toUIMessageStreamResponse: () => streamResponse,
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the streaming response", async () => {
    const response = await POST(makeRequest({ messages }));
    expect(response).toBe(streamResponse);
  });

  it("sends the converted messages and the model to streamText", async () => {
    await POST(makeRequest({ messages }));
    expect(mockedConvert).toHaveBeenCalledWith(messages);
    const options = mockedStreamText.mock.calls[0][0];
    expect(options.model).toBe("mock-openai:gpt-4.1-mini");
    expect(options.messages).toEqual(["converted"]);
  });

  it("returns 500 when streamText throws", async () => {
    mockedStreamText.mockImplementation(() => {
      throw new Error("openai down");
    });

    const response = await POST(makeRequest({ messages }));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Failed to stream chat completion");
    expect(console.error).toHaveBeenCalled();
  });

  it("returns 500 when the request body is not valid JSON", async () => {
    const response = await POST(makeRequest("not json"));
    expect(response.status).toBe(500);
    expect(mockedStreamText).not.toHaveBeenCalled();
  });

  describe("searchKnowledgeBase tool", () => {
    async function runTool(query: string) {
      await POST(makeRequest({ messages }));
      return getSearchTool().execute({ query }, {});
    }

    it("searches with the query, limit 3 and threshold 0.5", async () => {
      mockedSearch.mockResolvedValue([]);
      await runTool("What is RAG?");
      expect(mockedSearch).toHaveBeenCalledWith("What is RAG?", 3, 0.5);
    });

    it("formats results as a numbered list", async () => {
      mockedSearch.mockResolvedValue([
        { id: 1, content: "first chunk", similarity: 0.9 },
        { id: 2, content: "second chunk", similarity: 0.8 },
      ]);

      expect(await runTool("rag")).toBe("[1] first chunk\n\n[2] second chunk");
    });

    it("says so when nothin relevant is found", async () => {
      mockedSearch.mockResolvedValue([]);
      expect(await runTool("rag")).toBe(
        "No relevant information found in the knowledge base",
      );
    });
    it("returns an error message instead of throwing when search fails", async () => {
      mockedSearch.mockRejectedValue(new Error("db down"));
      expect(await runTool("rag")).toBe("Error searching the knowledge base");
      expect(console.error).toHaveBeenCalled();
    });
  });
});
