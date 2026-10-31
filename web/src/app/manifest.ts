import type { MetadataRoute } from "next";

// Installable web app (PRD: no app-store wait, works on low-end Android).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OJAH — Every Market, One Place.",
    short_name: "OJAH",
    description: "Discover local markets, businesses and everyday services in Lagos.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f6f2",
    theme_color: "#0f7a4f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
