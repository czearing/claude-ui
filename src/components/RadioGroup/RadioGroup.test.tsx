import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RadioGroup, RadioGroupItem } from "./RadioGroup";

function TestRadioGroup({
  defaultValue = "a",
  onChange = jest.fn(),
  disabled = false,
}: {
  defaultValue?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    >
      <RadioGroupItem
        value="a"
        id="opt-a"
        label="Option A"
        disabled={disabled}
      />
      <RadioGroupItem value="b" id="opt-b" label="Option B" />
      <RadioGroupItem value="c" id="opt-c" label="Option C" />
    </RadioGroup>
  );
}

describe("RadioGroup", () => {
  it("renders all radio options", () => {
    render(<TestRadioGroup />);
    expect(screen.getByRole("radio", { name: "Option A" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Option B" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Option C" })).toBeInTheDocument();
  });

  it("checks the default value on mount", () => {
    render(<TestRadioGroup defaultValue="b" />);
    expect(screen.getByRole("radio", { name: "Option B" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Option A" })).not.toBeChecked();
  });

  it("calls onValueChange and updates checked state when a radio is selected", async () => {
    const onChange = jest.fn();
    render(<TestRadioGroup onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Option B" }));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.getByRole("radio", { name: "Option B" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Option A" })).not.toBeChecked();
  });

  it("clicking the label selects the corresponding radio", async () => {
    const onChange = jest.fn();
    render(<TestRadioGroup onChange={onChange} />);
    await userEvent.click(screen.getByText("Option C"));
    expect(onChange).toHaveBeenCalledWith("c");
    expect(screen.getByRole("radio", { name: "Option C" })).toBeChecked();
  });

  it("does not call onValueChange when a disabled radio is clicked", async () => {
    const onChange = jest.fn();
    render(<TestRadioGroup onChange={onChange} disabled />);
    await userEvent.click(screen.getByRole("radio", { name: "Option A" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders without a label when label prop is omitted", () => {
    render(
      <RadioGroup defaultValue="x">
        <RadioGroupItem value="x" id="no-label" />
      </RadioGroup>,
    );
    expect(screen.getByRole("radio")).toBeInTheDocument();
    expect(screen.queryByRole("label")).not.toBeInTheDocument();
  });
});
