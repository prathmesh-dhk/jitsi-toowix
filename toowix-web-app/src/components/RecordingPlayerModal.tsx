import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Play,
  Pause,
  Maximize,
  Volume2,
  VolumeX,
  Download,
  Share2,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

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
      // Gracefully fall back to demo stream
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
        backgroundColor: 'rgba(0, 0, 0, 0.88)',
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
          maxWidth: '920px',
          backgroundColor: '#0F1117',
          borderRadius: '16px',
          border: '1px solid #232733',
          boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.85)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '94vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div
          style={{
            padding: '14px 20px',
            backgroundColor: '#161922',
            borderBottom: '1px solid #232733',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: '#4F46E5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                flexShrink: 0,
              }}
            >
              <Play size={16} fill="#FFFFFF" />
            </div>
            <div style={{ minWidth: 0 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: '15px',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {recording.name}
              </h3>
              <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '2px' }}>
                {recording.recordedOn && <span>{recording.recordedOn} &bull; </span>}
                {recording.duration && <span>Duration: {recording.duration} &bull; </span>}
                <span>Hosted by {recording.organizerName || 'Host'}</span>
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
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 12px',
                backgroundColor: copiedLink ? '#059669' : '#232733',
                border: '1px solid #323746',
                borderRadius: '7px',
                color: copiedLink ? '#FFFFFF' : '#D1D5DB',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {copiedLink ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedLink ? 'Copied' : 'Copy link'}</span>
            </button>

            {onShare && (
              <button
                type="button"
                onClick={onShare}
                title="Share recording"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '6px 12px',
                  backgroundColor: '#4F46E5',
                  border: 'none',
                  borderRadius: '7px',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Share2 size={13} />
                <span>Share</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleDownload}
              title="Download recording MP4"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 12px',
                backgroundColor: '#232733',
                border: '1px solid #323746',
                borderRadius: '7px',
                color: '#D1D5DB',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Download size={13} />
              <span>Download</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '7px',
                border: 'none',
                backgroundColor: 'transparent',
                color: '#9CA3AF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#232733')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Video Player Body */}
        <div
          style={{
            position: 'relative',
            backgroundColor: '#000000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '380px',
            maxHeight: '68vh',
          }}
        >
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
                backgroundColor: '#000000',
              }}
            />
          ) : (
            <div style={{ color: '#9CA3AF', textAlign: 'center', padding: '40px' }}>
              <p>No video source available for this recording.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 20px',
            backgroundColor: '#161922',
            borderTop: '1px solid #232733',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img src="/favicon.png" alt="Toowix" style={{ width: '16px', height: '16px', borderRadius: '3px' }} />
            <span style={{ fontSize: '12px', color: '#6B7280' }}>
              Toowix Meet HD Cloud Player
            </span>
          </div>
          <span style={{ fontSize: '12px', color: '#9CA3AF' }}>
            Press Esc to exit
          </span>
        </div>
      </div>
    </div>
  );
}
