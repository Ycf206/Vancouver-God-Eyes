import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "溫哥華 · 上帝之眼 | Vancouver God's Eye",
  description: "大溫哥華全方位即時交通、公車、天車、渡輪與市政設施監控系統",
  icons: {
    icon: "/logo-mobile.jpg",
    apple: "/logo-mobile.jpg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full w-full overflow-hidden" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                function isExtensionError(event) {
                  try {
                    var msg = (event && (event.message || (event.reason && (event.reason.message || event.reason.stack || event.reason)))) || '';
                    var filename = (event && event.filename) || '';
                    var stack = (event && event.error && event.error.stack) || (event && event.reason && event.reason.stack) || '';
                    var str = (String(msg) + ' ' + String(filename) + ' ' + String(stack)).toLowerCase();
                    return str.indexOf('chrome-extension://') !== -1 ||
                           str.indexOf('moz-extension://') !== -1 ||
                           str.indexOf('ff-content.js') !== -1 ||
                           str.indexOf('chrome: call method') !== -1 ||
                           str.indexOf('extension context invalidated') !== -1 ||
                           str.indexOf('could not establish connection') !== -1;
                  } catch (e) {
                    return false;
                  }
                }
                window.addEventListener('error', function(e) {
                  if (isExtensionError(e)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return true;
                  }
                }, true);
                window.addEventListener('unhandledrejection', function(e) {
                  if (isExtensionError(e)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return true;
                  }
                }, true);
              })();
            `
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased h-full w-full overflow-hidden select-none`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
