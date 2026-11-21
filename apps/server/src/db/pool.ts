import pg, { type Pool, type PoolConfig } from "pg";

export function createPool(config: PoolConfig): Pool {
  return new pg.Pool(config);
}

