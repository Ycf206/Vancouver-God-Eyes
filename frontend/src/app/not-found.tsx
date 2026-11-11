import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0d1117] text-white p-4">
      <h2 className="text-2xl font-bold mb-2">404 - 找不到頁面</h2>
      <p className="text-gray-400 mb-6">您請求的頁面或資源不存在。</p>
      <Link
        href="/"
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm transition-colors"
      >
        返回首頁
      </Link>
    </div>
  );
}
