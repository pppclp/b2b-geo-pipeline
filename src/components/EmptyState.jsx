import React from "react";

export default function EmptyState({ title = "Nothing here", description, icon: Icon, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && <Icon className="w-10 h-10 text-muted-foreground/40 mb-3" />}
      <h3 className="text-sm font-medium">{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}