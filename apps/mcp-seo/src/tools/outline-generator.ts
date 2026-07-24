import { getSerpResults, getKeywordSuggestions, SerpResult } from "../lib/dataforseo.js";

export const outlineGeneratorSchema = {
  name: "generate_outline",
  description:
    "Generate an SEO-optimized article outline for a given topic and target keyword. Analyzes top-ranking SERP results to identify common heading patterns and content gaps, then produces a structured H1/H2/H3 outline with suggested word counts and semantic keyword placement.",
  inputSchema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "The article topic",
      },
      target_keyword: {
        type: "string",
        description: "The primary keyword this article should rank for",
      },
      article_type: {
        type: "string",
        enum: ["how-to", "listicle", "pillar", "comparison", "review"],
        description:
          "Type of article to outline. Defaults to 'how-to' if not specified.",
        default: "how-to",
      },
      location_code: {
        type: "number",
        description: "DataForSEO location code (default 2840 = US)",
        default: 2840,
      },
    },
    required: ["topic", "target_keyword"],
  },
} as const;

export async function generateOutline(args: {
  topic: string;
  target_keyword: string;
  article_type?: string;
  location_code?: number;
}): Promise<string> {
  const { topic, target_keyword, article_type = "how-to", location_code = 2840 } = args;

  const [serpResults, keywordData] = await Promise.all([
    getSerpResults(target_keyword, location_code),
    getKeywordSuggestions(target_keyword, location_code),
  ]);

  const outline = buildOutline(topic, target_keyword, article_type, serpResults);
  const lsiKeywords = keywordData.related_keywords
    .slice(0, 8)
    .map((k) => k.keyword);
  const questions = keywordData.questions.slice(0, 6);

  const lines: string[] = [
    `# Article Outline: "${topic}"`,
    `**Target keyword:** ${target_keyword}  `,
    `**Article type:** ${article_type}  `,
    `**Estimated word count:** ${outline.estimatedWordCount.toLocaleString()} words`,
    "",
    "## SERP Analysis",
    `Top ${Math.min(serpResults.length, 5)} ranking articles:`,
    ...serpResults.slice(0, 5).map(
      (r, i) => `${i + 1}. [${r.title}](${r.url})`
    ),
    "",
    "## Recommended Outline",
    "",
    outline.content,
    "",
    "## LSI / Semantic Keywords to Include",
    `Use these naturally throughout the article:`,
    ...lsiKeywords.map((k) => `- ${k}`),
    "",
    "## Questions to Answer (FAQ / Featured Snippet Opportunities)",
    ...questions.map((q) => `- ${q}`),
    "",
    "## Writing Tips",
    `- Place "${target_keyword}" in the **first 100 words** of the introduction`,
    `- Use "${target_keyword}" in at least one **H2 heading**`,
    `- Aim for **${outline.estimatedWordCount.toLocaleString()}+ words** to be competitive for this keyword`,
    `- Add an **FAQ section** at the end answering the questions above`,
    `- Include **internal links** to related content on your site`,
    `- Add **1-2 images** per major section with keyword-rich alt text`,
  ];

  return lines.join("\n");
}

interface Outline {
  content: string;
  estimatedWordCount: number;
}

function buildOutline(
  topic: string,
  keyword: string,
  type: string,
  serp: SerpResult[]
): Outline {
  const year = new Date().getFullYear();
  const kwCap = keyword
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  let sections: string[];
  let wordCount: number;

  switch (type) {
    case "listicle":
      sections = listicleSections(topic, keyword, kwCap, year);
      wordCount = 2200;
      break;
    case "pillar":
      sections = pillarSections(topic, keyword, kwCap, year);
      wordCount = 4500;
      break;
    case "comparison":
      sections = comparisonSections(topic, keyword, kwCap, year);
      wordCount = 2800;
      break;
    case "review":
      sections = reviewSections(topic, keyword, kwCap, year);
      wordCount = 2500;
      break;
    default: // how-to
      sections = howToSections(topic, keyword, kwCap, year);
      wordCount = 2000;
  }

  // If SERP results contain headings (titles), note popular patterns
  const serpTitles = serp.slice(0, 5).map((r) => r.title);
  const serpNote =
    serpTitles.length > 0
      ? `\n> **Competitor titles for context:**\n${serpTitles.map((t) => `> - ${t}`).join("\n")}\n`
      : "";

  return {
    content: serpNote + sections.join("\n"),
    estimatedWordCount: wordCount,
  };
}

