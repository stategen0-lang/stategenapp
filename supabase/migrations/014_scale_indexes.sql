-- 014 · Scale indexes (optional; safe to run anytime)
--
-- Every per-company read filters on company_id. The busy tables Properties and
-- client_requests have the column but no index, so those scans are sequential.
-- Fine for a handful of companies; add these before the data grows so listing
-- and client queries stay fast as more agencies come on board.

create index if not exists properties_company_idx
  on "Properties"(company_id);

create index if not exists client_requests_company_idx
  on client_requests(company_id);
