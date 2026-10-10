import AppMap from '@/components/Map';
import Sidebar from '@/components/Sidebar';

export default function Home() {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#050505] text-white font-sans selection:bg-emerald-500/30">
      {/* 滿版地圖背景 */}
      <AppMap />

      {/* 左上角 Branding 標題 (上帝之眼) */}
      <div className="absolute top-0 left-0 z-10 p-6 pointer-events-none">
        <h1 className="text-3xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-400 drop-shadow-lg">
          VANCOUVER
        </h1>
        <h2 className="text-xl font-bold tracking-[0.3em] text-emerald-400 mt-[-4px] drop-shadow-[0_0_8px_rgba(52,211,153,0.6)]">
          GOD'S EYE
        </h2>
        <div className="flex items-center gap-2 mt-3 bg-black/40 backdrop-blur-sm border border-white/10 px-3 py-1.5 rounded-full w-fit">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <p className="text-[10px] text-gray-300 font-mono tracking-wider">SYSTEM ONLINE</p>
        </div>
      </div>

      {/* 右側儀表板控制列 */}
      <Sidebar />
    </main>
  );
}
