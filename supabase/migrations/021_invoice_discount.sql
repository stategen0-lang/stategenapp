-- Per-invoice discount. subtotal is the pre-discount price (the plan's price, or
-- an operator override); amount stays the payable total after the discount, so
-- the "paying an invoice activates the company" flow is unchanged.
alter table invoices
  add column if not exists discount_pct numeric not null default 0,
  add column if not exists subtotal     numeric;

-- Existing invoices had no discount: their subtotal equals what was charged.
update invoices set subtotal = amount where subtotal is null;
