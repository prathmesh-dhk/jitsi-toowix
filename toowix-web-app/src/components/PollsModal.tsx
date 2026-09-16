import React, { useState } from 'react';
import { X, Plus, BarChart3 } from 'lucide-react';

export interface IPoll {
  id: string;
  question: string;
  options: string[];
  votes: Record<string, number>; // voterId -> option index
  createdBy: string;
}

export interface IPollsModalProps {
  isOpen: boolean;
  onClose: () => void;
  polls: IPoll[];
  mySessionId: string;
  onCreate: (question: string, options: string[]) => void;
  onVote: (pollId: string, optionIndex: number) => void;
}

export function PollsModal({ isOpen, onClose, polls, mySessionId, onCreate, onVote }: IPollsModalProps) {
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);

  if (!isOpen) return null;

  const resetForm = () => {
    setQuestion('');
    setOptions(['', '']);
    setCreating(false);
  };

  const handleCreate = () => {
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);

    if (!question.trim() || cleanOptions.length < 2) return;
    onCreate(question.trim(), cleanOptions);
    resetForm();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#2D2E30',
          borderRadius: '16px',
          padding: '24px',
          width: '420px',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '75vh',
          overflowY: 'auto',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BarChart3 size={18} color="#8AB4F8" /> Polls
          </span>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '50%', display: 'flex' }}
          >
            <X size={18} color="#9AA0A6" />
          </button>
        </div>

        {!creating ? (
          <button
            onClick={() => setCreating(true)}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '10px',
              border: '1px dashed rgba(138,180,248,0.5)',
              backgroundColor: 'transparent',
              color: '#8AB4F8',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              marginBottom: '16px',
            }}
          >
            <Plus size={16} /> Create a poll
          </button>
        ) : (
          <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: '10px' }}>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question"
              style={{
                width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)',
                backgroundColor: 'rgba(255,255,255,0.04)', color: '#E8EAED', fontSize: '13px', marginBottom: '8px', boxSizing: 'border-box',
              }}
            />
            {options.map((opt, idx) => (
              <input
                key={idx}
                value={opt}
                onChange={(e) => setOptions((prev) => prev.map((o, i) => (i === idx ? e.target.value : o)))}
                placeholder={`Option ${idx + 1}`}
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)',
                  backgroundColor: 'rgba(255,255,255,0.04)', color: '#E8EAED', fontSize: '13px', marginBottom: '8px', boxSizing: 'border-box',
                }}
              />
            ))}
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              {options.length < 6 && (
                <button
                  onClick={() => setOptions((prev) => [...prev, ''])}
                  style={{ fontSize: '12px', color: '#8AB4F8', background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  + Add option
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button
                onClick={resetForm}
                style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#E8EAED', fontSize: '13px', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                style={{ flex: 1, padding: '8px', borderRadius: '8px', border: 'none', backgroundColor: '#8AB4F8', color: '#202124', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                Launch poll
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[...polls].reverse().map((poll) => {
            const totalVotes = Object.keys(poll.votes).length;
            const myVote = poll.votes[mySessionId];

            return (
              <div key={poll.id} style={{ padding: '12px', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: '10px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#E8EAED', marginBottom: '10px' }}>{poll.question}</div>
                {poll.options.map((opt, idx) => {
                  const count = Object.values(poll.votes).filter((v) => v === idx).length;
                  const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                  const isMine = myVote === idx;

                  return (
                    <button
                      key={idx}
                      onClick={() => onVote(poll.id, idx)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        position: 'relative',
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: isMine ? '1px solid #8AB4F8' : '1px solid rgba(255,255,255,0.1)',
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        cursor: 'pointer',
                        marginBottom: '6px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute', inset: 0, width: `${pct}%`,
                          backgroundColor: isMine ? 'rgba(138,180,248,0.25)' : 'rgba(255,255,255,0.08)',
                          transition: 'width 0.3s ease',
                        }}
                      />
                      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#E8EAED' }}>
                        <span>{opt}</span>
                        <span>{pct}% ({count})</span>
                      </div>
                    </button>
                  );
                })}
                <div style={{ fontSize: '11px', color: '#9AA0A6', marginTop: '4px' }}>{totalVotes} vote{totalVotes === 1 ? '' : 's'}</div>
              </div>
            );
          })}
          {polls.length === 0 && !creating && (
            <div style={{ fontSize: '12px', color: '#9AA0A6', textAlign: 'center', padding: '16px' }}>No polls yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PollsModal;
