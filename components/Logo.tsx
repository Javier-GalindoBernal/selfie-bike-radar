/* eslint-disable @next/next/no-img-element */
export default function Logo({ size = 56, className }: { size?: number; className?: string }) {
  return <img className={className} src="/logo.webp" alt="Selfie MTB Bike Zipaquirá" width={size} height={size} />;
}
