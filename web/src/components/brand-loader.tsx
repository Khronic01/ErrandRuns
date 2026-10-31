import Image from "next/image";

type BrandLoaderProps = {
  className?: string;
};

export default function BrandLoader({ className = "page-loader" }: BrandLoaderProps) {
  return (
    <main
      className={className}
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        zIndex: 100,
        inset: 0,
        display: className === "startup-loader" ? "none" : "grid",
        alignContent: "center",
        justifyItems: "center",
        gap: 28,
        minHeight: "100svh",
        padding: 24,
        background: "#ffffff",
      }}
    >
      <Image
        alt=""
        className="page-loader-logo"
        height={113}
        priority
        src="/ojah-logo.png"
        style={{ width: "min(340px, 78vw)", height: "auto" }}
        width={340}
      />
      <span
        className="page-loader-track"
        aria-hidden="true"
        style={{ width: 150, height: 4, borderRadius: 999, background: "#eaf5ef" }}
      />
      <span className="sr-only">Loading OJAH…</span>
    </main>
  );
}
