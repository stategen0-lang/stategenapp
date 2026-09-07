-- Public-facing agency branding for shared listing pages (/l/<token>).
-- A logo (stored in the property-photos bucket, via /api/upload) and an accent
-- colour let each agency's shared links carry its own brand instead of the
-- generic "Presented by StateGen" footer. Both optional — the page falls back
-- to the company name, then to StateGen.
alter table "Companies" add column if not exists logo_url    text;
alter table "Companies" add column if not exists brand_color text;
