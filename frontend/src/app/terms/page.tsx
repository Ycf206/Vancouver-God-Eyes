'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Scale, ShieldAlert, FileText, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function TermsOfServicePage() {
  const [lang, setLang] = useState<'zh' | 'en'>('zh');

  return (
    <div className="min-h-screen bg-[#0d1017] text-gray-200 flex flex-col selection:bg-amber-500/30">
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
            <Scale className="w-4 h-4 text-amber-400" />
            <h1 className="text-sm font-bold text-white tracking-wide">
              {lang === 'zh' ? '溫哥華天眼 · 服務條款' : "Vancouver God's Eye · Terms of Service"}
            </h1>
          </div>
        </div>

        {/* Language Switcher */}
        <div className="flex items-center bg-[#10141e] p-0.5 rounded-lg border border-[#2a3449]">
          <button
            onClick={() => setLang('zh')}
            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
              lang === 'zh' ? 'bg-amber-600 text-white font-bold shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            繁體中文
          </button>
          <button
            onClick={() => setLang('en')}
            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
              lang === 'en' ? 'bg-amber-600 text-white font-bold shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            English
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-8 space-y-6">
        {/* Banner */}
        <div className="p-5 rounded-2xl bg-gradient-to-r from-amber-950/40 via-[#151d2c] to-blue-950/30 border border-amber-500/30 shadow-lg">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0 mt-0.5">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {lang === 'zh' ? '服務條款與開放數據免責聲明' : 'Terms of Service & Open Data Disclaimer'}
              </h2>
              <p className="text-xs text-gray-300 mt-1 leading-relaxed">
                {lang === 'zh'
                  ? '歡迎使用 Vancouver God\'s Eye (溫哥華天眼)。請在造訪或使用本網站時詳細閱讀以下條款。使用本平台即視為您已完全理解並同意遵守本協議之所有規範。'
                  : 'Welcome to Vancouver God\'s Eye. Please read these Terms of Service carefully before using our platform. By accessing or using our services, you agree to be bound by these terms.'}
              </p>
              <div className="mt-2 text-[11px] text-gray-400 font-mono">
                {lang === 'zh' ? '生效日期：2026年11月23日 · 適用於所有終端用戶' : 'Effective Date: November 23, 2026 · Applicable to all users'}
              </div>
            </div>
          </div>
        </div>

        {lang === 'zh' ? (
          /* ==================== 繁體中文條款 ==================== */
          <div className="space-y-6 text-xs text-gray-300 leading-relaxed bg-[#131722] p-6 sm:p-8 rounded-2xl border border-[#232b3c] shadow-md">
            <section className="space-y-2">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                1. 服務定位與開放數據免責聲明 (Open Data Disclaimer)
              </h3>
              <p>
                Vancouver God's Eye 是一個整合大溫哥華地區（Metro Vancouver）即時交通路況、大眾運輸動態、氣象觀測、水文監控、公立設施與環境遙測的都會可視化平台。
              </p>
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200/90 text-[11.5px] leading-relaxed flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  本平台圖資與數據均直接介接自政府與公共機構（包含 City of Vancouver Open Data, TransLink GTFS-RT, DriveBC, Environment and Climate Change Canada (ECCC), NOAA 等）。<strong>所有資料依「現況 (As-Is)」提供，僅供公眾參考與學術研究，不得作為緊急搜救、醫療救護、法律訴訟或高風險航海飛行之唯一決策依據</strong>。
                </span>
              </div>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                2. 合理使用規範 (Acceptable Use)
              </h3>
              <p>使用本平台及「回報問題」功能時，您同意遵守以下規範：</p>
              <ul className="list-disc list-inside space-y-1.5 pl-2 text-gray-300">
                <li>嚴禁對本平台介面或 API 進行高頻惡意爬蟲、阻斷服務攻擊或未經授權之商業轉售。</li>
                <li>嚴禁透過問題回報表單發送垃圾廣告、惡意連結、誹謗或不實訊息。</li>
              </ul>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                3. 智慧財產權與第三方商標聲明
              </h3>
              <p>
                本網站所呈現之專屬介面設計、原始程式碼、圖標及編排架構均受國際版權法保護。第三方開放資料集之著作權與智慧財產權分別歸屬於原始發行機關（如 TransLink, City of Vancouver, NOAA 等所有）。
              </p>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                4. 責任限制 (Limitation of Liability)
              </h3>
              <p>
                在法律允許的最大範圍內，Vancouver God's Eye 團隊對於因第三方伺服器斷線、官方 API 延誤、地圖標示誤差或網路通訊中斷所導致之任何直接、間接或衍生性損失，概不承擔任何法律責任。
              </p>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                5. 準據法與爭議解決 (Governing Law)
              </h3>
              <p>
                本服務條款之解釋與適用，均以加拿大卑詩省（British Columbia, Canada）之現行法律為準據法。
              </p>
            </section>
          </div>
        ) : (
          /* ==================== English Terms ==================== */
          <div className="space-y-6 text-xs text-gray-300 leading-relaxed bg-[#131722] p-6 sm:p-8 rounded-2xl border border-[#232b3c] shadow-md">
            <section className="space-y-2">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                1. Service Purpose & Open Data Disclaimer
              </h3>
              <p>
                Vancouver God's Eye is an urban visualization platform aggregating live transit, traffic, weather, hydrological stations, municipal facilities, and environmental feeds across Metro Vancouver.
              </p>
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200/90 text-[11.5px] leading-relaxed flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  All geospatial datasets are sourced directly from public open data portals (City of Vancouver, TransLink, DriveBC, ECCC, NOAA). <strong>Data is provided on an "as-is" and "as-available" basis for informational and educational purposes only. Do not rely on this platform for life-critical navigation, emergency services, or maritime safety</strong>.
                </span>
              </div>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                2. Acceptable Use
              </h3>
              <p>When using this platform or submitting feedback, you agree to:</p>
              <ul className="list-disc list-inside space-y-1.5 pl-2 text-gray-300">
                <li>Refrain from abusive automated scraping, denial-of-service attempts, or unauthorized commercial redistribution.</li>
                <li>Never submit unsolicited advertising, malware, or fraudulent links via the issue report form.</li>
              </ul>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                3. Intellectual Property
              </h3>
              <p>
                The proprietary software design, frontend components, and visualization algorithms are protected under copyright laws. Third-party dataset copyrights remain the property of their respective government or corporate publishers.
              </p>
            </section>

            <section className="space-y-2 pt-4 border-t border-[#1e2535]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                4. Limitation of Liability & Governing Law
              </h3>
              <p>
                To the fullest extent permitted by applicable law, Vancouver God's Eye shall not be held liable for any damages resulting from dataset inaccuracies, API outages, or network interruptions. These terms are governed exclusively by the laws of the Province of British Columbia, Canada.
              </p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
