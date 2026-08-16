import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "article" | "div";
  tone?: "default" | "soft" | "accent" | "warning";
};

export function Card({
  as: Component = "section",
  tone = "default",
  className = "",
  ...props
}: CardProps) {
  return <Component className={`card card--${tone} ${className}`.trim()} {...props} />;
}
