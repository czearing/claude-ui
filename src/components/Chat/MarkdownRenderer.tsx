import type { HTMLAttributes } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import styles from "./MarkdownRenderer.module.css";

export interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Custom element renderers
// ---------------------------------------------------------------------------

interface CodeProps extends HTMLAttributes<HTMLElement> {
  className?: string;
  children?: React.ReactNode;
}

// react-markdown v10 removed the `inline` prop. Block code (fenced) always
// has a trailing newline in its children string; inline code does not.
function CodeBlock({ className, children, ...rest }: CodeProps) {
  const lang = /language-(\w+)/.exec(className ?? "")?.[1];
  const childStr = typeof children === "string" ? children : "";
  const isBlock = Boolean(lang) || childStr.endsWith("\n");

  if (!isBlock) {
    return (
      <code className={styles.inlineCode} {...rest}>
        {children}
      </code>
    );
  }

  return (
    <div className={styles.codeBlock}>
      {lang && (
        <span className={styles.codeLang} aria-label={`Language: ${lang}`}>
          {lang}
        </span>
      )}
      <pre>
        <code className={className} {...rest}>
          {childStr.replace(/\n$/, "")}
        </code>
      </pre>
    </div>
  );
}

function ExternalLink({
  href,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const isExternal = href?.startsWith("http");
  return (
    <a
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      className={styles.link}
      {...rest}
    >
      {children}
    </a>
  );
}

// Passthrough for pre — CodeBlock already renders its own pre, so we suppress
// the extra pre that react-markdown would otherwise add around code blocks.
// Casting to ReactElement satisfies the component return type without a wrapper.
function PrePassthrough({ children }: { children?: React.ReactNode }) {
  return children as React.ReactElement;
}

// ---------------------------------------------------------------------------
// Component map
// ---------------------------------------------------------------------------

const COMPONENTS: Components = {
  // headings — enforce hierarchy within the prose area
  h1: ({ children }) => <h2 className={styles.h1}>{children}</h2>,
  h2: ({ children }) => <h2 className={styles.h2}>{children}</h2>,
  h3: ({ children }) => <h3 className={styles.h3}>{children}</h3>,
  h4: ({ children }) => <h4 className={styles.h4}>{children}</h4>,
  p: ({ children }) => <p className={styles.p}>{children}</p>,
  ul: ({ children }) => <ul className={styles.ul}>{children}</ul>,
  ol: ({ children }) => <ol className={styles.ol}>{children}</ol>,
  li: ({ children }) => <li className={styles.li}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className={styles.blockquote}>{children}</blockquote>
  ),
  hr: () => <hr className={styles.hr} />,
  table: ({ children }) => (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th className={styles.th}>{children}</th>,
  td: ({ children }) => <td className={styles.td}>{children}</td>,
  a: ExternalLink,
  code: CodeBlock as Components["code"],
  pre: PrePassthrough,
  // GFM: strikethrough
  del: ({ children }) => <del className={styles.del}>{children}</del>,
  // GFM: task list checkboxes — react-markdown emits <input type="checkbox">
  // inside list items for `- [ ]` and `- [x]` syntax.
  input: ({ type, checked }: React.InputHTMLAttributes<HTMLInputElement>) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={checked}
        readOnly
        className={styles.taskCheckbox}
      />
    ) : null,
};

// ---------------------------------------------------------------------------
// MarkdownRenderer
// ---------------------------------------------------------------------------

export function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  const classes = className ? `${styles.prose} ${className}` : styles.prose;

  return (
    <div className={classes}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
