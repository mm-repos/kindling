import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getAllPreferences,
  getAllTasks,
  getAllWorkloads,
  getSettings,
  initDb,
  makeId,
  mapTaskRow,
  queryOne,
  runSql,
  upsertPreference,
} from './db.js';
import { generateIntakeQuestions } from './gemini/intakeAgent.js';
import {
  buildWorkbackGameplan,
  splitTaskIntoMicroSteps,
} from './gemini/workbackPlanner.js';
import { sanitizeAntiRecommendation } from './gemini/guardrails.js';
import {
  assignProposedTaskSlots,
  getTodayStr,
  rebalanceOverdueTasks,
} from './scheduler/capacityScheduler.js';
import {
  DetectedPreference,
  GameplanProposal,
  PreferenceCategory,
  SlotType,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  const settings = getSettings();
  res.json({
    ok: true,
    today: getTodayStr(),
    hasGeminiKey: settings.hasEnvKey,
  });
});

// Settings CRUD
app.get('/api/settings', (_req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', (req, res) => {
  const { geminiApiKey, dailyCapMinutes, focusWindows, businessWindows, homeLocationHint } =
    req.body || {};

  if (typeof geminiApiKey === 'string' && !geminiApiKey.startsWith('••••')) {
    runSql(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['gemini_api_key', geminiApiKey.trim()]
    );
  }
  if (typeof dailyCapMinutes === 'number' && dailyCapMinutes >= 15 && dailyCapMinutes <= 360) {
    runSql(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['daily_cap_minutes', String(Math.round(dailyCapMinutes))]
    );
  }
  if (Array.isArray(focusWindows)) {
    runSql(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['focus_windows_json', JSON.stringify(focusWindows)]
    );
  }
  if (Array.isArray(businessWindows)) {
    runSql(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['business_windows_json', JSON.stringify(businessWindows)]
    );
  }
  if (typeof homeLocationHint === 'string') {
    runSql(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['home_location_hint', homeLocationHint.trim()]
    );
  }

  res.json(getSettings());
});

// Preferences Memory Vault CRUD
app.get('/api/preferences', (_req, res) => {
  res.json(getAllPreferences());
});

app.post('/api/preferences', (req, res) => {
  const { category, key, value } = req.body || {};
  if (!key || !value) {
    res.status(400).json({ error: 'Both key and value are required.' });
    return;
  }
  const saved = upsertPreference(
    (category as PreferenceCategory) || 'general',
    sanitizeAntiRecommendation(String(key)),
    sanitizeAntiRecommendation(String(value))
  );
  res.json(saved);
});

app.delete('/api/preferences/:id', (req, res) => {
  runSql('DELETE FROM preferences WHERE id = ?', [req.params.id]);
  res.json({ deleted: true });
});

// Workloads & Intake Flow
app.get('/api/workloads', (_req, res) => {
  res.json(getAllWorkloads());
});

app.delete('/api/workloads/:id', (req, res) => {
  runSql('DELETE FROM tasks WHERE workload_id = ?', [req.params.id]);
  runSql('DELETE FROM workloads WHERE id = ?', [req.params.id]);
  res.json({ deleted: true });
});

// Step 1 of Brain-Dump: Generate 1-3 Guided Question Cards
app.post('/api/intake/questions', async (req, res) => {
  try {
    const { rawDump, projectOverrides = {}, previousAnswers } = req.body || {};
    if (!rawDump || !String(rawDump).trim()) {
      res.status(400).json({ error: 'Please enter or speak what is on your mind.' });
      return;
    }

    const prefs = getAllPreferences();
    const result = await generateIntakeQuestions({
      rawDump: String(rawDump).trim(),
      appliedPreferences: prefs,
      projectOverrides,
      previousAnswers,
    });

    res.json(result);
  } catch (err) {
    console.error('[POST /api/intake/questions]', err);
    res.status(500).json({ error: 'Failed to generate clarifying questions.' });
  }
});

// Step 2 of Brain-Dump: Verify External Deadlines/Sales & Build Gameplan Preview
app.post('/api/intake/preview', async (req, res) => {
  try {
    const { rawDump, domain, answers = {}, projectOverrides = {} } = req.body || {};
    if (!rawDump || !String(rawDump).trim()) {
      res.status(400).json({ error: 'Missing brain-dump text.' });
      return;
    }

    const prefs = getAllPreferences();
    const proposal = await buildWorkbackGameplan({
      rawDump: String(rawDump).trim(),
      domain,
      answers,
      appliedPreferences: prefs,
      projectOverrides,
    });

    res.json(proposal);
  } catch (err) {
    console.error('[POST /api/intake/preview]', err);
    res.status(500).json({ error: 'Failed to generate backwards gameplan.' });
  }
});

