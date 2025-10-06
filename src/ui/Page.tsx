import React from "react";
import { colors, fontSizes, radii, shadows, spacing } from "./tokens.css";
import { PageMeta, useHelp } from "./help";

type Breadcrumb = {
  label: string;
  href?: string;
};

type PageProps = {
  meta: PageMeta;
  breadcrumbs?: Breadcrumb[];
  actions?: React.ReactNode;
  isLoading?: boolean;
  children: React.ReactNode;
};

type PageErrorBoundaryProps = {
  children: React.ReactNode;
};

type PageErrorBoundaryState = {
  error?: Error;
};

class PageErrorBoundary extends React.Component<
  PageErrorBoundaryProps,
  PageErrorBoundaryState
> {
  state: PageErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return { error };
  }

  handleRetry = () => {
    this.setState({ error: undefined });
  };

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            background: colors.surface,
            borderRadius: radii.lg,
            boxShadow: shadows.soft,
            padding: spacing.xl,
            border: `1px solid ${colors.borderStrong}`,
            display: "flex",
            flexDirection: "column",
            gap: spacing.md,
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: fontSizes.lg,
                color: colors.danger,
              }}
            >
              Something went wrong
            </h2>
            <p
              style={{
                margin: 0,
                color: colors.textSecondary,
                fontSize: fontSizes.sm,
              }}
            >
              {this.state.error.message}
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={this.handleRetry}
              style={{
                padding: `${spacing.sm} ${spacing.lg}`,
                background: colors.accent,
                color: colors.surface,
                border: "none",
                borderRadius: radii.md,
                fontSize: fontSizes.sm,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children as React.ReactElement;
  }
}

function BreadcrumbTrail({ breadcrumbs }: { breadcrumbs: Breadcrumb[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.sm,
        color: colors.textMuted,
        fontSize: fontSizes.sm,
      }}
    >
      {breadcrumbs.map((item, index) => (
        <React.Fragment key={`${item.label}-${index}`}>
          {index > 0 && <span>/</span>}
          {item.href ? (
            <a
              href={item.href}
              style={{
                color: colors.accent,
                textDecoration: "none",
              }}
            >
              {item.label}
            </a>
          ) : (
            <span>{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

function SkeletonContent() {
  const lineStyle: React.CSSProperties = {
    height: "12px",
    borderRadius: radii.pill,
    background: colors.surfaceMuted,
    animation: "page-skeleton-pulse 1.5s ease-in-out infinite",
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing.sm,
        background: colors.surface,
        borderRadius: radii.lg,
        padding: spacing.xl,
        boxShadow: shadows.soft,
      }}
    >
      <div style={{ ...lineStyle, width: "55%", height: "18px" }} />
      <div style={{ ...lineStyle, width: "82%" }} />
      <div style={{ ...lineStyle, width: "68%" }} />
      <div style={{ ...lineStyle, width: "74%" }} />
      <div style={{ ...lineStyle, width: "40%" }} />
    </div>
  );
}

type PageComponent = React.FC<PageProps> & {
  Skeleton: typeof SkeletonContent;
};

const Page: PageComponent = ({
  meta,
  breadcrumbs,
  actions,
  isLoading,
  children,
}) => {
  const { register, open } = useHelp();

  React.useEffect(() => {
    register(meta);
    return () => register(null);
  }, [meta, register]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing.xl,
      }}
    >
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: spacing.sm,
          background: colors.surface,
          borderRadius: radii.lg,
          padding: spacing.xl,
          boxShadow: shadows.soft,
        }}
      >
        {breadcrumbs && breadcrumbs.length > 0 && (
          <BreadcrumbTrail breadcrumbs={breadcrumbs} />
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            gap: spacing.lg,
            justifyContent: "space-between",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: spacing.sm,
                flexWrap: "wrap",
              }}
            >
              <h1
                style={{
                  margin: 0,
                  fontSize: fontSizes.xl,
                  color: colors.textPrimary,
                  lineHeight: 1.2,
                }}
              >
                {meta.title}
              </h1>
              <button
                type="button"
                onClick={open}
                title="Open contextual help"
                style={{
                  border: `1px solid ${colors.borderStrong}`,
                  background: colors.surfaceAlt,
                  color: colors.accentStrong,
                  borderRadius: radii.pill,
                  padding: `0 ${spacing.sm}`,
                  height: "28px",
                  minWidth: "28px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ?
              </button>
            </div>
            <p
              style={{
                margin: `${spacing.xs} 0 0`,
                color: colors.textSecondary,
                fontSize: fontSizes.sm,
                maxWidth: "60ch",
              }}
            >
              Use the contextual help and activity feed to stay compliant with PAYGW & GST obligations.
            </p>
          </div>
          {actions && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: spacing.sm,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              {actions}
            </div>
          )}
        </div>
      </header>
      <PageErrorBoundary>
        {isLoading ? <SkeletonContent /> : children}
      </PageErrorBoundary>
    </div>
  );
};

Page.Skeleton = SkeletonContent;

export default Page;
