import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import {
  ArrowDown,
  Bot,
  Check,
  Copy,
  LoaderCircle,
  MessageSquare,
  Sparkles,
  UserRound,
} from "lucide-react";

import type { ChatMessageRecord } from "../../shared/lib/tauri";

import "highlight.js/styles/github-dark.css";

type MessageListProps = {
  messages: ChatMessageRecord[];
  streamState: string;
  connectionState: string;
  projectLabel?: string;
  /** Legacy panel props used by OrchestratedSessionView. When provided, renders a
   *  self-contained panel with a header and fixed-height viewport instead of filling
   *  the parent container. */
  kicker?: string;
  heading?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  viewportClassName?: string;
};

function formatTimestamp(value: number) {
  return new Date(value * 1_000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getMessageLabel(message: ChatMessageRecord) {
  if (message.authorKind === "user") {
    return "You";
  }

  if (message.authorKind === "agent") {
    return "Agent";
  }

  return "Orchestrate";
}

function isStreamingMessage(message: ChatMessageRecord) {
  const metadata = message.metadataJson as Record<string, unknown> | null;
  return metadata?.partial === true || metadata?.status === "streaming";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2 py-0.5 text-[0.6rem] transition-colors hover:bg-[rgba(255,255,255,0.08)]"
      style={{ color: "rgba(255,255,255,0.62)" }}
      aria-label="Copy code"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function StreamingIndicator() {
  return (
    <div className="flex items-start gap-3 px-1 py-2">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-[rgba(59,130,246,0.18)] bg-[rgba(59,130,246,0.08)]">
        <Bot size={11} className="text-accent-blue" />
      </div>
      <div className="flex items-center gap-1.5 pt-0.5">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-blue)] animate-pulse"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-blue)] animate-pulse"
          style={{ animationDelay: "200ms" }}
        />
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-blue)] animate-pulse"
          style={{ animationDelay: "400ms" }}
        />
      </div>
    </div>
  );
}

/** Distance from bottom (in px) at which we consider the user "at the bottom". */
const SCROLL_THRESHOLD = 48;

