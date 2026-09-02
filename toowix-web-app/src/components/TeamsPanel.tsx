import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Eye, MoreVertical, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { auth } from '../lib/firebase';
import { ActionMenu, IActionMenuItem } from './ActionMenu';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';
type ApiRole = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'HOST' | 'MEMBER';
type RoleLabel = 'Admin' | 'Subadmin' | 'User';
type Status = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE' | 'INVITED';
type Tab = 'All users' | 'Admins' | 'Subadmins' | 'Users';
type StatusFilter = 'All statuses' | 'Active' | 'Invited' | 'Suspended' | 'Inactive';

interface IApiUser {
  id: string;
  fullName: string;
  email: string;
  avatarUrl?: string | null;
  role: ApiRole;
  status: Status;
  reportsTo?: { _id?: string; id?: string; fullName: string } | string | null;
  lastActiveAt?: string | null;
  updatedAt: string;
  isInvite?: boolean;
}

interface ITeamUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  initials: string;
  role: ApiRole;
  roleLabel: RoleLabel;
  status: Status;
  reportsToId: string | null;
  reportsToName: string;
  lastActive: string;
  isInvite: boolean;
}

interface ITeamsPanelProps {
  currentUserId?: string;
  canManage: boolean;
}

const roleLabel = (role: ApiRole): RoleLabel =>
  role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN' ? 'Admin' : role === 'HOST' ? 'Subadmin' : 'User';

const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';

const displayDate = (iso?: string | null) => {
  if (!iso) return 'Invitation pending';
  const date = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const mapUser = (user: IApiUser): ITeamUser => ({
  id: user.id,
  name: user.fullName,
  email: user.email,
  avatarUrl: user.avatarUrl,
  initials: initials(user.fullName),
  role: user.role,
  roleLabel: roleLabel(user.role),
  status: user.status,
  reportsToId: typeof user.reportsTo === 'object' && user.reportsTo
    ? String(user.reportsTo.id || user.reportsTo._id || '')
    : typeof user.reportsTo === 'string' ? user.reportsTo : null,
  reportsToName: typeof user.reportsTo === 'object' && user.reportsTo ? user.reportsTo.fullName : 'Organization',
  lastActive: user.status === 'INVITED' ? 'Invitation pending' : displayDate(user.lastActiveAt || user.updatedAt),
  isInvite: user.isInvite === true || user.status === 'INVITED',
});

function Avatar({ user }: { user: ITeamUser }) {
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt="" style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#F1F5F9', color: '#334155', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{user.initials}</div>;
}

function RoleBadge({ role }: { role: RoleLabel }) {
  return <span style={{ display: 'inline-flex', padding: '5px 12px', borderRadius: 6, border: `1px solid ${role === 'Admin' ? '#A5B4FC' : '#D1D5DB'}`, color: role === 'Admin' ? '#4F46E5' : '#374151', background: '#FFF', fontSize: 12, fontWeight: 600 }}>{role}</span>;
}

function StatusBadge({ status }: { status: Status }) {
  const data = status === 'ACTIVE' ? ['#22C55E', 'Active'] : status === 'INVITED' ? ['#F59E0B', 'Invited'] : status === 'SUSPENDED' ? ['#EF4444', 'Suspended'] : ['#94A3B8', 'Inactive'];
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: '#475569', fontSize: 13 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: data[0] }} />{data[1]}</span>;
}

