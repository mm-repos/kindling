import { BackwardsMilestone, TaskItem, Workload } from '../types';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toLocalCalTimestamp(dateStr: string, timeStr: string, addMinutes = 0): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '09:00').split(':').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, hh || 9, (mm || 0) + addMinutes, 0);
  return (
    `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}` +
    `T${pad2(dt.getHours())}${pad2(dt.getMinutes())}00`
  );
}

function escapeIcsText(str: string): string {
  return (str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Generates a 1-click Google Calendar event template URL for a single micro-task.
 */
export function buildGoogleCalendarUrl(task: TaskItem): string {
  const start = toLocalCalTimestamp(task.scheduledDate, task.scheduledTime, 0);
  const end = toLocalCalTimestamp(
    task.scheduledDate,
    task.scheduledTime,
    task.durationMinutes || 15
  );

  const titlePrefix = task.forWhom ? `[${task.forWhom}] ` : '';
  const text = `${titlePrefix}${task.title}`;

  const detailsLines = [
    task.workloadTitle ? `Project: ${task.workloadTitle}` : '',
    task.contextLabel ? `Context: ${task.contextLabel}` : '',
    task.rationale ? `Why this slot: ${task.rationale}` : '',
    task.notes ? `Notes: ${task.notes}` : '',
    'Scheduled calmly with Kindling',
  ].filter(Boolean);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text,
    dates: `${start}/${end}`,
    details: detailsLines.join('\n\n'),
    location: task.contextLabel || '',
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Downloads a standards-compliant .ics file (works with Apple Calendar, Outlook, Google Calendar)
 * for one or many tasks (plus optional milestone all-day reminders).
 */
export function downloadTasksAsIcs(
  tasks: TaskItem[],
  filename = 'kindling-schedule.ics',
  milestones: BackwardsMilestone[] = [],
  workloadTitle?: string
): void {
  const dtStamp =
    new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kindling//Calm Backwards Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const t of tasks) {
    if (t.status === 'skipped') continue;
    const dtStart = toLocalCalTimestamp(t.scheduledDate, t.scheduledTime, 0);
    const dtEnd = toLocalCalTimestamp(
      t.scheduledDate,
      t.scheduledTime,
      t.durationMinutes || 15
    );
    const summary = `${t.forWhom ? `[${t.forWhom}] ` : ''}${t.title}`;
    const desc = [
      t.workloadTitle || workloadTitle ? `Workload: ${t.workloadTitle || workloadTitle}` : '',
      t.contextLabel ? `Context: ${t.contextLabel}` : '',
      t.rationale ? `Timing rationale: ${t.rationale}` : '',
      t.notes ? `Notes: ${t.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${t.id}@kindling.local`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(desc)}`,
      t.contextLabel ? `LOCATION:${escapeIcsText(t.contextLabel)}` : '',
      'BEGIN:VALARM',
      'TRIGGER:-PT10M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(summary)}`,
      'END:VALARM',
      'END:VEVENT'
    );
  }

  // Also include all-day cutoff / deadline guardrails if exporting a workload
  milestones.forEach((m, idx) => {
    const cleanDate = m.date.replace(/-/g, '');
    if (cleanDate.length === 8) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:milestone_${cleanDate}_${idx}@kindling.local`,
        `DTSTAMP:${dtStamp}`,
        `DTSTART;VALUE=DATE:${cleanDate}`,
        `SUMMARY:${escapeIcsText(`[Cutoff] ${m.label}${workloadTitle ? ` — ${workloadTitle}` : ''}`)}`,
        `DESCRIPTION:${escapeIcsText(m.detail)}`,
        'END:VEVENT'
      );
    }
  });

  lines.push('END:VCALENDAR');

  const icsBody = lines.filter(Boolean).join('\r\n');
  const blob = new Blob([icsBody], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Opens a clean, warm-paper printable layout and triggers the browser's native "Save as PDF" dialog.
 */
export function exportScheduleToPdf(options: {
  title: string;
  subtitle?: string;
  workloads?: Workload[];
  tasks: TaskItem[];
}): void {
  const { title, subtitle, workloads = [], tasks } = options;
  const activeTasks = tasks
    .filter((t) => t.status !== 'skipped')
    .sort((a, b) =>
      `${a.scheduledDate}${a.scheduledTime}`.localeCompare(
        `${b.scheduledDate}${b.scheduledTime}`
      )
    );

  // Group tasks by scheduledDate
  const byDate = new Map<string, TaskItem[]>();
  for (const t of activeTasks) {
    const arr = byDate.get(t.scheduledDate) || [];
    arr.push(t);
    byDate.set(t.scheduledDate, arr);
  }

  const workloadsHtml =
    workloads.length > 0
      ? `
    <section class="block">
      <h2>Backwards Cutoffs &amp; Safety Buffers</h2>
      ${workloads
        .map(
          (w) => `
        <div class="wk-card">
          <div class="wk-head">
            <strong>${escapeHtml(w.title)}</strong>
            ${w.hardDeadline ? `<span class="pill">Deadline: ${escapeHtml(w.hardDeadline)}</span>` : ''}
          </div>
          ${w.verificationNotes ? `<p class="muted">${escapeHtml(w.verificationNotes)}</p>` : ''}
          ${w.bufferSummary ? `<p class="sage"><strong>Buffers:</strong> ${escapeHtml(w.bufferSummary)}</p>` : ''}
          ${
            w.milestones && w.milestones.length > 0
              ? `<div class="ms-grid">
                  ${w.milestones
                    .map(
                      (m) => `
                    <div class="ms-item">
                      <div class="ms-date">${escapeHtml(m.date)}</div>
                      <div class="ms-label">${escapeHtml(m.label)}</div>
                      <div class="ms-detail">${escapeHtml(m.detail)}</div>
                    </div>`
                    )
                    .join('')}
                 </div>`
              : ''
          }
        </div>`
        )
        .join('')}
    </section>`
      : '';

  const datesHtml = Array.from(byDate.entries())
    .map(([date, dayTasks]) => {
      const totalMins = dayTasks.reduce((s, t) => s + t.durationMinutes, 0);
      return `
      <div class="day-group">
        <div class="day-header">
          <span>${escapeHtml(date)}</span>
          <span class="day-mins">${totalMins} mins total</span>
        </div>
        ${dayTasks
          .map(
            (t) => `
          <div class="task-row ${t.status === 'done' ? 'done' : ''}">
            <div class="checkbox">${t.status === 'done' ? '✓' : ''}</div>
            <div class="task-body">
              <div class="task-top">
                <strong>${escapeHtml(t.title)}</strong>
                <span class="time-tag">${escapeHtml(t.scheduledTime)} • ${t.durationMinutes}m</span>
              </div>
              <div class="meta">
                ${t.workloadTitle ? `<span>${escapeHtml(t.workloadTitle)}</span>` : ''}
                ${t.forWhom ? `<span>For: ${escapeHtml(t.forWhom)}</span>` : ''}
                ${t.contextLabel ? `<span>${escapeHtml(t.contextLabel)}</span>` : ''}
              </div>
              ${t.rationale ? `<div class="rationale">${escapeHtml(t.rationale)}</div>` : ''}
            </div>
          </div>`
          )
          .join('')}
      </div>`;
    })
    .join('');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} — Kindling PDF</title>
  <style>
    @page { margin: 18mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #262420;
      background: #ffffff;
      line-height: 1.5;
      margin: 0;
      padding: 0;
    }
    header {
      border-bottom: 2px solid #e6dfd3;
      padding-bottom: 14px;
      margin-bottom: 22px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    h1 { font-family: Georgia, serif; font-weight: normal; font-size: 26px; margin: 0 0 4px; }
    h2 { font-family: Georgia, serif; font-weight: normal; font-size: 19px; margin: 0 0 10px; color: #456858; }
    .sub { font-size: 12px; color: #686359; margin: 0; }
    .block { margin-bottom: 24px; }
    .wk-card {
      border: 1px solid #e6dfd3;
      background: #faf7f2;
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 12px;
      page-break-inside: avoid;
    }
    .wk-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .pill { font-size: 11px; background: #e7efea; color: #456858; padding: 2px 8px; border-radius: 99px; }
    .muted { font-size: 12px; color: #686359; margin: 4px 0; }
    .sage { font-size: 12px; color: #456858; margin: 4px 0; }
    .ms-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; }
    .ms-item { background: #fff; border: 1px solid #e6dfd3; border-radius: 6px; padding: 7px 9px; }
    .ms-date { font-size: 10px; font-weight: 600; color: #686359; }
    .ms-label { font-size: 12px; font-weight: 600; }
    .ms-detail { font-size: 10.5px; color: #686359; }
    .day-group { margin-bottom: 18px; page-break-inside: avoid; }
    .day-header {
      background: #f2ede4;
      padding: 6px 12px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 13px;
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .day-mins { color: #456858; font-weight: 500; }
    .task-row {
      display: flex;
      gap: 10px;
      padding: 9px 6px;
      border-bottom: 1px solid #eee8dd;
      page-break-inside: avoid;
    }
    .task-row.done strong { text-decoration: line-through; color: #938d81; }
    .checkbox {
      width: 16px;
      height: 16px;
      border: 1.5px solid #8c8578;
      border-radius: 4px;
      margin-top: 2px;
      text-align: center;
      font-size: 12px;
      line-height: 15px;
      flex-shrink: 0;
    }
    .task-body { flex: 1; }
    .task-top { display: flex; justify-content: space-between; gap: 12px; font-size: 13.5px; }
    .time-tag { font-size: 11.5px; color: #456858; font-weight: 600; white-space: nowrap; }
    .meta { display: flex; gap: 10px; font-size: 11px; color: #686359; margin-top: 2px; }
    .rationale { font-size: 11.5px; color: #686359; margin-top: 4px; border-left: 2px solid #c5d9cd; padding-left: 8px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(title)}</h1>
      <p class="sub">${escapeHtml(subtitle || 'Kindling — Calm Backwards Schedule & Micro-Steps')}</p>
    </div>
    <div class="sub">Printed ${escapeHtml(new Date().toLocaleDateString())}</div>
  </header>
  ${workloadsHtml}
  <section class="block">
    <h2>Timed Micro-Task Schedule (${activeTasks.length} steps)</h2>
    ${datesHtml || '<p class="muted">No scheduled steps yet.</p>'}
  </section>
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 200);
    };
  </script>
</body>
</html>`;

  const printWin = window.open('', '_blank', 'width=860,height=900');
  if (!printWin) {
    alert('Please allow pop-ups for localhost to open the clean PDF print view.');
    return;
  }
  printWin.document.open();
  printWin.document.write(html);
  printWin.document.close();
}
