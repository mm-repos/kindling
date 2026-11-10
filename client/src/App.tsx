import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  CalendarPlus,
  CalendarRange,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Flame,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Settings,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react';
import { api } from './api';
import {
  buildGoogleCalendarUrl,
  downloadTasksAsIcs,
  exportScheduleToPdf,
} from './utils/exportSchedule';
import { FocusOverlay } from './components/FocusOverlay';
import { IntakeModal } from './components/IntakeModal';
import { PreferenceVaultView } from './components/PreferenceVaultView';
import { SettingsModal } from './components/SettingsModal';
import { WorkloadsTimelineView } from './components/WorkloadsTimelineView';
import { AppSettings, Preference, TaskItem, Workload } from './types';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'today' | 'timelines' | 'vault'>('today');
  const [todayStr, setTodayStr] = useState('');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [workloads, setWorkloads] = useState<Workload[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const [rebalanceBanner, setRebalanceBanner] = useState<{
    movedCount: number;
    warningsCount: number;
  } | null>(null);

  const [quickTitle, setQuickTitle] = useState('');
  const [quickDue, setQuickDue] = useState('');
  const [addingQuick, setAddingQuick] = useState(false);

  const [showIntake, setShowIntake] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [focusTask, setFocusTask] = useState<TaskItem | null>(null);

  const loadAll = async () => {
    const [taskRes, wkRes, prefRes, setRes] = await Promise.all([
      api.getTasks(),
      api.getWorkloads(),
      api.getPreferences(),
      api.getSettings(),
    ]);
    setTodayStr(taskRes.today);
    setTasks(taskRes.tasks);
    if (taskRes.rebalanced.movedCount > 0) {
      setRebalanceBanner({
        movedCount: taskRes.rebalanced.movedCount,
        warningsCount: taskRes.rebalanced.warningsCount,
      });
    }
    setWorkloads(wkRes);
    setPreferences(prefRes);
    setSettings(setRes);
  };

  useEffect(() => {
    loadAll().catch(console.error);
  }, []);

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;
    setAddingQuick(true);
    try {
      const created = await api.addQuickTask(quickTitle.trim(), quickDue || undefined);
      setTasks((prev) =>
        [...prev, created].sort((a, b) =>
          `${a.scheduledDate}${a.scheduledTime}`.localeCompare(
            `${b.scheduledDate}${b.scheduledTime}`
          )
        )
      );
      setQuickTitle('');
      setQuickDue('');
    } finally {
      setAddingQuick(false);
    }
  };

  const handleToggleDone = async (t: TaskItem) => {
    const nextStatus = t.status === 'done' ? 'pending' : 'done';
    const res = await api.updateTask(t.id, { status: nextStatus });
    setTasks(res.tasks);
    const wk = await api.getWorkloads();
    setWorkloads(wk);
  };

  const handleFocusComplete = async (taskId: string, notes: string, followUpJot: string) => {
    const res = await api.updateTask(taskId, { status: 'done', notes, followUpJot });
    setTasks(res.tasks);
    const wk = await api.getWorkloads();
    setWorkloads(wk);
  };

  const handleSplitTask = async (taskId: string) => {
    const res = await api.splitTask(taskId);
    setTasks(res.tasks);
  };

  const handlePivotTask = async (taskId: string) => {
    const res = await api.pivotTask(taskId);
    setTasks(res.tasks);
  };

  const handleDeleteTask = async (taskId: string) => {
    const res = await api.deleteTask(taskId);
    setTasks(res.tasks);
  };

  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const todayTasks = tasks.filter(
    (t) => t.scheduledDate === todayStr && t.status !== 'skipped'
  );
  const upcomingTasks = pendingTasks.filter((t) => t.scheduledDate > todayStr);

  const todayMinutesBooked = todayTasks
    .filter((t) => t.status === 'pending')
    .reduce((acc, t) => acc + t.durationMinutes, 0);
  const cap = settings?.dailyCapMinutes || 45;
  const capPct = Math.min(100, Math.round((todayMinutesBooked / cap) * 100));

  const renderTaskCard = (t: TaskItem) => (
    <div key={t.id} className={`task-card ${t.status === 'done' ? 'done' : ''}`}>
      <div className="task-row-main">
        <div className="task-left">
          <button
            type="button"
            className={`check-circle ${t.status === 'done' ? 'checked' : ''}`}
            onClick={() => handleToggleDone(t)}
            aria-label="Mark task complete"
          >
            {t.status === 'done' && '✓'}
          </button>

          <div style={{ flex: 1 }}>
            {t.workloadTitle && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>
                {t.workloadTitle}
              </div>
            )}
            <div className="task-title">{t.title}</div>

            <div className="task-meta-pills">
              <span className="badge sage">
                <Clock size={12} /> {t.scheduledDate === todayStr ? 'Today' : t.scheduledDate} •{' '}
                {t.scheduledTime} ({t.durationMinutes}m)
              </span>
              {t.forWhom && <span className="badge">For: {t.forWhom}</span>}
              {t.contextLabel && <span className="badge">{t.contextLabel}</span>}
              <span className="badge blue">
                {t.slotType === 'daytime_business'
                  ? 'Daytime Business Slot'
                  : t.slotType === 'pinned_exact'
                  ? 'Pinned Window'
                  : 'Calm Focus Slot'}
              </span>
              {t.cutoffWarning && (
                <span className="badge danger">
                  <AlertTriangle size={12} /> Cutoff getting tight
                </span>
              )}
            </div>

            {t.rationale && <div className="task-rationale">{t.rationale}</div>}

            {t.pivotOption && t.status === 'pending' && (
              <div className="pivot-banner">
                <span>
                  <RefreshCw size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  {t.pivotOption.label}
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '0.76rem' }}
                  onClick={() => handlePivotTask(t.id)}
                >
                  Switch
                </button>
              </div>
            )}
          </div>
        </div>

        {t.status === 'pending' && (
          <button
            type="button"
            className="btn-primary"
            style={{ padding: '8px 14px', fontSize: '0.82rem', flexShrink: 0 }}
            onClick={() => setFocusTask(t)}
          >
            <Play size={14} /> Start
          </button>
        )}
      </div>

      {t.status === 'pending' && (
        <div className="task-actions-footer">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => handleSplitTask(t.id)}
            >
              <Scissors size={13} /> Break into 5-min steps
            </button>
            <a
              href={buildGoogleCalendarUrl(t)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost"
              style={{ textDecoration: 'none' }}
              title="Open pre-filled event in Google Calendar"
            >
              <ExternalLink size={13} /> Google Cal
            </a>
            <button
              type="button"
              className="btn-ghost"
              onClick={() =>
                downloadTasksAsIcs(
                  [t],
                  `kindling-${t.scheduledDate}.ics`
                )
              }
              title="Download .ics invite for Apple Calendar, Outlook, or Google Calendar"
            >
              <CalendarPlus size={13} /> .ics
            </button>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => handleDeleteTask(t.id)}
            title="Remove step"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="app-shell">
      {/* Top Calm Navigation */}
      <header className="top-nav">
        <div className="brand">
          <div className="brand-mark">
            <Flame size={18} />
          </div>
          <div>
            <div className="brand-title serif-heading">Kindling</div>
            <div className="brand-subtitle">Split Heavy Loads Into Calm Daily Sparks</div>
          </div>
        </div>

        <nav className="nav-tabs">
          <button
            type="button"
            className={`nav-tab ${activeTab === 'today' ? 'active' : ''}`}
            onClick={() => setActiveTab('today')}
          >
            <Sun size={15} /> Today
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'timelines' ? 'active' : ''}`}
            onClick={() => setActiveTab('timelines')}
          >
            <CalendarRange size={15} /> Workloads ({workloads.length})
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'vault' ? 'active' : ''}`}
            onClick={() => setActiveTab('vault')}
          >
            <Bookmark size={15} /> Memory ({preferences.length})
          </button>
        </nav>

        <div className="nav-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowSettings(true)}
            title="Daily Capacity, Windows & Gemini API Key"
          >
            <Settings size={15} />
            {settings?.hasEnvKey ? 'Settings' : 'Add Gemini Key'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowIntake(true)}
          >
            <Sparkles size={16} /> Spark Something Heavy
          </button>
        </div>
      </header>

      {/* Auto-Rebalance Banner */}
      {rebalanceBanner && (
        <div className={`alert-banner ${rebalanceBanner.warningsCount > 0 ? 'warn' : ''}`}>
          <span>
            <strong>Smart Auto-Rebalance:</strong> Gently slid {rebalanceBanner.movedCount} missed
            step(s) into your next open focus slots within your daily cap.
            {rebalanceBanner.warningsCount > 0 &&
              ` (${rebalanceBanner.warningsCount} step is now close to its safety cutoff.)`}
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setRebalanceBanner(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: TODAY FOCUS VIEW */}
      {activeTab === 'today' && (
        <div>
          <div className="today-header">
            <div className="today-greeting">
              <h1>Today, one small step at a time.</h1>
              <p>
                {todayTasks.filter((t) => t.status === 'pending').length === 0
                  ? 'Your plate for today is clear. Drop a big mental load or a quick 1-line task below.'
                  : `Only showing what fits calmly into today (${todayStr}). Future steps stay tucked away until needed.`}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
              <div className="capacity-pill-card">
                <div className="capacity-top">
                  <span>Daily Focus Budget</span>
                  <strong>
                    {todayMinutesBooked} / {cap} mins
                  </strong>
                </div>
                <div className="capacity-bar-track">
                  <div
                    className={`capacity-bar-fill ${todayMinutesBooked > cap ? 'over' : ''}`}
                    style={{ width: `${capPct}%` }}
                  />
                </div>
              </div>

              {pendingTasks.length > 0 && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '0.78rem' }}
                    onClick={() =>
                      downloadTasksAsIcs(pendingTasks, 'kindling-full-schedule.ics')
                    }
                    title="Download all scheduled steps as an .ics calendar file"
                  >
                    <Download size={13} /> Export Calendar (.ics)
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '0.78rem' }}
                    onClick={() =>
                      exportScheduleToPdf({
                        title: 'My Calm Schedule',
                        subtitle: `Paced within ${cap} mins/day focus budget`,
                        workloads,
                        tasks,
                      })
                    }
                    title="Open clean print / Save as PDF view"
                  >
                    <FileText size={13} /> Export PDF
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 1-Line Quick Standalone Task Input */}
          <form className="quick-add-bar" onSubmit={handleQuickAdd}>
            <Plus size={18} color="var(--text-muted)" />
            <input
              type="text"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              placeholder="Quick 1-line to-do (e.g., 'Call dentist office' or 'Sign field trip slip') — auto-fits your daily cap…"
            />
            <input
              type="date"
              value={quickDue}
              onChange={(e) => setQuickDue(e.target.value)}
              title="Optional target date"
            />
            <button type="submit" className="btn-secondary" disabled={addingQuick}>
              Add Quick Step
            </button>
          </form>

          {todayTasks.length === 0 && upcomingTasks.length === 0 ? (
            <div className="calm-empty">
              <h2>What&apos;s weighing on your mind?</h2>
              <p>
                Tell Kindling about an overwhelming workload—like registering your son for a class,
                preparing for a family trip, or catching up on life admin. It asks 1–3 calm
                questions, verifies deadlines &amp; sale windows, and splits the load into small,
                easy-to-start sparks.
              </p>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setShowIntake(true)}
              >
                <Sparkles size={16} /> Split Your First Heavy Load
              </button>
            </div>
          ) : (
            <>
              <div className="section-label">
                <span>Today&apos;s Calm Queue ({todayTasks.length})</span>
                {todayTasks.some((t) => t.status === 'done') && (
                  <span style={{ color: 'var(--sage)', textTransform: 'none' }}>
                    <CheckCircle2 size={13} style={{ verticalAlign: 'middle' }} /> Nice momentum!
                  </span>
                )}
              </div>

              {todayTasks.length === 0 ? (
                <div
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-soft)',
                    borderRadius: 'var(--radius-md)',
                    padding: '18px 20px',
                    color: 'var(--text-secondary)',
                    fontSize: '0.9rem',
                  }}
                >
                  Nothing scheduled specifically for today—your upcoming steps are safely paced
                  ahead of their cutoffs below.
                </div>
              ) : (
                <div className="task-list">{todayTasks.map(renderTaskCard)}</div>
              )}

              {upcomingTasks.length > 0 && (
                <>
                  <div className="section-label" style={{ marginTop: 34 }}>
                    <span>Paced Ahead (Upcoming Windows • {upcomingTasks.length})</span>
                    <span style={{ textTransform: 'none', fontWeight: 400 }}>
                      Aligned with verified deadlines, sales, shipping &amp; business hours
                    </span>
                  </div>
                  <div className="task-list">{upcomingTasks.map(renderTaskCard)}</div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: WORKLOADS & BACKWARDS TIMELINES */}
      {activeTab === 'timelines' && (
        <WorkloadsTimelineView
          workloads={workloads}
          tasks={tasks}
          onDeleteWorkload={async (id) => {
            await api.deleteWorkload(id);
            await loadAll();
          }}
          onStartFocus={(t) => setFocusTask(t)}
          onToggleDone={handleToggleDone}
        />
      )}

      {/* TAB 3: PREFERENCE MEMORY VAULT */}
      {activeTab === 'vault' && (
        <PreferenceVaultView
          preferences={preferences}
          onSave={async (cat, k, v) => {
            await api.savePreference(cat, k, v);
            setPreferences(await api.getPreferences());
          }}
          onDelete={async (id) => {
            await api.deletePreference(id);
            setPreferences(await api.getPreferences());
          }}
        />
      )}

      {/* MODALS & OVERLAYS */}
      {showIntake && (
        <IntakeModal
          preferences={preferences}
          onClose={() => setShowIntake(false)}
          onCommitted={(res) => {
            setTasks(res.tasks);
            setWorkloads(res.workloads);
            setPreferences(res.preferences);
            setActiveTab('today');
          }}
        />
      )}

      {showSettings && settings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={async (payload) => {
            const updated = await api.updateSettings(payload);
            setSettings(updated);
          }}
        />
      )}

      {focusTask && (
        <FocusOverlay
          task={focusTask}
          preferences={preferences}
          onClose={() => setFocusTask(null)}
          onComplete={handleFocusComplete}
          onSplit={handleSplitTask}
        />
      )}
    </div>
  );
};
