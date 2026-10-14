'use client';

import React, { useState } from 'react';
import { Heart, X, ExternalLink, ShieldCheck, Coffee, Sparkles, CreditCard, Info } from 'lucide-react';

interface DonateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DonateModal({ isOpen, onClose }: DonateModalProps) {
  // 預設贊助金額 (CAD 加幣)
  const [selectedAmount, setSelectedAmount] = useState<number | 'custom'>(15);
  const [customAmount, setCustomAmount] = useState<string>('');

  if (!isOpen) return null;

  // Stripe Payment Link 與其他金流連結 (可透過環境變數或自訂)
  const stripePaymentLink = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK || 'https://buy.stripe.com/your-stripe-link';
  const buyMeACoffeeUrl = process.env.NEXT_PUBLIC_BUYMEACOFFEE_URL || '';
  const paypalUrl = process.env.NEXT_PUBLIC_PAYPAL_URL || '';

  const handleDonateClick = () => {
    // 若有自訂金額，可附帶到 URL 參數，或直接開啟 Stripe Payment Link
    let targetUrl = stripePaymentLink;
    if (stripePaymentLink.includes('your-stripe-link')) {
      // 尚未設定時的貼心提醒
      alert('請先在 .env 或後台設定您的 Stripe Payment Link 專屬付款短網址！');
      return;
    }

    if (selectedAmount !== 'custom' && selectedAmount) {
      targetUrl = `${stripePaymentLink}?prefilled_amount=${selectedAmount * 100}`;
    } else if (customAmount) {
      targetUrl = `${stripePaymentLink}?prefilled_amount=${Math.round(parseFloat(customAmount) * 100)}`;
    }
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-[520px] bg-[#1e2025] border border-[#373a40] rounded-xl shadow-2xl overflow-hidden text-gray-200 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2d2e34] bg-[#191a1e] shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-400">
              <Heart className="w-5 h-5 fill-rose-500/30 text-rose-400" />
            </span>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide flex items-center gap-1.5">
                <span>贊助支持溫哥華上帝之眼</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800/60 font-mono">
                  SUPPORT
                </span>
              </h2>
              <p className="text-[11px] text-gray-400">支持城市即時數據、OpenData 串流與地圖伺服器營運</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-md transition-colors hover:bg-gray-800"
            title="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto flex flex-col gap-4 text-xs leading-relaxed">
          {/* Mission Description Card */}
          <div className="bg-[#25262c] p-3.5 rounded-lg border border-[#373a40]/70 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-rose-300 font-semibold text-xs">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>打造大溫哥華最強大的即時開源數據地圖</span>
            </div>
            <p className="text-gray-300 text-[11.5px] leading-relaxed">
              「溫哥華上帝之眼」（Vancouver God&apos;s Eye）由獨立開發者建立與維護，即時整合全溫哥華公車天車、渡輪、航班、急診與 UPCC 等候時間、單車道及道路設施。您的每一份支持，都將實質轉化為伺服器運算資源與 API 數據流量！
            </p>
          </div>

          {/* Donation Amount Presets */}
          <div className="flex flex-col gap-2">
            <label className="font-semibold text-gray-300 text-xs flex items-center justify-between">
              <span>選擇贊助金額 (CAD 加幣)</span>
              <span className="text-[10px] text-gray-400 font-normal">支援信用卡 / Apple Pay / Google Pay</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { amount: 5, label: '$5 CAD', desc: '買杯咖啡 ☕' },
                { amount: 15, label: '$15 CAD', desc: '午餐應援 🥪' },
                { amount: 30, label: '$30 CAD', desc: '一週運維 ⚡' },
                { amount: 50, label: '$50 CAD', desc: '重大支持 🚀' },
              ].map((item) => (
                <button
                  key={item.amount}
                  type="button"
                  onClick={() => {
                    setSelectedAmount(item.amount);
                    setCustomAmount('');
                  }}
                  className={`p-2.5 rounded-lg border text-center transition-all flex flex-col items-center gap-0.5 ${
                    selectedAmount === item.amount
                      ? 'bg-rose-500/15 border-rose-500 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.15)] font-bold'
                      : 'bg-[#25262c] border-[#373a40] text-gray-300 hover:border-gray-500 hover:bg-[#2c2d34]'
                  }`}
                >
                  <span className="text-sm font-black tracking-tight">{item.label}</span>
                  <span className="text-[9.5px] text-gray-400">{item.desc}</span>
                </button>
              ))}
            </div>

