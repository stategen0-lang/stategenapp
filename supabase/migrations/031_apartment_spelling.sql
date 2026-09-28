-- "Appartement" → "Apartment".
--
-- The app used the French spelling for the most common property type there is.
-- It is written in English everywhere now, and the stored rows should say the
-- same thing as the screen.
--
-- The type lives inside a JSON blob held in a text column — Properties.Amenities
-- and client_requests.notes (as req.type) — so this is a targeted text replace
-- of the exact key/value pair rather than a column update. Nothing else in
-- either blob can match "type":"Appartement".
--
-- Safe to run more than once: the second run finds nothing to replace. The app
-- also reads the old spelling correctly (see propertyType in db-mappers.ts), so
-- running this is tidiness rather than a rescue — a listing whose blob still
-- says Appartement matches and displays correctly either way.

update "Properties"
   set "Amenities" = replace("Amenities", '"type":"Appartement"', '"type":"Apartment"')
 where "Amenities" like '%"type":"Appartement"%';

-- Some writers put a space after the colon.
update "Properties"
   set "Amenities" = replace("Amenities", '"type": "Appartement"', '"type": "Apartment"')
 where "Amenities" like '%"type": "Appartement"%';

update client_requests
   set notes = replace(notes, '"type":"Appartement"', '"type":"Apartment"')
 where notes like '%"type":"Appartement"%';

update client_requests
   set notes = replace(notes, '"type": "Appartement"', '"type": "Apartment"')
 where notes like '%"type": "Appartement"%';
