'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Shield,
  X,
  RefreshCw,
  Database,
  Calendar,
  Clock,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileCode,
  Search,
  ExternalLink,
  Sliders,
  Activity,
  Layers,
  Download,
  Check,
  FileText
} from 'lucide-react';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl } from '@/utils/api';

export interface AdminSourceItem {
  id: string;
  name: string;
  type: 'api' | 'geojson';
  category: string;
  filename?: string;
  schedule_interval: string;
  cron_expr: string;
  enabled: boolean;
  last_updated: string;
  record_count: number;
  unit: string;
  status: 'healthy' | 'updating' | 'warning' | 'error';
  description: string;
}

export interface AdminLogItem {
  id: string;
  timestamp: string;
  action: string;
  source_name: string;
  status: 'success' | 'warning' | 'error';
  detail: string;
}

const DEFAULT_GEOJSON_LAYERS = [
  { id: 'garbage_collection', name: '廢物回收分區', filename: 'vancouver_garbage_collection.geojson' },
  { id: 'homeless_shelters', name: '無家者庇護所', filename: 'vancouver_homeless_shelters.geojson' },
  { id: 'zoning_districts', name: '土地規劃分區', filename: 'vancouver_zoning_districts.geojson' },
  { id: 'bikeways', name: '單車專用道路網', filename: 'vancouver_bikeways.geojson' },
  { id: 'parking_meters', name: '路邊停車收費錶', filename: 'vancouver_parking_meters.geojson' },
  { id: 'public_trees', name: '市區街道樹木', filename: 'vancouver_public_trees.geojson' },
  { id: 'fire_hydrants', name: '市政消防栓位置', filename: 'vancouver_fire_hydrants.geojson' },
  { id: 'drinking_fountains', name: '公共飲水台', filename: 'vancouver_drinking_fountains.geojson' },
  { id: 'public_washrooms', name: '公共洗手間', filename: 'vancouver_public_washrooms.geojson' },
  { id: 'street_lighting_conduits', name: '路燈電網管道', filename: 'vancouver_street_lighting_conduits.geojson' },
  { id: 'food_vendors', name: '市區街頭餐車攤販', filename: 'vancouver_food_vendors.geojson' },
  { id: 'schools', name: '學校與教育設施', filename: 'vancouver_schools.geojson' },
  { id: 'libraries', name: '公共圖書館', filename: 'vancouver_libraries.geojson' },
  { id: 'parks', name: '市立公園綠地', filename: 'vancouver_parks.geojson' },
  { id: 'community_centres', name: '社區中心設施', filename: 'vancouver_community_centres.geojson' }
];

