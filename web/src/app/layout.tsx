import type { Metadata, Viewport } from "next";
import GoatCounter from "@/components/goat-counter";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Errand Runs", template: "%s · Errand Runs" },
  description: "Tell us what needs doing in Lagos. One upfront price, a verified runner, and live progress.",
  applicationName: "Errand Runs",
};

export const viewport: Viewport = {
  themeColor: "#0f7a4f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-NG" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <GoatCounter />
        {children}
      </body>
    </html>
  );
}
