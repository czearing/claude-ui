import React from "react";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Radix UI's RadioGroup uses browser APIs not available in jsdom.
// Mock with a context-based approach so onValueChange reaches Item at any depth.
jest.mock("@radix-ui/react-radio-group", () => {
  const Ctx = React.createContext<((v: string) => void) | undefined>(undefined);

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
    <Ctx.Provider value={onValueChange}>
      <div role="radiogroup" aria-label={ariaLabel} data-value={value}>
        {children}
      </div>
    </Ctx.Provider>
  );

  const Item = ({
    id,
    value,
    children,
    disabled,
  }: {
    id?: string;
    value: string;
    children?: ReactNode;
    disabled?: boolean;
  }) => {
    const onValueChange = React.useContext(Ctx);
    return (
      <button
        id={id}
        role="radio"
        aria-checked={false}
        disabled={disabled}
        onClick={() => !disabled && onValueChange?.(value)}
      >
        {children}
      </button>
    );
  };

  const Indicator = ({ children }: { children?: ReactNode }) => (
    <span>{children}</span>
  );

  return { Root, Item, Indicator };
});

import { ChoicePrompt } from "./ChoicePrompt";

const OPTIONS = [
  { label: "Option A", description: "Description for A" },
  { label: "Option B", description: "Description for B" },
  { label: "Option C" },
];
const QUESTION = "Which approach do you prefer?";
const MESSAGE_ID = "msg-001";

describe("ChoicePrompt", () => {
  it("renders the question text", () => {
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answeredValue={null}
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
        answeredValue={null}
        onAnswer={jest.fn()}
      />,
    );
    expect(screen.getByRole("radio", { name: "Option A" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Option B" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Option C" })).toBeInTheDocument();
  });

  it("renders option descriptions when present", () => {
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answeredValue={null}
        onAnswer={jest.fn()}
      />,
    );
    expect(screen.getByText("Description for A")).toBeInTheDocument();
    expect(screen.getByText("Description for B")).toBeInTheDocument();
    // Option C has no description — should not render an empty element
    expect(screen.queryByText("Description for C")).not.toBeInTheDocument();
  });

  it("renders a Confirm button", () => {
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answeredValue={null}
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
        answeredValue={null}
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
        answeredValue={null}
        onAnswer={jest.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Option B" }));
    expect(screen.getByRole("button", { name: "Confirm" })).not.toBeDisabled();
  });

  it("clicking Confirm calls onAnswer with the selected label", async () => {
    const onAnswer = jest.fn();
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answeredValue={null}
        onAnswer={onAnswer}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Option C" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("Option C");
  });

  it("does not render radio buttons when answeredValue is set", () => {
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answeredValue="Option A"
        onAnswer={jest.fn()}
      />,
    );
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("does not render the Confirm button when answeredValue is set", () => {
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answeredValue="Option A"
        onAnswer={jest.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Confirm" }),
    ).not.toBeInTheDocument();
  });

  it("shows the answered label in the chip", () => {
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answeredValue="Option B"
        onAnswer={jest.fn()}
      />,
    );
    expect(screen.getByText("Option B")).toBeInTheDocument();
  });

  it("disables radio buttons and Confirm when disabled prop is true", () => {
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answeredValue={null}
        disabled={true}
        onAnswer={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Option A" })).toBeDisabled();
  });

  it("does not call onAnswer when disabled", async () => {
    const onAnswer = jest.fn();
    render(
      <ChoicePrompt
        messageId={MESSAGE_ID}
        question={QUESTION}
        options={OPTIONS}
        answeredValue={null}
        disabled={true}
        onAnswer={onAnswer}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Option A" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