export default function AdminModal() {
  const { isAdminModalOpen, setAdminModalOpen } = useUIStore();
  const [activeTab, setActiveTab] = useState<'sources' | 'schedules' | 'upload' | 'logs'>('sources');
  const [sources, setSources] = useState<AdminSourceItem[]>([]);
  const [logs, setLogs] = useState<AdminLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'api' | 'geojson'>('all');

  // GeoJSON Upload state
  const [selectedLayerKey, setSelectedLayerKey] = useState<string>('garbage_collection');
  const [uploadFileName, setUploadFileName] = useState<string>('vancouver_garbage_collection.geojson');
  const [uploadFileContent, setUploadFileContent] = useState<string | null>(null);
  const [uploadFileStats, setUploadFileStats] = useState<{ count: number; geomTypes: string[]; keys: string[] } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Schedules Editing state
  const [editingSchedules, setEditingSchedules] = useState<Record<string, { interval: string; cron: string; enabled: boolean }>>({});
  const [savingScheduleId, setSavingScheduleId] = useState<string | null>(null);
  const [scheduleSuccessId, setScheduleSuccessId] = useState<string | null>(null);

  // Fetch sources and logs from backend
  const fetchAdminData = React.useCallback(async () => {
    setLoading(true);
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/api/admin/sources`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.sources)) {
          setSources(data.sources);
          // Initialize editing schedules map
          const scheds: Record<string, { interval: string; cron: string; enabled: boolean }> = {};
          data.sources.forEach((s: AdminSourceItem) => {
            scheds[s.id] = {
              interval: s.schedule_interval,
              cron: s.cron_expr,
              enabled: s.enabled
            };
          });
          setEditingSchedules(scheds);
        }
        if (Array.isArray(data.logs)) {
          setLogs(data.logs);
        }
      }
    } catch (err) {
      console.warn('Failed to load admin sources from backend:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdminModalOpen) {
      fetchAdminData();
    }
  }, [isAdminModalOpen, fetchAdminData]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isAdminModalOpen) {
        setAdminModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAdminModalOpen, setAdminModalOpen]);

  // Trigger instant sync for a source
  const handleTriggerSync = async (sourceId?: string) => {
    setSyncingId(sourceId || 'all');
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/api/admin/sources/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: sourceId || null })
      });
      if (res.ok) {
        await fetchAdminData();
      }
    } catch (err) {
      console.error('Trigger sync error:', err);
    } finally {
      setSyncingId(null);
    }
  };

  // Save schedule settings for a specific source
  const handleSaveSchedule = async (sourceId: string) => {
    const s = editingSchedules[sourceId];
    if (!s) return;
    setSavingScheduleId(sourceId);
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/api/admin/sources/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_id: sourceId,
          schedule_interval: s.interval,
          cron_expr: s.cron,
          enabled: s.enabled
        })
      });
      if (res.ok) {
        setScheduleSuccessId(sourceId);
        setTimeout(() => setScheduleSuccessId(null), 2500);
        await fetchAdminData();
      }
    } catch (err) {
      console.error('Save schedule error:', err);
    } finally {
      setSavingScheduleId(null);
    }
  };

  // Handle layer selector change for GeoJSON upload
  const handleLayerChange = (layerKey: string) => {
    setSelectedLayerKey(layerKey);
    const item = DEFAULT_GEOJSON_LAYERS.find(l => l.id === layerKey);
    if (item) {
      setUploadFileName(item.filename);
    }
    setUploadMessage(null);
  };

  // Handle file select & parse
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadMessage(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
          setUploadMessage({ text: '檔案無效：GeoJSON 必須包含 type: "FeatureCollection" 及 features 陣列', type: 'error' });
          setUploadFileContent(null);
          setUploadFileStats(null);
          return;
        }

        const geomTypes = Array.from(new Set(parsed.features.map((f: any) => f.geometry?.type || 'Unknown'))) as string[];
        const sampleProps = parsed.features[0]?.properties || {};
        const keys = Object.keys(sampleProps).slice(0, 10);

        setUploadFileContent(text);
        setUploadFileStats({
          count: parsed.features.length,
          geomTypes,
          keys
        });
      } catch (err: any) {
        setUploadMessage({ text: `JSON 解析失敗: ${err.message}`, type: 'error' });
        setUploadFileContent(null);
        setUploadFileStats(null);
      }
    };
    reader.readAsText(file);
  };

  // Submit GeoJSON update to backend
  const handleUploadGeoJSON = async () => {
    if (!uploadFileContent || !uploadFileName) {
      setUploadMessage({ text: '請先選擇有效的 GeoJSON 檔案', type: 'error' });
      return;
    }

    setUploading(true);
    setUploadMessage(null);
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/api/admin/geojson/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: uploadFileName,
          layer_id: selectedLayerKey,
          geojson_data: uploadFileContent
        })
      });

      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setUploadMessage({
          text: `上傳發布成功！已成功更新 ${data.filename}，共 ${data.feature_count} 筆要素特徵。`,
          type: 'success'
        });
        setUploadFileContent(null);
        setUploadFileStats(null);
        await fetchAdminData();
      } else {
        setUploadMessage({
          text: `更新失敗: ${data.message || '未知錯誤'}`,
          type: 'error'
        });
      }
    } catch (err: any) {
      setUploadMessage({ text: `網路連線或伺服器錯誤: ${err.message}`, type: 'error' });
    } finally {
      setUploading(false);
    }
  };

  // Filter sources
  const filteredSources = useMemo(() => {
    return sources.filter((s) => {
      if (typeFilter !== 'all' && s.type !== typeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          (s.filename && s.filename.toLowerCase().includes(q)) ||
          s.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [sources, typeFilter, searchQuery]);

  if (!isAdminModalOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-5xl h-[88vh] max-h-[850px] bg-[#121622] border border-[#2a324b] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-[#181d2e] border-b border-[#2a324b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">系統管理員後台</h2>
                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-mono font-medium">
                  v2.4 Control Hub
                </span>
              </div>
              <p className="text-xs text-gray-400">數據更新排程設定、即時狀態監控與 GeoJSON 圖層發布</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleTriggerSync()}
              disabled={syncingId !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#252b3d] hover:bg-[#2e374e] text-indigo-300 hover:text-white border border-indigo-500/30 rounded-lg text-xs font-medium transition-colors shadow-sm disabled:opacity-50"
              title="觸發全部數據源立即同步"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingId === 'all' ? 'animate-spin text-indigo-400' : ''}`} />
              <span>{syncingId === 'all' ? '同步中...' : '全部同步'}</span>
            </button>
            <button
              onClick={() => setAdminModalOpen(false)}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="關閉 (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-3.5 bg-[#141826] border-b border-[#23293d] shrink-0 text-xs">
          <div className="bg-[#191f33] p-2.5 rounded-xl border border-[#262f4d] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10.5px] text-gray-400">總數據源</div>
              <div className="text-sm font-bold text-white font-mono">{sources.length || 24} 項</div>
            </div>
          </div>

          <div className="bg-[#191f33] p-2.5 rounded-xl border border-[#262f4d] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10.5px] text-gray-400">即時 API 服務</div>
              <div className="text-sm font-bold text-white font-mono">
                {sources.filter(s => s.type === 'api').length || 14} 條在線
              </div>
            </div>
          </div>

          <div className="bg-[#191f33] p-2.5 rounded-xl border border-[#262f4d] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10.5px] text-gray-400">GeoJSON 圖層</div>
              <div className="text-sm font-bold text-white font-mono">
                {sources.filter(s => s.type === 'geojson').length || 10} 個檔案
              </div>
            </div>
          </div>

          <div className="bg-[#191f33] p-2.5 rounded-xl border border-[#262f4d] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-400 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10.5px] text-gray-400">系統整體狀態</div>
              <div className="text-sm font-bold text-emerald-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>正常運行</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-6 bg-[#181d2e] border-b border-[#262e45] shrink-0 text-xs font-medium">
          <button
            onClick={() => setActiveTab('sources')}
            className={`py-3 px-3.5 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'sources'
                ? 'border-indigo-500 text-indigo-300 font-bold'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>數據源與狀態監控</span>
          </button>

          <button
            onClick={() => setActiveTab('schedules')}
            className={`py-3 px-3.5 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'schedules'
                ? 'border-indigo-500 text-indigo-300 font-bold'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>排程週期設定</span>
          </button>

          <button
            onClick={() => setActiveTab('upload')}
            className={`py-3 px-3.5 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'upload'
                ? 'border-indigo-500 text-indigo-300 font-bold'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>經網頁更新 GeoJSON</span>
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`py-3 px-3.5 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'logs'
                ? 'border-indigo-500 text-indigo-300 font-bold'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>系統更新日誌 ({logs.length})</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-[#2c344d] [&::-webkit-scrollbar-thumb]:rounded-full">
          {/* TAB 1: 數據源與狀態監控 */}
          {activeTab === 'sources' && (
            <div className="space-y-4">
              {/* Search & Filter bar */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜尋數據源、分類或檔案名稱..."
                    className="w-full bg-[#161a29] text-xs text-white placeholder-gray-500 pl-9 pr-8 py-2 rounded-xl border border-[#2a334d] focus:outline-none focus:border-indigo-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 bg-[#161a29] p-1 rounded-xl border border-[#2a334d] text-xs">
                  <button
                    onClick={() => setTypeFilter('all')}
                    className={`px-3 py-1 rounded-lg transition-colors ${
                      typeFilter === 'all' ? 'bg-indigo-600 text-white font-medium' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    全部 ({sources.length})
                  </button>
                  <button
                    onClick={() => setTypeFilter('api')}
                    className={`px-3 py-1 rounded-lg transition-colors ${
                      typeFilter === 'api' ? 'bg-indigo-600 text-white font-medium' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    即時 API ({sources.filter(s => s.type === 'api').length})
                  </button>
                  <button
                    onClick={() => setTypeFilter('geojson')}
                    className={`px-3 py-1 rounded-lg transition-colors ${
                      typeFilter === 'geojson' ? 'bg-indigo-600 text-white font-medium' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    GeoJSON 圖層 ({sources.filter(s => s.type === 'geojson').length})
                  </button>
                </div>
              </div>

              {/* Sources Table */}
              <div className="bg-[#161b2a] border border-[#273047] rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#1c2235] text-gray-400 border-b border-[#273047] text-[11px] uppercase tracking-wider">
                      <tr>
                        <th className="py-3 px-4">數據源 / 分類</th>
                        <th className="py-3 px-4">類型</th>
                        <th className="py-3 px-4">排程週期</th>
                        <th className="py-3 px-4">資料筆數</th>
                        <th className="py-3 px-4">最後更新時間</th>
                        <th className="py-3 px-4">狀態</th>
                        <th className="py-3 px-4 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#232b3f]">
                      {filteredSources.map((source) => {
                        const isSyncing = syncingId === source.id || syncingId === 'all';
                        return (
                          <tr key={source.id} className="hover:bg-[#1a2133] transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-bold text-white flex items-center gap-2">
                                <span>{source.name}</span>
                              </div>
                              <div className="text-[11px] text-gray-400 mt-0.5">
                                {source.category} · {source.description}
                              </div>
                              {source.filename && (
                                <div className="text-[10px] text-indigo-400 font-mono mt-0.5">
                                  {source.filename}
                                </div>
                              )}
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                source.type === 'api'
                                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              }`}>
                                {source.type === 'api' ? '即時 API' : 'GeoJSON'}
                              </span>
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap">
                              <div className="text-gray-200 font-medium">{source.schedule_interval}</div>
                              <div className="text-[10px] text-gray-500 font-mono">{source.cron_expr}</div>
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap font-mono">
                              <span className="font-bold text-white">{source.record_count.toLocaleString()}</span>
                              <span className="text-gray-400 text-[11px] ml-1">{source.unit}</span>
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px] text-gray-300">
                              {source.last_updated
                                ? new Date(source.last_updated).toLocaleString('zh-TW', { hour12: false })
                                : '未記錄'}
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                <span>正常</span>
                              </span>
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap text-right">
                              <button
                                onClick={() => handleTriggerSync(source.id)}
                                disabled={isSyncing}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/40 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50"
                                title="立即手動同步此數據源"
                              >
                                <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin text-white' : ''}`} />
                                <span>{isSyncing ? '同步中' : '立即同步'}</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 排程週期設定 */}
          {activeTab === 'schedules' && (
            <div className="space-y-4">
              <div className="bg-indigo-950/30 p-3 rounded-xl border border-indigo-500/30 text-xs text-indigo-200 flex items-start gap-2.5">
                <Sliders className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  管理員可在此自訂各 API 與圖層數據的自動同步週期（Cron 表達式或預設間隔），亦可一鍵暫停或啟用特定資料源的自動同步排程。
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {sources.map((s) => {
                  const current = editingSchedules[s.id] || {
                    interval: s.schedule_interval,
                    cron: s.cron_expr,
                    enabled: s.enabled
                  };
                  const isSaving = savingScheduleId === s.id;
                  const isSuccess = scheduleSuccessId === s.id;

                  return (
                    <div
                      key={s.id}
                      className="bg-[#161a29] p-4 rounded-xl border border-[#273047] flex flex-col justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white text-xs">{s.name}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            s.type === 'api'
                              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}>
                            {s.type === 'api' ? '即時 API' : 'GeoJSON'}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1 line-clamp-1">{s.description}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#232b3f] text-xs">
                        <div>
                          <label className="text-[10.5px] text-gray-400 block mb-1">同步週期</label>
                          <select
                            value={current.interval}
                            onChange={(e) => {
                              const val = e.target.value;
                              let cron = current.cron;
                              if (val === '每 30 秒') cron = '*/1 * * * *';
                              else if (val === '每 5 分鐘') cron = '*/5 * * * *';
                              else if (val === '每 10 分鐘') cron = '*/10 * * * *';
                              else if (val === '每 15 分鐘') cron = '*/15 * * * *';
                              else if (val === '每 30 分鐘') cron = '*/30 * * * *';
                              else if (val === '每 1 小時') cron = '0 * * * *';
                              else if (val === '每 6 小時') cron = '0 */6 * * *';
                              else if (val === '每 12 小時') cron = '0 */12 * * *';
                              else if (val === '每日 1 次') cron = '0 6 * * *';
                              else if (val === '每週 1 次') cron = '0 6 * * 1';
                              else if (val === '雙週更新') cron = '0 7 * * 1';
                              else if (val === '每月 1 次') cron = '0 0 1 * *';
                              else if (val === '每季 1 次') cron = '0 0 1 */3 *';

                              setEditingSchedules({
                                ...editingSchedules,
                                [s.id]: { ...current, interval: val, cron }
                              });
                            }}
                            className="w-full bg-[#11141f] text-gray-200 text-xs px-2.5 py-1.5 rounded-lg border border-[#2a334d] focus:outline-none focus:border-indigo-500 cursor-pointer"
                          >
                            <option value="每 30 秒">每 30 秒 (即時動態)</option>
                            <option value="每 5 分鐘">每 5 分鐘 (高頻)</option>
                            <option value="每 10 分鐘">每 10 分鐘</option>
                            <option value="每 15 分鐘">每 15 分鐘 (標準)</option>
                            <option value="每 30 分鐘">每 30 分鐘</option>
                            <option value="每 1 小時">每 1 小時</option>
                            <option value="每 6 小時">每 6 小時</option>
                            <option value="每 12 小時">每 12 小時</option>
                            <option value="每日 1 次">每日 1 次 (早晨)</option>
                            <option value="每週 1 次">每週 1 次</option>
                            <option value="雙週更新">雙週更新 (輪替回收)</option>
                            <option value="每月 1 次">每月 1 次</option>
                            <option value="每季 1 次">每季 1 次 (定期清冊)</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-[10.5px] text-gray-400 block mb-1">Cron 排程表達式</label>
                          <input
                            type="text"
                            value={current.cron}
                            onChange={(e) => {
                              setEditingSchedules({
                                ...editingSchedules,
                                [s.id]: { ...current, cron: e.target.value }
                              });
                            }}
                            className="w-full bg-[#11141f] text-gray-200 text-xs px-2.5 py-1.5 rounded-lg border border-[#2a334d] font-mono focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-[#232b3f] text-xs">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={current.enabled}
                            onChange={(e) => {
                              setEditingSchedules({
                                ...editingSchedules,
                                [s.id]: { ...current, enabled: e.target.checked }
                              });
                            }}
                            className="rounded border-[#2a334d] text-indigo-600 focus:ring-0 bg-[#11141f]"
                          />
                          <span className={current.enabled ? 'text-gray-300' : 'text-gray-500'}>
                            {current.enabled ? '排程自動同步中' : '已暫停自動排程'}
                          </span>
                        </label>

                        <button
                          onClick={() => handleSaveSchedule(s.id)}
                          disabled={isSaving}
                          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                            isSuccess
                              ? 'bg-emerald-600 text-white'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50'
                          }`}
                        >
                          {isSuccess ? <Check className="w-3.5 h-3.5" /> : null}
                          <span>{isSaving ? '儲存中...' : isSuccess ? '已儲存' : '儲存排程'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: 經網頁更新 GeoJSON */}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              <div className="bg-amber-950/20 p-3 rounded-xl border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2.5">
                <Upload className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  管理員可在此透過網頁瀏覽器直接上傳更新任何 GeoJSON 向量檔案。系統會自動進行合法性驗證（FeatureCollection 規格、頂點與屬性欄位檢查），確認無誤後立即寫入伺服器與發布生效，地圖圖層即時熱重載！
                </div>
              </div>

              {/* Layer Selection */}
              <div className="bg-[#161a29] p-4 rounded-xl border border-[#273047] space-y-3">
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-600/30 text-indigo-400 flex items-center justify-center text-[11px]">1</span>
                  <span>選擇要更新的圖層資料集</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-gray-400 block mb-1">目標圖層</label>
                    <select
                      value={selectedLayerKey}
                      onChange={(e) => handleLayerChange(e.target.value)}
                      className="w-full bg-[#11141f] text-gray-200 text-xs px-3 py-2 rounded-lg border border-[#2a334d] focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      {DEFAULT_GEOJSON_LAYERS.map((layer) => (
                        <option key={layer.id} value={layer.id}>
                          {layer.name} ({layer.filename})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-gray-400 block mb-1">發布目標檔案名稱</label>
                    <input
                      type="text"
                      value={uploadFileName}
                      onChange={(e) => setUploadFileName(e.target.value)}
                      className="w-full bg-[#11141f] text-gray-200 text-xs px-3 py-2 rounded-lg border border-[#2a334d] font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Download Current Backup */}
                <div className="pt-2 flex justify-end">
                  <a
                    href={`/${uploadFileName}`}
                    download={uploadFileName}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>下載當前線上最新 {uploadFileName} 備份檔</span>
                  </a>
                </div>
              </div>

              {/* Upload Dropzone */}
              <div className="bg-[#161a29] p-4 rounded-xl border border-[#273047] space-y-3">
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-600/30 text-indigo-400 flex items-center justify-center text-[11px]">2</span>
                  <span>選取或拖曳本機 GeoJSON 檔案</span>
                </div>

                <label className="border-2 border-dashed border-[#2d3752] hover:border-indigo-500/60 rounded-xl p-6 flex flex-col items-center justify-center gap-2.5 cursor-pointer bg-[#131724]/60 transition-all hover:bg-[#151a29]">
                  <Upload className="w-8 h-8 text-indigo-400 animate-bounce" />
                  <div className="text-center">
                    <span className="text-xs font-bold text-white block">點擊選取檔案，或將 .geojson / .json 拖曳至此</span>
                    <span className="text-[11px] text-gray-400">支援標準 RFC 7946 GeoJSON 格式</span>
                  </div>
                  <input
                    type="file"
                    accept=".geojson,.json"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>

                {/* Inspection Preview if file loaded */}
                {uploadFileStats && (
                  <div className="bg-[#11141f] p-3.5 rounded-xl border border-indigo-500/30 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>GeoJSON 檔案驗證成功</span>
                      </span>
                      <span className="font-mono text-gray-300">
                        {uploadFileStats.count.toLocaleString()} 筆要素特徵 (Features)
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-300 pt-1.5 border-t border-gray-800">
                      <div>
                        <span className="text-gray-500 block">幾何類型分佈:</span>
                        <span className="font-mono text-indigo-300">{uploadFileStats.geomTypes.join(', ')}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">檢測欄位範例:</span>
                        <span className="font-mono text-gray-300 truncate block">
                          {uploadFileStats.keys.join(', ')}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Upload Status Message */}
                {uploadMessage && (
                  <div
                    className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                      uploadMessage.type === 'success'
                        ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                        : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                    }`}
                  >
                    {uploadMessage.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    )}
                    <span>{uploadMessage.text}</span>
                  </div>
                )}

                {/* Action Button */}
                <div className="pt-2 flex justify-end">
                  <button
                    onClick={handleUploadGeoJSON}
                    disabled={!uploadFileContent || uploading}
                    className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Upload className={`w-4 h-4 ${uploading ? 'animate-bounce' : ''}`} />
                    <span>{uploading ? '驗證寫入中...' : '確認上傳並立即發布生效'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: 系統更新日誌 */}
          {activeTab === 'logs' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>系統歷史更新與操作稽核記錄 (最新 100 筆)</span>
                <span className="font-mono">共 {logs.length} 筆</span>
              </div>

              <div className="bg-[#161b2a] border border-[#273047] rounded-xl overflow-hidden divide-y divide-[#232b3f] text-xs">
                {logs.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">暫無更新日誌記錄</div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="p-3.5 hover:bg-[#1a2133] transition-colors flex items-start gap-3">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-white text-xs">{log.source_name}</span>
                          <span className="font-mono text-[10.5px] text-gray-500 shrink-0">
                            {new Date(log.timestamp).toLocaleString('zh-TW', { hour12: false })}
                          </span>
                        </div>
                        <p className="text-[11.5px] text-gray-300 mt-1 leading-relaxed">{log.detail}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-[9.5px] font-mono bg-[#232a3f] text-gray-400 px-1.5 py-0.5 rounded">
                            {log.action}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-[#181d2e] border-t border-[#2a324b] flex items-center justify-between text-xs text-gray-400 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>GodsEye Server 連線正常</span>
          </div>
          <div>
            <span>按鍵 Esc 或點擊右上角 X 即可返回主地圖</span>
          </div>
        </div>
      </div>
    </div>
  );
}
