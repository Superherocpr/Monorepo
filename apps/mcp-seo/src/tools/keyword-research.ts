import { getKeywordSuggestions } from "../lib/dataforseo.js";

export const keywordResearchSchema = {
  name: "keyword_research",
  description:
    "Research a seed keyword using DataForSEO. Returns keyword suggestions with search volume and difficulty, related/LSI keywords, and question-based keywords (People Also Ask style). Use this before writing an article to find the best target keyword and supporting terms.",
  inputSchema: {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description: "The seed keyword or topic to research",
      },
      location_code: {
        type: "number",
        description:
          "DataForSEO location code (default 2840 = United States). Other common codes: 2826=UK, 2036=Australia, 2124=Canada",
        default: 2840,
      },
      language_code: {
        type: "string",
        description: "Language code (default 'en')",
        default: "en",
      },
    },
    required: ["keyword"],
  },
} as const;

export async function keywordResearch(args: {
  keyword: string;
  location_code?: number;
  language_code?: string;
}): Promise<string> {
  const data = await getKeywordSuggestions(
    args.keyword,
    args.location_code ?? 2840,
    args.language_code ?? "en"
  );

  const fmt = (n: number | null, suffix = "") =>
    n != null ? `${n.toLocaleString()}${suffix}` : "N/A";

  const topSuggestions = data.suggestions
    .sort((a, b) => (b.search_volume ?? 0) - (a.search_volume ?? 0))
    .slice(0, 15);

  const relatedTop = data.related_keywords
    .sort((a, b) => (b.search_volume ?? 0) - (a.search_volume ?? 0))
    .slice(0, 10);

  const lines: string[] = [
    `# Keyword Research: "${args.keyword}"`,
    "",
    "## Top Keyword Suggestions",
    "| Keyword | Monthly Searches | Difficulty | CPC |",
    "|---------|-----------------|------------|-----|",
    ...topSuggestions.map(
      (k) =>
        `| ${k.keyword} | ${fmt(k.search_volume)} | ${fmt(k.keyword_difficulty, "/100")} | $${fmt(k.cpc)} |`
    ),
    "",
    "## Related / LSI Keywords",
    "| Keyword | Monthly Searches | Difficulty |",
    "|---------|-----------------|------------|",
    ...relatedTop.map(
      (k) =>
        `| ${k.keyword} | ${fmt(k.search_volume)} | ${fmt(k.keyword_difficulty, "/100")} |`
    ),
    "",
    "## Question Keywords (People Also Ask)",
    ...data.questions.map((q) => `- ${q}`),
    "",
    "## Recommendations",
    `- **Primary keyword**: Choose from high-volume, lower-difficulty terms above`,
    `- **Sprinkle** related/LSI keywords naturally throughout the content`,
    `- **Answer** 2-3 of the question keywords in your article for featured snippet potential`,
  ];

  return lines.join("\n");
}
