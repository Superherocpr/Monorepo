-- Blog feature: posts, tags, post-tag junction, and slug redirects for SEO.

-- ── Tags ──────────────────────────────────────────────────────────────────────
CREATE TABLE blog_tags (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  slug        text        NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Posts ─────────────────────────────────────────────────────────────────────
CREATE TABLE blog_posts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text        NOT NULL,
  slug             text        NOT NULL UNIQUE,
  excerpt          text,
  body             text        NOT NULL DEFAULT '',
  cover_image_url  text,
  seo_title        text,
  seo_description  text,
  target_keyword   text,
  status           text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Post ↔ Tag junction ───────────────────────────────────────────────────────
CREATE TABLE blog_post_tags (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id  uuid NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  tag_id   uuid NOT NULL REFERENCES blog_tags(id)  ON DELETE CASCADE,
  UNIQUE (post_id, tag_id)
);

-- ── Slug redirects (SEO: preserve old URLs when slug changes) ─────────────────
CREATE TABLE blog_slug_redirects (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  old_slug  text        NOT NULL UNIQUE,
  new_slug  text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION blog_posts_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER blog_posts_updated_at
  BEFORE UPDATE ON blog_posts
  FOR EACH ROW EXECUTE FUNCTION blog_posts_set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE blog_tags            ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_posts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_post_tags       ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_slug_redirects  ENABLE ROW LEVEL SECURITY;

-- Public can read tags (needed for listing and filter pages)
CREATE POLICY "public_read_tags" ON blog_tags
  FOR SELECT USING (true);

-- Public can read published posts only
CREATE POLICY "public_read_published_posts" ON blog_posts
  FOR SELECT USING (status = 'published');

-- Public can read post-tag rows for published posts
CREATE POLICY "public_read_post_tags" ON blog_post_tags
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM blog_posts p
      WHERE p.id = blog_post_tags.post_id AND p.status = 'published'
    )
  );

-- Public can read slug redirects (needed for 301 handling in the page route)
CREATE POLICY "public_read_slug_redirects" ON blog_slug_redirects
  FOR SELECT USING (true);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX blog_posts_status_published_at ON blog_posts (status, published_at DESC);
CREATE INDEX blog_posts_slug                ON blog_posts (slug);
CREATE INDEX blog_post_tags_post_id         ON blog_post_tags (post_id);
CREATE INDEX blog_post_tags_tag_id          ON blog_post_tags (tag_id);
CREATE INDEX blog_slug_redirects_old_slug   ON blog_slug_redirects (old_slug);
