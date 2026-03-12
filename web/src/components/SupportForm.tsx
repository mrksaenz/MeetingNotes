'use client';

import { useState } from 'react';

type SupportType = 'bug' | 'feature' | 'question' | 'lead' | 'other';

interface SupportFormProps {
  appName: string;
  defaultType?: SupportType;
  showTypeSelector?: boolean;
  apiUrl?: string;
  onSuccess?: () => void;
}

const supportTypes: { value: SupportType; label: string; description: string }[] = [
  { value: 'bug', label: 'Bug Report', description: 'Something isn\'t working correctly' },
  { value: 'feature', label: 'Feature Request', description: 'Suggest an improvement or new feature' },
  { value: 'question', label: 'Question', description: 'General question or help needed' },
  { value: 'lead', label: 'Get in Touch', description: 'I\'m interested in learning more' },
  { value: 'other', label: 'Other', description: 'Something else' },
];

export default function SupportForm({
  appName,
  defaultType = 'question',
  showTypeSelector = true,
  apiUrl = 'https://aspire-tech-ops-hub.vercel.app/api/support',
  onSuccess,
}: SupportFormProps) {
  const [type, setType] = useState<SupportType>(defaultType);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName,
          type,
          name,
          email,
          subject,
          message,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Request failed (${res.status})`);
      }

      setSubmitted(true);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-border bg-background p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-emerald/10">
          <svg className="h-6 w-6 text-accent-emerald" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-foreground">Message Sent</h3>
        <p className="mt-2 text-sm text-muted">
          Thanks for reaching out! We&apos;ll get back to you as soon as possible.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-accent-rose/10 px-4 py-3 text-sm text-accent-rose">
          {error}
        </div>
      )}

      {showTypeSelector && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            What can we help with?
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {supportTypes.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  type === t.value
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-border bg-background text-foreground hover:bg-surface'
                }`}
              >
                <span className="font-medium">{t.label}</span>
                <span className="mt-0.5 block text-xs text-muted">{t.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="support-name" className="block text-sm font-medium text-foreground">
            Name
          </label>
          <input
            id="support-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder-muted focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none"
            placeholder="Your name"
          />
        </div>
        <div>
          <label htmlFor="support-email" className="block text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="support-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder-muted focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none"
            placeholder="you@example.com"
          />
        </div>
      </div>

      <div>
        <label htmlFor="support-subject" className="block text-sm font-medium text-foreground">
          Subject
        </label>
        <input
          id="support-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
          className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder-muted focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none"
          placeholder="Brief description"
        />
      </div>

      <div>
        <label htmlFor="support-message" className="block text-sm font-medium text-foreground">
          Message
        </label>
        <textarea
          id="support-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          rows={5}
          className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder-muted focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none resize-none"
          placeholder={type === 'bug' ? 'Describe the issue and steps to reproduce...' : type === 'feature' ? 'Describe the feature you\'d like to see...' : 'How can we help?'}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus:ring-2 focus:ring-primary-500/20 focus:outline-none disabled:opacity-50"
      >
        {loading ? 'Sending...' : type === 'lead' ? 'Get in Touch' : 'Send Message'}
      </button>
    </form>
  );
}
