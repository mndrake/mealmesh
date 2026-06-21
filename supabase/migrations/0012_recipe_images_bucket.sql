-- Public Storage bucket for re-hosted imported-recipe images. The import function downloads
-- the recipe's photo (from the page, or an AI-found openly-licensed image) and re-hosts it
-- here so the app serves images from our own Supabase origin — the CSP img-src stays scoped
-- (no broad "https:" allowance) and links don't rot when source sites change.
--
-- Uploads happen via the service role (the Netlify function), which bypasses RLS, so no
-- write policy is needed. A public bucket is world-readable by URL (recipe photos only;
-- consistent with the app's personal-use image handling), which is what the <img> tag needs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recipe-images',
  'recipe-images',
  true,
  5242880,  -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;
