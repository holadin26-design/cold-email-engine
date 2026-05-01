import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "default" | "secondary" | "destructive" | "outline" | "warning" | "success"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
    const getVariant = (v: string) => {
        switch (v) {
            case "secondary": return "border-transparent bg-secondary text-secondary-foreground"
            case "destructive": return "border-transparent bg-destructive text-destructive-foreground"
            case "outline": return "text-foreground"
            case "warning": return "border-transparent bg-warning text-warning-foreground"
            case "success": return "border-transparent bg-success text-success-foreground"
            default: return "border-transparent bg-primary text-primary-foreground"
        }
    }

    return (
        <div className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", getVariant(variant), className)} {...props} />
    )
}

export { Badge }
