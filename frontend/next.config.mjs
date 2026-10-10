/** @type {import('next').NextConfig} */
const nextConfig = {
  // 強制轉譯這些地圖套件，避免在某些 Docker 環境下打包發生 MIME 錯誤
  transpilePackages: ['react-map-gl', 'maplibre-gl'],
};

export default nextConfig;
