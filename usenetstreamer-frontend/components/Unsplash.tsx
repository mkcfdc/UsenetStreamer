interface Props {
  photo: string;
  alt: string;
  class?: string;
  width?: number;
  height?: number;
  priority?: boolean;
}

export function Unsplash(
  { photo, alt, class: className = "", width = 1600, height = 1000, priority }: Props,
) {
  const base = `https://images.unsplash.com/${photo}`;
  const src = `${base}?auto=format&fit=crop&w=${width}&q=62`;
  const srcSet = [800, 1200, 1600, 2000]
    .map((w) => `${base}?auto=format&fit=crop&w=${w}&q=60 ${w}w`)
    .join(", ");

  return (
    <img
      src={src}
      srcset={srcSet}
      sizes="(max-width: 768px) 100vw, 50vw"
      alt={alt}
      width={width}
      height={height}
      class={className}
      loading={priority ? "eager" : "lazy"}
      fetchpriority={priority ? "high" : "low"}
      decoding="async"
    />
  );
}
