-- Adds routing_note to payments for audit trail when fallback routing occurs.
alter table payments
  add column routing_note text;

comment on column payments.routing_note is
  'Set when payment is routed to a non-default destination. Null when routing is normal.';
