import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "./database.js";
import { initDatabase } from "./database.js";
import { search } from "./search.js";
import { createTestDb, insertChunk, rebuildFtsIndex } from "./test-utils.js";

const TEST_DIR = join(tmpdir(), `context-search-test-${Date.now()}`);

describe("search", () => {
  let db: DatabaseConnection;
  const testPackagePath = join(TEST_DIR, "test.db");

  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    db = createTestDb(testPackagePath, { name: "nextjs", version: "15.0" });
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it("returns library info in result", () => {
    rebuildFtsIndex(db);

    const result = search(db, "anything");

    expect(result.library).toBe("nextjs@15.0");
    expect(result.version).toBe("15.0");
  });

  it("finds matching content by topic", () => {
    insertChunk(db, {
      docPath: "docs/middleware.md",
      docTitle: "Middleware",
      sectionTitle: "Introduction",
      content:
        "Middleware allows you to run code before a request is completed.",
      tokens: 50,
    });
    rebuildFtsIndex(db);

    const result = search(db, "middleware");

    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe("Middleware > Introduction");
    expect(result.results[0].source).toBe("docs/middleware.md");
  });

  it("returns empty results for no matches", () => {
    insertChunk(db, {
      docPath: "docs/routing.md",
      docTitle: "Routing",
      sectionTitle: "Basics",
      content: "Next.js uses a file-system based router.",
      tokens: 30,
    });
    rebuildFtsIndex(db);

    const result = search(db, "authentication");

    expect(result.results).toHaveLength(0);
  });

  it("respects token budget", () => {
    for (let i = 0; i < 5; i++) {
      insertChunk(db, {
        docPath: `docs/section${i}.md`,
        docTitle: `Section ${i}`,
        sectionTitle: "Overview",
        content: `This is documentation about middleware features part ${i}.`,
        tokens: 500,
      });
    }
    rebuildFtsIndex(db);

    const result = search(db, "middleware");

    expect(result.results.length).toBeLessThanOrEqual(4);
  });

  it("groups and orders chunks by document", () => {
    insertChunk(db, {
      docPath: "docs/middleware.md",
      docTitle: "Middleware",
      sectionTitle: "Configuration",
      content: "Configure middleware using matcher.",
      tokens: 30,
    });
    insertChunk(db, {
      docPath: "docs/middleware.md",
      docTitle: "Middleware",
      sectionTitle: "Introduction",
      content: "Middleware runs before requests.",
      tokens: 30,
    });
    rebuildFtsIndex(db);

    const result = search(db, "middleware");

    expect(result.results.every((r) => r.source === "docs/middleware.md")).toBe(
      true,
    );
  });

  it("handles empty query", () => {
    insertChunk(db, {
      docPath: "docs/test.md",
      docTitle: "Test",
      sectionTitle: "Section",
      content: "Some content",
      tokens: 10,
    });
    rebuildFtsIndex(db);

    const result = search(db, "   ");

    expect(result.results).toHaveLength(0);
  });

  it("handles special characters in query", () => {
    insertChunk(db, {
      docPath: "docs/api.md",
      docTitle: "API",
      sectionTitle: "Functions",
      content: "The getData function fetches data.",
      tokens: 20,
    });
    rebuildFtsIndex(db);

    const result = search(db, "getData()");

    expect(result.results).toHaveLength(1);
  });

  it("ranks chunks with code higher than prose-only", () => {
    insertChunk(db, {
      docPath: "docs/api-overview.md",
      docTitle: "API",
      sectionTitle: "Overview",
      content: "The cacheHandler function manages the response storage layer.",
      tokens: 30,
      hasCode: 0,
    });
    insertChunk(db, {
      docPath: "docs/api-example.md",
      docTitle: "API",
      sectionTitle: "Example",
      content:
        "The cacheHandler function manages the response storage layer.",
      tokens: 30,
      hasCode: 1,
    });
    rebuildFtsIndex(db);

    const result = search(db, "cacheHandler");

    expect(result.results).toHaveLength(2);
    // The code chunk should rank higher due to the code boost
    expect(result.results[0].title).toContain("Example");
  });

  it("respects CONTEXT_MAX_TOKENS env override", () => {
    for (let i = 0; i < 3; i++) {
      insertChunk(db, {
        docPath: `docs/section${i}.md`,
        docTitle: `Section ${i}`,
        sectionTitle: "Overview",
        content: `Documentation about middleware features part ${i}.`,
        tokens: 400,
      });
    }
    rebuildFtsIndex(db);

    // Default budget is 2000, so all 3 chunks (1200 tokens) should fit
    const resultDefault = search(db, "middleware");
    expect(resultDefault.results).toHaveLength(3);

    // Override to 500 — only 1 chunk should fit
    process.env.CONTEXT_MAX_TOKENS = "500";
    try {
      const resultLimited = search(db, "middleware");
      expect(resultLimited.results).toHaveLength(1);
    } finally {
      delete process.env.CONTEXT_MAX_TOKENS;
    }
  });

  it("returns empty results when FTS query fails", () => {
    insertChunk(db, {
      docPath: "docs/test.md",
      docTitle: "Test",
      sectionTitle: "Section",
      content: "Some content here",
      tokens: 10,
    });
    rebuildFtsIndex(db);

    // Drop the FTS table to simulate corruption
    db.exec("DROP TABLE chunks_fts");

    const result = search(db, "content");
    expect(result.results).toHaveLength(0);
  });
});
