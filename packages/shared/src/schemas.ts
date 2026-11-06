import { DateTime } from 'luxon';
import { z } from 'zod';
import { ALLOWED_BUFFERS } from './constants.js';
import { isTenMinuteAlignedTime, isValidIanaTimezone } from './rules.js';

export const ianaTimezoneSchema = z
  .string()
  .trim()
  .min(1, 'Timezone is required')
  .refine(isValidIanaTimezone, {
    message: 'Invalid IANA timezone identifier',
  });

export const isoUtcTimestampSchema = z
  .string()
  .trim()
  .refine(
    (val) => {
      const dt = DateTime.fromISO(val, { zone: 'utc' });
      return dt.isValid;
    },
    { message: 'Invalid ISO-8601 timestamp' },
  );

export const tenMinuteTimeSchema = z
  .string()
  .trim()
  .refine(isTenMinuteAlignedTime, {
    message:
      'Time must be in HH:mm 24-hour format aligned to 10-minute increments (:00, :10, :20, :30, :40, :50)',
  });

export const userRoleSchema = z.enum(['member', 'professional']);

export const allowedBufferSchema = z.union([
  z.literal(ALLOWED_BUFFERS[0]),
  z.literal(ALLOWED_BUFFERS[1]),
  z.literal(ALLOWED_BUFFERS[2]),
]);

export const signupSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z
    .string()
    .trim()
    .email('Invalid email address')
    .transform((val) => val.toLowerCase()),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  role: userRoleSchema,
  timezone: ianaTimezoneSchema,
  specialty: z.string().trim().min(2).max(120).optional(),
  bio: z.string().trim().max(500).optional(),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Invalid email address')
    .transform((val) => val.toLowerCase()),
  password: z.string().min(1, 'Password is required'),
});

export const updateTimezoneSchema = z.object({
  timezone: ianaTimezoneSchema,
});

export const availabilityWindowInputSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  startTime: tenMinuteTimeSchema,
  endTime: tenMinuteTimeSchema,
});

export const updateAvailabilitySchema = z.object({
  bufferMinutes: allowedBufferSchema,
  windows: z
    .array(availabilityWindowInputSchema)
    .min(1, 'At least one availability window is required')
    .max(21, 'At most 21 availability windows allowed across 7 weekdays'),
});

export const getProfessionalSlotsQuerySchema = z.object({
  from: isoUtcTimestampSchema.optional(),
  excludeSessionId: z.string().uuid().optional(),
});

export const createSessionSchema = z.object({
  professionalId: z.string().uuid('Invalid professional ID'),
  startAt: isoUtcTimestampSchema,
});

export const rescheduleSessionSchema = z.object({
  newStartAt: isoUtcTimestampSchema,
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateTimezoneInput = z.infer<typeof updateTimezoneSchema>;
export type AvailabilityWindowInput = z.infer<
  typeof availabilityWindowInputSchema
>;
export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;
export type GetProfessionalSlotsQuery = z.infer<
  typeof getProfessionalSlotsQuerySchema
>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type RescheduleSessionInput = z.infer<typeof rescheduleSessionSchema>;
