"use client";

/**
 * SeoPanel — DataForSEO keyword check panel in the blog editor.
 * Shows keyword search volume / competition from DataForSEO plus a local content checklist.
 * Used by BlogEditorClient.
 */

import { useState } from "react";
import type { KeywordMetrics, ChecklistItem } from "@/app/api/admin/blog/seo-check/route";

interface SeoPanelProps {
  keyword: string;
  title: string;
  body: string;
  excerpt: string;
  seoDescription: string;
}

interface SeoResult {
  keyword: KeywordMetrics;
  checklist: ChecklistItem[];
}

/**
 * Calls /api/admin/blog/seo-check with the current post content
 * and renders keyword metrics + a pass/fail checklist.
 */
export default function SeoPanel({ keyword, title, body, excerpt, seoDescription }: SeoPanelProps): React.ReactElement {
  const [result, setResult] = useState<SeoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheck(): Promise<void> {
    if (!keyword.trim()) {
      setError("Enter a target keyword first.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/admin/blog/seo-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, title, body, excerpt, seo_description: seoDescription }),
      });

      const json = (await res.json()) as { data: SeoResult | null; error: string | null };
      if (!json.data) {
        setError(json.error ?? "SEO check failed");
      } else {
        setResult(json.data);
      }
    } catch {
      setError("SEO check failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const passCount = result?.checklist.filter((c) => c.pass).length ?? 0;
  const totalCount = result?.checklist.length ?? 0;
  const score = totalCount > 0 ? Math.round((passCount / totalCount) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">SEO Check</span>
        {score !== null && (
          <span
            className={[
              "text-sm font-bold",
              score >= 80 ? "text-green-600" : score >= 50 ? "text-yellow-600" : "text-red-600",
            ].join(" ")}
          >
            {score}% ({passCount}/{totalCount})
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={handleCheck}
        disabled={loading || !keyword.trim()}
        className="w-full py-2 px-4 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
      >
        {loading ? "Checking…" : "Check SEO"}
      </button>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {result && (
        <div className="space-y-4">
          {/* Keyword metrics from DataForSEO */}
          {result.keyword.monthly_searches !== null && (
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Keyword data</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-base font-bold text-gray-900">
                    {result.keyword.monthly_searches?.toLocaleString() ?? "—"}
                  </p>
                  <p className="text-xs text-gray-500">Monthly searches</p>
                </div>
                <div>
                  <p className="text-base font-bold text-gray-900">
                    {result.keyword.competition_level ?? "—"}
                  </p>
                  <p className="text-xs text-gray-500">Competition</p>
                </div>
                <div>
                  <p className="text-base font-bold text-gray-900">
                    {result.keyword.cpc !== null ? `$${result.keyword.cpc.toFixed(2)}` : "—"}
                  </p>
                  <p className="text-xs text-gray-500">CPC</p>
                </div>
              </div>
            </div>
          )}

          {/* Content checklist */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Content checklist</p>
            {result.checklist.map((item) => (
              <div key={item.label} className="flex items-start gap-2">
                <span
                  className={["mt-0.5 shrink-0 text-base", item.pass ? "text-green-500" : "text-red-500"].join(" ")}
                  aria-hidden="true"
                >
                  {item.pass ? "✓" : "✗"}
                </span>
                <div>
                  <p className={["text-sm", item.pass ? "text-gray-700" : "text-gray-600"].join(" ")}>
                    {item.label}
                  </p>
                  {!item.pass && item.note && (
                    <p className="text-xs text-gray-400">{item.note}</p>
                  )}
                  {item.pass && item.note && (
                    <p className="text-xs text-gray-400">{item.note}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
