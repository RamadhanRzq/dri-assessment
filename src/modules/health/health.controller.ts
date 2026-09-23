import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DatabaseService } from '../../shared/database/database.service.js';
import { ErrorResponseDto } from '../../shared/errors/error-response.dto.js';

class HealthDto {
  @ApiProperty({ example: 'ok' })
  status: string;

  @ApiProperty({ example: 12.34, description: 'Process uptime in seconds.' })
  uptime: number;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z', format: 'date-time' })
  timestamp: string;

  @ApiProperty({ example: 'up', enum: ['up'] })
  database: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Liveness plus database reachability. A lost database is reported as 503 so
   * an orchestrator stops routing traffic here instead of serving 500s.
   */
  @Get()
  @ApiOperation({ summary: 'Liveness and database reachability' })
  @ApiOkResponse({ type: HealthDto })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'The database is unreachable.',
  })
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
