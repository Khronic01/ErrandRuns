"use client";

import Script from "next/script";
import { flushGoatCounterEvents } from "@/lib/analytics";

export default function GoatCounter() {
  return (
    <Script
      src="https://gc.zgo.at/count.js"
      data-goatcounter="https://errandruns.goatcounter.com/count"
      strategy="afterInteractive"
      onReady={flushGoatCounterEvents}
    />
  );
}