// Step 3: Commit Approved Gameplan Preview (+ Checked New Preferences) into Live Schedule
app.post('/api/workloads/commit', (req, res) => {
  try {
    const {
      rawDump,
      projectOverrides = {},
      proposal,
      approvedPreferences = [],
    }: {
      rawDump: string;
      projectOverrides: Record<string, string>;
      proposal: GameplanProposal;
      approvedPreferences: DetectedPreference[];
    } = req.body;

    if (!proposal || !Array.isArray(proposal.proposedTasks)) {
      res.status(400).json({ error: 'Invalid proposal payload.' });
      return;
    }

    const workloadId = makeId('wk');
    const now = new Date().toISOString();

    runSql(
      `INSERT INTO workloads (
        id, title, raw_dump, domain, hard_deadline, deadline_confidence,
        verification_notes, buffer_summary, milestones_json, project_overrides_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
      [
        workloadId,
        sanitizeAntiRecommendation(proposal.workloadTitle),
        String(rawDump || proposal.workloadTitle),
        proposal.domain,
        proposal.hardDeadline || null,
        proposal.deadlineConfidence || 'user_provided',
        sanitizeAntiRecommendation(proposal.verificationSummary || ''),
        sanitizeAntiRecommendation(proposal.bufferSummary || ''),
        JSON.stringify(proposal.milestones || []),
        JSON.stringify(projectOverrides || {}),
        now,
      ]
    );

    // Map tempId -> real taskId so depends_on_task_id links remain intact
    const tempToRealId: Record<string, string> = {};
    for (const pt of proposal.proposedTasks) {
      tempToRealId[pt.tempId] = makeId('tsk');
    }

    for (const pt of proposal.proposedTasks) {
      const taskId = tempToRealId[pt.tempId];
      const depRealId =
        pt.dependsOnTempId && tempToRealId[pt.dependsOnTempId]
          ? tempToRealId[pt.dependsOnTempId]
          : null;

      runSql(
        `INSERT INTO tasks (
          id, workload_id, parent_task_id, depends_on_task_id, min_wait_days,
          slot_type, title, for_whom, context_label, scheduled_date, scheduled_time,
          latest_safe_date, duration_minutes, rationale, pivot_option_json,
          cutoff_warning, status, notes, created_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', '', ?)`,
        [
          taskId,
          workloadId,
          depRealId,
          pt.minWaitDays || 0,
          pt.slotType || 'personal_focus',
          sanitizeAntiRecommendation(pt.title),
          sanitizeAntiRecommendation(pt.forWhom || ''),
          sanitizeAntiRecommendation(pt.contextLabel || ''),
          pt.scheduledDate,
          pt.scheduledTime,
          pt.latestSafeDate || null,
          pt.durationMinutes || 15,
          sanitizeAntiRecommendation(pt.rationale || ''),
          pt.pivotOption ? JSON.stringify(pt.pivotOption) : null,
          now,
        ]
      );
    }

    // Save only the preferences explicitly checked by the user in Gameplan Preview
    for (const pref of approvedPreferences) {
      if (pref.key && pref.value) {
        upsertPreference(pref.category, pref.key, pref.value);
      }
    }

    res.json({
      workloadId,
      tasks: getAllTasks(),
      workloads: getAllWorkloads(),
      preferences: getAllPreferences(),
    });
  } catch (err) {
    console.error('[POST /api/workloads/commit]', err);
    res.status(500).json({ error: 'Failed to commit gameplan.' });
  }
});

// Tasks Endpoints (List + Auto-Rebalance, Quick 1-Line Task, Complete + Follow-Up Jot, 5-Min Split, Pivot Toggle)
app.get('/api/tasks', (_req, res) => {
  const rebalanceInfo = rebalanceOverdueTasks();
  res.json({
    today: getTodayStr(),
    tasks: getAllTasks(),
    rebalanced: rebalanceInfo,
  });
});

