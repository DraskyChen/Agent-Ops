alter table price_versions
  add column if not exists pricing_tier text not null default 'standard',
  add column if not exists source_url text,
  add column if not exists notes text;

create unique index if not exists price_versions_identity_idx
  on price_versions (
    provider, model_pattern, pricing_tier, currency, effective_from
  );

insert into price_versions (
  provider,
  model_pattern,
  currency,
  pricing_tier,
  input_micros_per_million_tokens,
  output_micros_per_million_tokens,
  cached_input_micros_per_million_tokens,
  reasoning_micros_per_million_tokens,
  effective_from,
  effective_to,
  source_url,
  notes
) values
  (
    'deepseek', 'deepseek-flash', 'USD', 'off_peak',
    150000, 600000, 3000, null,
    '2026-11-21T00:00:00+08:00', null,
    'https://api-docs.deepseek.com/quick_start/pricing/',
    'Official price captured 2026-11-21; cache-miss input, cache-hit input, and output rates per 1M tokens.'
  ),
  (
    'deepseek', 'deepseek-flash', 'USD', 'peak',
    300000, 1200000, 6000, null,
    '2026-11-21T00:00:00+08:00', null,
    'https://api-docs.deepseek.com/quick_start/pricing/',
    'Official price captured 2026-11-21; peak hours are double the off-peak rates.'
  ),
  (
    'deepseek', 'deepseek-v4-pro', 'USD', 'off_peak',
    660000, 1980000, 22000, null,
    '2026-11-21T00:00:00+08:00', null,
    'https://api-docs.deepseek.com/quick_start/pricing/',
    'Official price captured 2026-11-21; cache-miss input, cache-hit input, and output rates per 1M tokens.'
  ),
  (
    'deepseek', 'deepseek-v4-pro', 'USD', 'peak',
    1320000, 3960000, 44000, null,
    '2026-11-21T00:00:00+08:00', null,
    'https://api-docs.deepseek.com/quick_start/pricing/',
    'Official price captured 2026-11-21; peak hours are double the off-peak rates.'
  ),
  (
    'deepseek', 'deepseek-v4-flash', 'USD', 'off_peak',
    150000, 600000, 3000, null,
    '2026-11-21T00:00:00+08:00', null,
    'https://api-docs.deepseek.com/quick_start/pricing/',
    'Legacy alias served by DeepSeek-V4.1-Flash and billed at Flash rates.'
  ),
  (
    'deepseek', 'deepseek-v4-flash', 'USD', 'peak',
    300000, 1200000, 6000, null,
    '2026-11-21T00:00:00+08:00', null,
    'https://api-docs.deepseek.com/quick_start/pricing/',
    'Legacy alias served by DeepSeek-V4.1-Flash and billed at Flash rates.'
  ),
  (
    'deepseek', 'deepseek-v4-flash-vision-exp', 'USD', 'off_peak',
    150000, 600000, 3000, null,
    '2026-11-21T00:00:00+08:00', null,
    'https://api-docs.deepseek.com/quick_start/pricing/',
    'Legacy alias served by DeepSeek-V4.1-Flash and billed at Flash rates.'
  ),
  (
    'deepseek', 'deepseek-v4-flash-vision-exp', 'USD', 'peak',
    300000, 1200000, 6000, null,
    '2026-11-21T00:00:00+08:00', null,
    'https://api-docs.deepseek.com/quick_start/pricing/',
    'Legacy alias served by DeepSeek-V4.1-Flash and billed at Flash rates.'
  )
on conflict (
  provider, model_pattern, pricing_tier, currency, effective_from
) do nothing;

