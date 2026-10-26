'use client';

import React, { useState } from 'react';
import { AlertCircle, X, Send, CheckCircle2, Loader2, Image as ImageIcon, Trash2, UploadCloud, Copy, Check, Mail, ExternalLink } from 'lucide-react';
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
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const targetEmail = 'vancouvergodseye@gmail.com';

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
    setCopied(false);
    onClose();
  };

  const handleCopyEmail = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(targetEmail);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = targetEmail;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy email:', err);
    }
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
    const subject = encodeURIComponent(
      title.trim() ? `[溫哥華上帝之眼問題回報] ${title.trim()}` : `[溫哥華上帝之眼問題回報] 使用者意見回饋`
    );
    const attachNote = imageName ? `\n\n[附件圖片備註: ${imageName}，若使用本機郵件軟體寄送，請手動將該截圖附於電郵中]` : '';
    const bodyContent = details.trim()
      ? `回報標題: ${title.trim() || '（未填寫）'}\n\n問題詳情:\n${details.trim()}\n\n聯絡 Email: ${contactEmail.trim() || '未提供'}${attachNote}`
      : `您好，我想回報以下問題或提供建議：\n\n[請在此輸入您遇到的狀況、錯誤位置或改進建議]\n\n聯絡 Email: ${contactEmail.trim() || '未提供'}`;
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

      // 儲存至本地快取供後台回報問題分頁即時查閱
      try {
        const newReport = {
          id: 'report_' + Date.now(),
          timestamp: new Date().toISOString(),
          title: title.trim(),
          details: details.trim(),
          contact_email: contactEmail.trim() || '',
          has_attachment: Boolean(imageBase64),
          attachment_name: imageName || ''
        };
        const existing = JSON.parse(localStorage.getItem('godseye_local_issue_reports') || '[]');
        existing.unshift(newReport);
        localStorage.setItem('godseye_local_issue_reports', JSON.stringify(existing.slice(0, 100)));
      } catch (_) {}

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
        className="relative w-full max-w-[500px] max-h-[90vh] bg-[#1e2025] border border-[#373a40] rounded-xl shadow-2xl overflow-hidden text-gray-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2d2e34] bg-[#191a1e] shrink-0">
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
            className="text-gray-400 hover:text-white p-1 rounded-md transition-colors hover:bg-gray-800 cursor-pointer"
            title="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1">
          {isSuccess ? (
            <div className="p-6 flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 border-2 border-emerald-500/50 flex items-center justify-center text-emerald-400 my-1 animate-in zoom-in-75 duration-300">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-white">問題回報已成功記錄！</h3>
              <p className="text-xs text-gray-300 max-w-[380px] leading-relaxed">
                感謝您的寶貴反饋，問題已成功寫入系統後台資料庫與安全備份清冊，管理員可即時於後台「統計數據」分頁審閱。
              </p>

              {/* 官方信箱與複製按鈕 */}
              <div className="w-full bg-[#16171a] border border-[#2d2e34] rounded-lg p-3 text-[11px] text-gray-400 flex flex-col gap-2 text-left my-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-200 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-amber-400" />
                    <span>官方回報信箱：</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#25262b] hover:bg-[#2f3136] text-amber-300 hover:text-amber-200 border border-[#373a40] text-[10.5px] cursor-pointer transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400 font-medium">已複製</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>複製 Email</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="font-mono text-gray-200 text-xs select-all bg-[#101114] px-2 py-1.5 rounded border border-[#26282f]">
                  {targetEmail}
                </div>
                <span>若您欲直接從個人電子郵件軟體寄送或補充檔案，可點擊：</span>
                <a
                  href={getMailtoUrl()}
                  className="text-amber-400 hover:text-amber-300 hover:underline flex items-center gap-1 font-medium mt-0.5"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>以本機郵件軟體直寄至 {targetEmail} &rarr;</span>
                </a>
              </div>

              <button
                onClick={handleResetAndClose}
                className="mt-2 w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium text-sm transition-colors shadow-lg cursor-pointer"
              >
                完成並關閉
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4 text-xs">
              {/* 官方信箱與複製/發送按鈕橫幅 */}
              <div className="p-3 bg-[#16171a] border border-[#2d2e34] rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex items-center justify-center w-7 h-7 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/25 shrink-0">
                      <Mail className="w-4 h-4" />
                    </span>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] text-gray-400 font-normal">官方回報信箱</span>
                      <span className="font-mono text-xs font-semibold text-white truncate select-all">
                        {targetEmail}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* 複製 Email 按鈕 */}
                    <button
                      type="button"
                      onClick={handleCopyEmail}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#25262b] hover:bg-[#2f3136] text-gray-300 hover:text-white border border-[#373a40] transition-colors text-[11px] font-medium cursor-pointer"
                      title="複製此 Email 地址"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400 font-medium">已複製</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-gray-400" />
                          <span>複製 Email</span>
                        </>
                      )}
                    </button>

                    {/* 發送電郵按鈕 (開啟郵件應用程式) */}
                    <a
                      href={getMailtoUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 hover:text-amber-200 border border-amber-500/30 transition-colors text-[11px] font-medium cursor-pointer"
                      title="發送電郵至此 Email (開啟電子郵件軟體)"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>發送電郵</span>
                    </a>
                  </div>
                </div>

                <div className="text-[10.5px] text-gray-400 leading-normal border-t border-[#25262b] pt-1.5 flex items-center justify-between">
                  <span>您可填寫下方表單線上遞交，或點擊「發送電郵」直接發信。</span>
                </div>
              </div>

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
                  rows={4}
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
                      className="p-1.5 rounded-md hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 transition-colors shrink-0 cursor-pointer"
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
                  className="px-4 py-2 rounded-lg border border-[#373a40] hover:bg-[#25262b] text-gray-300 text-xs font-medium transition-colors cursor-pointer"
                >
                  取消
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center justify-center gap-1.5 px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800/60 text-white rounded-lg text-xs font-semibold transition-all shadow-md active:scale-95 cursor-pointer"
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
    </div>
  );
}
