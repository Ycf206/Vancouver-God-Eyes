'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  Server, 
  Cloud, 
  RefreshCw, 
  Sliders, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Play, 
  Shield, 
  Search, 
  Filter, 
  Lock, 
  Unlock, 
  FileText, 
  Trash2, 
  ExternalLink,
  ChevronRight,
  Sparkles,
  Zap,
  Key,
  X,
  Check
} from 'lucide-react';
import { getApiUrl } from '@/utils/api';
import { DEFAULT_ADMIN_SOURCES } from '@/data/defaultAdminSources';

interface DataSource {
  id: string;
  name: string;
  type: string;
  runner: 'github_actions' | 'oci';
  workflow_file?: string | null;
  category: string;
  cron_expr: string;
  schedule_interval: string;
  record_count: number;
  unit: string;
  last_updated: string;
  status: string;
  enabled?: boolean;
  data_pipeline_notes?: string;
}

interface AuditLog {
  id: string;
  timestamp: string;
  action: string;
  source_name: string;
  runner?: string;
  status: string;
  detail: string;
}

export default function AdminPage() {
  const [sources, setSources] = useState<DataSource[]>(DEFAULT_ADMIN_SOURCES as DataSource[]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'github_actions' | 'oci' | 'logs'>('all');
  
  // Security PIN protection (Default: 0206)
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  // GitHub Token State & Modal
  const [githubStatus, setGithubStatus] = useState<{ configured: boolean; repo: string; token_masked: string }>({
    configured: false,
    repo: 'Ycf206/Vancouver-God-Eyes',
    token_masked: '未設定'
  });
  const [isGithubModalOpen, setIsGithubModalOpen] = useState(false);
  const [inputGithubToken, setInputGithubToken] = useState('');
  const [isSavingToken, setIsSavingToken] = useState(false);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Operation States
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCron, setEditCron] = useState('');
  const [editInterval, setEditInterval] = useState('');
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Check sessionStorage for unlocked status
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const unlocked = sessionStorage.getItem('gods_eye_admin_unlocked');
      if (unlocked === 'true') {
        setIsUnlocked(true);
      }
    }
  }, []);

  // 統一防禦型管理 API 請求輔助函數 (完全杜絕 HTML 502/404 造成之 SyntaxError 與跨域 CORS 問題)
  const adminApiFetch = async <T = any>(
    path: string, 
    options: RequestInit = {}
  ): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> => {
    const tryFetch = async (url: string) => {
      return await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
    };

    let res: Response | null = null;
    let lastError = '';

    // 1. 優先採用同源相對路徑
    try {
      res = await tryFetch(path);
    } catch (err: any) {
      lastError = err?.message || String(err);
    }

    // 2. 若相對路徑網路層失敗，備用嘗試 apiUrl
    if (!res) {
      try {
        const apiUrl = getApiUrl();
        if (apiUrl && !apiUrl.startsWith(window.location.origin)) {
          res = await tryFetch(`${apiUrl}${path}`);
        }
      } catch (err: any) {
        lastError = err?.message || String(err);
      }
    }

    if (!res) {
      return { ok: false, error: lastError || '無法連線至伺服器，請檢查網路連線或稍候再試' };
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const json = await res.json();
        if (res.ok) {
          return { ok: true, data: json, status: res.status };
        } else {
          return { ok: false, error: json.message || json.detail || `請求失敗 (HTTP ${res.status})`, status: res.status };
        }
      } catch (_) {
        return { ok: false, error: '回傳資料解析失敗', status: res.status };
      }
    }

    // 非 JSON 格式 (如 Nginx 502 Bad Gateway HTML, 404, 500, 或 Cloudflare 攔截頁面)
    if (res.status === 502 || res.status === 504) {
      return { ok: false, error: `後端服務啟動中或伺服器正在重新編譯容器 (HTTP ${res.status})，請稍候 30 秒再試`, status: res.status };
    }
    if (res.status === 404) {
      return { ok: false, error: `找不到對應的後端 API 端點 (HTTP 404)`, status: res.status };
    }
    return { ok: false, error: `伺服器回應異常 (HTTP ${res.status})`, status: res.status };
  };

  const fetchAdminData = async () => {
    try {
      setIsLoading(true);
      
      const res = await adminApiFetch<{ sources: DataSource[]; logs: AuditLog[] }>('/api/admin/sources');
      if (res.ok && res.data && Array.isArray(res.data.sources) && res.data.sources.length > 0) {
        setSources(res.data.sources);
        setLogs(res.data.logs || []);
        setBackendConnected(true);
      } else {
        // 終極保底：若後端暫未回應，立即採用內建 45 項完整圖資字典
        setSources(DEFAULT_ADMIN_SOURCES as DataSource[]);
        setBackendConnected(false);
      }

      // 查詢 GitHub Token 配置狀態
      const ghRes = await adminApiFetch<{ configured: boolean; repo: string; token_masked: string }>('/api/admin/github-status');
      if (ghRes.ok && ghRes.data) {
        setGithubStatus(ghRes.data);
      }
    } catch (err) {
      console.error('Failed to load admin data:', err);
      setSources(DEFAULT_ADMIN_SOURCES as DataSource[]);
      setBackendConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
    const interval = setInterval(fetchAdminData, 30000);
    return () => clearInterval(interval);
  }, []);

  // 密碼解鎖 (依使用者指示設為 0206)
  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput === '0206') {
      setIsUnlocked(true);
      setPinError(false);
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('gods_eye_admin_unlocked', 'true');
      }
    } else {
      setPinError(true);
    }
  };

  // 儲存 GitHub Token
  const handleSaveGithubToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputGithubToken.trim()) return;
    setIsSavingToken(true);
    try {
      const res = await adminApiFetch<{ status: string; message: string }>('/api/admin/github-token', {
        method: 'POST',
        body: JSON.stringify({
          token: inputGithubToken.trim(),
          repo: githubStatus.repo || 'Ycf206/Vancouver-God-Eyes'
        })
      });
      if (res.ok && res.data) {
        setSuccessMsg(res.data.message || 'GitHub Token 已成功儲存！');
        setTimeout(() => setSuccessMsg(null), 6000);
        setIsGithubModalOpen(false);
        setInputGithubToken('');
        await fetchAdminData();
      } else {
        alert('儲存失敗: ' + (res.error || '未知錯誤'));
      }
    } catch (err: any) {
      alert('儲存失敗: ' + (err?.message || err));
    } finally {
      setIsSavingToken(false);
    }
  };

  // Trigger Sync (場景一)
  const handleSync = async (sourceId: string, runner?: 'github_actions' | 'oci') => {
    setSyncingId(sourceId);
    try {
      const res = await adminApiFetch<{ status: string; message: string }>('/api/admin/sources/sync', {
        method: 'POST',
        body: JSON.stringify({ source_id: sourceId, runner })
      });
      if (res.ok && res.data) {
        setSuccessMsg(res.data.message || '同步請求已成功提交！');
        setTimeout(() => setSuccessMsg(null), 5000);
        await fetchAdminData();
      } else {
        alert('同步失敗: ' + (res.error || '未知錯誤'));
      }
    } catch (err: any) {
      console.error('Sync failed:', err);
    } finally {
      setSyncingId(null);
    }
  };

  // Save Schedule Change (場景二)
  const handleSaveSchedule = async (source: DataSource) => {
    setIsSavingSchedule(true);
    try {
      const res = await adminApiFetch<{ status: string; message: string; detail?: string }>('/api/admin/sources/schedule', {
        method: 'POST',
        body: JSON.stringify({
          source_id: source.id,
          cron_expr: editCron || source.cron_expr,
          schedule_interval: editInterval || source.schedule_interval,
          enabled: source.enabled !== false
        })
      });
      if (res.ok && res.data) {
        setSuccessMsg(`排程已儲存！${res.data.detail || res.data.message || ''}`);
        setTimeout(() => setSuccessMsg(null), 6000);
        setEditingId(null);
        await fetchAdminData();
      } else {
        alert('儲存排程失敗: ' + (res.error || '未知錯誤'));
      }
    } catch (err: any) {
      console.error('Save schedule failed:', err);
    } finally {
      setIsSavingSchedule(false);
    }
  };

  // Toggle Source Enabled/Disabled
  const handleToggleEnabled = async (source: DataSource) => {
    try {
      await adminApiFetch('/api/admin/sources/schedule', {
        method: 'POST',
        body: JSON.stringify({
          source_id: source.id,
          enabled: !source.enabled
        })
      });
      await fetchAdminData();
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  };

  // Clear Logs
  const handleClearLogs = async () => {
    if (!confirm('確定要清空所有系統排程與同步日誌嗎？')) return;
    try {
      await adminApiFetch('/api/admin/sources/logs/clear', { 
        method: 'POST'
      });
      await fetchAdminData();
    } catch (err) {
      console.error('Clear logs failed:', err);
    }
  };

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    sources.forEach(s => { if (s.category) set.add(s.category); });
    return Array.from(set);
  }, [sources]);

  // Filtered Sources
  const filteredSources = useMemo(() => {
    return sources.filter(s => {
      if (activeTab === 'github_actions' && s.runner !== 'github_actions') return false;
      if (activeTab === 'oci' && s.runner !== 'oci') return false;
      if (selectedCategory !== 'all' && s.category !== selectedCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          (s.workflow_file && s.workflow_file.toLowerCase().includes(q)) ||
          s.schedule_interval.toLowerCase().includes(q) ||
          s.cron_expr.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [sources, activeTab, selectedCategory, searchQuery]);

  const ghCount = sources.filter(s => s.runner === 'github_actions').length;
  const ociCount = sources.filter(s => s.runner === 'oci').length;

  return (
    <div className="min-h-screen bg-[#0d1017] text-gray-100 flex flex-col font-sans select-none">
      {/* Top Banner / Navigation */}
      <header className="h-16 bg-[#161a23] border-b border-[#282f40] px-6 flex items-center justify-between sticky top-0 z-30 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-sky-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base text-white tracking-wide">Vancouver God&apos;s Eye</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                admin.vangodseye.fyi
              </span>
            </div>
            <p className="text-[11px] text-gray-400">數據管線排程與即時服務控制台 · 獨立安全子網域</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* GitHub Token Status Pill (Click to open setup modal) */}
          <button
            onClick={() => setIsGithubModalOpen(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shadow-xs cursor-pointer ${
              githubStatus.configured
                ? 'bg-sky-500/15 text-sky-300 border-sky-500/30 hover:bg-sky-500/25'
                : 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25 animate-pulse'
            }`}
            title="點擊設定 GitHub Token，以便支援一鍵觸發 Actions 雲端工作流與動態 Commit 排程"
          >
            <Key className="w-3.5 h-3.5" />
            <span>{githubStatus.configured ? 'GitHub 串接就緒' : '未設定 GITHUB_TOKEN'}</span>
          </button>

          {/* Backend Status Badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1c2230] border border-[#2b3447] text-xs text-gray-300">
            <span className={`w-2 h-2 rounded-full ${backendConnected === false ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`}></span>
            <span>{backendConnected === false ? '使用內建字典展示' : '雲端與主機連線正常'}</span>
          </div>

          <button
            onClick={() => fetchAdminData()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#202738] hover:bg-[#2a344a] text-gray-200 border border-[#34405a] rounded-lg text-xs font-medium transition-all shadow-sm cursor-pointer"
            title="手動刷新清單"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
            <span>重新載入</span>
          </button>

          {isUnlocked ? (
            <button
              onClick={() => {
                setIsUnlocked(false);
                sessionStorage.removeItem('gods_eye_admin_unlocked');
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold transition-all cursor-pointer"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>鎖定面板</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-semibold">
              <Lock className="w-3.5 h-3.5" />
              <span>唯讀模式</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto flex flex-col gap-5">
        
        {/* Success Alert Banner */}
        {successMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-xs font-medium flex items-center justify-between shadow-lg animate-in fade-in duration-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-200 text-xs font-bold px-2 py-0.5 cursor-pointer">✕</button>
          </div>
        )}

        {/* PIN Unlock Card (Password: 0206) */}
        {!isUnlocked && (
          <div className="bg-[#161a23] border border-amber-500/30 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">後台已啟用安全唯讀保護</h3>
                <p className="text-xs text-gray-400 mt-0.5">目前處於唯讀檢視模式。若需執行【立即同步】或【修改排程週期】，請輸入管理員密碼解鎖。</p>
              </div>
            </div>
            <form onSubmit={handleUnlock} className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
              <input
                type="password"
                placeholder="輸入密碼 (0206)"
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  setPinError(false);
                }}
                maxLength={8}
                className={`bg-[#0f1218] border ${pinError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-[#2d3548] focus:border-amber-400'} px-3 py-1.5 rounded-lg text-xs text-white placeholder-gray-500 outline-none w-full sm:w-36 transition-all`}
              />
              <button
                type="submit"
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-lg transition-colors whitespace-nowrap shadow-md cursor-pointer"
              >
                解鎖操作
              </button>
            </form>
          </div>
        )}

        {/* Overview Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div className="bg-[#141822] border border-[#232a3b] p-4 rounded-xl flex items-center justify-between shadow-sm">
            <div>
              <p className="text-[11px] text-gray-400 font-medium">資料源總數</p>
              <p className="text-2xl font-bold text-white mt-1">{sources.length}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">全大溫空間與即時數據</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center border border-indigo-500/25">
              <Sliders className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#141822] border border-[#232a3b] p-4 rounded-xl flex items-center justify-between shadow-sm">
            <div>
              <p className="text-[11px] text-gray-400 font-medium">GitHub Actions 管線</p>
              <p className="text-2xl font-bold text-sky-400 mt-1">{ghCount}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">自來水/污水/微出行/學校等</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 text-sky-400 flex items-center justify-center border border-sky-500/25">
              <Cloud className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#141822] border border-[#232a3b] p-4 rounded-xl flex items-center justify-between shadow-sm">
            <div>
              <p className="text-[11px] text-gray-400 font-medium">OCI 伺服器即時服務</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">{ociCount}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">TomTom路況/公車/航班/氣象</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center border border-emerald-500/25">
              <Server className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#141822] border border-[#232a3b] p-4 rounded-xl flex items-center justify-between shadow-sm">
            <div>
              <p className="text-[11px] text-gray-400 font-medium">最近同步與調度記錄</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">{logs.length}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">可查閱歷史執行日誌</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center border border-amber-500/25">
              <FileText className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* View Switcher Tabs & Batch Action Bar */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#141822] p-2 rounded-xl border border-[#232a3b]">
          {/* Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1d2331]'
              }`}
            >
              <span>全部清單</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30">{sources.length}</span>
            </button>

            <button
              onClick={() => setActiveTab('github_actions')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'github_actions'
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1d2331]'
              }`}
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>GitHub Actions 雲端管線</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30">{ghCount}</span>
            </button>

            <button
              onClick={() => setActiveTab('oci')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'oci'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1d2331]'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>OCI 伺服器即時服務</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30">{ociCount}</span>
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'logs'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1d2331]'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>更新記錄 (Audit Logs)</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30">{logs.length}</span>
            </button>
          </div>

          {/* Batch Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {(activeTab === 'oci' || activeTab === 'all') && (
              <button
                disabled={!isUnlocked || syncingId === 'all_oci'}
                onClick={() => handleSync('all_oci', 'oci')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm ${
                  isUnlocked
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                    : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                }`}
                title="立即同步全部 12 項 OCI 即時交通、天氣、航班快取"
              >
                <Zap className={`w-3.5 h-3.5 ${syncingId === 'all_oci' ? 'animate-spin' : ''}`} />
                <span>立即更新全部 OCI 資料</span>
              </button>
            )}

            {(activeTab === 'github_actions' || activeTab === 'all') && (
              <button
                disabled={!isUnlocked || syncingId === 'all_github'}
                onClick={() => handleSync('all_github', 'github_actions')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm ${
                  isUnlocked
                    ? 'bg-sky-600 hover:bg-sky-500 text-white cursor-pointer'
                    : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                }`}
                title="透過 GitHub Actions 觸發全部 GeoJSON 圖層資料管線更新"
              >
                <Cloud className={`w-3.5 h-3.5 ${syncingId === 'all_github' ? 'animate-spin' : ''}`} />
                <span>立即觸發所有 Actions 管線</span>
              </button>
            )}
          </div>
        </div>

        {/* Content Section: Lists vs Logs */}
        {activeTab !== 'logs' ? (
          <div className="flex flex-col gap-3.5">
            {/* Filter / Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#141822] px-4 py-3 rounded-xl border border-[#232a3b]">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="搜尋資料源名稱、ID、頻率、Cron 或工作流檔案..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#0d1017] border border-[#2b3346] rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="flex items-center gap-2 overflow-x-auto">
                <Filter className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <button
                  onClick={() => setSelectedCategory('all')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                    selectedCategory === 'all'
                      ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  全部分類
                </button>
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer ${
                      selectedCategory === cat
                        ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* 2.6 逐行式清單 (Line-by-Line Table List View - 不要用網格) */}
            <div className="bg-[#141822] border border-[#232a3b] rounded-xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#191f2c] border-b border-[#283144] text-gray-400 font-semibold uppercase text-[10.5px] tracking-wider">
                      <th className="py-3 px-4 w-12 text-center">狀態</th>
                      <th className="py-3 px-4 min-w-[200px]">資料源與項目名稱</th>
                      <th className="py-3 px-4 w-28">分類</th>
                      <th className="py-3 px-4 min-w-[170px]">執行載體 / 管線</th>
                      <th className="py-3 px-4 min-w-[200px]">排程週期 (Cron)</th>
                      <th className="py-3 px-4 w-32">上次更新</th>
                      <th className="py-3 px-4 w-28">規模筆數</th>
                      <th className="py-3 px-4 w-48 text-right">管理操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202738]">
                    {filteredSources.map((source) => {
                      const isEditing = editingId === source.id;
                      const isSyncing = syncingId === source.id;
                      const isOci = source.runner === 'oci';

                      return (
                        <tr 
                          key={source.id} 
                          className="hover:bg-[#1a202d] transition-colors group"
                        >
                          {/* 狀態燈號 */}
                          <td className="py-3.5 px-4 text-center">
                            <span 
                              className={`inline-block w-2.5 h-2.5 rounded-full ${
                                isSyncing
                                  ? 'bg-sky-400 animate-ping'
                                  : source.enabled !== false
                                    ? isOci ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.5)]'
                                    : 'bg-gray-500'
                              }`} 
                              title={source.enabled !== false ? '排程啟用中' : '排程已暫停'}
                            />
                          </td>

                          {/* 資料源名稱與 ID */}
                          <td className="py-3.5 px-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-white text-xs group-hover:text-sky-300 transition-colors">
                                {source.name}
                              </span>
                              <span className="text-[10px] text-gray-500 font-mono mt-0.5">
                                {source.id}
                              </span>
                            </div>
                          </td>

                          {/* 分類 */}
                          <td className="py-3.5 px-4">
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#1d2433] text-gray-300 border border-[#2f3950] whitespace-nowrap">
                              {source.category}
                            </span>
                          </td>

                          {/* 執行載體標籤 */}
                          <td className="py-3.5 px-4">
                            {isOci ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 w-fit">
                                  <Server className="w-3 h-3" />
                                  <span>OCI 伺服器服務</span>
                                </span>
                                <span className="text-[10px] text-emerald-500/80 font-mono">
                                  FastAPI 記憶體快取
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30 w-fit">
                                  <Cloud className="w-3 h-3" />
                                  <span>GitHub Actions</span>
                                </span>
                                <span className="text-[10px] text-sky-400/80 font-mono truncate max-w-[170px]" title={source.workflow_file || 'update-datasets.yml'}>
                                  {source.workflow_file || 'update-datasets.yml'}
                                </span>
                              </div>
                            )}
                          </td>

                          {/* 排程週期 (Cron 或間隔) 逐行行內編輯 */}
                          <td className="py-3.5 px-4">
                            {isEditing ? (
                              <div className="flex flex-col gap-1.5 p-2 bg-[#0f1218] rounded-lg border border-indigo-500/40 animate-in fade-in">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={editCron}
                                    onChange={(e) => setEditCron(e.target.value)}
                                    placeholder="Cron 表達式 (如 0 * * * *)"
                                    className="bg-[#181d28] border border-[#343e54] text-white text-[11px] font-mono px-2 py-1 rounded w-36 outline-none focus:border-indigo-400"
                                  />
                                  <input
                                    type="text"
                                    value={editInterval}
                                    onChange={(e) => setEditInterval(e.target.value)}
                                    placeholder="頻率文字 (如 每小時)"
                                    className="bg-[#181d28] border border-[#343e54] text-white text-[11px] px-2 py-1 rounded w-24 outline-none focus:border-indigo-400"
                                  />
                                </div>
                                <div className="flex items-center gap-1 justify-end">
                                  <button
                                    onClick={() => setEditingId(null)}
                                    className="px-2 py-0.5 rounded text-[10px] text-gray-400 hover:text-white cursor-pointer"
                                  >
                                    取消
                                  </button>
                                  <button
                                    disabled={isSavingSchedule}
                                    onClick={() => handleSaveSchedule(source)}
                                    className="px-2.5 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold cursor-pointer"
                                  >
                                    {isSavingSchedule ? '儲存中...' : '儲存'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-gray-200">
                                    {source.schedule_interval}
                                  </span>
                                  {source.enabled === false && (
                                    <span className="text-[10px] px-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                      已停用
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-gray-400 font-mono mt-0.5 flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5 text-gray-500" />
                                  <span>{source.cron_expr}</span>
                                </span>
                              </div>
                            )}
                          </td>

                          {/* 上次更新時間 */}
                          <td className="py-3.5 px-4 text-gray-300 font-mono text-[11px]">
                            {source.last_updated ? (
                              <span>
                                {new Date(source.last_updated).toLocaleString('zh-HK', {
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: false
                                })}
                              </span>
                            ) : (
                              <span className="text-gray-500">未執行</span>
                            )}
                          </td>

                          {/* 規模 / 筆數 */}
                          <td className="py-3.5 px-4 text-gray-400 text-[11px]">
                            <span className="text-white font-medium">{source.record_count.toLocaleString()}</span>{' '}
                            <span>{source.unit}</span>
                          </td>

                          {/* 管理操作按鈕 */}
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* 立即同步按鈕 */}
                              <button
                                disabled={!isUnlocked || isSyncing}
                                onClick={() => handleSync(source.id, source.runner)}
                                className={`px-2.5 py-1 rounded-md font-semibold text-[11px] flex items-center gap-1 transition-all shadow-xs ${
                                  !isUnlocked
                                    ? 'bg-[#1e2433] text-gray-600 cursor-not-allowed'
                                    : isSyncing
                                      ? 'bg-sky-600 text-white animate-pulse'
                                      : isOci
                                        ? 'bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/30 cursor-pointer'
                                        : 'bg-sky-600/20 hover:bg-sky-600 text-sky-300 hover:text-white border border-sky-500/30 cursor-pointer'
                                }`}
                                title={isOci ? '立即更新 OCI 實時記憶體快取' : '透過 GitHub Actions 立即觸發雲端工作流'}
                              >
                                <Play className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                                <span>{isSyncing ? '同步中' : '立即同步'}</span>
                              </button>

                              {/* 修改排程按鈕 */}
                              <button
                                disabled={!isUnlocked}
                                onClick={() => {
                                  setEditingId(source.id);
                                  setEditCron(source.cron_expr);
                                  setEditInterval(source.schedule_interval);
                                }}
                                className={`p-1 rounded-md transition-colors ${
                                  isUnlocked
                                    ? 'hover:bg-[#252d3d] text-gray-400 hover:text-gray-100 cursor-pointer'
                                    : 'text-gray-700 cursor-not-allowed'
                                }`}
                                title="修改排程週期與 Cron"
                              >
                                <Sliders className="w-3.5 h-3.5" />
                              </button>

                              {/* 啟用/暫停切換 */}
                              <button
                                disabled={!isUnlocked}
                                onClick={() => handleToggleEnabled(source)}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                                  !isUnlocked
                                    ? 'text-gray-700 cursor-not-allowed'
                                    : source.enabled !== false
                                      ? 'text-emerald-400 hover:bg-emerald-500/10'
                                      : 'text-rose-400 hover:bg-rose-500/10'
                                }`}
                                title={source.enabled !== false ? '點擊暫停排程' : '點擊啟用排程'}
                              >
                                {source.enabled !== false ? '啟用' : '暫停'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {filteredSources.length === 0 && (
                <div className="py-12 text-center text-gray-500 text-xs flex flex-col items-center gap-2">
                  <AlertCircle className="w-6 h-6 text-gray-600" />
                  <span>沒有符合條件的數據源項目</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* 2.5 系統同步記錄 (Audit Logs) 視圖 */
          <div className="bg-[#141822] border border-[#232a3b] rounded-xl overflow-hidden shadow-xl flex flex-col">
            <div className="p-4 bg-[#191f2c] border-b border-[#283144] flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-amber-400" />
                  <span>系統更新與調度歷程日誌 (Audit Trail)</span>
                </h3>
                <p className="text-[11px] text-gray-400 mt-0.5">完整記錄每次手動觸發、GitHub Actions 調度與排程週期異動</p>
              </div>

              <button
                disabled={!isUnlocked || logs.length === 0}
                onClick={handleClearLogs}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                  isUnlocked && logs.length > 0
                    ? 'bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 cursor-pointer'
                    : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>清空日誌記錄</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#161b26] border-b border-[#242b3b] text-gray-400 font-semibold uppercase text-[10px] tracking-wider">
                    <th className="py-2.5 px-4 w-40">時間戳記</th>
                    <th className="py-2.5 px-4 w-32">動作類型</th>
                    <th className="py-2.5 px-4 w-44">目標資料源</th>
                    <th className="py-2.5 px-4 w-28">執行載體</th>
                    <th className="py-2.5 px-4">詳細事件訊息</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2535]">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#19202e] transition-colors">
                      <td className="py-3 px-4 font-mono text-[11px] text-gray-400">
                        {new Date(log.timestamp).toLocaleString('zh-HK', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false
                        })}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          log.action.includes('GITHUB')
                            ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                            : log.action.includes('OCI')
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-white text-xs">
                        {log.source_name}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-[11px] text-gray-400">
                          {log.runner === 'github_actions' ? 'GitHub Actions' : log.runner === 'oci' ? 'OCI 主機' : '全系統'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-300 text-xs">
                        {log.detail}
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-gray-500 text-xs">
                        尚無任何排程或同步歷史日誌
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* GitHub Token Setup Modal */}
      {isGithubModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-[#161a23] border border-[#2e374c] rounded-2xl p-6 max-w-lg w-full shadow-2xl flex flex-col gap-4 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-[#242b3b]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">設定 GitHub Personal Access Token (PAT)</h3>
                  <p className="text-[11px] text-gray-400">用於一鍵喚醒 GitHub Actions 雲端工作流與動態 Commit 排程</p>
                </div>
              </div>
              <button 
                onClick={() => setIsGithubModalOpen(false)}
                className="text-gray-400 hover:text-white p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-[#0f1218] p-3.5 rounded-xl border border-[#252d3e] flex flex-col gap-2 text-[11px] text-gray-300">
              <span className="font-bold text-white flex items-center gap-1.5">
                <span>📖 如何取得 Token？（只需 1 分鐘）</span>
              </span>
              <ol className="list-decimal list-inside space-y-1 text-gray-400 pl-1">
                <li>打開瀏覽器登入 GitHub，前往：<a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-sky-400 underline font-mono">github.com/settings/tokens</a></li>
                <li>點擊「Generate new token」➔ 選擇「Generate new token (classic)」</li>
                <li>Note 填寫 <code className="text-sky-300 bg-black/40 px-1 py-0.5 rounded">GodsEye-Admin</code></li>
                <li>關鍵勾選兩項權限：<strong className="text-white">repo</strong>（完整儲存庫權限）與 <strong className="text-white">workflow</strong>（觸發工作流權限）</li>
                <li>點擊底部綠色按鈕「Generate token」，將生成的 <code className="text-amber-300 bg-black/40 px-1 py-0.5 rounded">ghp_...</code> 複製貼在下方：</li>
              </ol>
            </div>

            <form onSubmit={handleSaveGithubToken} className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-gray-300 block mb-1">
                  貼上 GitHub Token (以 ghp_ 開頭)
                </label>
                <input
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={inputGithubToken}
                  onChange={(e) => setInputGithubToken(e.target.value)}
                  className="w-full bg-[#0d1017] border border-[#2e374c] focus:border-sky-400 px-3 py-2 rounded-lg text-white font-mono text-xs outline-none"
                  required
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-400 pt-1">
                <span>當前串接狀態：<strong className={githubStatus.configured ? 'text-emerald-400' : 'text-amber-400'}>{githubStatus.token_masked}</strong></span>
                <span>儲存庫：<strong className="text-gray-300 font-mono">{githubStatus.repo}</strong></span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#242b3b]">
                <button
                  type="button"
                  onClick={() => setIsGithubModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#1f2635] text-xs font-semibold cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSavingToken || !inputGithubToken.trim()}
                  className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow-md"
                >
                  {isSavingToken ? '儲存中...' : '儲存 Token'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-4 border-t border-[#1c2230] text-center text-xs text-gray-500">
        Vancouver God&apos;s Eye Security Operations Center · 網址: admin.vangodseye.fyi · 密碼防護已啟用
      </footer>
    </div>
  );
}
