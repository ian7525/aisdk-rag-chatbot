import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateEmbedding } from "@/lib/embeddings";
import { searchDocuments } from "@/lib/search";

const mocks = vi.hoisted(() => {
  const limit = vi.fn();
  const orderBy = vi.fn((_order: unknown) => ({ limit }));
  const where = vi.fn((_condition: SQL) => ({ orderBy }));
  const from = vi.fn((_table: unknown) => ({ where }));
  const select = vi.fn((_columns: Record<string, unknown>) => ({ from }));
  return { select, from, where, orderBy, limit };
});

vi.mock("@/lib/db-config", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/embeddings", () => ({ generateEmbedding: vi.fn() }));

const mockedGenerateEmbedding = vi.mocked(generateEmbedding);
const dialect = new PgDialect();

const whereParams = () =>
  dialect.sqlToQuery(mocks.where.mock.calls[0][0]).params;

describe("searchDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    mocks.limit.mockResolvedValue([]);
  });

  it("embeds the query text", async () => {
    await searchDocuments("What is RAG?");
    expect(mockedGenerateEmbedding).toHaveBeenCalledWith("What is RAG?");
  });

  it("returns the rows found by the database", async () => {
    const rows = [{ id: 1, content: "RAD explained", similarity: 0.9 }];
    mocks.limit.mockResolvedValue(rows);
    expect(await searchDocuments("rag")).toEqual(rows);
  });

  it("selects only id, content and similarity", async () => {
    await searchDocuments("rag");
    const columns = mocks.select.mock.calls[0][0];
    expect(Object.keys(columns)).toEqual(["id", "content", "similarity"]);
  });

  it("returns at most 5 results by default", async () => {
    await searchDocuments("rag");
    expect(mocks.limit).toHaveBeenCalledWith(5);
  });

  it("uses a custom limit when given", async () => {
    await searchDocuments("rag", 3);
    expect(mocks.limit).toHaveBeenCalledWith(3);
  });

  it("filters by a default similarity threshold of 0.5", async () => {
    await searchDocuments("rag");
    expect(whereParams()).toEqual(["[0.1,0.2,0.3]", 0.5]);
  });
  it("uses a custom similarity threshold when given", async () => {
    await searchDocuments("rag", 5, 0.8);
    expect(whereParams()).toEqual(["[0.1,0.2,0.3]", 0.8]);
  });
  it("fails without querying the database when embedding fails", async () => {
    mockedGenerateEmbedding.mockRejectedValue(new Error("embedding failed"));
    await expect(searchDocuments("rag")).rejects.toThrow("embedding failed");
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
