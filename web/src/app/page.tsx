"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { trackGoatCounterEvent } from "@/lib/analytics";

const RUN_TASKS = [
  "Buy & bring",
  "Pick up",
  "Drop & submit",
  "Queue for me",
  "Send a parcel",
];

const FAQS = [
  {
    q: "How much does an errand cost?",
    a: "Every errand is priced on its own, based on distance, what the task involves, the number of stops and the size of what we carry. Send your order and we reply with one price before anything starts.",
  },
  {
    q: "How do I pay?",
    a: "Once you're happy with the price, we send payment details in the chat. The runner sets off after payment. For Buy & bring, the item budget is paid at the same time, and any change is returned to you.",
  },
  {
    q: "What if an item isn't available?",
    a: "The runner messages you before buying anything different. You choose a replacement or skip it. We never swap items without asking.",
  },
  {
    q: "Can I cancel?",
    a: "Yes. Cancelling before the runner sets off is free. After that, you pay for the trip already made and for any items already bought.",
  },
  {
    q: "Is there a limit on what you'll carry?",
    a: "We carry items worth up to ₦100,000 per errand, on a bike or on foot, so nothing bigger than a medium box. See the list above for what we won't carry at all.",
  },
  {
    q: "Can I order for someone else?",
    a: "Yes, including from outside Nigeria. Tick “Someone else will receive it” on the form and add their name and number. We keep both of you updated.",
  },
];

const TYPE_OPTIONS = [
  "Buy & bring",
  "Pick up",
  "Drop & submit",
  "Queue for me",
  "Send a parcel",
  "Something else",
] as const;

type OrderType = (typeof TYPE_OPTIONS)[number];

const ORDER_COPY: Record<
  OrderType,
  { from: [string, string]; to?: string; details: [string, string]; budget: boolean; needsTo: boolean }
> = {
  "Buy & bring": {
    from: ["Where to buy from", "e.g. Shoprite, Ozone Mall, Yaba"],
    to: "Deliver to",
    details: ["Your shopping list", "e.g. Peak milk 3-pack, 2 loaves of bread. If something isn't available, call me."],
    budget: true,
    needsTo: true,
  },
  "Pick up": {
    from: ["Pick up from", "e.g. Mr Clean dry cleaners, Bode Thomas"],
    to: "Deliver to",
    details: ["What are we picking up?", "e.g. 3 shirts, ticket number 4471. Ask for Musa."],
    budget: false,
    needsTo: true,
  },
  "Drop & submit": {
    from: ["Collect the documents from", "Your address"],
    to: "Submit at",
    details: ["What should we submit, and to whom?", "e.g. Signed form to the front desk, ask for a stamped copy."],
    budget: false,
    needsTo: true,
  },
  "Queue for me": {
    from: ["Where's the queue?", "e.g. GTBank, Herbert Macaulay Way"],
    details: ["What are we queueing for?", "e.g. Collect my new ATM card. Wait up to 90 minutes."],
    budget: false,
    needsTo: false,
  },
  "Send a parcel": {
    from: ["Pick up from", "Sender's address"],
    to: "Deliver to",
    details: ["What are we sending?", "e.g. Small bag of clothes, about 2kg. Handle with care."],
    budget: false,
    needsTo: true,
  },
  "Something else": {
    from: ["Where do we start?", "Address and area"],
    to: "Where does it end?",
    details: ["Describe the errand", "Up to three stops. Tell us everything the runner needs to know."],
    budget: true,
    needsTo: false,
  },
};

const EMPTY_FORM = {
  from: "",
  fromLandmark: "",
  to: "",
  toLandmark: "",
  details: "",
  budget: "",
  time: "",
  name: "",
  rName: "",
  rPhone: "",
};

type LocationField = "from" | "to";
type MapPin = { lat: number; lng: number };

function createOrderRef() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(new Date());
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `ER-${day}${month}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function mapPinUrl(pin: MapPin) {
  return `https://maps.google.com/?q=${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}`;
}

function getRoutePosition(progress: number) {
  const points = [
    [58, 214],
    [142, 214],
    [142, 132],
    [246, 132],
    [246, 58],
    [300, 58],
  ] as const;
  const segmentLengths = [84, 82, 104, 74, 54];
  const distance = progress * segmentLengths.reduce((total, length) => total + length, 0);
  let remaining = distance;

  for (let index = 0; index < segmentLengths.length; index += 1) {
    const length = segmentLengths[index];
    if (remaining <= length) {
      const ratio = remaining / length;
      const [startX, startY] = points[index];
      const [endX, endY] = points[index + 1];
      return { x: startX + (endX - startX) * ratio, y: startY + (endY - startY) * ratio };
    }
    remaining -= length;
  }

  return { x: 300, y: 58 };
}

