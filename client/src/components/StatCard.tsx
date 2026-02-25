import { motion } from "framer-motion";
import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: ReactNode;
  subtitle?: string;
  valueColor?: string;
  className?: string;
}

export function StatCard({ title, value, icon, subtitle, valueColor, className }: StatCardProps) {
  return (
    <Card className={cn("overflow-hidden group hover:border-primary/30", className)}>
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <motion.div
              key={value}
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className={cn("text-4xl font-mono font-bold tracking-tight", valueColor || "text-foreground")}
            >
              {value}
            </motion.div>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
          {icon && (
            <div className="p-3 rounded-xl bg-secondary/50 text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors">
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
