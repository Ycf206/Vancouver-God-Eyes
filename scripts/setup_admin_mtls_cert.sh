#!/usr/bin/env bash
# ==============================================================================
# Vancouver God's Eye - Admin mTLS 客戶端設備憑證生成腳本 (方案 2 專用)
# 用途：建立自簽 CA 並為當前管理設備簽發專屬客戶端證書 (.p12 / .pfx)
# ==============================================================================

set -e

CERT_DIR="./nginx/certs"
mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

echo "🔐 [1/4] 生成專用根憑證授權單位 (Root CA)..."
if [ ! -f "ca.key" ]; then
    openssl genrsa -out ca.key 4096
    openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 -out ca.crt \
        -subj "/C=CA/ST=BC/L=Vancouver/O=GodsEyeSecurity/CN=GodsEye-Admin-CA"
    echo "✅ Root CA (ca.crt, ca.key) 已生成。"
else
    echo "ℹ️ Root CA 已存在，跳過建立。"
fi

echo "🖥️ [2/4] 生成當前管理員專屬設備私鑰與憑證請求 (CSR)..."
openssl genrsa -out admin_device.key 2048
openssl req -new -key admin_device.key -out admin_device.csr \
    -subj "/C=CA/ST=BC/L=Vancouver/O=GodsEyeSecurity/CN=SuperAdmin-Device-01"

echo "✍️ [3/4] 由 Root CA 簽署管理員設備憑證 (有效期限 3 年)..."
openssl x509 -req -in admin_device.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out admin_device.crt -days 1095 -sha256

echo "📦 [4/4] 打包為瀏覽器/系統通用客戶端憑證 (.p12)..."
echo "請為您的客戶端憑證設定匯入密碼 (匯入 Windows/Mac/iOS 瀏覽器時需輸入)："
openssl pkcs12 -export -out admin_device.p12 -inkey admin_device.key -in admin_device.crt -certfile ca.crt

echo ""
echo "🎉 憑證生成完成！"
echo "====================================================================="
echo "1. 伺服器端配置："
echo "   已生成 $CERT_DIR/ca.crt，請掛載至 Nginx 容器 /etc/nginx/certs/ca.crt"
echo ""
echo "2. 當前設備安裝："
echo "   請將 $CERT_DIR/admin_device.p12 傳至您要登入後台的電腦，雙擊點擊安裝至："
echo "   - Windows: 憑證存儲區 ->「個人 (Personal)」"
echo "   - Mac: 鑰匙圈存取 (Keychain Access) ->「登入 (Login)」"
echo "   安裝完成後，使用 Chrome/Edge 瀏覽器打開 https://admin.vangodseye.fyi"
echo "   瀏覽器會跳出「選取憑證」視窗，選取此憑證即可直接連入！"
echo "   其他未安裝此憑證的設備將直接被 Nginx/TLS 拒絕連線 (400 Bad Request)！"
echo "====================================================================="
