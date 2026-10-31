import type { Metadata, Viewport } from "next";
import Script from "next/script";
import BrandLoader from "@/components/brand-loader";
import GoatCounter from "@/components/goat-counter";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OJAH — Every Market, One Place.", template: "%s · OJAH" },
  description: "OJAH — Every Market, One Place. Discover local markets, businesses and everyday services in Lagos.",
  applicationName: "OJAH",
};

export const viewport: Viewport = {
  themeColor: "#0f3d2e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-NG" className="h-full antialiased">
      <head>
        <Script id="brand-loader" strategy="beforeInteractive">
          {`document.addEventListener("DOMContentLoaded",function(){var loader=document.querySelector(".startup-loader");if(!loader)return;loader.style.display="grid";window.addEventListener("load",function(){loader.style.display="none";},{once:true});},{once:true});`}
        </Script>
      </head>
      <body className="min-h-full flex flex-col">
        <BrandLoader className="startup-loader" />
        <GoatCounter />
        {children}
      </body>
    </html>
  );
}
