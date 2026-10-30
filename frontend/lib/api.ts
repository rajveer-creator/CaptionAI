import { createClient } from "@/lib/supabase/client";

export const PRODUCTION_API_URL = "https://captionai-kf6z.onrender.com";
export const DEVELOPMENT_API_URL = "http://127.0.0.1:8000";

/**
 * Returns the active API base URL.
 * Priority:
 * 1. process.env.NEXT_PUBLIC_API_URL (if provided and non-empty)
 * 2. If running in development (process.env.NODE_ENV === "development"), falls back to DEVELOPMENT_API_URL ("http://127.0.0.1:8000")
 * 3. In production, always falls back to PRODUCTION_API_URL ("https://captionai-kf6z.onrender.com")
 */
export function getApiBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV === "development") {
    return DEVELOPMENT_API_URL;
  }

  return PRODUCTION_API_URL;
}

export const API_BASE_URL = getApiBaseUrl();

/**
 * Makes an authenticated fetch request to the CaptionAI backend with the current user's Supabase JWT.
 * Preserves the Bearer token Authorization header and session lifecycle.
 */
export async function authenticatedFetch(
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

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();

  return fetch(`${baseUrl}${normalizedPath}`, {
    ...init,
    headers,
  });
}
