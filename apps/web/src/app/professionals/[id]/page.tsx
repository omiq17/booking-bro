'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Globe,
  Info,
  Stethoscope,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { CalendarPicker } from '@/components/CalendarPicker';
import { ConfirmModal } from '@/components/ConfirmModal';
import { ApiError, api, type SlotDto } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { WEEKDAY_LABELS } from '@/lib/time';

export default function ProfessionalDetailPage() {
  const params = useParams<{ id: string }>();
  const professionalId = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();

  const [selectedSlot, setSelectedSlot] = useState<SlotDto | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const { data: user, isLoading: isAuthLoading } = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.auth.me(),
  });

  const { data: proDetailData, isLoading: isProLoading } = useQuery({
    queryKey: queryKeys.professional(professionalId),
    queryFn: () => api.professionals.get(professionalId),
    enabled: Boolean(user && professionalId),
  });

  const {
    data: slotsData,
    isLoading: isSlotsLoading,
    refetch: refetchSlots,
  } = useQuery({
    queryKey: queryKeys.slots(professionalId),
    queryFn: () => api.professionals.slots(professionalId),
    enabled: Boolean(user && professionalId),
  });

  const createSessionMutation = useMutation({
    mutationFn: (slot: SlotDto) =>
      api.sessions.create({
        professionalId,
        startAt: slot.startAt,
      }),
    onSuccess: () => {
      setModalOpen(false);
      setSelectedSlot(null);
      setBookingError(null);
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      router.push('/sessions?booked=1');
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setBookingError(err.message);
        if (err.statusCode === 409) {
          void refetchSlots();
        }
      } else {
        setBookingError('Could not complete booking. Please try another slot.');
      }
    },
  });

  if (isAuthLoading) {
    return (
      <div className="space-y-6 py-4">
        <div className="h-36 animate-pulse rounded-2xl bg-white" />
        <div className="h-96 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-stone-200 bg-white p-8 text-center">
        <h1 className="font-bold text-xl text-stone-900">
          Please Log In to Book a Session
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Sign in as a member to view available 50-minute slots in your
          timezone.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex min-h-[44px] items-center rounded-xl bg-emerald-800 px-5 py-2.5 font-semibold text-sm text-white hover:bg-emerald-900"
        >
          Go to Login
        </Link>
      </div>
    );
  }

  const pro = proDetailData?.professional ?? slotsData?.professional;
  const slots = slotsData?.slots ?? [];
  const windows = proDetailData?.professional.windows ?? [];

  function handleSlotClick(slot: SlotDto) {
    setSelectedSlot(slot);
    setBookingError(null);
    if (user?.role === 'member') {
      setModalOpen(true);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/professionals"
          className="inline-flex items-center gap-1.5 font-medium text-emerald-800 text-sm hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Professionals Directory
        </Link>
      </div>

      {isProLoading && !pro ? (
        <div className="h-40 animate-pulse rounded-2xl border border-stone-200 bg-white p-6" />
      ) : pro ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xs">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-0.5 font-semibold text-emerald-800 text-xs">
                <Stethoscope className="h-3.5 w-3.5" />
                {pro.specialty}
              </div>
              <h1 className="font-bold text-2xl text-stone-900 tracking-tight sm:text-3xl">
                {pro.name}
              </h1>
              <p className="max-w-2xl text-sm text-stone-600 leading-relaxed">
                {pro.bio}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 md:flex-col md:items-end">
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-stone-50 px-3 py-1.5 font-medium text-stone-700 text-xs">
                <Globe className="h-3.5 w-3.5 text-emerald-800" />
                Pro Timezone: <strong>{pro.timezone}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-stone-50 px-3 py-1.5 font-medium text-stone-700 text-xs">
                <Clock className="h-3.5 w-3.5 text-emerald-800" />
                50m Session · {pro.bufferMinutes}m Buffer
              </span>
            </div>
          </div>

          {windows.length > 0 && (
            <div className="mt-5 border-stone-100 border-t pt-4">
              <p className="mb-2 font-semibold text-stone-700 text-xs uppercase tracking-wider">
                Weekly Working Hours (in {pro.timezone})
              </p>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_LABELS.map((day) => {
                  const dayWins = windows.filter(
                    (w) => w.weekday === day.weekday,
                  );
                  if (dayWins.length === 0) {
                    return null;
                  }
                  return (
                    <span
                      key={day.weekday}
                      className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-stone-700 text-xs"
                    >
                      <strong>{day.short}:</strong>{' '}
                      {dayWins
                        .map((w) => `${w.startTime}–${w.endTime}`)
                        .join(', ')}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {user.role === 'professional' && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" />
          <p>
            You are viewing this calendar in <strong>Professional</strong> mode.
            Only accounts with the <strong>Member</strong> role can book
            sessions.
          </p>
        </div>
      )}

      <section aria-label="Available booking slots">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-800" />
            <h2 className="font-bold text-lg text-stone-900">
              Available 50-Minute Sessions
            </h2>
          </div>
          <p className="text-stone-600 text-xs">
            Slots overlapping your own existing bookings or starting within 2
            hours are automatically filtered out.
          </p>
        </div>

        <CalendarPicker
          slots={slots}
          viewerTimezone={user.timezone}
          professionalTimezone={pro?.timezone ?? 'UTC'}
          selectedSlot={selectedSlot}
          onSelectSlot={handleSlotClick}
          isLoading={isSlotsLoading}
        />
      </section>

      {pro && (
        <ConfirmModal
          open={modalOpen}
          professional={pro}
          slot={selectedSlot}
          viewerTimezone={user.timezone}
          isSubmitting={createSessionMutation.isPending}
          errorMessage={bookingError}
          onClose={() => {
            if (!createSessionMutation.isPending) {
              setModalOpen(false);
              setBookingError(null);
            }
          }}
          onConfirm={() => {
            if (selectedSlot) {
              createSessionMutation.mutate(selectedSlot);
            }
          }}
        />
      )}
    </div>
  );
}
