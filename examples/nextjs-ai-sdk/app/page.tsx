'use client';

import { useChat } from 'ai/react';

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, data } = useChat();

  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>
          ⚡ EdgeRoute + Vercel AI SDK
        </h1>
        <p style={{ color: '#a1a1aa', margin: 0, fontSize: '0.95rem' }}>
          Zero-latency dynamic router with real-time multi-provider dispatch and sub-millisecond semantic caching.
        </p>
      </header>

      <div
        style={{
          minHeight: '400px',
          maxHeight: '600px',
          overflowY: 'auto',
          margin: '1.5rem 0',
          border: '1px solid #27272a',
          borderRadius: '12px',
          padding: '1.25rem',
          background: '#09090b',
        }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#71717a', padding: '3rem 1rem' }}>
            <p style={{ fontWeight: 600, color: '#e4e4e7', marginBottom: '0.5rem' }}>Try sending different prompts:</p>
            <p style={{ fontSize: '0.875rem' }}>
              • <code>"Hi"</code> ➔ Routes to <strong>GPT-4o-mini</strong> (Fast-path QA, 0ms)
            </p>
            <p style={{ fontSize: '0.875rem' }}>
              • <code>"Refactor this distributed architecture..."</code> ➔ Routes to <strong>Claude 3.5 Sonnet</strong>
            </p>
            <p style={{ fontSize: '0.875rem' }}>
              • Repeating the same question ➔ <strong>Instant Semantic Cache Hit ($0)</strong>
            </p>
          </div>
        )}

        {messages.map((m) => {
          const isUser = m.role === 'user';
          return (
            <div
              key={m.id}
              style={{
                margin: '1.25rem 0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: isUser ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '85%',
                  padding: '0.85rem 1.15rem',
                  borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: isUser ? '#2563eb' : '#18181b',
                  color: isUser ? '#ffffff' : '#f4f4f5',
                  border: isUser ? 'none' : '1px solid #27272a',
                  lineHeight: 1.6,
                }}
              >
                {!isUser && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.5rem',
                      alignItems: 'center',
                      marginBottom: '0.5rem',
                      fontSize: '0.75rem',
                      color: '#a1a1aa',
                    }}
                  >
                    <span
                      style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '9999px',
                        background: '#22c55e20',
                        color: '#4ade80',
                        fontWeight: 600,
                      }}
                    >
                      ⚡ EdgeRoute
                    </span>
                  </div>
                )}
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Ask a question or request complex code..."
          style={{
            flex: 1,
            padding: '0.85rem 1.15rem',
            borderRadius: '8px',
            border: '1px solid #3f3f46',
            background: '#18181b',
            color: '#fff',
            fontSize: '0.95rem',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          style={{
            padding: '0.85rem 1.75rem',
            borderRadius: '8px',
            border: 'none',
            background: isLoading ? '#3f3f46' : '#2563eb',
            color: '#fff',
            fontWeight: 600,
            fontSize: '0.95rem',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s ease',
          }}
        >
          {isLoading ? 'Routing...' : 'Send'}
        </button>
      </form>
    </main>
  );
}