            {/* Custom Amount Field */}
            <div className="pt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedAmount('custom')}
                className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors shrink-0 ${
                  selectedAmount === 'custom'
                    ? 'bg-rose-500/15 border-rose-500 text-rose-300 font-bold'
                    : 'bg-[#25262c] border-[#373a40] text-gray-400 hover:text-gray-200'
                }`}
              >
                自訂金額
              </button>
              {selectedAmount === 'custom' && (
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                  <input
                    type="number"
                    min="1"
                    placeholder="輸入贊助金額 (CAD)"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="w-full bg-[#191a1e] border border-rose-500/60 rounded-lg pl-7 pr-12 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[10px]">CAD</span>
                </div>
              )}
            </div>
          </div>

          {/* Primary Action Button */}
          <div className="pt-1 flex flex-col gap-2">
            <button
              onClick={handleDonateClick}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 hover:from-rose-500 hover:to-amber-400 text-white rounded-lg font-bold text-xs shadow-lg shadow-rose-500/20 transition-all flex items-center justify-center gap-2 group active:scale-[0.99]"
            >
              <CreditCard className="w-4 h-4" />
              <span>使用 Stripe 信用卡 / 行動支付贊助 ↗</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-70 group-hover:opacity-100 transition-opacity" />
            </button>

            {/* Optional Alternative Payment Methods */}
            {(buyMeACoffeeUrl || paypalUrl) && (
              <div className="flex items-center gap-2 pt-1">
                {buyMeACoffeeUrl && (
                  <a
                    href={buyMeACoffeeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-1.5 px-3 bg-[#ffdd00] hover:bg-[#ffea4d] text-black rounded-lg font-bold text-[11px] transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Coffee className="w-3.5 h-3.5" />
                    <span>Buy Me a Coffee ↗</span>
                  </a>
                )}
                {paypalUrl && (
                  <a
                    href={paypalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-1.5 px-3 bg-[#0070ba] hover:bg-[#0086dc] text-white rounded-lg font-bold text-[11px] transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <span>PayPal 捐款 ↗</span>
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Compliance & Legal Notice Box (金流合規與條款聲明) */}
          <div className="mt-2 bg-[#191a1e] p-3 rounded-lg border border-[#2d2e34] text-[10.5px] text-gray-400 flex flex-col gap-1.5 leading-relaxed">
            <div className="flex items-center gap-1.5 font-bold text-gray-300">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>贊助條款、隱私與合規聲明</span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-gray-500 shrink-0">•</span>
              <span><strong>款項用途</strong>：所有贊助金額全數用於支付本站之伺服器主機、OpenData 即時資料串流與第三方地圖 API 額度開銷。</span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-gray-500 shrink-0">•</span>
              <span><strong>不可退款說明 (Non-refundable)</strong>：贊助為自願性無償支持行為，款項一經處理完成恕無法提供退款，請於支付前確認金額。</span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-amber-400 shrink-0">⚠️</span>
              <span><strong>不可申報扣抵稅額聲明</strong>：本專案為個人獨立開發之開源公益地圖工具，非加拿大政府立案之慈善機構（Registered Charity），<strong>因此贊助款項無法開立免稅收據，亦不可申報抵扣個人或企業所得稅額</strong>。</span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-emerald-400 shrink-0">🔒</span>
              <span><strong>支付安全與隱私</strong>：所有線上付款均經由符合國際最高 PCI-DSS Level 1 認證標準之 Stripe 金流伺服器加密處理，本網站絕不儲存亦不會接觸您的信用卡敏感資訊。</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#2d2e34] bg-[#191a1e] flex items-center justify-between text-[11px] text-gray-500">
          <span className="flex items-center gap-1">
            <Info className="w-3 h-3 text-gray-400" />
            <span>感謝您讓溫哥華上帝之眼持續穩定運作</span>
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-[#25262c] hover:bg-[#31333a] text-gray-300 rounded border border-[#373a40] transition-colors"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
