/* eslint-disable @next/next/no-img-element */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <img
        src="/brand/logo.png"
        alt="DOR PRIZE"
        className="h-auto max-h-full w-auto max-w-full object-contain drop-shadow-[0_2.5px_0_#000000]"
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
