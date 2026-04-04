"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth, type UserRole } from "@/context/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const ROLE_HOME: Record<UserRole, string> = {
  patient: "/patient/dashboard",
  doctor: "/doctor/dashboard",
  admin: "/admin/dashboard",
};

const TEST_ACCOUNTS: { role: UserRole; label: string; email: string; password: string; color: string }[] = [
  {
    role: "patient",
    label: "Patient",
    email: "patient@swadhikaar.in",
    password: "patient123",
    color: "border-slate-200 bg-slate-50/50 hover:border-slate-400",
  },
  {
    role: "doctor",
    label: "Care Coordinator",
    email: "coordinator@swadhikaar.in",
    password: "coordinator123",
    color: "border-slate-200 bg-slate-50/50 hover:border-slate-400",
  },
  {
    role: "admin",
    label: "Admin",
    email: "admin@swadhikaar.in",
    password: "admin123",
    color: "border-slate-200 bg-slate-50/50 hover:border-slate-400",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await signIn(email, password);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      // Role comes from user_metadata via auth context onAuthStateChange
      // Use email hint to redirect immediately
      const inferredRole: UserRole = email.includes("coordinator")
        ? "doctor"
        : email.includes("admin")
        ? "admin"
        : "patient";
      router.push(ROLE_HOME[inferredRole]);
    }
  }

  function prefillCredentials(account: (typeof TEST_ACCOUNTS)[number]) {
    setEmail(account.email);
    setPassword(account.password);
    setError("");
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-lg">S</span>
            </div>
            <span className="text-2xl font-bold text-slate-900 tracking-tight">Swadhikaar</span>
          </Link>
          <p className="text-sm text-slate-500 mt-2">
            Indic Voice AI Patient Engagement Platform
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleEmailLogin} className="space-y-4">
          {error && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter email"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="w-full"
          >
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        {/* Quick Login — Test Accounts */}
        <div className="mt-8">
          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-slate-400 font-medium uppercase tracking-wider">Test Accounts</span>
            </div>
          </div>

          <div className="space-y-2">
            {TEST_ACCOUNTS.map((acc) => (
              <button
                key={acc.role}
                onClick={() => prefillCredentials(acc)}
                className={`w-full flex items-center justify-between p-3 border rounded-lg text-left transition-all ${acc.color}`}
              >
                <div>
                  <span className="text-sm font-semibold text-slate-900">{acc.label}</span>
                  <span className="text-xs text-slate-500 ml-2">{acc.email}</span>
                </div>
                <span className="text-xs font-mono text-slate-400">{acc.password}</span>
              </button>
            ))}
          </div>

          <p className="text-[10px] text-slate-400 text-center mt-4 uppercase tracking-wider">
            Click a test account to prefill credentials, then hit Sign In
          </p>
        </div>

        <p className="text-xs text-slate-400 text-center mt-6">
          Secure access for Swadhikaar care operations
        </p>
      </div>
    </div>
  );
}
