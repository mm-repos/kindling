import {
  AppSettings,
  DetectedPreference,
  GameplanProposal,
  IntakeQuestionCard,
  Preference,
  PreferenceCategory,
  SlotType,
  TaskItem,
  Workload,
  WorkloadDomain,
} from './types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  getSettings: () => request<AppSettings>('/api/settings'),
  updateSettings: (payload: Partial<AppSettings>) =>
    request<AppSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getPreferences: () => request<Preference[]>('/api/preferences'),
  savePreference: (category: PreferenceCategory, key: string, value: string) =>
    request<Preference>('/api/preferences', {
      method: 'POST',
      body: JSON.stringify({ category, key, value }),
    }),
  deletePreference: (id: string) =>
    request<{ deleted: boolean }>(`/api/preferences/${id}`, { method: 'DELETE' }),

  getWorkloads: () => request<Workload[]>('/api/workloads'),
  deleteWorkload: (id: string) =>
    request<{ deleted: boolean }>(`/api/workloads/${id}`, { method: 'DELETE' }),

  getIntakeQuestions: (rawDump: string, projectOverrides: Record<string, string>) =>
    request<{
      domain: WorkloadDomain;
      readyToPlan: boolean;
      questions: IntakeQuestionCard[];
      usedAiMode: 'gemini_live' | 'local_smart_fallback';
    }>('/api/intake/questions', {
      method: 'POST',
      body: JSON.stringify({ rawDump, projectOverrides }),
    }),

  getGameplanPreview: (
    rawDump: string,
    domain: WorkloadDomain | undefined,
    answers: Record<string, string>,
    projectOverrides: Record<string, string>
  ) =>
    request<GameplanProposal>('/api/intake/preview', {
      method: 'POST',
      body: JSON.stringify({ rawDump, domain, answers, projectOverrides }),
    }),

  commitGameplan: (
    rawDump: string,
    projectOverrides: Record<string, string>,
    proposal: GameplanProposal,
    approvedPreferences: DetectedPreference[]
  ) =>
    request<{
      workloadId: string;
      tasks: TaskItem[];
      workloads: Workload[];
      preferences: Preference[];
    }>('/api/workloads/commit', {
      method: 'POST',
      body: JSON.stringify({ rawDump, projectOverrides, proposal, approvedPreferences }),
    }),

  getTasks: () =>
    request<{
      today: string;
      tasks: TaskItem[];
      rebalanced: { movedCount: number; warningsCount: number; movedTasks: TaskItem[] };
    }>('/api/tasks'),

  addQuickTask: (title: string, dueDate?: string, durationMinutes?: number, slotType?: SlotType) =>
    request<TaskItem>('/api/tasks/quick', {
      method: 'POST',
      body: JSON.stringify({ title, dueDate, durationMinutes, slotType }),
    }),

  updateTask: (
    id: string,
    payload: {
      status?: 'pending' | 'done' | 'skipped';
      notes?: string;
      scheduledDate?: string;
      scheduledTime?: string;
      followUpJot?: string;
    }
  ) =>
    request<{ tasks: TaskItem[]; followUpTask: TaskItem | null }>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  pivotTask: (id: string) =>
    request<{ tasks: TaskItem[] }>(`/api/tasks/${id}/pivot`, { method: 'POST' }),

  splitTask: (id: string) =>
    request<{ tasks: TaskItem[] }>(`/api/tasks/${id}/split`, { method: 'POST' }),

  deleteTask: (id: string) =>
    request<{ tasks: TaskItem[] }>(`/api/tasks/${id}`, { method: 'DELETE' }),
};
