'use client';

import React, { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function GlobalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application runtime error boundary caught:', error);
  }, [error]);

  return (
    <div className="min-h-screen w-full bg-[#0d1017] text-gray-100 flex items-center justify-center p-6 select-none">
      <div className="max-w-md w-full bg-[#161a23] border border-[#282f40] rounded-2xl p-6 shadow-2xl text-center flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-base font-bold text-white">頁面載入或地圖渲染發生暫時性異常</h2>
          <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
            系統已自動攔截此錯誤以防止畫面崩潰，請點擊下方按鈕重新載入介面。
          </p>
        </div>
        <div className="flex items-center gap-2.5 w-full pt-1">
          <button
            type="button"
            onClick={() => reset()}
            className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>重試恢復畫面</span>
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="py-2.5 px-4 bg-[#202738] hover:bg-[#2a344a] text-gray-200 border border-[#34405a] rounded-xl text-xs font-semibold transition-all cursor-pointer"
          >
            完整重新整理
          </button>
        </div>
      </div>
    </div>
  );
}
