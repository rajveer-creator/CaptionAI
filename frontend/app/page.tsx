"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AuthStatus from "./components/AuthStatus";
import { createClient } from "@/lib/supabase/client";
import type { User, Session, AuthChangeEvent, AuthError } from "@supabase/supabase-js";

type Platform = "Instagram" | "YouTube" | "Facebook" | "LinkedIn";
type Tone =
  | "Engaging"
  | "Funny"
  | "Professional"
  | "Motivational"
  | "Casual";
type Language = "Hinglish" | "English" | "Hindi";

type CaptionResponse = {
  status?: string;
  id?: number;
  topic: string;
  platform: string;
  tone?: string;
  language?: string;
  captions?: string;
  caption_text?: string;
  created_at?: string;
};

type HistoryResponse = {
  status: string;
  total: number;
  limit?: number;
  offset?: number;
  captions: CaptionResponse[];
};

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const PAGE_SIZE = 20;

const SAMPLE_PROMPTS = [
  "Mountain hiking weekend getaway",
  "Launching our new AI productivity tool",
  "Monday morning coffee thoughts",
  "Behind the scenes of our creative studio",
];

// Authenticated request helper
async function authenticatedFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const supabase = createClient();

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Please log in to use CaptionAI.");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);

  return fetch(`${API}${path}`, {
    ...init,
    headers,
  });
}

