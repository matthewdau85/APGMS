declare module "react" {
  export type ReactNode = any;
  export type FC<P = {}> = (props: P & { children?: ReactNode }) => ReactNode;
  export function useState<T>(initial: T): [T, (value: T) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: readonly unknown[]): T;
  export function useContext<T = any>(context: any): T;
  export function createContext<T>(value: T): any;
  export const Fragment: unique symbol;
  const React: {
    createElement: (...args: any[]) => ReactNode;
  };
  export default React;
  export as namespace React;
  export namespace React {
    type ReactNode = any;
  }
  export namespace JSX {
    interface IntrinsicElements {
      [element: string]: any;
    }
    type Element = any;
  }
}

declare module "react-dom/client" {
  export function createRoot(container: HTMLElement | null): { render(node: any): void };
}

declare module "react-router-dom" {
  export const BrowserRouter: any;
  export const Routes: any;
  export const Route: any;
  export const NavLink: any;
  export const Outlet: any;
  export const Link: any;
}

declare module "react/jsx-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

declare module "react/jsx-dev-runtime" {
  export const jsxDEV: any;
  export const Fragment: any;
}

declare global {
  namespace JSX {
    interface ElementClass {
      render?: any;
    }
    interface ElementAttributesProperty {
      props: any;
    }
    interface IntrinsicElements {
      [element: string]: any;
    }
  }
}
