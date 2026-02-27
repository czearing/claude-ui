"use client";

import { toast as sonnerToast, Toaster as SonnerToaster } from "sonner";

import styles from "./Toast.module.css";
import type { ToasterProps, ToastOptions } from "./Toast.types";

export function Toaster({
  position = "bottom-right",
  visibleToasts = 5,
  expand = false,
  closeButton = true,
}: ToasterProps) {
  return (
    <SonnerToaster
      position={position}
      theme="dark"
      richColors
      visibleToasts={visibleToasts}
      expand={expand}
      closeButton={closeButton}
      gap={8}
      offset="16px"
      className={styles.toaster}
    />
  );
}

export const toast = {
  success: (message: string, options?: ToastOptions) =>
    sonnerToast.success(message, options),
  error: (message: string, options?: ToastOptions) =>
    sonnerToast.error(message, options),
  warning: (message: string, options?: ToastOptions) =>
    sonnerToast.warning(message, options),
  info: (message: string, options?: ToastOptions) =>
    sonnerToast.info(message, options),
  message: (message: string, options?: ToastOptions) =>
    sonnerToast(message, options),
  loading: (message: string, options?: ToastOptions) =>
    sonnerToast.loading(message, options),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
  promise: sonnerToast.promise,
};
