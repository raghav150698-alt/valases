type BrandLogoProps = {
  className?: string;
  alt?: string;
};

export function BrandLogo({ className = "brand-logo", alt = "Valases" }: BrandLogoProps) {
  const logoUrl = `${import.meta.env.BASE_URL}assets/brand/valases-logo.png`;
  return (
    <img className={`brand-logo-image ${className}`} src={logoUrl} alt={alt} />
  );
}
