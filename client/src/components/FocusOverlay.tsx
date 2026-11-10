import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Pause,
  Play,
  Plus,
  Scissors,
  Sparkles,
  X,
} from 'lucide-react';
import { Preference, TaskItem } from '../types';

interface FocusOverlayProps {
  task: TaskItem;
  preferences: Preference[];
  onClose: () => void;
  onComplete: (taskId: string, notes: string, followUpJot: string) => Promise<void>;
  onSplit: (taskId: string) => Promise<void>;
}

export const FocusOverlay: React.FC<FocusOverlayProps> = ({
  task,
  preferences,
  onClose,
  onComplete,
  onSplit,
}) => {
  const [secondsLeft, setSecondsLeft] = useState(task.durationMinutes * 60);
  const [running, setRunning] = useState(true);
  const [notes, setNotes] = useState(task.notes || '');
  const [followUpJot, setFollowUpJot] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  // Filter saved preferences relevant to this task's context so only calm useful reminders appear
  const relevantPrefs = preferences.filter((p) => {
    const combined = `${task.title} ${task.forWhom} ${task.contextLabel}`.toLowerCase();
    return (
      combined.includes(p.key.toLowerCase()) ||
      combined.includes(p.value.toLowerCase()) ||
      p.category === 'family_people' ||
      p.category === 'stores' ||
      p.category === 'local_orgs'
    );
  });

  const handleFinish = async () => {
    setSubmitting(true);
    try {
      await onComplete(task.id, notes, followUpJot);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSplit = async () => {
    setSubmitting(true);
    try {
      await onSplit(task.id);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="focus-fullscreen">
      <div className="focus-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
          }}
        >
          <span className="badge sage">
            <Sparkles size={12} /> Single-Task Calm Focus
          </span>
          <button className="btn-ghost" onClick={onClose}>
            <X size={18} /> Exit Focus
          </button>
        </div>

        {task.workloadTitle && (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 4 }}>
            {task.workloadTitle}
          </div>
        )}
        <h2 style={{ fontSize: '2rem', lineHeight: 1.2, marginBottom: 12 }}>{task.title}</h2>

        <div className="task-meta-pills" style={{ marginBottom: 18 }}>
          {task.forWhom && <span className="badge">For: {task.forWhom}</span>}
          {task.contextLabel && <span className="badge">{task.contextLabel}</span>}
          <span className="badge blue">
            {task.scheduledDate} at {task.scheduledTime}
          </span>
        </div>

        {/* Gentle Timer */}
        <div
          style={{
            background: 'var(--bg-canvas)',
            border: '1px solid var(--border-soft)',
            borderRadius: 'var(--radius-lg)',
            padding: '22px',
            textAlign: 'center',
            marginBottom: 20,
          }}
        >
          <div
            className="serif-heading"
            style={{ fontSize: '3.4rem', lineHeight: 1, color: 'var(--sage)', marginBottom: 12 }}
          >
            {formatted}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setRunning((r) => !r)}
            >
              {running ? <Pause size={14} /> : <Play size={14} />}
              {running ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSecondsLeft((s) => s + 300)}
            >
              <Plus size={14} /> +5 min
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={submitting}
              onClick={handleSplit}
              title="Break this task into tiny 5-minute micro-steps"
            >
              <Scissors size={14} /> Still too big? Split into 5m steps
            </button>
          </div>
        </div>

        {/* Context & Saved Preferences Only */}
        <div
          style={{
            background: 'var(--bg-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            marginBottom: 18,
            fontSize: '0.84rem',
          }}
        >
          <div style={{ marginBottom: relevantPrefs.length > 0 ? 8 : 0 }}>
            <strong>Why this timing works:</strong> {task.rationale}
          </div>
          {relevantPrefs.length > 0 && (
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              <strong>Your Saved Context:</strong>{' '}
              {relevantPrefs
                .slice(0, 4)
                .map((p) => `${p.key}: ${p.value}`)
                .join(' • ')}
            </div>
          )}
        </div>

        {/* Scratchpad Notes */}
        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 600,
              marginBottom: 5,
              color: 'var(--text-secondary)',
            }}
          >
            Quick scratchpad notes for this step (optional)
          </label>
          <input
            className="input-field"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g., Confirmation #, sizes checked, portal username…"
          />
        </div>

        {/* Leftovers / Follow-Up Jot */}
        <div style={{ marginBottom: 24 }}>
          <label
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 600,
              marginBottom: 5,
              color: 'var(--text-secondary)',
            }}
          >
            Any leftover piece to schedule as a 10-min follow-up? (optional)
          </label>
          <input
            className="input-field"
            value={followUpJot}
            onChange={(e) => setFollowUpJot(e.target.value)}
            placeholder="e.g., 'Still need mittens' or 'Call pediatrician for immunization form'…"
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Do Later
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={submitting}
            onClick={handleFinish}
          >
            <CheckCircle2 size={17} />
            {followUpJot.trim()
              ? 'Mark Done & Schedule Follow-Up'
              : 'Mark Done'}
          </button>
        </div>
      </div>
    </div>
  );
};
