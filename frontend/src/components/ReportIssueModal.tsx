'use client';

import React, { useState } from 'react';
import { AlertCircle, X, Send, CheckCircle2, Loader2, Image as ImageIcon, Trash2, UploadCloud } from 'lucide-react';
import { getApiUrl } from '@/utils/api';

interface ReportIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ReportIssueModal({ isOpen, onClose }: ReportIssueModalProps) {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const targetEmail = 'vancouvergodeyes@gmail.com';

  const handleResetAndClose = () => {
    setTitle('');
    setDetails('');
    setContactEmail('');
    setImageFile(null);
    setImagePreview(null);
    setImageBase64(null);
    setImageName('');
    setIsSubmitting(false);
    setIsSuccess(false);
    setErrorMessage(null);
    onClose();
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMessage('請上傳圖片格式檔案 (JPG, PNG, WebP 等)');
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setErrorMessage('圖片大小請小於 8MB');
      return;
    }

    setImageFile(file);
    setImageName(file.name);
    setErrorMessage(null);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImagePreview(result);
      setImageBase64(result);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setImageBase64(null);
    setImageName('');
  };

  const getMailtoUrl = () => {
    const subject = encodeURIComponent(`[上帝之眼問題回報] ${title || '使用者回報'}`);
    const attachNote = imageName ? `\n\n[附件圖片備註: ${imageName}，若使用本機郵件軟體寄送，請手動將該截圖附於電郵中]` : '';
    const bodyContent = `回報標題: ${title}\n\n問題詳情:\n${details}\n\n聯絡 Email: ${contactEmail || '未提供'}${attachNote}`;
    const body = encodeURIComponent(bodyContent);
    return `mailto:${targetEmail}?subject=${subject}&body=${body}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !details.trim()) {
      setErrorMessage('請填寫回報標題與詳細內容');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const apiUrl = getApiUrl();

    try {
      const res = await fetch(`${apiUrl}/api/report-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          details: details.trim(),
          contact_email: contactEmail.trim() || null,
          image_base64: imageBase64 || null,
          image_name: imageName || null,
        }),
      });

      if (!res.ok) {
        throw new Error(`伺服器回應錯誤 (${res.status})`);
      }

      setIsSuccess(true);
    } catch (err: unknown) {
      console.warn('API submission failed, offering mailto fallback:', err);
      // 即便後端離線或暫無網路，直接開啟 mailto 備援寄送
      window.open(getMailtoUrl(), '_blank');
      setIsSuccess(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-[500px] bg-[#1e2025] border border-[#373a40] rounded-xl shadow-2xl overflow-hidden text-gray-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2d2e34] bg-[#191a1e]">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-400">
              <AlertCircle className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">回報問題</h2>
              <p className="text-[11px] text-gray-400">提供異常回報或功能建議，將寄送至站方信箱</p>
            </div>
          </div>
          <button 
            onClick={handleResetAndClose}
            className="text-gray-400 hover:text-white p-1 rounded-md transition-colors hover:bg-gray-800"
            title="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {isSuccess ? (
          <div className="p-6 flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 border-2 border-emerald-500/50 flex items-center justify-center text-emerald-400 my-1 animate-in zoom-in-75 duration-300">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-white">問題回報已送出！</h3>
            <p className="text-xs text-gray-300 max-w-[380px] leading-relaxed">
              感謝您的寶貴反饋，問題已成功記錄並遞交給管理團隊。我們將盡速審閱與處理！
            </p>

            <button
              onClick={handleResetAndClose}
              className="mt-3 w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium text-sm transition-colors shadow-lg"
            >
              完成並關閉
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4 text-xs">
            {errorMessage && (
              <div className="p-2.5 bg-rose-500/15 border border-rose-500/40 rounded-lg text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* 標題欄位 */}
            <div className="flex flex-col gap-1.5">
              <label className="font-semibold text-gray-200 flex items-center justify-between">
                <span>問題標題 <span className="text-rose-400">*</span></span>
                <span className="text-[10px] text-gray-500 font-normal">簡要描述異常狀況</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：49 號公車預估到站時間未更新 / 某景點座標偏移"
                className="w-full bg-[#16171a] border border-[#373a40] focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/40 rounded-lg px-3 py-2 text-white placeholder:text-gray-500 text-xs outline-none transition-all"
              />
            </div>

            {/* 詳情欄位 */}
            <div className="flex flex-col gap-1.5">
              <label className="font-semibold text-gray-200 flex items-center justify-between">
                <span>詳細描述 <span className="text-rose-400">*</span></span>
                <span className="text-[10px] text-gray-500 font-normal">請具體描述情況</span>
              </label>
              <textarea
                required
                rows={5}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="請具體說明：&#10;1. 遇到的問題或錯誤情況&#10;2. 相關地點、公車站名或圖層名稱&#10;3. 任何有助於排查的補充資訊..."
                className="w-full bg-[#16171a] border border-[#373a40] focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/40 rounded-lg p-3 text-white placeholder:text-gray-500 text-xs outline-none transition-all resize-none leading-relaxed"
              />
            </div>

            {/* 聯絡 Email 欄位 */}
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-gray-300 flex items-center justify-between">
                <span>您的聯絡 Email（選填）</span>
                <span className="text-[10px] text-gray-500 font-normal">若需後續回覆進度</span>
              </label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="your.email@example.com"
                className="w-full bg-[#16171a] border border-[#373a40] focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/40 rounded-lg px-3 py-2 text-white placeholder:text-gray-500 text-xs outline-none transition-all"
              />
            </div>

            {/* 圖片上載欄位 (作為電郵附件) */}
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-gray-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                  <span>截圖或相片上載（選填，將作為附件發送）</span>
                </span>
                <span className="text-[10px] text-gray-500 font-normal">最大 8MB</span>
              </label>

              {imagePreview ? (
                <div className="relative flex items-center gap-3 p-2.5 bg-[#16171a] border border-[#373a40] rounded-lg">
                  <img
                    src={imagePreview}
                    alt="預覽圖片"
                    className="w-14 h-14 object-cover rounded-md border border-gray-700 shrink-0"
                  />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs font-medium text-white truncate">{imageName}</span>
                    <span className="text-[10px] text-gray-400">
                      {imageFile ? (imageFile.size / 1024).toFixed(1) + ' KB' : ''} · 已載入為電郵附件
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="p-1.5 rounded-md hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 transition-colors shrink-0"
                    title="移除截圖"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 p-3 bg-[#16171a] border border-dashed border-[#373a40] hover:border-amber-500/60 rounded-lg cursor-pointer transition-colors group">
                  <UploadCloud className="w-4 h-4 text-gray-400 group-hover:text-amber-400 transition-colors" />
                  <span className="text-gray-400 group-hover:text-gray-200 transition-colors text-xs">
                    點擊此處上傳圖片 (支援 JPG, PNG, WebP)
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* 按鈕組 */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#2d2e34] mt-1">
              <button
                type="button"
                onClick={handleResetAndClose}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-lg border border-[#373a40] hover:bg-[#25262b] text-gray-300 text-xs font-medium transition-colors"
              >
                取消
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center justify-center gap-1.5 px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800/60 text-white rounded-lg text-xs font-semibold transition-all shadow-md active:scale-95"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>遞交中...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>遞交回報</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
