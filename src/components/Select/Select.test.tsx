import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import {
  Select,
  SelectCaret,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./Select";

function TestSelect({
  defaultValue = "a",
  onChange = jest.fn(),
}: {
  defaultValue?: string;
  onChange?: (v: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    >
      <SelectTrigger aria-label="Pick option">
        <SelectValue />
        <SelectCaret />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">Option A</SelectItem>
        <SelectItem value="b">Option B</SelectItem>
        <SelectItem value="c">Option C</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe("Select", () => {
  it("renders a combobox trigger with the given aria-label", () => {
    render(<TestSelect />);
    expect(
      screen.getByRole("combobox", { name: "Pick option" }),
    ).toBeInTheDocument();
  });

  it("displays the current selected value in the trigger", () => {
    render(<TestSelect defaultValue="b" />);
    expect(
      screen.getByRole("combobox", { name: "Pick option" }),
    ).toHaveTextContent("Option B");
  });

  it("opens the listbox when the trigger is clicked", async () => {
    render(<TestSelect />);
    await userEvent.click(
      screen.getByRole("combobox", { name: "Pick option" }),
    );
    expect(
      await screen.findByRole("option", { name: "Option A" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("option", { name: "Option B" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("option", { name: "Option C" }),
    ).toBeVisible();
  });

  it("calls onValueChange and updates the displayed value when an option is selected", async () => {
    const onChange = jest.fn();
    render(<TestSelect onChange={onChange} />);
    await userEvent.click(
      screen.getByRole("combobox", { name: "Pick option" }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "Option B" }),
    );
    expect(onChange).toHaveBeenCalledWith("b");
    expect(
      screen.getByRole("combobox", { name: "Pick option" }),
    ).toHaveTextContent("Option B");
  });
});
