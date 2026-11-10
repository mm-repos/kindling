import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { getRawGeminiApiKey } from '../db.js';

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = getRawGeminiApiKey();
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

const CANDIDATE_MODELS = ['gemini-3.8-flash', 'gemini-2.5-flash'];

export async function generateWithFallback(
  ai: GoogleGenAI,
  contents: string,
  config?: Record<string, unknown>
): Promise<{ text?: string; candidates?: unknown[] }> {
  let lastErr: unknown;
  for (const model of CANDIDATE_MODELS) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents,
        config,
      });
      return res as unknown as { text?: string; candidates?: unknown[] };
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || err);
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Three-Layer Guardrail Sanitizer:
 * Strips any outbound shopping URLs, SKU/model codes, or dollar-price product pitches.
 */
export function sanitizeAntiRecommendation(text: string): string {
  if (!text) return '';
  let cleaned = text;
  // Remove http/https URLs
  cleaned = cleaned.replace(/https?:\/\/[^\s)]+/gi, '');
  // Remove www. URLs
  cleaned = cleaned.replace(/\bwww\.[^\s)]+/gi, '');
  // Remove explicit dollar prices like $29.99 or $140 to avoid SKU/product price pitching
  cleaned = cleaned.replace(/\$\d+(?:\.\d{2})?\b/g, '');
  // Collapse extra whitespace
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  return cleaned;
}

export const IntakeQuestionCardSchema = z.object({
  id: z.string(),
  question: z.string(),
  whyAsking: z.string(),
  chips: z.array(z.string()).min(2).max(6),
  allowMultiple: z.boolean().optional().default(false),
  placeholder: z.string().optional().default('Or type your own detail...'),
});

export const IntakeResponseSchema = z.object({
  domain: z.enum([
    'registration_deadline',
    'admin_errand',
    'project_todo',
    'shopping_trip',
    'general',
  ]),
  readyToPlan: z.boolean(),
  questions: z.array(IntakeQuestionCardSchema).max(3),
});

export const PivotOptionSchema = z.object({
  label: z.string(),
  newDate: z.string(),
  newTime: z.string().nullish().transform((v) => v ?? undefined),
  newContextLabel: z.string().nullish().transform((v) => v ?? undefined),
  newRationale: z.string(),
});

export const MilestoneSchema = z.object({
  date: z.string(),
  label: z.string(),
  kind: z.enum(['hard_deadline', 'safety_buffer', 'cutoff', 'optimal_window']),
  detail: z.string(),
});

export const RawProposedTaskSchema = z.object({
  tempId: z.string(),
  title: z.string(),
  forWhom: z.string().nullish().transform((v) => v ?? ''),
  contextLabel: z.string().nullish().transform((v) => v ?? ''),
  slotType: z.enum(['personal_focus', 'daytime_business', 'pinned_exact']),
  idealDate: z.string(),
  latestSafeDate: z.string(),
  pinnedTime: z.string().nullish().transform((v) => v ?? undefined),
  durationMinutes: z.number().int().min(3).max(60).transform((n) => Math.min(35, Math.max(5, n))),
  dependsOnTempId: z.string().nullish().transform((v) => v ?? undefined),
  minWaitDays: z.number().int().min(0).max(90).nullish().transform((v) => v ?? 0),
  rationale: z.string(),
  pivotOption: z
    .union([
      PivotOptionSchema,
      z.string().transform((s) =>
        s.trim()
          ? {
              label: s.trim(),
              newDate: '',
              newRationale: s.trim(),
            }
          : null
      ),
    ])
    .nullish()
    .transform((v) => (v && v.newDate ? v : null)),
});

export const DetectedPreferenceSchema = z.object({
  category: z.enum([
    'family_people',
    'local_orgs',
    'timing_habits',
    'buffer_rules',
    'stores',
    'general',
  ]),
  key: z.string(),
  value: z.string(),
  reason: z.string(),
});

export const RawGameplanSchema = z.object({
  workloadTitle: z.string(),
  domain: z.enum([
    'registration_deadline',
    'admin_errand',
    'project_todo',
    'shopping_trip',
    'general',
  ]),
  hardDeadline: z.string().nullable(),
  deadlineConfidence: z.enum(['verified_web', 'user_provided', 'needs_check']),
  verificationSummary: z.string(),
  bufferSummary: z.string(),
  milestones: z.array(MilestoneSchema),
  proposedTasks: z.array(RawProposedTaskSchema).min(1),
  detectedPreferences: z.array(DetectedPreferenceSchema).default([]),
});

export const MicroSplitSchema = z.object({
  steps: z
    .array(
      z.object({
        title: z.string(),
        durationMinutes: z.number().int().min(3).max(10),
        rationale: z.string(),
      })
    )
    .min(2)
    .max(5),
});

export function extractJsonFromText(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  }
  return JSON.parse(candidate);
}
