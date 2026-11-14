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
  Trash2,
  ArrowUp,
  ArrowDown,
  Clock,
  AlertCircle,
  DollarSign,
  Plus,
  Ellipsis,
  FunnelX,
  X
} from 'lucide-react';
import { useUIStore } from '@/store/useUIStore';
import { formatDateTime } from '@/utils/time';

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

export function FinanceTab() {
  const { timeFormat, timeZone } = useUIStore();
  const [subTab, setSubTab] = useState<'stock' | 'news' | 'tfsa'>('stock');

  // ==================== 1. 股票搜尋狀態 ====================
  const [stockSymbolInput, setStockSymbolInput] = useState<string>('');
  const [interval, setInterval] = useState<string>('1d');
  const [range, setRange] = useState<string>('1mo');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [includePrePost, setIncludePrePost] = useState<boolean>(false);
  const [loadingStock, setLoadingStock] = useState<boolean>(false);
  const [stockData, setStockData] = useState<StockQuoteData | null>(null);
  const [stockError, setStockError] = useState<string>('');
  const [chartHoverIndex, setChartHoverIndex] = useState<number | null>(null);

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
      if (tfsaSearchContainerRef.current && !tfsaSearchContainerRef.current.contains(e.target as Node)) {
        setShowTfsaSuggestions(false);
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
    if (newRange === 'custom') {
      return;
    }
    if (['1mo', '3mo', '6mo', '1y', '5y', 'max'].includes(newRange) && interval === '1m') {
      setInterval('1d');
    } else if (['3mo', '6mo', '1y', '5y', 'max'].includes(newRange) && ['2m', '5m', '15m', '30m'].includes(interval)) {
      setInterval('1d');
    }
  };

  // 清除股票搜尋篩選條件
  const handleClearStockFilters = () => {
    setInterval('1d');
    setRange('1mo');
    setStartDate('');
    setEndDate('');
    setIncludePrePost(false);
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

      if (range === 'custom' && startDate && endDate) {
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
          params.set('range', '1mo');
        }
      } else {
        params.set('range', range === 'custom' ? '1mo' : range);
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

  // 當週期、時間範圍或盤前盤後設定變更且已有股票資料時，重新抓取該股票最新數據
  useEffect(() => {
    if (stockData?.symbol) {
      fetchStockData(stockData.symbol);
    }
  }, [interval, range, startDate, endDate, includePrePost]);

  // ==================== 2. 財經新聞狀態 ====================
  const [newsQuery, setNewsQuery] = useState<string>('');
  const [newsList, setNewsList] = useState<FinanceNewsItem[]>([]);
  const [loadingNews, setLoadingNews] = useState<boolean>(false);

  const fetchNews = useCallback(async (q?: string) => {
    const targetQ = q !== undefined ? q : newsQuery;
    setLoadingNews(true);
    try {
      const queryParam = (targetQ && targetQ.trim()) ? targetQ.trim() : 'market';
      const res = await fetch(`/api/finance/news?q=${encodeURIComponent(queryParam)}`);
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
  const [tfsaStocks, setTfsaStocks] = useState<TfsaStockItem[]>([]);
  const [updatingPrices, setUpdatingPrices] = useState<boolean>(false);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  // 點擊選單外部關閉操作選單
  useEffect(() => {
    if (!openActionMenuId) return;
    const handleCloseActionMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.action-menu-container')) {
        return;
      }
      setOpenActionMenuId(null);
    };
    document.addEventListener('mousedown', handleCloseActionMenu);
    return () => document.removeEventListener('mousedown', handleCloseActionMenu);
  }, [openActionMenuId]);

  // 新增股票輸入欄位與搜尋建議狀態
  const [newSymbol, setNewSymbol] = useState<string>('');
  const [newShares, setNewShares] = useState<string>('');
  const [newAvgPrice, setNewAvgPrice] = useState<string>('');
  const [tfsaSuggestions, setTfsaSuggestions] = useState<StockSuggestionItem[]>([]);
  const [showTfsaSuggestions, setShowTfsaSuggestions] = useState<boolean>(false);
  const [loadingTfsaSuggestions, setLoadingTfsaSuggestions] = useState<boolean>(false);
  const tfsaSearchContainerRef = useRef<HTMLDivElement>(null);

  // TFSA 股票代號輸入即時搜尋建議 (Debounce 250ms)
  useEffect(() => {
    const q = newSymbol.trim();
    if (!q || q.length < 1) {
      setTfsaSuggestions([]);
      setShowTfsaSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoadingTfsaSuggestions(true);
      try {
        const res = await fetch(`/api/finance/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (json.success && Array.isArray(json.suggestions)) {
          setTfsaSuggestions(json.suggestions);
          if (json.suggestions.length > 0) {
            setShowTfsaSuggestions(true);
          }
        } else {
          setTfsaSuggestions([]);
        }
      } catch {
        setTfsaSuggestions([]);
      } finally {
        setLoadingTfsaSuggestions(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [newSymbol]);

  // 選擇 TFSA 股票建議
  const handleSelectTfsaSuggestion = (sym: string) => {
    setNewSymbol(sym);
    setShowTfsaSuggestions(false);
    fetch(`/api/finance/stock?symbol=${encodeURIComponent(sym)}&range=1d&interval=1d`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data?.regularMarketPrice && !newAvgPrice) {
          setNewAvgPrice(json.data.regularMarketPrice.toFixed(2));
        }
      }).catch(() => {});
  };

  // LocalStorage 持久化 (若無存儲則維持空資料)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('godseye_tfsa_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.startYear) setEligibleStartYear(parsed.startYear);
        if (parsed.endYear) setCalcEndYear(parsed.endYear);
        if (parsed.extraDeposit !== undefined) setExtraDeposit(parsed.extraDeposit);
        if (parsed.withdrawal !== undefined) setWithdrawalDeduct(parsed.withdrawal);
        if (parsed.stocks && Array.isArray(parsed.stocks)) {
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
          setTfsaStocks(cur => {
            const updated = cur.map(it => it.id === newItem.id ? { ...it, currentPrice: p, buyPrice: p } : it);
            setTimeout(() => saveTfsaConfig(updated), 0);
            return updated;
          });
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
            {/* 代號輸入欄（支援即時搜尋建議）與查詢按鈕 */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1" ref={searchContainerRef}>
                <input
                  type="text"
                  value={stockSymbolInput}
                  onChange={(e) => {
                    setStockSymbolInput(e.target.value);
                    if (e.target.value.trim().length > 0) {
                      setShowSuggestions(true);
                    } else {
                      setShowSuggestions(false);
                    }
                  }}
                  onFocus={() => {
                    if (suggestions.length > 0 && stockSymbolInput.trim().length > 0) setShowSuggestions(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setShowSuggestions(false);
                      if (stockSymbolInput.trim()) {
                        fetchStockData();
                      }
                    } else if (e.key === 'Escape') {
                      setShowSuggestions(false);
                    }
                  }}
                  placeholder="輸入股票代號或名稱..."
                  className="w-full bg-[#0d1017] border border-[#262e3d] rounded-lg pl-8 pr-8 py-2 text-xs text-white placeholder-gray-500 uppercase font-mono font-bold focus:outline-none focus:border-emerald-500"
                />
                <Search className="w-4 h-4 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                {loadingSuggestions && (
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                )}
                {!loadingSuggestions && stockSymbolInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setStockSymbolInput('');
                      setShowSuggestions(false);
                      setStockData(null);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5 cursor-pointer"
                    title="清除"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
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
                  if (stockSymbolInput.trim()) {
                    fetchStockData();
                  }
                }}
                disabled={loadingStock}
                title="查詢股票報價"
                className="w-9 h-9 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-all flex items-center justify-center shrink-0 cursor-pointer shadow-sm active:scale-95"
              >
                {loadingStock ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </div>

            {/* 條件設定區塊：第一行 (週期, 時間範圍, 包含盤前/盤後, 清除篩選按鈕) / 第二行 (自定義時才顯示：起始日期, 結束日期) */}
            <div className="flex flex-col gap-2 pt-2 border-t border-[#1e2535] text-xs">
              {/* 第一行: 週期, 時間範圍, 包含盤前/盤後, 清除篩選按鈕 (FunnelX) */}
              <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
                {/* 週期 */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10.5px] text-gray-400 font-medium">週期</span>
                  <select
                    value={interval}
                    onChange={(e) => handleIntervalChange(e.target.value)}
                    className="bg-[#0e121a] border border-[#262f40] rounded-lg px-2 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-emerald-500 w-full"
                  >
                    {[
                      { value: '1m', label: '1分鐘' },
                      { value: '2m', label: '2分鐘' },
                      { value: '5m', label: '5分鐘' },
                      { value: '15m', label: '15分鐘' },
                      { value: '30m', label: '30分鐘' },
                      { value: '60m', label: '60分鐘' },
                      { value: '1d', label: '1天' },
                      { value: '1wk', label: '1週' },
                      { value: '1mo', label: '1個月' },
                    ].map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
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
                    {[
                      { value: '1d', label: '1天' },
                      { value: '5d', label: '5天' },
                      { value: '1mo', label: '1個月' },
                      { value: '3mo', label: '3個月' },
                      { value: '6mo', label: '6個月' },
                      { value: '1y', label: '1年' },
                      { value: '5y', label: '5年' },
                      { value: 'max', label: '最大範圍' },
                      { value: 'custom', label: '自定義' },
                    ].map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
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

                {/* 清除篩選圖示按鈕 (FunnelX) */}
                <div className="pb-1.5">
                  <button
                    type="button"
                    onClick={handleClearStockFilters}
                    className="p-1.5 rounded-lg border border-[#262f40] bg-[#0e121a] hover:bg-rose-500/10 hover:border-rose-500/30 hover:text-rose-400 text-gray-400 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                    title="清除篩選條件"
                  >
                    <FunnelX className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* 第二行: 當且僅當選擇自定義時才顯示 (起始日期, 結束日期) */}
              {range === 'custom' && (
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1e2535]/60 animate-in fade-in duration-150">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10.5px] text-gray-400 font-medium">起始日期</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="bg-[#0e121a] border border-[#262f40] rounded-lg px-2.5 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-emerald-500 w-full [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-100 [&::-webkit-calendar-picker-indicator]:[filter:brightness(0)_invert(1)]"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10.5px] text-gray-400 font-medium">結束日期</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="bg-[#0e121a] border border-[#262f40] rounded-lg px-2.5 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-emerald-500 w-full [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-100 [&::-webkit-calendar-picker-indicator]:[filter:brightness(0)_invert(1)]"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 錯誤提示 */}
          {stockError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{stockError}</span>
            </div>
          )}

          {/* 無查詢時提示 */}
          {!stockData && !loadingStock && !stockError && (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-500 text-xs">
              <Search className="w-7 h-7 opacity-30 text-gray-400" />
              <span>輸入股票代號（例如: NVDA, TSLA, RY.TO）即可自動查詢報價</span>
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

              {/* 報價指標網格 (最高/最低/成交量/前收/類型) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-[#0d1017] p-2 rounded-lg border border-[#1e2536] flex flex-col">
                  <span className="text-[10px] text-gray-400">當日最高 / 最低</span>
                  <span className="font-mono font-bold text-gray-200 mt-0.5">
                    {stockData.regularMarketDayHigh ? `$${stockData.regularMarketDayHigh.toFixed(2)}` : '--'} / {stockData.regularMarketDayLow ? `$${stockData.regularMarketDayLow.toFixed(2)}` : '--'}
                  </span>
                </div>

                <div className="bg-[#0d1017] p-2 rounded-lg border border-[#1e2536] flex flex-col">
                  <span className="text-[10px] text-gray-400">昨收盤價</span>
                  <span className="font-mono font-bold text-gray-200 mt-0.5">
                    ${stockData.previousClose.toFixed(2)}
                  </span>
                </div>

                <div className="bg-[#0d1017] p-2 rounded-lg border border-[#1e2536] flex flex-col">
                  <span className="text-[10px] text-gray-400">成交量</span>
                  <span className="font-mono font-bold text-gray-200 mt-0.5">
                    {stockData.regularMarketVolume ? stockData.regularMarketVolume.toLocaleString() : '--'}
                  </span>
                </div>

                <div className="bg-[#0d1017] p-2 rounded-lg border border-[#1e2536] flex flex-col">
                  <span className="text-[10px] text-gray-400">證券類型</span>
                  <span className="font-mono font-bold text-gray-200 mt-0.5 truncate">
                    {stockData.instrumentType || 'EQUITY'}
                  </span>
                </div>
              </div>

              {/* 互動式 SVG 趨勢走勢圖（含價格座標數字與指標懸浮詳細資訊） */}
              {stockData.chartPoints.length > 1 && (() => {
                const pts = stockData.chartPoints;
                const prices = pts.map(p => p.close as number);
                const minP = Math.min(...prices);
                const maxP = Math.max(...prices);
                const rangeP = maxP - minP || 1;
                const midP = (minP + maxP) / 2;

                const svgW = 600;
                const svgH = 200;
                const padLeft = 12;
                const padRight = 76; // 數字顯示區域 (適度加寬讓大字體價格不擁擠)
                const padTop = 20;
                const padBottom = 28;
                const plotW = svgW - padLeft - padRight;
                const plotH = svgH - padTop - padBottom;

                const coords = pts.map((p, idx) => {
                  const x = padLeft + (idx / (pts.length - 1)) * plotW;
                  const y = padTop + plotH - (((p.close as number) - minP) / rangeP) * plotH;
                  return { x, y, pt: p };
                });

                const polylinePoints = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
                const areaPoints = `${padLeft},${padTop + plotH} ${polylinePoints} ${padLeft + plotW},${padTop + plotH}`;

                const isUp = stockData.change >= 0;
                const strokeColor = isUp ? '#10b981' : '#f43f5e';

                const hovered = chartHoverIndex !== null && coords[chartHoverIndex] ? coords[chartHoverIndex] : null;

                const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const relativeX = e.clientX - rect.left;
                  const scaleX = svgW / rect.width;
                  const svgX = relativeX * scaleX;
                  const plotX = svgX - padLeft;
                  const ratio = Math.max(0, Math.min(1, plotX / plotW));
                  const idx = Math.min(pts.length - 1, Math.max(0, Math.round(ratio * (pts.length - 1))));
                  setChartHoverIndex(idx);
                };

                return (
                  <div className="flex flex-col gap-1.5 pt-1">
                    <div className="flex items-center justify-between text-[11px] text-gray-400">
                      <span>走勢圖表 ({range} / {interval})</span>
                      <span className="font-mono text-gray-400">
                        最低: <span className="text-gray-200 font-bold">${minP.toFixed(2)}</span> / 最高: <span className="text-gray-200 font-bold">${maxP.toFixed(2)}</span>
                      </span>
                    </div>

                    <div className="w-full bg-[#0d1017] border border-[#1e2536] rounded-xl p-2 sm:p-2.5 relative select-none">
                      {/* 指標碰觸特定時刻詳細數據卡 */}
                      {hovered ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 mb-1.5 bg-[#141924] border border-sky-500/40 rounded-lg text-xs font-mono shadow-md animate-in fade-in duration-100">
                          <div className="flex items-center gap-2">
                            <span className="text-sky-300 font-bold">
                              {formatDateTime(hovered.pt.time * 1000, timeFormat, timeZone)}
                            </span>
                            <span className="text-white font-black text-sm">
                              ${(hovered.pt.close as number).toFixed(2)}
                            </span>
                            {stockData.previousClose > 0 && (() => {
                              const diff = (hovered.pt.close as number) - stockData.previousClose;
                              const diffPct = (diff / stockData.previousClose) * 100;
                              const hUp = diff >= 0;
                              return (
                                <span className={`text-[11px] font-bold ${hUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {hUp ? '+' : ''}{diff.toFixed(2)} ({hUp ? '+' : ''}{diffPct.toFixed(2)}%)
                                </span>
                              );
                            })()}
                          </div>

                          <div className="flex items-center gap-2.5 text-[10.5px] text-gray-400">
                            {hovered.pt.open !== null && (
                              <span>開: <b className="text-gray-200">${hovered.pt.open.toFixed(2)}</b></span>
                            )}
                            {hovered.pt.high !== null && (
                              <span>高: <b className="text-gray-200">${hovered.pt.high.toFixed(2)}</b></span>
                            )}
                            {hovered.pt.low !== null && (
                              <span>低: <b className="text-gray-200">${hovered.pt.low.toFixed(2)}</b></span>
                            )}
                            {hovered.pt.volume !== null && hovered.pt.volume > 0 && (
                              <span>量: <b className="text-gray-200">{hovered.pt.volume.toLocaleString()}</b></span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between px-2 py-1 mb-1.5 text-[10.5px] text-gray-500 font-mono">
                          <span>移動滑鼠指標或手指觸控檢視特定時刻詳細價格</span>
                          <span>昨收盤價: ${stockData.previousClose.toFixed(2)}</span>
                        </div>
                      )}

                      <svg
                        viewBox={`0 0 ${svgW} ${svgH}`}
                        className="w-full h-44 sm:h-52 overflow-visible cursor-crosshair touch-none"
                        onPointerMove={handlePointerMove}
                        onPointerLeave={() => setChartHoverIndex(null)}
                      >
                        <defs>
                          <linearGradient id={`grad-${stockData.symbol}`} x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
                            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
                          </linearGradient>
                        </defs>

                        {/* 橫向參考水平網格線與清晰價格數字標籤 (放大至 12px 粗體) */}
                        <line x1={padLeft} y1={padTop} x2={padLeft + plotW} y2={padTop} stroke="#1f2738" strokeDasharray="3 3" />
                        <text x={padLeft + plotW + 8} y={padTop + 4} fill="#e2e8f0" fontSize="12" fontWeight="bold" fontFamily="monospace">
                          ${maxP.toFixed(2)}
                        </text>

                        <line x1={padLeft} y1={padTop + plotH / 2} x2={padLeft + plotW} y2={padTop + plotH / 2} stroke="#1f2738" strokeDasharray="3 3" />
                        <text x={padLeft + plotW + 8} y={padTop + plotH / 2 + 4} fill="#cbd5e1" fontSize="12" fontWeight="bold" fontFamily="monospace">
                          ${midP.toFixed(2)}
                        </text>

                        <line x1={padLeft} y1={padTop + plotH} x2={padLeft + plotW} y2={padTop + plotH} stroke="#1f2738" strokeDasharray="3 3" />
                        <text x={padLeft + plotW + 8} y={padTop + plotH + 4} fill="#e2e8f0" fontSize="12" fontWeight="bold" fontFamily="monospace">
                          ${minP.toFixed(2)}
                        </text>

                        {/* 底部 X 軸時間刻度 (放大至 11px 粗體) */}
                        <text x={padLeft} y={svgH - 8} fill="#cbd5e1" fontSize="11" fontWeight="600" fontFamily="monospace">
                          {formatDateTime(pts[0].time * 1000, timeFormat, timeZone)}
                        </text>
                        <text x={padLeft + plotW} y={svgH - 8} textAnchor="end" fill="#cbd5e1" fontSize="11" fontWeight="600" fontFamily="monospace">
                          {formatDateTime(pts[pts.length - 1].time * 1000, timeFormat, timeZone)}
                        </text>

                        {/* 漸層面積 */}
                        <polygon points={areaPoints} fill={`url(#grad-${stockData.symbol})`} />

                        {/* 折線 */}
                        <polyline
                          fill="none"
                          stroke={strokeColor}
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={polylinePoints}
                        />

                        {/* 指標碰觸十字準星與亮點 */}
                        {hovered && (
                          <g>
                            {/* 垂直指示線 */}
                            <line
                              x1={hovered.x}
                              y1={padTop}
                              x2={hovered.x}
                              y2={padTop + plotH}
                              stroke="#38bdf8"
                              strokeWidth="1.2"
                              strokeDasharray="2 2"
                            />
                            {/* 焦點圓點 */}
                            <circle
                              cx={hovered.x}
                              cy={hovered.y}
                              r="4.5"
                              fill="#38bdf8"
                              stroke="#ffffff"
                              strokeWidth="2"
                            />
                            {/* 右側 Y 軸高亮價格徽章 (加寬加高呈現 12px 粗體) */}
                            <rect
                              x={padLeft + plotW + 4}
                              y={hovered.y - 10}
                              width="68"
                              height="20"
                              rx="4"
                              fill="#0284c7"
                            />
                            <text
                              x={padLeft + plotW + 38}
                              y={hovered.y + 4}
                              textAnchor="middle"
                              fill="#ffffff"
                              fontSize="12"
                              fontWeight="bold"
                              fontFamily="monospace"
                            >
                              ${(hovered.pt.close as number).toFixed(2)}
                            </text>
                          </g>
                        )}
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
                  placeholder="搜尋財經新聞關鍵字..."
                  className="w-full bg-[#0d1017] border border-[#262e3d] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                />
                <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              </div>

              <button
                type="button"
                onClick={() => fetchNews()}
                disabled={loadingNews}
                title="搜尋財經新聞"
                className="w-9 h-9 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-all flex items-center justify-center shrink-0 cursor-pointer shadow-sm active:scale-95"
              >
                {loadingNews ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
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
              {newsList.map((item) => (
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

                  <div className="flex flex-col flex-1 min-w-0 w-full">
                    {/* 頂部資訊列：左側媒體來源，右上角顯示統一格式之日期與時間 */}
                    <div className="flex items-center justify-between gap-2 text-[10.5px] text-gray-400 mb-1.5 font-mono">
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-semibold text-[10px]">
                        {item.publisher}
                      </span>
                      <div className="flex items-center gap-1 text-[11px] text-gray-400 shrink-0">
                        <Clock className="w-3 h-3 text-gray-500" />
                        <span>{formatDateTime(item.publishTime * 1000, timeFormat, timeZone)}</span>
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
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 子分頁 3: TFSA 投資配置分析 */}
      {/* ========================================================================= */}
      {subTab === 'tfsa' && (
        <div className="flex flex-col flex-1 min-h-0 gap-3 overflow-y-auto pr-0.5 custom-scrollbar">
          {/* 1. 總限額設定卡片 */}
          <div className="bg-[#121622] rounded-xl border border-[#222938] p-3.5 sm:p-4 shadow-sm flex flex-col gap-3">
            {/* 第一行: 左側標題，右側貼齊邊界的總限額與剩餘資金 */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e2535] pb-2.5">
              <div className="flex items-center gap-2 text-sm font-bold text-gray-200">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span>總限額設定</span>
              </div>

              <div className="flex items-center gap-4 sm:gap-6 ml-auto">
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-gray-400 font-medium">系統計算總限額</span>
                  <span className="text-base sm:text-lg font-black font-mono text-white tracking-tight">
                    ${systemCalculatedLimit.toLocaleString()}
                  </span>
                </div>

                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-gray-400 font-medium">現在剩餘資金</span>
                  <span className={`text-base sm:text-lg font-black font-mono tracking-tight ${
                    remainingFunds >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    ${remainingFunds.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
              </div>
            </div>

            {/* 下方第 2 行: 年份(起), 年份(迄), 額外存入, 提款減去 (平均調闊) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
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
                  className="w-full bg-[#0e121a] border border-[#262f40] rounded-lg px-3 py-1.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>

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
                  className="w-full bg-[#0e121a] border border-[#262f40] rounded-lg px-3 py-1.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>

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
                  className="w-full bg-[#0e121a] border border-[#262f40] rounded-lg px-3 py-1.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>

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
                  className="w-full bg-[#0e121a] border border-[#262f40] rounded-lg px-3 py-1.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* 2. 新增股票區塊 (單行排列，最右側為加號圖示按鈕，代號支援搜尋建議，數量與均價較窄) */}
          <div className="bg-[#121622] rounded-xl border border-[#222938] p-2.5 sm:p-3 shadow-sm">
            <div className="flex items-center gap-2 w-full">
              {/* 股票代號輸入欄 (彈性較寬，支援即時搜尋建議) */}
              <div className="relative flex-1 min-w-[110px]" ref={tfsaSearchContainerRef}>
                <input
                  type="text"
                  placeholder="代號 (如: AAPL, RY.TO)"
                  value={newSymbol}
                  onChange={(e) => {
                    setNewSymbol(e.target.value.toUpperCase());
                    if (e.target.value.trim().length > 0) {
                      setShowTfsaSuggestions(true);
                    }
                  }}
                  onFocus={() => {
                    if (tfsaSuggestions.length > 0) setShowTfsaSuggestions(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setShowTfsaSuggestions(false);
                      handleAddStock();
                    } else if (e.key === 'Escape') {
                      setShowTfsaSuggestions(false);
                    }
                  }}
                  className="w-full bg-[#0e121a] border border-[#252e40] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono font-bold uppercase focus:outline-none focus:border-blue-500"
                />
                {loadingTfsaSuggestions && (
                  <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                )}

                {/* TFSA 股票搜尋建議下拉選單 */}
                {showTfsaSuggestions && tfsaSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-[#10141f]/95 backdrop-blur-md border border-[#2a3449] rounded-xl shadow-2xl overflow-hidden divide-y divide-[#1b2233] max-h-60 overflow-y-auto custom-scrollbar">
                    {tfsaSuggestions.map((item) => (
                      <button
                        key={`tfsa_sug_${item.symbol}_${item.exchange}`}
                        type="button"
                        onClick={() => handleSelectTfsaSuggestion(item.symbol)}
                        className="w-full px-3 py-2 text-left hover:bg-blue-500/15 flex items-center justify-between gap-2 transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono font-bold text-xs text-blue-400 group-hover:text-blue-300 shrink-0">
                            {item.symbol}
                          </span>
                          <span className="text-[11px] text-gray-300 truncate group-hover:text-white">
                            {item.name}
                          </span>
                        </div>
                        {item.exchange && (
                          <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10 shrink-0">
                            {item.exchange}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 數量輸入欄 (較窄) */}
              <input
                type="number"
                placeholder="數量"
                value={newShares}
                onChange={(e) => setNewShares(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddStock(); }}
                className="w-20 sm:w-24 bg-[#0e121a] border border-[#252e40] rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500 shrink-0 text-center"
              />

              {/* 均價輸入欄 (較窄) */}
              <input
                type="number"
                step="0.01"
                placeholder="均價 ($)"
                value={newAvgPrice}
                onChange={(e) => setNewAvgPrice(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddStock(); }}
                className="w-20 sm:w-24 bg-[#0e121a] border border-[#252e40] rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500 shrink-0 text-center"
              />

              {/* 最右側新增圖示按鈕 */}
              <button
                type="button"
                onClick={() => {
                  setShowTfsaSuggestions(false);
                  handleAddStock();
                }}
                title="新增股票"
                className="w-8 h-8 sm:w-9 sm:h-9 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all flex items-center justify-center cursor-pointer shadow-sm active:scale-95 shrink-0 ml-auto"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 3. 投資配置管理卡片 (卡片分行佈局，免橫向捲動) */}
          <div className="bg-[#121622] rounded-xl border border-[#222938] p-3.5 sm:p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-200">投資配置管理</span>
                <span className="text-xs text-gray-500 font-mono">({tfsaStocks.length})</span>
              </div>

              {/* 更新現價圖示按鈕 */}
              <button
                type="button"
                onClick={handleUpdateCurrentPrices}
                disabled={updatingPrices || tfsaStocks.length === 0}
                title="更新現價"
                className="w-8 h-8 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-all flex items-center justify-center cursor-pointer shadow-sm active:scale-95"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${updatingPrices ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* 股票清單 (多行卡片結構，無需左右拉動) */}
            {tfsaStocks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500 gap-1.5 text-xs border border-dashed border-[#222938] rounded-xl">
                <PiggyBank className="w-8 h-8 text-gray-600 mb-1" />
                <span>尚無 TFSA 配置股票，請在上方新增股票開始分析</span>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
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
                    <div
                      key={stk.id}
                      className="bg-[#0e121a] border border-[#202838] hover:border-[#2d374d] rounded-xl p-3 flex flex-col gap-2.5 transition-all shadow-sm"
                    >
                      {/* 行 1: 基本標頭 (代號、現價、現值、達標狀態、更多操作按鈕) */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="font-mono font-black text-base text-white">
                            {stk.symbol}
                          </span>
                          <span className="text-xs font-mono font-bold text-emerald-400">
                            ${stk.currentPrice.toFixed(2)}
                          </span>
                          <span className="text-xs text-gray-400 hidden sm:inline">
                            現值: <b className="font-mono text-white">${currentValue.toFixed(2)}</b>
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {/* 達標與需買狀態標籤 */}
                          {diffValue <= 0 ? (
                            <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                              已達標
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono">
                              需買 {neededShares} 股 (餘 ${diffValue.toFixed(0)})
                            </span>
                          )}

                          {/* 操作按鈕 (Lucide: ellipsis 下拉選單) */}
                          <div className="relative action-menu-container" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenActionMenuId(prev => (prev === stk.id ? null : stk.id));
                              }}
                              className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors cursor-pointer"
                              title="操作選項"
                            >
                              <Ellipsis className="w-4 h-4" />
                            </button>

                            {openActionMenuId === stk.id && (
                              <div className="absolute right-0 top-full mt-1 z-30 bg-[#161c2a] border border-[#2a3449] rounded-xl shadow-2xl py-1 w-28 flex flex-col text-xs font-medium animate-in fade-in duration-100">
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleMoveStock(idx, 'up');
                                    setOpenActionMenuId(null);
                                  }}
                                  disabled={idx === 0}
                                  className="px-3 py-1.5 text-left text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-30 flex items-center gap-2 cursor-pointer"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                  <span>上移</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleMoveStock(idx, 'down');
                                    setOpenActionMenuId(null);
                                  }}
                                  disabled={idx === tfsaStocks.length - 1}
                                  className="px-3 py-1.5 text-left text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-30 flex items-center gap-2 cursor-pointer"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                  <span>下移</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleDeleteStock(stk.id);
                                    setOpenActionMenuId(null);
                                  }}
                                  className="px-3 py-1.5 text-left text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer border-t border-[#222b3d] mt-0.5"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>刪除</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 行 2: 目標配置與滑桿 */}
                      <div className="flex items-center gap-2.5 bg-[#080b11] px-2.5 py-1.5 rounded-lg border border-[#1b2233]">
                        <span className="text-[11px] text-gray-400 shrink-0 font-medium">目標比例</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={stk.targetPercent}
                          onChange={(e) => handleStockChange(stk.id, 'targetPercent', parseInt(e.target.value, 10))}
                          className="flex-1 accent-blue-500 cursor-pointer h-1.5 bg-gray-700 rounded-lg"
                        />
                        <span className="font-mono font-bold text-xs text-blue-400 w-10 text-right shrink-0">
                          {stk.targetPercent}%
                        </span>
                        <span className="text-[11px] text-gray-400 border-l border-gray-700 pl-2 shrink-0">
                          目標金額: <b className="font-mono text-gray-200">${targetAmount.toLocaleString()}</b>
                        </span>
                      </div>

                      {/* 行 3: 持倉、均價、買價、買入數量、試算後均價 (拆分成 2 行 2 欄網格佈局) */}
                      <div className="grid grid-cols-2 gap-2.5 text-xs">
                        {/* 第 1 行左：持倉股數與均價 */}
                        <div className="bg-[#080b11] p-2.5 rounded-lg border border-[#1a2130] flex flex-col justify-between gap-1.5">
                          <span className="text-[10.5px] text-gray-400 font-medium">持倉股數 / 均價 ($)</span>
                          <div className="flex items-center gap-1.5 font-mono">
                            <input
                              type="number"
                              value={stk.shares}
                              onChange={(e) => handleStockChange(stk.id, 'shares', parseFloat(e.target.value) || 0)}
                              className="w-16 min-w-0 bg-[#121622] border border-[#252e40] rounded px-1.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                            />
                            <span className="text-gray-500 text-[10.5px] shrink-0">股 @</span>
                            <input
                              type="number"
                              step="0.001"
                              value={stk.avgPrice}
                              onChange={(e) => handleStockChange(stk.id, 'avgPrice', parseFloat(e.target.value) || 0)}
                              className="flex-1 min-w-0 bg-[#121622] border border-[#252e40] rounded px-1.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>

                        {/* 第 1 行右：試算買價 */}
                        <div className="bg-[#080b11] p-2.5 rounded-lg border border-[#1a2130] flex flex-col justify-between gap-1.5">
                          <span className="text-[10.5px] text-gray-400 font-medium">試算買價 ($)</span>
                          <input
                            type="number"
                            step="0.01"
                            value={stk.buyPrice ?? stk.currentPrice}
                            onChange={(e) => handleStockChange(stk.id, 'buyPrice', parseFloat(e.target.value) || 0)}
                            className="w-full bg-[#121622] border border-[#252e40] rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                          />
                        </div>

                        {/* 第 2 行左：試算買入數量與滑桿 */}
                        <div className="bg-[#080b11] p-2.5 rounded-lg border border-[#1a2130] flex flex-col justify-between gap-1.5">
                          <span className="text-[10.5px] text-gray-400 font-medium">試算買入 (股)</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              value={stk.buyShares || 0}
                              onChange={(e) => handleStockChange(stk.id, 'buyShares', parseInt(e.target.value, 10) || 0)}
                              className="w-16 min-w-0 bg-[#121622] border border-[#252e40] rounded px-1.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                            />
                            <input
                              type="range"
                              min="0"
                              max={Math.max(neededShares * 2, 100)}
                              value={stk.buyShares || 0}
                              onChange={(e) => handleStockChange(stk.id, 'buyShares', parseInt(e.target.value, 10) || 0)}
                              className="flex-1 accent-blue-500 cursor-pointer h-1.5 bg-gray-700 rounded-lg min-w-0"
                            />
                          </div>
                        </div>

                        {/* 第 2 行右：試算後均價 */}
                        <div className="bg-[#080b11] p-2.5 rounded-lg border border-[#1a2130] flex flex-col justify-between gap-1.5">
                          <span className="text-[10.5px] text-gray-400 font-medium">試算後均價</span>
                          <div className="flex items-baseline justify-between font-mono">
                            <span className="font-bold text-white text-sm">
                              ${calculatedAvgPrice.toFixed(2)}
                            </span>
                            {buySh > 0 && (
                              <span className="text-[10px] text-blue-400">
                                (共 {totalSharesAfter} 股)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
