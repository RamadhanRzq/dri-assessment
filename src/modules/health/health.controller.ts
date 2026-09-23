import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Liveness plus database reachability. A lost database is reported as 503 so
   * an orchestrator stops routing traffic here instead of serving 500s.
   */
  @Get()
  async check() {
    const databaseUp = await this.db.ping();

    if (!databaseUp) {
      throw new ServiceUnavailableException('Database is unreachable');
    }

    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: 'up',
    };
  }
}
