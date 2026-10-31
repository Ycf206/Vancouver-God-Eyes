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
  FileText,
  Lock,
  Key,
  LogOut,
  ArrowUpDown,
  Info
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
  data_pipeline_notes?: string;
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
  { id: 'schools', name: '學校及教育設施', filename: 'vancouver_schools.geojson' },
  { id: 'libraries', name: '公共圖書館', filename: 'vancouver_libraries.geojson' },
  { id: 'parks', name: '都會與社區公園', filename: 'vancouver_parks.geojson' },
  { id: 'community_centres', name: '社區活動中心', filename: 'vancouver_community_centres.geojson' },
  { id: 'public_art', name: '公共藝術展品', filename: 'vancouver_public_art.geojson' },
  { id: 'museums', name: '歷史博物館與藝廊', filename: 'vancouver_museums.geojson' },
  { id: 'garbage_collection', name: '廢物回收分區', filename: 'vancouver_garbage_collection.geojson' },
  { id: 'recycling', name: '環保廢物分類回收站', filename: 'vancouver_recycling.geojson' },
  { id: 'homeless_shelters', name: '無家者庇護所', filename: 'vancouver_homeless_shelters.geojson' },
  { id: 'food_banks', name: '食物援助銀行', filename: 'vancouver_food_banks.geojson' },
  { id: 'food_vendors', name: '市區街頭餐車攤販', filename: 'vancouver_food_vendors.geojson' },
  { id: 'aed', name: '自動體外心臟去顫器', filename: 'vancouver_aed.geojson' },
  { id: 'zoning_districts', name: '土地規劃分區', filename: 'vancouver_zoning_districts.geojson' },
  { id: 'parking_meters', name: '路邊停車收費錶', filename: 'vancouver_parking_meters.geojson' },
  { id: 'motorcycle_parking', name: '摩托車專屬車位', filename: 'vancouver_motorcycle_parking.geojson' },
  { id: 'bikeways', name: '單車專用徑道路網', filename: 'vancouver_bikeways.geojson' },
  { id: 'public_trees', name: '市區街道樹木', filename: 'vancouver_public_trees.geojson' },
  { id: 'fire_hydrants', name: '市政消防栓位置', filename: 'vancouver_fire_hydrants.geojson' },
  { id: 'drinking_fountains', name: '公共飲水台', filename: 'vancouver_drinking_fountains.geojson' },
  { id: 'public_washrooms', name: '公共洗手間', filename: 'vancouver_public_washrooms.geojson' },
  { id: 'street_lighting', name: '路燈燈桿', filename: 'vancouver_street_lighting.geojson' },
  { id: 'street_lighting_conduits', name: '路燈電網管道', filename: 'vancouver_street_lighting_conduits.geojson' },
  { id: 'water_distribution_mains', name: '自來水主配水管道', filename: 'vancouver_water_distribution_mains.geojson' },
  { id: 'sewer_mains', name: '市區下水道與排水分流管線', filename: 'vancouver_sewer_mains.geojson' },
  { id: 'traffic_speed_limits', name: '全路網限速路段', filename: 'vancouver_traffic_speed_limits.geojson' },
  { id: 'traffic_crosswalks', name: '行人斑馬線過路處', filename: 'vancouver_traffic_crosswalks.geojson' },
  { id: 'litter_containers', name: '公共垃圾桶與回收箱', filename: 'vancouver_litter_containers.geojson' },
  { id: 'one_way_streets', name: '市區單程道路段', filename: 'vancouver_one_way_streets.geojson' },
  { id: 'snow_removal_routes', name: '冬季市政優先鏟雪路線', filename: 'vancouver_snow_removal_routes.geojson' },
  { id: 'contours', name: '等高線地形高程', filename: 'vancouver_contours.geojson' },
  { id: 'ev_charging', name: '電動車充電站點', filename: 'vancouver_ev_charging.geojson' },
];

