import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

// int8 (OID 20) arrives as a string by default to avoid precision loss.
// Every int8 column here is an id or an IDR price, far below 2^53.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

// numeric (OID 1700) backs the dynamic attribute value column. Its values are
// engine capacities, seat counts, and similar small numbers, so the same
// reasoning applies: parse to a number rather than shipping a string in an
// otherwise numeric JSON field.
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value));

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.get<string>('DATABASE_URL'),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    // A pool error must not take the process down: a lost idle connection is
    // recoverable, and health/readiness reports the outage instead.
    this.pool.on('error', (error) => {
      this.logger.error(`Idle client error: ${error.message}`);
    });
  }

  onModuleInit(): void {
    void this.ping().then((ok) =>
      ok
        ? this.logger.log('Database connection pool ready')
        : this.logger.warn('Database unreachable at startup'),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async query<T extends QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(text, params as unknown[]);
    return result.rows;
  }

  async withTransaction<T>(
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.warn(`Database ping failed: ${(error as Error).message}`);
      return false;
    }
  }
}
