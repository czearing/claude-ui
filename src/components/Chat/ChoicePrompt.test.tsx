import { Children, isValidElement, cloneElement } from "react";
import type { ReactNode, ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Radix UI's RadioGroup uses browser APIs not available in jsdom.
// Mock it with a plain controlled input group that has the same external API.
jest.mock("@radix-ui/react-radio-group", () => {
  const Root = ({
    children,
    value,
    onValueChange,
    "aria-label": ariaLabel,
  }: {
    children: ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
    "aria-label"?: string;
  }) => (
    <div role="radiogroup" aria-label={ariaLabel} data-value={value}>
      {Children.map(children, (child) =>
        isValidElement(child)
          ? cloneElement(
              child as ReactElement<{
                onValueChange?: (v: string) => void;
              }>,
              { onValueChange },
            )
          : child,
      )}
    </div>
  );

  const Item = ({
    id,
    value,
    children,
    onValueChange,
  }: {
    id?: string;
    value: string;
    children?: ReactNode;
    onValueChange?: (v: string) => void;
  }) => (
    <button
      id={id}
      role="radio"
      aria-checked={false}
      onClick={() => onValueChange?.(value)}
    >
      {children}
    </button>
  );

  const Indicator = ({ children }: { children?: ReactNode }) => (
    <span>{children}</span>
  );

  return { Root, Item, Indicator };
});

import { ChoicePrompt } from "./ChoicePrompt";

const OPTIONS = ["Option A", "Option B", "Option C"];
const QUESTION = "Which approach do you prefer?";
const MESSAGE_ID = "msg-001";

describe("ChoicePrompt", () => {
  it("renders the question text", () => {
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answered={false}
        onAnswer={jest.fn()}
      />,
    );
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
  });

  it("renders all options as radio buttons", () => {
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answered={false}
        onAnswer={jest.fn()}
      />,
    );
    expect(screen.getByRole("radio", { name: "Option A" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Option B" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Option C" })).toBeInTheDocument();
  });

  it("renders a Confirm button", () => {
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answered={false}
        onAnswer={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("Confirm button is disabled before any option is selected", () => {
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answered={false}
        onAnswer={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("Confirm button is enabled after selecting an option", async () => {
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answered={false}
        onAnswer={jest.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Option B" }));
    expect(screen.getByRole("button", { name: "Confirm" })).not.toBeDisabled();
  });

  it("clicking Confirm calls onAnswer with the selected value", async () => {
    const onAnswer = jest.fn();
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answered={false}
        onAnswer={onAnswer}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Option C" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("Option C");
  });

  it("does not render radio buttons when answered", () => {
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answered={true}
        onAnswer={jest.fn()}
      />,
    );
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("does not render the Confirm button when answered", () => {
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answered={true}
        onAnswer={jest.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Confirm" }),
    ).not.toBeInTheDocument();
  });
});
