import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Navbar } from '@/components/Navbar';
import { QueryProvider } from '@/lib/query-client';
import './globals.css';

export const metadata: Metadata = {
  title: 'BookingBro — Calm, Timezone-Aware Session Booking & Reminders',
  description:
    'Book 50-minute wellbeing and counselling sessions across timezones with automatic 24h and 1h reminders.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased selection:bg-emerald-800 selection:text-white">
        <QueryProvider>
          <div className="flex min-h-screen flex-col">
            <Navbar />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
              {children}
            </main>
            <footer className="border-stone-200 border-t bg-white py-5">
              <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 text-stone-600 text-xs sm:flex-row sm:px-6">
                <p className="font-medium text-stone-700">
                  BookingBro · 50-Minute Wellbeing & Counselling Sessions
                </p>
                <p>
                  Automatic timezone conversion · Displayed in your local
                  time · 24h & 1h in-app reminders
                </p>
              </div>
            </footer>
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