export function MessageList({
  messages,
  streamState,
  connectionState,
  projectLabel = "this project",
  kicker,
  heading,
  emptyTitle,
  emptyDescription,
  viewportClassName,
}: MessageListProps) {
  const isPanelMode = Boolean(kicker || heading || viewportClassName);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevMessageCountRef = useRef(messages.length);

  const isStreaming =
    streamState === "live" ||
    messages.some((m) => isStreamingMessage(m));

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, []);

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setIsAtBottom(distanceFromBottom <= SCROLL_THRESHOLD);
  }, []);

  // Auto-scroll when new messages arrive, but only if user is near the bottom.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const newMessages = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (newMessages && isAtBottom) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages, isAtBottom]);

  // On first mount, scroll to bottom.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, []);

  // Shared markdown components for both modes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- react-markdown's Components type is complex; a cast is cleaner than duplicating its generics.
  const markdownComponents: Record<string, React.ComponentType<any>> & any = {
    code({ className, children, ...props }: { [key: string]: any; className?: string; children?: React.ReactNode }) {
      const match = /language-(\w+)/.exec(className ?? "");
      const language = match?.[1] ?? "code";
      const isBlockCode = Boolean(className);

      if (!isBlockCode) {
        return (
          <code
            {...props}
            className="rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.06)] px-1 py-0.5 text-[0.88em] font-mono"
            style={{ color: "var(--text-primary)" }}
          >
            {children}
          </code>
        );
      }

      const codeText = String(children).replace(/\n$/, "");

      return (
        <div className="my-2 overflow-hidden rounded-md ring-1 ring-[rgba(255,255,255,0.07)] bg-[#0d1117]">
          <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] px-3 py-1">
            <span className="text-[0.6rem] font-medium uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.45)" }}>
              {language}
            </span>
            <CopyButton text={codeText} />
          </div>
          <pre className="overflow-x-auto px-3 py-2 text-[0.75rem] leading-5 font-mono">
            <code
              {...props}
              className={className}
            >
              {children}
            </code>
          </pre>
        </div>
      );
    },
    h1({ children }: { children?: React.ReactNode }) {
      return <h3 className="mb-1 mt-2 text-sm font-semibold tracking-tight first:mt-0" style={{ color: "var(--text-primary)" }}>{children}</h3>;
    },
    h2({ children }: { children?: React.ReactNode }) {
      return <h4 className="mb-1 mt-2 text-[0.82rem] font-semibold tracking-tight first:mt-0" style={{ color: "var(--text-primary)" }}>{children}</h4>;
    },
    h3({ children }: { children?: React.ReactNode }) {
      return <h5 className="mb-1 mt-1.5 text-xs font-semibold tracking-tight first:mt-0" style={{ color: "var(--text-primary)" }}>{children}</h5>;
    },
    p({ children }: { children?: React.ReactNode }) {
      return <p className="mb-1.5 last:mb-0" style={{ color: "var(--text-primary)" }}>{children}</p>;
    },
    ul({ children }: { children?: React.ReactNode }) {
      return <ul className="mb-1.5 list-disc space-y-0.5 pl-5" style={{ color: "var(--text-primary)" }}>{children}</ul>;
    },
    ol({ children }: { children?: React.ReactNode }) {
      return <ol className="mb-1.5 list-decimal space-y-0.5 pl-5" style={{ color: "var(--text-primary)" }}>{children}</ol>;
    },
    li({ children }: { children?: React.ReactNode }) {
      return <li className="pl-0.5">{children}</li>;
    },
    a({ children, href }: { children?: React.ReactNode; href?: string }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-[rgba(129,191,255,0.35)] underline-offset-2 transition-colors hover:decoration-[rgba(129,191,255,0.6)]"
          style={{ color: "rgba(129,191,255,0.95)" }}
        >
          {children}
        </a>
      );
    },
    strong({ children }: { children?: React.ReactNode }) {
      return <strong className="font-semibold" style={{ color: "var(--text-primary)" }}>{children}</strong>;
    },
    blockquote({ children }: { children?: React.ReactNode }) {
      return (
        <blockquote className="my-1.5 border-l-2 border-[rgba(255,255,255,0.1)] pl-3 italic" style={{ color: "var(--text-secondary)" }}>
          {children}
        </blockquote>
      );
    },
    hr() {
      return <hr className="my-2 border-[rgba(255,255,255,0.06)]" />;
    },
  };

  const renderMessage = (message: ChatMessageRecord) => {
    const isUser = message.authorKind === "user";
    const streaming = isStreamingMessage(message);

    return (
      <article
        key={message.id}
        className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      >
        <div
          className={`relative max-w-[min(44rem,90%)] overflow-hidden rounded-[1.2rem] border px-4 py-3 ${
            isUser
              ? "border-[rgba(59,130,246,0.22)] bg-[linear-gradient(180deg,rgba(59,130,246,0.18),rgba(20,28,42,0.94))] shadow-[0_18px_40px_rgba(2,8,23,0.26)]"
              : "border-[var(--surface-border-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(11,14,20,0.92))] shadow-[0_18px_34px_rgba(0,0,0,0.22)]"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full border ${
                isUser
                  ? "border-[rgba(59,130,246,0.3)] bg-[rgba(59,130,246,0.14)]"
                  : "border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.04)]"
              }`}>
                {isUser ? (
                  <UserRound size={11} className="text-accent-blue" />
                ) : (
                  <Bot size={11} style={{ color: "var(--text-muted)" }} />
                )}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[0.72rem] font-semibold tracking-tight" style={{ color: "var(--text-strong)" }}>
                    {getMessageLabel(message)}
                  </span>
                  {streaming ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(59,130,246,0.18)] bg-[rgba(59,130,246,0.08)] px-2 py-0.5 text-[0.58rem] font-medium uppercase tracking-[0.16em] text-[rgba(191,219,254,0.95)]">
                      Live
                    </span>
                  ) : null}
                </div>
                <span className="mt-0.5 block text-[0.62rem] uppercase tracking-[0.18em]" style={{ color: "var(--text-subtle)" }}>
                  {isUser ? "Operator" : "Assistant"}
                </span>
              </div>
            </div>

            <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-2 py-1 text-[0.6rem] font-medium uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
              {formatTimestamp(message.createdAt)}
            </span>
          </div>

          <div className="dispatch-markdown mt-2 text-[0.82rem] leading-[1.65]">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={markdownComponents}
            >
              {message.bodyMarkdown}
            </ReactMarkdown>
          </div>
        </div>
      </article>
    );
  };

  // ── Panel mode (used by OrchestratedSessionView) ──
  if (isPanelMode) {
    const liveBadge = connectionState !== "connected"
      ? connectionState
      : streamState === "degraded"
        ? "Degraded cache"
        : streamState === "live"
          ? "Live stream"
          : "Cache";

    return (
      <section className="flex min-h-[20rem] flex-col rounded-[1.2rem] border border-[var(--surface-border-soft)] bg-[rgba(9,11,16,0.74)] px-3 py-3">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--surface-border-soft)] pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <p className="dispatch-text-muted text-[0.65rem] font-semibold uppercase tracking-[0.22em]">
              {kicker ?? "Conversation"}
            </p>
            <span className="dispatch-text-primary truncate text-[0.82rem] font-medium">
              {heading ?? "Transcript"}
            </span>
          </div>

          <span className="dispatch-text-muted inline-flex items-center gap-1.5 rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-2 py-1 text-[0.62rem]">
            {connectionState === "connected"
              ? <Sparkles size={10} />
              : <LoaderCircle size={10} className={connectionState === "connecting" || connectionState === "reconnecting" ? "animate-spin" : ""} />}
            {liveBadge}
          </span>
        </div>

        <div
          ref={viewportRef}
          onScroll={handleScroll}
          className={`mt-3 flex flex-1 ${viewportClassName ?? "max-h-[32rem]"} flex-col gap-3 overflow-auto pr-1`}
        >
          {messages.length === 0 ? (
            <p className="dispatch-text-muted rounded-[1rem] border border-[var(--surface-border-faint)] bg-[rgba(255,255,255,0.02)] px-3 py-3 text-xs">
              {emptyTitle ?? "Waiting for the first message"} — {emptyDescription ?? "Chat history is cached locally and refreshed from the OpenClaw snapshot on a timer."}
            </p>
          ) : null}

          {messages.map(renderMessage)}

          {isStreaming && !messages.some((m) => isStreamingMessage(m)) ? (
            <StreamingIndicator />
          ) : null}
        </div>
      </section>
    );
  }

  // ── Chat mode (transcript-dominant, fills parent) ──
  return (
    <div className="relative flex h-full flex-col bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.06),transparent_28%),linear-gradient(180deg,rgba(8,10,15,0.34),rgba(8,10,15,0.12))]">
      <div
        ref={viewportRef}
        onScroll={handleScroll}
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-[1.5rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.02)] py-14">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[rgba(59,130,246,0.18)] bg-[rgba(59,130,246,0.1)]">
              <MessageSquare size={18} className="text-accent-blue" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
                Start a conversation
              </p>
              <p className="mt-1 max-w-sm text-xs leading-5" style={{ color: "var(--text-muted)" }}>
                Ask anything about {projectLabel}
              </p>
            </div>
          </div>
        ) : null}

        {messages.map(renderMessage)}

        {isStreaming && !messages.some((m) => isStreamingMessage(m)) ? (
          <StreamingIndicator />
        ) : null}
      </div>

      {/* Scroll-to-bottom button */}
      {!isAtBottom && messages.length > 0 ? (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border border-[var(--surface-border-soft)] bg-[rgba(12,15,22,0.94)] px-3 py-1.5 text-[0.68rem] font-medium shadow-lg transition-all hover:scale-105"
          style={{
            color: "var(--text-secondary)",
          }}
          aria-label="Scroll to bottom"
        >
          <ArrowDown size={12} />
          <span>New messages</span>
        </button>
      ) : null}
    </div>
  );
}
