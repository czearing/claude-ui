"use client";

import { useState } from "react";

import { RadioGroup, RadioGroupItem } from "@/components/RadioGroup";
import styles from "./ChoicePrompt.module.css";

export interface ChoicePromptProps {
  messageId: string;
  question: string;
  options: string[];
  answered: boolean;
  onAnswer: (value: string) => void;
}

export function ChoicePrompt({
  messageId,
  question,
  options,
  answered,
  onAnswer,
}: ChoicePromptProps) {
  const [selected, setSelected] = useState<string>("");

  function handleConfirm() {
    if (!selected) {
      return;
    }
    onAnswer(selected);
  }

  return (
    <div className={styles.container}>
      <p className={styles.question}>{question}</p>

      {answered ? (
        <span className={styles.answeredChip}>{selected}</span>
      ) : (
        <>
          <RadioGroup
            className={styles.choices}
            value={selected}
            onValueChange={setSelected}
            aria-label={question}
          >
            {options.map((opt, idx) => (
              <RadioGroupItem
                key={opt}
                value={opt}
                id={`${messageId}-opt-${idx}`}
                label={opt}
              />
            ))}
          </RadioGroup>

          <button
            className={styles.confirmBtn}
            onClick={handleConfirm}
            disabled={!selected}
          >
            Confirm
          </button>
        </>
      )}
    </div>
  );
}