function buildWhatsAppText({
  type,
  form,
  when,
  someoneElse,
  orderRef,
  pins,
}: {
  type: OrderType;
  form: typeof EMPTY_FORM;
  when: string;
  someoneElse: boolean;
  orderRef: string;
  pins: Record<LocationField, MapPin | null>;
}) {
  const copy = ORDER_COPY[type];
  const lines = ["Hello Errand Runs, I'd like to order an errand.", "", `*Order:* ${orderRef}`];
  lines.push(`*Errand:* ${type}`);
  lines.push(`*${copy.from[0].replace(/\?$/, "")}:* ${form.from || "…"}${form.fromLandmark ? ` (landmark: ${form.fromLandmark})` : ""}`);
  if (pins.from) lines.push(`Map pin: ${mapPinUrl(pins.from)}`);
  if (copy.to && (copy.needsTo || form.to)) {
    lines.push(`*${copy.to.replace(/\?$/, "")}:* ${form.to || "…"}${form.toLandmark ? ` (landmark: ${form.toLandmark})` : ""}`);
    if (pins.to) lines.push(`Map pin: ${mapPinUrl(pins.to)}`);
  }
  lines.push(`*Details:* ${form.details || "…"}`);
  if (copy.budget && form.budget) {
    const n = Number(form.budget.replace(/[^\d]/g, ""));
    if (n) lines.push(`*Budget for items:* ₦${n.toLocaleString("en-NG")}`);
  }
  let whenValue = when;
  if (when === "Later today" && form.time) whenValue += `, around ${form.time}`;
  lines.push(`*When:* ${whenValue}`);
  lines.push(`*My name:* ${form.name || "…"}`);
  if (someoneElse) {
    lines.push(`*Recipient:* ${form.rName || "…"}${form.rPhone ? `, ${form.rPhone}` : ""}`);
  }
  return lines.join("\n");
}

