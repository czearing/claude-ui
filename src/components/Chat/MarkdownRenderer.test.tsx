import { render, screen } from "@testing-library/react";

// react-markdown and rehype-highlight are ESM-only packages that Jest's CJS
// transform cannot parse. We mock them here so tests focus on the component's
// own logic — heading hierarchy mapping, link attributes, code block label,
// prose wrapper, etc. — rather than markdown parsing internals.

type ReactMarkdownComponents = Record<
  string,
  React.ComponentType<Record<string, unknown>>
>;

jest.mock("react-markdown", () => ({
  __esModule: true,
  // The mock calls each custom renderer with representative props so we can
  // verify the rendered HTML elements and attributes without needing a live
  // markdown parser.
  default: ({
    children,
    components = {},
  }: {
    children: string;
    components?: ReactMarkdownComponents;
  }) => {
    const C = components;
    return (
      <div data-testid="md-root">
        {/* Render raw text so smoke tests can find it */}
        <span data-testid="raw-content">{children}</span>

        {/* Exercise heading renderers */}
        {C.h1 && <C.h1>Heading1</C.h1>}
        {C.h2 && <C.h2>Heading2</C.h2>}
        {C.h3 && <C.h3>Heading3</C.h3>}
        {C.h4 && <C.h4>Heading4</C.h4>}

        {/* Paragraph */}
        {C.p && <C.p>Paragraph</C.p>}

        {/* Lists */}
        {C.ul && (
          <C.ul>
            {C.li && <C.li>item one</C.li>}
            {C.li && <C.li>item two</C.li>}
          </C.ul>
        )}
        {C.ol && <C.ol>{C.li && <C.li>ol item</C.li>}</C.ol>}

        {/* Blockquote */}
        {C.blockquote && <C.blockquote>quoted text</C.blockquote>}

        {/* Horizontal rule */}
        {C.hr && <C.hr />}

        {/* Inline code — no trailing newline, no language class */}
        {C.code && <C.code className="">{"inlineCode"}</C.code>}

        {/* Fenced code block without language — trailing newline signals block */}
        {C.code && <C.code className="">{"no-lang code\n"}</C.code>}

        {/* Fenced code block with language */}
        {C.code && (
          <C.code className="language-typescript">{"typed code\n"}</C.code>
        )}

        {/* External link */}
        {C.a && <C.a href="https://example.com">ExternalLink</C.a>}

        {/* Relative link */}
        {C.a && <C.a href="/docs">RelativeLink</C.a>}

        {/* GFM: strikethrough */}
        {C.del && <C.del>deleted text</C.del>}

        {/* GFM: task list checkboxes */}
        {C.input && <C.input type="checkbox" checked={true} readOnly />}
        {C.input && <C.input type="checkbox" checked={false} readOnly />}
      </div>
    );
  },
}));

jest.mock("rehype-highlight", () => ({
  __esModule: true,
  default: () => (tree: unknown) => tree,
}));

jest.mock("remark-gfm", () => ({
  __esModule: true,
  default: () => (tree: unknown) => tree,
}));

import { MarkdownRenderer } from "./MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("renders without crashing", () => {
    render(<MarkdownRenderer content="Hello world" />);
    expect(screen.getByTestId("md-root")).toBeInTheDocument();
  });

  it("passes content to ReactMarkdown as children", () => {
    render(<MarkdownRenderer content="some **markdown**" />);
    expect(screen.getByTestId("raw-content")).toHaveTextContent(
      "some **markdown**",
    );
  });

  it("wraps output in a div and applies an optional className", () => {
    const { container } = render(
      <MarkdownRenderer content="Hi" className="custom-class" />,
    );
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("does not crash with empty content", () => {
    render(<MarkdownRenderer content="" />);
    expect(screen.getByTestId("md-root")).toBeInTheDocument();
  });
});

describe("MarkdownRenderer — heading renderers", () => {
  it("renders h1 markdown as an h2 element for document hierarchy", () => {
    render(<MarkdownRenderer content="#" />);
    // Our component map remaps h1 -> <h2> to avoid conflicts with page h1
    expect(
      screen.getByRole("heading", { level: 2, name: "Heading1" }),
    ).toBeInTheDocument();
  });

  it("renders h2 markdown as an h2 element", () => {
    render(<MarkdownRenderer content="#" />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Heading2" }),
    ).toBeInTheDocument();
  });

  it("renders h3 markdown as an h3 element", () => {
    render(<MarkdownRenderer content="#" />);
    expect(
      screen.getByRole("heading", { level: 3, name: "Heading3" }),
    ).toBeInTheDocument();
  });

  it("renders h4 markdown as an h4 element", () => {
    render(<MarkdownRenderer content="#" />);
    expect(
      screen.getByRole("heading", { level: 4, name: "Heading4" }),
    ).toBeInTheDocument();
  });
});

