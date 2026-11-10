import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { AppSettings, Preference, TaskItem, Workload } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'kindling.sqlite');

let db: Database | null = null;

const DEFAULT_FOCUS_WINDOWS = [
  { days: [1, 2, 3, 4, 5], startTime: '19:30', endTime: '20:30', label: 'Weeknight Calm Slot' },
  { days: [0, 6], startTime: '10:00', endTime: '11:30', label: 'Weekend Morning Slot' },
];

const DEFAULT_BUSINESS_WINDOWS = [
  { days: [1, 2, 3, 4, 5], startTime: '12:15', endTime: '13:00', label: 'Weekday Midday Call/Errand Slot' },
  { days: [1, 2, 3, 4, 5], startTime: '16:00', endTime: '17:00', label: 'Weekday Late-Afternoon Office Slot' },
];

export function makeId(prefix = 'id'): string {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

export async function initDb(): Promise<Database> {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS preferences (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workloads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      raw_dump TEXT NOT NULL,
      domain TEXT NOT NULL,
      hard_deadline TEXT,
      deadline_confidence TEXT NOT NULL DEFAULT 'user_provided',
      verification_notes TEXT NOT NULL DEFAULT '',
      buffer_summary TEXT NOT NULL DEFAULT '',
      milestones_json TEXT NOT NULL DEFAULT '[]',
      project_overrides_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intake_rounds (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      workload_id TEXT,
      parent_task_id TEXT,
      depends_on_task_id TEXT,
      min_wait_days INTEGER NOT NULL DEFAULT 0,
      slot_type TEXT NOT NULL DEFAULT 'personal_focus',
      title TEXT NOT NULL,
      for_whom TEXT NOT NULL DEFAULT '',
      context_label TEXT NOT NULL DEFAULT '',
      scheduled_date TEXT NOT NULL,
      scheduled_time TEXT NOT NULL,
      latest_safe_date TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 15,
      rationale TEXT NOT NULL DEFAULT '',
      pivot_option_json TEXT,
      cutoff_warning INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  // Seed default settings if missing
  const existingCap = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['daily_cap_minutes']);
  if (!existingCap) {
    runSql('INSERT INTO settings (key, value) VALUES (?, ?)', ['daily_cap_minutes', '45']);
    runSql('INSERT INTO settings (key, value) VALUES (?, ?)', ['focus_windows_json', JSON.stringify(DEFAULT_FOCUS_WINDOWS)]);
    runSql('INSERT INTO settings (key, value) VALUES (?, ?)', ['business_windows_json', JSON.stringify(DEFAULT_BUSINESS_WINDOWS)]);
    runSql('INSERT INTO settings (key, value) VALUES (?, ?)', ['home_location_hint', '']);
    runSql('INSERT INTO settings (key, value) VALUES (?, ?)', ['gemini_api_key', '']);
  }

  // Seed gentle starter buffer rule if preferences table is completely empty
  const prefCount = queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM preferences');
  if (!prefCount || prefCount.cnt === 0) {
    const now = new Date().toISOString();
    runSql(
      'INSERT INTO preferences (id, category, key, value, updated_at) VALUES (?, ?, ?, ?, ?)',
      [makeId('pref'), 'buffer_rules', 'Pre-trip packing buffer', '2 full days before departure', now]
    );
    runSql(
      'INSERT INTO preferences (id, category, key, value, updated_at) VALUES (?, ?, ?, ?, ?)',
      [makeId('pref'), 'timing_habits', 'Max single task length', '25 minutes max per block', now]
    );
  }

  saveDb();
  return db;
}

export function saveDb(): void {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export function queryAll<T = Record<string, unknown>>(sql: string, params: (string | number | null)[] = []): T[] {
  if (!db) throw new Error('Database not initialized');
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

export function queryOne<T = Record<string, unknown>>(sql: string, params: (string | number | null)[] = []): T | null {
  const rows = queryAll<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export function runSql(sql: string, params: (string | number | null)[] = []): void {
  if (!db) throw new Error('Database not initialized');
  db.run(sql, params);
  saveDb();
}

export function getSettings(): AppSettings {
  const rows = queryAll<{ key: string; value: string }>('SELECT key, value FROM settings');
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const storedKey = map['gemini_api_key'] || '';
  const envKey = process.env.GEMINI_API_KEY || '';

  return {
    geminiApiKey: storedKey ? '••••••••' + storedKey.slice(-4) : '',
    hasEnvKey: Boolean(envKey || storedKey),
    dailyCapMinutes: Number(map['daily_cap_minutes'] || 45),
    focusWindows: map['focus_windows_json'] ? JSON.parse(map['focus_windows_json']) : DEFAULT_FOCUS_WINDOWS,
    businessWindows: map['business_windows_json'] ? JSON.parse(map['business_windows_json']) : DEFAULT_BUSINESS_WINDOWS,
    homeLocationHint: map['home_location_hint'] || '',
  };
}

export function getRawGeminiApiKey(): string {
  const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['gemini_api_key']);
  if (row && row.value && row.value.trim()) {
    return row.value.trim();
  }
  return (process.env.GEMINI_API_KEY || '').trim();
}

export function getAllPreferences(): Preference[] {
  const rows = queryAll<{
    id: string;
    category: Preference['category'];
    key: string;
    value: string;
    updated_at: string;
  }>('SELECT * FROM preferences ORDER BY category ASC, updated_at DESC');

  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    key: r.key,
    value: r.value,
    updatedAt: r.updated_at,
  }));
}

export function upsertPreference(category: Preference['category'], key: string, value: string): Preference {
  const existing = queryOne<{ id: string }>(
    'SELECT id FROM preferences WHERE LOWER(key) = LOWER(?)',
    [key.trim()]
  );
  const now = new Date().toISOString();
  if (existing) {
    runSql('UPDATE preferences SET category = ?, value = ?, updated_at = ? WHERE id = ?', [
      category,
      value.trim(),
      now,
      existing.id,
    ]);
    return { id: existing.id, category, key: key.trim(), value: value.trim(), updatedAt: now };
  }
  const id = makeId('pref');
  runSql('INSERT INTO preferences (id, category, key, value, updated_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    category,
    key.trim(),
    value.trim(),
    now,
  ]);
  return { id, category, key: key.trim(), value: value.trim(), updatedAt: now };
}

