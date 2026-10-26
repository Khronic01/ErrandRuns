type GoatCounterEvent = {
  path: string;
  title: string;
};

declare global {
  interface Window {
    goatcounter?: {
      count: (options: { path: string; title: string; event: true }) => void;
    };
  }
}

const pendingEvents: GoatCounterEvent[] = [];

export function trackGoatCounterEvent(path: string, title: string) {
  if (typeof window === "undefined") return;

  const goatcounter = window.goatcounter;
  if (!goatcounter?.count) {
    pendingEvents.push({ path, title });
    return;
  }

  try {
    goatcounter.count({ path, title, event: true });
  } catch {
    // Analytics must never interrupt an order or WhatsApp handoff.
  }
}

export function flushGoatCounterEvents() {
  if (typeof window === "undefined" || !window.goatcounter?.count) return;

  while (pendingEvents.length > 0) {
    const event = pendingEvents.shift();
    if (!event) continue;
    try {
      window.goatcounter.count({ ...event, event: true });
    } catch {
      // Analytics must never interrupt an order or WhatsApp handoff.
    }
  }
}
