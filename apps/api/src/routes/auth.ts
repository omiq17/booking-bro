import {
  AUTH_SESSION_DAYS,
  DEFAULT_BUFFER_MINUTES,
  loginSchema,
  signupSchema,
  updateTimezoneSchema,
} from '@booking-bro/shared';
import argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  authSessions,
  availabilityWindows,
  professionalProfiles,
  users,
} from '../db/schema.js';
import {
  clearSessionCookie,
  generateSessionToken,
  hashSessionToken,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from '../plugins/auth.js';
import { AppError } from '../plugins/error.js';

const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5] as const;
const DEFAULT_DAILY_WINDOWS = [
  { startTime: '09:00', endTime: '12:00' },
  { startTime: '13:00', endTime: '17:00' },
] as const;

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/signup', async (request, reply) => {
    const input = signupSchema.parse(request.body);
    const normalizedEmail = input.email.toLowerCase();

    const existing = await app.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1);

    if (existing.length > 0) {
      throw new AppError(
        409,
        'EMAIL_TAKEN',
        'An account with this email address already exists.',
      );
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });

    const now = app.getNow();
    const nowDate = now.toJSDate();
    const expiresAt = now.plus({ days: AUTH_SESSION_DAYS }).toJSDate();
    const { rawToken, idHash } = generateSessionToken();

    const createdUser = await app.db.transaction(async (tx) => {
      const insertedUsers = await tx
        .insert(users)
        .values({
          email: normalizedEmail,
          passwordHash,
          name: input.name,
          role: input.role,
          timezone: input.timezone,
          createdAt: nowDate,
          updatedAt: nowDate,
        })
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          timezone: users.timezone,
        });

      const newUser = insertedUsers[0];
      if (!newUser) {
        throw new AppError(500, 'USER_CREATE_FAILED', 'Failed to create user.');
      }

      if (input.role === 'professional') {
        await tx.insert(professionalProfiles).values({
          userId: newUser.id,
          specialty: input.specialty ?? 'Counsellor & Wellbeing Coach',
          bio:
            input.bio ??
            'Supporting members with structured, evidence-based sessions.',
          bufferMinutes: DEFAULT_BUFFER_MINUTES,
          updatedAt: nowDate,
        });

        const defaultWindows = DEFAULT_WEEKDAYS.flatMap((weekday) =>
          DEFAULT_DAILY_WINDOWS.map((win) => ({
            professionalId: newUser.id,
            weekday,
            startTime: win.startTime,
            endTime: win.endTime,
            createdAt: nowDate,
          })),
        );

        await tx.insert(availabilityWindows).values(defaultWindows);
      }

      await tx.insert(authSessions).values({
        idHash,
        userId: newUser.id,
        expiresAt,
        createdAt: nowDate,
      });

      return newUser;
    });

    setSessionCookie(reply, rawToken);
    return reply.status(201).send({ user: createdUser });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const normalizedEmail = input.email.toLowerCase();

    const found = await app.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1);

    const user = found[0];
    if (!user) {
      throw new AppError(
        401,
        'INVALID_CREDENTIALS',
        'Invalid email or password.',
      );
    }

    const validPassword = await argon2.verify(
      user.passwordHash,
      input.password,
    );
    if (!validPassword) {
      throw new AppError(
        401,
        'INVALID_CREDENTIALS',
        'Invalid email or password.',
      );
    }

    const now = app.getNow();
    const nowDate = now.toJSDate();
    const expiresAt = now.plus({ days: AUTH_SESSION_DAYS }).toJSDate();
    const { rawToken, idHash } = generateSessionToken();

    await app.db.insert(authSessions).values({
      idHash,
      userId: user.id,
      expiresAt,
      createdAt: nowDate,
    });

    setSessionCookie(reply, rawToken);
    return reply.status(200).send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        timezone: user.timezone,
      },
    });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const rawToken = request.cookies[SESSION_COOKIE_NAME];
    if (rawToken && typeof rawToken === 'string') {
      const idHash = hashSessionToken(rawToken);
      await app.db
        .delete(authSessions)
        .where(eq(authSessions.idHash, idHash));
    }
    clearSessionCookie(reply);
    return reply.status(200).send({ ok: true });
  });

  app.get(
    '/api/auth/me',
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      return reply.status(200).send({ user: request.user! });
    },
  );

  app.patch(
    '/api/users/me/timezone',
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const input = updateTimezoneSchema.parse(request.body);
      const currentUser = request.user!;
      const nowDate = app.getNow().toJSDate();

      const updatedRows = await app.db
        .update(users)
        .set({
          timezone: input.timezone,
          updatedAt: nowDate,
        })
        .where(eq(users.id, currentUser.id))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          timezone: users.timezone,
        });

      const updated = updatedRows[0];
      if (!updated) {
        throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
      }

      return reply.status(200).send({ user: updated });
    },
  );
}
