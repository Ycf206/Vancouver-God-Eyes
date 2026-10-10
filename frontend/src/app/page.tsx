import AppMap from '@/components/Map';
import TopBar from '@/components/TopBar';

export default function Home() {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#161719] text-white font-sans selection:bg-emerald-500/30">
      
      {/* 上方導覽列 (TopBar) */}
      <TopBar />

      {/* 滿版地圖背景 (在 TopBar 下方) */}
      <AppMap />

    </main>
  );
}
