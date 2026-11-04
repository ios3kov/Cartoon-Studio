import type { CSSProperties } from "react";
export type IconName =
  | "play"
  | "pause"
  | "plus"
  | "undo"
  | "redo"
  | "download"
  | "upload"
  | "more"
  | "close"
  | "trash"
  | "copy"
  | "up"
  | "down"
  | "volume"
  | "film"
  | "spark"
  | "arrow"
  | "check"
  | "sliders"
  | "image"
  | "person"
  | "music"
  | "reset"
  | "folder";
const paths: Record<IconName, string> = {
  play: "M8 5l11 7-11 7V5Z",
  pause: "M8 5v14M16 5v14",
  plus: "M12 5v14M5 12h14",
  undo: "M8 5 3 10l5 5M3 10h10a7 7 0 0 1 7 7v2",
  redo: "m16 5 5 5-5 5M21 10H11a7 7 0 0 0-7 7v2",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  close: "m6 6 12 12M6 18 18 6",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  copy: "M9 9h12v12H9zM15 5V3H3v12h2",
  up: "m6 14 6-6 6 6",
  down: "m6 10 6 6 6-6",
  volume: "M11 4 5 9H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  film: "M3 4h18v16H3zM7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4",
  spark:
    "m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3ZM20 3v4m-2-2h4",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  check: "m5 12 4 4 10-10",
  sliders: "M4 7h8m4 0h4M4 17h3m4 0h9M12 4v6M7 14v6",
  image: "M3 4h18v16H3zM3 16l6-6 5 5 3-3 4 4M16 8h.01",
  person: "M8 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0M4 21v-3a8 8 0 0 1 16 0v3",
  music:
    "M9 18V5l11-2v13M9 9l11-2M3 19a3 2 0 1 0 6 0 3 2 0 0 0-6 0M14 17a3 2 0 1 0 6 0 3 2 0 0 0-6 0",
  reset: "M3 10a9 9 0 1 1 1 8M3 4v6h6",
  folder: "M3 6h7l2 3h9v11H3V6Z",
};
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
