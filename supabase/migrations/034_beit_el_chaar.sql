-- "Beit ech Chaar" → "Beit el Chaar", in the records already filed under it.
--
-- The gazetteer entry for the Metn village has been curated to the spelling
-- agents there actually use (scripts/gen-areas.mjs, TOWNS.Metn). GeoNames gives
-- it the 1960s French form, "Beit ech Chaar", which is what the app had been
-- writing on every new listing.
--
-- That fixes anything saved from now on. It does not touch what is already
-- stored: Location, Neighborhood and Title hold the string that was written at
-- the time, and a client's areas are stored as text too. So the agency would
-- have gone on seeing the old spelling on ten listings, nine titles and fifteen
-- client briefs.
--
-- The pattern covers every variant actually present in the data — "Beit Ech
-- Chaar", "Beit ech Chaar", "Beit al Chaar", "Beit al chaar", "Beit el chaar" —
-- case-insensitively, and normalises them all to one spelling. Rows that
-- already read "Beit el Chaar" are matched too and come out unchanged, which is
-- what makes this safe to run more than once.
--
-- Note on the other village: there is a second Beit ech Chaar in Koura, 60 km
-- north, and it keeps its GeoNames spelling in the gazetteer. No row in this
-- database refers to it — every match below belongs to a Metn agency — but a
-- blanket text replace cannot tell them apart, so if a Koura listing is ever
-- added, this migration must not be re-run blindly.

update "Properties"
   set "Location" = regexp_replace("Location", 'beit[[:space:]]+(ech|el|al|esh)[[:space:]]+chaar', 'Beit el Chaar', 'gi')
 where "Location" ~* 'beit[[:space:]]+(ech|el|al|esh)[[:space:]]+chaar';

update "Properties"
   set "Neighborhood" = regexp_replace("Neighborhood", 'beit[[:space:]]+(ech|el|al|esh)[[:space:]]+chaar', 'Beit el Chaar', 'gi')
 where "Neighborhood" ~* 'beit[[:space:]]+(ech|el|al|esh)[[:space:]]+chaar';

update "Properties"
   set "Title" = regexp_replace("Title", 'beit[[:space:]]+(ech|el|al|esh)[[:space:]]+chaar', 'Beit el Chaar', 'gi')
 where "Title" ~* 'beit[[:space:]]+(ech|el|al|esh)[[:space:]]+chaar';

-- A client's wanted areas: the display string, and the JSON blob the matcher
-- actually reads (req.location / req.locations).
update client_requests
   set "prefered-location" = regexp_replace("prefered-location", 'beit[[:space:]]+(ech|el|al|esh)[[:space:]]+chaar', 'Beit el Chaar', 'gi')
 where "prefered-location" ~* 'beit[[:space:]]+(ech|el|al|esh)[[:space:]]+chaar';

update client_requests
   set notes = regexp_replace(notes, 'beit[[:space:]]+(ech|el|al|esh)[[:space:]]+chaar', 'Beit el Chaar', 'gi')
 where notes ~* 'beit[[:space:]]+(ech|el|al|esh)[[:space:]]+chaar';
