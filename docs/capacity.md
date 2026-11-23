# Agent Ops Capacity Baseline

Date: 2026-11-23  
Environment: OrbStack on a local Mac mini, PostgreSQL 16 Alpine  
Workload: 100,000 sealed traces, 10 spans per trace, 1,000,000 spans total,
spread across one day

This is a database and query baseline, not an OTLP HTTP concurrency test.

## Reproduce

Use a disposable, migrated database:

```bash
CAPACITY_TEST_DATABASE_URL=postgres://... \
  pnpm capacity:test --spans 1000000 --query-samples 10
```

The script removes rows with the generated capacity-test prefix unless `--keep`
is provided.

## Results

| Metric | Result |
| --- | ---: |
| Cross-table load | 7,221 ms |
| Direct insert throughput | 138,481 spans/s |
| Trace list P95 | 77.6 ms |
| Broad ILIKE search P95 | 125.1 ms |
| Trace detail P95, 10 spans | 6.3 ms |
| Database size after load | 873,045,015 bytes |
| `spans` total relation size | 773,332,992 bytes |
| `traces` total relation size | 90,742,784 bytes |

The list query used `traces_environment_status_idx` for the environment and
time predicate, then filtered the synthetic application-name pattern. This test
did not justify a trigram index, partition, or ClickHouse migration at a
single-day workload.

A linear storage estimate for 30 similar days is approximately 26 GB before
larger attributes, events, indexes, WAL, replication, and backups. Real traffic
must replace this estimate with a 30-day retention test.

## Acceptance Interpretation

The tested paths remain below 500 ms P95 for a single-day hot dataset. This is
evidence that PostgreSQL is a reasonable starting store for the
one-million-span-per-day target.

The following are still required before production release:

- OTLP HTTP ingest with realistic batch sizes and concurrent exporters.
- A warmed 30-day dataset rather than a newly loaded one-day dataset.
- Aggregation, metrics rollup, and evaluation workers running concurrently.
- Content-heavy spans and a 30-day metadata/content retention simulation.
- Backup timing and restore time for the resulting database and objects.
