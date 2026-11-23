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
                {lang === 'zh' ? '最後更新日期：2026年11月23日 · 適用於所有 Web 與行動裝置訪問' : 'Last Updated: November 23, 2026 · Applies to all Web & Mobile access'}
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
                1. 我們處理的資料類型
              </h3>
              <p>本平台免註冊、免登入即可完整使用，僅處理維持服務運作所必需之最少資料：</p>
              <ul className="list-disc list-inside space-y-1.5 pl-2 text-gray-300">
                <li><strong className="text-white">即時地理位置（GPS）</strong>：當您授權瀏覽器定位時，經緯度坐標僅於您的個人裝置（瀏覽器本地端）用於即時在地圖標示當前位置及計算離您最近的油站、交通攝影機或水文站距離。<strong>伺服器絕不主動記錄、儲存或追蹤您的個人行動歷史軌跡</strong>。</li>
                <li><strong className="text-white">本地偏好設定</strong>：您選擇的圖層開關狀態、地圖風格、12/24 小時制與常用出發地點等偏好僅儲存於您裝置的瀏覽器 LocalStorage 中。</li>
              </ul>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                2. 資訊使用目的
              </h3>
              <ul className="list-disc list-inside space-y-1.5 pl-2">
                <li>於您的瀏覽器本機保留圖層開啟／關閉狀態與個人化地圖顯示偏好。</li>
                <li>持續改善大溫哥華即時交通、天氣與開放資料管線的連線品質。</li>
              </ul>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                3. 嚴格不販售個資與第三方政策 (No-Sale Policy)
              </h3>
              <p>
                <strong>我們不建立使用者帳號，亦絕不出售、租賃、交換或轉讓您的任何個人資料予任何第三方廣告商、數據中介或營利機構</strong>。第三方介接僅限於公開開放資料 API（如 City of Vancouver Open Data, TransLink, DriveBC, NOAA, ECCC），傳輸過程均採用 TLS 1.3 加密。
              </p>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                4. Cookie 與本地存儲政策 (Cookies & Local Storage)
              </h3>
              <p>
                本站僅使用瀏覽器 LocalStorage 記住您的地圖圖層與顯示偏好，您可隨時於瀏覽器或系統設定中清除。本站<strong>不使用任何跨站廣告追蹤 Cookie (Third-party Tracking Cookies)</strong>。
              </p>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                5. 使用者權利與聯繫管道 (User Rights)
              </h3>
              <p>
                根據加拿大 PIPEDA 及卑詩省 PIPA 條例，若您對本平台隱私措施或曾提交的問題回報有任何查詢或刪除需求，請點擊主頁「回報問題」按鈕聯繫維運團隊。
              </p>
            </section>
          </div>
        ) : (
          /* ==================== English Terms ==================== */
          <div className="space-y-6 text-xs text-gray-300 leading-relaxed bg-[#131722] p-6 sm:p-8 rounded-2xl border border-[#232b3c] shadow-md">
            <section className="space-y-2">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                1. Information We Process
              </h3>
              <p>No account registration or login is required. We only process the minimum data needed to operate the map:</p>
              <ul className="list-disc list-inside space-y-1.5 pl-2 text-gray-300">
                <li><strong className="text-white">Live Geolocation (GPS)</strong>: If permitted, coordinates are calculated locally on your device to display your position and find nearby amenities (e.g., gas stations, traffic cameras). <strong>Our servers do not track, log, or store your historic location tracks</strong>.</li>
                <li><strong className="text-white">Local Preferences</strong>: Layer toggles, map style, time format, and saved navigation origin are stored solely in your browser’s LocalStorage.</li>
              </ul>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                2. How We Use Information
              </h3>
              <ul className="list-disc list-inside space-y-1.5 pl-2">
                <li>To retain your layer toggles and viewing preferences locally in your browser.</li>
                <li>To optimize live transit, weather, and traffic open-data pipeline connections.</li>
              </ul>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                3. Strict No-Sale & Third-Party Policy
              </h3>
              <p>
                <strong>We do not maintain user accounts and never sell, rent, monetize, or exchange personal information with third-party advertisers or data brokers</strong>. Third-party integrations are strictly limited to public municipal/federal open data APIs. All network communication is protected via TLS 1.3 encryption.
              </p>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                4. Cookies & Local Storage Policy
              </h3>
              <p>
                We only utilize browser LocalStorage to save your map preferences on your own device. We do not use intrusive third-party ad tracking cookies.
              </p>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                5. Canadian PIPEDA Compliance & Inquiries
              </h3>
              <p>
                Under Canada's Personal Information Protection and Electronic Documents Act (PIPEDA) and BC PIPA, you may submit any privacy inquiry or request removal of submitted issue reports at any time through the Report Issue modal on the map top bar.
              </p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