export function TeamsPanel({ currentUserId, canManage }: ITeamsPanelProps) {
  const [users, setUsers] = useState<ITeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('All users');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All statuses');
  const [showFilter, setShowFilter] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menuId, setMenuId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ITeamUser | null>(null);
  const [reassignMode, setReassignMode] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [presetManager, setPresetManager] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const fetchUsers = async () => {
    try {
      setError('');
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const response = await fetch(`${BACKEND_URL}/api/team/users`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load the team');
      const mapped: ITeamUser[] = (data.users || []).map(mapUser);
      setUsers(mapped);
      setExpanded(new Set(mapped.filter((user) => user.roleLabel === 'Admin').map((user) => user.id)));
    } catch (err: any) {
      setError(err.message || 'Could not load the team');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => auth.onAuthStateChanged((user) => { if (user) fetchUsers(); }), []);
  useEffect(() => setPage(1), [tab, query, statusFilter]);

  const request = async (path: string, options: RequestInit = {}) => {
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch(`${BACKEND_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'The team could not be updated');
    await fetchUsers();
    return data;
  };

  const updateUser = async (id: string, patch: object) => {
    try {
      await request(`/api/team/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    } catch (err: any) {
      window.alert(err.message);
    }
  };

  const resendInvite = async (user: ITeamUser) => {
    try {
      await request(`/api/team/invites/${user.id.replace('invite:', '')}/resend`, { method: 'POST' });
      window.alert('Invitation resent.');
    } catch (err: any) {
      window.alert(err.message);
    }
  };

  const cancelInvite = async (user: ITeamUser) => {
    if (!window.confirm(`Cancel the invitation for ${user.email}?`)) return;
    try {
      await request(`/api/team/invites/${user.id.replace('invite:', '')}`, { method: 'DELETE' });
    } catch (err: any) {
      window.alert(err.message);
    }
  };

  const admins = users.filter((user) => user.roleLabel === 'Admin' && !user.isInvite);
  const managers = users.filter((user) => (user.roleLabel === 'Admin' || user.roleLabel === 'Subadmin') && !user.isInvite && user.status === 'ACTIVE');
  const counts = {
    admins: users.filter((user) => user.roleLabel === 'Admin').length,
    subadmins: users.filter((user) => user.roleLabel === 'Subadmin').length,
    users: users.filter((user) => user.roleLabel === 'User').length,
  };

  const visibleUsers = useMemo(() => {
    const wantedRole = tab === 'Admins' ? 'Admin' : tab === 'Subadmins' ? 'Subadmin' : tab === 'Users' ? 'User' : null;
    const wantedStatus = statusFilter === 'All statuses' ? null : statusFilter.toUpperCase();
    const text = query.trim().toLowerCase();
    const matches = users.filter((user) =>
      (!wantedRole || user.roleLabel === wantedRole)
      && (!wantedStatus || user.status === wantedStatus)
      && (!text || user.name.toLowerCase().includes(text) || user.email.toLowerCase().includes(text) || user.reportsToName.toLowerCase().includes(text))
    );

    if (tab !== 'All users') return matches.map((user) => ({ user, depth: 0, hasChildren: false }));

    const included = new Set(matches.map((user) => user.id));
    if (text) {
      const byId = new Map(users.map((user) => [user.id, user]));
      matches.forEach((user) => {
        let parent = user.reportsToId ? byId.get(user.reportsToId) : undefined;
        while (parent) {
          included.add(parent.id);
          parent = parent.reportsToId ? byId.get(parent.reportsToId) : undefined;
        }
      });
    }

    const relevant = users.filter((user) => included.has(user.id));
    const childMap = new Map<string, ITeamUser[]>();
    relevant.forEach((user) => {
      if (user.reportsToId && included.has(user.reportsToId)) {
        childMap.set(user.reportsToId, [...(childMap.get(user.reportsToId) || []), user]);
      }
    });

    const result: { user: ITeamUser; depth: number; hasChildren: boolean }[] = [];
    const seen = new Set<string>();
    const add = (user: ITeamUser, depth: number) => {
      if (seen.has(user.id)) return;
      seen.add(user.id);
      const children = childMap.get(user.id) || [];
      result.push({ user, depth, hasChildren: children.length > 0 });
      if (text || expanded.has(user.id)) children.forEach((child) => add(child, depth + 1));
    };

    relevant.filter((user) => user.roleLabel === 'Admin' && !user.reportsToId).forEach((user) => add(user, 0));
    relevant.filter((user) => !seen.has(user.id) && !user.reportsToId).forEach((user) => add(user, 0));
    relevant.filter((user) => !seen.has(user.id)).forEach((user) => add(user, 0));
    return result;
  }, [users, tab, query, statusFilter, expanded]);

  const pageCount = Math.max(1, Math.ceil(visibleUsers.length / pageSize));
  const rows = visibleUsers.slice((page - 1) * pageSize, page * pageSize);

  const menuItems = (user: ITeamUser): IActionMenuItem[] => {
    const items: IActionMenuItem[] = [{ label: 'View details', icon: <Eye size={15} />, onClick: () => setDetail(user) }];
    if (!canManage) return items;
    if (user.isInvite) {
      return [...items,
        { label: 'Resend invitation', onClick: () => resendInvite(user) },
        { label: 'Cancel invitation', destructive: true, separated: true, onClick: () => cancelInvite(user) },
      ];
    }
    if (user.roleLabel !== 'Admin') {
      items.push({ label: 'Promote to Subadmin', disabled: user.role === 'HOST', onClick: () => updateUser(user.id, { role: 'HOST' }) });
      items.push({ label: 'Set as User', disabled: user.role === 'MEMBER', onClick: () => updateUser(user.id, { role: 'MEMBER' }) });
      items.push({ label: 'Change reporting manager', separated: true, onClick: () => { setReassignMode(true); setDetail(user); } });
    }
    if (user.id !== currentUserId) {
      items.push({
        label: user.status === 'SUSPENDED' ? 'Reactivate user' : 'Suspend user',
        destructive: user.status !== 'SUSPENDED',
        separated: true,
        onClick: () => updateUser(user.id, { status: user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' }),
      });
    }
    return items;
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: '0 0 7px', fontSize: 28, color: '#111827', letterSpacing: '-.5px' }}>Teams</h1>
          <p style={{ margin: 0, color: '#64748B', fontSize: 14 }}>Manage admins, subadmins and users in your organization.</p>
        </div>
        {canManage && (
          <button onClick={() => { setPresetManager(undefined); setInviteOpen(true); }} style={primaryButton}>
            <Plus size={17} /> Add user
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 30 }}>
          {(['All users', 'Admins', 'Subadmins', 'Users'] as Tab[]).map((item) => (
            <button key={item} onClick={() => setTab(item)} style={{ padding: '0 0 13px', border: 0, borderBottom: tab === item ? '2px solid #4F46E5' : '2px solid transparent', background: 'transparent', color: tab === item ? '#4F46E5' : '#475569', fontSize: 14, fontWeight: tab === item ? 700 : 500, cursor: 'pointer' }}>{item}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <Search size={17} style={{ position: 'absolute', left: 13, top: 13, color: '#64748B' }} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users..." style={{ width: 260, height: 44, padding: '0 13px 0 42px', border: '1px solid #D1D5DB', borderRadius: 9, outline: 0, fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowFilter(!showFilter)} style={secondaryButton}><SlidersHorizontal size={16} /> Filter{statusFilter !== 'All statuses' ? ' · 1' : ''}</button>
            {showFilter && (
              <div style={{ position: 'absolute', top: 49, right: 0, zIndex: 20, width: 170, padding: 7, background: '#FFF', border: '1px solid #E5E7EB', borderRadius: 9, boxShadow: '0 12px 28px rgba(15,23,42,.14)' }}>
                {(['All statuses', 'Active', 'Invited', 'Suspended', 'Inactive'] as StatusFilter[]).map((item) => (
                  <button key={item} onClick={() => { setStatusFilter(item); setShowFilter(false); }} style={{ display: 'block', width: '100%', padding: '9px 10px', border: 0, borderRadius: 6, background: statusFilter === item ? '#EEF2FF' : '#FFF', color: statusFilter === item ? '#4F46E5' : '#374151', textAlign: 'left', cursor: 'pointer' }}>{item}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ border: '1px solid #E2E8F0', borderRadius: 11, background: '#FFF', overflow: 'hidden', boxShadow: '0 5px 18px rgba(15,23,42,.04)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                {['USER', 'ROLE', 'REPORTS TO', 'STATUS', 'LAST ACTIVE', 'ACTIONS'].map((label) => (
                  <th key={label} style={{ padding: '15px 18px', color: '#64748B', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textAlign: label === 'ACTIONS' ? 'right' : 'left' }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={emptyStyle}>Loading team...</td></tr>}
              {!loading && error && <tr><td colSpan={6} style={{ ...emptyStyle, color: '#DC2626' }}>{error}</td></tr>}
              {!loading && !error && rows.length === 0 && <tr><td colSpan={6} style={emptyStyle}>No team members match this view.</td></tr>}
              {!loading && !error && rows.map(({ user, depth, hasChildren }) => (
                <tr key={user.id} style={{ borderBottom: '1px solid #E5E7EB', background: user.roleLabel === 'Admin' ? '#F8FAFF' : '#FFF' }}>
                  <td style={cellStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: depth * 34 }}>
                      {hasChildren ? (
                        <button onClick={() => setExpanded((old) => { const next = new Set(old); next.has(user.id) ? next.delete(user.id) : next.add(user.id); return next; })} style={treeButton}>
                          {expanded.has(user.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      ) : (
                        <span style={{ width: 22, height: 22, borderLeft: depth ? '2px solid #CBD5E1' : 0, borderBottom: depth ? '2px solid #CBD5E1' : 0, borderRadius: '0 0 0 8px' }} />
                      )}
                      <Avatar user={user} />
                      <div><div style={{ color: '#111827', fontSize: 13, fontWeight: 700 }}>{user.name}</div><div style={{ color: '#64748B', fontSize: 12, marginTop: 3 }}>{user.email}</div></div>
                    </div>
                  </td>
                  <td style={cellStyle}><RoleBadge role={user.roleLabel} /></td>
                  <td style={{ ...cellStyle, color: '#526079', fontSize: 13 }}>{user.reportsToName}</td>
                  <td style={cellStyle}><StatusBadge status={user.status} /></td>
                  <td style={{ ...cellStyle, color: '#526079', fontSize: 13 }}>{user.lastActive}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
                      {user.roleLabel === 'Admin' && canManage && (
                        <button onClick={() => { setPresetManager(user.id); setInviteOpen(true); }} style={textButton}><Plus size={14} /> Add under this admin</button>
                      )}
                      {user.roleLabel !== 'Admin' && <button onClick={() => setDetail(user)} style={viewButton}>View</button>}
                      <button aria-label={`Actions for ${user.name}`} onClick={() => setMenuId(menuId === user.id ? null : user.id)} style={iconButton}><MoreVertical size={16} /></button>
                      {menuId === user.id && <ActionMenu items={menuItems(user)} onClose={() => setMenuId(null)} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ minHeight: 64, padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#526079', fontSize: 13 }}>
          <span>{counts.admins} admin{counts.admins === 1 ? '' : 's'} · {counts.subadmins} subadmin{counts.subadmins === 1 ? '' : 's'} · {counts.users} user{counts.users === 1 ? '' : 's'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={page === 1} onClick={() => setPage(page - 1)} style={pagerButton}><ChevronLeft size={16} /></button>
            <button style={{ ...pagerButton, borderColor: '#6366F1', color: '#4F46E5' }}>{page}</button>
            <button disabled={page === pageCount} onClick={() => setPage(page + 1)} style={pagerButton}><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      {detail && <UserDetails user={detail} managers={managers} canManage={canManage} reassignMode={reassignMode} onUpdate={updateUser} onClose={() => { setDetail(null); setReassignMode(false); }} />}
      {inviteOpen && <InviteModal admins={admins} managers={managers} presetManager={presetManager} onClose={() => { setInviteOpen(false); setPresetManager(undefined); }} onSubmit={async (payload) => { await request('/api/team/invites', { method: 'POST', body: JSON.stringify(payload) }); setInviteOpen(false); setPresetManager(undefined); }} />}
    </div>
  );
}

function UserDetails({ user, managers, canManage, reassignMode, onUpdate, onClose }: {
  user: ITeamUser;
  managers: ITeamUser[];
  canManage: boolean;
  reassignMode: boolean;
  onUpdate: (id: string, patch: object) => Promise<void>;
  onClose: () => void;
}) {
  const [manager, setManager] = useState(user.reportsToId || '');
  const managerOptions = managers.filter((item) => item.id !== user.id && (user.roleLabel !== 'Subadmin' || item.roleLabel === 'Admin'));
  return (
    <div style={overlayStyle} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div style={{ width: 'min(430px, 92vw)', background: '#FFF', borderRadius: 14, padding: 24, boxShadow: '0 20px 50px rgba(15,23,42,.22)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 12 }}><Avatar user={user} /><div><strong>{user.name}</strong><div style={{ color: '#64748B', fontSize: 12, marginTop: 4 }}>{user.email}</div></div></div>
          <button onClick={onClose} style={closeButton}><X size={18} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 24 }}>
          <Info label="Role"><RoleBadge role={user.roleLabel} /></Info>
          <Info label="Status"><StatusBadge status={user.status} /></Info>
          <Info label="Reports to">{user.reportsToName}</Info>
          <Info label="Last active">{user.lastActive}</Info>
        </div>
        {canManage && !user.isInvite && user.roleLabel !== 'Admin' && (
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid #E5E7EB' }}>
            <label style={labelStyle}>{reassignMode ? 'Change reporting manager' : 'Reporting manager'}</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
              <select value={manager} onChange={(event) => setManager(event.target.value)} style={selectStyle}>
                <option value="">Unassigned</option>
                {managerOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <button onClick={async () => { await onUpdate(user.id, { reportsTo: manager || null }); onClose(); }} style={{ ...primaryButton, height: 42 }}>Save</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InviteModal({ admins, managers, presetManager, onClose, onSubmit }: {
  admins: ITeamUser[];
  managers: ITeamUser[];
  presetManager?: string;
  onClose: () => void;
  onSubmit: (payload: object) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ApiRole>('MEMBER');
  const [reportsTo, setReportsTo] = useState(presetManager || admins[0]?.id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const managerOptions = role === 'HOST' ? managers.filter((manager) => manager.roleLabel === 'Admin') : managers;

  const submit = async () => {
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      await onSubmit({ fullName: name.trim(), email: email.trim(), role, reportsTo: role === 'COMPANY_ADMIN' ? null : reportsTo || null });
    } catch (err: any) {
      setError(err.message || 'Could not send the invitation.');
      setSaving(false);
    }
  };

  return (
    <div style={overlayStyle} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div style={{ width: 'min(460px, 92vw)', background: '#FFF', borderRadius: 14, padding: 24, boxShadow: '0 20px 50px rgba(15,23,42,.22)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <div><h2 style={{ margin: 0, fontSize: 19 }}>Add user</h2><p style={{ margin: '5px 0 0', color: '#64748B', fontSize: 13 }}>Invite someone to your organization.</p></div>
          <button onClick={onClose} style={closeButton}><X size={18} /></button>
        </div>
        {error && <div style={{ padding: 10, marginBottom: 14, borderRadius: 7, background: '#FEF2F2', color: '#B91C1C', fontSize: 12 }}>{error}</div>}
        <label style={labelStyle}>Full name</label>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Sarah John" style={inputStyle} />
        <label style={labelStyle}>Work email</label>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="sarah@company.com" style={inputStyle} />
        <label style={labelStyle}>Role</label>
        <select value={role} onChange={(event) => { setRole(event.target.value as ApiRole); if (event.target.value === 'COMPANY_ADMIN') setReportsTo(''); }} style={{ ...selectStyle, margin: '6px 0 15px' }}>
          <option value="MEMBER">User</option><option value="HOST">Subadmin</option><option value="COMPANY_ADMIN">Admin</option>
        </select>
        {role !== 'COMPANY_ADMIN' && (
          <><label style={labelStyle}>Reports to</label><select value={reportsTo} onChange={(event) => setReportsTo(event.target.value)} style={{ ...selectStyle, margin: '6px 0 20px' }}><option value="">Unassigned</option>{managerOptions.map((manager) => <option key={manager.id} value={manager.id}>{manager.name} · {manager.roleLabel}</option>)}</select></>
        )}
        <button disabled={saving} onClick={submit} style={{ ...primaryButton, width: '100%', justifyContent: 'center', opacity: saving ? .65 : 1 }}>{saving ? 'Sending invitation...' : 'Send invitation'}</button>
      </div>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div style={{ color: '#94A3B8', fontSize: 11, textTransform: 'uppercase' }}>{label}</div><div style={{ color: '#111827', fontSize: 13, fontWeight: 600, marginTop: 5 }}>{children}</div></div>;
}

const primaryButton: React.CSSProperties = { height: 42, padding: '0 20px', border: 0, borderRadius: 8, background: '#4F46E5', color: '#FFF', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', boxShadow: '0 2px 5px rgba(79,70,229,.22)' };
const secondaryButton: React.CSSProperties = { height: 44, padding: '0 17px', border: '1px solid #D1D5DB', borderRadius: 9, background: '#FFF', color: '#334155', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' };
const cellStyle: React.CSSProperties = { padding: '14px 18px', height: 66, boxSizing: 'border-box' };
const emptyStyle: React.CSSProperties = { padding: '48px 20px', textAlign: 'center', color: '#94A3B8', fontSize: 13 };
const viewButton: React.CSSProperties = { height: 34, padding: '0 17px', border: '1px solid #D1D5DB', borderRadius: 7, background: '#FFF', color: '#1E293B', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const textButton: React.CSSProperties = { height: 34, padding: '0 8px', border: 0, background: 'transparent', color: '#4F46E5', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' };
const iconButton: React.CSSProperties = { width: 34, height: 34, border: 0, background: 'transparent', color: '#475569', display: 'grid', placeItems: 'center', cursor: 'pointer' };
const treeButton: React.CSSProperties = { width: 22, height: 22, padding: 0, border: 0, background: 'transparent', color: '#475569', cursor: 'pointer', display: 'grid', placeItems: 'center' };
const pagerButton: React.CSSProperties = { width: 38, height: 36, borderRadius: 7, border: '1px solid #D1D5DB', background: '#FFF', color: '#475569', display: 'grid', placeItems: 'center', cursor: 'pointer' };
const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.38)', display: 'grid', placeItems: 'center' };
const closeButton: React.CSSProperties = { width: 32, height: 32, border: 0, background: 'transparent', color: '#64748B', cursor: 'pointer' };
const labelStyle: React.CSSProperties = { display: 'block', color: '#475569', fontSize: 12, fontWeight: 600 };
const inputStyle: React.CSSProperties = { width: '100%', height: 42, padding: '0 12px', margin: '6px 0 15px', border: '1px solid #D1D5DB', borderRadius: 8, outline: 0, boxSizing: 'border-box', fontSize: 13 };
const selectStyle: React.CSSProperties = { width: '100%', height: 42, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 8, background: '#FFF', boxSizing: 'border-box', fontSize: 13 };
