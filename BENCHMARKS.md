# Benchmarks

## Running

```bash
bun run bench          # run all benchmarks
bun run bench:add      # add-jobs throughput only
bun run bench:acquire  # acquire-job latency only
```

Requires Postgres running (`bun run docker:up`).

## add-jobs (2026-03-08)

- **Pollocks version**: 1.0.0
- **Runtime**: Bun 1.3.9
- **CPU**: Apple M1 Pro (10 cores)
- **Memory**: 16GB
- **OS**: Darwin 24.6.0 (arm64)

### Add Jobs Throughput

| Batch Size | Jobs/sec | Total Jobs | Duration |
|------------|----------|------------|----------|
| 1 | 2,838 | 14,192 | 5.0s |
| 10 | 17,956 | 89,820 | 5.0s |
| 100 | 62,585 | 313,000 | 5.0s |
| 1000 | 94,510 | 473,000 | 5.0s |

## acquire-job (2026-03-08)

- **Pollocks version**: 1.0.0
- **Runtime**: Bun 1.3.9
- **CPU**: Apple M1 Pro (10 cores)
- **Memory**: 16GB
- **OS**: Darwin 24.6.0 (arm64)

### Acquire Job Latency

| Table Size | Avg | Min | P50 | P99 | Max |
|------------|-----|-----|-----|-----|-----|
| 10,000 | 0.63ms | 0.45ms | 0.57ms | 1.44ms | 1.77ms |
| 100,000 | 0.64ms | 0.44ms | 0.57ms | 1.07ms | 1.56ms |
| 1,000,000 | 0.53ms | 0.43ms | 0.49ms | 0.96ms | 0.98ms |

