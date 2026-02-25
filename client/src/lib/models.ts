export interface ModelOption {
  id: string;
  label: string;
  size: string;
  category: "tiny" | "small" | "medium" | "large" | "specialized";
  description: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: "SmolLM2-135M-Instruct-q0f16-MLC",
    label: "SmolLM2 135M",
    size: "~100MB",
    category: "tiny",
    description: "Ultra-fast, minimal quality. Good for stress-testing.",
  },
  {
    id: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    label: "SmolLM2 360M",
    size: "~200MB",
    category: "tiny",
    description: "Very fast, basic responses.",
  },
  {
    id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    label: "Qwen2.5 0.5B",
    size: "~300MB",
    category: "tiny",
    description: "Quick and lightweight with decent quality.",
  },
  {
    id: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",
    label: "TinyLlama 1.1B",
    size: "~600MB",
    category: "small",
    description: "Good balance of speed and quality. Default choice.",
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 1B",
    size: "~700MB",
    category: "small",
    description: "Meta's latest small model. Great quality for size.",
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: "Qwen2.5 1.5B",
    size: "~900MB",
    category: "small",
    description: "Strong multilingual support.",
  },
  {
    id: "Qwen3-1.7B-q4f16_1-MLC",
    label: "Qwen3 1.7B",
    size: "~1GB",
    category: "small",
    description: "Latest Qwen with reasoning capabilities.",
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 3B",
    size: "~1.8GB",
    category: "medium",
    description: "Significantly better quality. Needs decent GPU.",
  },
  {
    id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    label: "Qwen2.5 3B",
    size: "~1.8GB",
    category: "medium",
    description: "Strong 3B model with good reasoning.",
  },
  {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    label: "Phi 3.5 Mini",
    size: "~2.2GB",
    category: "medium",
    description: "Microsoft's compact powerhouse. Great reasoning.",
  },
  {
    id: "Qwen3-4B-q4f16_1-MLC",
    label: "Qwen3 4B",
    size: "~2.4GB",
    category: "medium",
    description: "Latest Qwen3 with strong reasoning.",
  },
  {
    id: "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC",
    label: "DeepSeek R1 7B",
    size: "~4GB",
    category: "large",
    description: "Reasoning-focused. Needs strong GPU (8GB+ VRAM).",
  },
  {
    id: "Llama-3.1-8B-Instruct-q4f16_1-MLC",
    label: "Llama 3.1 8B",
    size: "~4.5GB",
    category: "large",
    description: "Top quality. Needs strong GPU (8GB+ VRAM).",
  },
  {
    id: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
    label: "Qwen2.5 Coder 1.5B",
    size: "~900MB",
    category: "specialized",
    description: "Optimized for code generation tasks.",
  },
  {
    id: "Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC",
    label: "Qwen2.5 Math 1.5B",
    size: "~900MB",
    category: "specialized",
    description: "Optimized for mathematical reasoning.",
  },
];

export const DEFAULT_MODEL_ID = "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC";

export const CATEGORY_LABELS: Record<ModelOption["category"], string> = {
  tiny: "Tiny (fastest, lowest quality)",
  small: "Small (good balance)",
  medium: "Medium (better quality, needs GPU)",
  large: "Large (best quality, strong GPU required)",
  specialized: "Specialized",
};
