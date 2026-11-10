import { getSettings } from '../db.js';
import {
  addDays,
  assignProposedTaskSlots,
  getTodayStr,
} from '../scheduler/capacityScheduler.js';
import {
  GameplanProposal,
  Preference,
  ProposedTask,
  TaskItem,
  WorkloadDomain,
} from '../types.js';
import { verifyExternalDeadlinesAndTiming } from './groundingVerifier.js';
import {
  extractJsonFromText,
  generateWithFallback,
  getGeminiClient,
  MicroSplitSchema,
  RawGameplanSchema,
  sanitizeAntiRecommendation,
} from './guardrails.js';

export interface BuildGameplanInput {
  rawDump: string;
  domain?: WorkloadDomain;
  answers: Record<string, string>;
  appliedPreferences: Preference[];
  projectOverrides: Record<string, string>;
}

function parseExplicitDateFromText(text: string, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const monthNames: Record<string, number> = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };

  const match = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i
  );
  if (match) {
    const m = monthNames[match[1].toLowerCase()];
    const d = Number(match[2]);
    const currentMonth = Number(today.slice(5, 7));
    const targetYear = m < currentMonth ? year + 1 : year;
    return `${targetYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

export async function buildWorkbackGameplan(
  input: BuildGameplanInput
): Promise<GameplanProposal> {
  const today = getTodayStr();
  const settings = getSettings();

  // Merge permanent preferences + temporary per-project overrides
  const effectivePrefs: Preference[] = input.appliedPreferences.map((p) => ({
    ...p,
    value:
      input.projectOverrides[p.key] !== undefined
        ? input.projectOverrides[p.key]
        : p.value,
  }));
  for (const [k, v] of Object.entries(input.projectOverrides)) {
    if (!effectivePrefs.some((p) => p.key === k)) {
      effectivePrefs.push({
        id: `override_${k}`,
        category: 'general',
        key: k,
        value: v,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  const domainGuess: WorkloadDomain = input.domain || 'general';

  // Step 1: Real-World Grounding Verification (Deadlines, Registrations, Lead Times, or Store Sales)
  const grounding = await verifyExternalDeadlinesAndTiming({
    rawDump: input.rawDump,
    domain: domainGuess,
    answers: input.answers,
    appliedPreferences: effectivePrefs,
    homeLocationHint: settings.homeLocationHint,
  });

  // Step 2: Backwards Constraint Planner via Gemini (with strict JSON & anti-recommendation guardrails)
  const ai = getGeminiClient();
  if (ai) {
    try {
      const answersStr = Object.entries(input.answers)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');
      const prefsStr = effectivePrefs
        .map((p) => `- [${p.category}] ${p.key}: ${p.value}`)
        .join('\n');

      const plannerPrompt = `You are Kindling's Backwards Constraint & Micro-Task Decomposer.
Today's local date is ${today}.
User daily focus cap: ${settings.dailyCapMinutes} minutes/day.

USER WORKLOAD / BRAIN-DUMP:
"""
${input.rawDump}
"""

USER CLARIFYING ANSWERS:
${answersStr || '(None — use smart defaults)'}

APPLIED PREFERENCES & PROJECT OVERRIDES:
${prefsStr || '(None)'}

VERIFIED REAL-WORLD TIMING / GROUNDING NOTES:
Confidence: ${grounding.deadlineConfidence}
${grounding.summaryNotes}

CRITICAL SCHEDULING & GUARDRAIL RULES:
1. NEVER RECOMMEND PRODUCTS: Never mention specific product models, SKUs, dollar prices, or URLs. If shopping is involved, only schedule category-level action blocks (e.g. "Order kids' cold-weather layers") aligned with store sale windows and safe shipping buffers.
2. NEVER HALLUCINATE DEADLINES: If external registration/cutoff dates were NOT verified ("needs_check"), set deadlineConfidence to "needs_check" and make Task 1 a 5-minute check to confirm the exact cutoff date in the portal/office.
3. WORK BACKWARD FROM HARD DEADLINES:
   - Subtract prep/packing/review buffers FIRST (e.g., 2-3 days before a trip or event).
   - Subtract carrier shipping + try-on/return buffers (5-7 days for online orders) OR prerequisite lead times (account creation, medical/waiver forms days BEFORE class registration opens).
   - If a better later sale overlaps the shipping danger zone (e.g. Cyber Monday Nov 30 before a Dec 5 trip), schedule the task on an EARLIER safe date/sale by default, AND populate "pivotOption" offering a 1-click switch to "In-Store Pickup" on the later sale date!
4. SLOT TYPES:
   - "daytime_business": Phone calls to offices/doctors, in-person weekday errands (M-F 9-5).
   - "pinned_exact": Exact opening moments that cannot move (e.g., class registration opens at 08:00 AM). Provide "pinnedTime" ("08:00").
   - "personal_focus": Evening/weekend calm blocks (10-25 minutes each).
5. MICRO-SIZING & WAIT GAPS:
   - Every task MUST be 5 to 25 minutes max. Break big scary tasks into calm, concrete steps.
   - Use "dependsOnTempId" and "minWaitDays" whenever there is a real waiting gap (e.g., 5 days shipping transit between ordering and trying-on/packing, or waiting 2 days for an office reply).
6. DETECTED PREFERENCES:
   - Extract 1 to 3 genuinely reusable recurring facts (e.g. son's age/activity, local org, preferred store for a category, buffer preference) that aren't already saved in APPLIED PREFERENCES. Do NOT save one-off trip destinations as permanent preferences.

Return ONLY valid JSON matching this schema:
{
  "workloadTitle": "Calm, clear 3-6 word title",
  "domain": "registration_deadline" | "admin_errand" | "project_todo" | "shopping_trip" | "general",
  "hardDeadline": "YYYY-MM-DD" or null,
  "deadlineConfidence": "verified_web" | "user_provided" | "needs_check",
  "verificationSummary": "2-sentence plain-English summary of verified deadlines, prerequisites, or sale/shipping alignment",
  "bufferSummary": "1-sentence summary of buffers protected (e.g. 'All deliveries arrive by Nov 26; packed by Dec 3 ahead of Dec 5 departure')",
  "milestones": [
    { "date": "YYYY-MM-DD", "label": "Short milestone name", "kind": "optimal_window" | "cutoff" | "safety_buffer" | "hard_deadline", "detail": "Why this date matters" }
  ],
  "proposedTasks": [
    {
      "tempId": "t1",
      "title": "Actionable micro-step (no product recs)",
      "forWhom": "e.g. Son / Kids / Self / Family",
      "contextLabel": "e.g. City Rec Portal / Target / Pediatrician",
      "slotType": "personal_focus" | "daytime_business" | "pinned_exact",
      "idealDate": "YYYY-MM-DD",
      "latestSafeDate": "YYYY-MM-DD",
      "pinnedTime": "08:00",
      "durationMinutes": 15,
      "dependsOnTempId": "t0",
      "minWaitDays": 0,
      "rationale": "Why this date/time (deadline, prerequisite, sale window, or shipping math)",
      "pivotOption": { "label": "Switch to In-Store Pickup on YYYY-MM-DD", "newDate": "YYYY-MM-DD", "newTime": "10:30", "newContextLabel": "Store (In-Store Pickup)", "newRationale": "Why this pivot works" }
    }
  ],
  "detectedPreferences": [
    {
      "category": "family_people" | "local_orgs" | "timing_habits" | "buffer_rules" | "stores" | "general",
      "key": "Short label (e.g. Kids' clothes store)",
      "value": "Remembered value (e.g. Target)",
      "reason": "Mentioned during intake"
    }
  ]
}`;

      const response = await generateWithFallback(ai, plannerPrompt, {
        temperature: 0.25,
      });

      const parsed = RawGameplanSchema.parse(extractJsonFromText(response.text || ''));
      const sanitizedRawTasks = parsed.proposedTasks.map((t) => ({
        ...t,
        title: sanitizeAntiRecommendation(t.title),
        forWhom: sanitizeAntiRecommendation(t.forWhom),
        contextLabel: sanitizeAntiRecommendation(t.contextLabel),
        rationale: sanitizeAntiRecommendation(t.rationale),
        pivotOption: t.pivotOption
          ? {
              ...t.pivotOption,
              label: sanitizeAntiRecommendation(t.pivotOption.label),
              newRationale: sanitizeAntiRecommendation(t.pivotOption.newRationale),
            }
          : null,
      }));

      const scheduledTasks = assignProposedTaskSlots(sanitizedRawTasks, today);

      return {
        workloadTitle: sanitizeAntiRecommendation(parsed.workloadTitle),
        domain: parsed.domain,
        hardDeadline: parsed.hardDeadline,
        deadlineConfidence: parsed.deadlineConfidence,
        verificationSummary: sanitizeAntiRecommendation(parsed.verificationSummary),
        groundingSources: grounding.sources,
        bufferSummary: sanitizeAntiRecommendation(parsed.bufferSummary),
        milestones: parsed.milestones
          .map((m) => ({
            ...m,
            label: sanitizeAntiRecommendation(m.label),
            detail: sanitizeAntiRecommendation(m.detail),
          }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        proposedTasks: scheduledTasks,
        detectedPreferences: parsed.detectedPreferences.map((dp) => ({
          ...dp,
          key: sanitizeAntiRecommendation(dp.key),
          value: sanitizeAntiRecommendation(dp.value),
          reason: sanitizeAntiRecommendation(dp.reason),
        })),
        usedAiMode: 'gemini_live',
      };
    } catch (err) {
      console.warn('[workbackPlanner] Gemini planner fallback triggered:', err);
    }
  }

  // Deterministic Smart Planner Fallback (works offline / before API key is entered)
  const combinedText = `${input.rawDump} ${Object.values(input.answers).join(' ')}`;
  const explicitDate = parseExplicitDateFromText(combinedText, today);

  if (domainGuess === 'registration_deadline') {
    const orgAnswer =
      input.answers['org_provider'] ||
      effectivePrefs.find((p) => p.category === 'local_orgs')?.value ||
      'Program Portal';
    const sessionAnswer = input.answers['target_session'] || 'Upcoming Session';
    const estRegDay = explicitDate || addDays(today, 7);
    const prepCutoff = addDays(estRegDay, -2);

    const rawTasks: Omit<ProposedTask, 'scheduledDate' | 'scheduledTime'>[] = [
      {
        tempId: 't1',
        title: `Check ${orgAnswer} portal for exact opening date & age tier`,
        forWhom: 'Son',
        contextLabel: orgAnswer,
        slotType: 'personal_focus',
        idealDate: today,
        latestSafeDate: addDays(today, 2),
        durationMinutes: 10,
        minWaitDays: 0,
        rationale:
          'Confirms exact resident/early-bird opening hour right away so spots do not fill unexpectedly.',
        pivotOption: null,
      },
      {
        tempId: 't2',
        title: 'Verify portal login, payment method & any required waiver/medical form',
        forWhom: 'Son',
        contextLabel: orgAnswer,
        slotType: 'daytime_business',
        idealDate: addDays(today, 2),
        latestSafeDate: prepCutoff,
        durationMinutes: 15,
        dependsOnTempId: 't1',
        minWaitDays: 1,
        rationale:
          'Scheduled in a weekday daytime slot in case you need to call the office or pediatrician for a form.',
        pivotOption: null,
      },
      {
        tempId: 't3',
        title: `Pick top choice + 1 backup day/time for ${sessionAnswer}`,
        forWhom: 'Son',
        contextLabel: 'Family Calendar',
        slotType: 'personal_focus',
        idealDate: prepCutoff,
        latestSafeDate: addDays(estRegDay, -1),
        durationMinutes: 10,
        dependsOnTempId: 't2',
        minWaitDays: 1,
        rationale: 'Having a backup class code ready saves precious minutes on registration morning.',
        pivotOption: null,
      },
      {
        tempId: 't4',
        title: `Submit ${orgAnswer} class registration right when window opens`,
        forWhom: 'Son',
        contextLabel: orgAnswer,
        slotType: 'pinned_exact',
        idealDate: estRegDay,
        latestSafeDate: estRegDay,
        pinnedTime: '08:00',
        durationMinutes: 10,
        dependsOnTempId: 't3',
        minWaitDays: 1,
        rationale:
          'Pinned to morning opening window so popular youth classes do not sell out before evening.',
        pivotOption: {
          label: 'If spots fill: Join waitlist + check secondary community location',
          newDate: estRegDay,
          newTime: '12:15',
          newContextLabel: `${orgAnswer} (Waitlist / Backup)`,
          newRationale: 'Keeps backup enrollment option ready during weekday lunch slot.',
        },
      },
    ];

    const scheduledTasks = assignProposedTaskSlots(rawTasks, today);
    const detectedPreferences = [];
    if (input.answers['org_provider'] && !input.answers['org_provider'].includes('Not decided')) {
      detectedPreferences.push({
        category: 'local_orgs' as const,
        key: 'Youth class provider',
        value: input.answers['org_provider'],
        reason: 'Selected for class registration',
      });
    }
    detectedPreferences.push({
      category: 'family_people' as const,
      key: 'Child activity planning',
      value: `Son (${sessionAnswer})`,
      reason: 'Remembered to pre-fill future class & camp deadlines',
    });

    return {
      workloadTitle: `Register Son for Class (${orgAnswer})`,
      domain: 'registration_deadline',
      hardDeadline: estRegDay,
      deadlineConfidence: explicitDate ? 'user_provided' : 'needs_check',
      verificationSummary: grounding.summaryNotes,
      groundingSources: grounding.sources,
      bufferSummary: `Portal & waiver prep completed by ${prepCutoff} (2 full days before ${estRegDay} morning registration).`,
      milestones: [
        {
          date: today,
          label: 'Verify Exact Opening Window',
          kind: 'optimal_window',
          detail: 'Confirm portal opening hour & prerequisites',
        },
        {
          date: prepCutoff,
          label: 'Account & Waiver Ready Cutoff',
          kind: 'safety_buffer',
          detail: 'All forms & backup class codes ready 48h early',
        },
        {
          date: estRegDay,
          label: 'Registration Window (Pinned 8:00 AM)',
          kind: 'hard_deadline',
          detail: 'Submit enrollment right as spots open',
        },
      ],
      proposedTasks: scheduledTasks,
      detectedPreferences,
      usedAiMode: 'local_smart_fallback',
    };
  }

  if (domainGuess === 'shopping_trip') {
    const tripDate = explicitDate || addDays(today, 22);
    const packBufferDate = addDays(tripDate, -2);
    const shippingCutoffDate = addDays(tripDate, -9);
    const earlySaleDate = addDays(today, 5) <= shippingCutoffDate ? addDays(today, 5) : today;
    const lateSaleDate = addDays(tripDate, -5);

    const chosenStoreRaw =
      input.answers['store_pref'] ||
      effectivePrefs.find((p) => p.category === 'stores')?.value ||
      'Target';
    const chosenStore = chosenStoreRaw.includes('Compare')
      ? 'Target / Old Navy Early Holiday Promo'
      : chosenStoreRaw;

    const rawTasks: Omit<ProposedTask, 'scheduledDate' | 'scheduledTime'>[] = [
      {
        tempId: 't1',
        title: 'Audit closets & list exact sizes/gaps needed before buying',
        forWhom: 'Kids & Self',
        contextLabel: 'Home Closet Check',
        slotType: 'personal_focus',
        idealDate: today,
        latestSafeDate: addDays(earlySaleDate, -1),
        durationMinutes: 15,
        minWaitDays: 0,
        rationale: 'Prevents overbuying and gives you a crisp checklist before the sale window starts.',
        pivotOption: null,
      },
      {
        tempId: 't2',
        title: `Order kids' trip clothing essentials during ${chosenStore} sale window`,
        forWhom: 'Kids',
        contextLabel: chosenStore,
        slotType: 'personal_focus',
        idealDate: earlySaleDate,
        latestSafeDate: shippingCutoffDate,
        durationMinutes: 25,
        dependsOnTempId: 't1',
        minWaitDays: 1,
        rationale: `Aligned with upcoming pre-holiday sale window AND placed before ${shippingCutoffDate} online shipping cutoff so packages arrive ~6 days before ${tripDate}.`,
        pivotOption: {
          label: `Wait for later Black Friday/Cyber sale (${lateSaleDate}) via In-Store Pickup`,
          newDate: lateSaleDate,
          newTime: '10:30',
          newContextLabel: `${chosenStore} (In-Store Pickup)`,
          newRationale: `Later sale is too close to ${tripDate} for safe ground shipping, so switching to same-day In-Store Pickup protects your packing buffer.`,
        },
      },
      {
        tempId: 't3',
        title: 'Order remaining adult/family travel toiletries & layers',
        forWhom: 'Self & Family',
        contextLabel: chosenStore,
        slotType: 'personal_focus',
        idealDate: addDays(earlySaleDate, 1),
        latestSafeDate: shippingCutoffDate,
        durationMinutes: 20,
        dependsOnTempId: 't1',
        minWaitDays: 1,
        rationale: `Split onto a separate evening from kids' order so you stay under your daily cap and beat the ${shippingCutoffDate} shipping cutoff.`,
        pivotOption: null,
      },
      {
        tempId: 't4',
        title: 'Try on delivered items, wash & set aside any quick exchanges',
        forWhom: 'Family',
        contextLabel: 'Home Prep',
        slotType: 'personal_focus',
        idealDate: addDays(earlySaleDate, 6),
        latestSafeDate: packBufferDate,
        durationMinutes: 20,
        dependsOnTempId: 't2',
        minWaitDays: 5,
        rationale: `Includes a 5-day shipping transit wait-gap after ordering, finishing comfortably before ${packBufferDate} packing day.`,
        pivotOption: null,
      },
    ];

    const scheduledTasks = assignProposedTaskSlots(rawTasks, today);
    const detectedPreferences = [];
    if (!effectivePrefs.some((p) => p.category === 'stores')) {
      detectedPreferences.push({
        category: 'stores' as const,
        key: "Go-to kids & trip apparel store",
        value: chosenStore.replace(' / Old Navy Early Holiday Promo', ''),
        reason: 'Selected during trip shopping intake',
      });
    }

    return {
      workloadTitle: `Pre-Trip Shopping & Prep (Leaves ${tripDate})`,
      domain: 'shopping_trip',
      hardDeadline: tripDate,
      deadlineConfidence: explicitDate ? 'user_provided' : 'needs_check',
      verificationSummary: grounding.summaryNotes,
      groundingSources: grounding.sources,
      bufferSummary: `Online shipping cutoff set at ${shippingCutoffDate}; all items washed & packed by ${packBufferDate} ahead of ${tripDate} departure.`,
      milestones: [
        {
          date: earlySaleDate,
          label: 'Early Promotional Sale Window',
          kind: 'optimal_window',
          detail: `${chosenStore} promo window with safe ground shipping margin`,
        },
        {
          date: shippingCutoffDate,
          label: 'Last Safe Online Shipping Day',
          kind: 'cutoff',
          detail: 'Orders after this date risk missing try-on & wash time unless picked up in-store',
        },
        {
          date: packBufferDate,
          label: 'All Items Delivered & Packed Buffer',
          kind: 'safety_buffer',
          detail: 'Zero shopping or deliveries allowed in final 48h before trip',
        },
        {
          date: tripDate,
          label: 'Trip Departure',
          kind: 'hard_deadline',
          detail: 'Stress-free departure day',
        },
      ],
      proposedTasks: scheduledTasks,
      detectedPreferences,
      usedAiMode: 'local_smart_fallback',
    };
  }

  // General / Admin / Project fallback
  const targetDeadline = explicitDate || addDays(today, 10);
  const bufferDay = addDays(targetDeadline, -2);
  const needsDaytime =
    (input.answers['daytime_vs_evening'] || '').toLowerCase().includes('daytime') ||
    domainGuess === 'admin_errand';

  const shortTitle =
    input.rawDump.length > 42 ? input.rawDump.slice(0, 42).trim() + '…' : input.rawDump.trim();

  const rawTasks: Omit<ProposedTask, 'scheduledDate' | 'scheduledTime'>[] = [
    {
      tempId: 't1',
      title: `List exact requirements & gather needed info for: ${shortTitle}`,
      forWhom: 'Self',
      contextLabel: 'Quick Scoping',
      slotType: 'personal_focus',
      idealDate: today,
      latestSafeDate: addDays(today, 2),
      durationMinutes: 15,
      minWaitDays: 0,
      rationale: 'Turns vague mental clutter into a clear checklist before executing.',
      pivotOption: null,
    },
    {
      tempId: 't2',
      title: needsDaytime
        ? 'Handle daytime phone call / office check during business hours'
        : 'Complete core action block #1 (first half)',
      forWhom: 'Self',
      contextLabel: needsDaytime ? 'Weekday Business Hours' : 'Focused Step',
      slotType: needsDaytime ? 'daytime_business' : 'personal_focus',
      idealDate: addDays(today, 1),
      latestSafeDate: bufferDay,
      durationMinutes: 20,
      dependsOnTempId: 't1',
      minWaitDays: 1,
      rationale: needsDaytime
        ? 'Placed strictly inside weekday daytime hours while offices are open.'
        : 'Kept to 20 minutes to stay calm and well under your daily cap.',
      pivotOption: null,
    },
    {
      tempId: 't3',
      title: 'Wrap up final step & double-check completion',
      forWhom: 'Self',
      contextLabel: 'Final Check',
      slotType: 'personal_focus',
      idealDate: addDays(today, 3),
      latestSafeDate: bufferDay,
      durationMinutes: 15,
      dependsOnTempId: 't2',
      minWaitDays: 2,
      rationale: `Leaves a 2-day waiting gap after the previous step and finishes ahead of ${targetDeadline}.`,
      pivotOption: null,
    },
  ];

  const scheduledTasks = assignProposedTaskSlots(rawTasks, today);

  return {
    workloadTitle: shortTitle,
    domain: domainGuess,
    hardDeadline: targetDeadline,
    deadlineConfidence: explicitDate ? 'user_provided' : 'needs_check',
    verificationSummary: grounding.summaryNotes,
    groundingSources: grounding.sources,
    bufferSummary: `Scheduled across ${scheduledTasks.length} bite-sized blocks finishing by ${bufferDay} (2-day cushion before ${targetDeadline}).`,
    milestones: [
      {
        date: bufferDay,
        label: 'Calm Completion Buffer',
        kind: 'safety_buffer',
        detail: 'Everything wrapped up 48h before target date',
      },
      {
        date: targetDeadline,
        label: 'Target Deadline',
        kind: 'hard_deadline',
        detail: 'Final target date',
      },
    ],
    proposedTasks: scheduledTasks,
    detectedPreferences: [],
    usedAiMode: 'local_smart_fallback',
  };
}

