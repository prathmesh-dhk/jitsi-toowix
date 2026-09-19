import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Trash2, Pencil, X, Check, Mail } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { IContact, createContact, deleteContact, listContacts, updateContact } from '../lib/contactsApi';

// Dashboard section: the user's private address book of people and email addresses.
export function ContactBookPanel() {
  const { isDark } = useTheme();
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [rowError, setRowError] = useState('');

  const load = () => {
    setLoading(true);
    listContacts()
      .then((list) => { setContacts(list); setError(''); })
      .catch((err) => setError(err.message || 'Could not load contacts'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const fg = isDark ? '#F9FAFB' : '#141B2B';
  const muted = isDark ? '#9CA3AF' : '#6B7280';
  const cardBg = isDark ? '#111827' : '#FFFFFF';
  const border = isDark ? '#1F2937' : '#E5E7EB';
  const inputStyle = {
    height: '40px',
    padding: '0 12px',
    borderRadius: '8px',
    border: `1px solid ${isDark ? '#374151' : '#D1D5DB'}`,
    backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
    color: fg,
    fontSize: '13.5px',
    outline: 'none',
    boxSizing: 'border-box' as const,
    minWidth: 0
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();

    return contacts.filter((c) => !q || c.name.toLowerCase().includes(q) || c.email.includes(q));
  }, [ contacts, query ]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const created = await createContact(name, email);

      setContacts((prev) => [ ...prev, created ].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setEmail('');
    } catch (err: any) {
      setError(err.message || 'Could not save the contact');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (c: IContact) => {
    setEditingId(c.id);
    setEditName(c.name);
    setEditEmail(c.email);
    setRowError('');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const updated = await updateContact(editingId, editName, editEmail);

      setContacts((prev) => prev.map((c) => (c.id === editingId ? updated : c)).sort((a, b) => a.name.localeCompare(b.name)));
      setEditingId(null);
      setRowError('');
    } catch (err: any) {
      setRowError(err.message || 'Could not update the contact');
    }
  };

  const remove = async (c: IContact) => {
    if (!window.confirm(`Remove ${c.name} from your contact book?`)) return;
    try {
      await deleteContact(c.id);
      setContacts((prev) => prev.filter((x) => x.id !== c.id));
    } catch (err: any) {
      setError(err.message || 'Could not delete the contact');
    }
  };

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', width: '100%' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: 700, color: fg }}>Contact book</h2>
      <p style={{ margin: '0 0 20px', fontSize: '13.5px', color: muted }}>
        Save people once, then add them to meetings and invitations from your contact book.
      </p>

      <form onSubmit={handleAdd} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '14px', borderRadius: '12px', border: `1px solid ${border}`, backgroundColor: cardBg, marginBottom: '16px' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={100} style={{ ...inputStyle, flex: '1 1 160px' }} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" type="email" style={{ ...inputStyle, flex: '2 1 220px' }} />
        <button
          type="submit"
          disabled={saving || !name.trim() || !email.trim()}
          style={{ height: '40px', padding: '0 16px', borderRadius: '8px', border: 'none', fontWeight: 700, fontSize: '13.5px', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '6px', cursor: saving || !name.trim() || !email.trim() ? 'not-allowed' : 'pointer', backgroundColor: saving || !name.trim() || !email.trim() ? '#A5B4FC' : '#4F46E5' }}
        >
          <Plus size={16} /> Add contact
        </button>
      </form>

      {error && <p role="alert" style={{ color: '#DC2626', fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...inputStyle, marginBottom: '12px' }}>
        <Search size={15} color={muted} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search contacts" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: fg, fontSize: '13.5px' }} />
      </div>

      <div style={{ borderRadius: '12px', border: `1px solid ${border}`, backgroundColor: cardBg, overflow: 'hidden' }}>
        {loading && <p style={{ textAlign: 'center', color: muted, padding: '24px', margin: 0, fontSize: '13.5px' }}>Loading contacts...</p>}
        {!loading && visible.length === 0 && (
          <p style={{ textAlign: 'center', color: muted, padding: '28px 16px', margin: 0, fontSize: '13.5px' }}>
            {contacts.length === 0 ? 'No contacts yet. Add your first contact above.' : 'No contacts match your search.'}
          </p>
        )}
        {visible.map((c, i) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderTop: i === 0 ? 'none' : `1px solid ${border}` }}>
            <span style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: isDark ? 'rgba(99,102,241,0.2)' : '#E0E7FF', color: '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>
              {(c.name.trim() || '?').charAt(0).toUpperCase()}
            </span>
            {editingId === c.id ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1, minWidth: 0 }}>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ ...inputStyle, flex: '1 1 130px', height: '34px' }} />
                  <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} type="email" style={{ ...inputStyle, flex: '2 1 180px', height: '34px' }} />
                  {rowError && <span style={{ flexBasis: '100%', color: '#DC2626', fontSize: '12px' }}>{rowError}</span>}
                </div>
                <button onClick={saveEdit} aria-label="Save" style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer' }}><Check size={18} /></button>
                <button onClick={() => setEditingId(null)} aria-label="Cancel" style={{ background: 'none', border: 'none', color: muted, cursor: 'pointer' }}><X size={18} /></button>
              </>
            ) : (
              <>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                  <div style={{ fontSize: '12.5px', color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
                </div>
                <a href={`mailto:${c.email}`} aria-label={`Email ${c.name}`} style={{ color: muted, display: 'flex' }}><Mail size={16} /></a>
                <button onClick={() => startEdit(c)} aria-label={`Edit ${c.name}`} style={{ background: 'none', border: 'none', color: muted, cursor: 'pointer' }}><Pencil size={16} /></button>
                <button onClick={() => remove(c)} aria-label={`Delete ${c.name}`} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
              </>
            )}
          </div>
        ))}
      </div>
      {!loading && contacts.length > 0 && (
        <p style={{ margin: '10px 2px 0', fontSize: '12px', color: muted }}>{contacts.length} {contacts.length === 1 ? 'contact' : 'contacts'}</p>
      )}
    </div>
  );
}
