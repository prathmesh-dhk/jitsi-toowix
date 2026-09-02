import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface IActionMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  separated?: boolean;
  disabled?: boolean;
  detail?: string;
}

interface IActionMenuProps {
  items: IActionMenuItem[];
  onClose: () => void;
  align?: 'left' | 'right';
  width?: number;
}

export function ActionMenu({ items, onClose, align = 'right', width = 238 }: IActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position] = useState(() => {
    const anchor = document.activeElement instanceof HTMLElement ? document.activeElement.getBoundingClientRect() : null;
    const estimatedHeight = Math.min(items.length * 42 + 12, 520);
    if (!anchor) return { top: 8, left: Math.max(8, window.innerWidth - width - 8) };
    const top = anchor.bottom + estimatedHeight + 8 <= window.innerHeight
      ? anchor.bottom + 6
      : Math.max(8, anchor.top - estimatedHeight - 6);
    const preferredLeft = align === 'right' ? anchor.right - width : anchor.left;
    return { top, left: Math.min(Math.max(8, preferredLeft), window.innerWidth - width - 8) };
  });

  useEffect(() => {
    const closeOnPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="dashboard-action-menu"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width,
        maxHeight: 'min(520px, calc(100vh - 16px))',
        overflowY: 'auto',
        padding: '6px',
        borderRadius: '10px',
        border: '1px solid #E5E7EB',
        background: '#FFFFFF',
        boxShadow: '0 14px 35px rgba(15, 23, 42, 0.16)',
        zIndex: 80,
      }}
    >
      {items.map((item, index) => (
        <button
          key={`${item.label}-${index}`}
          type="button"
          role="menuitem"
          data-destructive={item.destructive || undefined}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            onClose();
            item.onClick();
          }}
          style={{
            width: '100%',
            minHeight: '36px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 10px',
            marginTop: item.separated ? '6px' : 0,
            border: 'none',
            borderTop: item.separated ? '1px solid #E5E7EB' : 'none',
            borderRadius: item.separated ? '0 0 6px 6px' : '6px',
            background: 'transparent',
            color: item.destructive ? '#DC2626' : item.disabled ? '#9CA3AF' : '#374151',
            fontSize: '13px',
            textAlign: 'left',
            cursor: item.disabled ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(event) => {
            if (!item.disabled) event.currentTarget.style.background = item.destructive ? '#FEF2F2' : '#F9FAFB';
          }}
          onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
        >
          {item.icon && <span style={{ width: '16px', display: 'flex', flexShrink: 0 }}>{item.icon}</span>}
          <span style={{ flex: 1 }}>{item.label}</span>
          {item.detail && <span style={{ color: '#9CA3AF', fontSize: '11px', whiteSpace: 'nowrap' }}>{item.detail}</span>}
        </button>
      ))}
    </div>,
    document.body
  );
}
