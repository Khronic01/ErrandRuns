import type { Metadata } from "next";
import { Suspense } from "react";
import SignInForm from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function SignInPage() {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-md px-4 py-10">Loading sign-in…</main>}>
      <SignInForm />
    </Suspense>
  );
}
