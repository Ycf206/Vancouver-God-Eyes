'use client';

import React from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-HK">
      <body style={{ margin: 0, backgroundColor: '#0d1017', color: '#f3f4f6', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ maxWidth: '420px', width: '100%', backgroundColor: '#161a23', border: '1px solid #282f40', borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 8px 0' }}>系統介面發生未預期錯誤</h2>
            <p style={{ fontSize: '12px', color: '#9ca3af', margin: '0 0 18px 0', lineHeight: 1.6 }}>
              為保障瀏覽穩定性，系統已啟動安全恢復機制。{error?.digest ? ` (代碼: ${error.digest})` : ''}
            </p>
            <button
              type="button"
              onClick={() => reset()}
              style={{ width: '100%', padding: '10px 16px', backgroundColor: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '10px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              重新載入系統
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
