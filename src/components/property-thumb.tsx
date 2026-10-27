/* eslint-disable @next/next/no-img-element */
type Props = { name: string; url?: string | null; size?: "" | "md" | "lg" | "xl" };

/** A property's photo, or its initial on mint when there is no photo yet. */
export function PropertyThumb({ name, url, size = "" }: Props) {
  return (
    <span className={`pthumb ${size}`.trim()} aria-hidden="true">
      {url ? <img src={url} alt="" /> : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
