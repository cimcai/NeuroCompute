import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type NodeInput } from "@shared/routes";

// Log zod parse errors for easier debugging
function parseWithLogging<T>(schema: z.ZodSchema<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[Zod] ${label} validation failed:`, result.error.format());
    throw result.error;
  }
  return result.data;
}

export function useNodes() {
  return useQuery({
    queryKey: [api.nodes.list.path],
    queryFn: async () => {
      const res = await fetch(api.nodes.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch nodes");
      const data = await res.json();
      return parseWithLogging(api.nodes.list.responses[200], data, "nodes.list");
    },
  });
}

export function useCreateNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: NodeInput) => {
      const validated = api.nodes.create.input.parse(input);
      const res = await fetch(api.nodes.create.path, {
        method: api.nodes.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.nodes.create.responses[400].parse(data);
          throw new Error(error.message);
        }
        throw new Error("Failed to create node");
      }
      
      return parseWithLogging(api.nodes.create.responses[201], data, "nodes.create");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.nodes.list.path] });
    },
  });
}
