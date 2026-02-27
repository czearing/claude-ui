import type { ExternalToast } from "sonner";

export type ToastPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top-center"
  | "bottom-center";

export interface ToasterProps {
  position?: ToastPosition;
  visibleToasts?: number;
  expand?: boolean;
  closeButton?: boolean;
}

export type ToastOptions = ExternalToast;
