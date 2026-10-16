'use client';

import * as React from 'react';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl } from '@/utils/api';
import { 
  X, Download, Image as ImageIcon, FileCode2, FileSpreadsheet, 
  Globe, Share2, Check, AlertCircle, RefreshCw, Eye
} from 'lucide-react';

// 圖層中文名稱與後端 API 端點對照表
const LAYER_METADATA: Record<string, { label: string; url: string; category: string }> = {
  skytrainRoutes: { label: '天車路線', url: '/api/geojson/tracks/skytrain', category: '交通' },
  skytrainStops: { label: '天車站點', url: '/api/geojson/stops/skytrain', category: '交通' },
  busRoutes: { label: '公車路線', url: '/api/geojson/tracks/bus', category: '交通' },
  busStops: { label: '公車站點', url: '/api/geojson/stops/bus', category: '交通' },
  seabusRoutes: { label: '海上巴士航線', url: '/api/geojson/tracks/seabus', category: '交通' },
  seabusStops: { label: '海上巴士碼頭', url: '/api/geojson/stops/seabus', category: '交通' },
  bcferriesRoutes: { label: 'BC 渡輪航線', url: '/api/geojson/tracks/bcferries', category: '交通' },
  bcferriesTerminals: { label: 'BC 渡輪碼頭', url: '/api/geojson/stops/bcferries', category: '交通' },
  bikeways: { label: '單車專用道網絡', url: '/api/geojson/road/bikeways', category: '道路' },
  bikeRacks: { label: '單車架停放處', url: '/api/geojson/road/bike_racks', category: '道路' },
  parkingMeters: { label: '停車收費錶', url: '/api/geojson/road/parking_meters', category: '道路' },
  accessibleParking: { label: '無障礙泊車位', url: '/api/geojson/road/accessible_parking', category: '道路' },
  motorcycleParking: { label: '電單車泊車位', url: '/api/geojson/road/motorcycle_parking', category: '道路' },
  evCharging: { label: '電動車充電站', url: '/api/geojson/road/ev_charging', category: '道路' },
  trafficCrosswalks: { label: '行人斑馬線', url: '/api/geojson/road/traffic_crosswalks', category: '道路' },
  trafficSpeedLimits: { label: '道路車速限制', url: '/api/geojson/road/traffic_speed_limits', category: '道路' },
  oneWayStreets: { label: '單行道指示', url: '/api/geojson/road/one_way_streets', category: '道路' },
  snowRemovalRoutes: { label: '冬季除雪幹道', url: '/api/geojson/road/snow_removal_routes', category: '道路' },
  waterDistributionMains: { label: '自來水主管道', url: '/api/geojson/road/water_distribution_mains', category: '公用' },
  sewerMains: { label: '下水道排污幹管', url: '/api/geojson/road/sewer_mains', category: '公用' },
  wirelessFacilities: { label: '無線通訊基站', url: '/api/geojson/road/wireless_facilities', category: '公用' },
  postalCodeFSA: { label: '郵遞區號分區 (FSA)', url: '/api/geojson/road/postal_code_fsa', category: '地理' },
  localAreaBoundary: { label: '官方社區分區邊界', url: '/api/geojson/road/local_area_boundary', category: '地理' },
  contours: { label: '等高線地形圖', url: '/api/geojson/road/contours', category: '地理' },
  schools: { label: '學校', url: '/api/geojson/road/schools', category: '生活' },
  libraries: { label: '公共圖書館', url: '/api/geojson/road/libraries', category: '生活' },
  communityCentres: { label: '社區中心', url: '/api/geojson/road/community_centres', category: '生活' },
  parks: { label: '城市公園與綠地', url: '/api/geojson/road/parks', category: '生活' },
  parksFacilities: { label: '公園康樂設施', url: '/api/geojson/road/parks_facilities', category: '生活' },
  communityGardens: { label: '社區共享花園', url: '/api/geojson/road/community_gardens', category: '生活' },
  drinkingFountains: { label: '公共飲水台', url: '/api/geojson/road/drinking_fountains', category: '生活' },
  publicWashrooms: { label: '公共洗手間', url: '/api/geojson/road/public_washrooms', category: '生活' },
  foodVendors: { label: '街頭食品攤販', url: '/api/geojson/road/food_vendors', category: '生活' },
  foodBanks: { label: '食物銀行與低收食物', url: '/api/geojson/road/food_banks', category: '生活' },
  recycling: { label: '環保回收站', url: '/api/geojson/road/recycling', category: '生活' },
  aed: { label: 'AED 心臟去顫器', url: '/api/geojson/road/aed', category: '生活' },
  homelessShelters: { label: '無家者緊急庇護所', url: '/api/geojson/road/homeless_shelters', category: '生活' },
  litterContainers: { label: '街頭公用垃圾箱', url: '/api/geojson/road/litter_containers', category: '生活' },
  trafficCameras: { label: '即時路況攝影機', url: '/api/geojson/road/traffic_cameras', category: '安全' },
  safetyCameras: { label: '測速與安全相機', url: '/api/geojson/road/safety_cameras', category: '安全' },
  fireHalls: { label: '消防分局', url: '/api/geojson/road/fire_halls', category: '安全' },
  police: { label: '警察分局', url: '/api/geojson/road/police', category: '安全' },
  disasterHubs: { label: '災難應變中心', url: '/api/geojson/road/disaster_hubs', category: '安全' },
  hospitals: { label: '綜合急診醫院', url: '/api/geojson/road/hospitals', category: '安全' },
  crimeAreas: { label: '罪案發生率熱區', url: '/api/geojson/road/crime_areas', category: '安全' },
  fuel: { label: '加油站', url: '/api/geojson/road/fuel', category: '商業' },
  tesla: { label: 'Tesla 超級充電站', url: '/api/geojson/road/tesla', category: '商業' },
  carSharing: { label: '共享汽車站點', url: '/api/geojson/road/car_sharing', category: '商業' },
  sharedBikes: { label: 'Mobi 共享單車站點', url: '/api/geojson/road/shared_bikes', category: '商業' },
  escooter: { label: 'Lime 共享電動滑板車', url: '/api/geojson/road/escooter', category: '商業' },
  marineTerminals: { label: '海運貨運碼頭', url: '/api/geojson/road/marine_terminals', category: '商業' }
};

