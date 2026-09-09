import React, { useState } from 'react';
import {
  X,
  Play,
  Share2,
  Copy,
  Check,
  Download,
  Folder,
  Calendar,
  Clock,
  HardDrive,
  Users,
  Lock,
  Globe,
  FileText,
  FileAudio,
  Video,
} from 'lucide-react';

export interface IRecordingDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  recording: any;
  onPlay: (rec: any) => void;
  onShare: (rec: any) => void;
  onDownload: (url: string | undefined, filename: string) => void;
}

export function RecordingDetailsModal({
  isOpen,
  onClose,
  recording,
  onPlay,
  onShare,
  onDownload,
}: IRecordingDetailsModalProps) {
  const [copiedLink, setCopiedLink] = useState(false);

  if (!isOpen || !recording) return null;

  const recordingUrl = `${window.location.origin}/recordings/${recording.id}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(recordingUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '16px',
        animation: 'toowixFadeIn 0.15s ease-out',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          boxShadow: '0 24px 48px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.08)',
          color: '#1F2937',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '92vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 22px 14px 22px',
            borderBottom: '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                backgroundColor: '#EEF2FF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#4F46E5',
              }}
            >
              <Video size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#111827' }}>
                {recording.name}
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#6B7280' }}>
                Recording details & resources
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: 'transparent',
              color: '#9CA3AF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          
          {/* Video Preview Banner with Play overlay */}
          <div
            onClick={() => onPlay(recording)}
            style={{
              position: 'relative',
              width: '100%',
              height: '180px',
              backgroundColor: '#0F172A',
              borderRadius: '12px',
              overflow: 'hidden',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              transition: 'transform 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.01)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: '#4F46E5',
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 6px 20px rgba(79, 70, 229, 0.6)',
                zIndex: 2,
              }}
            >
              <Play size={24} fill="#FFFFFF" style={{ marginLeft: '3px' }} />
            </div>
            <div
              style={{
                position: 'absolute',
                bottom: '12px',
                left: '14px',
                right: '14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                zIndex: 2,
              }}
            >
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.6)', padding: '3px 8px', borderRadius: '5px' }}>
                Click to play video
              </span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.6)', padding: '3px 8px', borderRadius: '5px' }}>
                {recording.duration}
              </span>
            </div>
          </div>

          {/* Quick Action Bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            <button
              type="button"
              onClick={() => onPlay(recording)}
              style={{
                height: '40px',
                borderRadius: '8px',
                backgroundColor: '#4F46E5',
                color: '#FFFFFF',
                fontSize: '13px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Play size={14} fill="#FFFFFF" /> Play
            </button>

            <button
              type="button"
              onClick={() => onShare(recording)}
              style={{
                height: '40px',
                borderRadius: '8px',
                backgroundColor: '#EEF2FF',
                color: '#4F46E5',
                fontSize: '13px',
                fontWeight: 600,
                border: '1px solid #C7D2FE',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Share2 size={14} /> Share
            </button>

            <button
              type="button"
              onClick={handleCopyLink}
              style={{
                height: '40px',
                borderRadius: '8px',
                backgroundColor: copiedLink ? '#ECFDF5' : '#F3F4F6',
                color: copiedLink ? '#059669' : '#374151',
                fontSize: '13px',
                fontWeight: 600,
                border: `1px solid ${copiedLink ? '#A7F3D0' : '#E5E7EB'}`,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              {copiedLink ? <Check size={14} /> : <Copy size={14} />}
              {copiedLink ? 'Copied' : 'Copy link'}
            </button>
          </div>

          {/* Metadata Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            <div style={{ padding: '10px 14px', backgroundColor: '#F9FAFB', borderRadius: '8px', border: '1px solid #F3F4F6' }}>
              <div style={{ fontSize: '11px', color: '#6B7280', textTransform: 'uppercase', fontWeight: 600 }}>Organizer</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>
                {recording.organizerName || 'Organizer'}
              </div>
            </div>

            <div style={{ padding: '10px 14px', backgroundColor: '#F9FAFB', borderRadius: '8px', border: '1px solid #F3F4F6' }}>
              <div style={{ fontSize: '11px', color: '#6B7280', textTransform: 'uppercase', fontWeight: 600 }}>Recorded On</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>
                {recording.recordedOn || 'N/A'}
              </div>
            </div>

            <div style={{ padding: '10px 14px', backgroundColor: '#F9FAFB', borderRadius: '8px', border: '1px solid #F3F4F6' }}>
              <div style={{ fontSize: '11px', color: '#6B7280', textTransform: 'uppercase', fontWeight: 600 }}>Duration & Size</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>
                {recording.duration} &bull; {recording.size}
              </div>
            </div>

            <div style={{ padding: '10px 14px', backgroundColor: '#F9FAFB', borderRadius: '8px', border: '1px solid #F3F4F6' }}>
              <div style={{ fontSize: '11px', color: '#6B7280', textTransform: 'uppercase', fontWeight: 600 }}>Access Permission</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: recording.allowShare ? '#059669' : '#4F46E5', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                {recording.allowShare ? <Globe size={13} /> : <Lock size={13} />}
                {recording.allowShare ? 'Anyone with link' : 'Restricted'}
              </div>
            </div>
          </div>

          {/* Downloadable Files List */}
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '8px' }}>
              Available Downloads
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {recording.fileUrl && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#F9FAFB', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#111827' }}>
                    <Video size={15} color="#4F46E5" /> Video MP4 ({recording.size})
                  </div>
                  <button
                    type="button"
                    onClick={() => onDownload(recording.fileUrl, `${recording.name}.mp4`)}
                    style={{ border: 'none', background: 'transparent', color: '#4F46E5', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}
                  >
                    Download
                  </button>
                </div>
              )}

              {recording.audioUrl && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#F9FAFB', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#111827' }}>
                    <FileAudio size={15} color="#059669" /> Audio MP3
                  </div>
                  <button
                    type="button"
                    onClick={() => onDownload(recording.audioUrl, `${recording.name}.mp3`)}
                    style={{ border: 'none', background: 'transparent', color: '#059669', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}
                  >
                    Download
                  </button>
                </div>
              )}

              {recording.transcriptUrl && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#F9FAFB', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#111827' }}>
                    <FileText size={15} color="#D97706" /> Transcript ({recording.transcriptFormat || 'TXT'})
                  </div>
                  <button
                    type="button"
                    onClick={() => onDownload(recording.transcriptUrl, `${recording.name}-transcript.txt`)}
                    style={{ border: 'none', background: 'transparent', color: '#D97706', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}
                  >
                    Download
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 22px',
            borderTop: '1px solid #E5E7EB',
            backgroundColor: '#F9FAFB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#6B7280' }}>
            <Folder size={14} />
            <span>{recording.folder || 'Default Folder'}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '7px 18px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#1F2937',
              color: '#FFFFFF',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
