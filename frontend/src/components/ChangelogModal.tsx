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
    date: '2026-11-01',
    version: 'v2026.11.0',
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
                {CHANGELOG_DATA.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-16 text-center text-gray-500 text-xs">
                      <div className="flex flex-col items-center justify-center gap-2.5">
                        <History className="w-8 h-8 text-gray-600/60" />
                        <span className="text-gray-300 font-medium text-xs">正式版本即將推出</span>
                        <span className="text-gray-500 text-[11px]">系統更新歷程將於首個正式版本發佈時記錄於此</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  CHANGELOG_DATA.map((entry, idx) => (
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
                      <span className="font-mono font-bold text-xs text-sky-300 px-2 py-0.5 rounded bg-sky-950/80 border border-sky-500/40 inline-block">
                        {entry.version}
                      </span>
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
                )))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#252d3e] bg-[#141822] flex items-center justify-end text-[11px] text-gray-500 shrink-0">
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
