import { useEffect, useMemo, useState } from 'react';
import { X, Search, Check } from 'lucide-react';
import { IContact, listContacts } from '../lib/contactsApi';

interface IProps {
  isOpen: boolean;
  onClose: () => void;
  // Emails already chosen elsewhere in the form -- shown as "Added" and not selectable again.
  alreadyAdded?: string[];
  onAdd: (emails: string[]) => void;
}

// Pick people from the signed-in user's contact book and hand their emails back to the caller.
export function ContactPicker({ isOpen, onClose, alreadyAdded = [], onAdd }: IProps) {
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let active = true;

    setSelected(new Set());
    setQuery('');
    setError('');
    setLoading(true);
    listContacts()
      .then((list) => { if (active) setContacts(list); })
      .catch((err) => { if (active) setError(err.message || 'Could not load contacts'); })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [ isOpen ]);

  const taken = useMemo(() => new Set(alreadyAdded.map((e) => e.toLowerCase())), [ alreadyAdded ]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();

    return contacts.filter((c) => !q || c.name.toLowerCase().includes(q) || c.email.includes(q));
  }, [ contacts, query ]);

  if (!isOpen) {
    return null;
  }

  const toggle = (email: string) => {
    setSelected((prev) => {
      const next = new Set(prev);

      if (next.has(email)) next.delete(email); else next.add(email);

      return next;
    });
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
    >
      <div
        role="dialog"
        aria-label="Choose from contact book"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: '420px', maxHeight: '80vh', backgroundColor: '#FFFFFF', color: '#111827', borderRadius: '16px', boxShadow: '0 20px 40px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid #E5E7EB' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Choose from contact book</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '12px 18px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '0 10px', height: '38px' }}>
            <Search size={15} color="#9CA3AF" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or email"
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: '13px', background: 'transparent', color: '#111827' }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 10px 10px' }}>
          {loading && <p style={{ textAlign: 'center', color: '#6B7280', fontSize: '13px', margin: '20px 0' }}>Loading contacts...</p>}
          {error && <p style={{ textAlign: 'center', color: '#DC2626', fontSize: '13px', margin: '20px 0' }}>{error}</p>}
          {!loading && !error && contacts.length === 0 && (
            <p style={{ textAlign: 'center', color: '#6B7280', fontSize: '13px', margin: '20px 12px', lineHeight: 1.5 }}>
              Your contact book is empty. Add people from Contact book in the dashboard menu.
            </p>
          )}
          {visible.map((c) => {
            const isTaken = taken.has(c.email);
            const isChecked = selected.has(c.email);

            return (
              <button
                key={c.id}
                type="button"
                disabled={isTaken}
                onClick={() => toggle(c.email)}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '8px', borderRadius: '8px', border: 'none', background: isChecked ? '#EEF2FF' : 'transparent', cursor: isTaken ? 'default' : 'pointer', opacity: isTaken ? 0.55 : 1 }}
              >
                <span style={{ width: '20px', height: '20px', borderRadius: '5px', border: `2px solid ${isChecked || isTaken ? '#4F46E5' : '#D1D5DB'}`, backgroundColor: isChecked || isTaken ? '#4F46E5' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {(isChecked || isTaken) && <Check size={13} color="#FFFFFF" />}
                </span>
                <span style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#E0E7FF', color: '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px', flexShrink: 0 }}>
                  {(c.name.trim() || '?').charAt(0).toUpperCase()}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <span style={{ display: 'block', fontSize: '12px', color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</span>
                </span>
                {isTaken && <span style={{ fontSize: '11px', color: '#6B7280' }}>Added</span>}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '10px', padding: '12px 18px', borderTop: '1px solid #E5E7EB' }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#FFFFFF', fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => { onAdd(Array.from(selected)); onClose(); }}
            style={{ flex: 2, padding: '10px', borderRadius: '8px', border: 'none', fontWeight: 700, color: '#FFFFFF', cursor: selected.size ? 'pointer' : 'not-allowed', backgroundColor: selected.size ? '#4F46E5' : '#A5B4FC' }}
          >
            {selected.size ? `Add ${selected.size} ${selected.size === 1 ? 'person' : 'people'}` : 'Select people'}
          </button>
        </div>
      </div>
    </div>
  );
}
