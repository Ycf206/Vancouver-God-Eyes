'use client';

import React from 'react';
import { History, X, Sparkles, Tag, Calendar, CheckCircle2 } from 'lucide-react';

interface ChangelogEntry {
  date: string;
  version: string;
  tag?: string;
  highlights: string[];
}

const CHANGELOG_DATA: ChangelogEntry[] = [
  {
    date: '2026-10-24',
    version: 'v2026.10.4',
    tag: '最新發布',
    highlights: [
      '管理系統重大架構升級：實施獨立安全子網域 (admin.vangodseye.fyi) 與 PIN 碼唯讀保護 (0206)。',
      '全新調度雙軌分流：GitHub Actions 雲端資料管線與 OCI 伺服器即時服務分離管理。',
      'GitHub Token 智慧雙重持久化保存，解決重新載入遺失問題。',
      '後台全面採用現代化瀏覽器分頁風格 (Browser Tabs)，大幅擴充清單垂直可視空間。',
      '重整為 4 大標準系統分類：道路 (16)、天氣 (5)、生活 (16)、公共事業 (8)。',
      '新增「更新日誌」版本歷程視窗。'
    ]
  },
  {
    date: '2026-10-24',
    version: 'v2026.10.3',
    highlights: [
      '自來水管道 (Water Distribution Mains) 與污水管道 (Sewer Mains) 圖層全面升級。',
      '路燈電網 (Street Lighting Conduits) 與路燈燈桿 (Street Lighting Poles) API 快取與 Popup 樣式優化。',
      '探索面板燃油 (Fuel) 名稱與寬度高度調整，完美避開右下方操作按鈕。'
    ]
  },
  {
    date: '2026-10-23',
    version: 'v2026.10.2',
    highlights: [
      '微出行即時監控：Mobi 共享單車與 Lime 共享滑板車排程管線自動同步。',
      '新增滑雪場即時雪報、海灘水質檢測、極光指數預測整合。',
      '優化即時數據管線自動排程執行穩定性。'
    ]
  },
  {
    date: '2026-10-17',
    version: 'v2026.10.1',
    highlights: [
      '整合 TomTom 即時路況暢通度探針與市府交通攝影機即時高清串流。',
      'TransLink 巴士、天車與海上巴士即時 GTFS-RT 座標追蹤與平滑插值演算法。',
      '大溫地區美加邊境通關時間、YVR 航班與海洋船舶動態發布。'
    ]
  },
  {
    date: '2026-10-09',
    version: 'v2026.10.0',
    highlights: [
      '「溫哥華上帝之眼」(Vancouver God\'s Eye) 專案正式發布。',
      '完成大溫哥華全域多維度開放資料 (Open Data) 與空間地理圖資整合。'
    ]
  }
];

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChangelogModal({ isOpen, onClose }: ChangelogModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150 select-none">
      <div 
        className="bg-[#161a23] border border-[#2e374c] rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#252d3e] bg-[#191f2c] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                <span>系統更新日誌</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
                  CHANGELOG
                </span>
              </h2>
              <p className="text-[11px] text-gray-400">溫哥華上帝之眼版本迭代歷程與功能更新記錄</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-md transition-colors hover:bg-[#252d3e] cursor-pointer"
            title="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Table Content (左至右欄: 日期 / 版本 / 內容) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-[#2c374d] [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[#3e4e6d]">
          <div className="border border-[#263147] rounded-xl overflow-hidden bg-[#121620]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#181e2b] border-b border-[#263147] text-gray-400 font-semibold uppercase text-[11px] tracking-wider">
                  <th className="py-3 px-4 w-[110px] sm:w-[130px]">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-gray-400" />
                      <span>日期</span>
                    </span>
                  </th>
                  <th className="py-3 px-4 w-[110px] sm:w-[130px]">
                    <span className="flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-gray-400" />
                      <span>版本</span>
                    </span>
                  </th>
                  <th className="py-3 px-4">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                      <span>更新內容</span>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2638]">
                {CHANGELOG_DATA.map((entry, idx) => (
                  <tr 
                    key={entry.version}
                    className={`hover:bg-[#161c28] transition-colors ${idx === 0 ? 'bg-sky-500/[0.03]' : ''}`}
                  >
                    {/* 日期欄 */}
                    <td className="py-3.5 px-4 font-mono text-[11px] text-gray-400 align-top whitespace-nowrap">
                      {entry.date}
                    </td>

                    {/* 版本欄 */}
                    <td className="py-3.5 px-4 align-top whitespace-nowrap">
                      <div className="flex flex-col gap-1 items-start">
                        <span className="font-mono font-bold text-xs text-sky-300 px-2 py-0.5 rounded bg-sky-950/80 border border-sky-500/40">
                          {entry.version}
                        </span>
                        {entry.tag && (
                          <span className="text-[9.5px] font-semibold text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.2 rounded-full">
                            {entry.tag}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 內容欄 */}
                    <td className="py-3.5 px-4 align-top text-gray-200">
                      <ul className="space-y-1.5">
                        {entry.highlights.map((item, hIdx) => (
                          <li key={hIdx} className="flex items-start gap-2 text-[11.5px] leading-relaxed">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-1.5 shrink-0"></span>
                            <span className="text-gray-300">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#252d3e] bg-[#141822] flex items-center justify-between text-[11px] text-gray-500 shrink-0">
          <span>版本命名規則: v年.月.序號 (例如 v2026.10.0 開始，當月每次更新序號遞增)</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#202738] hover:bg-[#2b354c] text-gray-300 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
