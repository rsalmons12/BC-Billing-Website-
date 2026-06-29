// BC Billing Solutions mark — octagon + EKG pulse, blue→green gradient.
export default function Logo({
  size = 36,
  idSuffix = "",
}: {
  size?: number;
  idSuffix?: string;
}) {
  const gid = `bc-grad${idSuffix}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="BC Billing Solutions"
    >
      <defs>
        <linearGradient id={gid} x1="10" y1="6" x2="92" y2="94" gradientUnits="userSpaceOnUse">
          <stop stopColor="#19a8e0" />
          <stop offset="0.55" stopColor="#1f7fc4" />
          <stop offset="1" stopColor="#37a635" />
        </linearGradient>
      </defs>
      <polygon
        points="32,7 68,7 93,32 93,68 68,93 32,93 7,68 7,32"
        stroke={`url(#${gid})`}
        strokeWidth="6"
      />
      <polyline
        points="13,52 36,52 45,28 54,74 61,42 67,57 87,57"
        stroke={`url(#${gid})`}
        strokeWidth="5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
