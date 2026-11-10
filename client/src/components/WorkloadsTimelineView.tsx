import React from 'react';
import { Calendar, CalendarPlus, CheckCircle2, FileText, Globe, Play, Trash2 } from 'lucide-react';
import { TaskItem, Workload } from '../types';
import { downloadTasksAsIcs, exportScheduleToPdf } from '../utils/exportSchedule';

interface WorkloadsTimelineViewProps {
  workloads: Workload[];
  tasks: TaskItem[];
  onDeleteWorkload: (id: string) => void;
  onStartFocus: (task: TaskItem) => void;
  onToggleDone: (task: TaskItem) => void;
}

export const WorkloadsTimelineView: React.FC<WorkloadsTimelineViewProps> = ({
  workloads,
  tasks,
  onDeleteWorkload,
  onStartFocus,
  onToggleDone,
}) => {
  if (workloads.length === 0) {
    return (
      <div className="calm-empty">
        <h2>No active backwards timelines yet.</h2>
        <p>
          Whenever you split a big project, class registration, or trip prep with Kindling, its
          verified cutoffs, buffers, and timed steps appear here.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {workloads.map((w) => {
        const wTasks = tasks.filter((t) => t.workloadId === w.id && t.status !== 'skipped');
        const doneCount = wTasks.filter((t) => t.status === 'done').length;
        const pct = wTasks.length > 0 ? Math.round((doneCount / wTasks.length) * 100) : 0;

        return (
          <div
            key={w.id}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--radius-lg)',
              padding: '22px 24px',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 14,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: '1.65rem' }}>{w.title}</h2>
                  <span
                    className={`badge ${
                      w.deadlineConfidence === 'verified_web'
                        ? 'sage'
                        : w.deadlineConfidence === 'needs_check'
                        ? 'amber'
                        : 'blue'
                    }`}
                  >
                    <Globe size={12} />
                    {w.deadlineConfidence === 'verified_web'
                      ? 'Verified Deadline'
                      : w.deadlineConfidence === 'needs_check'
                      ? 'Day-1 Cutoff Check'
                      : 'Target Date Set'}
                  </span>
                  {w.hardDeadline && (
                    <span className="badge">
                      <Calendar size={12} /> Anchor: {w.hardDeadline}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: '0.84rem',
                    color: 'var(--text-secondary)',
                    marginTop: 6,
                    maxWidth: 680,
                  }}
                >
                  {w.verificationNotes}
                </div>
                {w.bufferSummary && (
                  <div style={{ fontSize: '0.81rem', color: 'var(--sage)', marginTop: 4 }}>
                    <strong>Buffer Rule:</strong> {w.bufferSummary}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="badge sage">
                  <CheckCircle2 size={12} /> {doneCount}/{wTasks.length} steps ({pct}%)
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '5px 11px', fontSize: '0.77rem' }}
                  onClick={() =>
                    downloadTasksAsIcs(
                      wTasks,
                      `${w.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`,
                      w.milestones,
                      w.title
                    )
                  }
                  title="Download all steps & cutoffs as an .ics file for Apple/Outlook/Google Calendar"
                >
                  <CalendarPlus size={13} /> Calendar (.ics)
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '5px 11px', fontSize: '0.77rem' }}
                  onClick={() =>
                    exportScheduleToPdf({
                      title: w.title,
                      subtitle: w.bufferSummary || 'Backwards Gameplan & Timed Micro-Steps',
                      workloads: [w],
                      tasks: wTasks,
                    })
                  }
                  title="Print or Save this project gameplan as PDF"
                >
                  <FileText size={13} /> Save PDF
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => onDeleteWorkload(w.id)}
                  title="Remove workload"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            {w.milestones && w.milestones.length > 0 && (
              <div className="milestones-strip" style={{ marginTop: 16 }}>
                {w.milestones.map((m, idx) => (
                  <div key={idx} className={`milestone-box ${m.kind}`}>
                    <div style={{ fontSize: '0.73rem', fontWeight: 600 }}>{m.date}</div>
                    <div style={{ fontSize: '0.86rem', fontWeight: 600, margin: '2px 0' }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                      {m.detail}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="task-list" style={{ marginTop: 14 }}>
              {wTasks.map((t) => (
                <div
                  key={t.id}
                  className={`task-card ${t.status === 'done' ? 'done' : ''}`}
                  style={{ padding: '12px 14px', background: 'var(--bg-canvas)' }}
                >
                  <div className="task-row-main">
                    <div className="task-left">
                      <button
                        type="button"
                        className={`check-circle ${t.status === 'done' ? 'checked' : ''}`}
                        onClick={() => onToggleDone(t)}
                      >
                        {t.status === 'done' && '✓'}
                      </button>
                      <div>
                        <div className="task-title" style={{ fontSize: '0.92rem' }}>
                          {t.title}
                        </div>
                        <div className="task-meta-pills">
                          <span className="badge">
                            {t.scheduledDate} • {t.scheduledTime} ({t.durationMinutes}m)
                          </span>
                          {t.forWhom && <span className="badge">For: {t.forWhom}</span>}
                          {t.contextLabel && <span className="badge">{t.contextLabel}</span>}
                          {t.minWaitDays > 0 && (
                            <span className="badge amber">+{t.minWaitDays}d wait gap</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {t.status === 'pending' && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => onStartFocus(t)}
                      >
                        <Play size={13} /> Focus
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
