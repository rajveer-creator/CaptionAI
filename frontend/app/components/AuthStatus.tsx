"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User, Session, AuthChangeEvent } from "@supabase/supabase-js";

interface AuthStatusProps {
  onLogout?: () => void;
  redirectTo?: string | null;
}

export default function AuthStatus({
  onLogout,
  redirectTo = null,
}: AuthStatusProps = {}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }: { data: { user: User | null } }) => {
      setUser(data.user);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    setLoggingOut(true);

    // 1. Trigger immediate synchronous UI cleanup in parent
    onLogout?.();

    const supabase = createClient();
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("Supabase sign out notice:", error.message);
      }
    } catch (err) {
      console.error("Sign out error:", err);
    } finally {
      setUser(null);
      setLoggingOut(false);
      if (redirectTo) {
        router.push(redirectTo);
      }
      router.refresh();
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2" aria-label="Loading account">
        <div className="h-9 sm:h-10 w-24 sm:w-28 animate-pulse rounded-xl bg-white/5" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center gap-3 sm:gap-4">
        <Link
          href="/login"
          className="inline-flex items-center justify-center h-9 sm:h-10 px-3.5 sm:px-4 rounded-xl border border-white/10 bg-white/[0.03] text-xs sm:text-sm font-semibold text-gray-200 transition-all duration-150 hover:border-white/25 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
        >
          Log In
        </Link>
        <Link
          href="/signup"
          className="inline-flex items-center justify-center h-9 sm:h-10 px-3.5 sm:px-4 rounded-xl bg-gradient-to-r from-[#7c4dd4] to-[#b468ea] text-xs sm:text-sm font-semibold text-white shadow-md shadow-purple-950/40 transition-all duration-150 hover:brightness-110 hover:shadow-purple-900/40 hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
        >
          Sign Up
        </Link>
      </div>
    );
  }

  const displayName =
    user.user_metadata?.full_name ||
    user.email?.split("@")[0] ||
    "Creator";

  const initial = (displayName.charAt(0) || "U").toUpperCase();

  return (
    <div className="flex flex-wrap items-center gap-2.5 sm:gap-3.5">
      <div
        className="flex h-9 sm:h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs text-gray-200"
        title={user.email || displayName}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-tr from-[#7c4dd4] to-[#e5a5ff] text-[10px] font-bold text-white shadow-sm">
          {initial}
        </span>
        <span className="max-w-[110px] truncate sm:max-w-[160px] font-medium text-gray-200">
          {displayName}
        </span>
      </div>

      <button
        type="button"
        onClick={handleLogout}
        disabled={loggingOut}
        aria-label="Log out of CaptionAI"
        className="inline-flex h-9 sm:h-10 items-center justify-center rounded-xl border border-white/10 px-3 sm:px-3.5 text-xs sm:text-sm font-medium text-gray-300 transition-all duration-150 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 disabled:opacity-50"
      >
        {loggingOut ? "Signing out..." : "Logout"}
      </button>
    </div>
  );
}
