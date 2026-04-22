import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Check, Key, UserPlus, LogIn, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PATRON_ADJECTIVES = [
  "Stellar", "Quantum", "Cosmic", "Neural", "Radiant", "Nebular", "Atomic",
  "Prismatic", "Orbital", "Photonic", "Tidal", "Solar", "Ionic", "Kinetic",
  "Void", "Astral", "Signal", "Flux", "Crisp", "Cipher"
];
const PATRON_NOUNS = [
  "Weaver", "Voyager", "Architect", "Pioneer", "Builder", "Dreamer",
  "Sage", "Beacon", "Catalyst", "Sentinel", "Oracle", "Walker",
  "Keeper", "Shaper", "Spark", "Drifter", "Forge", "Relay", "Witness", "Seeker"
];

function randomPatronName(): string {
  const adj = PATRON_ADJECTIVES[Math.floor(Math.random() * PATRON_ADJECTIVES.length)];
  const noun = PATRON_NOUNS[Math.floor(Math.random() * PATRON_NOUNS.length)];
  return `${adj} ${noun}`;
}

interface PatronModalProps {
  open: boolean;
  onClaimed: (patronId: number, patronName: string, token: string) => void;
  onLooked: (patronId: number, patronName: string, token: string) => void;
  onDismiss: () => void;
}

type Mode = "choice" | "new" | "return" | "showToken";

export function PatronModal({ open, onClaimed, onLooked, onDismiss }: PatronModalProps) {
  const [mode, setMode] = useState<Mode>("choice");
  const [name, setName] = useState(() => randomPatronName());
  const [returnToken, setReturnToken] = useState("");
  const [generatedToken, setGeneratedToken] = useState("");
  const [patronId, setPatronId] = useState<number | null>(null);
  const [patronName, setPatronName] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setMode("choice");
      setName(randomPatronName());
      setReturnToken("");
      setError("");
    }
  }, [open]);

  const handleClaim = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/patrons/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Failed to claim identity");
        return;
      }
      setGeneratedToken(data.token);
      setPatronId(data.patron.id);
      setPatronName(data.patron.name);
      setMode("showToken");
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  };

  const handleLookup = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/patrons/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: returnToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Token not found");
        return;
      }
      onLooked(data.patron.id, data.patron.name, returnToken.trim());
      toast({ title: `Welcome back, ${data.patron.name}!`, description: "Your patron identity is restored." });
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyToken = async () => {
    try {
      await navigator.clipboard.writeText(generatedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Please copy the token manually", variant: "destructive" });
    }
  };

  const handleFinish = () => {
    if (patronId !== null) {
      onClaimed(patronId, patronName, generatedToken);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onDismiss()}>
      <DialogContent className="max-w-md" data-testid="dialog-patron-modal">

        {mode === "choice" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Patron Identity
              </DialogTitle>
              <DialogDescription>
                Your patron account tracks compute contributions across all your agents — even across devices.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 mt-2">
              <Button
                onClick={() => setMode("new")}
                className="h-auto py-4 flex flex-col items-center gap-1"
                data-testid="button-patron-new"
              >
                <UserPlus className="w-5 h-5" />
                <span className="font-semibold">Claim a new identity</span>
                <span className="text-xs font-normal opacity-80">First time here — get your patron token</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => setMode("return")}
                className="h-auto py-4 flex flex-col items-center gap-1 border-white/20"
                data-testid="button-patron-return"
              >
                <LogIn className="w-5 h-5" />
                <span className="font-semibold">Return as patron</span>
                <span className="text-xs font-normal opacity-70">Paste your token to reclaim your account</span>
              </Button>
              <button
                onClick={onDismiss}
                className="text-xs text-muted-foreground hover:text-foreground text-center py-1 transition-colors"
                data-testid="button-patron-skip"
              >
                Skip for now
              </button>
            </div>
          </>
        )}

        {mode === "new" && (
          <>
            <DialogHeader>
              <DialogTitle>Claim Your Identity</DialogTitle>
              <DialogDescription>
                Choose a name for your patron account. You'll receive a secret token to prove your identity later.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="patron-name">Patron name</Label>
                <div className="flex gap-2">
                  <Input
                    id="patron-name"
                    data-testid="input-patron-name"
                    value={name}
                    onChange={e => { setName(e.target.value); setError(""); }}
                    placeholder="e.g. Stellar Weaver"
                    maxLength={32}
                    onKeyDown={e => e.key === "Enter" && handleClaim()}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setName(randomPatronName())}
                    className="shrink-0 border-white/20"
                    data-testid="button-patron-random-name"
                    title="Generate random name"
                  >
                    ↺
                  </Button>
                </div>
                {error && <p className="text-xs text-destructive" data-testid="text-patron-error">{error}</p>}
              </div>
              <Button
                onClick={handleClaim}
                disabled={loading || name.trim().length < 2}
                className="w-full"
                data-testid="button-patron-claim"
              >
                {loading ? "Claiming..." : "Claim Identity"}
              </Button>
              <button onClick={() => setMode("choice")} className="text-xs text-muted-foreground hover:text-foreground w-full text-center">
                ← Back
              </button>
            </div>
          </>
        )}

        {mode === "showToken" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-primary">Welcome, {patronName}!</DialogTitle>
              <DialogDescription>
                Save your secret token — it's shown only once. Paste it on any device to reclaim your patron account.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="bg-secondary/50 border border-white/10 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Key className="w-4 h-4 text-primary shrink-0" />
                  <code className="text-xs font-mono text-primary break-all flex-1 select-all" data-testid="text-patron-token">
                    {generatedToken}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyToken}
                    className="shrink-0 h-7 w-7 p-0"
                    data-testid="button-copy-token"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>
                <p className="text-[10px] text-amber-400 flex items-center gap-1.5">
                  ⚠ This token will not be shown again. Copy it somewhere safe.
                </p>
              </div>
              <Button
                onClick={handleFinish}
                className="w-full"
                data-testid="button-patron-finish"
              >
                Got it — let's go!
              </Button>
            </div>
          </>
        )}

        {mode === "return" && (
          <>
            <DialogHeader>
              <DialogTitle>Return as Patron</DialogTitle>
              <DialogDescription>
                Paste your patron token to restore your identity and all your contributions.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="return-token">Your patron token</Label>
                <Input
                  id="return-token"
                  data-testid="input-return-token"
                  value={returnToken}
                  onChange={e => { setReturnToken(e.target.value); setError(""); }}
                  placeholder="Paste token here..."
                  className="font-mono text-xs"
                  onKeyDown={e => e.key === "Enter" && handleLookup()}
                />
                {error && <p className="text-xs text-destructive" data-testid="text-patron-error">{error}</p>}
              </div>
              <Button
                onClick={handleLookup}
                disabled={loading || returnToken.trim().length < 10}
                className="w-full"
                data-testid="button-patron-lookup"
              >
                {loading ? "Looking up..." : "Restore Identity"}
              </Button>
              <button onClick={() => setMode("choice")} className="text-xs text-muted-foreground hover:text-foreground w-full text-center">
                ← Back
              </button>
            </div>
          </>
        )}

      </DialogContent>
    </Dialog>
  );
}
