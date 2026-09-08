import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Play,
  Copy,
  Check,
  Share2,
  Download,
  Lock,
  Calendar,
  Clock,
  ArrowLeft,
  Video,
  FileText,
  User,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { ShareRecordingModal } from '../components/ShareRecordingModal';

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

const DEFAULT_SAMPLE_VIDEO = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

export function RecordingWatchPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [recording, setRecording] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string>('');

  useEffect(() => {
    const fetchRecording = async () => {
      if (!id) return;
      try {
        setLoading(true);
        const token = await auth.currentUser?.getIdToken().catch(() => null);
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const session = localStorage.getItem('toowix_session_token');
        if (session) headers['X-Toowix-Session'] = session;

        const res = await fetch(`${BACKEND_URL}/api/recordings/${id}`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Recording not found');

        const rec = data.recording;
        setRecording(rec);
        setVideoSrc(rec.fileUrl || DEFAULT_SAMPLE_VIDEO);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Could not load recording');
      } finally {
        setLoading(false);
      }
    };

    fetchRecording();
  }, [id]);

  const recordingUrl = window.location.href;

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
    if (!recording) return;
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

  const formattedDate = recording?.recordedAt
    ? new Date(recording.recordedAt).toLocaleString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';

  const hostName =
    typeof recording?.createdBy === 'object'
      ? recording?.createdBy?.fullName || recording?.createdBy?.email || 'Host'
      : 'Host';

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0A0C10',
        color: '#F3F4F6',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top Standalone Header */}
      <header
        style={{
          height: '60px',
          backgroundColor: '#111319',
          borderBottom: '1px solid #202430',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <Link
            to="/dashboard"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: '#9CA3AF',
              textDecoration: 'none',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            <ArrowLeft size={16} />
            <span>Dashboard</span>
          </Link>

          <div style={{ height: '18px', width: '1px', backgroundColor: '#2B3040' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img src="/favicon.png" alt="Toowix" style={{ width: '22px', height: '22px', borderRadius: '4px' }} />
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF' }}>
              Toowix <span style={{ color: '#6366F1' }}>Recording</span>
            </span>
          </div>
        </div>

        {recording && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={handleCopyLink}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '8px',
                border: '1px solid #2E3445',
                backgroundColor: copiedLink ? '#059669' : '#1C202C',
                color: copiedLink ? '#FFFFFF' : '#D1D5DB',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {copiedLink ? <Check size={14} /> : <Copy size={14} />}
              <span>{copiedLink ? 'Link copied!' : 'Copy link'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowShareModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#4F46E5',
                color: '#FFFFFF',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Share2 size={14} />
              <span>Share</span>
            </button>

            <button
              type="button"
              onClick={handleDownload}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '8px',
                border: '1px solid #2E3445',
                backgroundColor: '#1C202C',
                color: '#D1D5DB',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Download size={14} />
              <span>Download</span>
            </button>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 16px' }}>
        {loading ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: '#9CA3AF' }}>
            <div style={{ width: '40px', height: '40px', border: '3px solid #374151', borderTopColor: '#6366F1', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
            <p>Loading recording...</p>
          </div>
        ) : error ? (
          <div
            style={{
              margin: 'auto',
              maxWidth: '440px',
              width: '100%',
              backgroundColor: '#161922',
              border: '1px solid #2A2E3D',
              borderRadius: '16px',
              padding: '32px 24px',
              textAlign: 'center',
            }}
          >
            <div style={{ width: '52px', height: '52px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <AlertCircle size={28} />
            </div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px 0', color: '#FFFFFF' }}>
              Access Restricted or Not Found
            </h2>
            <p style={{ fontSize: '13px', color: '#9CA3AF', margin: '0 0 24px 0', lineHeight: 1.5 }}>
              {error}
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <Link
                to="/login"
                style={{
                  padding: '8px 18px',
                  borderRadius: '8px',
                  backgroundColor: '#4F46E5',
                  color: '#FFFFFF',
                  fontSize: '13px',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                Sign In
              </Link>
              <Link
                to="/"
                style={{
                  padding: '8px 18px',
                  borderRadius: '8px',
                  backgroundColor: '#232733',
                  color: '#D1D5DB',
                  fontSize: '13px',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                Home
              </Link>
            </div>
          </div>
        ) : recording ? (
          <div style={{ width: '100%', maxWidth: '1080px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Dedicated Theater Video Player Container */}
            <div
              style={{
                width: '100%',
                backgroundColor: '#000000',
                borderRadius: '16px',
                overflow: 'hidden',
                boxShadow: '0 20px 50px -10px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.08)',
                aspectRatio: '16 / 9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              <video
                src={videoSrc}
                controls
                autoPlay
                playsInline
                onError={() => {
                  if (videoSrc !== DEFAULT_SAMPLE_VIDEO) setVideoSrc(DEFAULT_SAMPLE_VIDEO);
                }}
                style={{ width: '100%', height: '100%', objectFit: 'contain', outline: 'none' }}
              />
            </div>

            {/* Video Information Bar */}
            <div
              style={{
                backgroundColor: '#13161F',
                border: '1px solid #232733',
                borderRadius: '14px',
                padding: '22px 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
                <div>
                  <h1 style={{ margin: '0 0 6px 0', fontSize: '22px', fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.3px' }}>
                    {recording.name}
                  </h1>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', fontSize: '13px', color: '#9CA3AF' }}>
                    {formattedDate && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Calendar size={14} color="#6366F1" /> {formattedDate}
                      </span>
                    )}
                    {recording.durationMinutes && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Clock size={14} color="#10B981" /> {recording.durationMinutes} min
                      </span>
                    )}
                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <User size={14} color="#A855F7" /> Hosted by {hostName}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setShowShareModal(true)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      backgroundColor: '#4F46E5',
                      color: '#FFFFFF',
                      fontSize: '13px',
                      fontWeight: 600,
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Share2 size={14} /> Share Video
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      backgroundColor: copiedLink ? '#059669' : '#1F2432',
                      color: copiedLink ? '#FFFFFF' : '#E5E7EB',
                      fontSize: '13px',
                      fontWeight: 600,
                      border: '1px solid #2B3142',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                    {copiedLink ? 'Copied' : 'Copy link'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>

      {/* Share Modal */}
      {recording && (
        <ShareRecordingModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          recording={{
            id: recording.id || recording._id,
            name: recording.name,
            recordedOn: formattedDate,
            duration: recording.durationMinutes ? `${recording.durationMinutes} min` : undefined,
            organizerName: hostName,
            allowShare: recording.allowShare,
            allowDownload: recording.allowDownload,
            sharedWith: recording.sharedWith,
          }}
          onUpdated={(up) => setRecording((prev: any) => ({ ...prev, ...up }))}
        />
      )}
    </div>
  );
}
