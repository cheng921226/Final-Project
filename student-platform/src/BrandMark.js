export default function BrandMark({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M5 7.5 16 3l11 4.5v17L16 29 5 24.5v-17Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="m5 7.5 11 5 11-5M16 12.5V29M10.5 5.3l11 5v9.5l-5.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
