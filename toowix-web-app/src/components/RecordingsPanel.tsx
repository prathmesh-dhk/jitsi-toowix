import React, { useState, useEffect } from 'react';
import { Copy, Download, Edit3, Eye, FileAudio, FileText, FolderInput, LockKeyhole, MoreVertical, Play, Search, Share2, SlidersHorizontal, Trash2, Video, Clock, Database, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { auth } from '../lib/firebase';
import { ActionMenu, IActionMenuItem } from './ActionMenu';

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

interface IRecording {
  id: string;
  name: string;
  organizerInitials: string;
  organizerName: string;
  recordedOn: string;
  duration: string;
  size: string;
  sizeBytes: number;
  ownerId?: string;
  fileUrl?: string;
  audioUrl?: string;
  audioSizeBytes?: number;
  transcriptUrl?: string;
  transcriptSizeBytes?: number;
  transcriptFormat?: 'TXT' | 'PDF';
  captionsUrl?: string;
  captionsSizeBytes?: number;
  captionsFormat?: 'VTT' | 'SRT';
  chatUrl?: string;
  chatSizeBytes?: number;
  archiveUrl?: string;
  archiveSizeBytes?: number;
  folder?: string;
  allowDownload?: boolean;
  allowShare?: boolean;
}

interface IApiRecording {
  id: string;
  name: string;
  recordedAt: string;
  durationMinutes: number;
  sizeBytes: number;
  createdBy?: { _id?: string; id?: string; fullName?: string; email?: string } | string;
  fileUrl?: string;
  audioUrl?: string;
  audioSizeBytes?: number;
  transcriptUrl?: string;
  transcriptSizeBytes?: number;
  transcriptFormat?: 'TXT' | 'PDF';
  captionsUrl?: string;
  captionsSizeBytes?: number;
  captionsFormat?: 'VTT' | 'SRT';
  chatUrl?: string;
  chatSizeBytes?: number;
  archiveUrl?: string;
  archiveSizeBytes?: number;
  folder?: string;
  allowDownload?: boolean;
  allowShare?: boolean;
}

const initialsOf = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '?';

const formatDuration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
};

const formatSize = (bytes: number) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};