// 1-Line Quick Standalone Task (shares Global Daily Cap & Business-Hours rules!)
app.post('/api/tasks/quick', (req, res) => {
  const { title, dueDate, durationMinutes = 15, slotType } = req.body || {};
  if (!title || !String(title).trim()) {
    res.status(400).json({ error: 'Task title is required.' });
    return;
  }

  const cleanTitle = sanitizeAntiRecommendation(String(title).trim());
  const lower = cleanTitle.toLowerCase();
  const inferredSlot: SlotType =
    slotType ||
    (/\b(call|doctor|dentist|office|bank|post office|dmv|pediatrician|drop off)\b/.test(lower)
      ? 'daytime_business'
      : 'personal_focus');

  const today = getTodayStr();
  const assigned = assignProposedTaskSlots(
    [
      {
        tempId: 'quick_1',
        title: cleanTitle,
        forWhom: 'Self',
        contextLabel: inferredSlot === 'daytime_business' ? 'Daytime Errand/Call' : 'Quick Task',
        slotType: inferredSlot,
        idealDate: today,
        latestSafeDate: dueDate || today,
        durationMinutes: Math.min(35, Math.max(5, Number(durationMinutes) || 15)),
        minWaitDays: 0,
        rationale:
          inferredSlot === 'daytime_business'
            ? 'Scheduled in a weekday daytime business window within your daily cap.'
            : 'Placed in your next open calm focus window within your daily cap.',
        pivotOption: null,
      },
    ],
    today
  )[0];

  const id = makeId('tsk');
  const now = new Date().toISOString();
  runSql(
    `INSERT INTO tasks (
      id, workload_id, parent_task_id, depends_on_task_id, min_wait_days,
      slot_type, title, for_whom, context_label, scheduled_date, scheduled_time,
      latest_safe_date, duration_minutes, rationale, pivot_option_json,
      cutoff_warning, status, notes, created_at
    ) VALUES (?, NULL, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'pending', '', ?)`,
    [
      id,
      assigned.slotType,
      assigned.title,
      assigned.forWhom,
      assigned.contextLabel,
      assigned.scheduledDate,
      assigned.scheduledTime,
      dueDate || null,
      assigned.durationMinutes,
      assigned.rationale,
      now,
    ]
  );

  const created = queryOne<Record<string, unknown>>('SELECT * FROM tasks WHERE id = ?', [id]);
  res.json(created ? mapTaskRow(created) : null);
});

// Update task status / notes + Optional "Follow-Up Jot" auto-scheduling
app.patch('/api/tasks/:id', (req, res) => {
  const row = queryOne<Record<string, unknown>>('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  if (!row) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }
  const existing = mapTaskRow(row);
  const { status, notes, scheduledDate, scheduledTime, followUpJot } = req.body || {};

  const nextStatus = status || existing.status;
  const nextNotes = notes !== undefined ? String(notes) : existing.notes;
  const nextDate = scheduledDate || existing.scheduledDate;
  const nextTime = scheduledTime || existing.scheduledTime;

  runSql(
    'UPDATE tasks SET status = ?, notes = ?, scheduled_date = ?, scheduled_time = ? WHERE id = ?',
    [nextStatus, nextNotes, nextDate, nextTime, existing.id]
  );

  let followUpTask = null;
  if (followUpJot && String(followUpJot).trim()) {
    const jotClean = sanitizeAntiRecommendation(String(followUpJot).trim());
    const needsDaytime = /\b(call|doctor|pediatrician|office|pickup|store|bank)\b/i.test(jotClean);
    const today = getTodayStr();
    const assigned = assignProposedTaskSlots(
      [
        {
          tempId: 'jot_1',
          title: jotClean,
          forWhom: existing.forWhom,
          contextLabel: existing.contextLabel || 'Follow-Up',
          slotType: needsDaytime ? 'daytime_business' : 'personal_focus',
          idealDate: today,
          latestSafeDate: existing.latestSafeDate || today,
          durationMinutes: 10,
          minWaitDays: 0,
          rationale: `Follow-up jotted while finishing "${existing.title}".`,
          pivotOption: null,
        },
      ],
      today
    )[0];

    const fId = makeId('tsk');
    const now = new Date().toISOString();
    runSql(
      `INSERT INTO tasks (
        id, workload_id, parent_task_id, depends_on_task_id, min_wait_days,
        slot_type, title, for_whom, context_label, scheduled_date, scheduled_time,
        latest_safe_date, duration_minutes, rationale, pivot_option_json,
        cutoff_warning, status, notes, created_at
      ) VALUES (?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'pending', '', ?)`,
      [
        fId,
        existing.workloadId,
        existing.id,
        assigned.slotType,
        assigned.title,
        assigned.forWhom,
        assigned.contextLabel,
        assigned.scheduledDate,
        assigned.scheduledTime,
        existing.latestSafeDate,
        assigned.durationMinutes,
        assigned.rationale,
        now,
      ]
    );
    const fRow = queryOne<Record<string, unknown>>('SELECT * FROM tasks WHERE id = ?', [fId]);
    if (fRow) followUpTask = mapTaskRow(fRow);
  }

  // Check if all tasks in workload are done
  if (existing.workloadId) {
    const remaining = queryOne<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM tasks WHERE workload_id = ? AND status = 'pending'",
      [existing.workloadId]
    );
    runSql('UPDATE workloads SET status = ? WHERE id = ?', [
      remaining && remaining.cnt === 0 ? 'completed' : 'scheduled',
      existing.workloadId,
    ]);
  }

  res.json({ tasks: getAllTasks(), followUpTask });
});

