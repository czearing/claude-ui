"use client";

import * as RadixRadioGroup from "@radix-ui/react-radio-group";
import { clsx } from "clsx";

import styles from "./RadioGroup.module.css";
import type { RadioGroupItemProps, RadioGroupProps } from "./RadioGroup.types";

export const RadioGroup = ({ className, ...props }: RadioGroupProps) => (
  <RadixRadioGroup.Root className={clsx(styles.root, className)} {...props} />
);

export const RadioGroupItem = ({
  className,
  label,
  id,
  ...props
}: RadioGroupItemProps) => (
  <div className={styles.item}>
    <RadixRadioGroup.Item
      id={id}
      className={clsx(styles.radio, className)}
      {...props}
    >
      <RadixRadioGroup.Indicator className={styles.indicator} />
    </RadixRadioGroup.Item>
    {label && (
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
    )}
  </div>
);
