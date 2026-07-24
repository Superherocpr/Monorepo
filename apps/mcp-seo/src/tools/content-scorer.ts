import {
  fleschKincaid,
  countWords,
  keywordDensity,
  extractHeadings,
  stripMarkdown,
} from "../lib/text-analysis.js";

export const contentScorerSchema = {
  name: "score_content",
  description:
    "Score a blog article draft against SEO best practices. Analyzes keyword usage, content structure, readability, word count, heading hierarchy, and internal link opportunities. Returns a score out of 100 with specific, actionable improvement recommendations.",
  inputSchema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description:
          "The full article content in markdown or plain text format",
      },
      target_keyword: {
        type: "string",
        description: "The primary keyword this article is targeting",
      },
      meta_title: {
        type: "string",
        description: "The article's title tag (optional but recommended for full scoring)",
      },
      meta_description: {
        type: "string",
        description: "The article's meta description (optional)",
      },
    },
    required: ["content", "target_keyword"],
  },
} as const;

interface Check {
  label: string;
  passed: boolean;
  points: number;
  maxPoints: number;
  feedback: string;
}

export function scoreContent(args: {
  content: string;
  target_keyword: string;
  meta_title?: string;
  meta_description?: string;
}): string {
  const { content, target_keyword, meta_title, meta_description } = args;
  const plainText = stripMarkdown(content);
  const kw = target_keyword.toLowerCase().trim();

  const checks: Check[] = [
    checkWordCount(plainText),
    checkKeywordInIntro(plainText, kw),
    checkKeywordDensity(plainText, kw),
    checkHeadingStructure(content, kw),
    checkReadability(plainText),
    checkParagraphLength(plainText),
    checkLists(content),
    checkImages(content),
    checkInternalLinks(content),
    checkMetaTitle(meta_title, kw),
    checkMetaDescription(meta_description, kw),
  ];

  const totalPoints = checks.reduce((s, c) => s + c.points, 0);
  const maxPoints = checks.reduce((s, c) => s + c.maxPoints, 0);
  const score = Math.round((totalPoints / maxPoints) * 100);

  const grade =
    score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

  const passed = checks.filter((c) => c.passed);
  const failed = checks.filter((c) => !c.passed);

  const lines: string[] = [
    `# SEO Content Score: ${score}/100 (${grade})`,
    `**Target keyword:** ${target_keyword}`,
    `**Word count:** ${countWords(plainText).toLocaleString()} words`,
    "",
    progressBar(score),
    "",
    "## Results Breakdown",
    "",
    "### ✅ Passing",
    ...passed.map(
      (c) => `- **${c.label}** (+${c.points}/${c.maxPoints}) — ${c.feedback}`
    ),
    "",
    "### ❌ Needs Improvement",
    ...(failed.length > 0
      ? failed.map(
          (c) => `- **${c.label}** (0/${c.maxPoints}) — ${c.feedback}`
        )
      : ["- Nothing! Great work."]),
    "",
    "## Priority Action Items",
    ...getPriorityActions(failed),
    "",
    "## Detailed Stats",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Word count | ${countWords(plainText).toLocaleString()} |`,
    `| Flesch-Kincaid score | ${Math.round(fleschKincaid(plainText))} |`,
    `| Keyword density | ${keywordDensity(plainText, target_keyword).density}% |`,
    `| Keyword occurrences | ${keywordDensity(plainText, target_keyword).count} |`,
    `| H2 headings | ${extractHeadings(content).filter((h) => h.tag === "h2").length} |`,
    `| H3 headings | ${extractHeadings(content).filter((h) => h.tag === "h3").length} |`,
  ];

  return lines.join("\n");
}

function progressBar(score: number): string {
  const filled = Math.round(score / 5);
  const empty = 20 - filled;
  const color = score >= 80 ? "🟢" : score >= 60 ? "🟡" : "🔴";
  return `${color} ${"█".repeat(filled)}${"░".repeat(empty)} ${score}%`;
}

function getPriorityActions(failed: Check[]): string[] {
  if (failed.length === 0) return ["- All checks passed! Consider adding more LSI keywords and internal links."];
  const high = failed.filter((c) => c.maxPoints >= 15);
  const low = failed.filter((c) => c.maxPoints < 15);
  const actions = [
    ...high.map((c) => `1. 🔴 **[High Impact]** ${c.feedback}`),
    ...low.map((c) => `2. 🟡 **[Quick Win]** ${c.feedback}`),
  ];
  return actions.slice(0, 5);
}

// ── Individual checks ─────────────────────────────────────────────────────────

function checkWordCount(text: string): Check {
  const words = countWords(text);
  const passed = words >= 1500;
  return {
    label: "Word Count",
    passed,
    points: passed ? 15 : words >= 800 ? 8 : 0,
    maxPoints: 15,
    feedback: passed
      ? `${words.toLocaleString()} words — excellent length`
      : `${words.toLocaleString()} words — aim for 1,500+ for competitive rankings (2,000+ for pillar content)`,
  };
}

function checkKeywordInIntro(text: string, kw: string): Check {
  const intro = text.slice(0, 600).toLowerCase();
  const passed = intro.includes(kw);
  return {
    label: "Keyword in Introduction",
    passed,
    points: passed ? 15 : 0,
    maxPoints: 15,
    feedback: passed
      ? `"${kw}" found in the opening section`
      : `Add "${kw}" within the first 100-150 words of the article`,
  };
}

function checkKeywordDensity(text: string, kw: string): Check {
  const { density, count } = keywordDensity(text, kw);
  const passed = density >= 0.5 && density <= 2.5;
  const tooLow = density < 0.5;
  const tooHigh = density > 2.5;
  return {
    label: "Keyword Density",
    passed,
    points: passed ? 10 : 0,
    maxPoints: 10,
    feedback: passed
      ? `${density}% density (${count} occurrences) — in the ideal 0.5–2.5% range`
      : tooLow
        ? `${density}% density (${count} occurrences) — too low, use "${kw}" more naturally (target 0.5–2.5%)`
        : `${density}% density (${count} occurrences) — possible keyword stuffing, reduce to 0.5–2.5%`,
  };
}

function checkHeadingStructure(content: string, kw: string): Check {
  const headings = extractHeadings(content);
  const h1s = headings.filter((h) => h.tag === "h1");
  const h2s = headings.filter((h) => h.tag === "h2");
  const kwInH2 = h2s.some((h) => h.text.toLowerCase().includes(kw));
  const hasH1 = h1s.length === 1;
  const hasMultipleH2 = h2s.length >= 3;
  const passed = hasH1 && hasMultipleH2 && kwInH2;
  const issues: string[] = [];
  if (!hasH1) issues.push("no single H1 found");
  if (!hasMultipleH2) issues.push(`only ${h2s.length} H2(s) — add more sections`);
  if (!kwInH2) issues.push(`no H2 contains "${kw}"`);
  return {
    label: "Heading Structure",
    passed,
    points: passed ? 15 : (hasH1 ? 5 : 0) + (hasMultipleH2 ? 5 : 0),
    maxPoints: 15,
    feedback: passed
      ? `Good structure: 1 H1, ${h2s.length} H2s, keyword in headings`
      : `Fix heading issues: ${issues.join("; ")}`,
  };
}

function checkReadability(text: string): Check {
  const score = fleschKincaid(text);
  const passed = score >= 50;
  return {
    label: "Readability",
    passed,
    points: passed ? 10 : 0,
    maxPoints: 10,
    feedback: passed
      ? `Flesch-Kincaid score ${Math.round(score)} — easy to read`
      : `Flesch-Kincaid score ${Math.round(score)} — too complex; use shorter sentences and simpler words (target 60–70)`,
  };
}

function checkParagraphLength(text: string): Check {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 50);
  const longParas = paragraphs.filter((p) => countWords(p) > 150);
  const passed = longParas.length === 0 || longParas.length / paragraphs.length < 0.2;
  return {
    label: "Paragraph Length",
    passed,
    points: passed ? 5 : 0,
    maxPoints: 5,
    feedback: passed
      ? "Paragraphs are concise and scannable"
      : `${longParas.length} paragraph(s) exceed 150 words — break them up for better readability`,
  };
}

function checkLists(content: string): Check {
  const listItems = (content.match(/^[\s]*[-*+]\s|^[\s]*\d+\.\s/gm) || []).length;
  const passed = listItems >= 3;
  return {
    label: "Lists & Bullet Points",
    passed,
    points: passed ? 5 : 0,
    maxPoints: 5,
    feedback: passed
      ? `${listItems} list items found — good for scannability`
      : "Add bullet points or numbered lists (at least 3 items) to improve scannability",
  };
}

function checkImages(content: string): Check {
  const images = (content.match(/!\[.+?\]\(.+?\)/g) || []).length;
  const passed = images >= 2;
  return {
    label: "Images",
    passed,
    points: passed ? 5 : 0,
    maxPoints: 5,
    feedback: passed
      ? `${images} image(s) found — ensure all have descriptive alt text`
      : `Only ${images} image(s) — add at least 2 relevant images with keyword-rich alt text`,
  };
}

function checkInternalLinks(content: string): Check {
  const links = content.match(/\[.+?\]\((?!http).+?\)/g) || [];
  const passed = links.length >= 2;
  return {
    label: "Internal Links",
    passed,
    points: passed ? 5 : 0,
    maxPoints: 5,
    feedback: passed
      ? `${links.length} internal link(s) found`
      : `Add at least 2 internal links to related content on your site`,
  };
}

function checkMetaTitle(title: string | undefined, kw: string): Check {
  if (!title) {
    return {
      label: "Meta Title",
      passed: false,
      points: 0,
      maxPoints: 10,
      feedback: "No meta title provided — use the generate_meta_tags tool to create one",
    };
  }
  const kwInTitle = title.toLowerCase().includes(kw);
  const goodLength = title.length >= 30 && title.length <= 60;
  const passed = kwInTitle && goodLength;
  return {
    label: "Meta Title",
    passed,
    points: passed ? 10 : kwInTitle || goodLength ? 5 : 0,
    maxPoints: 10,
    feedback: passed
      ? `Title is ${title.length} chars and contains "${kw}"`
      : `Title issues: ${!kwInTitle ? `missing "${kw}"` : ""}${!goodLength ? ` length is ${title.length} (target 30-60)` : ""}`.trim(),
  };
}

function checkMetaDescription(desc: string | undefined, kw: string): Check {
  if (!desc) {
    return {
      label: "Meta Description",
      passed: false,
      points: 0,
      maxPoints: 5,
      feedback: "No meta description provided — use generate_meta_tags to create one",
    };
  }
  const kwInDesc = desc.toLowerCase().includes(kw);
  const goodLength = desc.length >= 120 && desc.length <= 160;
  const passed = kwInDesc && goodLength;
  return {
    label: "Meta Description",
    passed,
    points: passed ? 5 : 0,
    maxPoints: 5,
    feedback: passed
      ? `Description is ${desc.length} chars — good`
      : `Description issues: ${!kwInDesc ? `missing "${kw}"` : ""}${!goodLength ? ` length is ${desc.length} (target 120-160)` : ""}`.trim(),
  };
}