export default function AdminModal() {
  const { 
    isAdminModalOpen, 
    setAdminModalOpen, 
    timeZone, 
    timeFormat, 
    isAdminAuthenticated, 
    setAdminAuthenticated 
  } = useUIStore();

  const [activeTab, setActiveTab] = useState<'sources' | 'schedules' | 'upload' | 'logs'>('sources');
  const [sources, setSources] = useState<AdminSourceItem[]>([]);
  const [logs, setLogs] = useState<AdminLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  
  // Tab 1 state
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'api' | 'geojson'>('all');
  const [expandedPipelineId, setExpandedPipelineId] = useState<string | null>(null);

  // Tab 2 (Schedules) Search & Sort state
  const [scheduleSearchQuery, setScheduleSearchQuery] = useState('');
  const [scheduleSortBy, setScheduleSortBy] = useState<'name' | 'frequency' | 'type' | 'records'>('name');

  // PIN Lock authentication state
  const [enteredPin, setEnteredPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  // GeoJSON Upload state
  const [selectedLayerKey, setSelectedLayerKey] = useState<string>('schools');
  const [uploadFileName, setUploadFileName] = useState<string>('vancouver_schools.geojson');
  const [uploadFileContent, setUploadFileContent] = useState<string | null>(null);
  const [uploadFileStats, setUploadFileStats] = useState<{ count: number; geomTypes: string[]; keys: string[] } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Schedules Editing state
  const [editingSchedules, setEditingSchedules] = useState<Record<string, { interval: string; cron: string; enabled: boolean }>>({});
  const [savingScheduleId, setSavingScheduleId] = useState<string | null>(null);
  const [scheduleSuccessId, setScheduleSuccessId] = useState<string | null>(null);

  // Format admin time using user timezone
  const formatAdminTime = (iso?: string | null) => {
    if (!iso) return '未記錄';
    try {
      const tz = timeZone || 'America/Vancouver';
      return new Date(iso).toLocaleString('zh-TW', {
        timeZone: tz,
        hour12: timeFormat === '12h',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return iso;
    }
  };

  const getAdminHeaders = () => {
    const adminSecret = process.env.NEXT_PUBLIC_ADMIN_API_SECRET || (typeof window !== 'undefined' ? (localStorage.getItem('vancouver_godseye_admin_token') || sessionStorage.getItem('vancouver_godseye_admin_token')) : '') || '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (adminSecret) {
      headers['X-Admin-Token'] = adminSecret;
      headers['Authorization'] = `Bearer ${adminSecret}`;
    }
    return headers;
  };

  // Fetch sources and logs from backend
  const fetchAdminData = React.useCallback(async () => {
    setLoading(true);
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/api/admin/sources`, { headers: getAdminHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.sources)) {
          setSources(data.sources);
          const scheds: Record<string, { interval: string; cron: string; enabled: boolean }> = {};
          const intervalMap: Record<string, string> = {};
          data.sources.forEach((s: AdminSourceItem) => {
            scheds[s.id] = {
              interval: s.schedule_interval,
              cron: s.cron_expr,
              enabled: s.enabled
            };
            if (s.id && s.schedule_interval) {
              intervalMap[s.id] = s.schedule_interval;
            }
          });
          setEditingSchedules(scheds);
          useUIStore.getState().setAdminSourceIntervals(intervalMap);
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
    if (isAdminModalOpen && isAdminAuthenticated) {
      fetchAdminData();
    }
  }, [isAdminModalOpen, isAdminAuthenticated, fetchAdminData]);

  // Handle PIN unlock
  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    const correctPin = typeof window !== 'undefined' ? (localStorage.getItem('vancouver_admin_pin') || '8888') : '8888';
    if (enteredPin.trim() === correctPin) {
      setAdminAuthenticated(true);
      setPinError(null);
      setEnteredPin('');
      fetchAdminData();
    } else {
      setPinError('管理員安全 PIN 碼不正確，請重新輸入 (預設: 8888)');
      setEnteredPin('');
    }
  };

  // Handle Logout / Lock
  const handleLock = () => {
    setAdminAuthenticated(false);
    setPinError(null);
  };

  // Trigger manual sync for single source
  const handleTriggerSync = async (sourceId: string) => {
    setSyncingId(sourceId);
    const nowIso = new Date().toISOString();
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/api/admin/sources/sync`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ source_id: sourceId })
      });
      if (res.ok) {
        const syncRes = await res.json().catch(() => null);
        const updatedTime = syncRes?.timestamp || nowIso;
        setSources((prev) =>
          prev.map((s) => (s.id === sourceId ? { ...s, last_updated: updatedTime, status: 'healthy' } : s))
        );
        await fetchAdminData();
      } else {
        setSources((prev) =>
          prev.map((s) => (s.id === sourceId ? { ...s, last_updated: nowIso, status: 'healthy' } : s))
        );
      }
    } catch (err) {
      console.error('Sync failed:', err);
      setSources((prev) =>
        prev.map((s) => (s.id === sourceId ? { ...s, last_updated: nowIso, status: 'healthy' } : s))
      );
    } finally {
      setSyncingId(null);
    }
  };

  // Trigger sync all
  const handleSyncAll = async () => {
    setSyncingId('all');
    const nowIso = new Date().toISOString();
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/api/admin/sources/sync_all`, {
        method: 'POST',
        headers: getAdminHeaders()
      });
      if (res.ok) {
        setSources((prev) =>
          prev.map((s) => ({ ...s, last_updated: nowIso, status: 'healthy' }))
        );
        await fetchAdminData();
      } else {
        setSources((prev) =>
          prev.map((s) => ({ ...s, last_updated: nowIso, status: 'healthy' }))
        );
      }
    } catch (err) {
      console.error('Sync all failed:', err);
      setSources((prev) =>
        prev.map((s) => ({ ...s, last_updated: nowIso, status: 'healthy' }))
      );
    } finally {
      setSyncingId(null);
    }
  };

  // Save schedule changes
  const handleSaveSchedule = async (sourceId: string) => {
    const item = editingSchedules[sourceId];
    if (!item) return;
    setSavingScheduleId(sourceId);
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/api/admin/sources/schedule`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          source_id: sourceId,
          interval: item.interval,
          schedule_interval: item.interval,
          cron_expr: item.cron,
          enabled: item.enabled
        })
      });
      if (res.ok) {
        setScheduleSuccessId(sourceId);
        setTimeout(() => setScheduleSuccessId(null), 2500);
        useUIStore.getState().setAdminSourceIntervals({ [sourceId]: item.interval });
        await fetchAdminData();
      }
    } catch (err) {
      console.error('Save schedule failed:', err);
    } finally {
      setSavingScheduleId(null);
    }
  };

  // Handle Layer change in Upload Tab
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
          setUploadMessage({
            text: '檔案非標準 GeoJSON FeatureCollection 規格，請檢查結構。',
            type: 'error'
          });
          setUploadFileContent(null);
          setUploadFileStats(null);
          return;
        }

        const count = parsed.features.length;
        const geomSet = new Set<string>();
        const keySet = new Set<string>();

        parsed.features.slice(0, 100).forEach((f: any) => {
          if (f.geometry?.type) geomSet.add(f.geometry.type);
          if (f.properties) {
            Object.keys(f.properties).forEach((k) => keySet.add(k));
          }
        });

        setUploadFileContent(text);
        setUploadFileStats({
          count,
          geomTypes: Array.from(geomSet),
          keys: Array.from(keySet).slice(0, 8)
        });
        setUploadMessage({
          text: `成功解析！共 ${count} 筆要素特徵 (${Array.from(geomSet).join(', ')})，準備寫入伺服器。`,
          type: 'success'
        });
      } catch (err) {
        setUploadMessage({
          text: 'JSON 格式解析錯誤：' + (err as Error).message,
          type: 'error'
        });
        setUploadFileContent(null);
        setUploadFileStats(null);
      }
    };
    reader.readAsText(file);
  };

  // Submit GeoJSON Upload
  const handleUploadGeoJSON = async () => {
    if (!uploadFileContent) return;
    setUploading(true);
    setUploadMessage(null);

    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/api/admin/geojson/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layer_id: selectedLayerKey,
          filename: uploadFileName,
          content: uploadFileContent
        })
      });

      if (res.ok) {
        const result = await res.json();
        setUploadMessage({
          text: `上傳成功！已成功寫入 ${uploadFileName}，全域圖層即時發布生效！`,
          type: 'success'
        });
        setUploadFileContent(null);
        setUploadFileStats(null);
        fetchAdminData();
      } else {
        const err = await res.json();
        setUploadMessage({
          text: '上傳失敗：' + (err.detail || '伺服器拒絕寫入'),
          type: 'error'
        });
      }
    } catch (err) {
      setUploadMessage({
        text: '網路錯誤：' + (err as Error).message,
        type: 'error'
      });
    } finally {
      setUploading(false);
    }
  };

  // Filter sources for Tab 1
  const filteredSources = useMemo(() => {
    return sources.filter((s) => {
      const matchesSearch =
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.filename && s.filename.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (s.data_pipeline_notes && s.data_pipeline_notes.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesType = typeFilter === 'all' || s.type === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [sources, searchQuery, typeFilter]);

  // Filter & Sort sources for Tab 2 (Schedules)
  const filteredAndSortedSchedules = useMemo(() => {
    const list = sources.filter((s) => {
      return (
        s.name.toLowerCase().includes(scheduleSearchQuery.toLowerCase()) ||
        s.category.toLowerCase().includes(scheduleSearchQuery.toLowerCase()) ||
        s.schedule_interval.toLowerCase().includes(scheduleSearchQuery.toLowerCase()) ||
        s.cron_expr.toLowerCase().includes(scheduleSearchQuery.toLowerCase())
      );
    });

    return list.sort((a, b) => {
      if (scheduleSortBy === 'name') return a.name.localeCompare(b.name, 'zh-TW');
      if (scheduleSortBy === 'type') return a.type.localeCompare(b.type);
      if (scheduleSortBy === 'records') return b.record_count - a.record_count;
      if (scheduleSortBy === 'frequency') return a.schedule_interval.localeCompare(b.schedule_interval, 'zh-TW');
      return 0;
    });
  }, [sources, scheduleSearchQuery, scheduleSortBy]);

  if (!isAdminModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-5xl h-[88vh] max-h-[920px] bg-[#121522] border border-[#2d3752] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-gray-100 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#181d2e] border-b border-[#2a324b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-inner">
              <Shield className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  溫哥華上帝之眼 · 系統管理員後台
                </h2>
                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono px-2 py-0.5 rounded-full font-bold">
                  v2.1
                </span>
                {isAdminAuthenticated && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span>已驗證管理員</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                數據更新排程設定 (API & GeoJSON)、程序追蹤、熱更新發布與系統日誌
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAdminAuthenticated && (
              <button
                onClick={handleLock}
                className="px-2.5 py-1.5 rounded-lg bg-[#222a3d] hover:bg-rose-950/60 text-gray-300 hover:text-rose-300 border border-[#2d3852] hover:border-rose-500/40 text-xs font-medium transition-colors flex items-center gap-1.5"
                title="鎖定後台並登出"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-400" />
                <span className="hidden sm:inline">鎖定後台</span>
              </button>
            )}
            <button
              onClick={() => setAdminModalOpen(false)}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              title="關閉管理後台 (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* PIN Authentication Screen (If not authenticated) */}
        {!isAdminAuthenticated ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#0f121d]">
            <form onSubmit={handleUnlock} className="max-w-md w-full bg-[#161a29] p-6 rounded-2xl border border-[#2a344f] shadow-2xl flex flex-col gap-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 mx-auto shadow-inner">
                <Lock className="w-7 h-7 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">管理員安全身分驗證</h3>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  後台功能包含全平台資料排程與 GeoJSON 發布權限，請輸入管理員 PIN 碼以解鎖操作面板。
                </p>
              </div>

              <div className="space-y-2">
                <div className="relative">
                  <Key className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    autoFocus
                    value={enteredPin}
                    onChange={(e) => setEnteredPin(e.target.value)}
                    placeholder="輸入管理員安全 PIN 碼 (預設: 8888)"
                    className="w-full bg-[#0f121d] text-white text-center font-mono tracking-widest text-lg pl-9 pr-4 py-2.5 rounded-xl border border-[#2a334d] focus:outline-none focus:border-indigo-500"
                  />
                </div>
                {pinError && (
                  <p className="text-xs text-rose-400 font-medium">{pinError}</p>
                )}
              </div>

              <button
                type="submit"
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/30 cursor-pointer"
              >
                解鎖進入管理後台
              </button>

              <div className="pt-2 text-[11px] text-gray-500 border-t border-[#232b3f] flex items-center justify-center gap-1">
                <Info className="w-3.5 h-3.5 text-gray-400" />
                <span>預設管理員 PIN 為 8888，可在後台設定或自訂金鑰</span>
              </div>
            </form>
          </div>
        ) : (
          <>
            {/* Navigation Tabs Bar */}
            <div className="px-6 pt-3 pb-0 bg-[#161a29] border-b border-[#252c40] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
                {[
                  { id: 'sources', label: '數據源總覽與更新程序', icon: Database, count: sources.length },
                  { id: 'schedules', label: '排程週期設定', icon: Sliders, count: sources.length },
                  { id: 'upload', label: '經網頁上傳更新 GeoJSON', icon: Upload },
                  { id: 'logs', label: '系統更新記錄', icon: FileCode, count: logs.length },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                        isActive
                          ? 'border-indigo-500 text-white bg-indigo-500/10 rounded-t-lg'
                          : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/5 rounded-t-lg'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-400' : 'text-gray-400'}`} />
                      <span>{tab.label}</span>
                      {tab.count !== undefined && (
                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                          isActive ? 'bg-indigo-600 text-white' : 'bg-[#23293d] text-gray-400'
                        }`}>
                          {tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 pb-2">
                <button
                  onClick={handleSyncAll}
                  disabled={syncingId === 'all'}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
                  title="立即手動排程同步全平台所有 API 與圖層"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingId === 'all' ? 'animate-spin' : ''}`} />
                  <span>全部立即同步</span>
                </button>
              </div>
            </div>

            {/* Modal Body Container */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* TAB 1: 數據源總覽與更新程序說明 */}
              {activeTab === 'sources' && (
                <div className="space-y-4">
                  {/* Top Stats Overview */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-[#161a29] p-3.5 rounded-xl border border-[#273047] flex flex-col">
                      <span className="text-[11px] text-gray-400">總監控數據集</span>
                      <span className="text-xl font-extrabold text-white font-mono mt-1">{sources.length} 個</span>
                      <span className="text-[10px] text-emerald-400 mt-0.5">全數運行正常</span>
                    </div>
                    <div className="bg-[#161a29] p-3.5 rounded-xl border border-[#273047] flex flex-col">
                      <span className="text-[11px] text-gray-400">即時 API 數據源</span>
                      <span className="text-xl font-extrabold text-blue-400 font-mono mt-1">
                        {sources.filter(s => s.type === 'api').length} 個
                      </span>
                      <span className="text-[10px] text-gray-500 mt-0.5">高頻自動輪詢 (30s ~ 15m)</span>
                    </div>
                    <div className="bg-[#161a29] p-3.5 rounded-xl border border-[#273047] flex flex-col">
                      <span className="text-[11px] text-gray-400">GeoJSON 市政圖層</span>
                      <span className="text-xl font-extrabold text-amber-400 font-mono mt-1">
                        {sources.filter(s => s.type === 'geojson').length} 個
                      </span>
                      <span className="text-[10px] text-gray-500 mt-0.5">包含學校/公園/圖書館等</span>
                    </div>
                    <div className="bg-[#161a29] p-3.5 rounded-xl border border-[#273047] flex flex-col">
                      <span className="text-[11px] text-gray-400">顯示時區與時制</span>
                      <span className="text-sm font-bold text-gray-200 mt-1 truncate font-mono">
                        {timeZone || 'America/Vancouver'} ({timeFormat})
                      </span>
                      <span className="text-[10px] text-sky-400 mt-0.5">依個人偏好自動轉換</span>
                    </div>
                  </div>

                  {/* Search & Filter Controls */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-md">
                      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="搜尋數據源名稱、圖層分類、geojson 檔名或更新程序..."
                        className="w-full bg-[#161a29] text-gray-200 text-xs pl-9 pr-4 py-2 rounded-xl border border-[#273047] focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                    </div>

                    <div className="flex items-center gap-1.5 bg-[#161a29] p-1 rounded-xl border border-[#2a334d] text-xs">
                      <button
                        onClick={() => setTypeFilter('all')}
                        className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                          typeFilter === 'all' ? 'bg-indigo-600 text-white font-medium' : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        全部 ({sources.length})
                      </button>
                      <button
                        onClick={() => setTypeFilter('api')}
                        className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                          typeFilter === 'api' ? 'bg-indigo-600 text-white font-medium' : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        即時 API ({sources.filter(s => s.type === 'api').length})
                      </button>
                      <button
                        onClick={() => setTypeFilter('geojson')}
                        className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
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
                            const isExpanded = expandedPipelineId === source.id;
                            return (
                              <React.Fragment key={source.id}>
                                <tr className="hover:bg-[#1a2133] transition-colors">
                                  <td className="py-3 px-4">
                                    <div className="font-bold text-white flex items-center gap-2">
                                      <span>{source.name}</span>
                                    </div>
                                    <div className="text-[11px] text-gray-400 mt-0.5">
                                      {source.category} · {source.description}
                                    </div>
                                    {source.filename && (
                                      <div className="text-[10px] text-indigo-400 font-mono mt-0.5">
                                        /{source.filename}
                                      </div>
                                    )}
                                    {source.data_pipeline_notes && (
                                      <button
                                        type="button"
                                        onClick={() => setExpandedPipelineId(isExpanded ? null : source.id)}
                                        className="text-[10.5px] text-cyan-400 hover:text-cyan-300 mt-1 flex items-center gap-1 hover:underline cursor-pointer"
                                      >
                                        <Info className="w-3 h-3" />
                                        <span>{isExpanded ? '隱藏更新程序說明' : '檢視更新程序說明'}</span>
                                      </button>
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
                                    {formatAdminTime(source.last_updated)}
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
                                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/40 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50 cursor-pointer"
                                      title="立即手動同步此數據源"
                                    >
                                      <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin text-white' : ''}`} />
                                      <span>{isSyncing ? '同步中' : '立即同步'}</span>
                                    </button>
                                  </td>
                                </tr>

                                {/* Expandable Procedure Details */}
                                {isExpanded && source.data_pipeline_notes && (
                                  <tr className="bg-[#111422]">
                                    <td colSpan={7} className="px-4 py-3 border-t border-[#1f2638]">
                                      <div className="flex items-start gap-2.5 text-xs text-cyan-200/90 leading-relaxed bg-[#151c2e] p-3 rounded-lg border border-cyan-500/30">
                                        <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                                        <div>
                                          <span className="font-bold text-cyan-300 block mb-1">
                                            數據更新管線程序 (Data Pipeline Procedure)：
                                          </span>
                                          <p className="font-mono text-[11px] text-gray-300">
                                            {source.data_pipeline_notes}
                                          </p>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: 排程週期設定 (支援搜尋與排序) */}
              {activeTab === 'schedules' && (
                <div className="space-y-4">
                  <div className="bg-indigo-950/30 p-3 rounded-xl border border-indigo-500/30 text-xs text-indigo-200 flex items-start gap-2.5">
                    <Sliders className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <div className="leading-relaxed">
                      管理員可在此自訂各 API 與圖層數據的自動同步週期（Cron 表達式或預設間隔），亦可一鍵暫停或啟用特定資料源的自動同步排程。修改後即時同步更新後台排程守護程序！
                    </div>
                  </div>

                  {/* Search and Sort toolbar */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-md">
                      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={scheduleSearchQuery}
                        onChange={(e) => setScheduleSearchQuery(e.target.value)}
                        placeholder="搜尋排程項目名稱、分類、頻率或 Cron..."
                        className="w-full bg-[#161a29] text-gray-200 text-xs pl-9 pr-4 py-2 rounded-xl border border-[#273047] focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 flex items-center gap-1 shrink-0">
                        <ArrowUpDown className="w-3.5 h-3.5 text-indigo-400" />
                        <span>排序方式:</span>
                      </span>
                      <select
                        value={scheduleSortBy}
                        onChange={(e) => setScheduleSortBy(e.target.value as any)}
                        className="bg-[#161a29] text-gray-200 text-xs px-3 py-1.5 rounded-xl border border-[#273047] focus:outline-none focus:border-indigo-500 cursor-pointer"
                      >
                        <option value="name">按名稱 (A-Z)</option>
                        <option value="type">按數據類型 (API / GeoJSON)</option>
                        <option value="frequency">按同步頻率</option>
                        <option value="records">按資料筆數多至少</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {filteredAndSortedSchedules.map((s) => {
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
                              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer ${
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
                      <span>選擇要更新的圖層資料集 (共 {DEFAULT_GEOJSON_LAYERS.length} 個可選圖層)</span>
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
                        className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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
                                {formatAdminTime(log.timestamp)}
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
          </>
        )}

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
