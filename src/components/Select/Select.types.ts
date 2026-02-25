import type { ComponentPropsWithoutRef } from "react";
import type * as RadixSelect from "@radix-ui/react-select";

export type SelectProps = ComponentPropsWithoutRef<typeof RadixSelect.Root>;

export type SelectTriggerProps = ComponentPropsWithoutRef<
  typeof RadixSelect.Trigger
>;

export type SelectValueProps = ComponentPropsWithoutRef<
  typeof RadixSelect.Value
>;

export type SelectContentProps = ComponentPropsWithoutRef<
  typeof RadixSelect.Content
>;

export type SelectItemProps = ComponentPropsWithoutRef<typeof RadixSelect.Item>;