/**
 * Splits a single overwhelming task into 3 tiny 5-minute micro-steps!
 */
export async function splitTaskIntoMicroSteps(
  task: TaskItem
): Promise<Array<{ title: string; durationMinutes: number; rationale: string }>> {
  const ai = getGeminiClient();
  if (ai) {
    try {
      const prompt = `Break this overwhelming task into 3 tiny, concrete 5-minute micro-steps so someone with zero momentum can start right now.
Task: "${task.title}" (For: ${task.forWhom || 'Self'}, Context: ${task.contextLabel || 'General'})
STRICT RULE: Never mention specific product names, prices, or shopping URLs.
Return ONLY JSON:
{
  "steps": [
    { "title": "5-min tiny action", "durationMinutes": 5, "rationale": "Easy zero-friction start" }
  ]
}`;
      const res = await generateWithFallback(ai, prompt, { temperature: 0.3 });
      const parsed = MicroSplitSchema.parse(extractJsonFromText(res.text || ''));
      return parsed.steps.map((s) => ({
        title: sanitizeAntiRecommendation(s.title),
        durationMinutes: s.durationMinutes,
        rationale: sanitizeAntiRecommendation(s.rationale),
      }));
    } catch (err) {
      console.warn('[splitTaskIntoMicroSteps] Fallback triggered:', err);
    }
  }

  return [
    {
      title: `Step 1 (Open & Prep): Open ${task.contextLabel || 'notes'} & list just the top 2 items for "${task.title}"`,
      durationMinutes: 5,
      rationale: 'Tiny 5-minute setup removes starting friction.',
    },
    {
      title: `Step 2 (Core Action): Do the first half of "${task.title}"`,
      durationMinutes: Math.max(5, Math.round(task.durationMinutes / 2)),
      rationale: 'Focuses on just one small piece without finishing everything at once.',
    },
    {
      title: `Step 3 (Wrap Up): Finish & confirm "${task.title}"`,
      durationMinutes: 5,
      rationale: 'Quick calm finish.',
    },
  ];
}
