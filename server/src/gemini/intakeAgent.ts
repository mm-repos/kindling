import { getTodayStr } from '../scheduler/capacityScheduler.js';
import { IntakeQuestionCard, Preference, WorkloadDomain } from '../types.js';
import {
  extractJsonFromText,
  generateWithFallback,
  getGeminiClient,
  IntakeResponseSchema,
  sanitizeAntiRecommendation,
} from './guardrails.js';

export interface IntakeInput {
  rawDump: string;
  appliedPreferences: Preference[];
  projectOverrides: Record<string, string>;
  previousAnswers?: Record<string, string>;
}

export interface IntakeOutput {
  domain: WorkloadDomain;
  readyToPlan: boolean;
  questions: IntakeQuestionCard[];
  usedAiMode: 'gemini_live' | 'local_smart_fallback';
}

function detectDomainHeuristic(text: string): WorkloadDomain {
  const lower = text.toLowerCase();
  if (
    /\b(register|registration|enroll|enrollment|class|camp|swim|soccer|school|application|apply|deadline|exam|permit|renew|tax|league)\b/.test(
      lower
    )
  ) {
    return 'registration_deadline';
  }
  if (
    /\b(buy|shop|shopping|sale|clothes|outfit|packing|trip|flight|vacation|gifts|order)\b/.test(
      lower
    )
  ) {
    return 'shopping_trip';
  }
  if (/\b(doctor|dentist|pediatrician|appointment|call|office|dmv|bank|bill|errand|return)\b/.test(lower)) {
    return 'admin_errand';
  }
  if (/\b(clean|organize|garage|move|moving|host|hosting|party|dinner|project|presentation)\b/.test(lower)) {
    return 'project_todo';
  }
  return 'general';
}

