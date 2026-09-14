-- Fast "find a listing" search (WhatsApp: "edit the property of Khoury").
-- The search matches words anywhere in the title, area and the Amenities JSON
-- (which holds the owner's name/phone). "Contains" searches can't use a normal
-- index, so these trigram indexes keep them fast with thousands of listings.
-- Safe to re-run.

create extension if not exists pg_trgm;

create index if not exists properties_company_id_idx on "Properties" (company_id);
create index if not exists properties_title_trgm on "Properties" using gin ("Title" gin_trgm_ops);
create index if not exists properties_location_trgm on "Properties" using gin ("Location" gin_trgm_ops);
create index if not exists properties_neighborhood_trgm on "Properties" using gin ("Neighborhood" gin_trgm_ops);

-- Amenities is stored as JSON text; only index it when the column really is text
-- (a trigram index on a json/jsonb column would fail this migration).
do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'Properties' and column_name = 'Amenities')
     in ('text', 'character varying') then
    execute 'create index if not exists properties_amenities_trgm on "Properties" using gin ("Amenities" gin_trgm_ops)';
  end if;
end $$;