// 1-Click Pivot Toggle (e.g., Switch Late Sale to In-Store Pickup or Backup Registration Option)
app.post('/api/tasks/:id/pivot', (req, res) => {
  const row = queryOne<Record<string, unknown>>('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  if (!row) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }
  const task = mapTaskRow(row);
  if (!task.pivotOption) {
    res.status(400).json({ error: 'No pivot option on this task.' });
    return;
  }

  const pivot = task.pivotOption;
  // Store reverse pivot so user can toggle back if desired!
  const reversePivot = {
    label: pivot.applied
      ? pivot.label
      : `Revert to earlier safe slot (${task.scheduledDate})`,
    newDate: task.scheduledDate,
    newTime: task.scheduledTime,
    newContextLabel: task.contextLabel,
    newRationale: task.rationale,
    applied: !pivot.applied,
  };

  runSql(
    `UPDATE tasks
     SET scheduled_date = ?, scheduled_time = ?, context_label = ?, rationale = ?, pivot_option_json = ?
     WHERE id = ?`,
    [
      pivot.newDate,
      pivot.newTime || task.scheduledTime,
      pivot.newContextLabel || task.contextLabel,
      pivot.newRationale,
      JSON.stringify(reversePivot),
      task.id,
    ]
  );

  res.json({ tasks: getAllTasks() });
});

// 1-Click "Still Too Big? Break Into 5-Min Steps" Splitter
app.post('/api/tasks/:id/split', async (req, res) => {
  try {
    const row = queryOne<Record<string, unknown>>('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!row) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }
    const task = mapTaskRow(row);
    const microSteps = await splitTaskIntoMicroSteps(task);
    const today = getTodayStr();

    const rawMicro = microSteps.map((s, idx) => ({
      tempId: `split_${idx}`,
      title: s.title,
      forWhom: task.forWhom,
      contextLabel: task.contextLabel,
      slotType: task.slotType === 'pinned_exact' ? ('personal_focus' as const) : task.slotType,
      idealDate: task.scheduledDate >= today ? task.scheduledDate : today,
      latestSafeDate: task.latestSafeDate || task.scheduledDate,
      durationMinutes: s.durationMinutes,
      minWaitDays: 0,
      rationale: s.rationale,
      pivotOption: null,
    }));

    // Remove original big task from pending before slotting micro-steps
    runSql("UPDATE tasks SET status = 'skipped', notes = 'Split into 5-minute micro-steps' WHERE id = ?", [
      task.id,
    ]);

    const assigned = assignProposedTaskSlots(rawMicro, today);
    const now = new Date().toISOString();

    for (const sub of assigned) {
      runSql(
        `INSERT INTO tasks (
          id, workload_id, parent_task_id, depends_on_task_id, min_wait_days,
          slot_type, title, for_whom, context_label, scheduled_date, scheduled_time,
          latest_safe_date, duration_minutes, rationale, pivot_option_json,
          cutoff_warning, status, notes, created_at
        ) VALUES (?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'pending', '', ?)`,
        [
          makeId('tsk'),
          task.workloadId,
          task.id,
          sub.slotType,
          sub.title,
          sub.forWhom,
          sub.contextLabel,
          sub.scheduledDate,
          sub.scheduledTime,
          task.latestSafeDate,
          sub.durationMinutes,
          sub.rationale,
          now,
        ]
      );
    }

    res.json({ tasks: getAllTasks() });
  } catch (err) {
    console.error('[POST /api/tasks/:id/split]', err);
    res.status(500).json({ error: 'Failed to split task.' });
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  runSql('DELETE FROM tasks WHERE id = ?', [req.params.id]);
  res.json({ tasks: getAllTasks() });
});

// Trigger manual rebalance or simulate overdue test
app.post('/api/tasks/rebalance', (_req, res) => {
  const info = rebalanceOverdueTasks();
  res.json({ tasks: getAllTasks(), rebalanced: info });
});

const PORT = Number(process.env.PORT || 3001);

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Kindling server listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize SQLite database:', err);
    process.exit(1);
  });
