-- Migration 0008: Add bio fields to profiles table
--
-- Adds bio_photo and bio_description columns to profiles so instructor
-- about-page content can be managed through the admin UI and stored in
-- the database rather than on the filesystem (which does not persist on
-- serverless/Amplify deployments).
--
-- bio_photo     — Public URL of the instructor's headshot stored in S3.
--                 NULL means no photo has been uploaded yet.
-- bio_description — Plain-text bio paragraph shown on the /about page.
--                 NULL means no description has been written yet.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio_photo TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bio_description TEXT DEFAULT NULL;
