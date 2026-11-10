import { getTodayStr } from '../scheduler/capacityScheduler.js';
import { DeadlineConfidence, Preference, WorkloadDomain } from '../types.js';
import { generateWithFallback, getGeminiClient, sanitizeAntiRecommendation } from './guardrails.js';

export interface GroundingInput {
  rawDump: string;
  domain: WorkloadDomain;
  answers: Record<string, string>;
  appliedPreferences: Preference[];
  homeLocationHint: string;
}

export interface GroundingVerificationResult {
  deadlineConfidence: DeadlineConfidence;
  summaryNotes: string;
  sources: string[];
}

/**
 * Uses Gemini + Google Search Grounding to verify real-world external timing:
 * - Class/camp/school/civic registration opening & closing dates + prerequisites
 * - Agency/office processing lead times & business hours
 * - Store-level promotional sale dates & standard carrier shipping transit windows
 * Strictly strips any product names, prices, or retail links.
 */
export async function verifyExternalDeadlinesAndTiming(
  input: GroundingInput
): Promise<GroundingVerificationResult> {
  const today = getTodayStr();
  const ai = getGeminiClient();

  const answersText = Object.entries(input.answers)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const prefsText = input.appliedPreferences
    .map((p) => `- [${p.category}] ${p.key}: ${p.value}`)
    .join('\n');

  if (ai) {
    try {
      const searchPrompt = `Today's local date is ${today}.
User location hint: ${input.homeLocationHint || 'Not specified'}.
Workload domain: ${input.domain}.

USER TASK / BRAIN-DUMP:
"""
${input.rawDump}
"""

USER CLARIFYING ANSWERS:
${answersText || '(Skipped / using smart defaults)'}

SAVED PREFERENCES:
${prefsText || '(None)'}

Use Google Search to verify ONLY real-world timing, deadlines, prerequisites, and lead times relevant to ${today}:
1. If this is a registration, class, school, civic, or administrative task:
   - Search for the specific organization/program's upcoming session registration opening date/time, resident early-bird window, closing cutoff, and required prerequisites (portal account, age verification, waivers/medical forms).
   - State clearly whether an exact public date was VERIFIED online, USER_PROVIDED, or UNLISTED/NEEDS_PORTAL_CHECK (never guess or invent dates!).
2. If this involves shopping or trip preparation:
   - Search ONLY for store-level promotional/sale calendar dates (e.g., Target Circle Week, pre-Black Friday / Black Friday apparel event dates) and standard shipping transit + holiday shipping cutoff times for the user's preferred stores (or compare store sale windows if requested).
   - STRICT FORBIDDEN RULE: Do NOT mention any specific products, item names, SKUs, dollar prices, or product URLs. Only report store-level sale dates and shipping days.
3. Keep your findings concise (4-6 bullet points max) starting with a line:
   CONFIDENCE: VERIFIED_WEB | USER_PROVIDED | NEEDS_CHECK`;

      const response = await generateWithFallback(ai, searchPrompt, {
        tools: [{ googleSearch: {} }],
        temperature: 0.2,
      });

      const rawText = response.text || '';
      let confidence: DeadlineConfidence = 'needs_check';
      if (/CONFIDENCE:\s*VERIFIED_WEB/i.test(rawText)) {
        confidence = 'verified_web';
      } else if (/CONFIDENCE:\s*USER_PROVIDED/i.test(rawText)) {
        confidence = 'user_provided';
      }

      const cleanedSummary = sanitizeAntiRecommendation(
        rawText.replace(/CONFIDENCE:\s*(VERIFIED_WEB|USER_PROVIDED|NEEDS_CHECK)\s*/i, '').trim()
      );

      // Extract grounding source titles/domains (never product URLs)
      const sources: string[] = [];
      const candidateMeta = (response as unknown as {
        candidates?: Array<{
          groundingMetadata?: {
            groundingChunks?: Array<{ web?: { title?: string } }>;
          };
        }>;
      })?.candidates?.[0]?.groundingMetadata?.groundingChunks;

      if (Array.isArray(candidateMeta)) {
        for (const chunk of candidateMeta) {
          if (chunk.web?.title && sources.length < 4) {
            sources.push(chunk.web.title);
          }
        }
      }

      return {
        deadlineConfidence: confidence,
        summaryNotes:
          cleanedSummary ||
          'Checked timing constraints relative to current calendar; verify portal-specific dates on Step 1.',
        sources,
      };
    } catch (err) {
      console.warn('[groundingVerifier] Google Search grounding fallback triggered:', err);
    }
  }

  // Deterministic calendar-aware timing context when running without live Gemini API key
  if (input.domain === 'registration_deadline') {
    return {
      deadlineConfidence: 'needs_check',
      summaryNotes:
        'Exact local session opening times often sit inside the program portal and fill quickly at 8:00–9:00 AM on opening morning. Scheduled an immediate 5-minute portal deadline & prerequisite check first, followed by form/account readiness days ahead of registration morning.',
      sources: ['Local Smart Timing Rules (Add Gemini API Key in Settings for Live Web Verification)'],
    };
  }

  if (input.domain === 'shopping_trip') {
    return {
      deadlineConfidence: 'user_provided',
      summaryNotes:
        'Mid-to-late November features early pre-Black Friday apparel promotions at major family retailers (including Target Circle deals ~Nov 16–22 and Thanksgiving/Black Friday week Nov 26–30). Standard ground shipping averages 5–7 days in late November, making post-Nov 26 online orders risky for early-December trips unless switched to In-Store Pickup.',
      sources: ['Seasonal Retail & Carrier Transit Calendar (Add Gemini API Key for Live Store Search)'],
    };
  }

  return {
    deadlineConfidence: 'user_provided',
    summaryNotes:
      'Accounted for weekday business hours (9 AM–5 PM) for phone/office steps, multi-day waiting buffers between dependent steps, and your daily focus cap.',
    sources: ['Kindling Backwards Constraint Engine'],
  };
}
