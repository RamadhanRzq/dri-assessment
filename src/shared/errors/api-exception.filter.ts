import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'bad_request',
  [HttpStatus.NOT_FOUND]: 'not_found',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'unprocessable_entity',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'service_unavailable',
};

// Postgres SQLSTATE codes mapped to the HTTP status they actually mean for a
// client. Anything unmapped is a server-side defect and stays a 500.
const STATUS_BY_SQLSTATE: Record<string, number> = {
  '23505': HttpStatus.CONFLICT, // unique_violation
  '23503': HttpStatus.UNPROCESSABLE_ENTITY, // foreign_key_violation
  '23502': HttpStatus.BAD_REQUEST, // not_null_violation
  '23514': HttpStatus.BAD_REQUEST, // check_violation
  '22P02': HttpStatus.BAD_REQUEST, // invalid_text_representation
  '22003': HttpStatus.BAD_REQUEST, // numeric_value_out_of_range
};

/**
 * Renders every failure as `{ error: { code, message, details? } }` so clients
 * never have to branch on two response shapes.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toErrorBody(exception);

    if (body.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${body.code}: ${body.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(body.status).json(body.payload);
  }

  private toErrorBody(exception: unknown): {
    status: number;
    code: string;
    message: string;
    payload: ErrorBody;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const { message, details } = this.splitHttpResponse(raw, exception.message);
      const code = CODE_BY_STATUS[status] ?? 'http_error';
      return {
        status,
        code,
        message,
        payload: details ? { error: { code, message, details } } : { error: { code, message } },
      };
    }

    const sqlState = (exception as { code?: string } | null)?.code;
    const mapped = sqlState ? STATUS_BY_SQLSTATE[sqlState] : undefined;
    if (mapped) {
      const code = CODE_BY_STATUS[mapped] ?? 'database_error';
      const message = sqlState === '23505' ? 'Resource already exists' : 'Request violates a database constraint';
      return { status: mapped, code, message, payload: { error: { code, message } } };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
      message: 'Internal server error',
      payload: { error: { code: 'internal_error', message: 'Internal server error' } },
    };
  }

  private splitHttpResponse(
    raw: string | object,
    fallback: string,
  ): { message: string; details?: unknown } {
    if (typeof raw === 'string') return { message: raw };

    const { message } = raw as { message?: unknown };
    if (Array.isArray(message)) {
      return { message: 'Validation failed', details: message };
    }
    if (typeof message === 'string') return { message };

    return { message: fallback };
  }
}
