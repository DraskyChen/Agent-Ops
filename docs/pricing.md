# Model Pricing

## DeepSeek

Prices were captured from the official DeepSeek pricing page on 2026-11-21:

https://api-docs.deepseek.com/quick_start/pricing/

Prices are USD per one million tokens.

| Model | Period | Cache-hit input | Cache-miss input | Output |
| --- | --- | ---: | ---: | ---: |
| `deepseek-flash` | Off-peak | $0.003 | $0.15 | $0.60 |
| `deepseek-flash` | Peak | $0.006 | $0.30 | $1.20 |
| `deepseek-v4-pro` | Off-peak | $0.022 | $0.66 | $1.98 |
| `deepseek-v4-pro` | Peak | $0.044 | $1.32 | $3.96 |

Official peak windows:

- 01:00-04:00 UTC, Monday through Friday.
- 06:00-10:00 UTC, Monday through Friday.
- Off-peak is half price and applies at all other times, including weekends.

The current implementation uses UTC weekdays and time windows. Chinese public
holidays are not yet loaded into a calendar, so those holiday periods are
priced using the regular weekday peak rule until a holiday calendar is added.

The retired aliases `deepseek-v4-flash` and
`deepseek-v4-flash-vision-exp` are retained in the price table because
DeepSeek documents that requests using those names are served by the Flash
model and billed at Flash rates.

## Storage representation

Prices are stored in integer micro-units of USD:

```text
$1.00 = 1,000,000 micros
```

For an LLM span:

```text
cache_hit_input = min(input_tokens, cached_input_tokens)
cache_miss_input = input_tokens - cache_hit_input

cost =
  cache_hit_input * cache_hit_rate / 1M
  + cache_miss_input * cache_miss_rate / 1M
  + output_tokens * output_rate / 1M
```

The Worker chooses the price row using the model, UTC peak/off-peak tier, and
the LLM span start time. It writes the selected `price_version_id` and
micro-unit cost back to the span, then sums span costs into the Trace.

