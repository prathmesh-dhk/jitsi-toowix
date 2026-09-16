import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Play,
  Download,
  Share2,
  Copy,
  Check,
  Calendar,
  Clock,
  User,
  Sparkles,
  Video,
  AlertCircle,
} from 'lucide-react';
import { useTheme } from '../lib/theme';

export interface IRecordingPlayerData {
  id: string;
  name: string;
  fileUrl?: string;
  duration?: string;
  recordedOn?: string;
  organizerName?: string;
  allowDownload?: boolean;
}

export interface IRecordingPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  recording: IRecordingPlayerData | null;
  onShare?: () => void;
}

const DEFAULT_SAMPLE_VIDEO = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

export function RecordingPlayerModal({
  isOpen,
  onClose,
  recording,
  onShare,
}: IRecordingPlayerModalProps) {
  const { isDark } = useTheme();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoSrc, setVideoSrc] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (recording) {
      setHasError(false);
      setVideoSrc(recording.fileUrl || DEFAULT_SAMPLE_VIDEO);
    }
  }, [recording]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !recording) return null;

  const recordingUrl = `${window.location.origin}/recordings/${recording.id}`;

  const handleVideoError = () => {
    if (videoSrc !== DEFAULT_SAMPLE_VIDEO) {
      setVideoSrc(DEFAULT_SAMPLE_VIDEO);
      setHasError(false);
    } else {
      setHasError(true);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(recordingUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDownload = () => {
    const src = videoSrc || recording.fileUrl || DEFAULT_SAMPLE_VIDEO;
    const a = document.createElement('a');
    a.href = src;
    a.download = `${recording.name || 'meeting-recording'}.mp4`;
    a.target = '_blank';
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: isDark ? 'rgba(0, 0, 0, 0.85)' : 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
        padding: '16px',
        animation: 'toowixFadeIn 0.15s ease-out',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '960px',
          backgroundColor: isDark ? '#14161D' : '#FFFFFF',
          borderRadius: '20px',
          border: isDark ? '1px solid #282B36' : '1px solid #E5E7EB',
          boxShadow: isDark
            ? '0 25px 60px -12px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.05)'
            : '0 25px 60px -12px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.05)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '94vh',
          color: isDark ? '#F9FAFB' : '#111827',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div
          style={{
            padding: '16px 22px',
            backgroundColor: isDark ? '#1A1D26' : '#FAFAFC',
            borderBottom: isDark ? '1px solid #282B36' : '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                flexShrink: 0,
                boxShadow: '0 2px 8px rgba(79, 70, 229, 0.35)',
              }}
            >
              <Video size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: '16px',
                  fontWeight: 700,
                  color: isDark ? '#FFFFFF' : '#111827',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  letterSpacing: '-0.2px',
                }}
              >
                {recording.name}
              </h3>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginTop: '3px',
                  fontSize: '12px',
                  color: isDark ? '#9CA3AF' : '#6B7280',
                  flexWrap: 'wrap',
                }}
              >
                {recording.recordedOn && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Calendar size={13} color="#6366F1" />
                    {recording.recordedOn}
                  </span>
                )}
                {recording.duration && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Clock size={13} color="#10B981" />
                    {recording.duration}
                  </span>
                )}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <User size={13} color="#8B5CF6" />
                  {recording.organizerName || 'Host'}
                </span>
              </div>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleCopyLink}
              title="Copy recording link"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                backgroundColor: copiedLink
                  ? '#059669'
                  : isDark
                  ? '#252936'
                  : '#FFFFFF',
                border: isDark ? '1px solid #363B4B' : '1px solid #D1D5DB',
                borderRadius: '8px',
                color: copiedLink ? '#FFFFFF' : isDark ? '#E5E7EB' : '#374151',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {copiedLink ? <Check size={14} /> : <Copy size={14} />}
              <span>{copiedLink ? 'Copied' : 'Copy link'}</span>
            </button>

            {onShare && (
              <button
                type="button"
                onClick={onShare}
                title="Share recording"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  backgroundColor: '#4F46E5',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#FFFFFF',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(79, 70, 229, 0.3)',
                  transition: 'background-color 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4338CA')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#4F46E5')}
              >
                <Share2 size={14} />
                <span>Share</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleDownload}
              title="Download recording MP4"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                backgroundColor: isDark ? '#252936' : '#FFFFFF',
                border: isDark ? '1px solid #363B4B' : '1px solid #D1D5DB',
                borderRadius: '8px',
                color: isDark ? '#E5E7EB' : '#374151',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <Download size={14} />
              <span>Download</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'transparent',
                color: isDark ? '#9CA3AF' : '#6B7280',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#282B36' : '#F3F4F6')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Video Player Canvas */}
        <div
          style={{
            position: 'relative',
            backgroundColor: '#090A0E',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '400px',
            maxHeight: '68vh',
            overflow: 'hidden',
          }}
        >
          {/* Top Corner HD Pill Badge */}
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '14px',
              zIndex: 10,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '20px',
              backgroundColor: 'rgba(15, 23, 42, 0.75)',
              backdropFilter: 'blur(6px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#FFFFFF',
              fontSize: '11px',
              fontWeight: 600,
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#10B981',
              }}
            />
            HD Cloud Stream
          </div>

          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              controls
              autoPlay
              playsInline
              onError={handleVideoError}
              style={{
                width: '100%',
                maxHeight: '68vh',
                outline: 'none',
                backgroundColor: '#090A0E',
              }}
            />
          ) : (
            <div style={{ color: '#9CA3AF', textAlign: 'center', padding: '40px' }}>
              <AlertCircle size={32} color="#EF4444" style={{ marginBottom: '8px' }} />
              <p style={{ margin: 0, fontSize: '14px' }}>No video stream available for this recording.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 22px',
            backgroundColor: isDark ? '#161820' : '#F9FAFB',
            borderTop: isDark ? '1px solid #282B36' : '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img src="/assets/toowix-logo.svg" alt="Toowix" style={{ width: '16px', height: '16px', objectFit: 'contain' }} />
            <span style={{ fontSize: '12px', fontWeight: 500, color: isDark ? '#9CA3AF' : '#6B7280' }}>
              Toowix Meet HD Player
            </span>
          </div>
          <span style={{ fontSize: '11px', color: isDark ? '#6B7280' : '#9CA3AF' }}>
            Press <kbd style={{ padding: '2px 5px', borderRadius: '4px', background: isDark ? '#252936' : '#E5E7EB', color: isDark ? '#D1D5DB' : '#374151', fontSize: '10px', fontWeight: 600 }}>Esc</kbd> to exit
          </span>
        </div>
      </div>
    </div>
  );
}

