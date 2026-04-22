import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCanvasFavicon } from "@/hooks/use-canvas-favicon";
import Dashboard from "./pages/Dashboard";
import Reference from "./pages/Reference";
import AgentProfile from "./pages/AgentProfile";
import NotFound from "./pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard}/>
      <Route path="/reference" component={Reference}/>
      <Route path="/node/:id" component={AgentProfile}/>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useCanvasFavicon();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
