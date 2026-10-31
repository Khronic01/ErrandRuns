import type { Metadata } from "next";
import RoleSelection from "./role-selection";

export const metadata: Metadata = { title: "Choose your roles", robots: { index: false } };

export default function RolesPage() {
  return <RoleSelection />;
}
