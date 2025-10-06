import * as React from "react";

export interface ToastOptions {
  id?: string;
  duration?: number;
}

export interface Toast extends ToastOptions {
  id: string;
  message: string;
  type: "blank" | "success" | "error";
  createdAt: number;
}

export interface ToasterProps {
  position?: "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";
}

export declare function Toaster(props: ToasterProps): React.ReactElement | null;

export interface ToastFunction {
  (message: string, options?: ToastOptions): string;
  success(message: string, options?: ToastOptions): string;
  error(message: string, options?: ToastOptions): string;
  dismiss(id?: string): void;
  remove(id?: string): void;
}

export declare const toast: ToastFunction;

export default toast;
