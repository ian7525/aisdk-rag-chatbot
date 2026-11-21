import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processPdfFile } from "@/app/upload/actions";
import { chunkContent } from "@/lib/chunking";
import { documents } from "@/lib/db-schema";
import { generateEmbeddings } from "@/lib/embeddings";

const mocks = vi.hoisted(() => ({
  parserInit: vi.fn((_options: { data: Buffer }) => {}),
  getText: vi.fn(),
  destroy: vi.fn(),
  values: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    constructor(options: { data: Buffer }) {
      mocks.parserInit(options);
    }
    getText = mocks.getText;
    destroy = mocks.destroy;
  },
}));

vi.mock("@/lib/db-config", () => ({ db: { insert: mocks.insert } }));
vi.mock("@/lib/chunking", () => ({ chunkContent: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ generateEmbeddings: vi.fn() }));

const mockedChunk = vi.mocked(chunkContent);
const mockedEmbeddings = vi.mocked(generateEmbeddings);

function makeFormData(content = "pdf bytes") {
  const formData = new FormData();
  formData.set(
    "pdf",
    new File([content], "doc.pdf", { type: "application/pdf" }),
  );
  return formData;
}

describe("processPdfFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getText.mockResolvedValue({ text: "some pdf text" });
    mocks.destroy.mockResolvedValue(undefined);
    mocks.values.mockResolvedValue(undefined);
    mocks.insert.mockReturnValue({ values: mocks.values });
    mockedChunk.mockResolvedValue(["chunk a", "chunk b"]);
    mockedEmbeddings.mockResolvedValue([[1], [2]]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("on success", () => {
    it("reports how many chunks were created", async () => {
      const result = await processPdfFile(makeFormData());
      expect(result).toEqual({
        success: true,
        message: "Created 2 searchable chunks",
      });
    });

    it("gives the uploaded file's bytes to the PDF parser", async () => {
      await processPdfFile(makeFormData("pdf bytes"));
      const options = mocks.parserInit.mock.calls[0][0];
      expect(options.data.toString()).toBe("pdf bytes");
    });
    it("chunks the extracted text and embeds the chunks", async () => {
      await processPdfFile(makeFormData());

      expect(mockedChunk).toHaveBeenCalledWith("some pdf text");
      expect(mockedEmbeddings).toHaveBeenCalledWith(["chunk a", "chunk b"]);
    });

    it("stores each chunk with its own embedding", async () => {
      await processPdfFile(makeFormData());

      expect(mocks.insert).toHaveBeenCalledWith(documents);
      expect(mocks.values).toHaveBeenCalledWith([
        { content: "chunk a", embedding: [1] },
        { content: "chunk b", embedding: [2] },
      ]);
    });

    it("releases the parser", async () => {
      await processPdfFile(makeFormData());

      expect(mocks.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the PDF has no text", () => {
    it.each(["", "   \n   "])("returns an error for %j", async (text) => {
      mocks.getText.mockResolvedValue({ text });
      const result = await processPdfFile(makeFormData());

      expect(result).toEqual({ success: false, error: "No text found in PDF" });
      expect(mockedEmbeddings).not.toHaveBeenCalled();
      expect(mocks.insert).not.toHaveBeenCalled();
      expect(mocks.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe("when something fails", () => {
    const failure = { success: false, error: "Failed to process PDF" };

    it("returns a failure when the PDF cannot be parsed", async () => {
      mocks.getText.mockRejectedValue(new Error("corrupt pdf"));

      expect(await processPdfFile(makeFormData())).toEqual(failure);
      expect(mocks.destroy).toHaveBeenCalledTimes(1);
    });

    it("stores nothing when embedding fails", async () => {
      mockedEmbeddings.mockRejectedValue(new Error("openai down"));

      expect(await processPdfFile(makeFormData())).toEqual(failure);
      expect(mocks.insert).not.toHaveBeenCalled();
      expect(mocks.destroy).toHaveBeenCalledTimes(1);
    });

    it("returns a failure when the database insert fails", async () => {
      mocks.values.mockRejectedValue(new Error("db down"));

      expect(await processPdfFile(makeFormData())).toEqual(failure);
      expect(console.error).toHaveBeenCalled();
      expect(mocks.destroy).toHaveBeenCalledTimes(1);
    });

    it("returns a failure when no file was submitted", async () => {
      expect(await processPdfFile(new FormData())).toEqual(failure);
      expect(mocks.destroy).not.toHaveBeenCalled();
    });
  });
});
