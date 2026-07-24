/**
 * POST /api/admin/blog/seo-check
 * Called by: SeoPanel component in the blog editor.
 * Auth: super_admin only.
 * Calls the DataForSEO Keywords Data API to get search volume and competition
 * for the target keyword, then runs a local content checklist against the post body.
 * Returns { keyword: KeywordMetrics, checklist: ChecklistItem[] }
 */

import { requireApiRole } from "@/lib/auth/effective-role";

export const runtime = "nodejs";

/** Keyword metrics returned by DataForSEO. */
export interface KeywordMetrics {
  keyword: string;
  monthly_searches: number | null;
  competition: number | null;
  competition_level: "LOW" | "MEDIUM" | "HIGH" | null;
  cpc: number | null;
}

/** A single SEO checklist item. */
export interface ChecklistItem {
  label: string;
  pass: boolean;
  note?: string;
}

/** Shape of a DataForSEO Keywords Data search volume result item. */
interface DataForSEOKeywordResult {
  keyword: string;
  keyword_info?: {
    search_volume?: number | null;
    competition?: number | null;
    competition_level?: string | null;
    cpc?: number | null;
  };
}

/**
 * Runs a keyword + content SEO check.
 * Side effects: outbound HTTPS request to DataForSEO API.
 * @param request - JSON body: { keyword: string, title: string, body: string, excerpt: string | null, seo_description: string | null }
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) return auth.error;

  let body: {
    keyword?: string;
    title?: string;
    body?: string;
    excerpt?: string | null;
    seo_description?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ data: null, error: "Invalid JSON" }, { status: 400 });
  }

  const keyword = body.keyword?.trim();
  if (!keyword) {
    return Response.json({ data: null, error: "keyword is required" }, { status: 400 });
  }

  const title = body.title ?? "";
  const content = body.body ?? "";
  const seoDesc = body.seo_description ?? body.excerpt ?? "";

  // ── 1. DataForSEO keyword metrics ─────────────────────────────────────────
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  let keywordMetrics: KeywordMetrics = {
    keyword,
    monthly_searches: null,
    competition: null,
    competition_level: null,
    cpc: null,
  };

  if (login && password) {
    try {
      const credentials = Buffer.from(`${login}:${password}`).toString("base64");
      const dfsResponse = await fetch(
        "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([{ keywords: [keyword], location_code: 2840, language_code: "en" }]),
        }
      );

      if (dfsResponse.ok) {
        const dfsData = await dfsResponse.json();
        const result: DataForSEOKeywordResult | undefined =
          dfsData?.tasks?.[0]?.result?.[0];
        if (result?.keyword_info) {
          const info = result.keyword_info;
          keywordMetrics = {
            keyword,
            monthly_searches: info.search_volume ?? null,
            competition: typeof info.competition === "number" ? Math.round(info.competition * 100) : null,
            competition_level: (info.competition_level as KeywordMetrics["competition_level"]) ?? null,
            cpc: typeof info.cpc === "number" ? Math.round(info.cpc * 100) / 100 : null,
          };
        }
      }
    } catch (err) {
      // Non-fatal — return checklist without keyword metrics.
      console.error("[seo-check] DataForSEO request failed:", err);
    }
  }

  // ── 2. Local content checklist ────────────────────────────────────────────
  const kw = keyword.toLowerCase();
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();
  const descLower = seoDesc.toLowerCase();

  // Keyword density: count occurrences in body text (strip markdown syntax first).
  const plainBody = content.replace(/[#*_`\[\]()!>~]/g, " ").replace(/\s+/g, " ");
  const wordCount = plainBody.trim().split(/\s+/).length;
  const kwOccurrences = (plainBody.toLowerCase().match(new RegExp(kw, "g")) ?? []).length;
  const density = wordCount > 0 ? (kwOccurrences / wordCount) * 100 : 0;

  const checklist: ChecklistItem[] = [
    {
      label: "Keyword in title",
      pass: titleLower.includes(kw),
      note: titleLower.includes(kw) ? undefined : `Add "${keyword}" to your title.`,
    },
    {
      label: "Keyword in meta description",
      pass: descLower.includes(kw),
      note: descLower.includes(kw) ? undefined : `Add "${keyword}" to your SEO description.`,
    },
    {
      label: "Keyword in first paragraph",
      pass: (() => {
        const firstPara = plainBody.split(/\n{2,}/)[0]?.toLowerCase() ?? "";
        return firstPara.includes(kw);
      })(),
      note: `Mention "${keyword}" early in the article.`,
    },
    {
      label: "Article length (≥ 800 words)",
      pass: wordCount >= 800,
      note: wordCount < 800 ? `${wordCount} words — aim for at least 800.` : `${wordCount} words`,
    },
    {
      label: "Keyword density (0.5–2.5%)",
      pass: density >= 0.5 && density <= 2.5,
      note: `${density.toFixed(2)}% — ${
        density < 0.5 ? "too low, use the keyword more naturally" : "too high, reduce repetition"
      }`,
    },
    {
      label: "Has excerpt / meta description",
      pass: seoDesc.trim().length > 0,
      note: "Add an excerpt or SEO description.",
    },
  ];

  return Response.json({ data: { keyword: keywordMetrics, checklist }, error: null });
}
