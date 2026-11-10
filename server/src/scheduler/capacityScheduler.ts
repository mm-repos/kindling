import {
  getAllTasks,
  getSettings,
  runSql,
} from '../db.js';
import { ProposedTask, SlotType, TaskItem, TimeWindow } from '../types.js';

export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

export function addDays(dateStr: string, days: number): string {
  const dt = parseLocalDate(dateStr);
  dt.setDate(dt.getDate() + days);
  return formatLocalDate(dt);
}

export function getTodayStr(): string {
  return formatLocalDate(new Date());
}

function addMinutesToTime(hhmm: string, minsToAdd: number): string {
  const [hh, mm] = hhmm.split(':').map(Number);
  const total = (hh || 0) * 60 + (mm || 0) + minsToAdd;
  const outH = Math.floor((total % 1440) / 60);
  const outM = total % 60;
  return `${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`;
}

function pickMatchingWindow(dateStr: string, slotType: SlotType, focusWindows: TimeWindow[], businessWindows: TimeWindow[]): TimeWindow | null {
  const dt = parseLocalDate(dateStr);
  const dow = dt.getDay();
  const pool = slotType === 'daytime_business' ? businessWindows : focusWindows;
  const match = pool.find((w) => w.days.includes(dow));
  return match || null;
}

/**
 * Assigns concrete, conflict-free dates & start times to a list of proposed tasks
 * while respecting:
 * 1. Global Daily Cap (minutes per day across existing + new tasks)
 * 2. Slot Type (daytime_business M-F vs personal_focus evenings/weekends vs pinned_exact)
 * 3. Wait-Gaps (dependsOnTempId + minWaitDays)
 * 4. Latest safe cutoff dates
 */
export function assignProposedTaskSlots(
  rawTasks: Omit<ProposedTask, 'scheduledDate' | 'scheduledTime'>[],
  todayOverride?: string
): ProposedTask[] {
  const today = todayOverride || getTodayStr();
  const settings = getSettings();
  const existingTasks = getAllTasks().filter((t) => t.status === 'pending');

  // Track minutes booked per YYYY-MM-DD and minutes offset inside slot
  const minutesByDate: Record<string, number> = {};
  for (const t of existingTasks) {
    minutesByDate[t.scheduledDate] = (minutesByDate[t.scheduledDate] || 0) + t.durationMinutes;
  }

  const assignedByTempId: Record<string, ProposedTask> = {};
  const result: ProposedTask[] = [];

  for (const item of rawTasks) {
    // 1. Pinned exact date/time (e.g. class registration opens Tuesday at 08:00 AM)
    if (item.slotType === 'pinned_exact') {
      const pinnedDate = item.idealDate >= today ? item.idealDate : today;
      const pinnedTime = item.pinnedTime || '09:00';
      minutesByDate[pinnedDate] = (minutesByDate[pinnedDate] || 0) + item.durationMinutes;
      const assigned: ProposedTask = {
        ...item,
        scheduledDate: pinnedDate,
        scheduledTime: pinnedTime,
      };
      assignedByTempId[item.tempId] = assigned;
      result.push(assigned);
      continue;
    }

    // 2. Compute earliest allowed date respecting today AND dependency wait-gap
    let earliestDate = item.idealDate >= today ? item.idealDate : today;
    if (item.dependsOnTempId && assignedByTempId[item.dependsOnTempId]) {
      const depDate = assignedByTempId[item.dependsOnTempId].scheduledDate;
      const afterWait = addDays(depDate, Math.max(0, item.minWaitDays || 0));
      if (afterWait > earliestDate) {
        earliestDate = afterWait;
      }
    }

    // Search forward up to 45 days for a day that matches slotType AND fits Global Daily Cap
    let chosenDate = '';
    let chosenTime = '';

    for (let offset = 0; offset <= 45; offset++) {
      const candidateDate = addDays(earliestDate, offset);
      const win = pickMatchingWindow(
        candidateDate,
        item.slotType,
        settings.focusWindows,
        settings.businessWindows
      );
      if (!win) continue;

      const used = minutesByDate[candidateDate] || 0;
      if (used + item.durationMinutes <= settings.dailyCapMinutes) {
        chosenDate = candidateDate;
        chosenTime = addMinutesToTime(win.startTime, used);
        break;
      }
    }

    // Fallback if every day up to latestSafeDate was capped: pick earliest valid window day anyway
    if (!chosenDate) {
      for (let offset = 0; offset <= 14; offset++) {
        const candidateDate = addDays(earliestDate, offset);
        const win = pickMatchingWindow(
          candidateDate,
          item.slotType,
          settings.focusWindows,
          settings.businessWindows
        );
        if (win) {
          const used = minutesByDate[candidateDate] || 0;
          chosenDate = candidateDate;
          chosenTime = addMinutesToTime(win.startTime, used % 60);
          break;
        }
      }
    }

    if (!chosenDate) {
      chosenDate = earliestDate;
      chosenTime = item.slotType === 'daytime_business' ? '12:15' : '19:30';
    }

    // If chosenDate drifted past latestSafeDate, try pulling earlier (between today and latestSafeDate) if any valid window has room
    if (item.latestSafeDate && chosenDate > item.latestSafeDate && item.latestSafeDate >= today) {
      let minFloor = today;
      if (item.dependsOnTempId && assignedByTempId[item.dependsOnTempId]) {
        const afterWait = addDays(
          assignedByTempId[item.dependsOnTempId].scheduledDate,
          Math.max(0, item.minWaitDays || 0)
        );
        if (afterWait > minFloor) minFloor = afterWait;
      }
      for (let offset = 0; offset <= 30; offset++) {
        const tryDate = addDays(minFloor, offset);
        if (tryDate > item.latestSafeDate) break;
        const win = pickMatchingWindow(
          tryDate,
          item.slotType,
          settings.focusWindows,
          settings.businessWindows
        );
        if (!win) continue;
        const used = minutesByDate[tryDate] || 0;
        if (used + item.durationMinutes <= settings.dailyCapMinutes) {
          chosenDate = tryDate;
          chosenTime = addMinutesToTime(win.startTime, used);
          break;
        }
      }
    }

    minutesByDate[chosenDate] = (minutesByDate[chosenDate] || 0) + item.durationMinutes;
    const assigned: ProposedTask = {
      ...item,
      scheduledDate: chosenDate,
      scheduledTime: chosenTime,
    };
    assignedByTempId[item.tempId] = assigned;
    result.push(assigned);
  }

  return result;
}

