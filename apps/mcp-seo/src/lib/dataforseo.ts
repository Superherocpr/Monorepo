const BASE_URL = "https://api.dataforseo.com/v3";

function authHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error(
      "Missing DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD environment variables"
    );
  }
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DataForSEO ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface KeywordDataItem {
  keyword: string;
  search_volume: number | null;
  keyword_difficulty: number | null;
  cpc: number | null;
  competition: number | null;
}

export interface KeywordSuggestionsResult {
  suggestions: KeywordDataItem[];
  related_keywords: KeywordDataItem[];
  questions: string[];
}

export async function getKeywordSuggestions(
  keyword: string,
  locationCode = 2840, // US
  languageCode = "en"
): Promise<KeywordSuggestionsResult> {
  // Keyword suggestions
  const [suggestionsResp, relatedResp, questionsResp] = await Promise.all([
    post<DataForSEOResponse>("/dataforseo_labs/google/keyword_suggestions/live", [
      { keyword, location_code: locationCode, language_code: languageCode, limit: 20, include_seed_keyword: true },
    ]),
    post<DataForSEOResponse>("/dataforseo_labs/google/related_keywords/live", [
      { keyword, location_code: locationCode, language_code: languageCode, depth: 1, limit: 20 },
    ]),
    post<DataForSEOResponse>("/dataforseo_labs/google/keyword_ideas/live", [
      { keywords: [keyword], location_code: locationCode, language_code: languageCode, limit: 50 },
    ]),
  ]);

  const suggestions = extractItems(suggestionsResp).map(toKeywordDataItem);
  const related = extractItems(relatedResp).map(toKeywordDataItem);

  // Filter to question-style keywords from ideas
  const allIdeas: string[] = extractItems(questionsResp).map(
    (i: DataForSEOItem) => i.keyword ?? ""
  );
  const questionPrefixes = ["how", "what", "why", "when", "where", "which", "who", "is", "are", "can", "do", "does", "will"];
  const questions = allIdeas
    .filter((k) => questionPrefixes.some((p) => k.toLowerCase().startsWith(p)))
    .slice(0, 15);

  return { suggestions, related_keywords: related, questions };
}

export interface SerpResult {
  title: string;
  url: string;
  description: string | null;
  rank_position: number;
}

export async function getSerpResults(
  keyword: string,
  locationCode = 2840
): Promise<SerpResult[]> {
  const resp = await post<DataForSEOResponse>(
    "/serp/google/organic/live/advanced",
    [{ keyword, location_code: locationCode, language_code: "en", os: "windows", depth: 10 }]
  );
  const items = extractItems(resp);
  return items
    .filter((i: DataForSEOItem) => i.type === "organic")
    .slice(0, 10)
    .map((i: DataForSEOItem) => ({
      title: i.title ?? "",
      url: i.url ?? "",
      description: i.description ?? null,
      rank_position: i.rank_position ?? 0,
    }));
}

// ── Internal types ────────────────────────────────────────────────────────────

interface DataForSEOResponse {
  status_code: number;
  tasks?: Array<{
    status_code: number;
    result?: Array<{ items?: DataForSEOItem[]; items_count?: number }>;
  }>;
}

interface DataForSEOItem {
  keyword?: string;
  keyword_data?: {
    keyword_info?: {
      search_volume?: number;
      cpc?: number;
      competition?: number;
    };
    keyword_properties?: { keyword_difficulty?: number };
  };
  search_volume?: number;
  keyword_difficulty?: number;
  cpc?: number;
  competition?: number;
  type?: string;
  title?: string;
  url?: string;
  description?: string;
  rank_position?: number;
}

function extractItems(resp: DataForSEOResponse): DataForSEOItem[] {
  return resp.tasks?.[0]?.result?.[0]?.items ?? [];
}

function toKeywordDataItem(i: DataForSEOItem): KeywordDataItem {
  const info = i.keyword_data?.keyword_info;
  const props = i.keyword_data?.keyword_properties;
  return {
    keyword: i.keyword ?? "",
    search_volume: info?.search_volume ?? i.search_volume ?? null,
    keyword_difficulty: props?.keyword_difficulty ?? i.keyword_difficulty ?? null,
    cpc: info?.cpc ?? i.cpc ?? null,
    competition: info?.competition ?? i.competition ?? null,
  };
}
