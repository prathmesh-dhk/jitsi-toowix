import React, { useState, useEffect } from 'react';
import { X, Download, FileText, Plus, File, Image, FileSpreadsheet, Check, Link as LinkIcon, Loader2 } from 'lucide-react';
import { auth } from '../lib/firebase';
import type { IPastMeeting } from './PastMeetingsPanel';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

interface IMeetingSharedFilesModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: IPastMeeting | null;
  onFilesChanged?: (files: any[]) => void;
}

interface ISharedFile {
  name: string;
  url: string;
  size?: string;
  sharedBy?: string;
  sharedAt?: string;
}

export function MeetingSharedFilesModal({ isOpen, onClose, meeting, onFilesChanged }: IMeetingSharedFilesModalProps) {
  const [files, setFiles] = useState<ISharedFile[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileUrl, setNewFileUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (meeting) {
      const existing = (meeting as any).sharedFiles;
      if (Array.isArray(existing) && existing.length > 0) {
        setFiles(existing);
      } else {
        const organizerName = meeting.organizer || 'Organizer';
        setFiles([
          {
            name: `${meeting.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_Deck.pdf`,
            url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
            size: '2.4 MB',
            sharedBy: organizerName,
            sharedAt: '10:05 AM',
          },
          {
            name: 'Sprint_Action_Plan.docx',
            url: '#',
            size: '640 KB',
            sharedBy: 'Sarah Chen',
            sharedAt: '10:18 AM',
          },
          {
            name: 'Architecture_Diagram.png',
            url: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=800&q=80',
            size: '1.1 MB',
            sharedBy: organizerName,
            sharedAt: '10:25 AM',
          },
        ]);
      }
    }
  }, [meeting]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !meeting) return null;

  const getFileIcon = (fileName: string) => {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.pdf')) return <FileText size={18} color="#DC2626" />;
    if (lower.endsWith('.csv') || lower.endsWith('.xlsx')) return <FileSpreadsheet size={18} color="#16A34A" />;
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return <Image size={18} color="#2563EB" />;
    return <File size={18} color="#4F46E5" />;
  };

  const handleDownloadFile = (file: ISharedFile) => {
    if (file.url && file.url !== '#') {
      window.open(file.url, '_blank', 'noopener,noreferrer');
    } else {
      // Generate a mock download blob
      const blob = new Blob([`Content of ${file.name}\nShared in meeting ${meeting.name}`], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleAddFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;

    setIsSubmitting(true);
    const newFile: ISharedFile = {
      name: newFileName.trim(),
      url: newFileUrl.trim() || '#',
      size: '1.2 MB',
      sharedBy: meeting.organizer || 'You',
      sharedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const updated = [...files, newFile];
    setFiles(updated);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        await fetch(`${BACKEND_URL}/api/meetings/${meeting.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sharedFiles: updated }),
        });
      }
      onFilesChanged?.(updated);
    } catch (err) {
      console.warn('[MeetingSharedFilesModal] Persist shared file warning:', err);
    } finally {
      setIsSubmitting(false);
      setNewFileName('');
      setNewFileUrl('');
      setShowAddForm(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '640px',
          maxHeight: '85vh',
          backgroundColor: '#FFFFFF',
          borderRadius: '14px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: '#EEF2FF',
                color: '#4F46E5',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <LinkIcon size={18} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#111827' }}>
                Shared Meeting Files
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#6B7280' }}>
                {meeting.name} • {files.length} files shared
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              border: '1px solid #E5E7EB',
              background: '#FFFFFF',
              color: '#6B7280',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Action bar */}
        <div
          style={{
            padding: '12px 24px',
            backgroundColor: '#F9FAFB',
            borderBottom: '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '13px', color: '#4B5563', fontWeight: 500 }}>
            Files and documents shared during the session
          </span>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              height: '32px',
              padding: '0 12px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: '#4F46E5',
              color: '#FFFFFF',
              fontSize: '12px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              cursor: 'pointer',
            }}
          >
            <Plus size={14} />
            Add File
          </button>
        </div>

        {/* Add File inline form */}
        {showAddForm && (
          <form
            onSubmit={handleAddFile}
            style={{
              padding: '16px 24px',
              backgroundColor: '#EEF2FF',
              borderBottom: '1px solid #E0E7FF',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#3730A3' }}>
              Add a shared file or resource
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <input
                type="text"
                placeholder="File name (e.g. Design-Specs.pdf)"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                required
                style={{
                  height: '34px',
                  padding: '0 10px',
                  borderRadius: '6px',
                  border: '1px solid #C7D2FE',
                  fontSize: '12px',
                  outline: 'none',
                  backgroundColor: '#FFFFFF',
                }}
              />
              <input
                type="text"
                placeholder="URL or document link (optional)"
                value={newFileUrl}
                onChange={(e) => setNewFileUrl(e.target.value)}
                style={{
                  height: '34px',
                  padding: '0 10px',
                  borderRadius: '6px',
                  border: '1px solid #C7D2FE',
                  fontSize: '12px',
                  outline: 'none',
                  backgroundColor: '#FFFFFF',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                style={{
                  height: '30px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: '1px solid #D1D5DB',
                  backgroundColor: '#FFFFFF',
                  color: '#4B5563',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  height: '30px',
                  padding: '0 14px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#4F46E5',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Add
              </button>
            </div>
          </form>
        )}

        {/* Files List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {files.map((file, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid #E5E7EB',
                backgroundColor: '#FFFFFF',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    backgroundColor: '#F3F4F6',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  {getFileIcon(file.name)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827', wordBreak: 'break-all' }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>
                    {file.size || '1.2 MB'} • Shared by {file.sharedBy || 'Participant'} {file.sharedAt ? `at ${file.sharedAt}` : ''}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleDownloadFile(file)}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: '1px solid #D1D5DB',
                  backgroundColor: '#FFFFFF',
                  color: '#374151',
                  fontSize: '12px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <Download size={13} />
                Download
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
