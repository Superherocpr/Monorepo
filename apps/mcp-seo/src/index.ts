#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { keywordResearch } from "./tools/keyword-research.js";
import { generateMetaTags } from "./tools/meta-generator.js";
import { generateOutline } from "./tools/outline-generator.js";
import { scoreContent } from "./tools/content-scorer.js";

const server = new McpServer({
  name: "mcp-seo",
  version: "1.0.0",
});

// ── keyword_research ──────────────────────────────────────────────────────────
server.tool(
  "keyword_research",
  "Research a seed keyword using DataForSEO. Returns keyword suggestions with search volume and difficulty, related/LSI keywords, and question-based keywords (People Also Ask style).",
  {
    keyword: z.string().describe("The seed keyword or topic to research"),
    location_code: z
      .number()
      .optional()
      .default(2840)
      .describe("DataForSEO location code (default 2840 = United States)"),
    language_code: z
      .string()
      .optional()
      .default("en")
      .describe("Language code (default 'en')"),
  },
  async (args) => {
    const result = await keywordResearch(args);
    return { content: [{ type: "text", text: result }] };
  }
);

// ── generate_meta_tags ────────────────────────────────────────────────────────
server.tool(
  "generate_meta_tags",
  "Generate SEO-optimized title tags and meta descriptions for a blog article. Produces multiple variants to pick from.",
  {
    topic: z.string().describe("The article topic or title draft"),
    target_keyword: z
      .string()
      .describe("The primary keyword to include in the meta tags"),
    brand_name: z
      .string()
      .optional()
      .describe("Optional brand name to append to title tags"),
    content_snippet: z
      .string()
      .optional()
      .describe("Optional excerpt from the article to inspire the meta description"),
  },
  async (args) => {
    const result = generateMetaTags(args);
    return { content: [{ type: "text", text: result }] };
  }
);

// ── generate_outline ──────────────────────────────────────────────────────────
server.tool(
  "generate_outline",
  "Generate an SEO-optimized article outline. Analyzes top SERP results for the target keyword, then produces a structured H1/H2/H3 outline with word count targets.",
  {
    topic: z.string().describe("The article topic"),
    target_keyword: z
      .string()
      .describe("The primary keyword this article should rank for"),
    article_type: z
      .enum(["how-to", "listicle", "pillar", "comparison", "review"])
      .optional()
      .default("how-to")
      .describe("Type of article to outline"),
    location_code: z
      .number()
      .optional()
      .default(2840)
      .describe("DataForSEO location code (default 2840 = US)"),
  },
  async (args) => {
    const result = await generateOutline(args);
    return { content: [{ type: "text", text: result }] };
  }
);

// ── score_content ─────────────────────────────────────────────────────────────
server.tool(
  "score_content",
  "Score a blog article draft against SEO best practices. Returns a score out of 100 with actionable improvement recommendations.",
  {
    content: z
      .string()
      .describe("The full article content in markdown or plain text"),
    target_keyword: z
      .string()
      .describe("The primary keyword this article is targeting"),
    meta_title: z
      .string()
      .optional()
      .describe("The article's title tag (optional but recommended)"),
    meta_description: z
      .string()
      .optional()
      .describe("The article's meta description (optional)"),
  },
  async (args) => {
    const result = scoreContent(args);
    return { content: [{ type: "text", text: result }] };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-seo server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
