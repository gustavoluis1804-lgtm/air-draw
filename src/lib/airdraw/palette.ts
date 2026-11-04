/** Ink colors are drawing data (saved with each stroke), not UI theme colors. */
export const INK_COLORS = [
  { name: "Rosa neon", value: "#ff6687" },
  { name: "Ciano", value: "#55e7ff" },
  { name: "Branco", value: "#ffffff" },
  { name: "Verde", value: "#73ff9d" },
  { name: "Amarelo", value: "#ffe36b" },
  { name: "Laranja", value: "#ff9a4d" },
] as const;

export const SIZE_MIN = 2;
export const SIZE_MAX = 28;
export const DEFAULT_SIZE = 8;
