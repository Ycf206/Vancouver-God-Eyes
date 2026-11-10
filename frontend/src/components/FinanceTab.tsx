'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ChartNoAxesCombined,
  Newspaper,
  PiggyBank,
  Search,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  ChevronDown,
  Trash2,
  ArrowUp,
  ArrowDown,
  Clock,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Sliders,
  DollarSign
} from 'lucide-react';

// CRA 官方歷年 TFSA 年度上限 (免稅儲蓄帳戶官方限額)
const TFSA_ANNUAL_LIMITS: Record<number, number> = {
  2009: 5000, 2010: 5000, 2011: 5000, 2012: 5000,
  2013: 5500, 2014: 5500,
  2015: 10000,
  2016: 5500, 2017: 5500, 2018: 5500,
  2019: 6000, 2020: 6000, 2021: 6000, 2022: 6000,
  2023: 6500,
  2024: 7000,
  2025: 7000,
  2026: 7000,
  2027: 7000,
  2028: 7000,
  2029: 7500,
  2030: 7500,
};

export interface TfsaStockItem {
  id: string;
  symbol: string;
  targetPercent: number; // 0 - 100
  shares: number;
  avgPrice: number;
  currentPrice: number;
  buyPrice?: number;
  buyShares?: number;
}

export interface FinanceNewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  publishTime: number;
  thumbnail?: string;
  summary?: string;
}

export interface StockQuoteData {
  symbol: string;
  shortName: string;
  longName: string;
  currency: string;
  exchangeName: string;
  instrumentType: string;
  regularMarketTime?: number;
  timezone: string;
  regularMarketPrice: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  previousClose: number;
  change: number;
  changePercent: number;
  chartPoints: Array<{
    time: number;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
  }>;
}

