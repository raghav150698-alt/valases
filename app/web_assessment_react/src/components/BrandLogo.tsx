type BrandLogoProps = {
  className?: string;
  alt?: string;
};

export function BrandLogo({ className = "brand-logo", alt = "Valases" }: BrandLogoProps) {
  return (
    <span className={`brand-logo-frame ${className}`}>
      <img className="brand-logo-image" src="/assets/brand/valases-logo.png" alt={alt} />
    </span>
  );
}