export default function Home() {
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState<Platform>("Instagram");
  const [tone, setTone] = useState<Tone>("Engaging");
  const [language, setLanguage] = useState<Language>("Hinglish");

  const [result, setResult] = useState<CaptionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyAnnouncement, setCopyAnnouncement] = useState("");

  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [history, setHistory] = useState<CaptionResponse[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Monotonically increasing token to invalidate in-flight async requests on logout/user-switch
  const activeSessionIdRef = useRef(0);
  const currentUserIdRef = useRef<string | null>(null);

  function getCaptionText(item: CaptionResponse): string {
    return item.caption_text ?? item.captions ?? "";
  }

  // Centralized, bulletproof user data cleanup
  const clearUserData = useCallback(() => {
    // Invalidate any in-flight requests from the previous session immediately
    activeSessionIdRef.current += 1;
    currentUserIdRef.current = null;

    setUser(null);
    setTopic("");
    setResult(null);
    setHistory([]);
    setHistoryTotal(0);
    setError("");
    setHistoryError("");
    setCopiedId(null);
    setCopyAnnouncement("");
    setLoading(false);
    setHistoryLoading(false);
    setLoadingMore(false);
    setDeletingId(null);
    setAuthChecked(true);
  }, []);

  // Load history from the backend with pagination and session guards
  const loadHistory = useCallback(
    async (reset = false, targetSessionId?: number, targetUserId?: string) => {
      const sessionId = targetSessionId ?? activeSessionIdRef.current;
      const requestUserId = targetUserId ?? currentUserIdRef.current;

      if (!requestUserId) return;

      setHistoryLoading(true);
      setHistoryError("");

      try {
        const response = await authenticatedFetch(
          `/captions?limit=${PAGE_SIZE}&offset=0`
        );
        const data: HistoryResponse & { detail?: string } =
          await response.json();

        // Guard: Drop if session was invalidated (logged out or user switched)
        if (
          sessionId !== activeSessionIdRef.current ||
          !currentUserIdRef.current ||
          currentUserIdRef.current !== requestUserId
        ) {
          return;
        }

        if (!response.ok) {
          throw new Error(data.detail || "Could not load caption history.");
        }

        const items = Array.isArray(data.captions) ? data.captions : [];
        setHistory(items);
        setHistoryTotal(
          typeof data.total === "number" ? data.total : items.length
        );
      } catch (err) {
        if (
          sessionId !== activeSessionIdRef.current ||
          !currentUserIdRef.current ||
          currentUserIdRef.current !== requestUserId
        ) {
          return;
        }
        if (reset) {
          setHistory([]);
          setHistoryTotal(0);
        }
        setHistoryError(
          err instanceof Error
            ? err.message
            : "Could not connect to the backend. Make sure FastAPI is running."
        );
      } finally {
        if (sessionId === activeSessionIdRef.current) {
          setHistoryLoading(false);
        }
      }
    },
    []
  );

  // Fetch more history with ID-based deduplication and session guards
  async function loadMoreHistory() {
    if (loadingMore || history.length >= historyTotal) return;

    const sessionId = activeSessionIdRef.current;
    const requestUserId = currentUserIdRef.current;
    if (!requestUserId) return;

    setLoadingMore(true);
    setHistoryError("");

    try {
      const offset = history.length;
      const response = await authenticatedFetch(
        `/captions?limit=${PAGE_SIZE}&offset=${offset}`
      );
      const data: HistoryResponse & { detail?: string } =
        await response.json();

      // Guard: Drop if session was invalidated
      if (
        sessionId !== activeSessionIdRef.current ||
        !currentUserIdRef.current ||
        currentUserIdRef.current !== requestUserId
      ) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.detail || "Could not load more captions.");
      }

      const incoming = Array.isArray(data.captions) ? data.captions : [];

      // Safely deduplicate incoming captions by stable ID
      setHistory((prev) => {
        const existingIds = new Set(
          prev.map((item) => item.id).filter((id): id is number => id !== undefined)
        );
        const uniqueIncoming = incoming.filter(
          (item) => item.id === undefined || !existingIds.has(item.id)
        );
        return [...prev, ...uniqueIncoming];
      });

      if (typeof data.total === "number") {
        setHistoryTotal(data.total);
      }
    } catch (err) {
      if (
        sessionId !== activeSessionIdRef.current ||
        !currentUserIdRef.current ||
        currentUserIdRef.current !== requestUserId
      ) {
        return;
      }
      setHistoryError(
        err instanceof Error
          ? err.message
          : "Could not load additional captions."
      );
    } finally {
      if (sessionId === activeSessionIdRef.current) {
        setLoadingMore(false);
      }
    }
  }

  // Manage auth state and user-isolated data lifecycle
  useEffect(() => {
    let ignore = false;
    const supabase = createClient();

    // 1. Check current session
    supabase.auth
      .getSession()
      .then(
        ({
          data: { session },
          error,
        }: {
          data: { session: Session | null };
          error: AuthError | null;
        }) => {
          if (ignore) return;
          if (error || !session?.user) {
            clearUserData();
            return;
          }

          // If onAuthStateChange already handled this user, avoid duplicate fetch
          if (currentUserIdRef.current === session.user.id) {
            setAuthChecked(true);
            return;
          }

          currentUserIdRef.current = session.user.id;
          setUser(session.user);
          setAuthChecked(true);
          void loadHistory(true, activeSessionIdRef.current, session.user.id);
        }
      );

    // 2. React to auth changes (login, logout, token refresh, user switch)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (ignore) return;
        const nextUser = session?.user ?? null;

        // Handle explicit logout event or null session
        if (event === "SIGNED_OUT" || !nextUser) {
          clearUserData();
          return;
        }

        // Handle user account switch or initial sign in
        if (nextUser.id !== currentUserIdRef.current) {
          clearUserData();
          currentUserIdRef.current = nextUser.id;
          setUser(nextUser);
          void loadHistory(true, activeSessionIdRef.current, nextUser.id);
        } else {
          currentUserIdRef.current = nextUser.id;
          setUser(nextUser);
          setAuthChecked(true);
        }
      }
    );

    return () => {
      ignore = true;
      subscription.unsubscribe();
    };
  }, [clearUserData, loadHistory]);

  // Generate captions with session race-condition guards
  async function generateCaptions() {
    if (topic.trim().length < 2) {
      setError("Please enter a topic with at least 2 characters.");
      return;
    }

    const sessionId = activeSessionIdRef.current;
    const requestUserId = currentUserIdRef.current;

    setLoading(true);
    setError("");
    setResult(null);
    setCopiedId(null);

    try {
      const response = await authenticatedFetch("/generate-caption", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: topic.trim(),
          platform,
          tone,
          language,
        }),
      });

      const data: CaptionResponse & { detail?: string } =
        await response.json();

      // Guard: Drop response if user logged out or switched while generation was pending
      if (
        sessionId !== activeSessionIdRef.current ||
        !currentUserIdRef.current ||
        currentUserIdRef.current !== requestUserId
      ) {
        return;
      }

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Caption generation failed. Please try again."
        );
      }

      setResult(data);
      // Prepend to history library with deduplication
      setHistory((prev) => [data, ...prev.filter((c) => c.id !== data.id)]);
      setHistoryTotal((prev) => prev + 1);
    } catch (err) {
      if (
        sessionId !== activeSessionIdRef.current ||
        !currentUserIdRef.current ||
        currentUserIdRef.current !== requestUserId
      ) {
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : "Could not connect to the backend. Make sure FastAPI is running."
      );
    } finally {
      if (sessionId === activeSessionIdRef.current) {
        setLoading(false);
      }
    }
  }

  // Keyboard shortcut: Ctrl+Enter or Cmd+Enter to generate
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!loading && topic.trim().length >= 2) {
        void generateCaptions();
      }
    }
  }

  // Copy caption text with accessible feedback
  async function copyCaptions(item: CaptionResponse, copyId: string) {
    const text = getCaptionText(item).trim();

    if (!text) {
      setError("Caption text is empty. Please refresh or generate again.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(copyId);
      setCopyAnnouncement("Captions copied to clipboard.");
      setError("");

      window.setTimeout(() => {
        setCopiedId((current) => (current === copyId ? null : current));
        setCopyAnnouncement("");
      }, 2000);
    } catch {
      setError(
        "Copy failed. Please allow clipboard access or copy the text manually."
      );
    }
  }

  // Delete only the current user's caption
  async function deleteCaption(id: number) {
    const confirmed = window.confirm(
      "Are you sure you want to permanently delete this caption?"
    );

    if (!confirmed) return;

    const sessionId = activeSessionIdRef.current;
    const requestUserId = currentUserIdRef.current;
    if (!requestUserId) return;

    setDeletingId(id);
    setHistoryError("");

    try {
      const response = await authenticatedFetch(`/captions/${id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      // Guard: Drop if session was invalidated (logged out or user switched)
      if (
        sessionId !== activeSessionIdRef.current ||
        !currentUserIdRef.current ||
        currentUserIdRef.current !== requestUserId
      ) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.detail || "Could not delete caption.");
      }

      setHistory((previous) => previous.filter((item) => item.id !== id));
      setHistoryTotal((previous) => Math.max(0, previous - 1));

      if (result?.id === id) {
        setResult(null);
      }
    } catch (err) {
      if (
        sessionId !== activeSessionIdRef.current ||
        !currentUserIdRef.current ||
        currentUserIdRef.current !== requestUserId
      ) {
        return;
      }
      setHistoryError(
        err instanceof Error ? err.message : "Could not delete caption."
      );
    } finally {
      if (sessionId === activeSessionIdRef.current) {
        setDeletingId(null);
      }
    }
  }

  function formatDate(value?: string) {
    if (!value) return "Date unavailable";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Date unavailable";
    }

    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getPlatformBadgeClass(plat: string) {
    switch (plat.toLowerCase()) {
      case "instagram":
        return "badge-instagram";
      case "youtube":
        return "badge-youtube";
      case "linkedin":
        return "badge-linkedin";
      case "facebook":
        return "badge-facebook";
      default:
        return "badge-default";
    }
  }

  return (
    <main className="app-shell">
      {/* Screen reader live announcement */}
      <div className="sr-only" role="status" aria-live="polite">
        {copyAnnouncement}
      </div>

      <nav className="navbar" aria-label="Main Navigation">
        <Link className="brand" href="/" aria-label="CaptionAI Home">
          <span className="brand-icon" aria-hidden="true">✦</span>
          <span>
            Caption<span className="brand-accent">AI</span>
          </span>
        </Link>

        <div className="flex items-center gap-3 sm:gap-5">
          <div className="nav-status hidden sm:inline-flex" title="Engine operational">
            <span className="status-dot" aria-hidden="true" />
            AI Studio
          </div>
          <AuthStatus onLogout={clearUserData} />
        </div>
      </nav>

      <section className="hero">
        <div className="eyebrow">
          <span aria-hidden="true">✦</span> PROFESSIONAL SOCIAL MEDIA AI
        </div>

        <h1>
          Words that make
          <br />
          <span>you stand out.</span>
        </h1>

        <p className="hero-description">
          Generate scroll-stopping, high-converting captions tailored for
          Instagram, YouTube, LinkedIn, and Facebook in seconds.
        </p>
      </section>

      <section className="workspace" aria-label="Caption Generator Workspace">
        {/* Left Panel: Form */}
        <div className="form-panel">
          <div className="section-heading">
            <div>
              <span className="step-label">01 / CREATE</span>
              <h2>Describe your post</h2>
            </div>
            <span className="sparkle" aria-hidden="true">✧</span>
          </div>

          <label htmlFor="topic" className="field-label">
            What is your post about?
          </label>

          <textarea
            id="topic"
            className="topic-input"
            placeholder="e.g. 5 lessons from bootstrapping my design agency to $10k MRR..."
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={500}
            rows={4}
            aria-describedby="topic-hint"
          />

          <div id="topic-hint" className="input-footer">
            <span className="shortcut-hint">
              <kbd className="kbd">Ctrl</kbd> + <kbd className="kbd">Enter</kbd> to generate
            </span>
            <span
              className={`character-count ${
                topic.length >= 450 ? "count-warning" : ""
              }`}
            >
              {topic.length}/500
            </span>
          </div>

          {/* Quick Idea Starters */}
          <div className="prompt-starters">
            <span className="starters-label">Try an idea:</span>
            <div className="starters-list">
              {SAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="starter-chip"
                  onClick={() => {
                    setTopic(prompt);
                    setError("");
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="field-group">
            <label htmlFor="platform" className="field-label">
              Target Platform
            </label>
            <div className="select-wrapper">
              <select
                id="platform"
                className="select-input"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform)}
              >
                <option value="Instagram">📸 Instagram</option>
                <option value="YouTube">▶ YouTube</option>
                <option value="LinkedIn">💼 LinkedIn</option>
                <option value="Facebook">📘 Facebook</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field-group flex-1">
              <label htmlFor="tone" className="field-label">
                Vibe & Tone
              </label>
              <div className="select-wrapper">
                <select
                  id="tone"
                  className="select-input"
                  value={tone}
                  onChange={(e) => setTone(e.target.value as Tone)}
                >
                  <option value="Engaging">✨ Engaging</option>
                  <option value="Funny">😂 Funny</option>
                  <option value="Professional">💼 Professional</option>
                  <option value="Motivational">🚀 Motivational</option>
                  <option value="Casual">😎 Casual</option>
                </select>
              </div>
            </div>

            <div className="field-group flex-1">
              <label htmlFor="language" className="field-label">
                Language
              </label>
              <div className="select-wrapper">
                <select
                  id="language"
                  className="select-input"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as Language)}
                >
                  <option value="Hinglish">Hinglish</option>
                  <option value="English">English</option>
                  <option value="Hindi">Hindi</option>
                </select>
              </div>
            </div>
          </div>

          {error && (
            <div className="error-message" role="alert">
              <div className="flex items-start gap-2">
                <span className="text-red-400 font-bold" aria-hidden="true">⚠</span>
                <span className="flex-1">{error}</span>
                <button
                  type="button"
                  onClick={() => setError("")}
                  className="text-red-300 hover:text-white text-xs px-1"
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
              {!user && (
                <div className="mt-2 text-xs">
                  <Link href="/login" className="font-semibold underline text-purple-300 hover:text-purple-200">
                    Log in here
                  </Link>{" "}
                  or{" "}
                  <Link href="/signup" className="font-semibold underline text-purple-300 hover:text-purple-200">
                    create an account
                  </Link>{" "}
                  to start generating.
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            className="generate-button"
            onClick={generateCaptions}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? (
              <>
                <span className="spinner" aria-hidden="true" />
                <span>Crafting your captions...</span>
              </>
            ) : (
              <>
                <span>Generate Captions</span>
                <span className="button-arrow" aria-hidden="true">↗</span>
              </>
            )}
          </button>

          <p className="privacy-note">
            ✦ Powered by Groq AI · Instant multi-caption generation
          </p>
        </div>

        {/* Right Panel: Result */}
        <div className="result-panel" aria-live="polite">
          <div className="section-heading result-heading">
            <div>
              <span className="step-label">02 / STUDIO OUTPUT</span>
              <h2>Ready for your audience</h2>
            </div>
            <span className="result-icon" aria-hidden="true">✧</span>
          </div>

          {!result && !loading && (
            <div className="empty-state">
              <div className="empty-art" aria-hidden="true">
                <div className="art-orbit orbit-one" />
                <div className="art-orbit orbit-two" />
                <div className="art-center">✦</div>
              </div>

              <h3>Your next viral caption starts here</h3>
              <p>
                Describe your post, pick your platform and tone, then let AI write
                tailored captions with formatting and hashtag sets.
              </p>

              <div className="empty-tags">
                <span>✨ 3 Options</span>
                <span>🏷 Targeted Hashtags</span>
                <span>⚡ Instant Groq Speed</span>
              </div>
            </div>
          )}

          {loading && (
            <div className="loading-state">
              <span className="large-spinner" aria-hidden="true" />
              <h3>Generating high-impact captions...</h3>
              <p>Our AI is structuring hooks, tone, and hashtags for {platform}.</p>
              <div className="loading-steps">
                <span className="loading-step active">Analyzing context</span>
                <span className="loading-divider">→</span>
                <span className="loading-step active">Writing hooks</span>
                <span className="loading-divider">→</span>
                <span className="loading-step">Formatting</span>
              </div>
            </div>
          )}

          {user && result && (
            <div className="generated-result">
              <div className="result-meta">
                <div className="flex items-center gap-2">
                  <span className="result-badge">✦ AI GENERATED</span>
                  <span className={`platform-pill ${getPlatformBadgeClass(result.platform)}`}>
                    {result.platform}
                  </span>
                </div>
                <span className="result-timestamp">{formatDate(result.created_at)}</span>
              </div>

              <div
                tabIndex={0}
                className="caption-content"
                aria-label="Generated caption text"
              >
                {getCaptionText(result) || "No caption text returned."}
              </div>

              <div className="result-actions">
                <button
                  type="button"
                  className={`copy-button ${
                    copiedId === "current-result" ? "copy-button-success" : ""
                  }`}
                  onClick={() => void copyCaptions(result, "current-result")}
                  aria-label="Copy generated captions to clipboard"
                >
                  {copiedId === "current-result" ? (
                    <>
                      <span aria-hidden="true">✓</span> Copied to clipboard!
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">📋</span> Copy all captions
                    </>
                  )}
                </button>

                <button
                  type="button"
                  className="regenerate-button"
                  onClick={generateCaptions}
                  disabled={loading}
                  aria-label="Regenerate captions"
                >
                  ↻ Generate again
                </button>
              </div>
            </div>
          )}

          <div className="result-footer">
            <span>CAPTIONAI STUDIO</span>
            <span>CRAFTED FOR CREATORS ✦</span>
          </div>
        </div>
      </section>

      {/* History Library Section */}
      <section className="history-section" aria-label="Caption History Library">
        <div className="history-header">
          <div>
            <div className="flex items-center gap-2">
              <span className="step-label">03 / LIBRARY</span>
              {user && (
                <span className="count-pill">
                  {historyTotal} saved
                </span>
              )}
            </div>
            <h2>Your Caption Library</h2>
            <p>
              {user
                ? "Your previously generated captions, securely saved to your account."
                : "Sign in to save, organize, and access your generated captions anywhere."}
            </p>
          </div>

          {user && (
            <button
              type="button"
              className="history-refresh"
              onClick={() => void loadHistory(true)}
              disabled={historyLoading}
              aria-label="Refresh caption history"
            >
              {historyLoading ? "Refreshing..." : "↻ Refresh"}
            </button>
          )}
        </div>

        {historyError && (
          <div className="error-message mb-5" role="alert">
            <div className="flex items-start gap-2">
              <span className="text-red-400 font-bold" aria-hidden="true">⚠</span>
              <span className="flex-1">{historyError}</span>
              <button
                type="button"
                onClick={() => setHistoryError("")}
                className="text-red-300 hover:text-white text-xs px-1"
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Guest state: User is logged out */}
        {authChecked && !user && (
          <div className="history-guest-card">
            <div className="guest-icon" aria-hidden="true">✦</div>
            <h3>Save your captions in one place</h3>
            <p>
              Never lose a great hook or caption idea. Sign in to automatically
              archive every caption you generate and copy them anytime.
            </p>
            <div className="guest-buttons">
              <Link href="/login" className="guest-login-btn">
                Log In
              </Link>
              <Link href="/signup" className="guest-signup-btn">
                Create Free Account
              </Link>
            </div>
          </div>
        )}

        {/* Authenticated user: Loading skeleton */}
        {user && historyLoading && history.length === 0 && (
          <div className="history-skeleton-list" aria-label="Loading library">
            {[1, 2, 3].map((n) => (
              <div key={n} className="skeleton-card">
                <div className="skeleton-header">
                  <div className="skeleton-line w-1/3" />
                  <div className="skeleton-line w-20" />
                </div>
                <div className="skeleton-line w-full h-16 mt-3" />
                <div className="skeleton-actions mt-3">
                  <div className="skeleton-line w-24 h-8" />
                  <div className="skeleton-line w-16 h-8" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Authenticated user: Empty history */}
        {user && !historyLoading && history.length === 0 && (
          <div className="history-empty">
            <span className="empty-sparkle" aria-hidden="true">✧</span>
            <h3>No saved captions yet</h3>
            <p>
              Generate your first caption above and it will be preserved in your library.
            </p>
          </div>
        )}

        {/* Authenticated user: Saved captions list */}
        {user && history.length > 0 && (
          <>
            <div className="history-list">
              {history.map((item) => {
                const captionText = getCaptionText(item);
                const uniqueKey = item.id ?? `${item.topic}-${item.created_at}`;

                return (
                  <article className="history-card" key={uniqueKey}>
                    <div className="history-card-header">
                      <div>
                        <h3>{item.topic}</h3>
                        <div className="history-meta-row">
                          <span
                            className={`platform-pill ${getPlatformBadgeClass(
                              item.platform
                            )}`}
                          >
                            {item.platform}
                          </span>
                          <span className="history-tag">
                            {item.tone || "Engaging"}
                          </span>
                          <span className="history-tag">
                            {item.language || "Hinglish"}
                          </span>
                        </div>
                      </div>

                      <span className="history-date">
                        {formatDate(item.created_at)}
                      </span>
                    </div>

                    <div
                      tabIndex={0}
                      className="history-caption"
                      aria-label={`Caption for ${item.topic}`}
                    >
                      {captionText || "No caption text available."}
                    </div>

                    <div className="history-actions">
                      <button
                        type="button"
                        className={`copy-button ${
                          copiedId === `history-${item.id ?? item.topic}`
                            ? "copy-button-success"
                            : ""
                        }`}
                        onClick={() =>
                          void copyCaptions(
                            item,
                            `history-${item.id ?? item.topic}`
                          )
                        }
                        aria-label={`Copy caption for ${item.topic}`}
                      >
                        {copiedId === `history-${item.id ?? item.topic}` ? (
                          <>
                            <span aria-hidden="true">✓</span> Copied
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true">📋</span> Copy caption
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        className="history-delete"
                        onClick={() => {
                          if (item.id !== undefined) {
                            void deleteCaption(item.id);
                          }
                        }}
                        disabled={
                          item.id === undefined || deletingId === item.id
                        }
                        aria-label={`Delete caption for ${item.topic}`}
                      >
                        {deletingId === item.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Load More Pagination Control */}
            {history.length < historyTotal && (
              <div className="history-pagination">
                <button
                  type="button"
                  className="load-more-btn"
                  onClick={() => void loadMoreHistory()}
                  disabled={loadingMore}
                  aria-label="Load more saved captions"
                >
                  {loadingMore ? (
                    <>
                      <span className="spinner" aria-hidden="true" />
                      <span>Loading more captions...</span>
                    </>
                  ) : (
                    <>
                      <span>
                        Load more captions ({history.length} of {historyTotal})
                      </span>
                      <span aria-hidden="true">↓</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <footer className="page-footer">
        <span>© 2026 CaptionAI · Professional AI Social Media Studio</span>
        <span>Make every post stand out.</span>
      </footer>
    </main>
  );
}
