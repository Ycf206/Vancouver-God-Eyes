import dynamic from 'next/dynamic';
import TopBar from '@/components/TopBar';

// 使用 next/dynamic 完全停用 SSR，強制地圖只在 Browser 端載入與解析
const AppMap = dynamic(() => import('@/components/Map'), { 
  ssr: false,
  loading: () => <div className="w-full h-full absolute inset-0 z-0 pt-[60px] bg-[#111] flex items-center justify-center text-gray-500 text-sm">載入地圖中...</div>
});

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