function howToSections(
  topic: string,
  keyword: string,
  kwCap: string,
  year: number
): string[] {
  return [
    `# How to ${topic} — The Complete ${year} Guide`,
    `*~150 words. Include "${keyword}" in the first paragraph. Hook the reader.*`,
    ``,
    `## What Is ${kwCap}?`,
    `*~200 words. Define the topic clearly. Target readers who are new to it.*`,
    ``,
    `## Why ${kwCap} Matters`,
    `*~200 words. Explain the benefits and stakes — why the reader should care.*`,
    ``,
    `## What You'll Need`,
    `*~150 words. List prerequisites, tools, or materials.*`,
    `- Item 1`,
    `- Item 2`,
    ``,
    `## Step-by-Step: How to ${topic}`,
    `*~600 words total across steps.*`,
    ``,
    `### Step 1: [First Action]`,
    `*~150 words*`,
    ``,
    `### Step 2: [Second Action]`,
    `*~150 words*`,
    ``,
    `### Step 3: [Third Action]`,
    `*~150 words*`,
    ``,
    `### Step 4: [Fourth Action]`,
    `*~150 words*`,
    ``,
    `## Common Mistakes to Avoid`,
    `*~250 words. 3-5 pitfalls — great for differentiation from competitors.*`,
    ``,
    `## Pro Tips for ${kwCap}`,
    `*~200 words. Advanced tips that demonstrate expertise.*`,
    ``,
    `## Frequently Asked Questions`,
    `*~300 words. Answer 4-5 questions from the "Questions to Answer" section above.*`,
    ``,
    `## Conclusion`,
    `*~100 words. Summarize key points and include a call to action.*`,
  ];
}

function listicleSections(
  topic: string,
  keyword: string,
  kwCap: string,
  year: number
): string[] {
  return [
    `# 10 Best ${topic} in ${year}: Expert Picks`,
    `*~150 words. Include "${keyword}" in first paragraph. State the listicle scope.*`,
    ``,
    `## How We Evaluated ${kwCap}`,
    `*~200 words. Criteria used — builds credibility and E-E-A-T.*`,
    ``,
    `## Quick Comparison Table`,
    `*Table with: Name | Best For | Price | Rating*`,
    ``,
    `## 1. [Top Pick] — Best Overall`,
    `*~200 words. Pros, cons, who it's for.*`,
    ``,
    `## 2. [Runner-Up] — Best for [Use Case]`,
    `*~200 words.*`,
    ``,
    `## 3. [Third Option] — Best Budget`,
    `*~200 words.*`,
    ``,
    `## 4–10. [Additional Picks]`,
    `*~150 words each.*`,
    ``,
    `## How to Choose the Right ${kwCap}`,
    `*~300 words. Buying guide / decision framework.*`,
    ``,
    `## Frequently Asked Questions`,
    `*~200 words.*`,
    ``,
    `## Final Verdict`,
    `*~100 words.*`,
  ];
}

