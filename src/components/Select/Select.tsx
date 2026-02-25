"use client";

import { CaretDown, Check } from "@phosphor-icons/react";
import * as RadixSelect from "@radix-ui/react-select";
import clsx from "clsx";

import styles from "./Select.module.css";
import type {
  SelectContentProps,
  SelectItemProps,
  SelectProps,
  SelectTriggerProps,
  SelectValueProps,
} from "./Select.types";

export const Select = (props: SelectProps) => <RadixSelect.Root {...props} />;

export const SelectTrigger = ({ className, ...props }: SelectTriggerProps) => (
  <RadixSelect.Trigger className={clsx(styles.trigger, className)} {...props} />
);

export const SelectValue = (props: SelectValueProps) => (
  <RadixSelect.Value {...props} />
);

export const SelectCaret = () => (
  <RadixSelect.Icon className={styles.caret}>
    <CaretDown size={14} />
  </RadixSelect.Icon>
);

export const SelectContent = ({
  className,
  children,
  position = "popper",
  sideOffset = 6,
  ...props
}: SelectContentProps) => (
  <RadixSelect.Portal>
    <RadixSelect.Content
      className={clsx(styles.content, className)}
      position={position}
      sideOffset={sideOffset}
      {...props}
    >
      <RadixSelect.Viewport className={styles.viewport}>
        {children}
      </RadixSelect.Viewport>
    </RadixSelect.Content>
  </RadixSelect.Portal>
);

export const SelectItem = ({
  className,
  children,
  ...props
}: SelectItemProps) => (
  <RadixSelect.Item className={clsx(styles.item, className)} {...props}>
    <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    <RadixSelect.ItemIndicator className={styles.indicator}>
      <Check size={12} weight="bold" />
    </RadixSelect.ItemIndicator>
  </RadixSelect.Item>
);
