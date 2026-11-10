import React, { useState } from 'react';
import { Check, KeyRound, MapPin, Sliders, X } from 'lucide-react';
import { AppSettings } from '../types';

interface SettingsModalProps {
  settings: AppSettings;
  onSave: (payload: Partial<AppSettings>) => Promise<void>;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onSave,
  onClose,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [dailyCap, setDailyCap] = useState(settings.dailyCapMinutes);
  const [homeLocationHint, setHomeLocationHint] = useState(settings.homeLocationHint || '');
  const [weeknightStart, setWeeknightStart] = useState(
    settings.focusWindows?.[0]?.startTime || '19:30'
  );
  const [weekendStart, setWeekendStart] = useState(
    settings.focusWindows?.[1]?.startTime || '10:00'
  );
  const [daytimeStart, setDaytimeStart] = useState(
    settings.businessWindows?.[0]?.startTime || '12:15'
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Partial<AppSettings> = {
        dailyCapMinutes: dailyCap,
        homeLocationHint,
        focusWindows: [
          {
            days: [1, 2, 3, 4, 5],
            startTime: weeknightStart,
            endTime: '21:00',
            label: 'Weeknight Calm Slot',
          },
          {
            days: [0, 6],
            startTime: weekendStart,
            endTime: '12:00',
            label: 'Weekend Morning Slot',
          },
        ],
        businessWindows: [
          {
            days: [1, 2, 3, 4, 5],
            startTime: daytimeStart,
            endTime: '13:30',
            label: 'Weekday Midday Call/Errand Slot',
          },
          {
            days: [1, 2, 3, 4, 5],
            startTime: '16:00',
            endTime: '17:00',
            label: 'Weekday Late-Afternoon Office Slot',
          },
        ],
      };
      if (apiKey.trim()) {
        payload.geminiApiKey = apiKey.trim();
      }
      await onSave(payload);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 18,
          }}
        >
          <h2 style={{ fontSize: '1.75rem' }}>Capacity, Windows & Gemini Key</h2>
          <button className="btn-ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Gemini API Key */}
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, fontSize: '0.9rem' }}>
              <KeyRound size={15} /> Gemini API Key (Google Search Deadline & Sale Grounding)
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '4px 0 10px' }}>
              {settings.hasEnvKey
                ? `Active key configured (${settings.geminiApiKey || 'from .env'}). Paste a new key below to replace it.`
                : 'Currently using Local Smart Mode. Add a Gemini API key to enable live Google Search verification of class registration deadlines & store sales.'}
            </div>
            <input
              type="password"
              className="input-field"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings.geminiApiKey || 'AIzaSy...'}
            />
          </div>

          {/* City / Location Hint */}
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, fontSize: '0.9rem' }}>
              <MapPin size={15} /> Home City / Region Hint (Optional)
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '4px 0 10px' }}>
              Helps verify local school, city rec center, or civic registration deadlines accurately.
            </div>
            <input
              className="input-field"
              value={homeLocationHint}
              onChange={(e) => setHomeLocationHint(e.target.value)}
              placeholder="e.g., Austin, TX or Seattle, WA"
            />
          </div>

          {/* Daily Cap & Personal Task Windows */}
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, fontSize: '0.9rem' }}>
              <Sliders size={15} /> Global Daily Cap & Personal Windows
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '8px 0' }}>
              Max daily focus budget across all projects: <strong>{dailyCap} mins / day</strong>
            </div>
            <input
              type="range"
              min={15}
              max={120}
              step={5}
              value={dailyCap}
              onChange={(e) => setDailyCap(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--sage)' }}
            />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 10,
                marginTop: 14,
              }}
            >
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Weeknight Focus
                </label>
                <input
                  type="time"
                  className="input-field"
                  value={weeknightStart}
                  onChange={(e) => setWeeknightStart(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Weekend Morning
                </label>
                <input
                  type="time"
                  className="input-field"
                  value={weekendStart}
                  onChange={(e) => setWeekendStart(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Weekday Call/Office
                </label>
                <input
                  type="time"
                  className="input-field"
                  value={daytimeStart}
                  onChange={(e) => setDaytimeStart(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              <Check size={16} /> Save Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