export function mapTaskRow(row: Record<string, unknown>): TaskItem {
  return {
    id: String(row.id),
    workloadId: row.workload_id ? String(row.workload_id) : null,
    workloadTitle: row.workload_title ? String(row.workload_title) : undefined,
    parentTaskId: row.parent_task_id ? String(row.parent_task_id) : null,
    dependsOnTaskId: row.depends_on_task_id ? String(row.depends_on_task_id) : null,
    minWaitDays: Number(row.min_wait_days || 0),
    slotType: (row.slot_type as TaskItem['slotType']) || 'personal_focus',
    title: String(row.title),
    forWhom: String(row.for_whom || ''),
    contextLabel: String(row.context_label || ''),
    scheduledDate: String(row.scheduled_date),
    scheduledTime: String(row.scheduled_time),
    latestSafeDate: row.latest_safe_date ? String(row.latest_safe_date) : null,
    durationMinutes: Number(row.duration_minutes || 15),
    rationale: String(row.rationale || ''),
    pivotOption: row.pivot_option_json ? JSON.parse(String(row.pivot_option_json)) : null,
    cutoffWarning: Boolean(row.cutoff_warning),
    status: (row.status as TaskItem['status']) || 'pending',
    notes: String(row.notes || ''),
    createdAt: String(row.created_at),
  };
}

export function getAllTasks(): TaskItem[] {
  const rows = queryAll<Record<string, unknown>>(`
    SELECT t.*, w.title as workload_title
    FROM tasks t
    LEFT JOIN workloads w ON t.workload_id = w.id
    ORDER BY t.scheduled_date ASC, t.scheduled_time ASC, t.created_at ASC
  `);
  return rows.map(mapTaskRow);
}

export function getAllWorkloads(): Workload[] {
  const rows = queryAll<Record<string, unknown>>('SELECT * FROM workloads ORDER BY created_at DESC');
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    rawDump: String(r.raw_dump),
    domain: r.domain as Workload['domain'],
    hardDeadline: r.hard_deadline ? String(r.hard_deadline) : null,
    deadlineConfidence: (r.deadline_confidence as Workload['deadlineConfidence']) || 'user_provided',
    verificationNotes: String(r.verification_notes || ''),
    bufferSummary: String(r.buffer_summary || ''),
    milestones: r.milestones_json ? JSON.parse(String(r.milestones_json)) : [],
    projectOverrides: r.project_overrides_json ? JSON.parse(String(r.project_overrides_json)) : {},
    status: (r.status as Workload['status']) || 'scheduled',
    createdAt: String(r.created_at),
  }));
}