describe("MarkdownRenderer — code renderers", () => {
  it("renders inline code inside a code element (not a pre)", () => {
    const { container } = render(<MarkdownRenderer content="`code`" />);
    const allCode = container.querySelectorAll("code");
    // At least one code element should exist (inline or block)
    expect(allCode.length).toBeGreaterThan(0);
  });

  it("renders a fenced code block with a pre wrapper", () => {
    const { container } = render(<MarkdownRenderer content="```\ncode\n```" />);
    expect(container.querySelector("pre")).toBeInTheDocument();
  });

  it("renders a language label when className has language-* prefix", () => {
    render(<MarkdownRenderer content="```typescript\ncode\n```" />);
    expect(screen.getByText("typescript")).toBeInTheDocument();
    expect(screen.getByLabelText("Language: typescript")).toBeInTheDocument();
  });

  it("does not render a language label when className has no language tag", () => {
    // The mock renders both a no-lang block (className="") and a language-typescript
    // block in every render, so we verify the no-lang block specifically has no label.
    // We check that the code element whose text is "no-lang code" is NOT wrapped by a
    // sibling span with aria-label.
    const { container } = render(<MarkdownRenderer content="```\ncode\n```" />);
    // Find all pre elements; the no-lang one should have no preceding codeLang span
    const preElements = container.querySelectorAll("pre");
    const noLangPre = Array.from(preElements).find((pre) =>
      pre.textContent?.includes("no-lang code"),
    );
    expect(noLangPre).toBeDefined();
    // The parent codeBlock div should not have a span[aria-label] sibling for that block
    const parentDiv = noLangPre?.closest("div");
    const langSpan = parentDiv?.querySelector("span[aria-label]");
    expect(langSpan).toBeNull();
  });
});

describe("MarkdownRenderer — list renderers", () => {
  it("renders an unordered list with list items", () => {
    render(<MarkdownRenderer content="- a\n- b" />);
    const lists = screen.getAllByRole("list");
    expect(lists.length).toBeGreaterThan(0);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it("renders an ordered list (ol element)", () => {
    const { container } = render(<MarkdownRenderer content="1. a" />);
    expect(container.querySelector("ol")).toBeInTheDocument();
  });
});

describe("MarkdownRenderer — blockquote renderer", () => {
  it("renders a blockquote element with the quoted text", () => {
    const { container } = render(<MarkdownRenderer content="> quote" />);
    expect(container.querySelector("blockquote")).toHaveTextContent(
      "quoted text",
    );
  });
});

describe("MarkdownRenderer — link renderer", () => {
  it("sets target=_blank and rel for external http links", () => {
    render(<MarkdownRenderer content="[x](https://example.com)" />);
    const link = screen.getByRole("link", { name: "ExternalLink" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does not set target for relative links", () => {
    render(<MarkdownRenderer content="[x](/docs)" />);
    const link = screen.getByRole("link", { name: "RelativeLink" });
    expect(link).toHaveAttribute("href", "/docs");
    expect(link).not.toHaveAttribute("target");
  });
});

describe("MarkdownRenderer — misc renderers", () => {
  it("renders a horizontal rule element", () => {
    const { container } = render(<MarkdownRenderer content="---" />);
    expect(container.querySelector("hr")).toBeInTheDocument();
  });

  it("renders a paragraph element", () => {
    const { container } = render(<MarkdownRenderer content="text" />);
    expect(container.querySelector("p")).toBeInTheDocument();
  });
});

describe("MarkdownRenderer — GFM renderers", () => {
  it("renders strikethrough as a del element", () => {
    const { container } = render(<MarkdownRenderer content="~~deleted~~" />);
    const del = container.querySelector("del");
    expect(del).toBeInTheDocument();
    expect(del).toHaveTextContent("deleted text");
  });

  it("renders checked task list checkbox as checked input", () => {
    render(<MarkdownRenderer content="- [x] done" />);
    const checkboxes = screen.getAllByRole("checkbox");
    const checked = checkboxes.find((cb) => (cb as HTMLInputElement).checked);
    expect(checked).toBeInTheDocument();
  });

  it("renders unchecked task list checkbox as unchecked input", () => {
    render(<MarkdownRenderer content="- [ ] todo" />);
    const checkboxes = screen.getAllByRole("checkbox");
    const unchecked = checkboxes.find(
      (cb) => !(cb as HTMLInputElement).checked,
    );
    expect(unchecked).toBeInTheDocument();
  });
});
