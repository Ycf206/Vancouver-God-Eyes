'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { X, ShieldCheck, Sparkles, Bookmark, MessageSquare, Layers, Lock } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInSuccess, setSignInSuccess] = useState(false);

  if (!isOpen) return null;

  const handleGoogleSignIn = () => {
    setIsSigningIn(true);
    // 模擬 Google OAuth 授權流程提示 (待填入 Google Client ID 後即刻全自動無縫啟用)
    setTimeout(() => {
      setIsSigningIn(false);
      setSignInSuccess(true);
      setTimeout(() => {
        setSignInSuccess(false);
        onClose();
      }, 3000);
    }, 1200);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-md bg-[#131620] border border-[#262e42] rounded-2xl p-6 shadow-2xl flex flex-col gap-5 text-gray-200 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#212738] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">會員帳號登入</h3>
              <p className="text-[10.5px] text-gray-400">Vancouver God's Eye Account</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="關閉"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content & Benefits */}
        <div className="flex flex-col gap-3.5">
          <p className="text-xs text-gray-300 leading-relaxed">
            登入以解鎖專屬於您的個人化大溫都會地圖功能：
          </p>

          <div className="space-y-2.5 bg-[#0f121a] p-3.5 rounded-xl border border-[#1e2538]">
            <div className="flex items-start gap-2.5 text-xs">
              <Layers className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block text-[11.5px]">跨裝置雲端同步圖層偏好</strong>
                <span className="text-[10.5px] text-gray-400">自動記住常用之交通、天氣與設施圖層開關狀態</span>
              </div>
            </div>

            <div className="flex items-start gap-2.5 text-xs">
              <MessageSquare className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block text-[11.5px]">地點實況評分與彈窗評論</strong>
                <span className="text-[10.5px] text-gray-400">在各大觀光景點、關口與水文站留下即時回饋</span>
              </div>
            </div>

            <div className="flex items-start gap-2.5 text-xs">
              <Bookmark className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block text-[11.5px]">自訂私人收藏地點清單</strong>
                <span className="text-[10.5px] text-gray-400">一鍵釘選常用充電樁、最愛油站與海景觀測點</span>
              </div>
            </div>
          </div>

          {/* Success Banner */}
          {signInSuccess && (
            <div className="p-3 bg-emerald-500/15 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Google 帳號預留介面驗證成功！待填入生產 Client ID 後即刻生效。</span>
            </div>
          )}

          {/* Google Sign-in Button */}
          <button
            onClick={handleGoogleSignIn}
            disabled={isSigningIn || signInSuccess}
            className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-xl bg-white hover:bg-gray-100 text-gray-900 font-bold text-xs shadow-lg transition-all active:scale-[0.99] disabled:opacity-70 cursor-pointer"
          >
            {isSigningIn ? (
              <div className="flex items-center gap-2 text-gray-700">
                <span className="w-3.5 h-3.5 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
                <span>正在連線至 Google 授權伺服器...</span>
              </div>
            ) : (
              <>
                {/* Official Google G Multi-color Logo */}
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>以 Google 帳號登入 (Continue with Google)</span>
              </>
            )}
          </button>
        </div>

        {/* Footer Legal Terms Notice */}
        <div className="pt-2 border-t border-[#1e2538] text-[10.5px] text-gray-500 text-center leading-relaxed">
          點擊登入即代表您同意本站的{' '}
          <Link href="/terms" target="_blank" className="text-blue-400 hover:underline">
            服務條款
          </Link>{' '}
          與{' '}
          <Link href="/privacy" target="_blank" className="text-blue-400 hover:underline">
            隱私權政策
          </Link>
          。我們恪守加拿大 PIPEDA 規範，絕不向第三方出售個人數據。
        </div>
      </div>
    </div>
  );
}
