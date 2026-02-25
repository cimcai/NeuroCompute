import { AVAILABLE_MODELS, CATEGORY_LABELS, type ModelOption } from "@/lib/models";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Cpu, Check, Info } from "lucide-react";
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
  const selected = AVAILABLE_MODELS.find((m) => m.id === selectedModel);
  const needsReload = activeModel && activeModel !== selectedModel;

  return (
    <Card className={cn(disabled && "opacity-60 pointer-events-none")}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Cpu className="w-5 h-5 text-primary" />
          Model
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <select
          value={selectedModel}
          onChange={(e) => onSelectModel(e.target.value)}
          className="w-full bg-secondary/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
          data-testid="select-model"
        >
          {categoryOrder.map((cat) => {
            const models = AVAILABLE_MODELS.filter((m) => m.category === cat);
            if (models.length === 0) return null;
            return (
              <optgroup key={cat} label={CATEGORY_LABELS[cat]}>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} ({model.size})
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>

        {selected && (
          <div className="p-3 rounded-lg bg-secondary/50 border border-white/5">
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
        )}
      </CardContent>
    </Card>
  );
}
