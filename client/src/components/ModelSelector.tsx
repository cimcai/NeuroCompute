import { AVAILABLE_MODELS, CATEGORY_LABELS, type ModelOption } from "@/lib/models";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Cpu, ChevronDown, Check, Info } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  activeModel: string | null;
  disabled: boolean;
}

const categoryOrder: ModelOption["category"][] = ["tiny", "small", "medium", "large", "specialized"];

const categoryColors: Record<ModelOption["category"], string> = {
  tiny: "text-green-400",
  small: "text-primary",
  medium: "text-amber-400",
  large: "text-red-400",
  specialized: "text-accent",
};

export function ModelSelector({ selectedModel, onSelectModel, activeModel, disabled }: ModelSelectorProps) {
  const [expanded, setExpanded] = useState(false);
  const selected = AVAILABLE_MODELS.find((m) => m.id === selectedModel);
  const needsReload = activeModel && activeModel !== selectedModel;

  return (
    <Card className={cn(disabled && "opacity-60 pointer-events-none")}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-lg">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-primary" />
            Model
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-sm font-normal text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-toggle-model-list"
          >
            {expanded ? "Collapse" : "Change"}
            <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {selected && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50 border border-white/5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-semibold text-sm" data-testid="text-selected-model">{selected.label}</span>
                <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full bg-secondary border border-white/5", categoryColors[selected.category])}>
                  {selected.size}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{selected.description}</p>
              {activeModel && activeModel === selectedModel && (
                <p className="text-xs text-primary mt-1 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Currently loaded
                </p>
              )}
              {needsReload && (
                <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                  <Info className="w-3 h-3" /> Will download on next start
                </p>
              )}
            </div>
          </div>
        )}

        {expanded && (
          <div className="space-y-4 pt-2">
            {categoryOrder.map((cat) => {
              const models = AVAILABLE_MODELS.filter((m) => m.category === cat);
              if (models.length === 0) return null;
              return (
                <div key={cat}>
                  <p className={cn("text-xs font-semibold uppercase tracking-wider mb-2", categoryColors[cat])}>
                    {CATEGORY_LABELS[cat]}
                  </p>
                  <div className="space-y-1">
                    {models.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => {
                          onSelectModel(model.id);
                          setExpanded(false);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between gap-3 p-3 rounded-lg text-left transition-colors",
                          model.id === selectedModel
                            ? "bg-primary/10 border border-primary/30"
                            : "bg-secondary/30 border border-white/5 hover:bg-secondary/60"
                        )}
                        data-testid={`button-model-${model.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-medium">{model.label}</span>
                            <span className="text-xs text-muted-foreground">{model.size}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{model.description}</p>
                        </div>
                        {model.id === selectedModel && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                        {model.id === activeModel && model.id !== selectedModel && (
                          <span className="text-xs text-muted-foreground flex-shrink-0">loaded</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
