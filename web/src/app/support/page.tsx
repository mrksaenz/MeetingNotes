'use client';

import SupportForm from '@/components/SupportForm';
import Link from 'next/link';

export default function SupportPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-600">
            <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Support</h1>
          <p className="mt-1 text-sm text-muted">Have a question or need help? We&apos;re here for you.</p>
        </div>

        <div className="rounded-xl border border-border bg-background p-6">
          <SupportForm appName="MeetingNotes" />
        </div>

        <div className="mt-6 text-center text-sm">
          <Link href="/dashboard" className="text-muted hover:text-foreground transition-colors">
            &larr; Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
