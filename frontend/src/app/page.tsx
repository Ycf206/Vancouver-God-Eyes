import dynamic from 'next/dynamic';
import TopBar from '@/components/TopBar';
import LayerPanel from '@/components/LayerPanel';
import FlightScheduleModal from '@/components/FlightScheduleModal';

const AppMap = dynamic(() => import('@/components/Map'), { 
  ssr: false,
  loading: () => <div className="w-full h-full absolute inset-0 z-0 pt-[60px] bg-[#111] flex items-center justify-center text-gray-500 text-sm">載入地圖中...</div>
});

export default function Home() {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#161719] text-white font-sans selection:bg-emerald-500/30">
      <TopBar />
      <LayerPanel />
      <FlightScheduleModal />
      <AppMap />
    </main>
  );
}

