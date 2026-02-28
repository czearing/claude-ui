"use client";

import { useState } from "react";

import { RadioGroup, RadioGroupItem } from "@/components/RadioGroup";
import styles from "./ChoicePrompt.module.css";

export interface ChoiceOption {
  label: string;
  description?: string;
}

export interface ChoicePromptProps {
  messageId: string;
  question: string;
  options: ChoiceOption[];
  // null = not yet answered; string = the label that was confirmed
  answeredValue: string | null;
  // true while the task is actively running — prevents sending mid-session
  disabled?: boolean;
  onAnswer: (value: string) => void;
}

export function ChoicePrompt({
  messageId,
  question,
  options,
  answeredValue,
  disabled = false,
  onAnswer,
}: ChoicePromptProps) {
  const [selected, setSelected] = useState<string>("");

  function handleConfirm() {
    if (selected && !disabled) {
      onAnswer(selected);
    }
  }

  return (
    <div className={styles.container}>
      <p className={styles.question}>{question}</p>

      {answeredValue !== null ? (
        <span className={styles.answeredChip}>{answeredValue}</span>
      ) : (
        <>
          <RadioGroup
            className={styles.choices}
            value={selected}
            onValueChange={disabled ? undefined : setSelected}
            aria-label={question}
          >
            {options.map((opt, idx) => (
              <div key={opt.label} className={styles.optionWrapper}>
                <RadioGroupItem
                  value={opt.label}
                  id={`${messageId}-opt-${idx}`}
                  label={opt.label}
                  disabled={disabled}
                />
                {opt.description && (
                  <p className={styles.optionDescription}>{opt.description}</p>
                )}
              </div>
            ))}
          </RadioGroup>

          <button
            className={styles.confirmBtn}
            onClick={handleConfirm}
            disabled={!selected || disabled}
          >
            Confirm
          </button>
        </>
      )}
    </div>
  );
}