function pillarSections(
  topic: string,
  keyword: string,
  kwCap: string,
  year: number
): string[] {
  return [
    `# The Ultimate Guide to ${topic} (${year})`,
    `*~200 words. Strong hook. Include "${keyword}" in first 100 words. Preview what the guide covers.*`,
    ``,
    `## Table of Contents`,
    `*(auto-generate or list H2s)*`,
    ``,
    `## What Is ${kwCap}? (Complete Overview)`,
    `*~400 words. Thorough definition, history, context.*`,
    ``,
    `## How ${kwCap} Works`,
    `*~500 words. Mechanisms, key concepts, technical details.*`,
    ``,
    `## Types of ${kwCap}`,
    `*~400 words. Break into categories with examples.*`,
    ``,
    `## Benefits of ${kwCap}`,
    `*~350 words. Data-backed advantages.*`,
    ``,
    `## How to Get Started with ${kwCap}`,
    `*~500 words. Step-by-step beginner path.*`,
    ``,
    `## Advanced ${kwCap} Strategies`,
    `*~500 words. For intermediate/advanced readers.*`,
    ``,
    `## ${kwCap} Tools and Resources`,
    `*~300 words. Curated list with brief descriptions.*`,
    ``,
    `## Common ${kwCap} Mistakes`,
    `*~300 words.*`,
    ``,
    `## ${kwCap} Case Studies`,
    `*~400 words. Real examples with results.*`,
    ``,
    `## Frequently Asked Questions`,
    `*~500 words. 6-8 questions.*`,
    ``,
    `## Conclusion`,
    `*~150 words. Summary + CTA + internal links to cluster content.*`,
  ];
}

function comparisonSections(
  topic: string,
  keyword: string,
  kwCap: string,
  year: number
): string[] {
  return [
    `# ${topic}: Which Is Right for You? (${year} Comparison)`,
    `*~150 words. Frame the comparison, include "${keyword}".*`,
    ``,
    `## TL;DR Summary`,
    `*Quick comparison table + one-sentence verdict.*`,
    ``,
    `## What Is [Option A]?`,
    `*~250 words. Overview, pros, cons.*`,
    ``,
    `## What Is [Option B]?`,
    `*~250 words. Overview, pros, cons.*`,
    ``,
    `## Head-to-Head Comparison`,
    ``,
    `### Price`,
    `*~150 words.*`,
    ``,
    `### Features`,
    `*~200 words.*`,
    ``,
    `### Ease of Use`,
    `*~150 words.*`,
    ``,
    `### Performance`,
    `*~150 words.*`,
    ``,
    `### Customer Support`,
    `*~100 words.*`,
    ``,
    `## When to Choose [Option A]`,
    `*~200 words.*`,
    ``,
    `## When to Choose [Option B]`,
    `*~200 words.*`,
    ``,
    `## Frequently Asked Questions`,
    `*~250 words.*`,
    ``,
    `## Our Verdict`,
    `*~150 words. Clear recommendation.*`,
  ];
}

function reviewSections(
  topic: string,
  keyword: string,
  kwCap: string,
  year: number
): string[] {
  return [
    `# ${topic} Review (${year}): Is It Worth It?`,
    `*~150 words. Include "${keyword}". State who the review is for.*`,
    ``,
    `## Quick Verdict`,
    `*Rating box + 2-3 sentence summary.*`,
    ``,
    `## Who Is ${kwCap} For?`,
    `*~200 words. Ideal user profiles.*`,
    ``,
    `## Key Features`,
    `*~400 words. Feature-by-feature breakdown.*`,
    ``,
    `## Pricing`,
    `*~200 words. Tiers, value assessment.*`,
    ``,
    `## What We Like`,
    `*~250 words. Bullet list with explanations.*`,
    ``,
    `## What Could Be Better`,
    `*~200 words. Honest cons.*`,
    ``,
    `## How It Compares to Alternatives`,
    `*~300 words. Brief comparison table.*`,
    ``,
    `## Our Testing Process`,
    `*~150 words. Builds E-E-A-T.*`,
    ``,
    `## Frequently Asked Questions`,
    `*~200 words.*`,
    ``,
    `## Final Rating`,
    `*~150 words. Score breakdown by category.*`,
  ];
}
