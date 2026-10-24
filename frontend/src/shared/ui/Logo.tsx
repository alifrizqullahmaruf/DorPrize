/* eslint-disable @next/next/no-img-element */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <img
        src="/brand/logo.png"
        alt="DOR PRIZE"
        className="h-auto w-full drop-shadow-[0_6px_0_rgba(0,0,0,0.45)]"
        draggable={false}
      />
      <div
        className="logo-shine absolute inset-0"
        style={{ ["--logo-mask" as string]: "url(/brand/logo.png)" }}
        aria-hidden
      />
    </div>
  );
}
