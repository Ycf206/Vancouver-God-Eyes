'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck, Globe, Lock, Eye, FileText, CheckCircle2 } from 'lucide-react';

export default function PrivacyPolicyPage() {
  const [lang, setLang] = useState<'zh' | 'en'>('zh');

  return (
    <div className="min-h-screen bg-[#0d1017] text-gray-200 flex flex-col selection:bg-blue-500/30">
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 bg-[#141824]/90 backdrop-blur-md border-b border-[#242c3d] px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1c2333] hover:bg-[#252f44] border border-[#2d374d] text-xs font-semibold text-gray-300 hover:text-white transition-all shadow-sm"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回地圖 (Back to Map)</span>
          </Link>
          <div className="h-4 w-[1px] bg-gray-700 hidden sm:block" />
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h1 className="text-sm font-bold text-white tracking-wide">
              {lang === 'zh' ? '溫哥華天眼 · 隱私權政策' : "Vancouver God's Eye · Privacy Policy"}
            </h1>
          </div>
        </div>

        {/* Language Switcher */}
        <div className="flex items-center bg-[#10141e] p-0.5 rounded-lg border border-[#2a3449]">
          <button
            onClick={() => setLang('zh')}
            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
              lang === 'zh' ? 'bg-blue-600 text-white font-bold shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            繁體中文
          </button>
          <button
            onClick={() => setLang('en')}
            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
              lang === 'en' ? 'bg-blue-600 text-white font-bold shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            English
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-8 space-y-6">
        {/* Banner */}
        <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-950/40 via-[#151d2c] to-emerald-950/30 border border-blue-500/30 shadow-lg">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0 mt-0.5">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {lang === 'zh' ? '隱私保護承諾與合規宣告' : 'Privacy Protection Commitment & Compliance'}
              </h2>
              <p className="text-xs text-gray-300 mt-1 leading-relaxed">
                {lang === 'zh'
                  ? 'Vancouver God\'s Eye (溫哥華天眼) 恪守加拿大《個人資訊保護與電子文件法》(PIPEDA) 及卑詩省 PIPA 法規標準，專為大溫哥華居民與旅客提供透明、安全的都會地理資訊服務。'
                  : 'Vancouver God\'s Eye strictly adheres to Canada’s PIPEDA and BC PIPA regulations, providing a transparent, privacy-centric urban geographic intelligence platform for Metro Vancouver residents and visitors.'}
              </p>
              <div className="mt-2 text-[11px] text-gray-400 font-mono">
                {lang === 'zh' ? '最後更新日期：2026年10月24日 · 適用於所有 Web 與行動裝置訪問' : 'Last Updated: October 24, 2026 · Applies to all Web & Mobile access'}
              </div>
            </div>
          </div>
        </div>

        {lang === 'zh' ? (
          /* ==================== 繁體中文條款 ==================== */
          <div className="space-y-6 text-xs text-gray-300 leading-relaxed bg-[#131722] p-6 sm:p-8 rounded-2xl border border-[#232b3c] shadow-md">
            <section className="space-y-2">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                1. 我們收集的資料類型
              </h3>
              <p>我們僅收集維持本平台運作與提供個人化地理體驗所必需之最少資料：</p>
              <ul className="list-disc list-inside space-y-1.5 pl-2 text-gray-300">
                <li><strong className="text-white">Google 帳號公開資訊（選擇性登入）</strong>：當您選擇以 Google 登入時，系統僅讀取您的 Google 唯一識別碼 (UID)、公開顯示名稱、電子郵件 (Email) 及個人大頭照 URL。我們不會索取密碼或 Google 雲端硬碟等其他隱私授權。</li>
                <li><strong className="text-white">即時地理位置（GPS）</strong>：當您授權瀏覽器定位時，經緯度坐標僅於您的個人裝置（瀏覽器本地端）用於即時在地圖標示當前位置及計算離您最近的油站、交通攝影機或水文站距離。<strong>伺服器絕不主動記錄、儲存或追蹤您的個人行動歷史軌跡</strong>。</li>
                <li><strong className="text-white">用戶自定義內容</strong>：包含您主動發布的地點評分與文字留言、自訂收藏地點清單，以及個人圖層偏好設定。</li>
              </ul>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                2. 資訊使用目的
              </h3>
              <ul className="list-disc list-inside space-y-1.5 pl-2">
                <li>跨裝置同步您的圖層開啟/關閉狀態與地圖顯示偏好。</li>
                <li>維護地點評論討論區的公信力，防範匿名濫發惡意廣告或灌水評論。</li>
                <li>持續改善大溫哥華即時交通、天氣與開放資料管線的連線品質。</li>
              </ul>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                3. 嚴格不販售個資與第三方政策 (No-Sale Policy)
              </h3>
              <p>
                <strong>我們絕不出售、租賃、交換或轉讓您的任何個人資料（包含 Email 與定位）予任何第三方廣告商、數據中介或營利機構</strong>。第三方服務僅限於 Google OAuth（身分驗證）以及開放公共 API（如 City of Vancouver Open Data, TransLink, DriveBC, NOAA, ECCC），傳輸過程均採用最高規格 TLS 1.3 傳輸層加密。
              </p>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                4. Cookie 與本地存儲政策 (Cookies & Local Storage)
              </h3>
              <p>
                本站僅使用「絕對必要之功能性 Cookie」及瀏覽器 LocalStorage，用於記住您的登入 Session 與離線快取偏好。本站<strong>不使用任何跨站廣告追蹤 Cookie (Third-party Tracking Cookies)</strong>。
              </p>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                5. 使用者權利與資料刪除 (User Rights & Deletion)
              </h3>
              <p>
                根據加拿大 PIPEDA 條例，您對您的個人資料擁有完全的自主權。您可隨時於個人設定中刪除您的評論或要求永久註銷帳號。若需行使資料調閱或全面刪除權限，請點擊主頁「回報問題」按鈕或聯繫維運團隊。
              </p>
            </section>
          </div>
        ) : (
          /* ==================== English Terms ==================== */
          <div className="space-y-6 text-xs text-gray-300 leading-relaxed bg-[#131722] p-6 sm:p-8 rounded-2xl border border-[#232b3c] shadow-md">
            <section className="space-y-2">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                1. Information We Collect
              </h3>
              <p>We only collect the minimum amount of data required to provide a reliable, customized geographic experience:</p>
              <ul className="list-disc list-inside space-y-1.5 pl-2 text-gray-300">
                <li><strong className="text-white">Google Profile Information (Optional Login)</strong>: When signing in via Google, we access your Google UID, public display name, email address, and avatar image URL. We never request access to passwords, contacts, or Google Drive files.</li>
                <li><strong className="text-white">Live Geolocation (GPS)</strong>: If permitted, coordinates are calculated locally on your device to display your position and find nearby amenities (e.g., gas stations, traffic cameras). <strong>Our servers do not track, log, or store your historic location tracks</strong>.</li>
                <li><strong className="text-white">User-Generated Content</strong>: Includes reviews, ratings, customized layer toggle preferences, and bookmarked places.</li>
              </ul>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                2. How We Use Information
              </h3>
              <ul className="list-disc list-inside space-y-1.5 pl-2">
                <li>To synchronize layer toggles and viewing preferences across devices.</li>
                <li>To maintain an authentic community review space and prevent automated spam.</li>
                <li>To optimize live transit, weather, and traffic data pipeline connections.</li>
              </ul>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                3. Strict No-Sale & Third-Party Policy
              </h3>
              <p>
                <strong>We never sell, rent, monetize, or exchange your personal information with third-party advertisers or data brokers</strong>. Third-party integrations are strictly limited to Google Identity (OAuth authentication) and public municipal/federal open data APIs. All network communication is enforced via TLS 1.3 encryption.
              </p>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                4. Cookies & Local Storage Policy
              </h3>
              <p>
                We only utilize strictly essential functional cookies and browser LocalStorage to maintain your active login session and map preferences. We do not use intrusive third-party ad tracking cookies.
              </p>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                5. Canadian PIPEDA Compliance & Account Deletion
              </h3>
              <p>
                Under Canada's Personal Information Protection and Electronic Documents Act (PIPEDA) and BC PIPA, you retain full rights over your data. You may request account deletion or content removal at any time through the Report Issue modal on the map top bar.
              </p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
