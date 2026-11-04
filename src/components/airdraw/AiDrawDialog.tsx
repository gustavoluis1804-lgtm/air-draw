import { Layers, Plus, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { generate2DDrawing } from "@/lib/airdraw/ai-generator";
import type { Stroke } from "@/lib/airdraw/types";
import { cn } from "@/lib/utils";

const PROMPT_SUGGESTIONS = [
  { label: "🐱 Gatinho", prompt: "um gatinho fofo" },
  { label: "💖 Coração com Asas", prompt: "coração com asas neon" },
  { label: "⚔️ Espada Neon", prompt: "espada futurista cyberpunk" },
  { label: "🌸 Flor Radiante", prompt: "flor radiante com pétalas" },
  { label: "🏎️ Carro Esportivo", prompt: "carro esportivo veloz" },
  { label: "🦋 Borboleta", prompt: "borboleta brilhante neon" },
  { label: "🚀 Foguete", prompt: "foguete espacial partindo" },
  { label: "🐉 Dragão", prompt: "dragão chinês voador" },
  { label: "🌟 Estrela Cósmica", prompt: "estrela cósmica com anéis" },
  { label: "🌀 Mandala", prompt: "mandala geométrica sagrada" },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (strokes: Stroke[], mode: "replace" | "add") => void;
  hasExistingStrokes: boolean;
};

export function AiDrawDialog({
  open,
  onOpenChange,
  onGenerate,
  hasExistingStrokes,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [generationMode, setGenerationMode] = useState<"replace" | "add">(
    "add",
  );
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async (customPrompt?: string) => {
    const text = (customPrompt ?? prompt).trim();
    if (!text) {
      toast(
        "Digite o que você quer que a IA desenhe ou clique em uma sugestão abaixo!",
      );
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generate2DDrawing(text);
      if (!result.strokes.length) {
        toast.error("Não foi possível gerar este desenho. Tente outro prompt!");
        return;
      }

      onGenerate(result.strokes, generationMode);
      onOpenChange(false);

      toast.success(`✦ ${result.title}`, {
        description:
          "Traços gerados pelo motor vetorial inteligente na sua tela 2D!",
      });
    } catch {
      toast.error("Ocorreu um erro ao gerar o desenho. Tente novamente!");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl border-border bg-panel p-6 shadow-panel">
        <DialogHeader className="text-left">
          <div className="flex items-center gap-2">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="size-4 text-glow" />
              Gerar Desenho com IA (2D)
            </DialogTitle>
            <Badge
              variant="outline"
              className="border-glow/40 bg-glow/10 text-glow"
            >
              2D Canvas
            </Badge>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Descreva o que deseja desenhar e a IA criará os traços diretamente
            na sua tela! Você pode continuar desenhando com as mãos ou mouse.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex flex-col gap-4">
          {/* Prompt input */}
          <div className="relative">
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isGenerating) {
                  handleGenerate();
                }
              }}
              placeholder="ex.: um gatinho fofo, espada neon, flor radiante, carro..."
              className="pr-10 text-sm"
              autoFocus
            />
            <Wand2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          </div>

          {/* Quick inspiration chips */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              Sugestões rápidas:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {PROMPT_SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => {
                    setPrompt(s.prompt);
                    handleGenerate(s.prompt);
                  }}
                  className="rounded-full border border-border/80 bg-panel/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-glow/50 hover:bg-glow/15 hover:text-foreground"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Add vs Replace selector (if canvas already has strokes) */}
          {hasExistingStrokes && (
            <div className="flex items-center justify-between rounded-lg border border-border/70 bg-panel/60 p-2 text-xs">
              <span className="text-muted-foreground">Destino dos traços:</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setGenerationMode("add")}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors",
                    generationMode === "add"
                      ? "border border-glow/50 bg-glow/20 text-glow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Plus className="size-3" /> Adicionar
                </button>
                <button
                  type="button"
                  onClick={() => setGenerationMode("replace")}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors",
                    generationMode === "replace"
                      ? "border border-glow/50 bg-glow/20 text-glow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Layers className="size-3" /> Substituir
                </button>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="glow"
              size="sm"
              onClick={() => handleGenerate()}
              disabled={isGenerating}
              className="gap-2 font-medium"
            >
              <Sparkles className="size-4" />
              {isGenerating ? "Criando traços..." : "Gerar Desenho 2D"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
