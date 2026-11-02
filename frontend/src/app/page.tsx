'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const TopBar = dynamic(() => import('@/components/TopBar'), { ssr: false });
const LayerPanel = dynamic(() => import('@/components/LayerPanel'), { ssr: false });
const FlightScheduleModal = dynamic(() => import('@/components/FlightScheduleModal'), { ssr: false });

const AppMap = dynamic(() => import('@/components/Map'), { 
  ssr: false,
  loading: () => <div className="w-full h-full absolute inset-0 z-0 pt-[60px] bg-[#111] flex items-center justify-center text-gray-500 text-sm">載入地圖中...</div>
});

export default function Home() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <main className="fixed inset-0 w-full h-full overflow-hidden bg-[#161719] text-white font-sans selection:bg-emerald-500/30">
      {mounted && (
        <>
          <TopBar />
          <LayerPanel />
          <FlightScheduleModal />
        </>
      )}
      <AppMap />
    </main>
  );
}

