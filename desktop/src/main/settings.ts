import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import type { AppSettings } from '@shared/types';

/**
 * Settings live in the app's userData folder (NOT the meeting library), so
 * API keys never end up inside the synced Google Drive folder. Keys are
 * encrypted with safeStorage, which is backed by the macOS Keychain.
 */

interface StoredSettings {
  libraryPath: string | null;
  assemblyAiKey: string | null; // base64 of encrypted bytes (or plain if encryption unavailable)
  anthropicKey: string | null;
  encrypted: boolean;
}

const DEFAULTS: StoredSettings = {
  libraryPath: null,
  assemblyAiKey: null,
  anthropicKey: null,
  encrypted: false,
};

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

let cache: StoredSettings | null = null;

async function load(): Promise<StoredSettings> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(settingsFile(), 'utf-8');
    cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache!;
}

async function persist(settings: StoredSettings): Promise<void> {
  cache = settings;
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2), 'utf-8');
}

function encrypt(value: string): { stored: string; encrypted: boolean } {
  if (safeStorage.isEncryptionAvailable()) {
    return { stored: safeStorage.encryptString(value).toString('base64'), encrypted: true };
  }
  return { stored: Buffer.from(value, 'utf-8').toString('base64'), encrypted: false };
}

function decrypt(stored: string, encrypted: boolean): string {
  const buf = Buffer.from(stored, 'base64');
  if (encrypted) return safeStorage.decryptString(buf);
  return buf.toString('utf-8');
}

export async function getSettings(): Promise<AppSettings> {
  const s = await load();
  return {
    libraryPath: s.libraryPath,
    hasAssemblyAiKey: !!s.assemblyAiKey,
    hasAnthropicKey: !!s.anthropicKey,
  };
}

export async function saveSettings(update: {
  libraryPath?: string;
  assemblyAiKey?: string;
  anthropicKey?: string;
}): Promise<AppSettings> {
  const s = await load();
  if (update.libraryPath !== undefined) s.libraryPath = update.libraryPath;
  if (update.assemblyAiKey !== undefined && update.assemblyAiKey.trim()) {
    const { stored, encrypted } = encrypt(update.assemblyAiKey.trim());
    s.assemblyAiKey = stored;
    s.encrypted = encrypted;
  }
  if (update.anthropicKey !== undefined && update.anthropicKey.trim()) {
    const { stored, encrypted } = encrypt(update.anthropicKey.trim());
    s.anthropicKey = stored;
    s.encrypted = encrypted;
  }
  await persist(s);
  return getSettings();
}

export async function getLibraryPath(): Promise<string> {
  const s = await load();
  if (!s.libraryPath) throw new Error('No library folder selected yet');
  return s.libraryPath;
}

export async function getApiKeys(): Promise<{ assemblyAiKey: string | null; anthropicKey: string | null }> {
  const s = await load();
  return {
    assemblyAiKey: s.assemblyAiKey ? decrypt(s.assemblyAiKey, s.encrypted) : null,
    anthropicKey: s.anthropicKey ? decrypt(s.anthropicKey, s.encrypted) : null,
  };
}
