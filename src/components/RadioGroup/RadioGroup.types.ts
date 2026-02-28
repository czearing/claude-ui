import type { ComponentPropsWithoutRef } from "react";
import type * as RadixRadioGroup from "@radix-ui/react-radio-group";

export type RadioGroupProps = ComponentPropsWithoutRef<
  typeof RadixRadioGroup.Root
>;

export type RadioGroupItemProps = ComponentPropsWithoutRef<
  typeof RadixRadioGroup.Item
> & {
  label?: string;
};
