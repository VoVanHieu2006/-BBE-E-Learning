import type { Metadata, Viewport } from "next";
import "./globals.css";
import PageTransition from "@/components/layout/PageTransition";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "BBE E-Learning",
  description: "BBE E-Learning Club Platform — Nền tảng học tập và phát triển kỹ năng BBE",
  icons: {
    icon: "/images/logo-white.png",
    shortcut: "/images/logo-white.png",
    apple: "/images/logo-white.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/images/logo-white.png" type="image/png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-[#f8f9ff] text-[#0b1c30] min-h-screen" suppressHydrationWarning>
        <PageTransition>{children}</PageTransition>
      </body>
    </html>
  );
}
