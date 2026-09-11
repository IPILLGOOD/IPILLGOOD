import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  appearance = "experience",
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
  appearance?: "experience" | "new-work";
}) {
  return (
    <header className={appearance === "new-work" ? "page-header" : "page-header experience-header"}>
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p className="page-header__description">{description}</p>
      </div>
      {action ? <div className="page-header__action">{action}</div> : null}
    </header>
  );
}