const mapApiRecording = (r: IApiRecording): IRecording => {
  const organizerName = typeof r.createdBy === 'object' ? r.createdBy?.fullName || r.createdBy?.email || 'Unknown' : 'Unknown';
  return {
    id: r.id,
    name: r.name,
    organizerInitials: initialsOf(organizerName),
    organizerName,
    recordedOn: new Date(r.recordedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
      ', ' + new Date(r.recordedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    duration: formatDuration(r.durationMinutes),
    size: formatSize(r.sizeBytes),
    sizeBytes: r.sizeBytes,
    ownerId: typeof r.createdBy === 'object' ? r.createdBy?._id || r.createdBy?.id : r.createdBy,
    fileUrl: r.fileUrl,
    audioUrl: r.audioUrl,
    audioSizeBytes: r.audioSizeBytes,
    transcriptUrl: r.transcriptUrl,
    transcriptSizeBytes: r.transcriptSizeBytes,
    transcriptFormat: r.transcriptFormat || 'TXT',
    captionsUrl: r.captionsUrl,
    captionsSizeBytes: r.captionsSizeBytes,
    captionsFormat: r.captionsFormat || 'VTT',
    chatUrl: r.chatUrl,
    chatSizeBytes: r.chatSizeBytes,
    archiveUrl: r.archiveUrl,
    archiveSizeBytes: r.archiveSizeBytes,
    folder: r.folder,
    allowDownload: r.allowDownload,
    allowShare: r.allowShare,
  };
};

export function RecordingsPanel() {
  const [searchQuery, setSearchQuery] = useState('');
  const [page] = useState(1);
  const [recordings, setRecordings] = useState<IRecording[]>([]);
  const [stats, setStats] = useState({ count: 0, totalDurationMinutes: 0, totalSizeBytes: 0 });
  const [loading, setLoading] = useState(true);
  const [openMenu, setOpenMenu] = useState<{ id: string; kind: 'actions' | 'downloads' } | null>(null);
  const [selectedRecording, setSelectedRecording] = useState<IRecording | null>(null);

  const cachedUser = (() => {
    try { return JSON.parse(localStorage.getItem('toowix_user') || '{}'); } catch { return {}; }
  })();
  const currentUserId = String(cachedUser.id || cachedUser._id || '');
  const isAdmin = cachedUser.role === 'COMPANY_ADMIN' || cachedUser.role === 'SUPER_ADMIN';

  const canManage = (recording: IRecording) => isAdmin || (!!currentUserId && recording.ownerId === currentUserId);
  const canDownload = (recording: IRecording) => canManage(recording) || recording.allowDownload === true;
  const canShare = (recording: IRecording) => canManage(recording) || recording.allowShare === true;

  const downloadFile = (url: string | undefined, filename: string) => {
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const fileOptions = (recording: IRecording): IActionMenuItem[] => [
    ...(recording.fileUrl ? [{ label: 'Download video — MP4', icon: <Video size={15} />, detail: recording.size, onClick: () => downloadFile(recording.fileUrl, `${recording.name}.mp4`) }] : []),
    ...(recording.audioUrl ? [{ label: 'Download audio only — MP3', icon: <FileAudio size={15} />, detail: formatSize(recording.audioSizeBytes || 0), onClick: () => downloadFile(recording.audioUrl, `${recording.name}.mp3`) }] : []),
    ...(recording.transcriptUrl ? [{ label: `Download transcript — ${recording.transcriptFormat || 'TXT'}`, icon: <FileText size={15} />, detail: formatSize(recording.transcriptSizeBytes || 0), onClick: () => downloadFile(recording.transcriptUrl, `${recording.name}-transcript.${(recording.transcriptFormat || 'TXT').toLowerCase()}`) }] : []),
    ...(recording.captionsUrl ? [{ label: `Download captions — ${recording.captionsFormat || 'VTT'}`, icon: <FileText size={15} />, detail: formatSize(recording.captionsSizeBytes || 0), onClick: () => downloadFile(recording.captionsUrl, `${recording.name}-captions.${(recording.captionsFormat || 'VTT').toLowerCase()}`) }] : []),
    ...(recording.chatUrl ? [{ label: 'Download meeting chat — TXT', icon: <FileText size={15} />, detail: formatSize(recording.chatSizeBytes || 0), onClick: () => downloadFile(recording.chatUrl, `${recording.name}-chat.txt`) }] : []),
    ...(recording.archiveUrl ? [{ label: 'Download all files — ZIP', icon: <Download size={15} />, detail: formatSize(recording.archiveSizeBytes || 0), onClick: () => downloadFile(recording.archiveUrl, `${recording.name}.zip`) }] : []),
  ];

  const playRecording = (recording: IRecording) => recording.fileUrl ? window.open(recording.fileUrl, '_blank', 'noopener,noreferrer') : window.alert('No video file is available for this recording.');

  const renameRecording = async (recording: IRecording) => {
    const name = window.prompt('Recording name', recording.name)?.trim();
    if (!name || name === recording.name) return;
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch(`${BACKEND_URL}/api/recordings/${recording.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ name }) });
    if (response.ok) setRecordings((items) => items.map((item) => item.id === recording.id ? { ...item, name } : item));
    else window.alert('Could not rename the recording.');
  };

  const moveRecording = async (recording: IRecording) => {
    const folder = window.prompt('Move to folder', recording.folder || '')?.trim();
    if (folder === undefined) return;
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch(`${BACKEND_URL}/api/recordings/${recording.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ folder }) });
    if (response.ok) setRecordings((items) => items.map((item) => item.id === recording.id ? { ...item, folder } : item));
    else window.alert('Could not move the recording.');
  };

  const shareRecording = async (recording: IRecording) => {
    const url = recording.fileUrl || `${window.location.origin}/recordings/${recording.id}`;
    if (navigator.share) await navigator.share({ title: recording.name, url });
    else {
      await navigator.clipboard.writeText(url);
      window.alert('Recording link copied.');
    }
  };

  const deleteRecording = async (recording: IRecording) => {
    if (!window.confirm(`Delete “${recording.name}”? This cannot be undone.`)) return;
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch(`${BACKEND_URL}/api/recordings/${recording.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) setRecordings((items) => items.filter((item) => item.id !== recording.id));
    else window.alert('Could not delete the recording.');
  };

  const recordingMenu = (recording: IRecording): IActionMenuItem[] => [
    { label: 'Play recording', icon: <Play size={15} />, onClick: () => playRecording(recording) },
    { label: 'Open recording details', icon: <Eye size={15} />, onClick: () => setSelectedRecording(recording) },
    { label: 'Copy recording link', icon: <Copy size={15} />, onClick: () => navigator.clipboard.writeText(recording.fileUrl || `${window.location.origin}/recordings/${recording.id}`) },
    ...(canShare(recording) ? [{ label: 'Share recording', icon: <Share2 size={15} />, onClick: () => shareRecording(recording) }] : []),
    ...(canManage(recording) ? [{ label: 'Rename recording', icon: <Edit3 size={15} />, onClick: () => renameRecording(recording) }] : []),
    ...(canDownload(recording) && recording.fileUrl ? [{ label: 'Download video', icon: <Download size={15} />, onClick: () => downloadFile(recording.fileUrl, `${recording.name}.mp4`) }] : []),
    ...(canDownload(recording) && recording.audioUrl ? [{ label: 'Download audio', icon: <FileAudio size={15} />, onClick: () => downloadFile(recording.audioUrl, `${recording.name}.mp3`) }] : []),
    ...(recording.transcriptUrl ? [{ label: 'View transcript', icon: <FileText size={15} />, onClick: () => window.open(recording.transcriptUrl, '_blank', 'noopener,noreferrer') }] : []),
    ...(canDownload(recording) && recording.transcriptUrl ? [{ label: 'Download transcript', icon: <Download size={15} />, onClick: () => downloadFile(recording.transcriptUrl, `${recording.name}-transcript.${(recording.transcriptFormat || 'TXT').toLowerCase()}`) }] : []),
    { label: 'Move to folder', icon: <FolderInput size={15} />, onClick: () => moveRecording(recording) },
    ...(canManage(recording) ? [{ label: 'Manage access', icon: <LockKeyhole size={15} />, onClick: () => window.alert('Access controls are set by the recording owner or workspace admin.') }] : []),
    ...(canManage(recording) ? [{ label: 'Delete recording', icon: <Trash2 size={15} />, destructive: true, separated: true, onClick: () => deleteRecording(recording) }] : []),
  ];

  useEffect(() => {
    const fetchRecordings = async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) return;
        const response = await fetch(`${BACKEND_URL}/api/recordings`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = await response.json();
        if (response.ok) {
          setRecordings((data.recordings || []).map(mapApiRecording));
          setStats(data.stats || { count: 0, totalDurationMinutes: 0, totalSizeBytes: 0 });
        }
      } catch (e) {
        console.error('[Recordings] Failed to fetch:', e);
      } finally {
        setLoading(false);
      }
    };

    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) fetchRecordings();
    });
    return () => unsubscribe();
  }, []);

  const filtered = recordings.filter(
    (r) =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.organizerName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalCount = stats.count;
  const totalDuration = formatDuration(stats.totalDurationMinutes);
  const totalStorage = formatSize(stats.totalSizeBytes);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#141B2B', letterSpacing: '-0.5px', margin: '0 0 6px 0' }}>Recordings</h1>
          <p style={{ fontSize: '14px', color: '#6B7280', margin: 0 }}>View, play and manage your recorded meetings.</p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search recordings..."
              style={{ width: '240px', height: '40px', paddingLeft: '36px', paddingRight: '14px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <button
            style={{ height: '40px', padding: '0 16px', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#FFFFFF', color: '#374151', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
          >
            <SlidersHorizontal size={15} />
            Filter
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '46px', height: '46px', borderRadius: '10px', backgroundColor: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Video size={20} color="#4B5563" />
          </div>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#141B2B', lineHeight: 1.1 }}>{totalCount}</div>
            <div style={{ fontSize: '13px', color: '#6B7280' }}>Recordings</div>
          </div>
        </div>

        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '46px', height: '46px', borderRadius: '10px', backgroundColor: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Clock size={20} color="#4B5563" />
          </div>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#141B2B', lineHeight: 1.1 }}>{totalDuration}</div>
            <div style={{ fontSize: '13px', color: '#6B7280' }}>Total duration</div>
          </div>
        </div>

        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '46px', height: '46px', borderRadius: '10px', backgroundColor: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Database size={20} color="#4B5563" />
          </div>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#141B2B', lineHeight: 1.1 }}>{totalStorage}</div>
            <div style={{ fontSize: '13px', color: '#6B7280' }}>Storage used</div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>RECORDING</th>
                <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>ORGANIZED BY</th>
                <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>RECORDED ON</th>
                <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>DURATION</th>
                <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>SIZE</th>
                <th style={{ textAlign: 'right', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} style={{ padding: '32px 18px', textAlign: 'center', fontSize: '13px', color: '#9CA3AF' }}>
                    Loading recordings...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '32px 18px', textAlign: 'center', fontSize: '13px', color: '#9CA3AF' }}>
                    No recordings yet.
                  </td>
                </tr>
              )}
              {filtered.map((rec) => (
                <tr key={rec.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '52px', height: '38px', borderRadius: '6px', backgroundColor: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Play size={14} color="#9CA3AF" fill="#9CA3AF" />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#141B2B', whiteSpace: 'nowrap' }}>{rec.name}</div>
                        <div style={{ fontSize: '12px', color: '#9CA3AF' }}>MP4 Recording</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#EEF2FF', color: '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>
                        {rec.organizerInitials}
                      </div>
                      <span style={{ fontSize: '13px', color: '#374151', whiteSpace: 'nowrap' }}>{rec.organizerName}</span>
                    </div>
                  </td>
                  <td style={{ padding: '14px 18px', fontSize: '13px', color: '#4B5563', whiteSpace: 'nowrap' }}>{rec.recordedOn}</td>
                  <td style={{ padding: '14px 18px', fontSize: '13px', color: '#4B5563', whiteSpace: 'nowrap' }}>{rec.duration}</td>
                  <td style={{ padding: '14px 18px', fontSize: '13px', color: '#4B5563', whiteSpace: 'nowrap' }}>{rec.size}</td>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => playRecording(rec)}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', border: '1px solid #C7D2FE', backgroundColor: '#FFFFFF', color: '#4F46E5', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                      >
                        <Play size={12} />
                        Play
                      </button>
                      <div style={{ position: 'relative' }}>
                        <button
                          type="button"
                          disabled={!canDownload(rec) || fileOptions(rec).length === 0}
                          aria-label={`Download ${rec.name}`}
                          onClick={() => {
                            const options = fileOptions(rec);
                            if (options.length === 1 && rec.fileUrl) downloadFile(rec.fileUrl, `${rec.name}.mp4`);
                            else setOpenMenu(openMenu?.id === rec.id && openMenu.kind === 'downloads' ? null : { id: rec.id, kind: 'downloads' });
                          }}
                          style={{ width: '30px', height: '30px', borderRadius: '6px', border: '1px solid #E5E7EB', backgroundColor: '#FFFFFF', color: canDownload(rec) ? '#6B7280' : '#D1D5DB', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: canDownload(rec) ? 'pointer' : 'not-allowed' }}
                        >
                          <Download size={14} />
                        </button>
                        {openMenu?.id === rec.id && openMenu.kind === 'downloads' && <ActionMenu width={310} items={fileOptions(rec)} onClose={() => setOpenMenu(null)} />}
                      </div>
                      <div style={{ position: 'relative' }}>
                        <button
                          type="button"
                          aria-label={`Actions for ${rec.name}`}
                          onClick={() => setOpenMenu(openMenu?.id === rec.id && openMenu.kind === 'actions' ? null : { id: rec.id, kind: 'actions' })}
                          style={{ width: '30px', height: '30px', borderRadius: '6px', border: '1px solid #E5E7EB', backgroundColor: '#FFFFFF', color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                        >
                          <MoreVertical size={14} />
                        </button>
                        {openMenu?.id === rec.id && openMenu.kind === 'actions' && <ActionMenu width={258} items={recordingMenu(rec)} onClose={() => setOpenMenu(null)} />}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', flexWrap: 'wrap', gap: '10px' }}>
          <span style={{ fontSize: '13px', color: '#6B7280' }}>
            {totalCount === 0 ? 'No recordings' : `Showing 1–${filtered.length} of ${totalCount} recordings`}
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button disabled style={{ width: '30px', height: '30px', borderRadius: '6px', border: '1px solid #E5E7EB', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'not-allowed', color: '#D1D5DB' }}>
              <ChevronLeft size={14} />
            </button>
            <button
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '6px',
                border: '1px solid #4F46E5',
                background: '#FFFFFF',
                color: '#4F46E5',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'default',
              }}
            >
              {page}
            </button>
            <button disabled style={{ width: '30px', height: '30px', borderRadius: '6px', border: '1px solid #E5E7EB', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'not-allowed', color: '#D1D5DB' }}>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
      {selectedRecording && (
        <div role="dialog" aria-modal="true" aria-label={`${selectedRecording.name} recording details`} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.38)' }} onMouseDown={(event) => event.target === event.currentTarget && setSelectedRecording(null)}>
          <aside style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(480px, 94vw)', background: '#FFFFFF', boxShadow: '-10px 0 30px rgba(15,23,42,.18)', padding: '24px', boxSizing: 'border-box' }}>
            <button type="button" onClick={() => setSelectedRecording(null)} aria-label="Close details" style={{ position: 'absolute', right: '18px', top: '18px', width: '34px', height: '34px', border: '1px solid #E5E7EB', borderRadius: '8px', background: '#FFFFFF', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={17} /></button>
            <div style={{ fontSize: '12px', color: '#6B7280' }}>Recording details</div>
            <h2 style={{ margin: '5px 50px 22px 0', fontSize: '21px', color: '#111827' }}>{selectedRecording.name}</h2>
            {[
              ['Organizer', selectedRecording.organizerName],
              ['Recorded on', selectedRecording.recordedOn],
              ['Duration', selectedRecording.duration],
              ['Video size', selectedRecording.size],
              ['Folder', selectedRecording.folder || 'No folder'],
              ['Transcript', selectedRecording.transcriptUrl ? `${selectedRecording.transcriptFormat || 'TXT'} available` : 'No transcript available'],
              ['Captions', selectedRecording.captionsUrl ? `${selectedRecording.captionsFormat || 'VTT'} available` : 'No captions available'],
              ['Meeting chat', selectedRecording.chatUrl ? 'Available' : 'No meeting chat available'],
            ].map(([label, value]) => <div key={label} style={{ padding: '12px 0', borderBottom: '1px solid #F3F4F6' }}><div style={{ fontSize: '11px', color: '#6B7280', textTransform: 'uppercase' }}>{label}</div><div style={{ fontSize: '13px', color: '#111827', fontWeight: 600, marginTop: '3px' }}>{value}</div></div>)}
          </aside>
        </div>
      )}
    </div>
  );
}
