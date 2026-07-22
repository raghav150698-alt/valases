type BrandLogoProps = {
  className?: string;
  alt?: string;
};

export function BrandLogo({ className = "brand-logo", alt = "Valases" }: BrandLogoProps) {
  const logoUrl = `${import.meta.env.BASE_URL}assets/brand/valases-logo.png`;
  return (
    <span className={`brand-logo-frame ${className}`}>
      <img className="brand-logo-image" src={logoUrl} alt={alt} />
    </span>
  );
}
