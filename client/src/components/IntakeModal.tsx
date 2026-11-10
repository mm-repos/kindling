import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  FileText,
  Globe,
  Loader2,
  Mic,
  MicOff,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { api } from '../api';
import { downloadTasksAsIcs, exportScheduleToPdf } from '../utils/exportSchedule';
import {
  DetectedPreference,
  GameplanProposal,
  IntakeQuestionCard,
  Preference,
  ProposedTask,
  TaskItem,
  Workload,
  WorkloadDomain,
} from '../types';

interface IntakeModalProps {
  preferences: Preference[];
  onClose: () => void;
  onCommitted: (data: {
    tasks: TaskItem[];
    workloads: Workload[];
    preferences: Preference[];
  }) => void;
}

const EXAMPLE_PROMPTS = [
  'I need to register my son for a winter swim class and make sure I do not miss the opening deadline',
  'Overwhelmed with shopping I need to do before our upcoming family trip on Dec 5th',
  'Need to book annual checkups, renew my passport, and sort out medical paperwork',
];

export const IntakeModal: React.FC<IntakeModalProps> = ({
  preferences,
  onClose,
  onCommitted,
}) => {
  const [step, setStep] = useState<'dump' | 'questions' | 'preview'>('dump');
  const [rawDump, setRawDump] = useState('');
  const [projectOverrides, setProjectOverrides] = useState<Record<string, string>>({});
  const [editingPrefKey, setEditingPrefKey] = useState<string | null>(null);
  const [editingPrefVal, setEditingPrefVal] = useState('');

  const [isListening, setIsListening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');

  const [domain, setDomain] = useState<WorkloadDomain>('general');
  const [questions, setQuestions] = useState<IntakeQuestionCard[]>([]);
  const [selectedChips, setSelectedChips] = useState<Record<string, string[]>>({});
  const [customTextAnswers, setCustomTextAnswers] = useState<Record<string, string>>({});

  const [proposal, setProposal] = useState<GameplanProposal | null>(null);
  const [editableTasks, setEditableTasks] = useState<ProposedTask[]>([]);
  const [checkedPrefs, setCheckedPrefs] = useState<Record<number, boolean>>({});

  const toggleVoiceDictation = () => {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition;

    if (!SpeechRec) {
      setError('Voice dictation is not supported in this browser — type freely below.');
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRec();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      if (transcript) {
        setRawDump((prev) => (prev ? `${prev.trim()} ${transcript}` : transcript));
      }
    };
    recognition.start();
  };

  const handleStartQuestions = async (skipDirectlyToPlan = false) => {
    if (!rawDump.trim()) {
      setError('Tell me even one messy sentence about what is weighing on you.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      if (skipDirectlyToPlan) {
        setLoadingMsg('Verifying deadlines, sales & building your backwards timeline…');
        const plan = await api.getGameplanPreview(rawDump, undefined, {}, projectOverrides);
        openPreview(plan);
        return;
      }

      setLoadingMsg('Checking your saved preferences & picking 1–3 smart questions…');
      const res = await api.getIntakeQuestions(rawDump, projectOverrides);
      setDomain(res.domain);

      if (res.readyToPlan || res.questions.length === 0) {
        setLoadingMsg('Verifying deadlines, timing windows & building your gameplan…');
        const plan = await api.getGameplanPreview(rawDump, res.domain, {}, projectOverrides);
        openPreview(plan);
      } else {
        setQuestions(res.questions);
        setStep('questions');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const buildCombinedAnswers = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const q of questions) {
      const chips = selectedChips[q.id] || [];
      const txt = (customTextAnswers[q.id] || '').trim();
      const combined = [...chips, ...(txt ? [txt] : [])].join('; ');
      if (combined) {
        out[q.id] = combined;
      }
    }
    return out;
  };

  const handleGeneratePreview = async (skipAnswers = false) => {
    setError('');
    setLoading(true);
    setLoadingMsg(
      domain === 'registration_deadline'
        ? 'Checking registration opening windows, prerequisites & daily capacity…'
        : domain === 'shopping_trip'
        ? 'Checking store sale calendars, shipping buffers & packing cutoffs…'
        : 'Verifying real-world constraints, business hours & backwards steps…'
    );
    try {
      const answers = skipAnswers ? {} : buildCombinedAnswers();
      const plan = await api.getGameplanPreview(rawDump, domain, answers, projectOverrides);
      openPreview(plan);
    } catch (err: any) {
      setError(err.message || 'Could not generate preview.');
    } finally {
      setLoading(false);
    }
  };

  const openPreview = (plan: GameplanProposal) => {
    setProposal(plan);
    setEditableTasks(plan.proposedTasks);
    const initialChecked: Record<number, boolean> = {};
    plan.detectedPreferences.forEach((_, idx) => {
      initialChecked[idx] = true;
    });
    setCheckedPrefs(initialChecked);
    setStep('preview');
  };

  const toggleChip = (q: IntakeQuestionCard, chip: string) => {
    setSelectedChips((prev) => {
      const curr = prev[q.id] || [];
      if (curr.includes(chip)) {
        return { ...prev, [q.id]: curr.filter((c) => c !== chip) };
      }
      if (q.allowMultiple) {
        return { ...prev, [q.id]: [...curr, chip] };
      }
      return { ...prev, [q.id]: [chip] };
    });
  };

  const handleCommit = async () => {
    if (!proposal) return;
    setLoading(true);
    setLoadingMsg('Merging micro-tasks into your calm schedule…');
    try {
      const approvedPrefs: DetectedPreference[] = proposal.detectedPreferences.filter(
        (_, idx) => checkedPrefs[idx]
      );
      const updatedProposal: GameplanProposal = {
        ...proposal,
        proposedTasks: editableTasks,
      };
      const res = await api.commitGameplan(
        rawDump,
        projectOverrides,
        updatedProposal,
        approvedPrefs
      );
      onCommitted(res);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save schedule.');
    } finally {
      setLoading(false);
    }
  };

  const saveTemporaryOverride = (key: string) => {
    if (editingPrefVal.trim()) {
      setProjectOverrides((prev) => ({ ...prev, [key]: editingPrefVal.trim() }));
    } else {
      setProjectOverrides((prev) => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
    }
    setEditingPrefKey(null);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 18,
          }}
        >
          <div>
            <h2 style={{ fontSize: '1.85rem' }}>
              {step === 'dump' && 'Split a heavy load into kindling.'}
              {step === 'questions' && 'Just a few quick details.'}
              {step === 'preview' && 'Your Calm Gameplan Preview'}
            </h2>
            <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              {step === 'dump' &&
                'Drop any overwhelming project, deadline, registration, or trip prep—no organizing needed.'}
              {step === 'questions' &&
                'Tap any quick chip or skip straight to smart defaults whenever you want.'}
              {step === 'preview' &&
                'Review verified deadlines, safety buffers, and timed steps before adding to your schedule.'}
            </div>
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {/* Applied Defaults Pill Bar (with Temporary Per-Project Override!) */}
        {preferences.length > 0 && step !== 'preview' && (
          <div className="defaults-bar">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '0.78rem',
                color: 'var(--text-secondary)',
              }}
            >
              <span>
                <strong>Applied Defaults from Memory</strong> — click any pill to override{' '}
                <em>just for this project</em>:
              </span>
              {Object.keys(projectOverrides).length > 0 && (
                <button
                  className="btn-ghost"
                  style={{ fontSize: '0.75rem', padding: '2px 6px' }}
                  onClick={() => setProjectOverrides({})}
                >
                  Reset overrides
                </button>
              )}
            </div>
            <div className="defaults-pills">
              {preferences.map((p) => {
                const isOverridden = projectOverrides[p.key] !== undefined;
                const activeVal = isOverridden ? projectOverrides[p.key] : p.value;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`pref-pill ${isOverridden ? 'overridden' : ''}`}
                    onClick={() => {
                      setEditingPrefKey(p.key);
                      setEditingPrefVal(activeVal);
                    }}
                  >
                    <span>
                      <strong>{p.key}:</strong> {activeVal}
                    </span>
                    <Edit3 size={12} />
                  </button>
                );
              })}
            </div>

            {editingPrefKey && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                <input
                  className="input-field"
                  value={editingPrefVal}
                  onChange={(e) => setEditingPrefVal(e.target.value)}
                  placeholder={`Temporary value for "${editingPrefKey}"...`}
                />
                <button
                  type="button"
                  className="btn-primary"
                  style={{ padding: '7px 14px', fontSize: '0.8rem' }}
                  onClick={() => saveTemporaryOverride(editingPrefKey)}
                >
                  Apply to this project
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setEditingPrefKey(null)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="alert-banner warn" style={{ marginBottom: 14 }}>
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: VOICE / FREEFORM BRAIN DUMP */}
        {step === 'dump' && (
          <div>
            <div style={{ position: 'relative' }}>
              <textarea
                className="brain-textarea"
                value={rawDump}
                onChange={(e) => setRawDump(e.target.value)}
                placeholder="e.g., I need to register my son for a class and don't know the cutoff... OR I'm overwhelmed with shopping before our Dec 5th trip..."
                autoFocus
              />
              <button
                type="button"
                onClick={toggleVoiceDictation}
                className="btn-secondary"
                style={{
                  position: 'absolute',
                  right: 12,
                  bottom: 12,
                  background: isListening ? 'var(--amber-soft)' : 'var(--bg-surface)',
                  color: isListening ? 'var(--amber)' : 'var(--text-secondary)',
                }}
                title="Speak your brain-dump"
              >
                {isListening ? <MicOff size={15} /> : <Mic size={15} />}
                {isListening ? 'Listening…' : 'Voice'}
              </button>
            </div>

            <div style={{ marginTop: 12, marginBottom: 22 }}>
              <div
                style={{
                  fontSize: '0.76rem',
                  color: 'var(--text-muted)',
                  marginBottom: 6,
                }}
              >
                Try an example brain-dump:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {EXAMPLE_PROMPTS.map((ex, i) => (
                  <button
                    key={i}
                    type="button"
                    className="btn-secondary"
                    style={{ fontSize: '0.76rem', padding: '5px 10px' }}
                    onClick={() => setRawDump(ex)}
                  >
                    {ex.length > 58 ? ex.slice(0, 58) + '…' : ex}
                  </button>
                ))}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <button
                type="button"
                className="btn-secondary"
                disabled={loading}
                onClick={() => handleStartQuestions(true)}
              >
                Skip questions & plan with smart defaults
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={loading}
                onClick={() => handleStartQuestions(false)}
              >
                {loading ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                {loading ? loadingMsg : 'Help Me Break This Down'}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: GUIDED QUESTION CARDS (1-3 MAX) */}
        {step === 'questions' && (
          <div>
            {questions.map((q, idx) => {
              const picked = selectedChips[q.id] || [];
              return (
                <div key={q.id} className="question-card">
                  <div style={{ fontWeight: 600, fontSize: '0.96rem', marginBottom: 3 }}>
                    {idx + 1}. {q.question}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {q.whyAsking}
                  </div>

                  <div className="chip-group">
                    {q.chips.map((chip) => {
                      const active = picked.includes(chip);
                      return (
                        <button
                          key={chip}
                          type="button"
                          className={`choice-chip ${active ? 'selected' : ''}`}
                          onClick={() => toggleChip(q, chip)}
                        >
                          {active && <Check size={13} style={{ marginRight: 5 }} />}
                          {chip}
                        </button>
                      );
                    })}
                  </div>

                  <input
                    className="input-field"
                    value={customTextAnswers[q.id] || ''}
                    onChange={(e) =>
                      setCustomTextAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                    }
                    placeholder={q.placeholder || 'Optional extra detail…'}
                  />
                </div>
              );
            })}

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 18,
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <button
                type="button"
                className="btn-ghost"
                disabled={loading}
                onClick={() => setStep('dump')}
              >
                <ArrowLeft size={15} /> Back
              </button>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={loading}
                  onClick={() => handleGeneratePreview(true)}
                >
                  Skip & use smart defaults
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={loading}
                  onClick={() => handleGeneratePreview(false)}
                >
                  {loading ? <Loader2 size={16} /> : <ArrowRight size={16} />}
                  {loading ? loadingMsg : 'Verify Deadlines & Preview Plan'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: CALM GAMEPLAN PREVIEW */}
        {step === 'preview' && proposal && (
          <div>
            <div
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-soft)',
                borderRadius: 'var(--radius-md)',
                padding: '16px 18px',
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                  marginBottom: 8,
                }}
              >
                <strong style={{ fontSize: '1.05rem' }}>{proposal.workloadTitle}</strong>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span
                    className={`badge ${
                      proposal.deadlineConfidence === 'verified_web'
                        ? 'sage'
                        : proposal.deadlineConfidence === 'needs_check'
                        ? 'amber'
                        : 'blue'
                    }`}
                  >
                    <Globe size={12} />
                    {proposal.deadlineConfidence === 'verified_web' && 'Web-Verified Timing'}
                    {proposal.deadlineConfidence === 'user_provided' && 'Anchored to Your Date'}
                    {proposal.deadlineConfidence === 'needs_check' &&
                      'Includes Day-1 Cutoff Verification'}
                  </span>
                  <span className="badge">
                    <ShieldCheck size={12} /> Zero Product Recommendations
                  </span>
                </div>
              </div>

              <div style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                {proposal.verificationSummary}
              </div>
              <div
                style={{
                  fontSize: '0.82rem',
                  color: 'var(--sage)',
                  background: 'var(--sage-soft)',
                  padding: '7px 11px',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <strong>Buffer Protection:</strong> {proposal.bufferSummary}
              </div>
            </div>

            {/* Backwards Milestones Strip */}
            {proposal.milestones.length > 0 && (
              <>
                <div className="section-label" style={{ marginTop: 10 }}>
                  <span>Backwards Guardrails & Cutoffs</span>
                </div>
                <div className="milestones-strip">
                  {proposal.milestones.map((m, i) => (
                    <div key={i} className={`milestone-box ${m.kind}`}>
                      <div style={{ fontSize: '0.73rem', fontWeight: 600, opacity: 0.8 }}>
                        {m.date}
                      </div>
                      <div style={{ fontWeight: 600, fontSize: '0.86rem', margin: '3px 0' }}>
                        {m.label}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                        {m.detail}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Proposed Micro-Tasks */}
            <div className="section-label">
              <span>Proposed Timed Micro-Steps ({editableTasks.length})</span>
              <span style={{ textTransform: 'none', fontWeight: 400 }}>
                Spread calmly across your daily capacity
              </span>
            </div>

            <div className="task-list" style={{ marginBottom: 20 }}>
              {editableTasks.map((t, idx) => (
                <div key={t.tempId} className="task-card" style={{ padding: '13px 15px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      alignItems: 'flex-start',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <input
                        className="input-field"
                        style={{ fontWeight: 600, marginBottom: 6 }}
                        value={t.title}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditableTasks((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, title: val } : item))
                          );
                        }}
                      />
                      <div className="task-meta-pills">
                        <span className="badge sage">
                          <Clock size={12} /> {t.durationMinutes} min
                        </span>
                        {t.forWhom && <span className="badge">For: {t.forWhom}</span>}
                        {t.contextLabel && <span className="badge">{t.contextLabel}</span>}
                        <span className="badge blue">
                          {t.slotType === 'daytime_business'
                            ? 'Daytime Business Hours'
                            : t.slotType === 'pinned_exact'
                            ? 'Pinned Opening Window'
                            : 'Calm Focus Slot'}
                        </span>
                        {t.minWaitDays > 0 && (
                          <span className="badge amber">+{t.minWaitDays}d wait gap</span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="date"
                        className="input-field"
                        style={{ width: 136, fontSize: '0.8rem', padding: '5px 8px' }}
                        value={t.scheduledDate}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditableTasks((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, scheduledDate: val } : item
                            )
                          );
                        }}
                      />
                      <input
                        type="time"
                        className="input-field"
                        style={{ width: 104, fontSize: '0.8rem', padding: '5px 8px' }}
                        value={t.scheduledTime}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditableTasks((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, scheduledTime: val } : item
                            )
                          );
                        }}
                      />
                    </div>
                  </div>
                  <div className="task-rationale">{t.rationale}</div>
                  {t.pivotOption && (
                    <div className="pivot-banner">
                      <span>
                        <strong>Pivot Option Available:</strong> {t.pivotOption.label}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Newly Detected Preferences Checkboxes */}
            {proposal.detectedPreferences.length > 0 && (
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-soft)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  marginBottom: 20,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: 8 }}>
                  Remember these preferences for future workloads?
                </div>
                {proposal.detectedPreferences.map((dp, idx) => (
                  <label
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      fontSize: '0.84rem',
                      padding: '5px 0',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(checkedPrefs[idx])}
                      onChange={(e) =>
                        setCheckedPrefs((prev) => ({ ...prev, [idx]: e.target.checked }))
                      }
                    />
                    <span>
                      <strong>{dp.key}:</strong> {dp.value}{' '}
                      <span style={{ color: 'var(--text-muted)' }}>({dp.reason})</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <button
                type="button"
                className="btn-ghost"
                disabled={loading}
                onClick={() => setStep(questions.length > 0 ? 'questions' : 'dump')}
              >
                <ArrowLeft size={15} /> Adjust answers
              </button>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    const previewItems: TaskItem[] = editableTasks.map((pt) => ({
                      id: pt.tempId,
                      workloadId: null,
                      workloadTitle: proposal.workloadTitle,
                      parentTaskId: null,
                      dependsOnTaskId: null,
                      minWaitDays: pt.minWaitDays,
                      slotType: pt.slotType,
                      title: pt.title,
                      forWhom: pt.forWhom,
                      contextLabel: pt.contextLabel,
                      scheduledDate: pt.scheduledDate,
                      scheduledTime: pt.scheduledTime,
                      latestSafeDate: pt.latestSafeDate,
                      durationMinutes: pt.durationMinutes,
                      rationale: pt.rationale,
                      pivotOption: pt.pivotOption || null,
                      cutoffWarning: false,
                      status: 'pending',
                      notes: '',
                      createdAt: new Date().toISOString(),
                    }));
                    downloadTasksAsIcs(
                      previewItems,
                      'kindling-gameplan.ics',
                      proposal.milestones,
                      proposal.workloadTitle
                    );
                  }}
                >
                  <CalendarPlus size={14} /> .ics
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    const previewItems: TaskItem[] = editableTasks.map((pt) => ({
                      id: pt.tempId,
                      workloadId: null,
                      workloadTitle: proposal.workloadTitle,
                      parentTaskId: null,
                      dependsOnTaskId: null,
                      minWaitDays: pt.minWaitDays,
                      slotType: pt.slotType,
                      title: pt.title,
                      forWhom: pt.forWhom,
                      contextLabel: pt.contextLabel,
                      scheduledDate: pt.scheduledDate,
                      scheduledTime: pt.scheduledTime,
                      latestSafeDate: pt.latestSafeDate,
                      durationMinutes: pt.durationMinutes,
                      rationale: pt.rationale,
                      pivotOption: pt.pivotOption || null,
                      cutoffWarning: false,
                      status: 'pending',
                      notes: '',
                      createdAt: new Date().toISOString(),
                    }));
                    exportScheduleToPdf({
                      title: proposal.workloadTitle,
                      subtitle: proposal.bufferSummary,
                      workloads: [
                        {
                          id: 'preview',
                          title: proposal.workloadTitle,
                          rawDump,
                          domain: proposal.domain,
                          hardDeadline: proposal.hardDeadline,
                          deadlineConfidence: proposal.deadlineConfidence,
                          verificationNotes: proposal.verificationSummary,
                          bufferSummary: proposal.bufferSummary,
                          milestones: proposal.milestones,
                          projectOverrides,
                          status: 'scheduled',
                          createdAt: new Date().toISOString(),
                        },
                      ],
                      tasks: previewItems,
                    });
                  }}
                >
                  <FileText size={14} /> PDF
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={loading}
                  onClick={handleCommit}
                >
                  {loading ? <Loader2 size={16} /> : <CheckCircle2 size={16} />}
                  {loading ? loadingMsg : 'Approve & Merge Into My Schedule'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
