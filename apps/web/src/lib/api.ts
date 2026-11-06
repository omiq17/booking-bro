import type {
  AllowedBufferMinutes,
  AvailabilityWindowInput,
  CreateSessionInput,
  LoginInput,
  NotificationKind,
  SessionStatus,
  SignupInput,
  UpdateAvailabilityInput,
  UserRole,
} from '@booking-bro/shared';

export interface AuthUserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  timezone: string;
}

export interface ProfessionalSummaryDto {
  id: string;
  name: string;
  timezone: string;
  specialty: string;
  bio: string;
  bufferMinutes: AllowedBufferMinutes;
}

export interface ProfessionalDetailDto extends ProfessionalSummaryDto {
  windows: AvailabilityWindowInput[];
}

export interface SlotDto {
  startAt: string;
  endAt: string;
}

export interface ProfessionalSlotsResponseDto {
  professional: ProfessionalSummaryDto;
  slots: SlotDto[];
}

export interface EnrichedSessionDto {
  id: string;
  memberId: string;
  professionalId: string;
  startAt: string;
  endAt: string;
  blockedUntil: string;
  bufferMinutes: AllowedBufferMinutes;
  status: SessionStatus;
  rescheduledFromId: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  createdAt: string;
  updatedAt: string;
  memberName: string;
  memberTimezone: string;
  professionalName: string;
  professionalTimezone: string;
  professionalSpecialty: string;
  canModify: boolean;
}

export interface SessionsListResponseDto {
  upcoming: EnrichedSessionDto[];
  pastOrInactive: EnrichedSessionDto[];
}

export interface AvailabilityMeResponseDto {
  timezone: string;
  specialty: string;
  bio: string;
  bufferMinutes: AllowedBufferMinutes;
  windows: Array<AvailabilityWindowInput & { id: string }>;
}

export interface NotificationItemDto {
  id: string;
  sessionId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResponseDto {
  unreadCount: number;
  notifications: NotificationItemDto[];
}

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson
    ? ((await response.json()) as Record<string, unknown>)
    : null;

  if (!response.ok) {
    const code =
      typeof payload?.code === 'string' ? payload.code : 'REQUEST_FAILED';
    const message =
      typeof payload?.message === 'string'
        ? payload.message
        : `Request failed with status ${response.status}`;
    const details =
      payload?.details && typeof payload.details === 'object'
        ? (payload.details as Record<string, unknown>)
        : undefined;

    throw new ApiError(response.status, code, message, details);
  }

  return payload as T;
}

export const api = {
  auth: {
    async me(): Promise<AuthUserDto | null> {
      try {
        const res = await apiFetch<{ user: AuthUserDto }>('/api/auth/me');
        return res.user;
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 401) {
          return null;
        }
        throw err;
      }
    },
    async login(input: LoginInput): Promise<{ user: AuthUserDto }> {
      return apiFetch<{ user: AuthUserDto }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    async signup(input: SignupInput): Promise<{ user: AuthUserDto }> {
      return apiFetch<{ user: AuthUserDto }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    async logout(): Promise<{ ok: boolean }> {
      return apiFetch<{ ok: boolean }>('/api/auth/logout', {
        method: 'POST',
      });
    },
    async updateTimezone(timezone: string): Promise<{ user: AuthUserDto }> {
      return apiFetch<{ user: AuthUserDto }>('/api/users/me/timezone', {
        method: 'PATCH',
        body: JSON.stringify({ timezone }),
      });
    },
  },
  professionals: {
    async list(): Promise<{ professionals: ProfessionalSummaryDto[] }> {
      return apiFetch<{ professionals: ProfessionalSummaryDto[] }>(
        '/api/professionals',
      );
    },
    async get(id: string): Promise<{ professional: ProfessionalDetailDto }> {
      return apiFetch<{ professional: ProfessionalDetailDto }>(
        `/api/professionals/${encodeURIComponent(id)}`,
      );
    },
    async slots(
      id: string,
      options?: { from?: string; excludeSessionId?: string },
    ): Promise<ProfessionalSlotsResponseDto> {
      const params = new URLSearchParams();
      if (options?.from) {
        params.set('from', options.from);
      }
      if (options?.excludeSessionId) {
        params.set('excludeSessionId', options.excludeSessionId);
      }
      const qs = params.toString();
      const url = `/api/professionals/${encodeURIComponent(id)}/slots${qs ? `?${qs}` : ''}`;
      return apiFetch<ProfessionalSlotsResponseDto>(url);
    },
  },
  sessions: {
    async list(): Promise<SessionsListResponseDto> {
      return apiFetch<SessionsListResponseDto>('/api/sessions');
    },
    async create(
      input: CreateSessionInput,
    ): Promise<{ session: EnrichedSessionDto }> {
      return apiFetch<{ session: EnrichedSessionDto }>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    async cancel(id: string): Promise<{ session: EnrichedSessionDto }> {
      return apiFetch<{ session: EnrichedSessionDto }>(
        `/api/sessions/${encodeURIComponent(id)}/cancel`,
        {
          method: 'POST',
        },
      );
    },
    async reschedule(
      id: string,
      newStartAt: string,
    ): Promise<{
      previousSession: EnrichedSessionDto;
      session: EnrichedSessionDto;
    }> {
      return apiFetch<{
        previousSession: EnrichedSessionDto;
        session: EnrichedSessionDto;
      }>(`/api/sessions/${encodeURIComponent(id)}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({ newStartAt }),
      });
    },
  },
  availability: {
    async getMe(): Promise<AvailabilityMeResponseDto> {
      return apiFetch<AvailabilityMeResponseDto>('/api/availability/me');
    },
    async update(input: UpdateAvailabilityInput): Promise<{
      timezone: string;
      bufferMinutes: AllowedBufferMinutes;
      windows: Array<AvailabilityWindowInput & { id: string }>;
    }> {
      return apiFetch('/api/availability', {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
  },
  notifications: {
    async list(): Promise<NotificationsResponseDto> {
      return apiFetch<NotificationsResponseDto>('/api/notifications');
    },
    async markRead(
      id: string,
    ): Promise<{ notification: { id: string; readAt: string | null } }> {
      return apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, {
        method: 'POST',
      });
    },
    async markAllRead(): Promise<{ ok: boolean; updatedCount: number }> {
      return apiFetch('/api/notifications/read-all', {
        method: 'POST',
      });
    },
  },
};
