-- Pay rate and bill rate on structured jobs (free text, e.g. "$85/hr C2C"). Already applied.
alter table public.jobs
  add column pay_rate  text,
  add column bill_rate text;
