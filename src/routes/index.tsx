import { createFileRoute } from "@tanstack/react-router";

import { AirDraw } from "@/components/airdraw/AirDraw";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AirDraw — Desenhe no ar com as mãos" },
      {
        name: "description",
        content:
          "Desenhe no ar usando a câmera e gestos da mão, mova e apague traços e transforme seus desenhos em 3D.",
      },
      { property: "og:title", content: "AirDraw — Desenhe no ar com as mãos" },
      {
        property: "og:description",
        content:
          "Desenho por gestos com a câmera, traço neon e visualização 3D.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AirDraw,
});
