export type WorkloadDomain =
  | 'registration_deadline'
  | 'admin_errand'
  | 'project_todo'
  | 'shopping_trip'
  | 'general';

export type DeadlineConfidence = 'verified_web' | 'user_provided' | 'needs_check';

export type SlotType = 'personal_focus' | 'daytime_business' | 'pinned_exact';

export type PreferenceCategory =
  | 'family_people'
  | 'local_orgs'
  | 'timing_habits'
  | 'buffer_rules'
  | 'stores'
  | 'general';

export interface TimeWindow {
  days: number[];
  startTime: string;
  endTime: string;
  label: string;
}

export interface AppSettings {
  geminiApiKey: string;
  hasEnvKey: boolean;
  dailyCapMinutes: number;
  focusWindows: TimeWindow[];
  businessWindows: TimeWindow[];
  homeLocationHint: string;
}

export interface Preference {
  id: string;
  category: PreferenceCategory;
  key: string;
  value: string;
  updatedAt: string;
}

export interface IntakeQuestionCard {
  id: string;
  question: string;
  whyAsking: string;
  chips: string[];
  allowMultiple?: boolean;
  placeholder?: string;
}

export interface PivotOption {
  label: string;
  newDate: string;
  newTime?: string;
  newContextLabel?: string;
  newRationale: string;
  applied?: boolean;
}

export interface BackwardsMilestone {
  date: string;
  label: string;
  kind: 'hard_deadline' | 'safety_buffer' | 'cutoff' | 'optimal_window';
  detail: string;
}

export interface ProposedTask {
  tempId: string;
  title: string;
  forWhom: string;
  contextLabel: string;
  slotType: SlotType;
  idealDate: string;
  latestSafeDate: string;
  pinnedTime?: string;
  scheduledDate: string;
  scheduledTime: string;
  durationMinutes: number;
  dependsOnTempId?: string;
  minWaitDays: number;
  rationale: string;
  pivotOption?: PivotOption | null;
}

export interface DetectedPreference {
  category: PreferenceCategory;
  key: string;
  value: string;
  reason: string;
}

export interface GameplanProposal {
  workloadTitle: string;
  domain: WorkloadDomain;
  hardDeadline: string | null;
  deadlineConfidence: DeadlineConfidence;
  verificationSummary: string;
  groundingSources: string[];
  bufferSummary: string;
  milestones: BackwardsMilestone[];
  proposedTasks: ProposedTask[];
  detectedPreferences: DetectedPreference[];
  usedAiMode: 'gemini_live' | 'local_smart_fallback';
}

export interface Workload {
  id: string;
  title: string;
  rawDump: string;
  domain: WorkloadDomain;
  hardDeadline: string | null;
  deadlineConfidence: DeadlineConfidence;
  verificationNotes: string;
  bufferSummary: string;
  milestones: BackwardsMilestone[];
  projectOverrides: Record<string, string>;
  status: 'clarifying' | 'scheduled' | 'completed';
  createdAt: string;
}

export interface TaskItem {
  id: string;
  workloadId: string | null;
  workloadTitle?: string;
  parentTaskId: string | null;
  dependsOnTaskId: string | null;
  minWaitDays: number;
  slotType: SlotType;
  title: string;
  forWhom: string;
  contextLabel: string;
  scheduledDate: string;
  scheduledTime: string;
  latestSafeDate: string | null;
  durationMinutes: number;
  rationale: string;
  pivotOption: PivotOption | null;
  cutoffWarning: boolean;
  status: 'pending' | 'done' | 'skipped';
  notes: string;
  createdAt: string;
}
