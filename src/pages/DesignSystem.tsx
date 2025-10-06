import React from "react";
import { themeNames, tokens, useTheme } from "../ui";

const Section: React.FC<{ title: string; description?: string; children: React.ReactNode }> = ({
  title,
  description,
  children,
}) => (
  <section style={{ marginBottom: "var(--space-6)" }}>
    <header style={{ marginBottom: "var(--space-3)" }}>
      <h2 style={{ margin: 0 }}>{title}</h2>
      {description ? (
        <p style={{ marginTop: "var(--space-1)", color: "var(--color-muted)" }}>{description}</p>
      ) : null}
    </header>
    {children}
  </section>
);

const TokenSwatch: React.FC<{ label: string; value: string; example?: React.ReactNode }> = ({
  label,
  value,
  example,
}) => (
  <div
    style={{
      padding: "var(--space-3)",
      borderRadius: "var(--radius-lg)",
      background: "var(--color-subtle)",
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-2)",
      minWidth: 160,
    }}
  >
    <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    <code style={{ fontSize: 14 }}>{value}</code>
    {example}
  </div>
);

export default function DesignSystemPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      style={{
        padding: "var(--space-5)",
        background: "var(--color-background)",
        color: "var(--color-foreground)",
      }}
    >
      <header style={{ marginBottom: "var(--space-5)" }}>
        <h1 style={{ marginBottom: "var(--space-2)" }}>Design Tokens</h1>
        <p style={{ margin: 0, color: "var(--color-muted)" }}>
          Tokenized spacing, typography and color primitives for the APGMS console. Tokens are
          applied globally as CSS variables and power our Tailwind theme.
        </p>
        <div style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-2)" }}>
          {themeNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTheme(name)}
              style={{
                padding: "var(--space-2) var(--space-3)",
                borderRadius: "var(--radius-md)",
                border: `1px solid ${
                  theme.name === name ? "var(--color-primary)" : "var(--color-border)"
                }`,
                background:
                  theme.name === name ? "var(--color-primary)" : "transparent",
                color:
                  theme.name === name
                    ? "var(--color-primaryContrast)"
                    : "var(--color-foreground)",
                cursor: "pointer",
                transition: `background var(--duration-base) ease, color var(--duration-fast) ease`,
              }}
            >
              {name === "light" ? "Light" : "Dark"} theme
            </button>
          ))}
        </div>
      </header>

      <Section title="Spacing" description="Consistent spacing scale based on 4px increments.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
          {Object.entries(tokens.space).map(([key, value]) => (
            <TokenSwatch
              key={key}
              label={`space.${key}`}
              value={value}
              example={
                <div
                  style={{
                    height: "var(--space-2)",
                    width: value,
                    background: "var(--color-primary)",
                    borderRadius: "var(--radius-sm)",
                  }}
                />
              }
            />
          ))}
        </div>
      </Section>

      <Section title="Radii" description="Corner radii for surfaces and controls.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
          {Object.entries(tokens.radius).map(([key, value]) => (
            <TokenSwatch
              key={key}
              label={`radius.${key}`}
              value={value}
              example={
                <div
                  style={{
                    height: "3rem",
                    width: "100%",
                    background: "var(--color-primary)",
                    borderRadius: value,
                  }}
                />
              }
            />
          ))}
        </div>
      </Section>

      <Section title="Color palette" description="Semantic colors adapt between light and dark themes.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
          {Object.entries(theme.palette).map(([key, value]) => (
            <TokenSwatch
              key={key}
              label={`color.${key}`}
              value={value}
              example={
                <div
                  style={{
                    background: value,
                    height: "3rem",
                    borderRadius: "var(--radius-md)",
                    border:
                      key === "background"
                        ? "1px solid var(--color-border)"
                        : "1px solid transparent",
                  }}
                />
              }
            />
          ))}
        </div>
      </Section>

      <Section
        title="Motion"
        description="Standard durations ensure consistent easing and animation feel."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
          {Object.entries(tokens.durations).map(([key, value]) => (
            <TokenSwatch key={key} label={`duration.${key}`} value={value} />
          ))}
        </div>
      </Section>
    </div>
  );
}
