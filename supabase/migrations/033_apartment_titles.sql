-- "Appartement" / "Apartement" → "Apartment", in the text people actually read.
--
-- 031 fixed the property TYPE, which lives as "type":"Appartement" inside the
-- Amenities JSON blob. That is the field the app matches and filters on, and it
-- is now clean — but it is not the text on the screen. The title is, and 24
-- titles still carried the French spelling:
--
--   "175 m² Appartement for sale in Bet el Kiko"
--   "Apartement for sale"
--
-- which is what kept showing up in the app, in the WhatsApp replies and in the
-- marketing emails after 031 had supposedly fixed it.
--
-- Eight listings also carry the word inside their AI-written description, held
-- in the same blob. Same word, same screen, so the same pass.
--
-- Two misspellings are in the data: "Appartement" (French) and "Apartement"
-- (one p). Both cases of each are replaced so a mid-sentence "appartement" in a
-- description does not come back capitalised.
--
-- Safe to run more than once: a second run finds nothing to replace. The code
-- never writes either spelling — it only reads them as aliases (see
-- propertyType in db-mappers.ts and canonicalPropertyType in whatsapp/
-- match-query.ts) — so nothing will reintroduce them.

-- ── Titles ──────────────────────────────────────────────────────────────────
update "Properties"
   set "Title" = replace(replace(replace(replace("Title",
         'Appartement', 'Apartment'),
         'appartement', 'apartment'),
         'Apartement', 'Apartment'),
         'apartement', 'apartment')
 where "Title" ilike '%appartement%' or "Title" ilike '%apartement%';

-- ── Descriptions (and anything else inside the blob) ────────────────────────
-- 031 already dealt with "type":"Appartement"; what is left here is prose.
update "Properties"
   set "Amenities" = replace(replace(replace(replace("Amenities",
         'Appartement', 'Apartment'),
         'appartement', 'apartment'),
         'Apartement', 'Apartment'),
         'apartement', 'apartment')
 where "Amenities" ilike '%appartement%' or "Amenities" ilike '%apartement%';

-- ── Client briefs ───────────────────────────────────────────────────────────
-- None at the time of writing, but a brief typed before the spelling change
-- can carry it in its notes, and this keeps the two tables consistent.
update client_requests
   set notes = replace(replace(replace(replace(notes,
         'Appartement', 'Apartment'),
         'appartement', 'apartment'),
         'Apartement', 'Apartment'),
         'apartement', 'apartment')
 where notes ilike '%appartement%' or notes ilike '%apartement%';
