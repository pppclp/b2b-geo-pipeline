import React from "react";
import { cn } from "@/lib/utils";

// Identical heading alignment, typography and responsive action layout
// across Dashboard and Pipeline. Presentation only: no business logic.
export default function PageHeader({ title, description, actions, className }) {
  return (
    <div className={cn("geo-page-header", className)}>
      <div className="min-w-0">
        <h1 className="geo-page-title">{title}</h1>
        {description && <p className="geo-page-description">{description}</p>}
      </div>
      {actions && <div className="geo-page-actions">{actions}</div>}
    </div>
  );
}
