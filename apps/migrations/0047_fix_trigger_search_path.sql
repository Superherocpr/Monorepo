-- Migration 0047: Pin search_path on blog_posts_set_updated_at trigger function
--
-- Without a fixed search_path, a function resolves schema names at call time,
-- which opens a search_path injection vector if the caller controls their
-- session's search_path. Adding SET search_path = public locks resolution to
-- the public schema regardless of the calling context.

CREATE OR REPLACE FUNCTION public.blog_posts_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
