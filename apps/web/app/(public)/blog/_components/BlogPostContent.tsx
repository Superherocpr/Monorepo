/**
 * BlogPostContent — renders a blog post's Markdown body as sanitized HTML.
 * Used by /blog/[slug] page. Server component — no client bundle cost.
 */

import { remark } from "remark";
import remarkHtml from "remark-html";
import sanitizeHtml from "sanitize-html";

interface BlogPostContentProps {
  body: string;
}

/**
 * Converts Markdown to sanitized HTML and renders it with branded prose styles.
 * @param body - Raw Markdown string from blog_posts.body.
 */
export default async function BlogPostContent({ body }: BlogPostContentProps): Promise<React.ReactElement> {
  const processed = await remark().use(remarkHtml, { sanitize: false }).process(body);
  const rawHtml = processed.toString();

  const cleanHtml = sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "alt", "title", "width", "height"],
      a: ["href", "title", "target", "rel"],
      "*": ["class"],
    },
    allowedSchemes: ["https", "http", "mailto"],
    // Strip any inline javascript: hrefs.
    allowedSchemesByTag: { a: ["https", "http", "mailto"] },
  });

  return (
    <div
      className="blog-content prose prose-gray max-w-none"
      dangerouslySetInnerHTML={{ __html: cleanHtml }}
    />
  );
}