export default function Home() {
  const [type, setType] = useState<OrderType>("Buy & bring");
  const [form, setForm] = useState(EMPTY_FORM);
  const [when, setWhen] = useState("As soon as possible");
  const [someoneElse, setSomeoneElse] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [routeStep, setRouteStep] = useState(0);
  const [pins, setPins] = useState<Record<LocationField, MapPin | null>>({ from: null, to: null });
  const [busyLocation, setBusyLocation] = useState<LocationField | null>(null);
  const [locationError, setLocationError] = useState("");
  const [supportsLocation, setSupportsLocation] = useState(true);
  const [orderRef, setOrderRef] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sentText, setSentText] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");
  const [memoryNotice, setMemoryNotice] = useState("");
  const [businessStatus, setBusinessStatus] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [fabVisible, setFabVisible] = useState(false);
  const sentDialog = useRef<HTMLDialogElement>(null);
  const fromInput = useRef<HTMLInputElement>(null);

  const copy = ORDER_COPY[type];
  const trackWhatsappChat = () => trackGoatCounterEvent("whatsapp-chat", "Tapped Chat on WhatsApp");
  const routeProgress = [0, 0, 0, 0.42, 1, 1][routeStep];
  const riderPosition = getRoutePosition(routeProgress);
  const previewText = useMemo(
    () => buildWhatsAppText({ type, form, when, someoneElse, orderRef, pins }),
    [type, form, when, someoneElse, orderRef, pins],
  );

  useEffect(() => {
    setOrderRef(createOrderRef());
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    const dialog = sentDialog.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, [dialogOpen]);

  useEffect(() => {
    const updateStatus = () => {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Lagos",
        weekday: "short",
        hour: "numeric",
        hour12: false,
      }).formatToParts(new Date());
      const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
      const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
      const open = weekday !== "Sun" && hour >= 8 && hour < 20;
      let status = "Open now. We usually reply within minutes.";
      if (!open && (weekday === "Sat" && hour >= 20 || weekday === "Sun")) {
        status = "Closed now. Orders sent now are handled from 8am Monday.";
      } else if (!open && hour < 8) {
        status = "Closed now. Orders sent now are handled from 8am today.";
      } else if (!open) {
        status = "Closed now. Orders sent now are handled from 8am tomorrow.";
      }
      setIsOpen(open);
      setBusinessStatus(status);
    };
    updateStatus();
    const interval = window.setInterval(updateStatus, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setSupportsLocation("geolocation" in navigator);
    const hero = document.querySelector(".hero");
    if (!hero || !("IntersectionObserver" in window)) {
      setFabVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setFabVisible(!entry.isIntersecting);
    });
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;
    let observer: IntersectionObserver | undefined;

    const startAnimation = () => {
      window.clearTimeout(timer);
      if (reducedMotion.matches) {
        setRouteStep(5);
        return;
      }
      setRouteStep(0);
      let nextStep = 0;
      const tick = () => {
        nextStep = nextStep >= 5 ? 0 : nextStep + 1;
        setRouteStep(nextStep);
        timer = window.setTimeout(tick, nextStep === 5 ? 3200 : nextStep === 0 ? 900 : 1800);
      };
      timer = window.setTimeout(tick, 900);
    };
    const stopAnimation = () => window.clearTimeout(timer);
    const runCard = document.querySelector(".run");

    if (runCard && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) startAnimation();
        else stopAnimation();
      }, { threshold: 0.3 });
      observer.observe(runCard);
    } else {
      startAnimation();
    }
    reducedMotion.addEventListener("change", startAnimation);
    return () => {
      stopAnimation();
      observer?.disconnect();
      reducedMotion.removeEventListener("change", startAnimation);
    };
  }, []);

  const handleChange = (field: keyof typeof EMPTY_FORM, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: false }));
    if (field === "from" || field === "to") {
      setPins((current) => ({ ...current, [field]: null }));
    }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem("errandruns.me");
      if (!saved) return;
      const parsed: unknown = JSON.parse(saved);
      if (!parsed || typeof parsed !== "object") return;
      const customer = parsed as { name?: unknown; to?: unknown; toLandmark?: unknown };
      if (typeof customer.name !== "string" || !customer.name) return;
      const savedName = customer.name;
      setForm((current) => ({
        ...current,
        name: savedName,
        to: typeof customer.to === "string" ? customer.to : current.to,
        toLandmark: typeof customer.toLandmark === "string" ? customer.toLandmark : current.toLandmark,
      }));
      setMemoryNotice("We filled in your name and delivery address from last time.");
    } catch {
      setMemoryNotice("We couldn't read saved details from this browser. You can enter them again.");
    }
  }, []);

  const requestLocation = (field: LocationField) => {
    if (!navigator.geolocation) {
      setLocationError("Location isn't available in this browser. Type the address instead.");
      return;
    }
    setBusyLocation(field);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const pin = { lat: coords.latitude, lng: coords.longitude };
        setPins((current) => ({ ...current, [field]: pin }));
        if (!form[field]) {
          setForm((current) => ({ ...current, [field]: "My current location (see map pin)" }));
        }
        setErrors((current) => ({ ...current, [field]: false }));
        setBusyLocation(null);
      },
      (error) => {
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Location access is turned off for this site. Type the address instead."
            : "Couldn't find your location. Type the address instead.",
        );
        setBusyLocation(null);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  };

  const validate = () => {
    const nextErrors: Record<string, boolean> = {};
    const requiredFields: string[] = ["from", "details", "name"];
    if (copy.to && copy.needsTo) requiredFields.push("to");
    if (someoneElse) {
      requiredFields.push("rName", "rPhone");
    }

    for (const field of requiredFields) {
      const value = form[field as keyof typeof EMPTY_FORM].trim();
      if (!value) nextErrors[field] = true;
      if (field === "rPhone" && value && value.replace(/\D/g, "").length < 10) {
        nextErrors.rPhone = true;
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submitOrder = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;
    const reference = orderRef || createOrderRef();
    const orderMessage = buildWhatsAppText({ type, form, when, someoneElse, orderRef: reference, pins });
    setOrderRef(reference);
    setSentText(orderMessage);
    setCopyFeedback("");
    trackGoatCounterEvent(
      `order-sent/${type.toLowerCase().replace(/[^a-z]+/g, "-")}`,
      `Sent order: ${type}`,
    );
    window.open(`https://wa.me/2348140694034?text=${encodeURIComponent(orderMessage)}`, "_blank", "noopener,noreferrer");
    try {
      localStorage.setItem(
        "errandruns.me",
        JSON.stringify({
          name: form.name,
          to: copy.to ? form.to : "",
          toLandmark: copy.to ? form.toLandmark : "",
        }),
      );
      setMemoryNotice("Your name and delivery address are saved on this browser for next time.");
    } catch {
      setMemoryNotice("Your order is ready, but this browser couldn't save your details.");
    }
    setDialogOpen(true);
  };

  const copyOrderMessage = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(sentText);
        setCopyFeedback("Copied. Paste it into WhatsApp.");
        return;
      }
    } catch {
      // Continue with the browser fallback below.
    }

    const textarea = document.createElement("textarea");
    textarea.value = sentText;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    setCopyFeedback(copied ? "Copied. Paste it into WhatsApp." : "Couldn't copy the message. Please select and copy it from the preview.");
  };

  const clearRememberedDetails = () => {
    try {
      localStorage.removeItem("errandruns.me");
      setMemoryNotice("Saved details cleared from this browser.");
    } catch {
      setMemoryNotice("Couldn't clear saved details from this browser.");
    }
    setForm((current) => ({ ...current, name: "", to: "", toLandmark: "" }));
  };

  const startNewOrder = () => {
    sentDialog.current?.close();
    setDialogOpen(false);
    setForm((current) => ({
      ...current,
      from: "",
      fromLandmark: "",
      details: "",
      budget: "",
      time: "",
      rName: "",
      rPhone: "",
    }));
    setWhen("As soon as possible");
    setSomeoneElse(false);
    setErrors({});
    setPins({ from: null, to: null });
    setLocationError("");
    setOrderRef(createOrderRef());
    fromInput.current?.focus();
  };

  return (
    <div>
      <header className="top">
        <div className="wrap nav">
          <a className="mark" href="#top" aria-label="Errand Runs home">
            <span className="mark-dot" aria-hidden="true" />
            Errand Runs
          </a>
          <a className="btn btn-ink" href="#order">
            Order an errand
          </a>
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="wrap hero-grid">
            <div>
              <h1 id="hero-title" className="lettering">
                Skip the traffic. We&apos;ll run it.
              </h1>
              <p className="lede">
                Groceries, pickups, queues and parcels across Lagos Mainland. Tell us what needs doing, agree the price on WhatsApp, and a verified runner gets it done while you get on with your day.
              </p>
              <div className="hero-actions">
                <a className="btn btn-ink" href="#order">
                  Order an errand
                </a>
                <a className="btn btn-line wa-direct" href="https://wa.me/2348140694034?text=Hello%20Errand%20Runs%2C%20I%27d%20like%20to%20ask%20about%20an%20errand." target="_blank" rel="noreferrer noopener" onClick={trackWhatsappChat}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <use href="#wa-icon" />
                  </svg>
                  Chat on WhatsApp
                </a>
              </div>
              <p className="areas-line">
                <span className={`status ${isOpen ? "open" : "closed"}`} aria-live="polite">{businessStatus}</span>
                Now running in Yaba, Surulere, Ebute Metta and Ikeja GRA.
              </p>
            </div>

            <figure className="run" aria-label="An example errand moving from a store in Yaba to a home in Surulere" style={{ margin: 0 }}>
              <div className="run-head">
                <b>Buy &amp; bring</b>
                <span>Yaba to Surulere</span>
              </div>
              <div className="map">
                <svg viewBox="0 0 360 260" role="presentation">
                  <g>
                    <path className="road-edge" d="M0 214 H360 M142 0 V260 M0 132 H360 M246 0 V260 M0 58 H360 M60 0 V132" />
                    <path className="road" d="M0 214 H360 M142 0 V260 M0 132 H360 M246 0 V260 M0 58 H360 M60 0 V132" />
                  </g>
                  <rect x="160" y="150" width="70" height="46" rx="6" fill="#dde3e9" />
                  <rect x="268" y="150" width="70" height="46" rx="6" fill="#dde3e9" />
                  <rect x="160" y="76" width="70" height="38" rx="6" fill="#dde3e9" />
                  <rect x="78" y="76" width="46" height="38" rx="6" fill="#d3ead9" />
                  <rect x="16" y="150" width="108" height="46" rx="6" fill="#dde3e9" />
                  <path
                    className="route"
                    d="M58 214 H142 V132 H246 V58 H300"
                    style={{
                      strokeDasharray: 398,
                      strokeDashoffset: 398 - routeProgress * 398,
                    }}
                  />
                  <g className="pin">
                    <circle cx="58" cy="214" r="11" fill="#1a1d24" />
                    <path d="M53 210 h10 l-1.5 8 h-7 z" fill="#ffc72c" />
                    <text x="58" y="244" textAnchor="middle">
                      Supermarket
                    </text>
                  </g>
                  <g className="pin">
                    <circle cx="300" cy="58" r="11" fill="#1a1d24" />
                    <path d="M294 59 l6 -6 l6 6 v6 h-12 z" fill="#ffc72c" />
                    <text x="300" y="32" textAnchor="middle">
                      Your door
                    </text>
                  </g>
                  <g
                    className="rider"
                    aria-hidden="true"
                    style={{
                      opacity: routeStep >= 2 && routeStep <= 4 ? 1 : 0,
                      transform: `translate(${riderPosition.x - 58}px, ${riderPosition.y - 214}px)`,
                    }}
                  >
                    <circle r="13" fill="#ffc72c" stroke="#1a1d24" strokeWidth="3" />
                    <circle r="4" fill="#1a1d24" />
                  </g>
                  <g className="done-badge" style={{ opacity: routeStep === 5 ? 1 : 0 }}>
                    <circle cx="300" cy="58" r="17" fill="#0b7a55" />
                    <path d="M292 58 l6 6 l11 -12" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                </svg>
              </div>
              <ol className="steps" id="steps">
                {["Order sent on WhatsApp", "Price agreed, runner assigned", "Runner at the supermarket", "Bought, receipt photo sent to you", "Delivered to your door"].map((item, index) => (
                  <li
                    key={item}
                    className={[
                      routeStep >= index ? "on" : "",
                      routeStep === index + 1 && routeStep < 5 ? "now" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {item}
                  </li>
                ))}
              </ol>
            </figure>
          </div>
        </section>

        <div className="stripes" aria-hidden="true" />

        <section aria-labelledby="what-title">
          <div className="wrap split">
            <div>
              <h2 id="what-title" className="lettering">
                What a runner can do for you
              </h2>
              <p className="lede">If it&apos;s a small physical task that eats half your day, send it to us. You get photo proof at each step.</p>
            </div>
            <ul className="tasks">
              <li>
                <b>Buy &amp; bring</b>
                <p>
                  Groceries, market items, pharmacy runs. <span className="eg">Send your list and budget; you get the receipt photo.</span>
                </p>
              </li>
              <li>
                <b>Pick up</b>
                <p>
                  Dry cleaning, a parcel at the park, items from a shop. <span className="eg">Give us the ticket number or contact at pickup.</span>
                </p>
              </li>
              <li>
                <b>Drop &amp; submit</b>
                <p>
                  Documents and forms delivered to an office. <span className="eg">We send back a stamped copy or photo.</span>
                </p>
              </li>
              <li>
                <b>Queue for me</b>
                <p>
                  Banks, offices, anywhere with a line. <span className="eg">Timestamped photos while we wait.</span>
                </p>
              </li>
              <li>
                <b>Send a parcel</b>
                <p>
                  You have the item; we move it from A to B the same day. <span className="eg">Photo at handover to the recipient.</span>
                </p>
              </li>
              <li>
                <b>Something else</b>
                <p>
                  Up to three stops in one run. <span className="eg">Describe it and we&apos;ll tell you if we can do it.</span>
                </p>
              </li>
            </ul>
          </div>
        </section>

        <section className="how" aria-labelledby="how-title">
          <div className="wrap">
            <h2 id="how-title" className="lettering">
              How ordering works
            </h2>
            <ol className="how-list">
              <li>
                <h3>Fill the short form</h3>
                <p>Pick the errand, where it starts and ends, and the details. It takes about a minute.</p>
              </li>
              <li>
                <h3>Send it on WhatsApp</h3>
                <p>Your order opens in WhatsApp, already written. We reply with the price before anyone moves.</p>
              </li>
              <li>
                <h3>We run it</h3>
                <p>A verified runner does the job and you get updates and photos on WhatsApp until it&apos;s done.</p>
              </li>
            </ol>
            <div className="pricing">
              <h3 className="lettering">Every errand is priced on its own</h3>
              <div>
                <p>
                  There&apos;s no price list to guess from. Tell us the errand and we send you one price for the whole job before the runner moves. It depends on:
                </p>
                <ul className="factors">
                  <li>How far apart the stops are</li>
                  <li>What the task involves: buying, collecting, queueing or waiting</li>
                  <li>How many stops there are</li>
                  <li>The size of what we&apos;re carrying</li>
                </ul>
                <p className="note">
                  For Buy &amp; bring, you pay for the items on top of the errand price. Tell us your budget and you&apos;ll get a photo of the receipt.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="order" id="order" aria-labelledby="order-title">
          <div className="wrap">
            <h2 id="order-title" className="lettering">
              Order an errand
            </h2>
            <p className="lede">Fill this in and tap the button. WhatsApp opens with your order ready to send to us.</p>

            <div className="order-grid">
              <form id="orderForm" noValidate onSubmit={submitOrder}>
                <fieldset>
                  <legend>What do you need?</legend>
                  <div className="types" id="types">
                    {TYPE_OPTIONS.map((option) => (
                      <label key={option} htmlFor={`t-${option.replace(/\s+/g, "-").toLowerCase()}`} className={type === option ? "selected" : ""}>
                        <input
                          type="radio"
                          name="type"
                          id={`t-${option.replace(/\s+/g, "-").toLowerCase()}`}
                          value={option}
                          checked={type === option}
                          onChange={() => setType(option)}
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="row2">
                  <div className={errors.from ? "invalid" : ""} data-field>
                    <label className="f" htmlFor="from" id="fromLabel">
                      {copy.from[0]}
                    </label>
                    <input
                      className="t"
                      id="from"
                      value={form.from}
                      onChange={(event) => handleChange("from", event.target.value)}
                      autoComplete="off"
                      placeholder={copy.from[1]}
                      required
                      ref={fromInput}
                    />
                    <p className="field-error">Tell us where the runner should start.</p>
                    {supportsLocation ? (
                      <button
                        type="button"
                        className="loc"
                        onClick={() => requestLocation("from")}
                        aria-busy={busyLocation === "from"}
                        disabled={busyLocation !== null}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <circle cx="12" cy="9" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
                        </svg>
                        <span>{busyLocation === "from" ? "Finding you…" : pins.from ? "Location added. Add a landmark to help the runner." : "Use my current location"}</span>
                      </button>
                    ) : null}
                  </div>
                  <div>
                    <label className="f" htmlFor="fromLandmark">
                      Landmark <span className="hint">(optional)</span>
                    </label>
                    <input
                      className="t"
                      id="fromLandmark"
                      value={form.fromLandmark}
                      onChange={(event) => handleChange("fromLandmark", event.target.value)}
                      autoComplete="off"
                      placeholder="e.g. opposite the bank"
                    />
                  </div>
                </div>

                {copy.to ? (
                  <div className={copy.to ? "reveal open" : "reveal"} id="toBlock">
                    <div>
                      <div className="row2">
                        <div className={errors.to ? "invalid" : ""} data-field>
                          <label className="f" htmlFor="to" id="toLabel">
                            {copy.to}
                          </label>
                          <input
                            className="t"
                            id="to"
                            value={form.to}
                            onChange={(event) => handleChange("to", event.target.value)}
                            autoComplete="street-address"
                            placeholder="Street address and area"
                            required={copy.needsTo}
                          />
                          <p className="field-error">Tell us where it should end up.</p>
                          {supportsLocation ? (
                            <button
                              type="button"
                              className="loc"
                              onClick={() => requestLocation("to")}
                              aria-busy={busyLocation === "to"}
                              disabled={busyLocation !== null}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                <circle cx="12" cy="9" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
                              </svg>
                              <span>{busyLocation === "to" ? "Finding you…" : pins.to ? "Location added. Add a landmark to help the runner." : "Use my current location"}</span>
                            </button>
                          ) : null}
                        </div>
                        <div>
                          <label className="f" htmlFor="toLandmark">
                            Landmark <span className="hint">(optional)</span>
                          </label>
                          <input
                            className="t"
                            id="toLandmark"
                            value={form.toLandmark}
                            onChange={(event) => handleChange("toLandmark", event.target.value)}
                            autoComplete="off"
                            placeholder="e.g. blue gate, beside the pharmacy"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className={errors.details ? "invalid" : ""} data-field>
                  <label className="f" htmlFor="details" id="detailsLabel">
                    {copy.details[0]}
                  </label>
                  <textarea
                    id="details"
                    value={form.details}
                    onChange={(event) => handleChange("details", event.target.value)}
                    placeholder={copy.details[1]}
                    required
                  />
                  <p className="field-error">Add a few words so the runner knows exactly what to do.</p>
                </div>

                {copy.budget ? (
                  <div className="reveal open" id="budgetBlock">
                    <div>
                      <label className="f" htmlFor="budget">
                        Budget for the items <span className="hint">(₦, optional)</span>
                      </label>
                      <input
                        className="t"
                        id="budget"
                        value={form.budget}
                        onChange={(event) => handleChange("budget", event.target.value)}
                        inputMode="numeric"
                        placeholder="e.g. 15000"
                      />
                    </div>
                  </div>
                ) : null}

                {locationError ? <p className="location-error" role="status">{locationError}</p> : null}

                <div className="row2">
                  <div>
                    <label className="f" htmlFor="when">
                      When
                    </label>
                    <select id="when" value={when} onChange={(event) => setWhen(event.target.value)}>
                      <option>As soon as possible</option>
                      <option>Later today</option>
                    </select>
                  </div>
                  {when === "Later today" ? (
                    <div className="reveal open" id="timeBlock">
                      <div>
                        <label className="f" htmlFor="time">
                          What time?
                        </label>
                        <input
                          className="t"
                          id="time"
                          value={form.time ?? ""}
                          onChange={(event) => handleChange("time", event.target.value)}
                          type="time"
                          min="08:00"
                          max="20:00"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                {memoryNotice ? (
                  <p className="remembered" aria-live="polite">
                    {memoryNotice}
                    {memoryNotice.startsWith("We filled") || memoryNotice.startsWith("Your name and delivery address") ? (
                      <> <button type="button" onClick={clearRememberedDetails}>Clear them</button></>
                    ) : null}
                  </p>
                ) : null}
                <div className={errors.name ? "invalid" : ""} data-field>
                  <label className="f" htmlFor="name">
                    Your name
                  </label>
                  <input
                    className="t"
                    id="name"
                    value={form.name}
                    onChange={(event) => handleChange("name", event.target.value)}
                    autoComplete="name"
                    placeholder="So we know who we're talking to"
                    required
                  />
                  <p className="field-error">Add your name.</p>
                </div>

                <label className="check">
                  <input type="checkbox" checked={someoneElse} onChange={() => setSomeoneElse((current) => !current)} />
                  Someone else will receive it
                </label>

                {someoneElse ? (
                  <div className="reveal open" id="recipientBlock">
                    <div className="row2">
                      <div className={errors.rName ? "invalid" : ""} data-field>
                        <label className="f" htmlFor="rName">
                          Their name
                        </label>
                        <input
                          className="t"
                          id="rName"
                          value={form.rName}
                          onChange={(event) => handleChange("rName", event.target.value)}
                          autoComplete="off"
                        />
                        <p className="field-error">Add the recipient&apos;s name.</p>
                      </div>
                      <div className={errors.rPhone ? "invalid" : ""} data-field>
                        <label className="f" htmlFor="rPhone">
                          Their phone number
                        </label>
                        <input
                          className="t"
                          id="rPhone"
                          value={form.rPhone}
                          onChange={(event) => handleChange("rPhone", event.target.value)}
                          type="tel"
                          inputMode="tel"
                          autoComplete="off"
                          placeholder="080..."
                        />
                        <p className="field-error">Add a phone number we can reach them on.</p>
                      </div>
                    </div>
                  </div>
                ) : null}

                <button className="btn btn-wa" type="submit">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <use href="#wa-icon" />
                  </svg>
                  Send order on WhatsApp
                </button>
                <p className="small">
                  <span className={`status ${isOpen ? "open" : "closed"}`} aria-live="polite">{businessStatus}</span>
                  We reply with the price before anything starts. Open 8am to 8pm, Monday to Saturday.
                </p>
              </form>

              <aside className="preview" aria-labelledby="preview-title">
                <h3 id="preview-title">Your message will look like this</h3>
                <div className="chat">
                  <div className="chat-top">
                    <div className="av" aria-hidden="true">
                      ER
                    </div>
                    <div>
                      <b>Errand Runs</b>
                      <span>0814 069 4034</span>
                    </div>
                  </div>
                  <div className="bubble" aria-live="polite">
                    {previewText.split(/(\*[^*\n]+\*)/).map((part, index) => {
                      if (/^\*[^*\n]+\*$/.test(part)) {
                        return <b key={`${part}-${index}`}>{part.slice(1, -1)}</b>;
                      }
                      return <span key={`${part}-${index}`}>{part}</span>;
                    })}
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>

        <section aria-labelledby="trust-title">
          <div className="wrap">
            <h2 id="trust-title" className="lettering">
              Built so nothing goes missing
            </h2>
            <dl className="promises">
              <div>
                <dt>Verified runners</dt>
                <dd>Every runner shows ID, has a guarantor we&apos;ve spoken to, and does a trial run with us before taking jobs.</dd>
              </div>
              <div>
                <dt>Price agreed first</dt>
                <dd>No haggling at the door. We tell you the price on WhatsApp before the runner moves.</dd>
              </div>
              <div>
                <dt>Photo proof</dt>
                <dd>Receipts, pickups and handovers are photographed and sent to you as they happen.</dd>
              </div>
              <div>
                <dt>Someone to call</dt>
                <dd>One WhatsApp number for the whole job. If anything changes, like an item out of stock, we ask you first.</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="how" aria-labelledby="areas-title">
          <div className="wrap split">
            <div>
              <h2 id="areas-title" className="lettering">
                Where we run
              </h2>
              <p className="lede">We&apos;re starting small so every job is done properly. More of Lagos is coming.</p>
            </div>
            <div>
              <ul className="zones">
                <li>Yaba</li>
                <li>Surulere</li>
                <li>Ebute Metta</li>
                <li>Ikeja GRA</li>
              </ul>
              <p>
                Outside these areas? <a className="wa-direct" href="https://wa.me/2348140694034?text=Hello%20Errand%20Runs%2C%20I%27d%20like%20to%20ask%20if%20you%20cover%20my%20area." target="_blank" rel="noreferrer noopener" onClick={trackWhatsappChat}>Message us on WhatsApp</a> and we&apos;ll tell you when we reach you.
              </p>
              <div className="nogo">
                <b>What we won&apos;t carry</b>
                <p>Weapons, drugs, cash deliveries, live animals, anything hazardous or illegal, and controlled medicines without a valid prescription.</p>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="faq-title">
          <div className="wrap split">
            <div>
              <h2 id="faq-title" className="lettering">
                Questions people ask
              </h2>
              <p className="lede">
                Anything else, <a className="wa-direct" href="https://wa.me/2348140694034?text=Hello%20Errand%20Runs%2C%20I%27d%20like%20to%20ask%20about%20an%20errand." target="_blank" rel="noreferrer noopener" onClick={trackWhatsappChat}>ask us on WhatsApp</a>.
              </p>
            </div>
            <div className="faq">
              {FAQS.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="runners" aria-labelledby="runners-title">
          <div className="wrap split">
            <div>
              <h2 id="runners-title" className="lettering">
                Run errands with us
              </h2>
              <p className="lede">Have a bike, or know your way around on foot? Earn per errand, and know what you&apos;ll make before you accept a job.</p>
            </div>
            <div>
              <ul className="needs">
                <li>A smartphone with WhatsApp</li>
                <li>A valid ID, such as your NIN slip</li>
                <li>One guarantor we can call</li>
                <li>A short onboarding session and a trial errand</li>
              </ul>
              <a
                className="btn btn-danfo"
                href="https://wa.me/2348140694034?text=Hello%20Errand%20Runs%2C%20I%27d%20like%20to%20become%20a%20runner.%0A%0A*My%20name:*%20%0A*Area%20I%20live%20in:*%20%0A*I%20run%20on:*%20bike%20/%20foot"
                target="_blank"
                rel="noreferrer noopener"
                onClick={() => trackGoatCounterEvent("runner-apply", "Tapped Apply on WhatsApp (runner)")}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <use href="#wa-icon" />
                </svg>
                Apply on WhatsApp
              </a>
            </div>
          </div>
        </section>
      </main>

      <div className="stripes" aria-hidden="true" />
      <footer>
        <div className="wrap foot">
          <div>
            <a className="mark" href="#top">
              <span className="mark-dot" aria-hidden="true" />
              Errand Runs
            </a>
            <p>Errands and deliveries in Lagos. Open 8am to 8pm, Monday to Saturday.</p>
          </div>
          <a className="btn btn-ink wa-direct" href="https://wa.me/2348140694034?text=Hello%20Errand%20Runs%2C%20I%27d%20like%20to%20ask%20about%20an%20errand." target="_blank" rel="noreferrer noopener" onClick={trackWhatsappChat}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <use href="#wa-icon" />
            </svg>
            0814 069 4034
          </a>
        </div>
      </footer>

      <dialog
        className="sent"
        ref={sentDialog}
        aria-labelledby="sent-title"
        onClose={() => setDialogOpen(false)}
        onClick={(event) => {
          if (event.target === sentDialog.current) sentDialog.current?.close();
        }}
      >
        <svg className="tick" viewBox="0 0 52 52" aria-hidden="true">
          <circle cx="26" cy="26" r="24" />
          <path d="M15 27l7 7 15-16" />
        </svg>
        <h2 id="sent-title" className="lettering">Your order is ready in WhatsApp</h2>
        <p>Order <b>{orderRef}</b>. Tap send in WhatsApp and we&apos;ll reply with the price.</p>
        <p className="sent-help">WhatsApp didn&apos;t open? Copy the message and send it to <b>0814 069 4034</b>.</p>
        <div className="sent-actions">
          <a
            className="btn btn-wa"
            href={`https://wa.me/2348140694034?text=${encodeURIComponent(sentText)}`}
            target="_blank"
            rel="noreferrer noopener"
            onClick={trackWhatsappChat}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#wa-icon" /></svg>
            Open WhatsApp again
          </a>
          <button className="btn btn-line" type="button" onClick={copyOrderMessage}>Copy message</button>
          <button className="btn btn-line" type="button" onClick={startNewOrder}>Start a new order</button>
          {copyFeedback ? <p className="copy-feedback" role="status">{copyFeedback}</p> : null}
        </div>
      </dialog>

      <a className={`fab wa-direct ${fabVisible ? "show" : ""}`} href="https://wa.me/2348140694034?text=Hello%20Errand%20Runs%2C%20I%27d%20like%20to%20ask%20about%20an%20errand." target="_blank" rel="noreferrer noopener" aria-label="Chat with Errand Runs on WhatsApp" onClick={trackWhatsappChat}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <use href="#wa-icon" />
        </svg>
      </a>

      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <symbol id="wa-icon" viewBox="0 0 24 24">
          <path fill="currentColor" d="M12.04 2a9.9 9.9 0 0 0-8.45 15.05L2.5 21.5l4.57-1.07A9.9 9.9 0 1 0 12.04 2Zm0 18.04a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-2.71.64.66-2.64-.2-.31a8.12 8.12 0 1 1 6.68 3.62Zm4.45-6.08c-.24-.12-1.44-.71-1.66-.79-.22-.08-.39-.12-.55.12-.16.24-.63.79-.77.95-.14.16-.28.18-.53.06-.24-.12-1.03-.38-1.96-1.21-.72-.65-1.21-1.44-1.35-1.69-.14-.24-.02-.37.11-.49.11-.11.24-.28.36-.43.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.43-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47a.9.9 0 0 0-.65.3c-.22.24-.85.83-.85 2.03s.87 2.35.99 2.52c.12.16 1.71 2.61 4.15 3.66.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.47-.28Z" />
        </symbol>
      </svg>
    </div>
  );
}