export default function ExportModal() {
  const { 
    isExportModalOpen, setExportModalOpen, layers, mapStyleType, 
    contourInterval, userLocation
  } = useUIStore();

  const [activeTab, setActiveTab] = useState<'image' | 'geojson' | 'csv' | 'kml' | 'config'>('image');
  
  // 圖片匯出設定
  const [imageFormat, setImageFormat] = useState<'png' | 'jpeg'>('png');
  const [includeWatermark, setIncludeWatermark] = useState<boolean>(true);
  const [previewDataUrl, setPreviewDataUrl] = useState<string>('');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // GeoJSON / CSV 匯出設定
  const [selectedGeojsonScope, setSelectedGeojsonScope] = useState<'all_active' | string>('all_active');
  const [exportStatusText, setExportStatusText] = useState<string>('');

  // 取得目前已開啟的圖層清單
  const activeLayerKeys = useMemo(() => {
    return Object.entries(layers)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .filter(k => LAYER_METADATA[k] !== undefined);
  }, [layers]);

  // 生成純淨地圖畫布的預覽圖
  const updateMapPreview = useCallback(() => {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap();
    if (!mapInstance) return;

    const doCapture = () => {
      try {
        const mapCanvas = mapInstance.getCanvas();
        if (!mapCanvas || mapCanvas.width === 0 || mapCanvas.height === 0) return;

        const previewCanvas = document.createElement('canvas');
        const scale = 480 / mapCanvas.width;
        previewCanvas.width = 480;
        previewCanvas.height = Math.max(120, Math.round(mapCanvas.height * scale));
        const ctx = previewCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(mapCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
          const dataUrl = previewCanvas.toDataURL('image/jpeg', 0.88);
          if (dataUrl && dataUrl.length > 500) {
            setPreviewDataUrl(dataUrl);
          }
        }
      } catch (err) {
        console.warn('Map preview generation warning:', err);
      }
    };

    // 觸發 MapLibre 重新繪製幀，並於渲染回調中精確截取最新畫面
    mapInstance.triggerRepaint();
    mapInstance.once('render', () => {
      requestAnimationFrame(doCapture);
    });
    // 閒置備用定時器
    setTimeout(doCapture, 100);
  }, []);

  // 當開啟 Modal 或切換到圖片分頁時生成預覽
  useEffect(() => {
    if (isExportModalOpen) {
      const t1 = setTimeout(updateMapPreview, 60);
      const t2 = setTimeout(updateMapPreview, 280);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    } else {
      setPreviewDataUrl('');
    }
  }, [isExportModalOpen, updateMapPreview]);

  useEffect(() => {
    if (isExportModalOpen && activeTab === 'image') {
      const t = setTimeout(updateMapPreview, 60);
      return () => clearTimeout(t);
    }
  }, [isExportModalOpen, activeTab, updateMapPreview]);

  // 1. 匯出純淨地圖圖片
  const handleExportImage = () => {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap();
    if (!mapInstance) {
      alert('地圖實例尚未就緒，請稍後再試。');
      return;
    }

    setIsExporting(true);
    setExportStatusText('正在生成純淨高畫質地圖影像...');

    const doExport = () => {
      try {
        const mapCanvas = mapInstance.getCanvas();
        if (!mapCanvas) {
          throw new Error('Canvas not available');
        }

        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = mapCanvas.width;
        exportCanvas.height = mapCanvas.height;
        const ctx = exportCanvas.getContext('2d');

        if (!ctx) {
          setIsExporting(false);
          return;
        }

        // 1. 繪製純淨地圖畫布 (無任何側邊欄、設定窗、Popup 或搜尋框干擾)
        ctx.drawImage(mapCanvas, 0, 0);

        // 2. 若使用者選擇包含資訊標註橫條 (Watermark & Info HUD)
        if (includeWatermark) {
          const bannerHeight = Math.max(52, Math.round(exportCanvas.height * 0.055));
          const yPos = exportCanvas.height - bannerHeight;

          // 繪製半透明現代暗色漸層條
          ctx.fillStyle = 'rgba(14, 17, 24, 0.90)';
          ctx.fillRect(0, yPos, exportCanvas.width, bannerHeight);

          // 頂部科技亮青色飾條
          ctx.fillStyle = '#06b6d4';
          ctx.fillRect(0, yPos, exportCanvas.width, 2.5);

          // 左側：系統標題與圖標
          const titleSize = Math.max(14, Math.round(bannerHeight * 0.36));
          ctx.font = `bold ${titleSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
          ctx.fillStyle = '#ffffff';
          ctx.fillText("Vancouver God's Eye · 溫哥華天眼", 24, yPos + bannerHeight * 0.58);

          // 右側：經緯度中心、縮放層級與輸出時間
          const center = mapInstance.getCenter();
          const zoom = mapInstance.getZoom().toFixed(1);
          const nowStr = new Date().toLocaleString('zh-TW', { hour12: false });
          const infoText = `${center.lat.toFixed(4)}°N, ${Math.abs(center.lng).toFixed(4)}°W  |  Zoom ${zoom}  |  ${nowStr}`;
          
          const infoSize = Math.max(11, Math.round(bannerHeight * 0.28));
          ctx.font = `normal ${infoSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace`;
          ctx.fillStyle = '#94a3b8';
          const textWidth = ctx.measureText(infoText).width;
          ctx.fillText(infoText, exportCanvas.width - textWidth - 24, yPos + bannerHeight * 0.58);
        }

        const mimeType = imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
        const dataUrl = exportCanvas.toDataURL(mimeType, imageFormat === 'jpeg' ? 0.92 : undefined);

        const a = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = dataUrl;
        a.download = `vancouver-gods-eye-${timestamp}.${imageFormat === 'jpeg' ? 'jpg' : 'png'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setIsExporting(false);
        setExportStatusText('');
      } catch (err) {
        console.error('Export image error:', err);
        alert('匯出圖片時發生錯誤，請重試。');
        setIsExporting(false);
        setExportStatusText('');
      }
    };

    mapInstance.triggerRepaint();
    mapInstance.once('render', () => {
      requestAnimationFrame(doExport);
    });
    setTimeout(doExport, 120);
  };

  // 抓取指定圖層的 GeoJSON 特徵清單
  const fetchLayerGeoJSON = async (layerKey: string) => {
    const meta = LAYER_METADATA[layerKey];
    if (!meta) return null;
    const apiUrl = getApiUrl();
    try {
      const res = await fetch(`${apiUrl}${meta.url}`);
      if (!res.ok) return null;
      const data = await res.json();
      return { layerKey, meta, data };
    } catch (e) {
      console.warn(`Fetch error for layer ${layerKey}:`, e);
      return null;
    }
  };

  // 2. 匯出 GeoJSON 檔案 (可打包全部或單一)
  const handleExportGeoJSON = async () => {
    setIsExporting(true);
    setExportStatusText('正在檢索並打包向量圖資數據...');

    try {
      const targetKeys = selectedGeojsonScope === 'all_active' 
        ? activeLayerKeys 
        : [selectedGeojsonScope];

      if (targetKeys.length === 0) {
        alert('目前未開啟任何可匯出圖層，請先在左側圖層面板開啟至少一個圖層。');
        setIsExporting(false);
        setExportStatusText('');
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allFeatures: any[] = [];
      const includedLayers: string[] = [];

      for (const k of targetKeys) {
        setExportStatusText(`正在讀取圖層：${LAYER_METADATA[k]?.label || k}...`);
        const res = await fetchLayerGeoJSON(k);
        if (res && res.data && Array.isArray(res.data.features)) {
          includedLayers.push(res.meta.label);
          for (const feat of res.data.features) {
            allFeatures.push({
              ...feat,
              properties: {
                ...(feat.properties || {}),
                _export_layer_id: k,
                _export_layer_name: res.meta.label,
                _export_category: res.meta.category
              }
            });
          }
        }
      }

      const packagedGeoJSON = {
        type: 'FeatureCollection',
        generator: "Vancouver God's Eye (溫哥華天眼 GIS 匯出系統)",
        exported_at: new Date().toISOString(),
        total_features: allFeatures.length,
        layers: includedLayers,
        features: allFeatures
      };

      const blob = new Blob([JSON.stringify(packagedGeoJSON, null, 2)], { type: 'application/geo+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timestamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `vancouver-gods-eye-${selectedGeojsonScope === 'all_active' ? 'all-layers' : selectedGeojsonScope}-${timestamp}.geojson`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setIsExporting(false);
      setExportStatusText('');
    } catch (err) {
      console.error('GeoJSON export error:', err);
      alert('匯出 GeoJSON 失敗，請重試。');
      setIsExporting(false);
      setExportStatusText('');
    }
  };

  // 3. 匯出 CSV 試算表表格 (附帶 UTF-8 BOM，Excel 直接雙擊無亂碼)
  const handleExportCSV = async () => {
    setIsExporting(true);
    setExportStatusText('正在提取點位設施資料並生成 CSV 試算表...');

    try {
      if (activeLayerKeys.length === 0) {
        alert('目前未開啟任何圖層，請先開啟設施圖層（如單車架、公廁、食物銀行等）。');
        setIsExporting(false);
        setExportStatusText('');
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: string[][] = [
        ['設施ID', '設施名稱', '圖層分類', '所屬類別', '緯度 (Latitude)', '經度 (Longitude)', '所屬社區/鄰里', '地址/位置說明', '補充資訊']
      ];

      for (const k of activeLayerKeys) {
        const res = await fetchLayerGeoJSON(k);
        if (res && res.data && Array.isArray(res.data.features)) {
          for (const feat of res.data.features) {
            const props = feat.properties || {};
            const geom = feat.geometry;
            let lon = '';
            let lat = '';
            if (geom && geom.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
              lon = geom.coordinates[0].toString();
              lat = geom.coordinates[1].toString();
            }

            const id = props.id || props.object_id || '';
            const name = props.name || props.site_name || props.facility_name || props.location || props.brand || res.meta.label;
            const category = res.meta.label;
            const group = res.meta.category;
            const localArea = props.local_area || props.municipality || props.city || '';
            const location = props.location || props.address || props.street || '';
            
            // 補充備註資訊
            const extraDetails = Object.entries(props)
              .filter(([pk]) => !['id', 'object_id', 'name', 'site_name', 'facility_name', 'local_area', 'address', 'location'].includes(pk))
              .slice(0, 3)
              .map(([pk, pv]) => `${pk}:${pv}`)
              .join('; ');

            rows.push([
              `"${String(id).replace(/"/g, '""')}"`,
              `"${String(name).replace(/"/g, '""')}"`,
              `"${String(category).replace(/"/g, '""')}"`,
              `"${String(group).replace(/"/g, '""')}"`,
              lat,
              lon,
              `"${String(localArea).replace(/"/g, '""')}"`,
              `"${String(location).replace(/"/g, '""')}"`,
              `"${String(extraDetails).replace(/"/g, '""')}"`
            ]);
          }
        }
      }

      const csvContent = '\uFEFF' + rows.map(r => r.join(',')).join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timestamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `vancouver-gods-eye-facilities-${timestamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setIsExporting(false);
      setExportStatusText('');
    } catch (err) {
      console.error('CSV export error:', err);
      alert('匯出 CSV 試算表失敗，請重試。');
      setIsExporting(false);
      setExportStatusText('');
    }
  };

  // 4. 匯出 Google Earth KML 檔案
  const handleExportKML = async () => {
    setIsExporting(true);
    setExportStatusText('正在轉換地圖圖資為 Google Earth KML 格式...');

    try {
      if (activeLayerKeys.length === 0) {
        alert('目前未開啟任何圖層，請先開啟交通或設施圖層。');
        setIsExporting(false);
        setExportStatusText('');
        return;
      }

      let placemarksKML = '';

      for (const k of activeLayerKeys) {
        const res = await fetchLayerGeoJSON(k);
        if (res && res.data && Array.isArray(res.data.features)) {
          placemarksKML += `\n    <Folder>\n      <name>${res.meta.label}</name>\n`;
          for (const feat of res.data.features) {
            const props = feat.properties || {};
            const name = props.name || props.site_name || props.location || res.meta.label;
            const desc = props.address || props.description || props.local_area || '';
            const geom = feat.geometry;

            if (geom && geom.type === 'Point' && Array.isArray(geom.coordinates)) {
              placemarksKML += `      <Placemark>
        <name><![CDATA[${name}]]></name>
        <description><![CDATA[類別: ${res.meta.label}<br/>${desc}]]></description>
        <Point><coordinates>${geom.coordinates[0]},${geom.coordinates[1]},0</coordinates></Point>
      </Placemark>\n`;
            } else if (geom && geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
              const coordStr = geom.coordinates.map((c: number[]) => `${c[0]},${c[1]},0`).join(' ');
              placemarksKML += `      <Placemark>
        <name><![CDATA[${name}]]></name>
        <LineString><coordinates>${coordStr}</coordinates></LineString>
      </Placemark>\n`;
            }
          }
          placemarksKML += `    </Folder>\n`;
        }
      }

      const fullKML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Vancouver God's Eye Layers</name>
    <description>大溫哥華天眼即時地理資訊圖資打包 (KML Export)</description>
${placemarksKML}
  </Document>
</kml>`;

      const blob = new Blob([fullKML], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timestamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `vancouver-gods-eye-layers-${timestamp}.kml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setIsExporting(false);
      setExportStatusText('');
    } catch (err) {
      console.error('KML export error:', err);
      alert('匯出 KML 失敗，請重試。');
      setIsExporting(false);
      setExportStatusText('');
    }
  };

  // 5. 匯出工作區設定 JSON & 複製分享連結
  const handleExportConfig = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap();
    const center = mapInstance ? mapInstance.getCenter() : { lng: -123.05, lat: 49.25 };
    const zoom = mapInstance ? mapInstance.getZoom() : 11;
    const bearing = mapInstance ? mapInstance.getBearing() : 0;
    const pitch = mapInstance ? mapInstance.getPitch() : 0;

    const workspaceConfig = {
      app: "Vancouver God's Eye",
      version: "2.0",
      saved_at: new Date().toISOString(),
      mapView: {
        center: [center.lng, center.lat],
        zoom,
        bearing,
        pitch,
        mapStyleType
      },
      contourInterval,
      userLocation,
      activeLayers: activeLayerKeys,
      layersState: layers
    };

    const blob = new Blob([JSON.stringify(workspaceConfig, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vancouver-gods-eye-workspace-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyShareLink = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap();
    const center = mapInstance ? mapInstance.getCenter() : { lng: -123.05, lat: 49.25 };
    const zoom = mapInstance ? mapInstance.getZoom().toFixed(2) : 11;

    const params = new URLSearchParams();
    params.set('lat', center.lat.toFixed(4));
    params.set('lon', center.lng.toFixed(4));
    params.set('zoom', zoom.toString());
    params.set('style', mapStyleType);
    if (activeLayerKeys.length > 0) {
      params.set('layers', activeLayerKeys.join(','));
    }

    const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  if (!isExportModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200 select-none">
      <div 
        className="w-[620px] max-w-[95vw] bg-[#161922] border border-[#2a2f3d] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-gray-100 max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#262b38] bg-[#1a1e29]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-sm">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base leading-snug">
                地圖與圖資匯出中心 (Export Center)
              </h3>
              <p className="text-xs text-gray-400">
                匯出純淨地圖快照、打包向量圖資或試算表表格
              </p>
            </div>
          </div>
          <button
            onClick={() => setExportModalOpen(false)}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-[#252a38] transition-colors"
            title="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Export Formats Tab Selector */}
        <div className="grid grid-cols-5 p-2 bg-[#10131a] border-b border-[#262b38] text-xs gap-1">
          {[
            { id: 'image', label: '📸 純淨影像', desc: 'PNG / JPEG' },
            { id: 'geojson', label: '🗺️ 向量圖資', desc: 'GeoJSON' },
            { id: 'csv', label: '📊 設施試算表', desc: 'Excel CSV' },
            { id: 'kml', label: '🌍 Google Earth', desc: 'KML 標記' },
            { id: 'config', label: '🔗 工作區設定', desc: 'JSON / 連結' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl transition-all ${
                activeTab === tab.id
                  ? 'bg-cyan-500 text-gray-950 font-bold shadow-md'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1f2c]'
              }`}
            >
              <span className="text-[11.5px] leading-tight">{tab.label}</span>
              <span className={`text-[9.5px] mt-0.5 ${activeTab === tab.id ? 'text-cyan-950 font-semibold' : 'text-gray-400'}`}>
                {tab.desc}
              </span>
            </button>
          ))}
        </div>

        {/* Tab Content Body */}
        <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-4 text-xs">
          {/* TAB 1: 純淨地圖影像匯出 */}
          {activeTab === 'image' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-cyan-950/25 border border-cyan-500/30 text-cyan-200">
                <Eye className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                <div className="leading-relaxed text-[11.5px]">
                  <strong>純淨無干擾截圖保證</strong>：系統直接由 WebGL 畫布提取高解析度地圖像素，<strong>完全不包含</strong>圖層抽屜、設定彈窗、頂部選單或操作按鈕。
                </div>
              </div>

              {/* 畫布縮圖預覽 */}
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center text-gray-300 font-medium">
                  <span>當前畫面預覽 (Live Canvas Preview):</span>
                  <button 
                    onClick={updateMapPreview}
                    className="flex items-center gap-1 text-[11px] text-cyan-400 hover:underline"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>重新整理預覽</span>
                  </button>
                </div>

                <div className="relative w-full h-[180px] bg-[#0c0e14] rounded-xl overflow-hidden border border-[#282f40] flex items-center justify-center group shadow-inner">
                  {previewDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img 
                      src={previewDataUrl} 
                      alt="Map Preview" 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <ImageIcon className="w-8 h-8 opacity-40 animate-pulse" />
                      <span>正在載入地圖畫面...</span>
                    </div>
                  )}

                  {includeWatermark && previewDataUrl && (
                    <div className="absolute bottom-0 inset-x-0 bg-black/85 border-t border-cyan-500/60 px-3 py-1 flex justify-between items-center text-[10px] text-gray-300 font-mono">
                      <span className="font-sans font-bold text-white text-[11px]">Vancouver God&apos;s Eye · 溫哥華天眼</span>
                      <span>座標 &amp; 時間浮水印橫條</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 設定選項 */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="flex flex-col gap-1.5 bg-[#10131a] p-3 rounded-xl border border-[#262b38]">
                  <span className="text-gray-400 font-medium">檔案格式 (Format):</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => setImageFormat('png')}
                      className={`py-1.5 rounded-lg text-center font-medium transition-all ${
                        imageFormat === 'png'
                          ? 'bg-cyan-500 text-gray-950 font-bold'
                          : 'bg-[#1b202c] text-gray-300 hover:bg-[#252c3d]'
                      }`}
                    >
                      PNG (高畫質)
                    </button>
                    <button
                      onClick={() => setImageFormat('jpeg')}
                      className={`py-1.5 rounded-lg text-center font-medium transition-all ${
                        imageFormat === 'jpeg'
                          ? 'bg-cyan-500 text-gray-950 font-bold'
                          : 'bg-[#1b202c] text-gray-300 hover:bg-[#252c3d]'
                      }`}
                    >
                      JPEG (輕量)
                    </button>
                  </div>
                </div>

                <div className="flex flex-col justify-center gap-2 bg-[#10131a] p-3 rounded-xl border border-[#262b38]">
                  <span className="text-gray-400 font-medium">浮水印與座標標註:</span>
                  <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeWatermark}
                      onChange={(e) => setIncludeWatermark(e.target.checked)}
                      className="rounded border-gray-600 accent-cyan-500"
                    />
                    <span className="text-[11.5px]">加上底部標題與經緯度橫條</span>
                  </label>
                </div>
              </div>

              {/* 下載按鈕 */}
              <button
                onClick={handleExportImage}
                disabled={isExporting}
                className="w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-50 mt-1"
              >
                <Download className="w-4 h-4" />
                <span>{isExporting ? '生成圖片中...' : '下載純淨地圖圖片 (Download Image)'}</span>
              </button>
            </div>
          )}

          {/* TAB 2: 向量圖資 GeoJSON 打包 */}
          {activeTab === 'geojson' && (
            <div className="flex flex-col gap-4">
              <div className="p-3 rounded-xl bg-[#10131a] border border-[#262b38] flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-white text-xs flex items-center gap-1.5">
                    <FileCode2 className="w-4 h-4 text-cyan-400" />
                    <span>當前已開啟的圖層清單</span>
                  </span>
                  <span className="text-cyan-400 font-mono font-bold">
                    共 {activeLayerKeys.length} 個圖層
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 max-h-[95px] overflow-y-auto pr-1">
                  {activeLayerKeys.length > 0 ? (
                    activeLayerKeys.map((k) => (
                      <span 
                        key={k}
                        className="px-2 py-0.5 rounded-md bg-[#1d2332] border border-[#2a3449] text-gray-300 text-[10.5px]"
                      >
                        {LAYER_METADATA[k]?.label || k}
                      </span>
                    ))
                  ) : (
                    <span className="text-gray-400 text-[11px] py-2">
                      ⚠️ 目前尚未開啟任何圖層，請先在左側開啟需要匯出的圖層。
                    </span>
                  )}
                </div>
              </div>

              {/* 匯出範圍選項 */}
              <div className="flex flex-col gap-1.5">
                <span className="text-gray-400 font-medium">選擇匯出範圍 (Scope):</span>
                <select
                  value={selectedGeojsonScope}
                  onChange={(e) => setSelectedGeojsonScope(e.target.value)}
                  className="w-full bg-[#10131a] border border-[#262b38] rounded-xl px-3 py-2 text-gray-200 outline-none focus:border-cyan-500"
                >
                  <option value="all_active">🌟 打包全部已開啟圖層 (All Active Layers into One GeoJSON)</option>
                  {activeLayerKeys.map((k) => (
                    <option key={k} value={k}>
                      僅匯出此圖層：{LAYER_METADATA[k]?.label || k}
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3 rounded-xl bg-gray-900/60 border border-gray-800 text-[11px] text-gray-400 leading-relaxed">
                💡 <strong>標準 GIS 格式說明</strong>：匯出的檔案為標準 RFC 7946 GeoJSON 格式，每個點位或線段皆保留完整屬性（如地址、電話、設施類型），可直接拖入 <strong>QGIS、ArcGIS、Kepler.gl、Mapbox Studio</strong> 或以 Python GeoPandas 進行分析。
              </div>

              <button
                onClick={handleExportGeoJSON}
                disabled={isExporting || activeLayerKeys.length === 0}
                className="w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-50 mt-1"
              >
                <Download className="w-4 h-4" />
                <span>{isExporting ? '打包向量圖資中...' : '匯出 GeoJSON 檔案 (Download GeoJSON)'}</span>
              </button>
            </div>
          )}

          {/* TAB 3: 設施清單試算表 CSV */}
          {activeTab === 'csv' && (
            <div className="flex flex-col gap-4">
              <div className="p-3 rounded-xl bg-[#10131a] border border-[#262b38] flex flex-col gap-2">
                <div className="flex items-center gap-2 text-white font-bold text-xs">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>結構化數據試算表 (CSV / Excel Format)</span>
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  將目前畫面上已開啟的各類公共設施（如 AED、公廁、食物銀行、垃圾箱、單車架、學校等）轉換為標準表格，包含中文名稱、分類、經度、緯度、地址與社區。
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2.5 rounded-lg bg-[#10131a] border border-[#232836] flex flex-col gap-1">
                  <span className="text-gray-400 font-medium">防亂碼編碼</span>
                  <span className="font-bold text-emerald-400">UTF-8 with BOM</span>
                  <span className="text-[10px] text-gray-400">雙擊直接以 Excel / Numbers 開啟無亂碼</span>
                </div>
                <div className="p-2.5 rounded-lg bg-[#10131a] border border-[#232836] flex flex-col gap-1">
                  <span className="text-gray-400 font-medium">輸出欄位</span>
                  <span className="font-bold text-white font-mono">9 個標準欄位</span>
                  <span className="text-[10px] text-gray-400">ID, 名稱, 分類, 經緯度, 社區, 地址等</span>
                </div>
              </div>

              <div className="text-[11px] text-gray-400 bg-amber-500/10 border border-amber-500/25 p-2.5 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>試算表適合非營利組織、市政報告、數據分析師或列印名冊使用。</span>
              </div>

              <button
                onClick={handleExportCSV}
                disabled={isExporting || activeLayerKeys.length === 0}
                className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-50 mt-1"
              >
                <Download className="w-4 h-4" />
                <span>{isExporting ? '生成 CSV 中...' : '下載 CSV 試算表 (Download CSV)'}</span>
              </button>
            </div>
          )}

          {/* TAB 4: Google Earth KML */}
          {activeTab === 'kml' && (
            <div className="flex flex-col gap-4">
              <div className="p-3 rounded-xl bg-[#10131a] border border-[#262b38] flex flex-col gap-2">
                <div className="flex items-center gap-2 text-white font-bold text-xs">
                  <Globe className="w-4 h-4 text-sky-400" />
                  <span>Google Earth 標記檔案 (KML Format)</span>
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Keyhole Markup Language (KML) 是 Google Earth 與各類 GPS 手持設備的通用標準，可將大溫哥華設施點位與天車路線直接投射至 3D 衛星地球上。
                </p>
              </div>

              <div className="p-3 rounded-xl bg-sky-950/20 border border-sky-500/30 text-[11px] text-sky-200 flex flex-col gap-1.5">
                <span className="font-bold flex items-center gap-1.5 text-sky-300">
                  <span>🚀</span> 如何使用 KML 檔案：
                </span>
                <ol className="list-decimal pl-4 space-y-1 text-gray-300 text-[10.5px]">
                  <li>下載後，直接以電腦版 <strong>Google Earth Pro</strong> 雙擊打開。</li>
                  <li>或在瀏覽器造訪 <strong>earth.google.com</strong>，點選「專案」&gt;「匯入 KML 檔案」。</li>
                  <li>亦支援傳輸至 Garmin 或手機戶外登山航點 App。</li>
                </ol>
              </div>

              <button
                onClick={handleExportKML}
                disabled={isExporting || activeLayerKeys.length === 0}
                className="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-gray-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-50 mt-1"
              >
                <Download className="w-4 h-4" />
                <span>{isExporting ? '生成 KML 中...' : '下載 KML 標記檔案 (Download KML)'}</span>
              </button>
            </div>
          )}

          {/* TAB 5: 工作區狀態設定檔 JSON & 專屬分享連結 */}
          {activeTab === 'config' && (
            <div className="flex flex-col gap-4">
              <div className="p-3 rounded-xl bg-[#10131a] border border-[#262b38] flex flex-col gap-2">
                <div className="flex items-center gap-2 text-white font-bold text-xs">
                  <Share2 className="w-4 h-4 text-purple-400" />
                  <span>地圖工作區設定檔與分享連結</span>
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  儲存當前的地圖視野（中心經緯度、縮放層級、底圖風格）以及 40+ 個圖層的開關勾選狀態，隨時備份工作環境或分享給團隊成員。
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleExportConfig}
                  className="p-3 rounded-xl bg-[#10131a] hover:bg-[#1c2230] border border-[#262b38] hover:border-purple-500/50 flex flex-col items-center justify-center gap-1.5 transition-all text-center"
                >
                  <FileCode2 className="w-5 h-5 text-purple-400" />
                  <span className="font-bold text-white text-xs">下載工作區 JSON</span>
                  <span className="text-[10px] text-gray-400">儲存目前所有圖層與視野設定</span>
                </button>

                <button
                  onClick={handleCopyShareLink}
                  className="p-3 rounded-xl bg-[#10131a] hover:bg-[#1c2230] border border-[#262b38] hover:border-cyan-500/50 flex flex-col items-center justify-center gap-1.5 transition-all text-center"
                >
                  {copiedLink ? (
                    <Check className="w-5 h-5 text-emerald-400 animate-in zoom-in" />
                  ) : (
                    <Share2 className="w-5 h-5 text-cyan-400" />
                  )}
                  <span className="font-bold text-white text-xs">
                    {copiedLink ? '連結已複製！' : '複製專屬分享網址'}
                  </span>
                  <span className="text-[10px] text-gray-400">帶有座標與圖層參數之 Deep Link</span>
                </button>
              </div>
            </div>
          )}

          {/* 狀態提示 */}
          {exportStatusText && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-cyan-950/40 border border-cyan-500/40 text-cyan-300 text-[11px] animate-in fade-in">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>{exportStatusText}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
