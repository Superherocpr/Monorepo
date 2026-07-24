export const metaGeneratorSchema = {
  name: "generate_meta_tags",
  description:
    "Generate SEO-optimized title tags and meta descriptions for a blog article. Produces multiple variants so you can A/B test or pick the best fit. Follows Google's character limits and click-through rate best practices.",
  inputSchema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "The article topic or title draft",
      },
      target_keyword: {
        type: "string",
        description: "The primary keyword to include in the meta tags",
      },
      brand_name: {
        type: "string",
        description:
          "Optional brand name to append to title tags (e.g. '| Superhero CPR')",
      },
      content_snippet: {
        type: "string",
        description:
          "Optional excerpt from the article to use as source material for the meta description",
      },
    },
    required: ["topic", "target_keyword"],
  },
} as const;

export function generateMetaTags(args: {
  topic: string;
  target_keyword: string;
  brand_name?: string;
  content_snippet?: string;
}): string {
  const { topic, target_keyword, brand_name, content_snippet } = args;
  const kw = target_keyword.trim();
  const brandSuffix = brand_name ? ` | ${brand_name}` : "";

  // Title variants — keyword near the front, under 60 chars (before brand)
  const titleVariants = buildTitleVariants(topic, kw, brandSuffix);

  // Meta description variants — 150–160 chars, keyword in first 100 chars, CTA
  const descVariants = buildDescriptionVariants(topic, kw, content_snippet);

  const lines: string[] = [
    `# Meta Tags for: "${topic}"`,
    `**Target keyword:** ${kw}`,
    "",
    "## Title Tag Variants",
    ...titleVariants.map((t, i) => [
      `### Option ${i + 1} (${t.length} chars)`,
      `\`\`\``,
      t,
      `\`\`\``,
      t.length > 60 + brandSuffix.length
        ? `⚠️  May truncate in SERPs — consider shortening`
        : `✅ Good length`,
    ]).flat(),
    "",
    "## Meta Description Variants",
    ...descVariants.map((d, i) => [
      `### Option ${i + 1} (${d.length} chars)`,
      `\`\`\``,
      d,
      `\`\`\``,
      d.length < 120
        ? `⚠️  Short — consider expanding (target 150-160 chars)`
        : d.length > 160
          ? `⚠️  Too long — will be truncated (${d.length - 160} chars over)`
          : `✅ Good length`,
    ]).flat(),
    "",
    "## Best Practices Checklist",
    `- [ ] Title tag contains "${kw}" within the first 60 characters`,
    `- [ ] Meta description is 150–160 characters`,
    `- [ ] Meta description includes "${kw}" in the first 100 characters`,
    `- [ ] Meta description has a clear call to action (Learn, Discover, Get, etc.)`,
    `- [ ] Title is unique — doesn't duplicate another page on your site`,
    `- [ ] Description accurately reflects the article content`,
  ];

  return lines.join("\n");
}

function buildTitleVariants(
  topic: string,
  kw: string,
  brandSuffix: string
): string[] {
  const topicClean = topic.replace(/[|\-–—]/g, "").trim();
  const kwCapitalized = kw
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const variants: string[] = [];

  // Only add keyword prefix if it's not already in the topic
  const topicLower = topicClean.toLowerCase();
  const kwLower = kw.toLowerCase();

  if (!topicLower.includes(kwLower)) {
    variants.push(`${kwCapitalized}: ${topicClean}${brandSuffix}`);
    variants.push(`${topicClean} (${kwCapitalized} Guide)${brandSuffix}`);
    variants.push(
      `The Complete ${kwCapitalized} Guide: ${topicClean}${brandSuffix}`
    );
  } else {
    variants.push(`${topicClean}${brandSuffix}`);
    variants.push(
      `${topicClean} — Complete Guide${brandSuffix}`
    );
    variants.push(`How to ${topicClean}${brandSuffix}`);
  }

  // Always add a year variant
  const year = new Date().getFullYear();
  variants.push(`${topicClean} (${year} Guide)${brandSuffix}`);

  return [...new Set(variants)].slice(0, 4);
}

function buildDescriptionVariants(
  topic: string,
  kw: string,
  snippet?: string
): string[] {
  const variants: string[] = [];

  const ctas = [
    "Learn more in our complete guide.",
    "Read our expert guide to get started.",
    "Discover everything you need to know.",
    "Get the full breakdown here.",
  ];

  if (snippet) {
    // Trim snippet and combine with CTA
    const clean = snippet.replace(/\s+/g, " ").trim();
    const base = clean.length > 120 ? clean.slice(0, 117) + "..." : clean;
    variants.push(`${base} ${ctas[0]}`);
  }

  variants.push(
    `Looking to learn about ${kw}? This guide covers everything you need to know about ${topic.toLowerCase()}. ${ctas[1]}`
  );
  variants.push(
    `${topic}. We break down ${kw} step by step so you can master it quickly. ${ctas[2]}`
  );
  variants.push(
    `Struggling with ${kw}? Our in-depth article on ${topic.toLowerCase()} explains it clearly. ${ctas[3]}`
  );

  return variants.slice(0, 4);
}