function buildEffectivePrefsSummary(
  prefs: Preference[],
  overrides: Record<string, string>
): string {
  const lines: string[] = [];
  for (const p of prefs) {
    const val = overrides[p.key] !== undefined ? `${overrides[p.key]} (overridden for this project)` : p.value;
    lines.push(`- [${p.category}] ${p.key}: ${val}`);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (!prefs.some((p) => p.key === k)) {
      lines.push(`- [project_override] ${k}: ${v}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : '(No saved preferences yet)';
}

export async function generateIntakeQuestions(input: IntakeInput): Promise<IntakeOutput> {
  const today = getTodayStr();
  const effectivePrefs = buildEffectivePrefsSummary(input.appliedPreferences, input.projectOverrides);
  const hasPreviousAnswers =
    input.previousAnswers && Object.keys(input.previousAnswers).length > 0;

  // Cap questioning to 1 round unless truly missing critical info so the user is never overwhelmed
  if (hasPreviousAnswers) {
    return {
      domain: detectDomainHeuristic(input.rawDump),
      readyToPlan: true,
      questions: [],
      usedAiMode: getGeminiClient() ? 'gemini_live' : 'local_smart_fallback',
    };
  }

  const ai = getGeminiClient();
  if (ai) {
    try {
      const prompt = `You are Kindling's calm, executive-function Intake Strategist.
Today's local date is ${today}.

USER BRAIN-DUMP:
"""
${input.rawDump}
"""

ALREADY KNOWN USER PREFERENCES & ACTIVE PROJECT OVERRIDES (DO NOT re-ask what is already answered here!):
${effectivePrefs}

YOUR JOB:
1. Classify the workload domain into one of:
   - "registration_deadline" (registering a child for a class/camp/sport, school forms, renewals, applications, civic/tax deadlines)
   - "admin_errand" (appointments, phone calls to offices, bills, errands)
   - "project_todo" (multi-step home/work projects, hosting, organizing)
   - "shopping_trip" (buying items for an upcoming trip, event, or season)
   - "general"
2. Identify ONLY the 1 to 3 highest-impact missing constraints needed to verify external deadlines/sales and build a backwards micro-schedule.
   - If domain is "registration_deadline" (e.g. registering son for a class): ask which city/program/provider it's through (so we can verify registration opening/cutoff dates!), age/level or session preference, and whether prerequisites (account/forms) are already done.
   - If domain is "shopping_trip": ask departure/deadline date & destination climate (if not stated), who needs what categories (if not stated), and preferred stores (include a chip "Compare upcoming store sales for me" if no preferred store is saved yet!).
   - If domain is "admin_errand" or "project_todo": ask target completion date/urgency, any external office/person involved, and biggest blocker.
3. STRICT ANTI-RECOMMENDATION RULE:
   - NEVER suggest specific products, item models, prices, or shopping URLs.
   - Store names may ONLY appear as neutral venue choices on chips when asking where the user prefers to shop, plus "Compare upcoming store sales for me".

Return ONLY valid JSON matching this exact structure:
{
  "domain": "registration_deadline" | "admin_errand" | "project_todo" | "shopping_trip" | "general",
  "readyToPlan": false,
  "questions": [
    {
      "id": "q1",
      "question": "Short, calm question?",
      "whyAsking": "Brief 1-line reason why this helps schedule or verify deadlines",
      "chips": ["Option 1", "Option 2", "Option 3"],
      "allowMultiple": false,
      "placeholder": "Or type details..."
    }
  ]
}`;

      const response = await generateWithFallback(ai, prompt, {
        temperature: 0.3,
      });

      const rawText = response.text || '';
      const parsed = IntakeResponseSchema.parse(extractJsonFromText(rawText));
      return {
        domain: parsed.domain,
        readyToPlan: parsed.readyToPlan,
        questions: parsed.questions.map((q) => ({
          ...q,
          question: sanitizeAntiRecommendation(q.question),
          whyAsking: sanitizeAntiRecommendation(q.whyAsking),
          chips: q.chips.map(sanitizeAntiRecommendation),
        })),
        usedAiMode: 'gemini_live',
      };
    } catch (err) {
      console.warn('[intakeAgent] Gemini call failed, falling back to local smart intake:', err);
    }
  }

  // Smart deterministic fallback when no API key is configured yet
  const domain = detectDomainHeuristic(input.rawDump);
  const lower = input.rawDump.toLowerCase();
  const questions: IntakeQuestionCard[] = [];

  if (domain === 'registration_deadline') {
    questions.push({
      id: 'org_provider',
      question: 'Which program, school, or city rec department is this through?',
      whyAsking: 'So we can verify the exact registration opening/cutoff date and portal requirements.',
      chips: [
        'City Parks & Rec',
        'Local Swim / Sports Club',
        'School After-Care / Enrichment',
        'Not decided yet — help me check deadlines',
      ],
      allowMultiple: false,
      placeholder: 'e.g., Sunnyvale Rec Swim, YMCA, Little League...',
    });
    questions.push({
      id: 'target_session',
      question: 'Which session/season and age group are you aiming for?',
      whyAsking: 'Different sessions and resident tiers often open on different mornings.',
      chips: ['Winter Session (Upcoming)', 'Spring Session', 'Starts Next Month', 'Not sure of exact date'],
      allowMultiple: true,
      placeholder: 'e.g., Son is 7, looking for Saturday morning beginner class',
    });
    questions.push({
      id: 'prereq_state',
      question: 'Do you already have an active account & any required forms ready?',
      whyAsking: 'Helps us schedule quick prep steps days BEFORE registration opens so spots do not fill.',
      chips: [
        'Need to check login & requirements',
        'Account ready, need forms/waiver check',
        'Starting from scratch',
      ],
      allowMultiple: false,
      placeholder: 'Any other details to remember for next time...',
    });
  } else if (domain === 'shopping_trip') {
    const mentionsDate = /\b(dec|nov|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|\d{1,2}(st|nd|rd|th)?)\b/i.test(lower);
    if (!mentionsDate) {
      questions.push({
        id: 'trip_date_dest',
        question: 'When do you leave, and what kind of destination/weather is it?',
        whyAsking: 'Sets your hard packing cutoff and safe shipping buffer.',
        chips: ['Early December (Cold/Winter)', 'Late November (Holiday Trip)', 'Warm Weather Trip', 'Within 2 Weeks'],
        allowMultiple: false,
        placeholder: 'e.g., Leaving Dec 5th for Colorado...',
      });
    } else {
      questions.push({
        id: 'who_and_what',
        question: 'Who are you buying for, and which broad categories do you need?',
        whyAsking: 'Breaks one giant shopping list into calm, separate 20-minute blocks.',
        chips: ['Kids clothes & layers', 'My own travel essentials', 'Whole family', 'Toiletries & gear'],
        allowMultiple: true,
        placeholder: 'e.g., Kids warm clothes + travel toiletries (no specific recs needed)',
      });
    }

    const savedStore = input.appliedPreferences.find((p) => p.category === 'stores');
    if (!savedStore) {
      questions.push({
        id: 'store_pref',
        question: 'Where do you usually like to shop for these, or should we compare upcoming sale windows?',
        whyAsking: 'We align your buy dates with store sales & shipping speed—and remember your go-to stores.',
        chips: [
          'Compare upcoming store sales for me',
          'Target',
          'Old Navy / Gap',
          'Prefer online with safe shipping',
          'Prefer quick in-store pickup',
        ],
        allowMultiple: true,
        placeholder: 'Type your preferred store(s)...',
      });
    }

    questions.push({
      id: 'delivery_preference',
      question: 'How do you prefer to handle delivery before the trip?',
      whyAsking: 'Ensures everything arrives with time to try on or wash before packing.',
      chips: [
        'Online shipping (leave time for try-on/returns)',
        'Mix of online + in-store pickup if a late sale is better',
        'In-store only',
      ],
      allowMultiple: false,
      placeholder: 'e.g., Need everything home 3 days before we leave',
    });
  } else {
    questions.push({
      id: 'deadline_target',
      question: 'Is there a hard deadline or target date we should work backward from?',
      whyAsking: 'Anchors the backwards schedule and protects buffer time.',
      chips: ['End of this week', 'Within 2 weeks', 'End of the month', 'Check external deadline for me'],
      allowMultiple: false,
      placeholder: 'e.g., Due Nov 25th, or flexible...',
    });
    questions.push({
      id: 'daytime_vs_evening',
      question: 'Does any part require daytime business hours (calls, offices, errands)?',
      whyAsking: 'So phone calls and office visits never land in an 8 PM evening slot.',
      chips: [
        'Yes — includes daytime phone calls or office visits',
        'All online / at home',
        'Mix of daytime calls and evening prep',
      ],
      allowMultiple: false,
      placeholder: 'Any waiting periods or dependencies?',
    });
  }

  return {
    domain,
    readyToPlan: false,
    questions: questions.slice(0, 3),
    usedAiMode: 'local_smart_fallback',
  };
}
