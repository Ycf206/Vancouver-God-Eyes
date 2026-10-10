import AppMap from '@/components/Map';

export default function Home() {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-black text-white font-sans">
      {/* Map Background */}
      <AppMap />

      {/* Overlay UI (Sidebar, Header, etc.) will go here later */}
      <div className="absolute top-0 left-0 z-10 w-full p-4 pointer-events-none">
        <h1 className="text-2xl font-bold tracking-widest text-emerald-400 drop-shadow-md">VANCOUVER GOD'S EYE</h1>
        <p className="text-sm text-gray-400">Live City Dashboard</p>
      </div>
    </main>
  );
}
