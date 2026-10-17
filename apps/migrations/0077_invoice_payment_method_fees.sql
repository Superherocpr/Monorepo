-- 0077: record HOW an invoice was paid, and what that cost
--
-- Background: invoice earnings had no fee information at all. A PayPal invoice
-- paid through PayPal costs the ordinary collection fee; an invoice paid by check,
-- cash or bank transfer costs nothing. The app could not tell them apart, so every
-- invoice showed up as "no fee recorded" and the payout dashboard's net figure was
-- flagged as optimistic even when the true fee was a known $0.
--
-- This adds the three facts needed to say it exactly:
--   payment_method      - how the money arrived. Chosen by whoever marks the
--                         invoice paid, or 'paypal' when PayPal's own webhook
--                         reports the payment.
--   paypal_fee_amount   - what PayPal charged to collect it. 0 for every
--                         non-PayPal method (a known zero, not "unknown").
--                         NULL for a PayPal payment whose fee has not been read
--                         from PayPal yet; the hourly sync fills it in.
--   net_amount          - what actually reached the business account
--                         (total_amount - paypal_fee_amount). NULL while the fee is.
--
-- NULL still means "not tracked", never zero, exactly as on payments (0048).
--
-- Existing paid invoices are NOT backfilled here: this migration cannot know how
-- they were paid. Set them by hand once, e.g. for a check:
--   update invoices set payment_method = 'check', paypal_fee_amount = 0,
--          net_amount = total_amount where invoice_number = 'INV-00004';

alter table invoices
  add column if not exists payment_method    text,
  add column if not exists paypal_fee_amount numeric(10, 2),
  add column if not exists net_amount        numeric(10, 2);

alter table invoices
  add constraint invoices_payment_method_check
    check (payment_method is null
           or payment_method in ('paypal', 'check', 'cash', 'bank_transfer', 'other')),
  -- A fee and a net amount are always recorded together.
  add constraint invoices_fee_net_together_check
    check ((paypal_fee_amount is null) = (net_amount is null)),
  -- Only PayPal charges a collection fee. Any other method that records a fee
  -- must record exactly zero, so a typo cannot invent a cost.
  add constraint invoices_non_paypal_zero_fee_check
    check (payment_method is null
           or payment_method = 'paypal'
           or paypal_fee_amount = 0),
  add constraint invoices_fee_not_negative_check
    check (paypal_fee_amount is null or paypal_fee_amount >= 0);

comment on column invoices.payment_method is
  'How the invoice was paid: paypal, check, cash, bank_transfer or other. NULL on invoices paid before migration 0077 and on unpaid invoices.';
comment on column invoices.paypal_fee_amount is
  'PayPal collection fee in dollars. 0 for non-PayPal methods; NULL = not yet known (a PayPal payment awaiting the hourly fee sync, or a pre-0077 invoice).';
comment on column invoices.net_amount is
  'Amount credited to the business account after the fee (total_amount - paypal_fee_amount). NULL whenever paypal_fee_amount is.';