/**
 * Smart Auto-Rebalance:
 * Slides any overdue pending non-pinned tasks into the next open personal/business window
 * respecting Global Daily Cap, cascades wait-gaps on dependent tasks, and flags cutoffWarning
 * ONLY if a real shipping/registration/deadline cutoff gets squeezed.
 */
export function rebalanceOverdueTasks(todayOverride?: string): {
  movedCount: number;
  warningsCount: number;
  movedTasks: TaskItem[];
} {
  const today = todayOverride || getTodayStr();
  const settings = getSettings();
  const allPending = getAllTasks().filter((t) => t.status === 'pending');

  const overdue = allPending.filter(
    (t) => t.scheduledDate < today && t.slotType !== 'pinned_exact'
  );
  if (overdue.length === 0) {
    return { movedCount: 0, warningsCount: 0, movedTasks: [] };
  }

  const overdueIds = new Set(overdue.map((t) => t.id));
  const minutesByDate: Record<string, number> = {};
  for (const t of allPending) {
    if (!overdueIds.has(t.id) && t.scheduledDate >= today) {
      minutesByDate[t.scheduledDate] = (minutesByDate[t.scheduledDate] || 0) + t.durationMinutes;
    }
  }

  const updatedDates: Record<string, string> = {};
  for (const t of allPending) {
    updatedDates[t.id] = t.scheduledDate;
  }

  let movedCount = 0;
  let warningsCount = 0;

  // Process all pending tasks in chronological order so dependencies cascade cleanly
  for (const task of allPending) {
    let minAllowedDate = task.scheduledDate;
    let needsMove = overdueIds.has(task.id);

    if (needsMove && minAllowedDate < today) {
      minAllowedDate = today;
    }

    if (task.dependsOnTaskId && updatedDates[task.dependsOnTaskId]) {
      const depDate = updatedDates[task.dependsOnTaskId];
      const afterWait = addDays(depDate, Math.max(0, task.minWaitDays || 0));
      if (afterWait > minAllowedDate) {
        minAllowedDate = afterWait;
        if (task.slotType !== 'pinned_exact') {
          needsMove = true;
        }
      }
    }

    if (!needsMove) continue;

    // Subtract old date usage if it was >= today and not in overdueIds
    if (!overdueIds.has(task.id) && task.scheduledDate >= today) {
      minutesByDate[task.scheduledDate] = Math.max(
        0,
        (minutesByDate[task.scheduledDate] || 0) - task.durationMinutes
      );
    }

    let chosenDate = minAllowedDate;
    let chosenTime = task.scheduledTime;

    for (let offset = 0; offset <= 45; offset++) {
      const candidate = addDays(minAllowedDate, offset);
      const win = pickMatchingWindow(
        candidate,
        task.slotType,
        settings.focusWindows,
        settings.businessWindows
      );
      if (!win) continue;
      const used = minutesByDate[candidate] || 0;
      if (used + task.durationMinutes <= settings.dailyCapMinutes) {
        chosenDate = candidate;
        chosenTime = addMinutesToTime(win.startTime, used);
        break;
      }
    }

    minutesByDate[chosenDate] = (minutesByDate[chosenDate] || 0) + task.durationMinutes;
    updatedDates[task.id] = chosenDate;

    const cutoffWarn = Boolean(task.latestSafeDate && chosenDate > task.latestSafeDate);
    if (cutoffWarn) warningsCount++;

    runSql(
      'UPDATE tasks SET scheduled_date = ?, scheduled_time = ?, cutoff_warning = ? WHERE id = ?',
      [chosenDate, chosenTime, cutoffWarn ? 1 : 0, task.id]
    );
    movedCount++;
  }

  const refreshed = getAllTasks().filter((t) => overdueIds.has(t.id));
  return { movedCount, warningsCount, movedTasks: refreshed };
}
