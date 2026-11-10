import React, { useState } from 'react';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Preference, PreferenceCategory } from '../types';

interface PreferenceVaultViewProps {
  preferences: Preference[];
  onSave: (category: PreferenceCategory, key: string, value: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const CATEGORY_LABELS: Record<PreferenceCategory, string> = {
  family_people: 'Family & Household',
  local_orgs: 'Local Schools, Rec & Providers',
  buffer_rules: 'Safety & Pre-Trip Buffers',
  timing_habits: 'Timing & Focus Habits',
  stores: 'Go-To Stores (Never Product Push)',
  general: 'General Preferences',
};

export const PreferenceVaultView: React.FC<PreferenceVaultViewProps> = ({
  preferences,
  onSave,
  onDelete,
}) => {
  const [category, setCategory] = useState<PreferenceCategory>('family_people');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !value.trim()) return;
    await onSave(category, key.trim(), value.trim());
    setKey('');
    setValue('');
  };

  const categories = Object.keys(CATEGORY_LABELS) as PreferenceCategory[];

  return (
    <div>
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-soft)',
          borderRadius: 'var(--radius-lg)',
          padding: '22px 24px',
          marginBottom: 24,
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <h2 style={{ fontSize: '1.7rem' }}>Preference Memory Vault</h2>
          <span className="badge sage">
            <ShieldCheck size={12} /> 100% Editable & Transparent
          </span>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
          Kindling remembers reusable context—like your child&apos;s age/rec program, preferred
          buffers, and go-to stores—so it asks fewer questions over time without ever pushing
          products. You can also override any default temporarily per project.
        </p>

        <form
          onSubmit={handleAdd}
          style={{
            display: 'grid',
            gridTemplateColumns: '190px 1fr 1fr auto',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <select
            className="input-field"
            value={category}
            onChange={(e) => setCategory(e.target.value as PreferenceCategory)}
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
          <input
            className="input-field"
            placeholder="Label (e.g., Son's swim org, Kids clothes store)"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <input
            className="input-field"
            placeholder="Preference (e.g., Sunnyvale Rec, Target)"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="submit" className="btn-primary">
            <Plus size={15} /> Save
          </button>
        </form>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
          gap: 16,
        }}
      >
        {categories.map((cat) => {
          const items = preferences.filter((p) => p.category === cat);
          if (items.length === 0) return null;
          return (
            <div
              key={cat}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-soft)',
                borderRadius: 'var(--radius-md)',
                padding: '16px 18px',
              }}
            >
              <div
                style={{
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                  marginBottom: 10,
                }}
              >
                {CATEGORY_LABELS[cat]}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: 'var(--bg-canvas)',
                      padding: '8px 11px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.85rem',
                    }}
                  >
                    <div>
                      <strong>{item.key}:</strong> {item.value}
                    </div>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => onDelete(item.id)}
                      title="Delete preference"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
