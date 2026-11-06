import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

interface PgDatabaseError {
  code?: string;
  constraint?: string;
  detail?: string;
}

function extractPgError(err: unknown): PgDatabaseError | null {
  if (!err || typeof err !== 'object') {
    return null;
  }
  const record = err as Record<string, unknown>;
  if (typeof record.code === 'string') {
    return {
      code: record.code,
      constraint:
        typeof record.constraint === 'string' ? record.constraint : undefined,
    };
  }
  if (record.cause && typeof record.cause === 'object') {
    const cause = record.cause as Record<string, unknown>;
    if (typeof cause.code === 'string') {
      return {
        code: cause.code,
        constraint:
          typeof cause.constraint === 'string' ? cause.constraint : undefined,
      };
    }
  }
  return null;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      });
    }

    if (error instanceof ZodError) {
      const firstIssue = error.issues[0];
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: firstIssue?.message ?? 'Invalid request payload.',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const pgErr = extractPgError(error);
    if (pgErr?.code === '23P01') {
      return reply.status(409).send({
        code: 'SLOT_CONFLICT',
        message:
          'This time slot was just taken or conflicts with another session in your schedule.',
      });
    }

    if (pgErr?.code === '23505') {
      return reply.status(409).send({
        code: 'CONFLICT',
        message: 'A record with this value already exists.',
      });
    }

    if (pgErr?.code === '22P02') {
      return reply.status(400).send({
        code: 'INVALID_IDENTIFIER',
        message: 'Invalid identifier format.',
      });
    }

    const statusCode =
      'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;

    if (statusCode >= 500) {
      app.log.error({ errMessage: error.message }, 'Unhandled server error');
    }

    return reply.status(statusCode).send({
      code: statusCode === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
      message:
        statusCode === 400
          ? error.message
          : 'An unexpected server error occurred.',
    });
  });
}