export interface StockSuggestionItem {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

const DEFAULT_TFSA_ITEMS: TfsaStockItem[] = [
  { id: '1', symbol: 'TSLA', targetPercent: 30, shares: 150, avgPrice: 33.862, currentPrice: 34.81, buyPrice: 34.81, buyShares: 0 },
  { id: '2', symbol: 'SPCX', targetPercent: 25, shares: 100, avgPrice: 19.5995, currentPrice: 23.91, buyPrice: 23.91, buyShares: 0 },
  { id: '3', symbol: 'GOOG', targetPercent: 20, shares: 80, avgPrice: 54.9244, currentPrice: 44.80, buyPrice: 44.80, buyShares: 0 },
  { id: '4', symbol: 'NVDA', targetPercent: 20, shares: 50, avgPrice: 40.599, currentPrice: 47.35, buyPrice: 47.35, buyShares: 53 },
  { id: '5', symbol: 'IBIT', targetPercent: 5, shares: 50, avgPrice: 32.2184, currentPrice: 33.20, buyPrice: 33.20, buyShares: 0 },
  { id: '6', symbol: 'PLTR', targetPercent: 0, shares: 35, avgPrice: 11.7551, currentPrice: 14.77, buyPrice: 14.77, buyShares: 0 }
];

export function FinanceTab() {
  const [subTab, setSubTab] = useState<'stock' | 'news' | 'tfsa'>('stock');

  // ==================== 1. 股票搜尋狀態 ====================
  const [stockSymbolInput, setStockSymbolInput] = useState<string>('TSLA');
  const [interval, setInterval] = useState<string>('1d');
  const [range, setRange] = useState<string>('1mo');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [includePrePost, setIncludePrePost] = useState<boolean>(false);
  const [loadingStock, setLoadingStock] = useState<boolean>(false);
  const [stockData, setStockData] = useState<StockQuoteData | null>(null);
  const [stockError, setStockError] = useState<string>('');

  // 搜尋建議狀態
  const [suggestions, setSuggestions] = useState<StockSuggestionItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState<boolean>(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // 點擊外部關閉搜尋建議
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 輸入時即時抓取搜尋建議 (Debounce 250ms)
  useEffect(() => {
    const q = stockSymbolInput.trim();
    if (!q || q.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const res = await fetch(`/api/finance/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (json.success && Array.isArray(json.suggestions)) {
          setSuggestions(json.suggestions);
          if (json.suggestions.length > 0) {
            setShowSuggestions(true);
          }
        } else {
          setSuggestions([]);
        }
      } catch {
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [stockSymbolInput]);

  // 週期智慧聯動（避免 Yahoo Finance 422 錯誤：1m 週期僅支援 7 天以內範圍）
  const handleIntervalChange = (newInterval: string) => {
    setInterval(newInterval);
    if (newInterval === '1m' && ['1mo', '3mo', '6mo', '1y', '5y', 'max'].includes(range)) {
      setRange('5d');
    } else if (['2m', '5m', '15m', '30m'].includes(newInterval) && ['3mo', '6mo', '1y', '5y', 'max'].includes(range)) {
      setRange('1mo');
    }
  };

  // 時間範圍智慧聯動（避免大範圍選到過短的分鐘週期）
  const handleRangeChange = (newRange: string) => {
    setRange(newRange);
    if (['1mo', '3mo', '6mo', '1y', '5y', 'max'].includes(newRange) && interval === '1m') {
      setInterval('1d');
    } else if (['3mo', '6mo', '1y', '5y', 'max'].includes(newRange) && ['2m', '5m', '15m', '30m'].includes(interval)) {
      setInterval('1d');
    }
  };

  // 查詢股票資料
  const fetchStockData = useCallback(async (sym?: string) => {
    const targetSymbol = (sym || stockSymbolInput).trim().toUpperCase();
    if (!targetSymbol) return;

    setLoadingStock(true);
    setStockError('');
    setShowSuggestions(false);

    try {
      const params = new URLSearchParams();
      params.set('symbol', targetSymbol);
      params.set('interval', interval);
      params.set('includePrePost', includePrePost ? 'true' : 'false');

      if (startDate && endDate) {
        const p1 = Math.floor(new Date(startDate).getTime() / 1000);
        const p2 = Math.floor(new Date(endDate).getTime() / 1000) + 86400; // 涵蓋當日整天
        if (!isNaN(p1) && !isNaN(p2) && p2 > p1) {
          // 自訂日期跨度超過 7 天且選取 1m，自動校正為 1d 避免 422
          if (interval === '1m' && (p2 - p1) > 7 * 86400) {
            params.set('interval', '1d');
          }
          params.set('period1', String(p1));
          params.set('period2', String(p2));
        } else {
          params.set('range', range);
        }
      } else {
        params.set('range', range);
      }

      const res = await fetch(`/api/finance/stock?${params.toString()}`);
      const json = await res.json();

      if (json.success && json.data) {
        setStockData(json.data);
      } else {
        setStockError(json.error || '無法取得該股票報價資料');
      }
    } catch (e: any) {
      setStockError(`網路請求錯誤: ${e.message || '無法連線'}`);
    } finally {
      setLoadingStock(false);
    }
  }, [stockSymbolInput, interval, range, startDate, endDate, includePrePost]);

  // 初次掛載載入預設股票
  useEffect(() => {
    fetchStockData('TSLA');
  }, []);

  // ==================== 2. 財經新聞狀態 ====================
  const [newsQuery, setNewsQuery] = useState<string>('market');
  const [newsList, setNewsList] = useState<FinanceNewsItem[]>([]);
  const [loadingNews, setLoadingNews] = useState<boolean>(false);

  const fetchNews = useCallback(async (q?: string) => {
    const targetQ = q !== undefined ? q : newsQuery;
    setLoadingNews(true);
    try {
      const res = await fetch(`/api/finance/news?q=${encodeURIComponent(targetQ || 'market')}`);
      const json = await res.json();
      if (json.success && json.news) {
        setNewsList(json.news);
      }
    } catch (e) {
      console.error('[Finance News] fetch failed:', e);
    } finally {
      setLoadingNews(false);
    }
  }, [newsQuery]);

  useEffect(() => {
    if (subTab === 'news' && newsList.length === 0) {
      fetchNews();
    }
  }, [subTab, newsList.length, fetchNews]);

  // ==================== 3. TFSA 投資配置分析狀態 ====================
  const [eligibleStartYear, setEligibleStartYear] = useState<number>(2024);
  const [calcEndYear, setCalcEndYear] = useState<number>(2027);
  const [extraDeposit, setExtraDeposit] = useState<number>(767);
  const [withdrawalDeduct, setWithdrawalDeduct] = useState<number>(6000);
  const [tfsaStocks, setTfsaStocks] = useState<TfsaStockItem[]>(DEFAULT_TFSA_ITEMS);
  const [updatingPrices, setUpdatingPrices] = useState<boolean>(false);

  // 新增股票輸入欄位
  const [newSymbol, setNewSymbol] = useState<string>('');
  const [newShares, setNewShares] = useState<string>('');
  const [newAvgPrice, setNewAvgPrice] = useState<string>('');

  // LocalStorage 持久化
  useEffect(() => {
    try {
      const saved = localStorage.getItem('godseye_tfsa_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.startYear) setEligibleStartYear(parsed.startYear);
        if (parsed.endYear) setCalcEndYear(parsed.endYear);
        if (parsed.extraDeposit !== undefined) setExtraDeposit(parsed.extraDeposit);
        if (parsed.withdrawal !== undefined) setWithdrawalDeduct(parsed.withdrawal);
        if (parsed.stocks && Array.isArray(parsed.stocks) && parsed.stocks.length > 0) {
          setTfsaStocks(parsed.stocks);
        }
      }
    } catch {}
  }, []);

  const saveTfsaConfig = useCallback((stocks: TfsaStockItem[], startY = eligibleStartYear, endY = calcEndYear, extra = extraDeposit, withdr = withdrawalDeduct) => {
    try {
      localStorage.setItem('godseye_tfsa_config', JSON.stringify({
        startYear: startY,
        endYear: endY,
        extraDeposit: extra,
        withdrawal: withdr,
        stocks
      }));
    } catch {}
  }, [eligibleStartYear, calcEndYear, extraDeposit, withdrawalDeduct]);

  // 計算 TFSA 系統計算總限額
  const systemCalculatedLimit = useMemo(() => {
    let sum = 0;
    const start = Math.min(eligibleStartYear, calcEndYear);
    const end = Math.max(eligibleStartYear, calcEndYear);
    for (let y = start; y <= end; y++) {
      sum += TFSA_ANNUAL_LIMITS[y] || 7000;
    }
    return sum + (Number(extraDeposit) || 0) - (Number(withdrawalDeduct) || 0);
  }, [eligibleStartYear, calcEndYear, extraDeposit, withdrawalDeduct]);

  // 計算總持倉投入成本 (持倉 * 均價)
  const totalInvestedCost = useMemo(() => {
    return tfsaStocks.reduce((sum, s) => sum + (s.shares * s.avgPrice), 0);
  }, [tfsaStocks]);

  // 計算現在剩餘資金 = 系統計算總限額 - 總投資持倉成本
  const remainingFunds = useMemo(() => {
    return systemCalculatedLimit - totalInvestedCost;
  }, [systemCalculatedLimit, totalInvestedCost]);

  // 批量更新股票現價
  const handleUpdateCurrentPrices = async () => {
    if (tfsaStocks.length === 0) return;
    setUpdatingPrices(true);
    try {
      const updated = await Promise.all(
        tfsaStocks.map(async (stk) => {
          try {
            const res = await fetch(`/api/finance/stock?symbol=${encodeURIComponent(stk.symbol)}&range=1d&interval=1d`);
            const json = await res.json();
            if (json.success && json.data?.regularMarketPrice) {
              const p = Number(json.data.regularMarketPrice.toFixed(2));
              return {
                ...stk,
                currentPrice: p,
                buyPrice: stk.buyPrice ? stk.buyPrice : p
              };
            }
          } catch {}
          return stk;
        })
      );
      setTfsaStocks(updated);
      saveTfsaConfig(updated);
    } finally {
      setUpdatingPrices(false);
    }
  };

  // 新增股票
  const handleAddStock = () => {
    const sym = newSymbol.trim().toUpperCase();
    const sh = parseFloat(newShares) || 0;
    const avg = parseFloat(newAvgPrice) || 0;
    if (!sym) return;

    const newItem: TfsaStockItem = {
      id: `${Date.now()}_${sym}`,
      symbol: sym,
      targetPercent: 0,
      shares: sh,
      avgPrice: avg,
      currentPrice: avg > 0 ? avg : 0,
      buyPrice: avg > 0 ? avg : 0,
      buyShares: 0
    };

    const next = [...tfsaStocks, newItem];
    setTfsaStocks(next);
    saveTfsaConfig(next);
    setNewSymbol('');
    setNewShares('');
    setNewAvgPrice('');

    // 背景抓取現價
    fetch(`/api/finance/stock?symbol=${encodeURIComponent(sym)}&range=1d&interval=1d`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data?.regularMarketPrice) {
          const p = Number(json.data.regularMarketPrice.toFixed(2));
          setTfsaStocks(cur => cur.map(it => it.id === newItem.id ? { ...it, currentPrice: p, buyPrice: p } : it));
        }
      }).catch(() => {});
  };

  // 刪除股票
  const handleDeleteStock = (id: string) => {
    const next = tfsaStocks.filter(s => s.id !== id);
    setTfsaStocks(next);
    saveTfsaConfig(next);
  };

  // 上移/下移
  const handleMoveStock = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= tfsaStocks.length) return;
    const next = [...tfsaStocks];
    const temp = next[index];
    next[index] = next[targetIdx];
    next[targetIdx] = temp;
    setTfsaStocks(next);
    saveTfsaConfig(next);
  };

  // 更新股票單一欄位
  const handleStockChange = (id: string, field: keyof TfsaStockItem, val: any) => {
    const next = tfsaStocks.map(s => {
      if (s.id !== id) return s;
      return { ...s, [field]: val };
    });
    setTfsaStocks(next);
    saveTfsaConfig(next);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2.5">
      {/* 頂部一級子分頁導覽列 (股票搜尋、財經新聞、TFSA) */}
      <div className="flex items-center gap-1.5 p-1 bg-[#10131d] rounded-xl border border-[#252a38] shrink-0">
        <button
          type="button"
          onClick={() => setSubTab('stock')}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            subTab === 'stock'
              ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
              : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
          }`}
        >
          <ChartNoAxesCombined className="w-3.5 h-3.5" />
          <span>股票搜尋</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('news')}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            subTab === 'news'
              ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
              : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
          }`}
        >
          <Newspaper className="w-3.5 h-3.5" />
          <span>財經新聞</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('tfsa')}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            subTab === 'tfsa'
              ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
              : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
          }`}
        >
          <PiggyBank className="w-3.5 h-3.5" />
          <span>TFSA 配置分析</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 子分頁 1: 股票搜尋 (Stock Search) */}
      {/* ========================================================================= */}
      {subTab === 'stock' && (
        <div className="flex flex-col flex-1 min-h-0 gap-2 overflow-y-auto pr-0.5 custom-scrollbar">
          {/* 搜尋控制與參數列 */}
          <div className="p-3 bg-[#121622] rounded-xl border border-[#222938] flex flex-col gap-2.5 shrink-0">
            {/* 代號輸入欄（支援即時搜尋建議）與查詢圖示按鈕 */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1" ref={searchContainerRef}>
                <input
                  type="text"
                  value={stockSymbolInput}
                  onChange={(e) => {
                    setStockSymbolInput(e.target.value);
                    if (e.target.value.trim().length > 0) {
                      setShowSuggestions(true);
                    }
                  }}
                  onFocus={() => {
                    if (suggestions.length > 0) setShowSuggestions(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setShowSuggestions(false);
                      fetchStockData();
                    } else if (e.key === 'Escape') {
                      setShowSuggestions(false);
                    }
                  }}
                  placeholder="輸入股票代號或名稱 (如: TSLA, RY.TO, NVDA)..."
                  className="w-full bg-[#0d1017] border border-[#262e3d] rounded-lg pl-8 pr-8 py-2 text-xs text-white placeholder-gray-500 uppercase font-mono font-bold focus:outline-none focus:border-emerald-500"
                />
                <Search className="w-4 h-4 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                {loadingSuggestions && (
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                )}

                {/* 搜尋結果建議下拉選單 */}
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-[#10141f]/95 backdrop-blur-md border border-[#2a3449] rounded-xl shadow-2xl overflow-hidden divide-y divide-[#1b2233] max-h-64 overflow-y-auto custom-scrollbar">
                    {suggestions.map((item) => (
                      <button
                        key={`${item.symbol}_${item.exchange}`}
                        type="button"
                        onClick={() => {
                          setStockSymbolInput(item.symbol);
                          setShowSuggestions(false);
                          fetchStockData(item.symbol);
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-emerald-500/15 flex items-center justify-between gap-2 transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono font-bold text-xs text-emerald-400 group-hover:text-emerald-300 shrink-0">
                            {item.symbol}
                          </span>
                          <span className="text-[11px] text-gray-300 truncate group-hover:text-white">
                            {item.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.exchange && (
                            <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10">
                              {item.exchange}
                            </span>
                          )}
                          {item.type && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                              {item.type}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 查詢報價圖示按鈕 */}
              <button
                type="button"
                onClick={() => {
                  setShowSuggestions(false);
                  fetchStockData();
                }}
                disabled={loadingStock}
                title="查詢報價"
                className="w-9 h-9 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-all flex items-center justify-center shrink-0 cursor-pointer shadow-sm active:scale-95"
              >
                {loadingStock ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </div>

            {/* 條件設定區塊：第一行 (起始日期, 結束日期) / 第二行 (週期, 時間範圍, 包含盤前/盤後) */}
            <div className="flex flex-col gap-2 pt-2 border-t border-[#1e2535] text-xs">
              {/* 第一行: 起始日期, 結束日期 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[10.5px] text-gray-400 font-medium">起始日期</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="bg-[#0e121a] border border-[#262f40] rounded-lg px-2.5 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-emerald-500 w-full"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10.5px] text-gray-400 font-medium">結束日期</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="bg-[#0e121a] border border-[#262f40] rounded-lg px-2.5 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-emerald-500 w-full"
                  />
                </div>
              </div>

              {/* 第二行: 週期, 時間範圍, 包含盤前/盤後 */}
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                {/* 週期 */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10.5px] text-gray-400 font-medium">週期</span>
                  <select
                    value={interval}
                    onChange={(e) => handleIntervalChange(e.target.value)}
                    className="bg-[#0e121a] border border-[#262f40] rounded-lg px-2 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-emerald-500 w-full"
                  >
                    {['1m', '2m', '5m', '15m', '30m', '60m', '1d', '1wk', '1mo'].map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* 時間範圍 */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10.5px] text-gray-400 font-medium">時間範圍</span>
                  <select
                    value={range}
                    onChange={(e) => handleRangeChange(e.target.value)}
                    className="bg-[#0e121a] border border-[#262f40] rounded-lg px-2 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-emerald-500 w-full"
                  >
                    {['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y', 'max'].map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* 包含盤前/盤後 */}
                <div className="flex items-center pb-2 px-1">
                  <label className="flex items-center gap-1.5 cursor-pointer text-gray-300 hover:text-white select-none whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={includePrePost}
                      onChange={(e) => setIncludePrePost(e.target.checked)}
                      className="w-3.5 h-3.5 accent-emerald-500 rounded bg-[#0e121a] border-gray-600 cursor-pointer"
                    />
                    <span className="text-[11px]">包含盤前/盤後</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* 錯誤提示 */}
          {stockError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{stockError}</span>
            </div>
          )}

          {/* 報價卡片與圖表 */}
          {stockData && (
            <div className="bg-[#121622] rounded-xl border border-[#222938] p-3 sm:p-4 flex flex-col gap-3">
              {/* 頂部股票基本資訊與價格 */}
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#1e2535] pb-3">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-black font-mono text-white tracking-wide">
                      {stockData.symbol}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-gray-300 font-mono">
                      {stockData.exchangeName || 'Market'}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
                      {stockData.currency}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 mt-0.5 font-medium line-clamp-1" title={stockData.longName}>
                    {stockData.longName || stockData.shortName}
                  </span>
                </div>

                {/* 現價與漲跌幅 */}
                <div className="flex flex-col items-end">
                  <div className="text-2xl font-black font-mono text-white">
                    {stockData.currency === 'CAD' ? 'C$' : '$'}
                    {stockData.regularMarketPrice.toFixed(2)}
                  </div>
                  <div className={`flex items-center gap-1 text-xs font-mono font-bold ${
                    stockData.change >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {stockData.change >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    <span>{stockData.change >= 0 ? '+' : ''}{stockData.change.toFixed(2)}</span>
                    <span>({stockData.changePercent >= 0 ? '+' : ''}{stockData.changePercent.toFixed(2)}%)</span>
                  </div>
                </div>
              </div>

              {/* 報價指標網格 (最高/最低/成交量/前收) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-[#0d1017] p-2 rounded-lg border border-[#1e2536] flex flex-col">
                  <span className="text-[10px] text-gray-400">當日最高 / 最低</span>
                  <span className="font-mono font-bold text-gray-200 mt-0.5">
                    {stockData.regularMarketDayHigh ? `$${stockData.regularMarketDayHigh.toFixed(2)}` : '--'} / {stockData.regularMarketDayLow ? `$${stockData.regularMarketDayLow.toFixed(2)}` : '--'}
                  </span>
                </div>

                <div className="bg-[#0d1017] p-2 rounded-lg border border-[#1e2536] flex flex-col">
                  <span className="text-[10px] text-gray-400">昨收盤價 (Prev Close)</span>
                  <span className="font-mono font-bold text-gray-200 mt-0.5">
                    ${stockData.previousClose.toFixed(2)}
                  </span>
                </div>

                <div className="bg-[#0d1017] p-2 rounded-lg border border-[#1e2536] flex flex-col">
                  <span className="text-[10px] text-gray-400">成交量 (Volume)</span>
                  <span className="font-mono font-bold text-gray-200 mt-0.5">
                    {stockData.regularMarketVolume ? stockData.regularMarketVolume.toLocaleString() : '--'}
                  </span>
                </div>

                <div className="bg-[#0d1017] p-2 rounded-lg border border-[#1e2536] flex flex-col">
                  <span className="text-[10px] text-gray-400">時區 / 類型</span>
                  <span className="font-mono font-bold text-gray-200 mt-0.5 truncate">
                    {stockData.timezone} ({stockData.instrumentType || 'EQUITY'})
                  </span>
                </div>
              </div>

              {/* 簡易 SVG 趨勢走勢圖 */}
              {stockData.chartPoints.length > 1 && (() => {
                const pts = stockData.chartPoints;
                const prices = pts.map(p => p.close as number);
                const minP = Math.min(...prices);
                const maxP = Math.max(...prices);
                const rangeP = maxP - minP || 1;
                const svgW = 600;
                const svgH = 160;

                const polylinePoints = pts.map((p, idx) => {
                  const x = (idx / (pts.length - 1)) * svgW;
                  const y = svgH - (((p.close as number) - minP) / rangeP) * (svgH - 24) - 12;
                  return `${x},${y}`;
                }).join(' ');

                const isUp = stockData.change >= 0;
                const strokeColor = isUp ? '#10b981' : '#f43f5e';
                const fillColor = isUp ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)';

                const areaPoints = `0,${svgH} ${polylinePoints} ${svgW},${svgH}`;

                return (
                  <div className="flex flex-col gap-1.5 pt-1">
                    <div className="flex items-center justify-between text-[11px] text-gray-400">
                      <span>走勢圖表 ({range} / {interval})</span>
                      <span className="font-mono text-gray-500">
                        最低: ${minP.toFixed(2)} - 最高: ${maxP.toFixed(2)}
                      </span>
                    </div>

                    <div className="w-full bg-[#0d1017] border border-[#1e2536] rounded-xl p-2 relative overflow-hidden">
                      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-36 sm:h-44 overflow-visible">
                        <defs>
                          <linearGradient id={`grad-${stockData.symbol}`} x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.3" />
                            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
                          </linearGradient>
                        </defs>
                        {/* 面積漸層 */}
                        <polygon points={areaPoints} fill={`url(#grad-${stockData.symbol})`} />
                        {/* 走勢折線 */}
                        <polyline
                          fill="none"
                          stroke={strokeColor}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={polylinePoints}
                        />
                      </svg>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 子分頁 2: 財經新聞 (Finance News RSS) */}
      {/* ========================================================================= */}
      {subTab === 'news' && (
        <div className="flex flex-col flex-1 min-h-0 gap-2.5 overflow-y-auto pr-0.5 custom-scrollbar">
          {/* 搜尋欄位與分類快選按鈕 */}
          <div className="p-3 bg-[#121622] rounded-xl border border-[#222938] flex flex-col gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={newsQuery}
                  onChange={(e) => setNewsQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') fetchNews(); }}
                  placeholder="搜尋財經新聞關鍵字 (如: TSLA, Bank of Canada, Housing, Fed)..."
                  className="w-full bg-[#0d1017] border border-[#262e3d] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                />
                <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              </div>

              <button
                type="button"
                onClick={() => fetchNews()}
                disabled={loadingNews}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1 shrink-0 cursor-pointer shadow-sm"
              >
                {loadingNews ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                <span>搜尋</span>
              </button>
            </div>

            {/* 快速標籤 */}
            <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] custom-scrollbar">
              <span className="text-gray-400 shrink-0">主題:</span>
              {[
                { label: '市場動態', q: 'market' },
                { label: '加拿大經濟', q: 'Bank of Canada economy' },
                { label: '美聯儲利率', q: 'Federal Reserve interest rates' },
                { label: '科技股', q: 'technology stocks' },
                { label: '溫哥華房產', q: 'Vancouver real estate' },
                { label: '能源與油價', q: 'oil gas energy' },
              ].map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  onClick={() => {
                    setNewsQuery(btn.q);
                    fetchNews(btn.q);
                  }}
                  className={`px-2 py-0.5 rounded font-medium border transition-colors cursor-pointer shrink-0 ${
                    newsQuery === btn.q
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                      : 'bg-[#181d2a] text-gray-400 hover:text-white border-[#273042]'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          {/* 新聞清單列表 */}
          {loadingNews && newsList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
              <span className="text-xs">正在載入即時財經新聞...</span>
            </div>
          ) : newsList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500 gap-1.5 text-xs">
              <Newspaper className="w-8 h-8 text-gray-600 mb-1" />
              <span>查無相關財經新聞，請嘗試更換搜尋關鍵字</span>
            </div>
          ) : (
            <div className="space-y-2">
              {newsList.map((item) => {
                const dateStr = new Date(item.publishTime * 1000).toLocaleString(undefined, {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                });

                return (
                  <div
                    key={item.id}
                    className="p-3 bg-[#121622] hover:bg-[#161c29] border border-[#222938] hover:border-emerald-500/40 rounded-xl transition-all flex flex-col sm:flex-row gap-3 items-start"
                  >
                    {item.thumbnail && (
                      <img
                        src={item.thumbnail}
                        alt=""
                        className="w-full sm:w-28 h-24 object-cover rounded-lg shrink-0 border border-[#273042]"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                      />
                    )}

                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-[10.5px] text-gray-400 mb-1 font-mono">
                        <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 font-semibold">
                          {item.publisher}
                        </span>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-gray-500" />
                          <span>{dateStr}</span>
                        </div>
                      </div>

                      <a
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs sm:text-[13px] font-bold text-gray-100 hover:text-emerald-400 transition-colors leading-snug line-clamp-2"
                      >
                        {item.title}
                      </a>

                      {item.summary && (
                        <p className="text-[11px] text-gray-400 line-clamp-2 mt-1 leading-relaxed">
                          {item.summary}
                        </p>
                      )}

                      <div className="mt-2 flex items-center justify-end">
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium transition-colors"
                        >
                          <span>前往原文</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 子分頁 3: TFSA 投資配置分析 (依照圖片 1 視覺配置精確呈現) */}
      {/* ========================================================================= */}
      {subTab === 'tfsa' && (
        <div className="flex flex-col flex-1 min-h-0 gap-3 overflow-y-auto pr-0.5 custom-scrollbar">
          {/* 1. 總限額設定卡片 (參考圖片 1 頂部) */}
          <div className="bg-[#121622] rounded-xl border border-[#222938] p-3.5 sm:p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-gray-200">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span>總限額設定</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 items-end">
              {/* 符合資格年份 (起) */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-400 font-medium">符合資格年份 (起)</label>
                <input
                  type="number"
                  min="2009"
                  max="2035"
                  value={eligibleStartYear}
                  onChange={(e) => {
                    const y = parseInt(e.target.value, 10) || 2024;
                    setEligibleStartYear(y);
                    saveTfsaConfig(tfsaStocks, y, calcEndYear, extraDeposit, withdrawalDeduct);
                  }}
                  className="bg-[#0e121a] border border-[#262f40] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* 計算至年份 (迄) */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-400 font-medium">計算至年份 (迄)</label>
                <input
                  type="number"
                  min="2009"
                  max="2035"
                  value={calcEndYear}
                  onChange={(e) => {
                    const y = parseInt(e.target.value, 10) || 2027;
                    setCalcEndYear(y);
                    saveTfsaConfig(tfsaStocks, eligibleStartYear, y, extraDeposit, withdrawalDeduct);
                  }}
                  className="bg-[#0e121a] border border-[#262f40] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* 額外存入 ($) */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-400 font-medium">額外存入 ($)</label>
                <input
                  type="number"
                  value={extraDeposit}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value) || 0;
                    setExtraDeposit(v);
                    saveTfsaConfig(tfsaStocks, eligibleStartYear, calcEndYear, v, withdrawalDeduct);
                  }}
                  className="bg-[#0e121a] border border-[#262f40] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* 提款減去 ($) */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-400 font-medium">提款減去 ($)</label>
                <input
                  type="number"
                  value={withdrawalDeduct}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value) || 0;
                    setWithdrawalDeduct(v);
                    saveTfsaConfig(tfsaStocks, eligibleStartYear, calcEndYear, extraDeposit, v);
                  }}
                  className="bg-[#0e121a] border border-[#262f40] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* 系統計算總限額 */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] text-gray-400 font-medium">系統計算總限額</span>
                <span className="text-xl font-black font-mono text-white tracking-tight">
                  ${systemCalculatedLimit.toLocaleString()}
                </span>
              </div>

              {/* 現在剩餘資金 */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] text-gray-400 font-medium">現在剩餘資金</span>
                <span className={`text-xl font-black font-mono tracking-tight ${
                  remainingFunds >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  ${remainingFunds.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>
          </div>

          {/* 2. 投資配置管理卡片 (表格與滑桿) */}
          <div className="bg-[#121622] rounded-xl border border-[#222938] p-3.5 sm:p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-gray-200">投資配置管理</span>

              <button
                type="button"
                onClick={handleUpdateCurrentPrices}
                disabled={updatingPrices}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${updatingPrices ? 'animate-spin' : ''}`} />
                <span>更新現價</span>
              </button>
            </div>

            {/* 表格本體 (水平滾動容器) */}
            <div className="overflow-x-auto pb-2 custom-scrollbar border border-[#1e2536] rounded-xl">
              <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                <thead>
                  <tr className="bg-[#0e121a] text-gray-400 border-b border-[#202738] font-bold text-[11px]">
                    <th className="py-2.5 px-3">代號</th>
                    <th className="py-2.5 px-3 min-w-[130px]">目標比例 (%)</th>
                    <th className="py-2.5 px-3">目標金額</th>
                    <th className="py-2.5 px-3">現價 (原幣)</th>
                    <th className="py-2.5 px-3">持倉</th>
                    <th className="py-2.5 px-3">均價</th>
                    <th className="py-2.5 px-3">現值</th>
                    <th className="py-2.5 px-3">買價</th>
                    <th className="py-2.5 px-3 min-w-[120px]">買入數量</th>
                    <th className="py-2.5 px-3">尚需買入 / 試算</th>
                    <th className="py-2.5 px-3">試算後均價</th>
                    <th className="py-2.5 px-3 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1c2230]">
                  {tfsaStocks.map((stk, idx) => {
                    const targetAmount = Math.round(systemCalculatedLimit * (stk.targetPercent / 100));
                    const currentValue = stk.shares * stk.currentPrice;
                    const buyP = stk.buyPrice ?? stk.currentPrice;
                    const buySh = stk.buyShares || 0;

                    // 尚需買入計算： (目標金額 - 現值)
                    const diffValue = targetAmount - currentValue;
                    const neededShares = (diffValue > 0 && stk.currentPrice > 0)
                      ? Math.ceil(diffValue / stk.currentPrice)
                      : 0;

                    // 試算後均價公式
                    const totalSharesAfter = stk.shares + buySh;
                    const calculatedAvgPrice = totalSharesAfter > 0
                      ? (stk.shares * stk.avgPrice + buySh * buyP) / totalSharesAfter
                      : stk.avgPrice;

                    return (
                      <tr key={stk.id} className="hover:bg-[#161c2a] transition-colors">
                        {/* 1. 代號 */}
                        <td className="py-2.5 px-3 font-mono font-black text-white">
                          {stk.symbol}
                        </td>

                        {/* 2. 目標比例 (%) + 滑桿 */}
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={stk.targetPercent}
                              onChange={(e) => handleStockChange(stk.id, 'targetPercent', parseInt(e.target.value, 10))}
                              className="w-20 accent-blue-500 cursor-pointer h-1.5 bg-gray-700 rounded-lg"
                            />
                            <span className="font-mono font-bold text-gray-200 w-6 text-right">
                              {stk.targetPercent}
                            </span>
                            <span className="text-gray-500 text-[10px]">%</span>
                          </div>
                        </td>

                        {/* 3. 目標金額 */}
                        <td className="py-2.5 px-3 font-mono font-semibold text-gray-300">
                          ${targetAmount.toLocaleString()}
                        </td>

                        {/* 4. 現價 */}
                        <td className="py-2.5 px-3 font-mono text-gray-300">
                          $ {stk.currentPrice.toFixed(2)}
                        </td>

                        {/* 5. 持倉 */}
                        <td className="py-2.5 px-3 font-mono">
                          <input
                            type="number"
                            value={stk.shares}
                            onChange={(e) => handleStockChange(stk.id, 'shares', parseFloat(e.target.value) || 0)}
                            className="w-16 bg-[#0e121a] border border-[#252e40] rounded px-1.5 py-0.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                          />
                        </td>

                        {/* 6. 均價 */}
                        <td className="py-2.5 px-3 font-mono">
                          <input
                            type="number"
                            step="0.001"
                            value={stk.avgPrice}
                            onChange={(e) => handleStockChange(stk.id, 'avgPrice', parseFloat(e.target.value) || 0)}
                            className="w-20 bg-[#0e121a] border border-[#252e40] rounded px-1.5 py-0.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                          />
                        </td>

                        {/* 7. 現值 */}
                        <td className="py-2.5 px-3 font-mono font-semibold text-white">
                          ${currentValue.toFixed(2)}
                        </td>

                        {/* 8. 買價 */}
                        <td className="py-2.5 px-3 font-mono">
                          <input
                            type="number"
                            step="0.01"
                            value={stk.buyPrice ?? stk.currentPrice}
                            onChange={(e) => handleStockChange(stk.id, 'buyPrice', parseFloat(e.target.value) || 0)}
                            className="w-16 bg-[#0e121a] border border-[#252e40] rounded px-1.5 py-0.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                          />
                        </td>

                        {/* 9. 買入數量 + 滑桿 */}
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col gap-1">
                            <input
                              type="number"
                              min="0"
                              value={stk.buyShares || 0}
                              onChange={(e) => handleStockChange(stk.id, 'buyShares', parseInt(e.target.value, 10) || 0)}
                              className="w-16 bg-[#0e121a] border border-[#252e40] rounded px-1.5 py-0.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                            />
                            <input
                              type="range"
                              min="0"
                              max={Math.max(neededShares * 2, 100)}
                              value={stk.buyShares || 0}
                              onChange={(e) => handleStockChange(stk.id, 'buyShares', parseInt(e.target.value, 10) || 0)}
                              className="w-20 accent-blue-500 cursor-pointer h-1.5 bg-gray-700 rounded-lg"
                            />
                          </div>
                        </td>

                        {/* 10. 尚需買入 / 試算 */}
                        <td className="py-2.5 px-3 font-mono leading-tight">
                          {diffValue <= 0 ? (
                            <span className="text-emerald-400 font-bold">已達標</span>
                          ) : (
                            <div className="flex flex-col">
                              <span className="text-gray-200 font-bold">{neededShares} 股</span>
                              <span className="text-[10px] text-gray-400 font-normal">
                                餘 $ {diffValue.toFixed(0)}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* 11. 試算後均價 */}
                        <td className="py-2.5 px-3 font-mono font-bold text-white">
                          ${calculatedAvgPrice.toFixed(2)}
                        </td>

                        {/* 12. 操作 */}
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMoveStock(idx, 'up')}
                              disabled={idx === 0}
                              className="p-1 text-gray-400 hover:text-white disabled:opacity-20 cursor-pointer"
                              title="上移"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveStock(idx, 'down')}
                              disabled={idx === tfsaStocks.length - 1}
                              className="p-1 text-gray-400 hover:text-white disabled:opacity-20 cursor-pointer"
                              title="下移"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteStock(stk.id)}
                              className="p-1 text-rose-400 hover:text-rose-300 cursor-pointer ml-1"
                              title="刪除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 3. 底部列：新增股票 (代號, 數量, 均價, + 新增按鈕) */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#1e2535]">
              <input
                type="text"
                placeholder="代號 (如: AAPL)"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                className="w-28 bg-[#0e121a] border border-[#252e40] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono uppercase focus:outline-none focus:border-blue-500"
              />
              <input
                type="number"
                placeholder="數量 (持倉股數)"
                value={newShares}
                onChange={(e) => setNewShares(e.target.value)}
                className="w-28 bg-[#0e121a] border border-[#252e40] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
              />
              <input
                type="number"
                step="0.01"
                placeholder="均價 ($)"
                value={newAvgPrice}
                onChange={(e) => setNewAvgPrice(e.target.value)}
                className="w-28 bg-[#0e121a] border border-[#252e40] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={handleAddStock}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer shadow-sm flex items-center gap-1"
              >
                <span>+ 新增</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
