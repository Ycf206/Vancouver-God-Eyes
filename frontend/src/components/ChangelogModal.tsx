'use client';

import React, { useState } from 'react';
import { History, X, Sparkles, Tag, Calendar, ChevronDown, ChevronUp, CheckCircle2, Layers } from 'lucide-react';

interface ChangelogEntry {
  version: string;
  title: string;
  date: string;
  isLatest?: boolean;
  highlights: string[];
}

const CHANGELOG_DATA: ChangelogEntry[] = [
  {
    version: 'v2026.11.2',
    title: 'v2026.11.2 更新內容',
    date: '2026-11-14',
    isLatest: true,
    highlights: [
      '新增停電圖層',
      '新增機場內部地圖圖層',
      '新增 Drive BC 圖層',
      '新增財經探索頁',
      '修正工作探索頁錯誤'
    ]
  },
  {
    version: 'v2026.11.1',
    title: 'v2026.11.1 更新內容',
    date: '2026-11-07',
    highlights: [
      '新增巴士轉車站',
      '新增天車車票資訊及收費區劃分',
      '新增卑詩渡輪碼頭攝影機',
      '新增交通工具箭頭顯示方向',
      '新增機場停車場資訊',
      '新增彩票探索頁',
      '新增體育探索頁',
      '優化交通圖層界面',
      '優化航班資訊及界面',
      '修正天車轉車站首尾班車資料'
    ]
  },
  {
    version: 'v2026.11.0',
    title: 'v2026.11.0 更新內容',
    date: '2026-11-01',
    highlights: [
      '釋出正式版'
    ]
  }
];

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChangelogModal({ isOpen, onClose }: ChangelogModalProps) {
  // 記錄展開的分頁，預設展開最新版本
  const [expandedVersions, setExpandedVersions] = useState<Record<string, boolean>>({
    'v2026.11.2': true,
    'v2026.11.1': false,
    'v2026.11.0': false
  });

  if (!isOpen) return null;

  const toggleVersion = (version: string) => {
    setExpandedVersions(prev => ({
      ...prev,
      [version]: !prev[version]
    }));
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div 
        className="bg-[#161a23] border border-[#2e374c] rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
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
              </h2>
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

        {/* Collapsible Accordion Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-3 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-[#2c374d] [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[#3e4e6d]">
          {CHANGELOG_DATA.map((entry) => {
            const isExpanded = expandedVersions[entry.version] ?? false;

            return (
              <div 
                key={entry.version}
                className={`border rounded-xl transition-all duration-200 overflow-hidden ${
                  entry.isLatest 
                    ? 'border-sky-500/40 bg-[#121622] shadow-[0_0_12px_rgba(56,189,248,0.06)]' 
                    : 'border-[#263147] bg-[#12151e]'
                }`}
              >
                {/* Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleVersion(entry.version)}
                  className={`w-full flex items-center justify-between px-4 py-3.5 transition-colors cursor-pointer text-left ${
                    isExpanded 
                      ? entry.isLatest ? 'bg-sky-500/10' : 'bg-[#181f2d]' 
                      : 'hover:bg-[#181e2b]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                    <span className={`font-mono font-bold text-xs px-2.5 py-0.5 rounded border inline-flex items-center gap-1.5 ${
                      entry.isLatest 
                        ? 'bg-sky-950/90 border-sky-400/50 text-sky-300 shadow-xs' 
                        : 'bg-[#1c2333] border-gray-700 text-gray-300'
                    }`}>
                      <Tag className="w-3 h-3 text-sky-400" />
                      {entry.version}
                    </span>

                    <h3 className="font-bold text-sm text-white tracking-wide">
                      {entry.title}
                    </h3>

                    {entry.isLatest && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        最新版本
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="flex items-center gap-1 text-[11px] font-mono text-gray-400">
                      <Calendar className="w-3 h-3 text-gray-500" />
                      <span>{entry.date}</span>
                    </span>
                    <div className={`p-1 rounded-md text-gray-400 transition-transform duration-200 ${
                      isExpanded ? 'text-sky-400 rotate-180' : 'text-gray-500'
                    }`}>
                      <ChevronDown className="w-4 h-4" />
                    </div>
                  </div>
                </button>

                {/* Accordion Body */}
                {isExpanded && (
                  <div className="px-5 py-4 border-t border-[#1e273a] bg-[#10141d]/80 animate-in fade-in duration-150">
                    <ul className="space-y-2">
                      {entry.highlights.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-2.5 text-xs leading-relaxed group">
                          <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5 group-hover:text-cyan-300 transition-colors" />
                          <span className="text-gray-200 group-hover:text-white transition-colors">
                            {item}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
