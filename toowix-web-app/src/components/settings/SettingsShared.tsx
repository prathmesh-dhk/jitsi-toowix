import React, { createContext, useContext, useState } from 'react';

// Shared "is this section dirty" context so the shell (sub-nav + rail) can intercept
// navigation and show the unsaved-changes confirmation, without React Router's data-router
// APIs (this app uses a plain BrowserRouter, so unstable_useBlocker isn't available).
interface IDirtyContext {
  isDirty: boolean;
  setDirty: (dirty: boolean) => void;
  requestNavigation: (go: () => void) => void;
}

const DirtyContext = createContext<IDirtyContext>({
  isDirty: false,
  setDirty: () => {},
  requestNavigation: (go) => go(),
});

export function useSettingsDirty() {
  return useContext(DirtyContext);
}

export function SettingsDirtyProvider({ children }: { children: React.ReactNode }) {
  const [isDirty, setIsDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);

  const requestNavigation = (go: () => void) => {
    if (isDirty) {
      setPendingNav(() => go);
    } else {
      go();
    }
  };

  return (
    <DirtyContext.Provider value={{ isDirty, setDirty: setIsDirty, requestNavigation }}>
      {children}
      {pendingNav && (
        <div
          role="alertdialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div style={{ width: 'min(400px, 92vw)', background: '#FFFFFF', borderRadius: '14px', padding: '22px', boxShadow: '0 20px 45px rgba(15,23,42,0.2)' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 700, color: '#141B2B' }}>Unsaved changes</h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#6B7280' }}>
              You have unsaved changes. Do you want to discard them?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => setPendingNav(null)}
                style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#FFFFFF', color: '#141B2B', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                Keep editing
              </button>
              <button
                onClick={() => {
                  setIsDirty(false);
                  const go = pendingNav;
                  setPendingNav(null);
                  go?.();
                }}
                style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#DC2626', color: '#FFFFFF', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
              >
                Discard changes
              </button>
            </div>
          </div>
        </div>
      )}
    </DirtyContext.Provider>
  );
}

// ---- Shared small UI building blocks reused by every section, matching the app's
// existing inline-style design language (indigo accent, thin borders, no gradients). ----

export const sectionHeaderStyle: React.CSSProperties = { marginBottom: '24px' };
export const sectionTitleStyle: React.CSSProperties = { fontSize: '20px', fontWeight: 800, color: '#141B2B', margin: '0 0 4px 0' };
export const sectionSubtitleStyle: React.CSSProperties = { fontSize: '13px', color: '#6B7280', margin: 0 };
export const cardStyle: React.CSSProperties = { backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '22px' };
export const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' };
export const inputStyle: React.CSSProperties = { width: '100%', height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', color: '#141B2B', outline: 'none', boxSizing: 'border-box', background: '#FFFFFF' };
export const readOnlyInputStyle: React.CSSProperties = { ...inputStyle, background: '#F9FAFB', color: '#6B7280', cursor: 'not-allowed' };

export function SettingsFooterActions({
  onCancel,
  onSave,
  saving,
  disabled,
}: {
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  disabled: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '22px', paddingTop: '18px', borderTop: '1px solid #F3F4F6' }}>
      <button
        onClick={onCancel}
        disabled={saving}
        style={{ padding: '9px 18px', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#FFFFFF', color: '#141B2B', fontSize: '13px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}
      >
        Cancel
      </button>
      <button
        onClick={onSave}
        disabled={saving || disabled}
        style={{
          padding: '9px 20px',
          borderRadius: '8px',
          border: 'none',
          background: saving || disabled ? '#C7D2FE' : '#4F46E5',
          color: '#FFFFFF',
          fontSize: '13px',
          fontWeight: 700,
          cursor: saving || disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {saving ? 'Saving...' : 'Save changes'}
      </button>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 0', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <span style={{ fontSize: '13px', color: '#374151' }}>{label}</span>
      <span
        onClick={() => !disabled && onChange(!checked)}
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onChange(!checked); } }}
        style={{
          width: '38px',
          height: '22px',
          borderRadius: '11px',
          background: checked ? '#4F46E5' : '#D1D5DB',
          position: 'relative',
          transition: 'background 0.15s ease',
          flexShrink: 0,
        }}
      >
        <span style={{ position: 'absolute', top: '2px', left: checked ? '18px' : '2px', width: '18px', height: '18px', borderRadius: '50%', background: '#FFFFFF', transition: 'left 0.15s ease', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
      </span>
    </label>
  );
}

export function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  React.useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 1100,
        padding: '12px 18px',
        borderRadius: '10px',
        background: type === 'success' ? '#141B2B' : '#DC2626',
        color: '#FFFFFF',
        fontSize: '13px',
        fontWeight: 600,
        boxShadow: '0 10px 25px rgba(0,0,0,0.25)',
      }}
    >
      {message}
    </div>
  );
}
