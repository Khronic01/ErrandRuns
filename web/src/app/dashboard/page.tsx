import type { Metadata } from "next";
import AccountDashboard from "@/components/account-dashboard";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

export default function DashboardPage() {
  return <AccountDashboard />;
}
