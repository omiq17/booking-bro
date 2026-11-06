import { createHash, randomBytes } from 'node:crypto';
import { AUTH_SESSION_DAYS, type UserRole } from '@booking-bro/shared';
import { eq } from 'drizzle-orm';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { authSessions, users } from '../db/schema.js';
import { AppError } from './error.js';

export const SESSION_COOKIE_NAME = 'sid';
export const SESSION_MAX_AGE_SECONDS = AUTH_SESSION_DAYS * 24 * 60 * 60;

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  timezone: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    sessionIdHash?: string;
  }
}

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function generateSessionToken(): {
  rawToken: string;
  idHash: string;
} {
  const rawToken = randomBytes(32).toString('hex');
  return {
    rawToken,
    idHash: hashSessionToken(rawToken),
  };
}

export function setSessionCookie(reply: FastifyReply, rawToken: string): void {
  reply.setCookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  });
}

export function createRequireAuth(app: FastifyInstance): preHandlerHookHandler {
  return async function requireAuth(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const rawToken = request.cookies[SESSION_COOKIE_NAME];
    if (!rawToken || typeof rawToken !== 'string') {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
    }

    const idHash = hashSessionToken(rawToken);

    const rows = await app.db
      .select({
        sessionIdHash: authSessions.idHash,
        expiresAt: authSessions.expiresAt,
        userId: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        timezone: users.timezone,
      })
      .from(authSessions)
      .innerJoin(users, eq(authSessions.userId, users.id))
      .where(eq(authSessions.idHash, idHash))
      .limit(1);

    const row = rows[0];
    if (!row) {
      clearSessionCookie(reply);
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired session.');
    }

    const nowMillis = app.getNow().toMillis();
    if (row.expiresAt.getTime() <= nowMillis) {
      await app.db
        .delete(authSessions)
        .where(eq(authSessions.idHash, idHash));
      clearSessionCookie(reply);
      throw new AppError(
        401,
        'SESSION_EXPIRED',
        'Your session has expired. Please log in again.',
      );
    }

    request.user = {
      id: row.userId,
      email: row.email,
      name: row.name,
      role: row.role,
      timezone: row.timezone,
    };
    request.sessionIdHash = idHash;
  };
}

export function requireRole(role: UserRole): preHandlerHookHandler {
  return async function checkRole(request: FastifyRequest): Promise<void> {
    if (!request.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
    }
    if (request.user.role !== role) {
      throw new AppError(
        403,
        'FORBIDDEN',
        `This action requires the '${role}' role.`,
      );
    }
  };
}
